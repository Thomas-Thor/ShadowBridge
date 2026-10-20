import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaging, repositoryRoot } from '../scripts/staging-prepare.mjs';

test('resolved private Compose publishes only the loopback TLS gateway', async () => {
  const directory = path.join(repositoryRoot, '.local', `package-test-${randomBytes(6).toString('hex')}`);
  try {
    // This valid long project name previously exceeded OpenSSL's 64-byte CN.
    await prepareStaging({ directory, project: 'shadowbridge-stageg-backup-test-123456789abc' });
    // Resolved config contains secrets. Keep it exclusively in memory.
    const config = JSON.parse(execFileSync('docker', ['compose', '--env-file', path.join(directory, 'compose.env'), '-f', 'deploy/staging/compose.yaml', '--profile', 'tools', 'config', '--format', 'json'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    for (const name of ['postgres', 'auth', 'mailpit', 'app', 'migrator']) {
      assert.equal((config.services[name].ports || []).length, 0, `${name} must not publish host ports`);
      assert.equal(config.services[name].privileged === true, false);
      assert.equal(config.services[name].network_mode === 'host', false);
    }
    assert.equal(config.services.gateway.ports.length, 1);
    assert.equal(config.services.gateway.ports[0].host_ip, '127.0.0.1');
    assert.equal(config.services.gateway.ports[0].target, 443);
    assert.equal(config.networks.private.internal, true);
    assert.equal(config.services.app.environment.APP_ENV, 'production');
    assert.equal(config.services.app.environment.DATABASE_ADMIN_URL, undefined);
    assert.equal(config.services.app.environment.GOTRUE_JWT_SECRET, undefined);
    assert.equal(config.services.app.read_only, true);
    assert.equal(config.services.app.cap_drop.includes('ALL'), true);
    for (const service of ['app', 'auth', 'gateway']) {
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
        assert.equal(config.services[service].environment[key], '', `${service} must not send private traffic through inherited proxies`);
      }
      for (const host of ['app', 'auth', 'auth-proxy', 'postgres', 'mailpit']) {
        assert.equal(config.services[service].environment.NO_PROXY.split(',').includes(host), true);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('build context excludes credentials, databases and test fixtures', async () => {
  const ignore = await readFile(path.join(repositoryRoot, '.dockerignore'), 'utf8');
  assert.equal(ignore.startsWith('**\n'), true);
  assert.equal(/!\.local|!\.git|!tests|!.*\.env/m.test(ignore), false);
  const dockerfile = await readFile(path.join(repositoryRoot, 'deploy/staging/Dockerfile'), 'utf8');
  assert.equal(/^COPY\s+\.\s/m.test(dockerfile), false);
  assert.equal(dockerfile.includes('scripts/demo.mjs'), false);
  assert.equal(dockerfile.includes('USER node'), true);
});
