const SESSION_COOKIE = 'homeland_sid';
const MAX_BODY_BYTES = 1_000_000;

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
      ...extraHeaders,
    },
  });
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

function createSessionId() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildSessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
}

function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) {
    return cfIp.trim();
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return 'unknown';
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new Error('Request body too large');
  }
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function parseProgress(rawProgress) {
  if (!rawProgress) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawProgress);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function getSessionById(db, sessionId) {
  return db
    .prepare('SELECT session_id, created_at, updated_at, last_ip, progress_json FROM sessions WHERE session_id = ?1')
    .bind(sessionId)
    .first();
}

async function resolveSession(request, env) {
  const db = env.PROGRESS_DB;
  if (!db) {
    throw new Error('Missing PROGRESS_DB D1 binding.');
  }

  const cookies = parseCookies(request.headers.get('cookie') || '');
  const requestIp = getClientIp(request);
  let sessionId = cookies[SESSION_COOKIE] || null;
  let session = null;
  let shouldSetCookie = false;

  if (sessionId) {
    session = await getSessionById(db, sessionId);
  }

  if (!session) {
    if (!sessionId) {
      const mapped = await db
        .prepare('SELECT session_id FROM ip_index WHERE ip = ?1')
        .bind(requestIp)
        .first();
      if (mapped?.session_id) {
        sessionId = mapped.session_id;
        session = await getSessionById(db, sessionId);
      }
    }

    if (!session) {
      sessionId = createSessionId();
      const now = new Date().toISOString();
      await db
        .prepare(
          'INSERT INTO sessions (session_id, created_at, updated_at, last_ip, progress_json) VALUES (?1, ?2, ?3, ?4, ?5)'
        )
        .bind(sessionId, now, now, requestIp, 'null')
        .run();
      session = await getSessionById(db, sessionId);
      shouldSetCookie = true;
    } else {
      shouldSetCookie = true;
    }
  }

  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO ip_index (ip, session_id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at')
    .bind(requestIp, sessionId, now)
    .run();

  const headers = shouldSetCookie ? { 'set-cookie': buildSessionCookie(sessionId) } : {};
  return { sessionId, session, db, headers, requestIp };
}

export async function onRequest(context) {
  const { request, env } = context;
  let resolved;
  try {
    resolved = await resolveSession(request, env);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error.message || 'Session resolution failed.' });
  }

  const { db, sessionId, session, headers, requestIp } = resolved;

  if (request.method === 'GET') {
    return jsonResponse(200, {
      ok: true,
      sessionId,
      progress: parseProgress(session.progress_json),
    }, headers);
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let body = null;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(400, { ok: false, error: error.message || 'Invalid JSON payload.' }, headers);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse(400, { ok: false, error: 'Progress payload must be a JSON object.' }, headers);
    }

    const now = new Date().toISOString();
    await db
      .prepare(
        'INSERT INTO sessions (session_id, created_at, updated_at, last_ip, progress_json) VALUES (?1, ?2, ?3, ?4, ?5) ' +
        'ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at, last_ip = excluded.last_ip, progress_json = excluded.progress_json'
      )
      .bind(sessionId, session.created_at || now, now, requestIp, JSON.stringify(body))
      .run();

    return jsonResponse(200, { ok: true, sessionId, updatedAt: now }, headers);
  }

  if (request.method === 'DELETE') {
    const now = new Date().toISOString();
    await db
      .prepare('UPDATE sessions SET updated_at = ?1, last_ip = ?2, progress_json = ?3 WHERE session_id = ?4')
      .bind(now, requestIp, 'null', sessionId)
      .run();
    return jsonResponse(200, { ok: true, sessionId }, headers);
  }

  return jsonResponse(405, { ok: false, error: 'Method not allowed.' }, headers);
}
