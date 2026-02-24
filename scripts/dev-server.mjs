import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const ROOT = new URL('../web/', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function resolvePath(urlPath) {
  const pathname = new URL(urlPath || '/', 'http://localhost').pathname;
  const rawPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(rawPath).replace(/^\/+/, '');
  return join(ROOT, safePath);
}

const server = createServer(async (req, res) => {
  try {
    const path = resolvePath(req.url || '/');
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
