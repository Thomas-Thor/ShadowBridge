// Test-only static transport. No backend, authentication or database is started.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const allowed = /^\/portal\/(?:index\.html|(?:(?:buyer|supplier|partner|admin|offers)\/(?:index\.html)?))?$/.test(pathname)
      || /^\/assets\/(?:[a-zA-Z0-9.-]+\.(?:js|css|svg|png)|fonts\/[a-zA-Z0-9.-]+\.woff2)$/.test(pathname);
    if (request.method !== 'GET' || !allowed) { response.writeHead(404).end(); return; }
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const target = path.resolve(root, `.${relative}`);
    if (!target.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    const data = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  } catch { response.writeHead(404).end(); }
}).listen(8042, '127.0.0.1');
