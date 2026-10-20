const http = require('node:http');
const { randomBytes } = require('node:crypto');

// Browser-only transport fixture. Every context has a real, distinct loopback
// peer so the 5-enquiries/15-min limit remains enabled across the width matrix.
// No API response, identity, contact record or database counter is substituted.
async function contactProxy() {
  const origin = new URL(process.env.SHADOWBRIDGE_TEST_URL || 'http://127.0.0.1:8088');
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password) {
    throw new Error('The contact transport fixture accepts only the real loopback HTTP BFF.');
  }
  const source = `127.${[...randomBytes(3)].map(byte => byte % 254 + 1).join('.')}`;
  const server = http.createServer((incoming, outgoing) => {
    let target;
    try { target = new URL(incoming.url, origin); } catch { outgoing.writeHead(400).end(); return; }
    if (target.origin !== origin.origin || target.username || target.password) {
      outgoing.writeHead(403).end(); return;
    }
    const forwarded = http.request(target, {
      method: incoming.method, headers: incoming.headers, localAddress: source,
    }, response => {
      // rawHeaders preserves separate Set-Cookie fields without rewriting them.
      outgoing.writeHead(response.statusCode, response.statusMessage, response.rawHeaders);
      response.pipe(outgoing);
    });
    forwarded.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('aborted', () => forwarded.destroy());
    outgoing.on('close', () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  // There is no tunnel or forwarding path to external HTTPS destinations.
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    settings: { server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { contactProxy };
