import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PREVIEW_PORT || 4180);
const ROOT = fileURLToPath(new URL('../dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

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

function cacheHeaders(pathname) {
  if (pathname.startsWith('/assets/')) {
    return { 'cache-control': 'public, max-age=31536000, immutable' };
  }
  if (pathname.startsWith('/api/')) {
    return { 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' };
  }
  return { 'cache-control': 'no-cache' };
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      ...cacheHeaders(pathname),
    });
    res.end(JSON.stringify({ ok: true, progress: null }));
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
      ...cacheHeaders(pathname),
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Preview server running at http://${HOST}:${PORT}`);
});
