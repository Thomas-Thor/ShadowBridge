// Targeted REAL H2-C tests. Only guarded, fictional local H1/H2 fixtures are
// accepted. --policy-rollback-only never commits migration 013 to its database.
import assert from 'node:assert/strict';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { migrationSources } from '../scripts/staging-migrate.mjs';

const args = process.argv.slice(2);
const directoryArg = args.find(value => value.startsWith('--dir='))?.slice(6);
assert.ok(directoryArg, 'An explicit guarded isolated --dir is required');
const checked = await checkStaging({ directory: directoryArg });
assert.match(checked.project, /^shadowbridge-stageg-h1-[a-f0-9]{10}$/);
const directory = checked.directory;
const fixture = JSON.parse(await readFile(path.join(directory, 'h1-fixture.json'), 'utf8'));
assert.equal(fixture.kind, 'shadowbridge-h1-isolated-auth');
assert.equal(fixture.project, checked.project);
assert.match(fixture.snapshot, /^\/tmp\/shadowbridge-h1-source-[a-f0-9]{10}$/);
const generated = await readEnv(path.join(directory, 'compose.env'));
const docker = (parts, options = {}) => execFileSync('docker', ['--context', 'default', ...parts], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const compose = (parts, options = {}) => docker(['compose', '--project-name', checked.project, '--env-file', path.join(directory, 'compose.env'), '-f', path.join(repositoryRoot, 'deploy/staging/compose.yaml'), '-f', path.join(directory, 'h1-override.json'), ...parts], { env: { ...process.env, ...generated }, ...options });
const container = (service, all = false) => docker(['ps', all ? '-aq' : '-q', '--filter', `label=com.docker.compose.project=${checked.project}`, '--filter', `label=com.docker.compose.service=${service}`]).trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const sql = (pg, source) => docker(['exec', '-i', pg, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'shadowbridge'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function policyRollback() {
  // Only this already stopped, fictional fixture may be started here. This
  // mode cannot select the owner project or create/update the real API stack.
  assert.ok(container('postgres', true), 'A previously prepared fictional PostgreSQL container is required');
  assert.equal(container('app'), '', 'API must stay stopped during rollback-only SQL testing');
  assert.equal(container('auth'), '', 'Auth must stay stopped during rollback-only SQL testing');
  const wasRunning = Boolean(container('postgres'));
  const historyMode = args.includes('--history-rollback-only');
  const report = { kind: historyMode ? 'h2c-history-rollback' : 'h2c-policy-rollback', project: checked.project, startedAt: new Date().toISOString(), persistentMigrationApplied: false, externalEmailSent: false, cases: [] };
  let pg;
  try {
    if (!wasRunning) compose(['start', 'postgres']);
    pg = container('postgres'); assert.ok(pg);
    for (let attempt = 0; ; attempt++) {
      try { docker(['exec', pg, 'pg_isready', '-U', 'postgres', '-d', 'shadowbridge']); break; }
      catch { assert.ok(attempt < 10, 'Dedicated fictional PostgreSQL did not become ready'); await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.equal(sql(pg, 'SELECT count(*) FROM shadowbridge_migrations.applied'), '12', 'Only the fictional 001–012 baseline is accepted');
    const backupPath = path.join(directory, `h2c-before013-${Date.now()}.dump`);
    const dump = docker(['exec', pg, 'pg_dump', '-Fc', '-U', 'postgres', '-d', 'shadowbridge'], { encoding: 'buffer' });
    await writeFile(backupPath, dump, { mode: 0o600, flag: 'wx' });
    report.backupCreated = true; report.backupFile = path.basename(backupPath);
    const fingerprintSql = `SELECT jsonb_build_object(
      'policies',(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname)::text) FROM pg_policies p WHERE schemaname IN ('sb','portal')),
      'accounts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.accounts t),
      'users',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.users t),
      'applications',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.applications t),
      'memberships',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.memberships t),
      'profiles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.professional_profiles t),
      'sessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id_hash)::text,'[]')) FROM sb.sessions t),
      'mfa',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.mfa_factors t),
      'roles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,role_key)::text,'[]')) FROM sb.staff_role_assignments t),
      'ledger',(SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY name)::text) FROM shadowbridge_migrations.applied t)
    )::text;`;
    const before = sql(pg, fingerprintSql);
    const migration = await readFile(path.join(repositoryRoot, 'supabase/migrations/202610210013_recruitment_visibility.sql'), 'utf8');
    assert.match(migration, /\bBEGIN;/); assert.match(migration, /COMMIT;\s*$/);
    report.migrationSha256 = createHash('sha256').update(migration).digest('hex');
    const staffRoles = ['owner', 'general_director', 'operations_manager', 'procurement_manager', 'sales_manager', 'compliance_finance', 'staff_analyst'];
    const staff = staffRoles.map(role => ({ role, id: randomUUID() }));
    const members = ['buyer', 'supplier', 'partner'].map(role => ({ role, id: randomUUID(), companyId: randomUUID() }));
    const unverified = randomUUID();
    const all = [...staff, ...members, { id: unverified }];
    let transaction = migration.replace(/\bBEGIN;/, 'BEGIN;\nSET LOCAL statement_timeout=15000;').replace(/COMMIT;\s*$/, '');
    // These synthetic rows exist only inside this rollback-only SQL privilege
    // test. They are NOT evidence of real email confirmation or real login.
    for (const actor of all) transaction += `\nINSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES(${literal(actor.id)}::uuid,${literal(`rollback.${actor.id}@test.shadowbridge.invalid`)},${actor.id === unverified ? 'NULL' : 'now()'},'{}');`;
    for (const actor of staff) transaction += `\nINSERT INTO sb.staff_grants(user_id,active) VALUES(${literal(actor.id)}::uuid,true); INSERT INTO sb.staff_role_assignments(user_id,role_key,active,assigned_by) VALUES(${literal(actor.id)}::uuid,${literal(actor.role)},true,${literal(actor.id)}::uuid);`;
    for (const actor of members) transaction += `\nINSERT INTO sb.companies(id,legal_name,registration_number,country,created_by) VALUES(${literal(actor.companyId)}::uuid,'FICTIONAL ROLLBACK ONLY',${literal(actor.id)},'NO',${literal(actor.id)}::uuid);
      INSERT INTO sb.applications(user_id,company_id,requested_role) VALUES(${literal(actor.id)}::uuid,${literal(actor.companyId)}::uuid,${literal(actor.role)});
      INSERT INTO sb.professional_profiles(user_id,company_id,countries,sectors,summary) VALUES(${literal(actor.id)}::uuid,${literal(actor.companyId)}::uuid,ARRAY['NO','PL'],ARRAY['FICTIONAL'], 'FICTIONAL rollback-only full profile');`;
    const memberIds = members.map(actor => literal(actor.id) + '::uuid').join(',');
    const assertions = [];
    for (const actor of staff) {
      const profileAllowed = !['staff_analyst'].includes(actor.role);
      const accountAllowed = ['owner', 'general_director', 'procurement_manager', 'sales_manager', 'compliance_finance'].includes(actor.role);
      const unverifiedAllowed = ['owner', 'general_director', 'compliance_finance'].includes(actor.role);
      assertions.push(`SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(actor.id)},true); SELECT set_config('request.jwt.claim.aal','aal2',true);
        DO $$ BEGIN
          IF (SELECT count(*) FROM sb.professional_profiles WHERE user_id IN (${memberIds})) <> ${profileAllowed ? 3 : 0} THEN RAISE EXCEPTION 'Unexpected role profile scope'; END IF;
          IF (SELECT count(*) FROM sb.accounts WHERE user_id IN (${memberIds})) <> ${accountAllowed ? 3 : 0} THEN RAISE EXCEPTION 'Unexpected role applicant-account scope'; END IF;
          IF (SELECT count(*) FROM sb.accounts WHERE user_id=${literal(unverified)}::uuid) <> ${unverifiedAllowed ? 1 : 0} THEN RAISE EXCEPTION 'Unsubmitted account leaked to application-only reviewer'; END IF;
        END $$; RESET ROLE;`);
      report.cases.push({ name: `rollback-only RLS scope for ${actor.role}`, result: 'PENDING' });
    }
    for (const actor of members) assertions.push(`SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(actor.id)},true); SELECT set_config('request.jwt.claim.aal','aal1',true);
      DO $$ BEGIN
        IF (SELECT count(*) FROM sb.professional_profiles WHERE user_id IN (${memberIds}))<>1 THEN RAISE EXCEPTION 'Member profile isolation failed'; END IF;
        IF (SELECT count(*) FROM sb.accounts WHERE user_id IN (${memberIds}))<>1 THEN RAISE EXCEPTION 'Member account isolation failed'; END IF;
      END $$; RESET ROLE;`);
    report.cases.push({ name: 'rollback-only Buyer/Supplier/Partner own-profile and own-account isolation', result: 'PENDING' });
    const procurement = staff.find(actor => actor.role === 'procurement_manager');
    assertions.push(`SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(procurement.id)},true); SELECT set_config('request.jwt.claim.aal','aal1',true);
      DO $$ BEGIN IF (SELECT count(*) FROM sb.professional_profiles WHERE user_id IN (${memberIds}))<>0 OR (SELECT count(*) FROM sb.accounts WHERE user_id IN (${memberIds}))<>0 THEN RAISE EXCEPTION 'AAL1 exposed reviewer data'; END IF; END $$; RESET ROLE;`);
    report.cases.push({ name: 'rollback-only reviewer AAL1 cannot read applicant accounts or profiles', result: 'PENDING' });
    if (historyMode) {
      const source = await readFile(path.join(repositoryRoot, 'supabase/migrations/202610210014_application_decision_history.sql'), 'utf8');
      report.historyMigrationSha256 = createHash('sha256').update(source).digest('hex');
      transaction += `\nUPDATE sb.applications SET status='approved',decision_note='legacy short',reviewed_by=NULL,reviewed_at=NULL WHERE user_id=${literal(members[0].id)}::uuid;\n`;
      transaction += source.replace(/\bBEGIN;/, '').replace(/COMMIT;\s*$/, '');
      const owner = staff.find(actor => actor.role === 'owner');
      const application = `(SELECT id FROM sb.applications WHERE user_id=${literal(members[1].id)}::uuid)`;
      const historyChecks = [
        `DO $$ BEGIN IF (SELECT count(*) FROM sb.application_decisions WHERE source='legacy_snapshot' AND reason='legacy short' AND reviewed_by IS NULL AND reviewed_at IS NULL)<>1 THEN RAISE EXCEPTION 'Legacy decision must retain original short reason and unknown reviewer/time'; END IF; END $$;`,
        `SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(owner.id)},true); SELECT set_config('request.jwt.claim.aal','aal2',true);
          SELECT sb.decide_application(${application},'rejected','FICTIONAL independently reviewed reason for rejection');
          DO $$ BEGIN IF (SELECT count(*) FROM sb.application_decisions WHERE application_id=${application} AND source='decision' AND previous_status='pending' AND status='rejected' AND reviewed_by=${literal(owner.id)}::uuid AND reviewed_at IS NOT NULL)<>1 THEN RAISE EXCEPTION 'New application decision history missing'; END IF;
          IF (SELECT count(*) FROM sb.audit_events WHERE actor_id=${literal(owner.id)}::uuid AND action='application.decision_recorded')<>1 THEN RAISE EXCEPTION 'Decision audit missing'; END IF; END $$; RESET ROLE;`,
      ];
      for (const actor of staff.filter(item => ['procurement_manager','sales_manager'].includes(item.role))) historyChecks.push(`SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(actor.id)},true); SELECT set_config('request.jwt.claim.aal','aal2',true); DO $$ BEGIN IF (SELECT count(*) FROM sb.application_decisions WHERE application_id IN(SELECT id FROM sb.applications WHERE user_id IN(${memberIds})))<>2 THEN RAISE EXCEPTION 'Application reviewer cannot read history'; END IF; END $$; RESET ROLE;`);
      for (const actor of members) historyChecks.push(`SET LOCAL ROLE shadowbridge_api; SELECT set_config('request.jwt.claim.sub',${literal(actor.id)},true); SELECT set_config('request.jwt.claim.aal','aal1',true); DO $$ BEGIN IF (SELECT count(*) FROM sb.application_decisions)<>0 THEN RAISE EXCEPTION 'Member received internal history'; END IF; END $$; RESET ROLE;`);
      for (const role of ['shadowbridge_api','shadowbridge_sessions']) {
        const mutations = ["UPDATE sb.application_decisions SET reason='FORBIDDEN' WHERE false", 'DELETE FROM sb.application_decisions WHERE false', `INSERT INTO sb.application_decisions(application_id,status,reason,source) SELECT ${literal(members[0].companyId)}::uuid,'approved','FICTIONAL forbidden history write','decision' WHERE false`];
        if (role === 'shadowbridge_sessions') mutations.push('SELECT count(*) FROM sb.application_decisions');
        for (const mutation of mutations) historyChecks.push(`SET LOCAL ROLE ${role}; DO $$ BEGIN BEGIN ${mutation}; RAISE EXCEPTION 'Runtime action unexpectedly permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$; RESET ROLE;`);
      }
      historyChecks.push(`DO $$ BEGIN BEGIN UPDATE sb.application_decisions SET reason='FORBIDDEN' WHERE application_id=${application}; RAISE EXCEPTION 'History mutation unexpectedly permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;`);
      transaction += '\n' + historyChecks.join('\n') + '\nROLLBACK;';
      report.cases = ['legacy snapshot preserves reason and unknown actor/time', 'real decision function records immutable history and audit', 'Procurement/Sales can read authorized history', 'Buyer/Supplier/Partner cannot read internal history', 'runtime writes/reads and history mutation are denied'].map(name => ({ name, result: 'PENDING' }));
    } else transaction += '\n' + assertions.join('\n') + '\nROLLBACK;';
    sql(pg, transaction);
    assert.equal(sql(pg, fingerprintSql), before, 'Rollback must preserve original accounts/password records/sessions/MFA/roles/ledger/policies');
    assert.equal(sql(pg, 'SELECT count(*) FROM shadowbridge_migrations.applied'), '12');
    report.dataAndPoliciesUnchanged = true; report.result = 'PASS';
    report.cases = report.cases.map(item => ({ ...item, result: 'PASS' }));
    console.log(historyMode
      ? 'PASS: migration014 legacy/decision history, audit and runtime authorization verified inside ROLLBACK; original fingerprints and 001–012 ledger unchanged.'
      : 'PASS: migration013 compiled and role/member/MFA read scopes verified inside ROLLBACK; original fingerprints and 001–012 ledger unchanged.');
  } catch (error) {
    report.result = 'FAIL'; report.errorType = error?.name || 'Error';
    await writeFile(path.join(directory, 'h2c-policy-failure.json'), JSON.stringify({ name: error?.name, message: error?.message, stack: error?.stack }, null, 2) + '\n', { mode: 0o600 });
    console.error('FAIL: rollback-only policy test. Private diagnostics retained; no row data or secrets logged.');
    process.exitCode = 1;
  } finally {
    if (!wasRunning && pg) compose(['stop', 'postgres']);
    report.finishedAt = new Date().toISOString();
    await writeFile(`/tmp/shadowbridge-h2c-${historyMode ? 'history' : 'policy'}-rollback.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
}

async function recruitmentRegression() {
  const appContainer = container('app'), pgContainer = container('postgres');
  assert.ok(appContainer && pgContainer, 'Start a NEW committed-source fictional fixture explicitly before this regression');
  const reportFile = '/tmp/shadowbridge-h2c-recruitment-regression.json';
  const results = { kind: 'real-h2c-recruitment', project: checked.project, startedAt: new Date().toISOString(), cases: [], mocksUsed: false, externalEmailSent: false };
  for (const name of ['server/app.mjs','server/recruitment.mjs','assets/portal.js','assets/dashboard.js','supabase/migrations/202610210013_recruitment_visibility.sql','supabase/migrations/202610210014_application_decision_history.sql']) results[name] = createHash('sha256').update(await readFile(path.join(fixture.snapshot, name))).digest('hex');
  const reviewer = (await readFile(path.join(directory, 'tester-password'), 'utf8')).trim();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin === checked.origin) {
      const headers = new Headers(options.headers); headers.set('Authorization', 'Basic ' + Buffer.from(`reviewer:${reviewer}`).toString('base64'));
      options = { ...options, headers };
    }
    return realFetch(input, options);
  };
  const mailProxy = createServer((request, response) => {
    if (request.method !== 'GET' || !/^\/api\/v1\/(?:messages|message\/[a-zA-Z0-9-]+)(?:\?.*)?$/.test(request.url || '')) { response.writeHead(404).end(); return; }
    try {
      const code = `fetch(${JSON.stringify('http://mailpit:8025' + request.url)}).then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(docker(['exec', appContainer, 'node', '-e', code]));
    } catch { response.writeHead(502).end('{}'); }
  });
  await new Promise(resolve => mailProxy.listen(0, '127.0.0.1', resolve));
  process.env.SHADOWBRIDGE_TEST_URL = checked.origin;
  process.env.SHADOWBRIDGE_MAILPIT_URL = `http://127.0.0.1:${mailProxy.address().port}`;
  process.env.SHADOWBRIDGE_DB_CONTAINER = pgContainer; process.env.SHADOWBRIDGE_TEST_DATABASE = 'shadowbridge'; process.env.DOCKER_CONTEXT = 'default';
  const h = await import('../server/tests/helpers.mjs');
  const require = createRequire(import.meta.url), { loadTestDependency } = require('./dependencies.cjs');
  const { chromium, expect } = loadTestDependency('@playwright/test');
  let browser, context, current = 'guarded fixture readiness';
  const phase = async (name, work) => {
    current = name; await work(); results.cases.push({ name, result: 'PASS' });
    await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 }); console.log('PASS: ' + name);
  };
  async function actor(role, label, { verify = true } = {}) {
    const value = { role, email: `${h.runId}.${label}@test.shadowbridge.invalid`, password: h.password(), companyName: `FICTIONAL H2C ${h.runId} ${label}`, registrationNumber: `FICTIONAL-${h.runId}-${label}`, profile: { countries: ['NO','PL','GB'], sectors: ['Industrial supplies','Emergency supplies'], summary: `FICTIONAL ${label} complete business scope.\nProduct sourcing, controlled introductions and logistics. <b>Plain text only</b>. ${'Detailed fictional commercial scope. '.repeat(30)}`.trim() }, client: new h.Client() };
    await value.client.request('/api/auth/register', { method: 'POST', body: { email: value.email, password: value.password, role, company: { name: value.companyName, country: 'NO', registrationNumber: value.registrationNumber }, profile: value.profile }, expected: 202 });
    if (verify) await h.verifyActor(value);
    return value;
  }
  const applicationId = value => h.db(`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(value.user.id)}::uuid`);
  const query = values => new URLSearchParams(values).toString();
  async function pageOf(client, endpoint, values = {}) { return (await client.request(endpoint + '?' + query(values), { expected: 200 })).data; }
  async function freshCode(value) {
    while (Math.floor(Date.now() / 30000) <= Math.floor((value.mfaVerifiedAt || 0) / 30000)) await new Promise(resolve => setTimeout(resolve, 500));
    value.mfaVerifiedAt = Date.now(); return h.totp(value.mfaSecret);
  }
  try {
    await phase('real TLS reviewer gate and complete source migration ledger', async () => {
      assert.equal((await realFetch(checked.origin + '/api/config')).status, 401);
      assert.equal((await fetch(checked.origin + '/api/config')).status, 200);
      assert.equal(h.db('SELECT count(*) FROM shadowbridge_migrations.applied'), String((await migrationSources()).length));
      for (const name of ['202610210013_recruitment_visibility.sql','202610210014_application_decision_history.sql']) assert.equal(h.db(`SELECT sha256 FROM shadowbridge_migrations.applied WHERE name=${h.sqlLiteral(name)}`), createHash('sha256').update(await readFile(path.join(repositoryRoot,'supabase/migrations',name))).digest('hex'));
    });
    let owner, buyer, supplier, partner, rejected, pending, unverified, missing;
    const staff = {};
    await phase('real verified fictional OWNER bootstrap and mandatory MFA', async () => {
      owner = await actor('partner', 'h2c-owner');
      compose(['run','--rm','--no-deps','migrator','scripts/bootstrap-admin.mjs',`--email=${owner.email}`,'--grant-owner']);
      await owner.client.signIn(owner);
      await owner.client.request('/api/admin/accounts', { expected: 403 });
      await owner.client.request('/api/admin/applications', { expected: 403 });
      await h.enableMfa(owner);
      await owner.client.request('/api/admin/accounts', { expected: 200 });
    });
    await phase('unconfirmed registration is visible only in Accounts; first-form data waits for real email verification', async () => {
      unverified = await actor('supplier', 'h2c-email-pending', { verify: false });
      const accounts = await pageOf(owner.client, '/api/admin/accounts', { q: unverified.email });
      assert.equal(accounts.total, 1); assert.equal(accounts.items[0].stage, 'email_pending'); assert.equal(accounts.items[0].emailVerified, false);
      assert.equal(accounts.items[0].applicationId, null);
      const applications = await pageOf(owner.client, '/api/admin/applications', { q: unverified.email });
      assert.equal(applications.total, 0); assert.deepEqual(applications.items, []);
      await unverified.client.request('/api/auth/login', { method: 'POST', body: { email: unverified.email, password: unverified.password }, expected: [400,401,403] });
      assert.equal(h.db(`SELECT count(*) FROM sb.registration_drafts d JOIN sb.accounts a ON a.user_id=d.user_id WHERE a.email=${h.sqlLiteral(unverified.email)} AND d.payload->>'role'='supplier' AND d.payload#>>'{company,legal_name}'=${h.sqlLiteral(unverified.companyName)}`), '1');
    });
    await phase('confirmed applications retain complete profiles while verified legacy accounts can have no submission', async () => {
      buyer = await actor('buyer','h2c-buyer'); supplier = await actor('supplier','h2c-supplier'); partner = await actor('partner','h2c-partner');
      rejected = await actor('supplier','h2c-rejected'); pending = await actor('partner','h2c-pending');
      const full = await pageOf(owner.client,'/api/admin/applications',{q:buyer.email});
      assert.equal(full.total,1); assert.deepEqual(full.items[0].profile,buyer.profile);
      assert.equal(full.items[0].company.registrationNumber,buyer.registrationNumber); assert.equal(full.items[0].emailVerified,true);
      missing = { role:'buyer', email:`${h.runId}.h2c-missing@test.shadowbridge.invalid`, password:h.password(), client:new h.Client() };
      const code=`fetch('https://auth-proxy:8444/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json',apikey:process.env.SUPABASE_ANON_KEY},body:JSON.stringify(${JSON.stringify({email:missing.email,password:missing.password})})}).then(async r=>{if(!r.ok)process.exit(1);await r.arrayBuffer();process.stdout.write('CREATED')}).catch(()=>process.exit(1))`;
      assert.equal(docker(['exec','-i',appContainer,'node','--input-type=module','-'],{input:code,stdio:['pipe','pipe','pipe']}),'CREATED');
      await h.verifyActor(missing);
      const account = await pageOf(owner.client,'/api/admin/accounts',{q:missing.email});
      assert.equal(account.items[0].stage,'application_missing'); assert.equal(account.items[0].emailVerified,true); assert.equal(account.items[0].applicationId,null);
      assert.equal((await pageOf(owner.client,'/api/admin/applications',{q:missing.email})).total,0);
    });
    await phase('all seven real staff roles obey recruitment API permissions and MFA', async () => {
      const roles=['general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst'];
      for(const role of roles){
        const value=await actor('partner',`h2c-${role}`); staff[role]=value;
        await owner.client.request('/api/staff/roles',{method:'POST',body:{userId:value.user.id,role,active:true},expected:200});
        await value.client.signIn(value);
        await value.client.request('/api/admin/applications',{expected:403});
        await h.enableMfa(value);
        const canApplications=['general_director','procurement_manager','sales_manager','compliance_finance'].includes(role);
        const canAccounts=['general_director','compliance_finance'].includes(role);
        const response=await value.client.request('/api/admin/applications?'+query({q:buyer.email}),{expected:canApplications?200:403});
        await value.client.request('/api/admin/accounts',{expected:canAccounts?200:403});
        if(canApplications){assert.equal(response.data.items.length,1);assert.deepEqual(response.data.items[0].profile,buyer.profile);assert.equal(response.data.items[0].email,buyer.email);}
        if(['procurement_manager','sales_manager'].includes(role)){
          const access=(await value.client.request('/api/staff/access',{expected:200})).data;
          assert.equal(access.permissions.includes('accounts.read'),false); assert.equal(access.permissions.includes('proposals.read'),false);
        }
      }
      const deniedOwner=await staff.general_director.client.request(`/api/admin/accounts/${owner.user.id}/status`,{method:'POST',body:{status:'suspended'},expected:403});
      assert.ok(!JSON.stringify(deniedOwner.data).includes(owner.password));
      await staff.general_director.client.request('/api/staff/roles',{method:'POST',body:{userId:staff.general_director.user.id,role:'owner',active:true},expected:403});
      assert.equal(h.db(`SELECT status FROM sb.accounts WHERE user_id=${h.sqlLiteral(owner.user.id)}::uuid`),'active');
      assert.equal((await owner.client.request('/api/session',{expected:200})).data.user.aal,'aal2');
    });
    await phase('Accounts refuses incoherent custom permissions rather than falsely reporting missing applications', async()=>{
      const reviewer=staff.compliance_finance;
      await owner.client.request('/api/staff/permissions',{method:'POST',body:{userId:reviewer.user.id,permission:'applications.read',effect:'deny'},expected:200});
      await reviewer.client.request('/api/admin/accounts',{expected:403});
      await owner.client.request('/api/staff/permissions',{method:'POST',body:{userId:reviewer.user.id,permission:'applications.read',effect:'remove'},expected:200});
      await reviewer.client.request('/api/admin/accounts',{expected:200});
    });
    await phase('search, stage counts and deterministic pagination remain bounded and reject invalid filters',async()=>{
      const first=await pageOf(owner.client,'/api/admin/accounts',{q:h.runId,limit:2,page:1});
      const second=await pageOf(owner.client,'/api/admin/accounts',{q:h.runId,limit:2,page:2});
      assert.equal(first.items.length,2); assert.equal(second.items.length,2); assert.ok(first.total>=10);
      assert.equal(first.pages,Math.ceil(first.total/2)); assert.ok(first.items.every(x=>!second.items.some(y=>x.userId===y.userId)));
      assert.equal(first.counts.email_pending,1); assert.equal(first.counts.application_missing,1);
      const filtered=await pageOf(owner.client,'/api/admin/accounts',{q:h.runId,stage:'email_pending',limit:2});
      assert.equal(filtered.total,1); assert.equal(filtered.items[0].email,unverified.email); assert.equal(filtered.counts.application_missing,1);
      const applications=await pageOf(owner.client,'/api/admin/applications',{q:h.runId,limit:2,page:1});
      const more=await pageOf(owner.client,'/api/admin/applications',{q:h.runId,limit:2,page:2});
      assert.equal(applications.items.length,2); assert.ok(applications.items.every(x=>!more.items.some(y=>x.id===y.id)));
      assert.equal((await pageOf(owner.client,'/api/admin/accounts',{q:'%'})).total,0);
      for(const endpoint of ['/api/admin/accounts?limit=25','/api/admin/accounts?page=0','/api/admin/accounts?stage=verified','/api/admin/accounts?q=a&q=b','/api/admin/applications?status=verified','/api/admin/applications?limit=10000']) await owner.client.request(endpoint,{expected:400});
    });
    await phase('managers approve and reject pending submissions independently; decision reasons/history are retained',async()=>{
      await staff.sales_manager.client.request(`/api/admin/applications/${applicationId(buyer)}/decision`,{method:'POST',body:{decision:'approved',reason:'short'},expected:400});
      for(const[value,reviewer,decision]of[[buyer,staff.sales_manager,'approved'],[supplier,staff.procurement_manager,'approved'],[partner,owner,'approved'],[rejected,staff.procurement_manager,'rejected']]){
        value.decisionReason=`FICTIONAL ${decision} after independent review of the complete applicant profile.`;
        await reviewer.client.request(`/api/admin/applications/${applicationId(value)}/decision`,{method:'POST',body:{decision,reason:value.decisionReason},expected:200});
        const history=await pageOf(owner.client,`/api/admin/applications/${applicationId(value)}/history`,{limit:2});
        assert.equal(history.total,1); assert.equal(history.items[0].decision,decision); assert.equal(history.items[0].reason,value.decisionReason); assert.equal(history.items[0].actorId,reviewer.user.id); assert.equal(history.items[0].source,'decision');
        assert.ok(history.items[0].createdAt); assert.ok(history.items[0].recordedAt);
        assert.equal(h.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${h.sqlLiteral(reviewer.user.id)}::uuid AND action='application.decision_recorded' AND metadata->>'applicationId'=${h.sqlLiteral(applicationId(value))}`),'1');
      }
      await owner.client.request(`/api/admin/applications/${applicationId(rejected)}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL forbidden rereview of a completed decision.'},expected:400});
      const archive=await pageOf(owner.client,'/api/admin/applications',{status:'rejected',q:rejected.email});
      assert.equal(archive.total,1); assert.equal(archive.items[0].decisionReason,rejected.decisionReason);
      assert.equal((await pageOf(owner.client,`/api/admin/applications/${applicationId(rejected)}/history`,{})).total,1);
      assert.equal((await pageOf(owner.client,'/api/admin/accounts',{q:rejected.email})).items[0].stage,'rejected');
      assert.equal((await pageOf(owner.client,'/api/admin/accounts',{q:buyer.email})).items[0].stage,'approved');
      assert.equal((await pageOf(owner.client,'/api/admin/accounts',{q:pending.email})).items[0].stage,'pending_review');
    });
    await phase('approved Buyer Supplier and Partner remain isolated from recruitment records and internal history',async()=>{
      for(const value of[buyer,supplier,partner]){
        await value.client.signIn(value);
        const session=(await value.client.request('/api/session',{expected:200})).data.user;
        assert.equal(session.applicationStatus,'approved'); assert.ok(session.roles.includes(value.role)); assert.equal(session.staff,false);
        for(const endpoint of['/api/admin/accounts','/api/admin/applications',`/api/admin/applications/${applicationId(rejected)}/history`]){
          const result=await value.client.request(endpoint,{expected:403});
          assert.ok(!JSON.stringify(result.data).includes(rejected.email)); assert.ok(!JSON.stringify(result.data).includes(rejected.companyName));
        }
        const own=(await value.client.request('/api/profile',{expected:200})).data.profile;
        assert.deepEqual(own,value.profile);
        assert.equal(h.db(`BEGIN;SET LOCAL ROLE shadowbridge_api;SELECT set_config('request.jwt.claim.sub',${h.sqlLiteral(value.user.id)},true);SELECT set_config('request.jwt.claim.aal','aal1',true);SELECT count(*) FROM sb.application_decisions;ROLLBACK;`).split('\n').at(-1),'0');
      }
    });
    await phase('suspension revokes sessions while preserving the approved application and restoration uses normal login',async()=>{
      await owner.client.request(`/api/admin/accounts/${buyer.user.id}/status`,{method:'POST',body:{status:'suspended'},expected:200});
      const account=(await pageOf(owner.client,'/api/admin/accounts',{q:buyer.email})).items[0];
      assert.equal(account.stage,'suspended'); assert.equal(account.applicationStatus,'approved');
      await buyer.client.request('/api/profile',{expected:401});
      assert.equal(h.db(`SELECT count(*) FROM sb.applications WHERE user_id=${h.sqlLiteral(buyer.user.id)}::uuid`),'1');
      await owner.client.request(`/api/admin/accounts/${buyer.user.id}/status`,{method:'POST',body:{status:'active'},expected:200});
      await buyer.client.signIn(buyer);
      assert.equal((await buyer.client.request('/api/session',{expected:200})).data.user.applicationStatus,'approved');
    });
    const certificate=new X509Certificate(await readFile(path.join(directory,'certs/public.crt'))),pin=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox',`--ignore-certificate-errors-spki-list=${pin}`]});
    context=await browser.newContext({baseURL:checked.origin,httpCredentials:{username:'reviewer',password:reviewer},viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page=await context.newPage();
    await phase('real Member Sign In and MFA unlock Accounts without weakening the existing Command Center gate',async()=>{
      await page.goto('/member-sign-in/');const form=page.locator('#sign-in-form');await expect(form.locator('[name=email]')).toBeEnabled();
      await form.locator('[name=email]').fill(owner.email);await form.locator('[name=password]').fill(owner.password);await form.locator('button[type=submit]').click();
      await expect(page.locator('#portal-account')).toContainText(owner.email);await page.goto('/portal/admin/?module=accounts');
      await expect(page.getByRole('heading',{name:'Management security verification',exact:true})).toBeVisible();assert.equal((await page.request.get('/api/admin/accounts')).status(),403);
      await page.getByLabel('Six-digit authenticator code',{exact:true}).fill(await freshCode(owner));
      const verified=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/mfa/verify'&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Verify second factor',exact:true}).click();assert.equal((await verified).status(),200);
      await expect(page.getByRole('heading',{name:'Accounts',exact:true})).toBeVisible();
      assert.equal((await(await page.request.get('/api/session')).json()).user.aal,'aal2');
    });
    await phase('desktop and mobile Accounts filters and full application profile/history render actual records',async()=>{
      const accountsNav=page.getByRole('navigation',{name:'Command Center modules',exact:true});
      for(const width of[1440,390,320]){
        await page.setViewportSize({width,height:1000});
        await accountsNav.getByRole('link',{name:'Accounts',exact:true}).click();await expect(page.getByRole('heading',{name:'Accounts',exact:true})).toBeVisible();
        const filters=page.getByRole('form',{name:'Account filters'});
        await filters.getByRole('searchbox',{name:'Search accounts',exact:true}).fill(unverified.email);
        await filters.getByRole('combobox',{name:'Account stage',exact:true}).selectOption('email_pending');await filters.getByRole('button',{name:'Filter accounts',exact:true}).click();
        const card=page.locator('[data-recruitment-record=account]');await expect(card).toHaveCount(1);await expect(card).toContainText(unverified.email);await expect(card).toContainText('Not confirmed');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await accountsNav.getByRole('link',{name:'Applications',exact:true}).click();await expect(page.getByRole('heading',{name:'Company applications',exact:true})).toBeVisible();
        const appFilters=page.getByRole('form',{name:'Application filters'});
        await appFilters.getByRole('searchbox',{name:'Search applications',exact:true}).fill(rejected.email);
        await appFilters.getByRole('combobox',{name:'Application status',exact:true}).selectOption('rejected');await appFilters.getByRole('button',{name:'Filter applications',exact:true}).click();
        const application=page.locator('[data-recruitment-record=application]');await expect(application).toHaveCount(1);await expect(application).toContainText(rejected.companyName);await expect(application).toContainText(rejected.profile.summary);
        await expect(application.getByRole('button',{name:'Record application decision',exact:true})).toHaveCount(0);
        assert.equal(await application.locator('dt').filter({hasText:/^Full business scope$/}).locator('xpath=following-sibling::dd[1]').textContent(),rejected.profile.summary);
        await expect(application.locator('b')).toHaveCount(0);
        await application.getByRole('button',{name:'Load decision history',exact:true}).click();
        await expect(application.getByRole('region',{name:'Application decision history',exact:true})).toContainText(rejected.decisionReason);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      }
    });
    await phase('logout clears recruitment profiles and relocated module navigation across tabs',async()=>{
      const second=await context.newPage();await second.goto('/portal/admin/?module=accounts');await expect(second.getByRole('heading',{name:'Accounts',exact:true})).toBeVisible();
      await second.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
      await expect(page.locator('[data-recruitment-record]')).toHaveCount(0);await expect(page.locator('.dashboard-module-slot')).toBeEmpty();await expect(page.locator('#portal-account')).toBeEmpty();
      assert.equal((await(await page.request.get('/api/session')).json()).user,null);
    });
    results.result='PASS';
  }catch(error){
    results.result='FAIL';results.failedCase=current;results.errorType=error?.name||'Error';
    await writeFile(path.join(directory,'h2c-recruitment-failure.json'),JSON.stringify({case:current,name:error?.name,message:error?.message,stack:error?.stack},null,2)+'\n',{mode:0o600});
    console.error(`FAIL: ${current}. Private diagnostics retained; no identities, credentials or response bodies logged.`);process.exitCode=1;
  }finally{
    results.finishedAt=new Date().toISOString();await writeFile(reportFile,JSON.stringify(results,null,2)+'\n',{mode:0o600});
    if(context)await context.close();if(browser)await browser.close();await new Promise(resolve=>mailProxy.close(resolve));globalThis.fetch=realFetch;
  }
}

if (args.includes('--policy-rollback-only') || args.includes('--history-rollback-only')) await policyRollback();
else await recruitmentRegression();
