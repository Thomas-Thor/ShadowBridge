// Isolated, loopback-only static preview. Does not start the private application.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
const publicRoot = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
export function previewServer() {
  return createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (!['GET','HEAD'].includes(req.method)) return fail(405, 'Read-only DEMO preview.');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return fail(400, 'Invalid path.'); }
    const isPage = /^\/$|^\/offers\/$|^\/offers\/DEMO-MKT-\d{3}\/$|^\/suppliers\/demo-[a-z-]+\/$/.test(pathname);
    const name = isPage ? 'index.html' : pathname.slice(1);
    if (!isPage && !/^assets\/[a-z0-9/.-]+$|^data\/taxonomy\.json$|^robots\.txt$/.test(name)) return fail(404, 'Not found.');
    try {
      const target = await realpath(path.resolve(publicRoot, name));
      if (!target.startsWith(`${publicRoot}${path.sep}`) || name.split('/').some(part => part.startsWith('.'))) return fail(404, 'Not found.');
      const buffer = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch { fail(404, 'Not found.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.MARKET_PORT || 4175);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MARKET_PORT must be 1024–65535.');
  const server = previewServer();
  server.listen(port, '127.0.0.1', () => console.log(`ShadowBridge Market DEMO: http://127.0.0.1:${port} (Ctrl+C to stop)`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
}
