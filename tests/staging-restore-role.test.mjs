// Source guards for the isolated recovery boundary. These do not claim to
// execute pg_restore or SQL; a real isolated restore regression remains needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { restoredSentinelRoleSql } from '../scripts/staging-ops.mjs';

test('reserved role recovery requires the DBA and tracked migration 015', () => {
  assert.match(restoredSentinelRoleSql, /current_user<>'postgres' OR current_database\(\)<>'shadowbridge'/);
  assert.match(restoredSentinelRoleSql, /to_regclass\('shadowbridge_migrations\.applied'\) IS NULL[\s\S]*?RAISE EXCEPTION/);
  assert.match(restoredSentinelRoleSql, /IF NOT EXISTS\([\s\S]*?name='202610210015_sentinel_verification\.sql'\) THEN RETURN; END IF;/);
});

test('existing principals fail closed on privileges, ownership, credentials or memberships', () => {
  for (const flag of ['rolcanlogin','rolinherit','rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolreplication']) {
    assert.match(restoredSentinelRoleSql, new RegExp('reserved\\.' + flag));
  }
  for (const field of ['rolpassword','rolvaliduntil']) assert.match(restoredSentinelRoleSql, new RegExp('reserved\\.' + field + ' IS NOT NULL'));
  assert.match(restoredSentinelRoleSql, /pg_catalog\.pg_db_role_setting WHERE setrole=reserved\.oid/);
  assert.match(restoredSentinelRoleSql, /pg_catalog\.pg_auth_members[\s\S]*?roleid=reserved\.oid OR member=reserved\.oid/);
  assert.match(restoredSentinelRoleSql, /pg_catalog\.pg_shdepend[\s\S]*?refclassid='pg_catalog\.pg_authid'::regclass AND refobjid=reserved\.oid/);
  assert.match(restoredSentinelRoleSql, /Existing reserved recovery role requires administrative review' USING ERRCODE='42501'/);
});

test('missing principal has only the known dormant flags and no new grants or data writes', () => {
  assert.match(restoredSentinelRoleSql, /CREATE ROLE shadowbridge_sentinel NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS\s+NOCREATEDB NOCREATEROLE NOREPLICATION;/);
  assert.doesNotMatch(restoredSentinelRoleSql, /\b(?:ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  assert.equal((restoredSentinelRoleSql.match(/CREATE ROLE/g) || []).length, 1);
});

test('recovery runs after successful restore into the empty target and before service startup', async () => {
  const source = await readFile(new URL('../scripts/staging-ops.mjs', import.meta.url), 'utf8');
  const restore = source.slice(source.indexOf('export async function restoreInstallation'), source.indexOf('export async function operate'));
  const emptyGuard = restore.indexOf("if (empty !== 't')");
  const dumpRestore = restore.indexOf("'pg_restore'");
  const reservedRecovery = restore.indexOf('await recoverRestoredSentinelRole(directory)');
  const start = restore.indexOf("await operate({ action: 'start', directory })");
  assert.ok(emptyGuard >= 0 && emptyGuard < dumpRestore);
  assert.ok(dumpRestore < reservedRecovery && reservedRecovery < start);
  assert.equal((source.match(/await recoverRestoredSentinelRole\(directory\)/g) || []).length, 1);
  assert.match(source, /psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'[\s\S]*?restoredSentinelRoleSql\], \{ capture: true \}/);
});
