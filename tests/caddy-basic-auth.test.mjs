// Real Caddy/TLS regression, with no backend or auth-response mocks.
// Uses only new private /tmp fixtures and loopback containers. Test containers
// are stopped, never removed; no owner container, volume or .local file is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
const docker = args => execFileSync('docker', ['--context', 'default', ...args], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Loopback test port ${port} is already in use.`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

function request(port, ca, credentials) {
  return new Promise((resolve, reject) => {
    const headers = { Host: 'localhost' };
    if (credentials) headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    const req = https.request({
      hostname: '127.0.0.1', servername: 'localhost', port, path: '/',
      ca, rejectUnauthorized: true, headers, timeout: 2500,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    req.once('timeout', () => req.destroy(new Error('Private TLS request timed out.')));
    req.once('error', reject);
    req.end();
  });
}

for (const [index, legacy] of [false, true].entries()) {
  test(`Caddy reviewer authenticates over verified TLS with ${legacy ? 'legacy default' : 'explicit bcrypt'} basic_auth`, { timeout: 45_000 }, async () => {
    const id = randomBytes(6).toString('hex');
    const directory = `/tmp/shadowbridge-h1-caddy-${id}`;
    const name = `shadowbridge-h1-caddy-${id}`;
    const port = 18446 + index;
    await freePort(port);
    await mkdir(directory, { mode: 0o700 });
    const password = randomBytes(36).toString('base64url');
    // No trailing newline intentionally exercises the fixed stdin handling.
    await writeFile(path.join(directory, 'tester-password'), password, { mode: 0o600, flag: 'wx' });
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-sha256',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout', path.join(directory, 'public.key'), '-out', path.join(directory, 'public.crt')], {
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
      });
    } catch { throw new Error('Private TLS fixture generation failed.'); }
    await chmod(path.join(directory, 'public.key'), 0o600);
    await chmod(path.join(directory, 'public.crt'), 0o600);
    const ca = await readFile(path.join(directory, 'public.crt'));
    const template = await readFile(path.join(root, 'deploy/staging/Caddyfile.in'), 'utf8');
    assert.ok(template.includes('basic_auth bcrypt {'), 'New staging template must select bcrypt explicitly.');
    let config = template.split('# GoTrue is reachable')[0]
      .replace('@LOCAL_OPTIONS@', 'auto_https off')
      .replace('@DOMAIN@', 'localhost')
      .replace('@PUBLIC_TLS@', 'tls /run/secrets/public.crt /run/secrets/public.key')
      .replace('reverse_proxy app:8088', 'respond "PRIVATE_AUTH_OK" 200');
    if (legacy) config = config.replace('basic_auth bcrypt {', 'basic_auth {');
    await writeFile(path.join(directory, 'Caddyfile'), config, { mode: 0o600, flag: 'wx' });
    let started = false;
    try {
      docker(['run', '-d', '--pull', 'never', '--name', name,
        '--label', 'shadowbridge.test=h1-caddy', '--label', `shadowbridge.test.fixture=${id}`,
        '--read-only', '--tmpfs', '/data', '--tmpfs', '/config', '--tmpfs', '/tmp',
        '--security-opt', 'no-new-privileges:true', '-p', `127.0.0.1:${port}:443`,
        '--entrypoint', '/bin/sh',
        '-v', `${path.join(root, 'deploy/staging/caddy-entrypoint.sh')}:/staging/caddy-entrypoint.sh:ro`,
        '-v', `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`,
        '-v', `${directory}/tester-password:/run/secrets/tester-password:ro`,
        '-v', `${directory}/public.crt:/run/secrets/public.crt:ro`,
        '-v', `${directory}/public.key:/run/secrets/public.key:ro`,
        image, '/staging/caddy-entrypoint.sh']);
      started = true;
      let unauthenticated;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { unauthenticated = await request(port, ca); break; } catch { await pause(150); }
      }
      assert.ok(unauthenticated, 'Private Caddy did not become reachable over verified TLS.');
      assert.equal(unauthenticated.status, 401, 'Missing reviewer credentials must be rejected.');
      assert.equal((await request(port, ca, `reviewer:${password}-wrong`)).status, 401, 'Wrong reviewer password must be rejected.');
      const accepted = await request(port, ca, `reviewer:${password}`);
      assert.equal(accepted.status, 200, 'Correct reviewer password must authenticate with the repository entrypoint.');
      assert.equal(accepted.body, 'PRIVATE_AUTH_OK');
      assert.equal(accepted.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
      assert.equal(accepted.headers['cache-control'], 'no-store');
    } catch (error) {
      if (started) {
        try { await writeFile(path.join(directory, 'private-container.log'), docker(['logs', name]), { mode: 0o600, flag: 'wx' }); } catch {}
      }
      if (error.code === 'ERR_ASSERTION') throw error;
      throw new Error('Private Caddy regression could not complete; fixture retained for local inspection.');
    } finally {
      if (started) docker(['stop', '--time', '5', name]);
    }
  });
}
