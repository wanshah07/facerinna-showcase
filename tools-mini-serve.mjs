/* A four-line static server for the tests, so a check needs no dependency on the
 * lemo renderer's tooling. Serves the repo root on 127.0.0.1, read-only. */
import http from 'http';
import fs from 'fs';
import path from 'path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

export function serve(root, port = 0) {
  return new Promise(resolve => {
    const srv = http.createServer((q, r) => {
      const p = path.resolve(root, '.' + decodeURIComponent(q.url.split('?')[0]));
      if (!p.startsWith(path.resolve(root))) { r.writeHead(403); r.end('no'); return; }
      fs.readFile(p, (e, d) => {
        if (e) { r.writeHead(404); r.end('not found'); return; }
        r.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream' });
        r.end(d);
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve({ server: srv, port: srv.address().port }));
  });
}

export function pageURL(root, port, dir) {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return `http://127.0.0.1:${port}/${rel.split(path.sep).filter(Boolean).join('/')}/index.html`;
}
