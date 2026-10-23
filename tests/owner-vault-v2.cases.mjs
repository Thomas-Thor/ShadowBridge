// Extension of the isolated V1 harness. No production/local-owner config loaded.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { migrationSources } from '../scripts/staging-migrate.mjs';

export async function runWorkspaceTests(ctx) {
  const { root, directory, compose, admin, db, actors, h, phase, result, record, intake, fingerprint, denied } = ctx;
  const base = '/api/owner/vault', w = base + '/workspace', owner = actors.owner;
  const request = async (url, options = {}) => (await owner.client.request(url, { expected: 200, ...options })).data;
  const contactEdit = c => ({ fullName: c.full_name, title: c.title, workEmail: c.work_email, emailKind: c.email_kind, professionalUrl: c.professional_url });
  const companyEdit = c => ({ name: c.name, sector: c.sector, website: c.website, verificationStatus: c.verification_status });
  const getContact = async id => (await request(`${w}/contacts/${id}`)).items[0];
  const getCompany = async id => (await request(`${w}/companies/${id}`)).items[0];
  const legacyFingerprint = async () => (await admin.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(b)-'version'-'updated_at' ORDER BY id)::text,'[]')) AS hash FROM owner_vault.companies b")).rows[0].hash;
  const immutableFingerprint = async () => (await admin.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'[]')) AS hash FROM owner_vault.intakes i")).rows[0].hash;
  const vaultFingerprints = async () => {
    const hashes = {};
    for (const t of ['agents', 'companies', 'contacts', 'identity_keys', 'intakes', 'events']) hashes[t] = (await admin.query(`SELECT md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS hash FROM (SELECT to_jsonb(t)::text AS value FROM owner_vault.${t} t) rows`)).rows[0].hash;
    return hashes;
  };
  let a, b, company, changedIntake, conflictIntake;
  await phase('V2 backup + migration 016→017 preserve existing Vault, accounts, sessions and MFA', async () => {
    const before = await fingerprint(), legacy = await legacyFingerprint(), originals = await immutableFingerprint(), allVault = await vaultFingerprints();
    const pgid = compose(['ps', '-q', 'postgres']);
    const dump = execFileSync('docker', ['--context', 'default', 'exec', pgid, 'pg_dump', '-U', 'postgres', '-d', 'shadowbridge', '-Fc'], { maxBuffer: 20 * 1024 * 1024 });
    await writeFile(path.join(directory, 'before-017.dump'), dump, { mode: 0o600, flag: 'wx' });
    const migration = (await migrationSources()).at(-1); assert.match(migration.name, /0017_owner_vault_workspace/);
    await admin.query(migration.sql.replace(/COMMIT;\s*$/, `INSERT INTO shadowbridge_migrations.applied(name,sha256) VALUES('${migration.name}','${migration.sha256}');COMMIT;`));
    assert.deepEqual(await fingerprint(), before); assert.equal(await legacyFingerprint(), legacy); assert.equal(await immutableFingerprint(), originals);
    assert.deepEqual(await vaultFingerprints(), allVault, 'All pre-existing Vault table fingerprints remain exactly equal');
    assert.equal((await admin.query('SELECT count(*) FROM shadowbridge_migrations.applied')).rows[0].count, '17');
    result.backup017 = { created: true, bytes: dump.length, contents: 'fictional fixture only', productionDatabaseModified: false };
  });
  await phase('V2 real OWNER+MFA gate, all nine other roles denied and SQL ACL/RLS maintained', async () => {
    await new h.Client().request(w + '/statistics', { expected: 401 });
    const noMfa = new h.Client(); await noMfa.signIn(owner); await noMfa.request(w + '/statistics', { expected: 403 });
    for (const [role, actor] of Object.entries(actors)) if (role !== 'owner') {
      for (const url of ['/statistics', '/contacts', '/companies', '/intakes', '/history']) await actor.client.request(w + url, { expected: 403 });
      await denied(() => db.asUser({ ...actor.user, mfaVerifiedAt: Math.floor(Date.now() / 1000) }, { aal: 'aal2' }, tx => tx.query("SELECT owner_vault.read_workspace('contacts')")));
      await denied(() => db.asUser({ ...actor.user, mfaVerifiedAt: Math.floor(Date.now() / 1000) }, { aal: 'aal2' }, tx => tx.query("SELECT owner_vault.resolve_intake($1,'dismiss',NULL,1,'FICTIONAL denied review')", [randomUUID()])));
    }
    assert.equal((await admin.query("SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_vault' AND c.relkind='r'")).rows[0].ok, true);
    for (const role of ['shadowbridge_api', 'shadowbridge_vault_ingest', 'shadowbridge_sentinel', 'shadowbridge_policy', 'shadowbridge_sessions']) {
      await admin.query('BEGIN;SET LOCAL ROLE ' + role);
      await denied(() => admin.query('SELECT * FROM owner_vault.changes')); await admin.query('ROLLBACK');
    }
    await admin.query('BEGIN;GRANT SELECT ON owner_vault.changes,owner_vault.resolutions TO shadowbridge_api;SET LOCAL ROLE shadowbridge_api');
    await admin.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.aal','aal2',true)", [actors.general_director.user.id]);
    assert.equal((await admin.query('SELECT count(*) FROM owner_vault.changes')).rows[0].count, '0');
    await admin.query('ROLLBACK');
  });
  await phase('V2 bounded lists, source provenance, independent company details, filters and search', async () => {
    const alpha = record('v2-alpha', 'V2-COMPANY', 'v2-alpha@fictional.invalid', 'individual', 'https://profile.invalid/v2-alpha'); alpha.contact.fullName = 'FICTIONAL V2 Alpha'; alpha.source.url = 'https://source.invalid/v2-alpha';
    const beta = record('v2-beta', 'V2-COMPANY', 'v2-beta@fictional.invalid', 'individual', 'https://profile.invalid/v2-beta'); beta.contact.fullName = 'FICTIONAL V2 Beta';
    await intake(alpha); await intake(beta);
    a = (await request(w + '/contacts?q=FICTIONAL%20V2%20Alpha')).items[0]; b = (await request(w + '/contacts?q=FICTIONAL%20V2%20Beta')).items[0];
    company = await getCompany(a.company_id); assert.equal(company.contact_count, 2); assert.equal(company.verification_status, 'unconfirmed');
    assert.equal(a.source_url, alpha.source.url); assert.equal(a.country, 'NO');
    assert.equal((await request(`${w}/contacts?companyId=${company.id}`)).total, 2);
    const first = await request(w + '/contacts?limit=1&page=1'), next = await request(w + '/contacts?limit=1&page=2');
    assert.equal(first.items.length, 1); assert.notEqual(first.items[0].id, next.items[0].id);
    assert.equal((await request(w + '/companies?country=DE&q=V2-COMPANY')).total, 0);
    for (const url of ['/contacts?limit=51', '/companies?page=0', '/intakes?period=overnight', '/contacts?companyId=bad', '/contacts?q=a&q=b', '/contacts?owner=true']) await owner.client.request(w + url, { expected: 400 });
    assert.equal((await request(w + '/contacts?q=%27%20OR%201%3D1--')).total, 0);
    assert.equal((await request(`${w}/companies/${randomUUID()}`)).total, 0);
  });
  await phase('V2 real versioned edits, conflict prevention, CSRF, fresh MFA and immutable change evidence', async () => {
    const reason = 'FICTIONAL documented independent correction; no real information.';
    await owner.client.request(`${base}/contacts/${a.id}`, { method: 'PATCH', body: { data: contactEdit(a), version: a.version, reason }, csrf: false, expected: 403 });
    for (const actor of Object.values(actors).filter(x => x !== owner)) await actor.client.request(`${base}/contacts/${a.id}`, { method: 'PATCH', body: { data: contactEdit(a), version: a.version, reason }, expected: 403 });
    await denied(() => db.asUser({ ...owner.user, mfaVerifiedAt: Math.floor(Date.now() / 1000) - 600 }, { aal: 'aal2' }, tx => tx.query('SELECT owner_vault.edit_record($1,$2,$3,$4,$5)', ['contact', a.id, contactEdit(a), a.version, reason])));
    await owner.client.request(`${base}/contacts/${a.id}`, { method: 'PATCH', body: { data: { ...contactEdit(a), workEmail: b.work_email }, version: a.version, reason }, expected: 409 });
    await owner.client.request(`${base}/contacts/${a.id}`, { method: 'PATCH', body: { data: { ...contactEdit(a), companyId: b.company_id }, version: a.version, reason }, expected: 400 });
    const results = await Promise.all(['FICTIONAL Director', 'FICTIONAL Manager'].map(title => owner.client.request(`${base}/contacts/${a.id}`, { method: 'PATCH', body: { data: { ...contactEdit(a), title }, version: a.version, reason }, expected: [200, 409] })));
    assert.deepEqual(results.map(x => x.status).sort(), [200, 409]); a = await getContact(a.id);
    assert.equal(a.version, 2);
    const c = { ...companyEdit(company), sector: 'FICTIONAL reviewed machinery', verificationStatus: 'review_required' };
    await owner.client.request(`${base}/companies/${company.id}`, { method: 'PATCH', body: { data: c, version: company.version, reason }, expected: 200 });
    await owner.client.request(`${base}/companies/${company.id}`, { method: 'PATCH', body: { data: c, version: company.version, reason }, expected: 409 });
    company = await getCompany(company.id); assert.equal(company.version, 2); assert.equal(company.verification_status, 'review_required');
    await owner.client.request(`${base}/contacts/${a.id}/review`, { method: 'POST', body: { status: 'confirmed', version: a.version, reason }, expected: 200 }); a = await getContact(a.id);
    assert.equal(a.verification_status, 'confirmed'); assert.equal((await getCompany(company.id)).verification_status, 'review_required');
    const changes = await request(`${w}/history/${a.id}`); assert.equal(changes.total, 2); assert(changes.items.every(x => x.resource_id === a.id)); assert(changes.items.some(x => x.before_data.verification_status === 'unconfirmed' && x.after_data.verification_status === 'confirmed'));
    await admin.query('BEGIN;SET LOCAL ROLE shadowbridge_vault_executor');
    await admin.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.aal','aal2',true)", [actors.general_director.user.id]);
    assert.equal((await admin.query('SELECT count(*) FROM owner_vault.changes')).rows[0].count, '0');
    await admin.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner.user.id]);
    assert(Number((await admin.query('SELECT count(*) FROM owner_vault.changes')).rows[0].count) >= 3);
    await admin.query("SELECT set_config('request.jwt.claim.aal','aal1',true)");
    assert.equal((await admin.query('SELECT count(*) FROM owner_vault.changes')).rows[0].count, '0');
    await admin.query('ROLLBACK');
    await denied(() => admin.query('UPDATE owner_vault.changes SET reason=reason')); await denied(() => admin.query('DELETE FROM owner_vault.changes')); await denied(() => admin.query('TRUNCATE owner_vault.resolutions'));
    assert.equal((await admin.query("SELECT count(*) FROM sb.audit_events WHERE resource LIKE 'owner_vault.%'")).rows[0].count, '0');
  });
  await phase('V2 review decisions preserve original intakes and prevent conflicting merges', async () => {
    const p = record('v2-alpha', 'V2-COMPANY', a.work_email, 'individual', a.professional_url); p.contact.fullName = 'FICTIONAL V2 changed evidence';
    await intake(p); const conflict = structuredClone(p); conflict.source.recordId = 'v2-alpha'; conflict.contact.professionalUrl = b.professional_url; await intake(conflict);
    const list = await request(w + '/intakes?queue=open');
    changedIntake = list.items.find(x => x.payload.contact?.fullName === p.contact.fullName && x.candidates.length === 1);
    conflictIntake = list.items.find(x => x.payload.contact?.fullName === p.contact.fullName && x.candidates.length === 2);
    assert(changedIntake && conflictIntake);
    const before = await immutableFingerprint(), aBefore = await getContact(a.id);
    const reason = 'FICTIONAL reviewed source evidence; manual decision without modifying existing identities.';
    await owner.client.request(`${base}/intakes/${conflictIntake.id}/resolve`, { method: 'POST', body: { decision: 'link_existing', contactId: a.id, version: 1, reason }, expected: 409 });
    await owner.client.request(`${base}/intakes/${changedIntake.id}/resolve`, { method: 'POST', body: { decision: 'link_existing', contactId: randomUUID(), version: 1, reason }, expected: 400 });
    const prior = await request(w + '/statistics');
    await owner.client.request(`${base}/intakes/${changedIntake.id}/resolve`, { method: 'POST', body: { decision: 'link_existing', contactId: a.id, version: 1, reason }, expected: 200 });
    await owner.client.request(`${base}/intakes/${changedIntake.id}/resolve`, { method: 'POST', body: { decision: 'dismiss', version: 1, reason }, expected: 409 });
    await owner.client.request(`${base}/intakes/${conflictIntake.id}/resolve`, { method: 'POST', body: { decision: 'dismiss', version: 1, reason }, expected: 200 });
    assert.equal(await immutableFingerprint(), before); assert.deepEqual(await getContact(a.id), aBefore);
    const after = await request(w + '/statistics'); assert.equal(after.duplicatesPrevented, prior.duplicatesPrevented + 1); assert.equal(after.reviewRequired, prior.reviewRequired - 2);
    const duplicates = await request(w + '/intakes?status=duplicate_prevented'); assert.equal(duplicates.total, after.duplicatesPrevented);
    const resolved = await request(w + '/intakes?queue=resolved'); assert.equal(resolved.total, 2); assert(resolved.items.every(x => x.review_version === 2 && x.resolution.reason === reason));
  });
  await phase('V2 real statistics, clickable-list equivalence and Oslo overnight 13/15h boundaries', async () => {
    const stats = await request(w + '/statistics'); assert.equal(stats.companies, (await request(w + '/companies')).total); assert.equal(stats.contacts, (await request(w + '/contacts')).total);
    assert.equal(stats.newRecordsOvernight, stats.newCompaniesOvernight + stats.newContactsOvernight);
    assert.equal((await request(w + '/contacts?period=overnight')).total, stats.newContactsOvernight);
    assert.equal((await request(w + '/companies?period=overnight')).total, stats.newCompaniesOvernight);
    const asOwner = fn => db.asUser({ ...owner.user, mfaVerifiedAt: Math.floor(Date.now() / 1000) }, { aal: 'aal2' }, fn);
    for (const [at, hours] of [['2026-03-29T10:00:00Z', 13], ['2026-10-25T10:00:00Z', 15]]) {
      const s = (await asOwner(tx => tx.query('SELECT owner_vault.workspace_statistics($1) AS s', [at]))).rows[0].s;
      assert.equal((Date.parse(s.overnight.end) - Date.parse(s.overnight.start)) / 3600000, hours);
    }
    const early = (await asOwner(tx => tx.query("SELECT owner_vault.workspace_statistics('2026-10-25T04:00:00Z') AS s"))).rows[0].s;
    assert.equal(early.overnight.end, '2026-10-24T06:00:00+00:00');
    await owner.client.request(w + '/statistics?at=2026-01-01', { expected: 400 });
  });
  await phase('V2 real Chromium desktop/mobile: sign-in+MFA, cards, navigation, editing, privacy and logout', async () => {
    const require = createRequire(import.meta.url), { loadTestDependency } = require('./dependencies.cjs');
    const { chromium, expect } = loadTestDependency('@playwright/test');
    const { default: AxeBuilder } = loadTestDependency('@axe-core/playwright');
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--disable-dev-shm-usage'], env: { ...process.env, XDG_CACHE_HOME: path.join(directory, 'browser-cache') } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const origin = process.env.SHADOWBRIDGE_TEST_URL;
    try {
      await page.goto(origin + '/member-sign-in/'); await page.locator('#sign-in-form [name=email]').fill(owner.email); await page.locator('#sign-in-form [name=password]').fill(owner.password);
      await page.locator('#sign-in-form button[type=submit]').click(); await page.waitForURL('**/portal/');
      await page.goto(origin + '/portal/admin/?module=vault'); await expect(page.getByRole('heading', { name: 'Management security verification' })).toBeVisible();
      await page.getByLabel('Six-digit authenticator code').fill(h.totp(owner.mfaSecret)); await page.getByRole('button', { name: 'Verify second factor', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Private companies', exact: true })).toBeVisible();
      await page.goto(origin + '/portal/admin/'); await expect(page.locator('[data-vault-kpi]')).toHaveCount(4);
      for (const [key, heading] of [['companies', 'Private companies'], ['contacts', 'Private business contacts'], ['duplicatesPrevented', 'Duplicates prevented — intake history'], ['newRecordsOvernight', 'Overnight contacts']]) {
        await page.locator(`[data-vault-kpi=${key}]`).click(); await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible(); await page.goto(origin + '/portal/admin/');
      }
      await page.goto(origin + `/portal/admin/?module=vault&view=contacts&id=${a.id}`);
      await expect(page.getByRole('heading', { name: 'Contact details', exact: true })).toBeVisible();
      await page.getByText('Edit contact — identity keys remain protected', { exact: true }).click();
      const editor = page.locator('.vault-editor').first(); await editor.getByLabel('Position', { exact: true }).fill('FICTIONAL browser-edited manager');
      await editor.getByLabel('Reason and evidence for this decision (10–500 characters)').fill('FICTIONAL UI test: independently reviewed correction.');
      await editor.getByRole('button', { name: 'Save reviewed change' }).click();
      await expect(page.locator('.vault-facts').first()).toContainText('FICTIONAL browser-edited manager');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      }
      const accessibility = await new AxeBuilder({ page }).include('.dashboard-layout').withTags(['wcag2a', 'wcag2aa']).analyze();
      assert.deepEqual(accessibility.violations.map(x => ({ id: x.id, impact: x.impact })), []);
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
      // Only fictional records; never capture the MFA gate or credentials.
      await page.evaluate(() => document.activeElement?.blur());
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(directory, 'vault-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(directory, 'vault-mobile.png'), fullPage: true });
      const other = await context.newPage(); await other.goto(origin + '/portal/admin/?module=vault'); await expect(other.locator('[data-owner-vault]')).toBeVisible();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(other.locator('[data-owner-vault]')).toHaveCount(0);
      for (const role of Object.keys(actors).filter(x => x !== 'owner')) {
        const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
        try {
          await c.addCookies([...actors[role].client.cookies].map(([name, value]) => ({ name, value, url: origin, sameSite: 'Lax' })));
          const p = await c.newPage(), requests = []; p.on('request', r => { if (new URL(r.url()).pathname.startsWith(base)) requests.push(r.url()); });
          await p.goto(origin + '/portal/admin/?module=vault'); await expect(p.locator('#portal-status')).toContainText(role === 'buyer' || role === 'supplier' || role === 'partner' ? 'Management authorization required.' : 'Module unavailable.');
          assert.equal(await p.locator('[data-owner-vault], [data-command-module=vault]').count(), 0); assert.equal(requests.length, 0);
        } finally { await c.close(); }
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); await browser.close(); }
  });
  await phase('V2 bounded read budget rejects excess requests without blocking a different verified account', async () => {
    let limited = false;
    for (let i = 0; i <= 240; i++) {
      const r = await actors.staff_analyst.client.request(w + '/statistics', { expected: [403, 429] });
      if (r.status === 429) { limited = true; break; }
    }
    assert(limited); await request(w + '/statistics');
  });
  const disk = await statfs(root);
  result.workspaceV2 = { mockResponses: false, realBrowser: true, productionDeployed: false, operatorAccountVerified: false, freeBytesAfter: disk.bavail * disk.bsize,
    migrationHash: createHash('sha256').update(await readFile(path.join(root, 'supabase/migrations/202610230017_owner_vault_workspace.sql'))).digest('hex') };
}
