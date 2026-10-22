// Source/configuration guards only. These tests do not connect to PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrationSources, migrationConnection, validateApplied } from '../scripts/staging-migrate.mjs';

function connection() {
  return new URL(`postgres://postgres:${randomBytes(32).toString('hex')}@postgres:5432/shadowbridge?sslmode=verify-full&sslrootcert=/run/secrets/internal-ca.crt`);
}

test('actual 001–016 source history is ordered, transactional and hashed', async () => {
  const sources = await migrationSources();
  assert.equal(sources.length, 16);
  assert.equal(sources[0].name, '202610180001_private_b2b.sql');
  assert.equal(sources.at(-1).name, '202610220016_owner_vault.sql');
  for (const source of sources) assert.equal(source.sha256, createHash('sha256').update(source.sql).digest('hex'));
});

test('dedicated private DBA connection uses explicit verified TLS configuration', () => {
  const result = migrationConnection({ DATABASE_ADMIN_URL: connection().href });
  const parsed = new URL(result.connectionString);
  assert.equal(parsed.hostname, 'postgres');
  assert.equal(parsed.username, 'postgres');
  assert.equal(parsed.search, '');
  assert.equal(result.application_name, 'shadowbridge-install-migrator');
  assert.ok(result.connectionTimeoutMillis > 0);
});

test('missing, malformed, runtime-role and unverified connections are refused', () => {
  for (const environment of [{}, { DATABASE_ADMIN_URL: '' }, { DATABASE_ADMIN_URL: 'malformed' }]) {
    assert.throws(() => migrationConnection(environment), /dedicated DATABASE_ADMIN_URL/);
  }
  const invalid = [
    url => { url.username = 'shadowbridge_api'; },
    url => { url.username = 'shadowbridge_sessions'; },
    url => { url.hostname = '127.0.0.1'; },
    url => { url.pathname = '/other'; },
    url => { url.href = url.href.replace(/^postgres:/, 'http:'); },
    url => { url.password = randomBytes(2).toString('hex'); },
    url => { url.port = '5433'; },
    url => { url.searchParams.set('sslmode', 'disable'); },
    url => { url.searchParams.set('sslmode', 'require'); },
    url => { url.searchParams.delete('sslrootcert'); },
    url => { url.searchParams.set('sslrootcert', '/untrusted.crt'); },
    url => { url.searchParams.set('ssl', 'false'); },
  ];
  for (const mutate of invalid) {
    const url = connection(); mutate(url);
    assert.throws(() => migrationConnection({ DATABASE_ADMIN_URL: url.href }), /private DBA endpoint and verified TLS/);
  }
});

test('empty, prefix and full matching provenance permit an idempotent upgrade', async () => {
  const sources = await migrationSources();
  assert.doesNotThrow(() => validateApplied(sources, []));
  assert.doesNotThrow(() => validateApplied(sources, sources.slice(0, 10)));
  assert.doesNotThrow(() => validateApplied(sources, sources));
});

test('modified migration provenance is refused', async () => {
  const sources = await migrationSources();
  const changed = [{ ...sources[0], sha256: '0'.repeat(64) }];
  assert.throws(() => validateApplied(sources, changed), /was modified/);
});

test('newer and gapped database histories are refused', async () => {
  const sources = await migrationSources();
  assert.throws(() => validateApplied(sources, [...sources, { name: '202610210012_future.sql', sha256: '0'.repeat(64) }]), /do not downgrade/);
  assert.throws(() => validateApplied(sources, [sources[0], sources[2]]), /contains a gap/);
});

test('incomplete, misnumbered and nontransactional source histories are refused', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shadowbridge-migrator-guard-'));
  try {
    await assert.rejects(migrationSources(directory), /complete migration history/);
    for (let sequence = 1; sequence <= 11; sequence++) {
      const name = `20261020${String(sequence).padStart(4, '0')}_fixture.sql`;
      await writeFile(path.join(directory, name), 'BEGIN;\nSELECT 1;\nCOMMIT;\n');
    }
    assert.equal((await migrationSources(directory)).length, 11);
    await writeFile(path.join(directory, '202610200005_fixture.sql'), 'SELECT 1;\n');
    await assert.rejects(migrationSources(directory), /explicit transaction/);
    await writeFile(path.join(directory, '202610200005_fixture.sql'), 'BEGIN;\nCOMMIT;\n');
    await rm(path.join(directory, '202610200001_fixture.sql'));
    await writeFile(path.join(directory, '202610200012_fixture.sql'), 'BEGIN;\nCOMMIT;\n');
    await assert.rejects(migrationSources(directory), /uninterrupted, ordered history/);
  } finally { await rm(directory, { recursive: true }); }
});
