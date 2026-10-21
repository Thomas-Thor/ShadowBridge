// Operator-run REAL H2-A registration regression. Uses only an explicitly
// isolated local fixture, real GoTrue/Mailpit/PostgreSQL/API and browser forms.
// No Auth responses, identities or SQL results are mocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkStaging, repositoryRoot } from '../scripts/staging-prepare.mjs';

const args = process.argv.slice(2);
const directoryArg = args.find(value => value.startsWith('--dir='))?.slice(6);
assert.ok(directoryArg, 'An explicit fresh isolated --dir is required');
const checked = await checkStaging({ directory: directoryArg });
assert.match(checked.project, /^shadowbridge-stageg-h1-[a-f0-9]{10}$/, 'Only the guarded local H1/H2 fixture is accepted');
const directory = checked.directory;
const fixture = JSON.parse(await readFile(path.join(directory, 'h1-fixture.json'), 'utf8'));
assert.equal(fixture.kind, 'shadowbridge-h1-isolated-auth');
assert.equal(fixture.project, checked.project);
assert.match(fixture.snapshot, /^\/tmp\/shadowbridge-h1-source-[a-f0-9]{10}$/);
const baseline = args.includes('--baseline-expected-bug');
const sqlOnly = args.includes('--sql-permissions-only');
assert.ok(!(baseline && sqlOnly), 'Baseline and SQL-only modes are separate');
const reportFile = `/tmp/shadowbridge-h2-registration-${baseline ? 'baseline' : sqlOnly ? 'sql-permissions' : 'regression'}.json`;
const results = { kind: 'real-h2-registration', mode: baseline ? 'baseline-reproduction' : sqlOnly ? 'sql-permissions-only' : 'regression', project: checked.project, startedAt: new Date().toISOString(), cases: [], externalEmailSent: false, mocksUsed: false };
for (const name of ['server/app.mjs', 'server/auth.mjs']) results[name] = createHash('sha256').update(await readFile(path.join(fixture.snapshot, name))).digest('hex');
const docker = (parts, options = {}) => execFileSync('docker', ['--context', 'default', ...parts], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const container = service => docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${checked.project}`, '--filter', `label=com.docker.compose.service=${service}`]).trim();
const appContainer = container('app'), pgContainer = container('postgres');
assert.ok(appContainer && pgContainer, 'The dedicated isolated API/database must already be running');
const reviewer = (await readFile(path.join(directory, 'tester-password'), 'utf8')).trim();
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === checked.origin) {
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Basic ' + Buffer.from(`reviewer:${reviewer}`).toString('base64'));
    options = { ...options, headers };
  }
  return realFetch(input, options);
};
const mailProxy = createServer((request, response) => {
  if (request.method !== 'GET' || !/^\/api\/v1\/(?:messages|message\/[a-zA-Z0-9-]+)(?:\?.*)?$/.test(request.url || '')) { response.writeHead(404).end(); return; }
  try {
    const script = `fetch(${JSON.stringify('http://mailpit:8025' + request.url)}).then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`;
    const data = docker(['exec', appContainer, 'node', '-e', script]);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(data);
  } catch { response.writeHead(502).end('{}'); }
});
await new Promise(resolve => mailProxy.listen(0, '127.0.0.1', resolve));
process.env.SHADOWBRIDGE_TEST_URL = checked.origin;
process.env.SHADOWBRIDGE_MAILPIT_URL = `http://127.0.0.1:${mailProxy.address().port}`;
process.env.SHADOWBRIDGE_DB_CONTAINER = pgContainer;
process.env.SHADOWBRIDGE_TEST_DATABASE = 'shadowbridge';
process.env.DOCKER_CONTEXT = 'default';
const h = await import('../server/tests/helpers.mjs');
const require = createRequire(import.meta.url);
const { loadTestDependency } = require('./dependencies.cjs');
const { chromium, expect } = loadTestDependency('@playwright/test');
let browser, current = 'guarded real fixture readiness';
async function phase(name, work) {
  current = name; await work();
  results.cases.push({ name, result: 'PASS' });
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: ' + name);
}
function actor(role, label) {
  return { role, email: `${h.runId}.${label}@test.shadowbridge.invalid`, password: h.password(), companyName: `FICTIONAL H2 ${h.runId} ${label}`, registrationNumber: `FICTIONAL-${h.runId}-${label}`, profile: { countries: ['NO', 'PL'], sectors: [`FICTIONAL ${label} sector`], summary: `FICTIONAL ${label} complete business profile for isolated H2 regression.` } };
}
function signupBody(value, changes = {}) {
  return { email: value.email, password: value.password, role: value.role, company: { name: value.companyName, registrationNumber: value.registrationNumber, country: 'NO' }, profile: value.profile, ...changes };
}
function stats(value) {
  assert.ok(value.email.endsWith('@test.shadowbridge.invalid'), 'SQL fixtures must remain fictional');
  return JSON.parse(h.db(`SELECT jsonb_build_object('userId',u.id,'count',count(a.id),'roles',coalesce(jsonb_agg(a.requested_role ORDER BY a.created_at) FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb),'companyNames',coalesce(jsonb_agg(c.legal_name ORDER BY a.created_at) FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb),'profiles',coalesce(jsonb_agg(jsonb_build_object('countries',p.countries,'sectors',p.sectors,'summary',p.summary)) FILTER(WHERE p.user_id IS NOT NULL),'[]'::jsonb)) FROM auth.users u LEFT JOIN sb.applications a ON a.user_id=u.id LEFT JOIN sb.companies c ON c.id=a.company_id LEFT JOIN sb.professional_profiles p ON p.user_id=u.id WHERE lower(u.email)=${h.sqlLiteral(value.email.toLowerCase())} GROUP BY u.id`));
}
function applicationIntact(value) {
  const record = stats(value);
  assert.equal(record.count, 1, 'Exactly one company application must exist');
  assert.ok(JSON.stringify(record.roles) === JSON.stringify([value.role]), 'The original application role changed');
  assert.ok(JSON.stringify(record.companyNames) === JSON.stringify([value.companyName]), 'The original company changed');
  assert.deepEqual(record.profiles[0], { countries: value.profile.countries, sectors: value.profile.sectors, summary: value.profile.summary }, 'The complete original business profile changed');
  return record;
}
async function newContext() {
  return browser.newContext({ baseURL: checked.origin, httpCredentials: { username: 'reviewer', password: reviewer }, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' });
}
async function browserSignup(page, value) {
  await page.goto(`/apply/${value.role}/`);
  const form = page.locator('#application-form');
  await expect(form.locator('[name=email]')).toBeEnabled();
  const fields = { companyName: value.companyName, country: 'NO', registrationNumber: value.registrationNumber, email: value.email, password: value.password, passwordConfirm: value.password, countries: value.profile.countries.join(', '), sectors: value.profile.sectors.join(', '), summary: value.profile.summary };
  for (const [name, data] of Object.entries(fields)) await form.locator(`[name=${name}]`).fill(data);
  await form.locator('[name=acknowledgement]').check();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST');
  await form.locator('button[type=submit]').click();
  assert.equal((await saved).status(), 202);
  await expect(page.locator('#application-status')).toContainText('Check your email.');
}
async function browserResumeOriginal(value, forbiddenCompany) {
  const context = await newContext();
  try {
    const page = await context.newPage();
    await page.goto('/member-sign-in/');
    const login = page.locator('#sign-in-form');
    await expect(login.locator('[name=email]')).toBeEnabled();
    await login.locator('[name=email]').fill(value.email);
    await login.locator('[name=password]').fill(value.password);
    await login.locator('button[type=submit]').click();
    await expect(page.locator('#portal-account')).toContainText(value.email);
    await expect(page.getByRole('heading', { name: 'Resume your original application', exact: true })).toBeVisible();
    await expect(page.locator('#portal-content')).not.toContainText(forbiddenCompany);
    // Saved roles are immutable choices; an arbitrary replacement role form
    // must not be offered for a recoverable, conflicting legacy application.
    await expect(page.locator('#portal-content select[name=role]')).toHaveCount(0);
    const card = page.locator('.portal-record').filter({ has: page.getByRole('heading', { name: `B2B Partner — ${value.companyName}`, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(value.profile.summary);
    await card.locator('[name=acknowledgement]').check();
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/application/resume' && response.request().method() === 'POST');
    await card.getByRole('button', { name: 'Resume this application', exact: true }).click();
    assert.equal((await submitted).status(), 200);
    await expect(page.locator('#portal-status')).toContainText('Application under review.');
    await expect(page.getByRole('heading', { name: 'Resume your original application', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
}
async function register(value, client = new h.Client()) {
  await client.request('/api/auth/register', { method: 'POST', body: signupBody(value), expected: 202 });
  return client;
}
async function repeatSignup(client, input, accepted) {
  const deadline = Date.now() + 75_000;
  let announced = false;
  for (;;) {
    const response = await client.request('/api/auth/register', { method: 'POST', body: input });
    if (response.status !== 429) {
      assert.ok(accepted.includes(response.status), `Repeated signup returned HTTP ${response.status}`);
      return response;
    }
    // Respect real provider resend throttling; a refused attempt alone would
    // not test whether an accepted duplicate can overwrite the original role.
    assert.ok(Date.now() < deadline, 'Real signup cooldown did not expire within the bounded test window');
    if (!announced) { console.log('WAIT: respecting the real email-provider signup cooldown.'); announced = true; }
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
}
async function providerConfirm(value) {
  const url = h.confirmationLink(await h.waitForMessage(value.email));
  const token = url.searchParams.get('token_hash') || url.searchParams.get('token');
  assert.ok(token && url.origin === checked.origin, 'Only the captured fictional signup confirmation is accepted');
  const code = `fetch('https://auth-proxy:8444/auth/v1/verify',{method:'POST',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_ANON_KEY},body:JSON.stringify({token_hash:${JSON.stringify(token)},type:'signup'})}).then(async r=>{if(!r.ok)process.exit(1);const p=await r.json();if(!p.user?.email_confirmed_at)process.exit(2);process.stdout.write('VERIFIED')}).catch(()=>process.exit(1))`;
  assert.equal(docker(['exec', '-i', appContainer, 'node', '--input-type=module', '-'], { input: code, stdio: ['pipe', 'pipe', 'pipe'] }), 'VERIFIED', 'The real provider must confirm the email without creating a BFF application yet');
}
async function authOnly(value) {
  // Legacy fixtures use a genuine Auth signup with no new intake marker. Never
  // set email_confirmed_at in SQL; the actual captured link must still verify.
  const code = `fetch('https://auth-proxy:8444/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_ANON_KEY},body:JSON.stringify(${JSON.stringify({ email: value.email, password: value.password })})}).then(async r=>{if(!r.ok)process.exit(1);await r.arrayBuffer();process.stdout.write('CREATED')}).catch(()=>process.exit(1))`;
  assert.equal(docker(['exec', '-i', appContainer, 'node', '--input-type=module', '-'], { input: code, stdio: ['pipe', 'pipe', 'pipe'] }), 'CREATED', 'A real legacy Auth identity must be created');
}
function legacyIntent(value, { expired = false } = {}) {
  const id = randomBytes(32).toString('hex');
  const payload = { role: value.role, company: { legal_name: value.companyName, registration_number: value.registrationNumber, country: 'NO' }, professional: value.profile };
  h.db(`INSERT INTO sb.registration_intents(token_hash,email,payload,expires_at) VALUES(${h.sqlLiteral(id)},${h.sqlLiteral(value.email)},${h.sqlLiteral(JSON.stringify(payload))}::jsonb,now()+interval '${expired ? '-2 days' : '1 hour'}')`);
  return id;
}
function legacyFingerprint(email) {
  return h.db(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY token_hash)::text,'[]')) FROM sb.registration_intents t WHERE lower(email)=${h.sqlLiteral(email.toLowerCase())}`);
}
async function verifySqlPermissions() {
  const verified = h.db("SELECT u.id FROM auth.users u JOIN sb.applications a ON a.user_id=u.id WHERE u.email LIKE '%@test.shadowbridge.invalid' AND u.email_confirmed_at IS NOT NULL ORDER BY u.created_at LIMIT 1");
  assert.match(verified, /^[a-f0-9-]{36}$/, 'A previously verified fictional identity is required');
  const unverified = actor('buyer', 'sql-unverified');
  await register(unverified);
  const unverifiedId = stats(unverified).userId;
  function denied(role, statement, subject = verified, before = '') {
    assert.ok(['shadowbridge_api', 'shadowbridge_sessions', 'shadowbridge_policy'].includes(role));
    const sql = `BEGIN; ${before} SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub',${h.sqlLiteral(subject)},true); ${statement}; ROLLBACK;`;
    assert.throws(() => h.db(sql), /permission denied|Verified active account required|Original registration draft is immutable|42501/i, 'The restricted SQL action must fail, rather than merely return no UI data');
  }
  for (const role of ['shadowbridge_api', 'shadowbridge_sessions']) {
    for (const table of ['registration_intakes', 'registration_drafts']) {
      denied(role, `SELECT count(*) FROM sb.${table}`);
      // WHERE false tests the SQL privilege without modifying even a fixture.
      denied(role, `UPDATE sb.${table} SET payload='{}'::jsonb WHERE false`);
    }
  }
  for (const expression of ['sb.registration_draft_state()', 'sb.consume_registration_draft(NULL)']) {
    denied('shadowbridge_sessions', `SELECT ${expression}`);
    denied('shadowbridge_api', `SELECT ${expression}`, unverifiedId);
    denied('shadowbridge_api', `SELECT ${expression}`, '');
    // Prepare only this fictional account's suspended state with the DBA in a
    // rollback-only transaction; restore the existing status guard BEFORE the
    // runtime function executes. The application must not be able to perform
    // this fixture setup itself, nor bypass the registration authorization.
    denied('shadowbridge_api', `SELECT ${expression}`, verified, `ALTER TABLE sb.accounts DISABLE TRIGGER account_status_guard; UPDATE sb.accounts SET status='suspended' WHERE user_id=${h.sqlLiteral(verified)}::uuid; ALTER TABLE sb.accounts ENABLE TRIGGER account_status_guard;`);
  }
  assert.equal(h.db(`SELECT status FROM sb.accounts WHERE user_id=${h.sqlLiteral(verified)}::uuid`), 'active', 'The temporary suspension must roll back');
  assert.equal(h.db("SELECT tgenabled FROM pg_trigger WHERE tgrelid='sb.accounts'::regclass AND tgname='account_status_guard'"), 'O', 'The account-status guard must remain enabled');
  for (const expression of ['sb.registration_draft_state()', 'sb.consume_registration_draft(NULL)']) {
    const sql = `BEGIN; SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${h.sqlLiteral(verified)},true); SELECT ${expression}; ROLLBACK;`;
    const output = h.db(sql).split('\n').at(-1);
    assert.deepEqual(JSON.parse(output), { state: 'submitted' }, 'A verified own identity receives only its submitted state');
  }
  denied('shadowbridge_policy', `UPDATE sb.registration_drafts SET payload=jsonb_set(payload,'{role}','"supplier"'::jsonb) WHERE user_id=${h.sqlLiteral(unverifiedId)}::uuid`, unverifiedId);
  assert.equal(stats(unverified).count, 0, 'SQL denial must not create an unverified application');
  assert.equal(h.db("SELECT count(*)=1 AND bool_and(d.payload=i.payload AND d.payload->>'role'='partner' AND (SELECT count(*) FROM sb.registration_intakes attempts WHERE attempts.email=u.email)>=2) FROM sb.registration_drafts d JOIN auth.users u ON u.id=d.user_id JOIN sb.registration_intakes i ON i.token_hash=d.intake_hash WHERE u.email LIKE '%.duplicate-role@test.shadowbridge.invalid'"), 't', 'An accepted duplicate must remain bound to the original Partner intake, regardless of mutable provider metadata');
  results.sqlChecks = 23;
}
try {
  const certificate = new X509Certificate(await readFile(path.join(directory, 'certs/public.crt')));
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] });
  await phase('real TLS/reviewer/API readiness and isolated fixture guard', async () => {
    assert.equal((await realFetch(checked.origin + '/api/config')).status, 401);
    assert.equal((await fetch(checked.origin + '/api/config')).status, 200);
  });
  if (sqlOnly) {
    await phase('real SQL table privileges, immutable drafts and verified active own-identity function guards', verifySqlPermissions);
    results.result = 'PASS';
  } else {
  const trio = [actor('buyer', 'three-buyer'), actor('supplier', 'three-supplier'), actor('partner', 'three-partner')];
  current = 'three browser registrations and out-of-order confirmations';
  const context = await newContext();
  try {
    const page = await context.newPage();
    for (const value of trio) await browserSignup(page, value);
    for (const index of [1, 0, 2]) {
      const value = trio[index];
      const link = h.confirmationLink(await h.waitForMessage(value.email));
      await page.goto(link.href);
      await expect(page.locator('#portal-account')).toContainText(value.email);
      assert.equal((await (await page.request.get('/api/session')).json()).user.emailVerified, true);
    }
    const counts = trio.map(value => stats(value).count);
    results.observedApplicationCounts = counts;
    if (baseline) {
      assert.ok(JSON.stringify(counts) === JSON.stringify([0, 0, 1]), 'The expected old-cookie failure was not reproduced');
      results.result = 'BUG_REPRODUCED';
      results.cases.push({ name: current, result: 'BUG_REPRODUCED', missingApplications: 2 });
      console.log('REPRODUCED: three real registrations, only the last application exists.');
    } else {
      for (const value of trio) applicationIntact(value);
      results.cases.push({ name: current, result: 'PASS' });
      console.log('PASS: three real browser registrations keep three independent original applications.');
    }
  } finally { await context.close(); }
  if (!baseline) {
    await phase('confirmation in a fresh browser without registration cookies preserves the original role', async () => {
      const value = actor('partner', 'cross-browser'); await register(value);
      const replacement = new h.Client();
      await h.confirmMessage(replacement, await h.waitForMessage(value.email));
      const session = (await replacement.request('/api/session', { expected: 200 })).data.user;
      assert.equal(session.emailVerified, true); applicationIntact(value);
      await replacement.request('/api/application', { method: 'POST', body: { role: 'supplier', company: signupBody(value).company, profile: value.profile }, expected: [409, 403] });
      applicationIntact(value);
      await replacement.request('/api/admin/applications', { expected: 403 });
    });
    await phase('a duplicate unconfirmed signup cannot replace the first Partner application with Supplier', async () => {
      const value = actor('partner', 'duplicate-role'); await register(value);
      const duplicate = new h.Client();
      await repeatSignup(duplicate, signupBody(value, { role: 'supplier', company: { name: 'FICTIONAL ATTEMPTED REPLACEMENT', country: 'PL', registrationNumber: 'FICTIONAL-REPLACEMENT' }, profile: { countries: ['PL'], sectors: ['FICTIONAL replacement'], summary: 'FICTIONAL overwrite attempt.' } }), [202]);
      const verified = new h.Client(); await h.confirmMessage(verified, await h.waitForMessage(value.email));
      applicationIntact(value);
    });
    await phase('parallel first login after real provider confirmation creates exactly one application', async () => {
      const value = actor('buyer', 'concurrent-login'); await register(value);
      await providerConfirm(value);
      assert.equal(stats(value).count, 0, 'A BFF application must not appear before a verified identity is presented to it');
      const first = new h.Client(), second = new h.Client();
      await Promise.all([first.signIn(value), second.signIn(value)]);
      const stored = applicationIntact(value);
      assert.equal(h.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${h.sqlLiteral(stored.userId)} AND action='registration.application_submitted'`), '1', 'Parallel resumption must record exactly one application decision');
      for (const client of [first, second]) assert.equal((await client.request('/api/session', { expected: 200 })).data.user.applicationStatus, 'pending');
    });
    await phase('replayed verified-account signup and missing cookies cannot mutate an existing application', async () => {
      const value = trio[0], before = applicationIntact(value);
      const duplicate = new h.Client();
      await repeatSignup(duplicate, signupBody(value, { role: 'supplier', company: { name: 'FICTIONAL VERIFIED OVERWRITE', country: 'PL', registrationNumber: 'FICTIONAL-VERIFIED-REPLACEMENT' } }), [202, 400, 422]);
      const fresh = new h.Client(); await fresh.signIn(value);
      const after = applicationIntact(value);
      assert.equal(after.userId, before.userId);
      assert.equal((await fresh.request('/api/session', { expected: 200 })).data.user.applicationStatus, 'pending');
      await fresh.request('/api/offers', { expected: 403 });
    });
    await phase('one original legacy intent resumes after real verification without a registration cookie', async () => {
      const value = actor('partner', 'legacy-single'); await authOnly(value); legacyIntent(value);
      const before = legacyFingerprint(value.email), client = new h.Client();
      await h.confirmMessage(client, await h.waitForMessage(value.email));
      applicationIntact(value);
      assert.equal((await client.request('/api/application/draft', { expected: 200 })).data.draft.state, 'submitted');
      assert.equal(legacyFingerprint(value.email), before, 'Legacy intake history must not be deleted or overwritten');
    });
    await phase('conflicting or expired legacy intents require explicit own-account review and reject foreign references', async () => {
      const value = actor('partner', 'legacy-conflict'); await authOnly(value);
      const original = legacyIntent(value, { expired: true });
      const alternative = { ...value, role: 'supplier', companyName: 'FICTIONAL OTHER LEGACY COMPANY', profile: { countries: ['PL'], sectors: ['FICTIONAL alternative'], summary: 'FICTIONAL conflicting legacy role.' } };
      legacyIntent(alternative);
      const before = legacyFingerprint(value.email), client = new h.Client();
      await h.confirmMessage(client, await h.waitForMessage(value.email));
      assert.equal(stats(value).count, 0, 'Conflicting saved roles must not be guessed');
      const draft = (await client.request('/api/application/draft', { expected: 200 })).data.draft;
      assert.equal(draft.state, 'review_required');
      assert.equal(draft.choices.length, 2);
      assert.equal(draft.choices.find(choice => choice.id === original)?.role, 'partner');
      assert.equal(draft.choices.find(choice => choice.id === original)?.expired, true);
      await client.request('/api/application', { method: 'POST', body: { role: 'supplier', company: signupBody(value).company, profile: value.profile }, expected: 409 });
      await client.request('/api/application/resume', { method: 'POST', body: { draftId: original, acknowledged: false }, expected: 400 });
      const anonymous = new h.Client();
      await anonymous.request('/api/application/resume', { method: 'POST', body: { draftId: original, acknowledged: true }, expected: 401 });

      const foreign = actor('supplier', 'legacy-expired-foreign'); await authOnly(foreign);
      const foreignId = legacyIntent(foreign, { expired: true }), foreignBefore = legacyFingerprint(foreign.email), other = new h.Client();
      await h.confirmMessage(other, await h.waitForMessage(foreign.email));
      assert.equal(stats(foreign).count, 0);
      const ownDraft = (await other.request('/api/application/draft', { expected: 200 })).data.draft;
      assert.equal(ownDraft.state, 'review_required');
      assert.equal(ownDraft.choices.length, 1);
      assert.equal(ownDraft.choices[0].id, foreignId);
      assert.equal(JSON.stringify(ownDraft).includes(value.companyName), false, 'Another account must not receive the legacy profile');
      await other.request('/api/application/resume', { method: 'POST', body: { draftId: original, acknowledged: true }, expected: [403, 404] });
      assert.equal(stats(foreign).count, 0);
      await browserResumeOriginal(value, foreign.companyName);
      const selected = applicationIntact(value);
      assert.equal(h.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${h.sqlLiteral(selected.userId)} AND action='registration.legacy_selected' AND metadata->>'role'='partner'`), '1', 'The explicit original-role selection must be audited');
      await other.request('/api/application/resume', { method: 'POST', body: { draftId: foreignId, acknowledged: true }, expected: 200 });
      applicationIntact(foreign);
      assert.equal(legacyFingerprint(value.email), before, 'Rejected alternative intake history must remain intact');
      assert.equal(legacyFingerprint(foreign.email), foreignBefore);
    });
    await phase('an old legacy reference cannot replace a newly bound immutable application', async () => {
      const value = actor('partner', 'bound-and-legacy'); await register(value);
      const stale = { ...value, role: 'supplier', companyName: 'FICTIONAL OLD INCOMPATIBLE COMPANY' };
      const id = legacyIntent(stale);
      const client = new h.Client(); await h.confirmMessage(client, await h.waitForMessage(value.email));
      applicationIntact(value);
      // An already submitted application may return the same idempotent result;
      // it must never consume the incompatible legacy choice or change role.
      await client.request('/api/application/resume', { method: 'POST', body: { draftId: id, acknowledged: true }, expected: [200, 403, 409] });
      applicationIntact(value);
    });
    await phase('real SQL table privileges, immutable drafts and verified active own-identity function guards', verifySqlPermissions);
    results.result = 'PASS';
  }
  }
} catch (error) {
  results.result = 'FAIL'; results.failedCase = current; results.errorType = error?.name || 'Error';
  await writeFile(path.join(directory, 'h2-registration-failure.json'), JSON.stringify({ case: current, name: error?.name, message: error?.message, stack: error?.stack }, null, 2) + '\n', { mode: 0o600 });
  console.error(`FAIL: ${current}. Private diagnostic retained; no credentials or request bodies logged.`);
  process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  if (browser) await browser.close();
  await new Promise(resolve => mailProxy.close(resolve));
  globalThis.fetch = realFetch;
}
