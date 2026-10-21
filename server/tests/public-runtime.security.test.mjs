// HTTP unit smoke only. Database/Auth are intentionally not exercised here;
// deployment integration checks must separately use the real services.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';

function environment() {
  const password = randomBytes(32).toString('hex');
  return {
    APP_ENV: 'production', APP_URL: 'https://shadowbridge.invalid',
    SUPABASE_URL: 'https://auth.shadowbridge.invalid', SUPABASE_ANON_KEY: randomBytes(32).toString('hex'),
    DATABASE_URL: `postgres://shadowbridge_api:${password}@postgres/shadowbridge?sslmode=verify-full`,
    SESSION_DATABASE_URL: `postgres://shadowbridge_sessions:${password}@postgres/shadowbridge?sslmode=verify-full`,
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PROXY_AUTH_TOKEN: randomBytes(32).toString('base64url'),
  };
}

for (const hasRelease of [false, true]) {
  test(`public configuration ${hasRelease ? 'identifies an explicit release' : 'preserves its existing shape without a release'} without exposing secrets`, async t => {
    const env = environment();
    if (hasRelease) env.RELEASE_SHA = randomBytes(20).toString('hex');
    const config = loadConfig(env);
    const noQuery = () => { throw new Error('This public configuration smoke must not read private data'); };
    const db = { sessionPool: { query: noQuery }, close: async () => {} };
    const app = createApp({ config, db });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    t.after(() => app.close());
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const expectedKeys = ['backendEnabled', 'csrfToken', 'environment', ...(hasRelease ? ['releaseSha'] : [])].sort();
    assert.deepEqual(Object.keys(body).sort(), expectedKeys);
    assert.equal(body.backendEnabled, true);
    assert.equal(body.environment, 'production');
    assert.equal(body.releaseSha, env.RELEASE_SHA);
    assert.equal(response.headers.get('x-shadowbridge-release'), env.RELEASE_SHA || null);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    const publicOutput = JSON.stringify(body) + [...response.headers].map(value => value.join(':')).join('\n');
    for (const key of ['SUPABASE_ANON_KEY', 'PROXY_AUTH_TOKEN', 'SESSION_ENCRYPTION_KEY', 'DATABASE_URL', 'SESSION_DATABASE_URL']) {
      assert.ok(!publicOutput.includes(env[key]), `${key} must remain server-only`);
    }
  });
}
