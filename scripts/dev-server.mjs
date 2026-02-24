import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(PROJECT_ROOT, 'web');
const STORE_DIR = join(PROJECT_ROOT, '.data');
const STORE_PATH = join(STORE_DIR, 'player-progress.json');
const SESSION_COOKIE = 'homeland_sid';
const STORE_VERSION = 1;
const MAX_BODY_BYTES = 1_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function defaultStore() {
  return {
    version: STORE_VERSION,
    sessions: {},
    ipIndex: {},
  };
}

let progressStore = defaultStore();
let hasLoadedStore = false;
let persistStoreQueue = Promise.resolve();

function resolvePath(urlPath) {
  const pathname = new URL(urlPath || '/', 'http://localhost').pathname;
  const rawPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(rawPath).replace(/^\/+/, '');
  const resolved = join(ROOT, safePath);
  const relPath = relative(ROOT, resolved);
  if (relPath === '..' || relPath.startsWith(`..${sep}`)) {
    return null;
  }
  return resolved;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    pragma: 'no-cache',
    expires: '0',
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(raw = '') {
  const cookies = {};
  for (const pair of raw.split(';')) {
    const [key, ...valueParts] = pair.split('=');
    const trimmedKey = key?.trim();
    if (!trimmedKey) {
      continue;
    }
    cookies[trimmedKey] = decodeURIComponent(valueParts.join('=').trim() || '');
  }
  return cookies;
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function buildSessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
}

function createSessionId() {
  return randomBytes(20).toString('base64url');
}

async function ensureStoreLoaded() {
  if (hasLoadedStore) {
    return;
  }

  try {
    const content = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      progressStore = {
        version: STORE_VERSION,
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        ipIndex: parsed.ipIndex && typeof parsed.ipIndex === 'object' ? parsed.ipIndex : {},
      };
    }
  } catch {
    progressStore = defaultStore();
  }

  hasLoadedStore = true;
}

async function persistStore() {
  await mkdir(STORE_DIR, { recursive: true });
  const serialized = JSON.stringify(progressStore, null, 2);
  persistStoreQueue = persistStoreQueue.then(() => writeFile(STORE_PATH, serialized, 'utf8'));
  await persistStoreQueue;
}

function resolveProgressSession(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const clientIp = getClientIp(req);
  const sessionFromCookie = cookies[SESSION_COOKIE];
  let sessionId = sessionFromCookie;

  if (!sessionId && clientIp in progressStore.ipIndex) {
    const linked = progressStore.ipIndex[clientIp];
    if (linked in progressStore.sessions) {
      sessionId = linked;
    }
  }

  const needsNewSession = !sessionId || !(sessionId in progressStore.sessions);
  if (needsNewSession) {
    sessionId = createSessionId();
  }
  if (!sessionFromCookie || needsNewSession) {
    res.setHeader('set-cookie', buildSessionCookie(sessionId));
  }

  const existing = progressStore.sessions[sessionId];
  const session = existing && typeof existing === 'object'
    ? existing
    : {
        createdAt: new Date().toISOString(),
        updatedAt: null,
        lastIp: clientIp,
        progress: null,
      };

  session.lastIp = clientIp;
  progressStore.sessions[sessionId] = session;
  progressStore.ipIndex[clientIp] = sessionId;

  return { sessionId, session };
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

async function handleProgressApi(req, res) {
  await ensureStoreLoaded();
  const { sessionId, session } = resolveProgressSession(req, res);

  if (req.method === 'GET') {
    sendJson(res, 200, { ok: true, sessionId, progress: session.progress });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body = null;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Invalid JSON payload.' });
      return;
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { ok: false, error: 'Progress payload must be a JSON object.' });
      return;
    }

    session.progress = body;
    session.updatedAt = new Date().toISOString();
    progressStore.sessions[sessionId] = session;
    progressStore.ipIndex[getClientIp(req)] = sessionId;

    try {
      await persistStore();
      sendJson(res, 200, { ok: true, sessionId, updatedAt: session.updatedAt });
    } catch {
      sendJson(res, 500, { ok: false, error: 'Failed to persist player progress.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    session.progress = null;
    session.updatedAt = new Date().toISOString();
    try {
      await persistStore();
      sendJson(res, 200, { ok: true, sessionId });
    } catch {
      sendJson(res, 500, { ok: false, error: 'Failed to reset player progress.' });
    }
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
}

const server = createServer(async (req, res) => {
  if ((req.url || '').startsWith('/api/progress')) {
    await handleProgressApi(req, res);
    return;
  }

  try {
    const path = resolvePath(req.url || '/');
    if (!path) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const file = await readFile(path);
    const type = MIME[extname(path)] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      // Avoid stale browser/CDN content while iterating quickly on visuals.
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Homeland web prototype running at http://${HOST}:${PORT}`);
});
