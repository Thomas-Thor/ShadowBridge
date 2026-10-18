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
