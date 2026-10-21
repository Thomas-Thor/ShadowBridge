import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.mjs';

function fixture() {
  const password = randomBytes(32).toString('hex');
  return {
    APP_ENV: 'production', APP_URL: 'https://portal.shadowbridge.invalid',
    SUPABASE_URL: 'https://auth.shadowbridge.invalid', SUPABASE_ANON_KEY: 'test-only-not-a-provider-key',
    DATABASE_URL: `postgres://shadowbridge_api:${password}@db.shadowbridge.invalid/shadowbridge?sslmode=verify-full`,
    SESSION_DATABASE_URL: `postgres://shadowbridge_sessions:${password}@db.shadowbridge.invalid/shadowbridge?sslmode=verify-full`,
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
}
test('production configuration enforces secure cookies, HTTPS and encrypted DB connections', () => {
  const env = fixture();
  assert.equal(loadConfig(env).secureCookies, true);
  assert.throws(() => loadConfig({ ...env, APP_URL: 'http://portal.shadowbridge.invalid' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, SUPABASE_URL: 'http://auth.shadowbridge.invalid' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace('?sslmode=verify-full', '') }), /TLS|verify-full/);
  assert.throws(() => loadConfig({ ...env, SESSION_DATABASE_URL: env.DATABASE_URL }), /separate/);
  assert.throws(() => loadConfig({ ...env, SESSION_ENCRYPTION_KEY: randomBytes(12).toString('base64') }), /32 random bytes/);
});
test('local development cannot expose its HTTP service or identity provider externally', () => {
  const env = { ...fixture(), APP_ENV: 'local', APP_URL: 'http://127.0.0.1:8088', SUPABASE_URL: 'http://127.0.0.1:9999' };
  env.DATABASE_URL = env.DATABASE_URL.replace('db.shadowbridge.invalid', '127.0.0.1');
  env.SESSION_DATABASE_URL = env.SESSION_DATABASE_URL.replace('db.shadowbridge.invalid', '127.0.0.1');
  assert.equal(loadConfig(env).secureCookies, false, 'Only explicit loopback development may use HTTP cookies');
  assert.throws(() => loadConfig({ ...env, HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => loadConfig({ ...env, APP_URL: 'http://public.shadowbridge.invalid' }), /loopback/);
  assert.throws(() => loadConfig({ ...env, SUPABASE_URL: 'http://public.shadowbridge.invalid' }), /loopback/);
});

test('external email is disabled by default and staging requires a bounded exact allowlist', () => {
  const env = fixture();
  assert.equal(loadConfig(env).mailDeliveryMode, 'disabled');
  assert.throws(()=>loadConfig({...env,MAIL_DELIVERY_MODE:'allowlist'}), /ALLOWLIST/);
  assert.throws(()=>loadConfig({...env,MAIL_DELIVERY_MODE:'anywhere'}), /MAIL_DELIVERY_MODE/);
  assert.throws(()=>loadConfig({...env,MAIL_DELIVERY_MODE:'allowlist',TEST_EMAIL_ALLOWLIST:'*@example.invalid'}), /exact/);
  assert.deepEqual(loadConfig({...env,MAIL_DELIVERY_MODE:'allowlist',TEST_EMAIL_ALLOWLIST:'Owner@shadowbridge.invalid'}).testEmailAllowlist, ['owner@shadowbridge.invalid']);
});

test('public SMTP requires both production and an explicit transactional-mail switch', () => {
  const env = { ...fixture(), MAIL_DELIVERY_MODE: 'smtp' };
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    assert.throws(() => loadConfig({ ...env, TRANSACTIONAL_MAIL_ENABLED: enabled }), /TRANSACTIONAL_MAIL_ENABLED/);
  }
  for (const appEnv of ['local', 'test']) {
    assert.throws(() => loadConfig({ ...env, APP_ENV: appEnv, TRANSACTIONAL_MAIL_ENABLED: 'true' }), /production/);
  }
  const approved = loadConfig({ ...env, TRANSACTIONAL_MAIL_ENABLED: 'true' });
  assert.equal(approved.mailDeliveryMode, 'smtp');
  assert.equal(approved.transactionalMailEnabled, true);
  assert.equal(loadConfig({ ...fixture(), TRANSACTIONAL_MAIL_ENABLED: 'true' }).mailDeliveryMode, 'disabled', 'The switch alone must not enable delivery');
});

test('proxy attestation is opt-in and refuses short or malformed secrets', () => {
  const env = fixture();
  assert.equal(loadConfig(env).proxyAuthToken, null);
  for (const encoding of ['hex', 'base64', 'base64url']) {
    const value = randomBytes(32).toString(encoding);
    assert.equal(loadConfig({ ...env, PROXY_AUTH_TOKEN: value }).proxyAuthToken, value);
  }
  for (const value of ['weak', randomBytes(16).toString('hex'), 'x'.repeat(257), ' '+randomBytes(32).toString('base64'), 'not:a:token', ['invalid']]) {
    assert.throws(() => loadConfig({ ...env, PROXY_AUTH_TOKEN: value }), /PROXY_AUTH_TOKEN/);
  }
});

test('release identity accepts only a full commit SHA and is absent by default', () => {
  const env = fixture(), sha = randomBytes(20).toString('hex');
  assert.equal(loadConfig(env).releaseSha, null);
  assert.equal(loadConfig({ ...env, RELEASE_SHA: sha.toUpperCase() }).releaseSha, sha);
  for (const value of ['main', sha.slice(0, 7), sha+'0', 'g'.repeat(40), sha+'\r\nX-Injected: bad']) {
    assert.throws(() => loadConfig({ ...env, RELEASE_SHA: value }), /RELEASE_SHA/);
  }
});
