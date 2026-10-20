import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { chmod, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaging, checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';

// Only new, randomly named test configuration is created and removed. No
// Docker or database is used; these tests do not claim runtime integration.
test('private preparation generates verified TLS and stable isolated credentials', async t => {
  const suffix = randomBytes(7).toString('hex');
  const directory = path.join(repositoryRoot, '.local', `prepare-test-${suffix}`);
  const linked = path.join(repositoryRoot, '.local', `prepare-link-${suffix}`);
  const project = `shadowbridge-contabo-test-${suffix}`;
  const digest = value => createHash('sha256').update(value).digest('hex');
  try {
    const prepared = await prepareStaging({ directory, project, httpsPort: 18443, httpPort: 18080 });
    await t.test('new configuration is HTTPS-only, loopback-bound, scoped and non-DBA at runtime', async () => {
      assert.equal(prepared.created, true);
      const app = await readEnv(path.join(directory, 'app.env'));
      const compose = await readEnv(path.join(directory, 'compose.env'));
      const auth = await readEnv(path.join(directory, 'auth.env'));
      assert.equal(app.APP_URL, 'https://localhost:18443');
      assert.equal(app.SUPABASE_URL, 'https://auth-proxy:8444');
      assert.equal(app.APP_ENV, 'production');
      assert.equal(compose.STAGING_BIND, '127.0.0.1');
      assert.equal(compose.STAGING_PROJECT, project);
      assert.equal(app.DATABASE_ADMIN_URL, undefined);
      assert.equal(app.GOTRUE_JWT_SECRET, undefined);
      assert.equal(new URL(app.DATABASE_URL).username, 'shadowbridge_api');
      assert.equal(new URL(app.SESSION_DATABASE_URL).username, 'shadowbridge_sessions');
      assert.equal(new URL(app.DATABASE_URL).searchParams.get('sslmode'), 'verify-full');
      assert.equal(auth.GOTRUE_MAILER_AUTOCONFIRM, 'false');
      assert.equal(auth.GOTRUE_MFA_TOTP_VERIFY_ENABLED, 'true');
      assert.equal(auth.GOTRUE_SMTP_HOST, 'mailpit');
      assert.equal(app.MAIL_DELIVERY_MODE, 'captured');
      assert.equal(Buffer.from(app.SESSION_ENCRYPTION_KEY, 'base64').length, 32);
    });
    await t.test('repeated preparation preserves all original fingerprints', async () => {
      const before = digest(await readFile(path.join(directory, 'manifest.json')));
      assert.equal((await prepareStaging({ directory, project, httpsPort: 18443 })).created, false);
      assert.equal(digest(await readFile(path.join(directory, 'manifest.json'))), before);
      await assert.rejects(prepareStaging({ directory, project: project + '-other' }), /differs/);
      await assert.rejects(prepareStaging({ directory, httpsPort: 19443 }), /differs/);
      assert.equal((await checkStaging({ directory })).project, project);
    });
    await t.test('unsafe permissions are rejected without rotating credentials', async () => {
      const file = path.join(directory, 'app.env');
      await chmod(file, 0o644);
      await assert.rejects(checkStaging({ directory }), /Unsafe permissions/);
      await chmod(file, 0o600);
      await checkStaging({ directory });
    });
    await t.test('configuration tampering is detected and never overwritten', async () => {
      const file = path.join(directory, 'app.env');
      const original = await readFile(file);
      await writeFile(file, Buffer.concat([original, Buffer.from('# deliberate test-only change\n')]));
      const changed = digest(await readFile(file));
      await assert.rejects(prepareStaging({ directory }), /fingerprint changed/);
      assert.equal(digest(await readFile(file)), changed);
      await writeFile(file, original);
      await checkStaging({ directory });
    });
    await t.test('symlink escapes and paths outside ignored private state are refused', async () => {
      await symlink(directory, linked, 'dir');
      await assert.rejects(checkStaging({ directory: linked }), /Symlink/);
      await assert.rejects(prepareStaging({ directory: path.join(repositoryRoot, 'deploy', 'private-secrets') }), /ignored repository/);
      await assert.rejects(prepareStaging({ directory: '.local/invalid path' }), /whitespace/);
    });
  } finally {
    await rm(linked, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
