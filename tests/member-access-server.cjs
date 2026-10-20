// Restricted static transport for navigation tests; never authenticates users.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
http.createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const page = /^\/(?:index\.html|(?:member-sign-in|legal|cartel|apply\/(?:buyer|supplier|partner))\/(?:index\.html)?)?$/.test(name);
    const asset = /^\/assets\/(?:[a-zA-Z0-9.-]+\.(?:js|css|svg|png)|fonts\/[a-zA-Z0-9.-]+\.woff2)$/.test(name);
    if (request.method !== 'GET' || !page && !asset) { response.writeHead(404).end(); return; }
    const target = path.resolve(root, `.${name.endsWith('/') ? name + 'index.html' : name}`);
    if (!target.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    const data = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404).end(); }
}).listen(8044, '127.0.0.1');
