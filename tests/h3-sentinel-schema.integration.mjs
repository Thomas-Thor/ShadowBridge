// H3-A real PostgreSQL upgrade/RLS regression. Preparation and schema results
// are reported separately. Only an explicit guarded fictional fixture is
// accepted. No VPS, demo bootstrap, external email, registry call or AI service.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';

const args = process.argv.slice(2);
const directoryArg = args.find(value => value.startsWith('--dir='))?.slice(6);
assert.ok(directoryArg, 'An explicit fresh isolated --dir is required');
const checked = await checkStaging({ directory: directoryArg });
assert.match(checked.project, /^shadowbridge-stageg-h1-[a-f0-9]{10}$/);
const directory = checked.directory;
const fixture = JSON.parse(await readFile(path.join(directory, 'h1-fixture.json'), 'utf8'));
assert.equal(fixture.kind, 'shadowbridge-h1-isolated-auth');
assert.equal(fixture.project, checked.project);
assert.match(fixture.snapshot, /^\/tmp\/shadowbridge-h1-source-[a-f0-9]{10}$/);
const generated = await readEnv(path.join(directory, 'compose.env'));
const docker = (parts, options = {}) => execFileSync('docker', ['--context', 'default', ...parts], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
const compose = (parts, options = {}) => docker(['compose', '--project-name', checked.project, '--env-file', path.join(directory, 'compose.env'), '-f', path.join(repositoryRoot, 'deploy/staging/compose.yaml'), '-f', path.join(directory, 'h1-override.json'), ...parts], { env: { ...process.env, ...generated }, ...options });
const container = service => docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${checked.project}`, '--filter', `label=com.docker.compose.service=${service}`]).trim();
let appContainer = container('app');
const pgContainer = container('postgres');
assert.ok(pgContainer, 'The dedicated fictional database must be running');
const sql = source => docker(['exec', '-i', pgContainer, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'shadowbridge'], { input: source, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const statePath = path.join(directory, 'h3-fictional-state.json');
const reportFile = '/tmp/shadowbridge-h3a-schema-regression.json';
const results = { kind: 'real-h3a-schema', project: checked.project, mode: args.includes('--prepare-baseline') ? 'prepare-014-baseline' : 'schema-upgrade', startedAt: new Date().toISOString(), cases: [], mocksUsed: false, externalEmailSent: false, registryNetworkCalls: false, imageBuildTested: false };
let current = 'guarded fictional fixture readiness';
async function phase(name, work) {
  current = name; await work(); results.cases.push({ name, result: 'PASS' });
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: ' + name);
}

const fingerprints = () => JSON.parse(sql(`SELECT jsonb_build_object(
  'users',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.users t),
  'accounts',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.accounts t),
  'companies',(SELECT md5(coalesce(jsonb_agg(jsonb_build_object('id',id,'legal_name',legal_name,'registration_number',registration_number,'country',country,'created_by',created_by,'created_at',created_at) ORDER BY id)::text,'[]')) FROM sb.companies),
  'applications',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.applications t),
  'memberships',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM sb.memberships t),
  'profiles',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.professional_profiles t),
  'sessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id_hash)::text,'[]')) FROM sb.sessions t),
  'mfa',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.mfa_factors t),
  'auth_sessions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.sessions t),
  'refresh_tokens',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM auth.refresh_tokens t),
  'staff_assignments',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,role_key)::text,'[]')) FROM sb.staff_role_assignments t),
  'staff_grants',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.staff_grants t),
  'staff_overrides',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,permission)::text,'[]')) FROM sb.staff_permission_overrides t)
)::text`));

async function withRealAuth(work) {
  appContainer = container('app');
  assert.ok(appContainer, 'The dedicated fictional API must be running for live authentication checks');
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
  process.env.SHADOWBRIDGE_DB_CONTAINER = pgContainer;
  process.env.SHADOWBRIDGE_TEST_DATABASE = 'shadowbridge'; process.env.DOCKER_CONTEXT = 'default';
  const helpers = await import('../server/tests/helpers.mjs');
  try { await work(helpers); }
  finally { await new Promise(resolve => mailProxy.close(resolve)); globalThis.fetch = realFetch; }
}

async function prepareBaseline() {
  assert.equal(sql('SELECT count(*) FROM shadowbridge_migrations.applied'), '14');
  assert.equal(sql('SELECT count(*) FROM auth.users'), '0', 'Baseline preparation accepts only a fresh fictional installation');
  await assert.rejects(lstat(statePath), { code: 'ENOENT' });
  await withRealAuth(async h => {
    const actors = {}, staff = {};
    const create = async (role, label, verify = true) => {
      const actor = await h.registerActor(role, `h3a-${label}`);
      if (verify) {
        await h.verifyActor(actor);
        actor.companyId = sql(`SELECT company_id FROM sb.applications WHERE user_id=${literal(actor.user.id)}::uuid`);
        actor.applicationId = sql(`SELECT id FROM sb.applications WHERE user_id=${literal(actor.user.id)}::uuid`);
      }
      return actor;
    };
    await phase('committed 001–014 baseline uses actual email confirmation and OWNER MFA', async () => {
      actors.owner = await create('partner', 'owner');
      compose(['run', '--rm', '--no-deps', 'migrator', 'scripts/bootstrap-admin.mjs', `--email=${actors.owner.email}`, '--grant-owner']);
      await actors.owner.client.signIn(actors.owner);
      await actors.owner.client.request('/api/staff/access', { expected: 403 });
      await h.enableMfa(actors.owner);
    });
    await phase('existing fictional approved members, pending applicant and company co-member are established manually', async () => {
      for (const role of ['buyer', 'supplier', 'partner']) actors[role] = await create(role, role);
      actors.coMember = await create('buyer', 'co-member');
      for (const key of ['buyer', 'partner', 'coMember']) await actors.owner.client.request(`/api/admin/applications/${actors[key].applicationId}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'FICTIONAL pre-Sentinel independent manual approval for isolated migration preservation tests.' }, expected: 200 });
      await actors.owner.client.request('/api/staff/company-members', { method: 'POST', body: { companyId: actors.buyer.companyId, userId: actors.coMember.user.id, role: 'buyer', status: 'approved' }, expected: 200 });
      assert.equal(sql(`SELECT count(*) FROM sb.memberships WHERE company_id=${literal(actors.buyer.companyId)}::uuid AND status='approved'`), '2');
      assert.equal((await actors.supplier.client.request('/api/session', { expected: 200 })).data.user.applicationStatus, 'pending');
      actors.unverified = await create('supplier', 'unverified', false);
      assert.equal(sql(`SELECT count(*) FROM sb.applications a JOIN sb.accounts u ON u.user_id=a.user_id WHERE u.email=${literal(actors.unverified.email)}`), '0');
    });
    await phase('all seven staff principals have real provider MFA before schema-only authorization checks', async () => {
      for (const role of ['general_director', 'operations_manager', 'procurement_manager', 'sales_manager', 'compliance_finance', 'staff_analyst']) {
        const actor = await create('partner', role); staff[role] = actor;
        await actors.owner.client.request('/api/staff/roles', { method: 'POST', body: { userId: actor.user.id, role, active: true }, expected: 200 });
        await actor.client.signIn(actor); await h.enableMfa(actor);
      }
    });
    const encodeActor = actor => ({ ...actor, client: { cookies: [...actor.client.cookies], csrf: actor.client.csrf } });
    const state = { kind: 'shadowbridge-h3a-fictional-baseline', project: checked.project, sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(), actors: Object.fromEntries(Object.entries(actors).map(([key, value]) => [key, encodeActor(value)])), staff: Object.fromEntries(Object.entries(staff).map(([key, value]) => [key, encodeActor(value)])) };
    // Generated credentials remain only in this guarded private fictional
    // installation; they are never logged, committed or uploaded anywhere.
    await writeFile(statePath, JSON.stringify(state) + '\n', { mode: 0o600, flag: 'wx' });
    results.stateStoredPrivately = true;
  });
}

async function loadBaseline() {
  assert.equal((await lstat(statePath)).mode & 0o777, 0o600, 'Private credentials must have mode0600');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.kind, 'shadowbridge-h3a-fictional-baseline');
  assert.equal(state.project, checked.project);
  for (const actor of [...Object.values(state.actors), ...Object.values(state.staff)]) {
    assert.match(actor.email, /@test[.]shadowbridge[.]invalid$/);
  }
  assert.equal(sql("SELECT count(*) FROM auth.users WHERE email IS NULL OR email !~ '@test[.]shadowbridge[.]invalid$'"), '0', 'Only the preserved fictional installation is accepted');
  assert.equal(sql("SELECT count(*) FROM sb.staff_role_assignments WHERE role_key='owner' AND active"), '1');
  assert.equal(sql(`SELECT user_id FROM sb.staff_role_assignments WHERE role_key='owner' AND active`), state.actors.owner.user.id);
  return state;
}

const migrationName = '202610210015_sentinel_verification.sql';
const newTables = ['company_verifications', 'verification_cases', 'verification_checks', 'verification_case_events'];
const claims = (actor, aal = 'aal2') => `RESET ROLE; SET LOCAL ROLE shadowbridge_api;
 SET LOCAL request.jwt.claim.sub=${literal(actor.user.id)};
 SET LOCAL request.jwt.claim.aal=${literal(aal)};
 SELECT set_config('request.jwt.claim.mfa_verified_at',extract(epoch FROM clock_timestamp())::text,true);`;
const must = (condition, message) => `SELECT pg_temp.must((${condition}),${literal(message)});`;
const denied = (query, code = '42501') => `SELECT pg_temp.denied(${literal(query)},${literal(code)});`;
const callOpen = (company, application = null, reason = 'FICTIONAL documented manual company verification review.') => `sb.sentinel_open_case(${literal(company)}::uuid,${application ? `${literal(application)}::uuid` : 'NULL'},${literal(reason)})`;
const caseId = name => `current_setting('h3.${name}')::uuid`;
const callCheck = (name, outcome = 'confirmed', type = 'company_identity', extra = '') => `sb.sentinel_record_check(${caseId(name)},${literal(type)},${literal(outcome)},'FICTIONAL evidence reference','FICTIONAL evidence explanation for isolated authorization tests'${extra})`;
const review = (name, status, companyStatus, version = `(SELECT version FROM sb.verification_cases WHERE id=${caseId(name)})`) => `SELECT sb.sentinel_review_case(${caseId(name)},${literal(status)},${literal(companyStatus)},'FICTIONAL independent human review with recorded decision',${version})`;

function functionalRegression(state) {
  const { owner, buyer, supplier, partner, coMember } = state.actors;
  const procurement = state.staff.procurement_manager;
  const analyst = state.staff.staff_analyst;
  const out = [];
  const add = source => out.push(source);
  const group = label => add(`SELECT ${literal('GROUP_PASS: ' + label)};`);
  add(`BEGIN; SET LOCAL lock_timeout='5s';
 CREATE FUNCTION pg_temp.must(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
 CREATE FUNCTION pg_temp.denied(command text,expected_code text) RETURNS void LANGUAGE plpgsql AS $$
 DECLARE actual text; BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
   IF actual=expected_code THEN RETURN; END IF;
   RAISE EXCEPTION 'Unexpected denial SQLSTATE %, expected %',actual,expected_code;
  END;
  RAISE EXCEPTION 'Expected denial did not occur'; END $$;
 ${claims(owner)}
 ${must(`sb.is_owner() AND sb.has_permission('sentinel.read')`, 'Existing owner has catalog permission with verified MFA')}
 SELECT set_config('h3.buyer',${callOpen(buyer.companyId, buyer.applicationId)}::text,true);
 SELECT set_config('h3.supplier',${callOpen(supplier.companyId, supplier.applicationId)}::text,true);
 ${must(`${callOpen(buyer.companyId, buyer.applicationId)}=${caseId('buyer')}`, 'Opening one company review is idempotent')}
 ${must(`(SELECT count(*) FROM sb.verification_cases WHERE company_id=${literal(buyer.companyId)}::uuid)=1`, 'One active case for a company with two members')}
 ${denied(`SELECT ${callOpen(partner.companyId, buyer.applicationId)}`, '22023')}
 RESET ROLE;
 INSERT INTO sb.accounts(user_id,email) SELECT id,email FROM auth.users WHERE email=${literal(state.actors.unverified.email)} ON CONFLICT(user_id) DO NOTHING;
 INSERT INTO sb.applications(user_id,company_id,requested_role)
  SELECT user_id,${literal(partner.companyId)}::uuid,'supplier' FROM sb.accounts WHERE email=${literal(state.actors.unverified.email)};
 SELECT set_config('h3.unverified_application',(SELECT id::text FROM sb.applications WHERE user_id=(SELECT user_id FROM sb.accounts WHERE email=${literal(state.actors.unverified.email)})),true);
 ${claims(owner)}
 ${denied(`SELECT sb.sentinel_open_case(${literal(partner.companyId)}::uuid,current_setting('h3.unverified_application')::uuid,'FICTIONAL source application from unverified account must be refused')`, '22023')}
 ${denied(`SELECT ${callOpen(partner.companyId, null, 'short')}`, '22023')}
 ${must(`(SELECT count(*) FROM sb.verification_case_events)=2`, 'Idempotent open adds no duplicate event')}
 `);
  group('manual case opening, matching verified source application, multi-user company and idempotency');
  for (const [label, actor] of [...Object.entries(state.staff), ...[['buyer', buyer], ['supplier', supplier], ['partner', partner], ['company co-member', coMember]]]) {
    add(`${claims(actor)}
    ${must('(SELECT count(*) FROM sb.company_verifications)=0', label + ' cannot read verification records by default')}
    ${must('(SELECT count(*) FROM sb.verification_cases)=0', label + ' cannot read cases by default')}
    ${must('(SELECT count(*) FROM sb.verification_checks)=0', label + ' cannot read evidence by default')}
    ${must('(SELECT count(*) FROM sb.verification_case_events)=0', label + ' cannot read history by default')}
    ${denied(`SELECT ${callOpen(partner.companyId)}`)}
    ${denied(`SELECT ${callCheck('buyer')}`)}
    ${denied(review('buyer', 'in_review', 'in_review', '1'))}`);
  }
  add(`${claims(owner, 'aal1')}
  ${must('(SELECT count(*) FROM sb.verification_cases)=0', 'Owner without MFA cannot read Sentinel')}
  ${denied(`SELECT ${callOpen(partner.companyId)}`)}
  ${claims(owner)}
  SELECT sb.set_staff_permission(${literal(procurement.user.id)}::uuid,'sentinel.read','allow');
  SELECT sb.set_staff_permission(${literal(procurement.user.id)}::uuid,'sentinel.review','allow');
  SELECT sb.set_staff_permission(${literal(procurement.user.id)}::uuid,'sentinel.checks.record','allow');
  SELECT sb.set_staff_permission(${literal(analyst.user.id)}::uuid,'sentinel.read','allow');
  SELECT sb.set_staff_permission(${literal(analyst.user.id)}::uuid,'sentinel.review','allow');
  SELECT sb.set_staff_permission(${literal(analyst.user.id)}::uuid,'sentinel.checks.record','allow');
  ${claims(analyst)}
  ${must('(SELECT count(*) FROM sb.verification_cases)=0', 'Sentinel-only grant does not bypass company/counterparty permissions')}
  ${denied(`SELECT ${callOpen(partner.companyId)}`)}
  ${claims(procurement)}
  ${must('(SELECT count(*) FROM sb.verification_cases)=2', 'Delegated procurement manager can read company review without owner involvement')}
  ${denied(review('supplier', 'completed', 'verified', '1'), '22023')}
  ${claims(owner)}
  SELECT sb.set_staff_permission(${literal(procurement.user.id)}::uuid,'applications.read','deny');
  ${claims(procurement)}
  ${denied(`SELECT ${callOpen(partner.companyId, partner.applicationId)}`)}
  ${claims(owner)}
  SELECT sb.set_staff_permission(${literal(procurement.user.id)}::uuid,'applications.read','remove');
  ${claims(procurement)}
  SELECT set_config('h3.partner',${callOpen(partner.companyId, partner.applicationId)}::text,true);`);
  group('all seven staff roles and tenant roles deny by default; MFA, least privilege and explicit delegation');
  add(`${denied(`SELECT ${callCheck('supplier', 'confirmed', 'format')}`, '22023')}
  ${denied(`SELECT ${callCheck('supplier', 'confirmed', 'duplicate')}`, '22023')}
  ${denied(`SELECT ${callCheck('supplier', 'official_registry')}`, '22023')}
  ${denied(`SELECT ${callCheck('supplier', 'confirmed', 'company_identity', ", 'not-a-hash'")}`, '22023')}
  ${denied(`SELECT ${callCheck('supplier', 'confirmed', 'company_identity', ", NULL, now()+interval '1 day'")}`, '22023')}
  SELECT ${callCheck('supplier', 'confirmed')};
  ${must(`(SELECT version FROM sb.verification_cases WHERE id=${caseId('supplier')})=2`, 'Evidence increments optimistic review version')}
  ${denied(review('supplier', 'completed', 'verified', '1'), '22023')}
  SELECT ${callCheck('supplier', 'mismatch')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'confirmed')};
  SELECT ${callCheck('supplier', 'unavailable')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'not_found')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'invalid_number')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'ambiguous')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'unsupported')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'needs_review')};
  ${denied(review('supplier', 'completed', 'verified'), '22023')}
  SELECT ${callCheck('supplier', 'confirmed')};
  SELECT ${callCheck('supplier', 'mismatch', 'representation')};
  ${review('supplier', 'completed', 'verified')};
  ${must(`(SELECT status FROM sb.company_verifications WHERE company_id=${literal(supplier.companyId)}::uuid)='verified'`, 'Company existence evidence is independent of disputed representation')}
  ${must(`(SELECT count(*) FROM sb.verification_checks WHERE source_kind<>'manual' OR actor_type<>'staff' OR actor_user_id IS NULL OR procedure_version<>'manual-v1')=0`, 'Manual function cannot forge system or official registry evidence')}
  ${denied(`SELECT ${callCheck('supplier')}`, '22023')}
  ${denied(review('supplier', 'in_review', 'in_review'), '22023')}
  ${claims(owner)}
  ${must(`(SELECT status FROM sb.applications WHERE id=${literal(supplier.applicationId)}::uuid)='pending'`, 'Company verification never approves a pending person application')}
  ${must(`NOT EXISTS(SELECT FROM sb.memberships WHERE user_id=${literal(supplier.user.id)}::uuid AND status='approved')`, 'No approved private membership is created for supplier')}
  ${must(`(SELECT count(*) FROM sb.memberships WHERE company_id=${literal(buyer.companyId)}::uuid AND status='approved')=2`, 'Existing company members unchanged')}
  SELECT set_config('h3.supplier_proof',(SELECT row_to_json(v)::text FROM sb.company_verifications v WHERE company_id=${literal(supplier.companyId)}::uuid),true);
  SELECT set_config('h3.supplier_second',${callOpen(supplier.companyId, supplier.applicationId)}::text,true);
  ${review('supplier_second', 'archived', 'verified')};
  ${must(`(SELECT row_to_json(v)::text FROM sb.company_verifications v WHERE company_id=${literal(supplier.companyId)}::uuid)=current_setting('h3.supplier_proof')`, 'Archiving a follow-up preserves all earlier company evidence, verification date and version')}
  ${denied(`SELECT ${callCheck('supplier_second')}`, '22023')}
  ${review('buyer', 'in_review', 'in_review')};
  ${review('buyer', 'needs_information', 'in_review')};
  ${review('buyer', 'completed', 'rejected')};
  ${review('partner', 'completed', 'inactive')};
  ${must(`(SELECT count(*) FROM sb.verification_cases WHERE closed_at IS NOT NULL)=4`, 'Completed and archived cases have closure timestamps')}
  `);
  group('documented outcomes, latest-negative evidence, stale versions, human decisions and company vs individual separation');
  add(`${claims(owner)}
  ${must(`(SELECT count(*) FROM sb.verification_case_events WHERE actor_user_id IS NULL OR actor_type<>'staff' OR procedure_version<>'sentinel-schema-v1')=0`, 'History records actual staff actor and procedure')}
  ${must(`(SELECT count(*) FROM sb.verification_case_events WHERE kind='opened')=4`, 'Exactly one opening event per distinct case')}
  ${must(`(SELECT count(*) FROM sb.verification_case_events WHERE kind='check_recorded')=(SELECT count(*) FROM sb.verification_checks)`, 'Every evidence write has history')}
  ${must(`(SELECT count(*) FROM sb.audit_events WHERE action='sentinel.case_opened')=4`, 'Case opening is audited once')}
  ${must(`(SELECT count(*) FROM sb.audit_events WHERE action='sentinel.check_recorded')=(SELECT count(*) FROM sb.verification_checks)`, 'Every check has a separate audit event')}
  ${must(`(SELECT count(*) FROM sb.audit_events WHERE action='sentinel.case_reviewed')=6`, 'Every human review has a separate audit event')}
  ${must(`NOT EXISTS(SELECT FROM sb.audit_events WHERE action LIKE 'sentinel.%' AND (metadata::text LIKE '%FICTIONAL%' OR metadata ? 'email' OR metadata ? 'reason'))`, 'General audit contains identifiers/status only, not copied evidence or personal details')}`);
  for (const table of newTables) {
    add(`${denied(`INSERT INTO sb.${table} DEFAULT VALUES`)}
     ${denied(`UPDATE sb.${table} SET company_id=company_id`)}
     ${denied(`DELETE FROM sb.${table}`)}`);
  }
  add(`RESET ROLE;
  ${denied('UPDATE sb.verification_checks SET reason=reason')}
  ${denied('DELETE FROM sb.verification_checks')}
  ${denied('UPDATE sb.verification_case_events SET reason=reason')}
  ${denied('DELETE FROM sb.verification_case_events')}
  ${must(`(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sb' AND c.relname IN (${newTables.map(literal).join(',')}) AND c.relrowsecurity AND c.relforcerowsecurity)=4`, 'All Sentinel tables enforce FORCE RLS')}
  ${must(`NOT EXISTS(SELECT FROM pg_roles WHERE rolname='shadowbridge_sentinel' AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))`, 'Worker is NOLOGIN NOINHERIT with no privileged role flags')}
  ${must(`NOT EXISTS(SELECT FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='shadowbridge_sentinel') OR member=(SELECT oid FROM pg_roles WHERE rolname='shadowbridge_sentinel'))`, 'Worker has no inherited memberships')}
  CREATE SCHEMA h3a_private_vault_canary;
  CREATE TABLE h3a_private_vault_canary.secret(value text);
  INSERT INTO h3a_private_vault_canary.secret VALUES('FICTIONAL canary only; no real owner CRM is loaded');
  REVOKE ALL ON SCHEMA h3a_private_vault_canary FROM PUBLIC;
  REVOKE ALL ON h3a_private_vault_canary.secret FROM PUBLIC;`);
  for (const role of ['shadowbridge_sentinel', 'shadowbridge_sessions', 'supabase_auth_admin']) {
    add(`RESET ROLE; SET LOCAL ROLE ${role};
     ${denied('SELECT * FROM sb.verification_cases')}
     ${denied(`SELECT ${callOpen(buyer.companyId)}`)}
     ${denied('SELECT * FROM h3a_private_vault_canary.secret')}`);
  }
  add(`RESET ROLE; SET LOCAL ROLE shadowbridge_sentinel;
  ${denied('SELECT * FROM auth.users')}
  ${denied('SELECT * FROM auth.mfa_factors')}
  ${denied('SELECT * FROM sb.sessions')}
  ${denied('SELECT * FROM sb.staff_role_assignments')}
  ${denied('SELECT * FROM sb.companies')}
  RESET ROLE;`);
  group('append-only evidence/history, minimal audit, FORCE RLS, denied raw writes and worker Auth/Vault isolation');
  add('ROLLBACK;');
  return out.join('\n');
}

async function schemaRegression() {
  const state = await loadBaseline();
  const migrationPath = path.join(repositoryRoot, 'supabase/migrations', migrationName);
  const source = await readFile(migrationPath, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  results.migrationSha256 = digest;
  const before = fingerprints();
  const originalLedger = JSON.parse(sql('SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));
  const initialCount = originalLedger.length;
  assert.equal(initialCount, args.includes('--test-applied') ? 15 : 14);
  if (initialCount === 14) {
    await phase('001–014 migration provenance and fictional-only credentials verified', async () => {
      for (const row of originalLedger) {
        const originalSource = await readFile(path.join(repositoryRoot, 'supabase/migrations', row.name));
        assert.equal(createHash('sha256').update(originalSource).digest('hex'), row.sha256);
      }
      assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='shadowbridge_sentinel'"), '0');
    });
    await phase('pre-existing worker role fails closed with full transaction rollback', async () => {
      const collision = source.replace(/BEGIN\s*;/i, 'BEGIN; CREATE ROLE shadowbridge_sentinel NOLOGIN;');
      assert.throws(() => sql('\\set VERBOSITY verbose\n' + collision), error => /42501/.test(String(error.stderr)));
      assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='shadowbridge_sentinel'"), '0');
      assert.equal(sql("SELECT to_regclass('sb.company_verifications') IS NULL"), 't');
      assert.deepEqual(fingerprints(), before);
    });
    await phase('complete 015 transaction dry-run rolls back without modifying preserved records', async () => {
      const candidate = source.replace(/COMMIT\s*;\s*$/i, '') + '\n' + functionalRegression(state).replace(/^\s*BEGIN\s*;/i, '');
      const output = sql(candidate);
      assert.equal(output.split('\n').filter(line => line.startsWith('GROUP_PASS: ')).length, 4);
      assert.equal(sql("SELECT to_regclass('sb.company_verifications') IS NULL"), 't');
      assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='shadowbridge_sentinel'"), '0');
      assert.equal(sql('SELECT count(*) FROM shadowbridge_migrations.applied'), '14');
      assert.deepEqual(fingerprints(), before);
    });
    if (args.includes('--preflight-only')) { results.actualUpgradeTested = false; return; }
    assert.ok(args.includes('--apply-015'), 'Persistent isolated migration requires explicit --apply-015 after review');
    await phase('private pre-upgrade dump and protected-table fingerprints preserved', async () => {
      const backupName = `h3-before015-${Date.now()}.dump`;
      const backupPath = path.join(directory, backupName);
      const backup = docker(['exec', pgContainer, 'pg_dump', '-U', 'postgres', '-d', 'shadowbridge', '-Fc'], { encoding: null });
      await writeFile(backupPath, backup, { mode: 0o600, flag: 'wx' });
      assert.equal((await lstat(backupPath)).mode & 0o777, 0o600);
      assert.ok(backup.length > 1000);
      results.backup = { bytes: backup.length, mode: '0600', verifiedLocally: true };
      await writeFile(path.join(directory, 'h3-before015-fingerprints.json'), JSON.stringify({ protected: before, ledger: originalLedger, migrationSha256: digest }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    });
    await phase('actual TLS migrator upgrades preserved 014 database to 015 atomically', async () => {
      const override = path.join(directory, 'h3-migrations-override.json');
      await writeFile(override, JSON.stringify({ services: { migrator: { volumes: [`${path.join(repositoryRoot, 'supabase/migrations')}:/app/supabase/migrations:ro`] } } }, null, 2) + '\n', { mode: 0o600 });
      const output = compose(['-f', override, 'run', '--rm', '--no-deps', 'migrator']);
      assert.match(output, /15 tracked, 1 applied/);
      assert.equal(sql(`SELECT sha256 FROM shadowbridge_migrations.applied WHERE name=${literal(migrationName)}`), digest);
      assert.deepEqual(fingerprints(), before, 'Migration must preserve accounts, password hashes, memberships, all sessions, factors and grants byte-for-byte');
      const afterLedger = JSON.parse(sql('SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));
      assert.deepEqual(afterLedger.slice(0, 14), originalLedger);
      results.actualUpgradeTested = true;
    });
  } else {
    const stored = JSON.parse(await readFile(path.join(directory, 'h3-before015-fingerprints.json'), 'utf8'));
    assert.equal(stored.migrationSha256, digest, 'Applied migration cannot change');
    assert.deepEqual(before, stored.protected, 'Preserved data must still match pre-upgrade baseline');
  }
  await phase('migrator replay skips 015 and preserves schema, credentials, sessions and MFA', async () => {
    const output = compose(['-f', path.join(directory, 'h3-migrations-override.json'), 'run', '--rm', '--no-deps', 'migrator']);
    assert.match(output, /15 tracked, 0 applied/);
    assert.deepEqual(fingerprints(), before);
  });
  await phase('real PostgreSQL authorization, company review, evidence and history regression', async () => {
    const script = functionalRegression(state);
    await writeFile(path.join(directory, 'h3a-functional-regression.sql'), script, { mode: 0o600 });
    const output = sql(script);
    const groups = output.split('\n').filter(line => line.startsWith('GROUP_PASS: ')).map(line => line.slice(12));
    assert.equal(groups.length, 4);
    for (const name of groups) results.cases.push({ name, result: 'PASS', engine: 'real PostgreSQL', writesRolledBack: true });
    assert.deepEqual(fingerprints(), before, 'Functional tests roll back all existing-data changes');
    for (const table of newTables) assert.equal(sql(`SELECT count(*) FROM sb.${table}`), '0');
    assert.equal(sql("SELECT to_regnamespace('h3a_private_vault_canary') IS NULL"), 't');
  });
  results.protectedDataUnchanged = true;
}

async function liveAuthenticationRegression() {
  const state = await loadBaseline();
  await phase('existing isolated TLS services start without demo bootstrap or external mail', async () => {
    compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'mailpit', 'auth', 'app', 'gateway']);
    appContainer = container('app');
    assert.ok(appContainer);
  });
  await withRealAuth(async h => {
    const hydrate = actor => {
      const client = new h.Client();
      client.cookies = new Map(actor.client.cookies); client.csrf = actor.client.csrf;
      return { ...actor, client };
    };
    await phase('preserved cookies resume approved tenants and all seven real MFA staff sessions', async () => {
      for (const [key, saved] of [...Object.entries(state.actors).filter(([key]) => key !== 'unverified'), ...Object.entries(state.staff)]) {
        const actor = hydrate(saved);
        const session = (await actor.client.request('/api/session', { expected: 200 })).data;
        assert.equal(session.user?.id, actor.user.id, 'Preserved fictional session must retain its identity');
        assert.equal(session.user.emailVerified, true);
        if (key === 'owner' || state.staff[key]) {
          assert.equal(session.user.aal, 'aal2');
          await actor.client.request('/api/staff/access', { expected: 200 });
          await actor.client.request('/api/staff/overview', { expected: 200 });
        } else {
          await actor.client.request('/api/staff/access', { expected: 403 });
          if (key === 'buyer' || key === 'coMember') await actor.client.request('/api/rfqs', { expected: 200 });
          if (key === 'partner') {
            await actor.client.request('/api/projects', { expected: 200 });
            await actor.client.request('/api/commissions', { expected: 200 });
          }
          if (key === 'supplier') {
            assert.equal(session.user.applicationStatus, 'pending');
            await actor.client.request('/api/offers', { expected: 403 });
          }
        }
      }
    });
    await phase('unchanged owner password requires real GoTrue MFA before operational access and rejects invalid CSRF', async () => {
      const owner = { ...state.actors.owner, client: new h.Client() };
      const login = await owner.client.signIn(owner);
      assert.equal(login.session.user.id, owner.user.id);
      await owner.client.request('/api/staff/access', { expected: 403 });
      await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: owner.factorId, code: h.totp(owner.mfaSecret) }, expected: 200 });
      const session = (await owner.client.request('/api/session', { expected: 200 })).data;
      assert.equal(session.user.aal, 'aal2');
      const access = (await owner.client.request('/api/staff/access', { expected: 200 })).data;
      assert.equal(access.owner, true);
      assert.ok(access.permissions.includes('sentinel.read'));
      await owner.client.request('/api/auth/logout', { method: 'POST', body: {}, csrf: false, expected: 403 });
      assert.equal((await owner.client.request('/api/session', { expected: 200 })).data.user.id, owner.user.id);
      // This newly created test session is explicitly logged out. Historical
      // fixture cookies, accounts, MFA factors and user data remain untouched.
      await owner.client.request('/api/auth/logout', { method: 'POST', body: {}, expected: 200 });
      assert.equal((await owner.client.request('/api/session', { expected: 200 })).data.user, null);
    });
  });
  results.actualProviderAuthenticationTested = true;
}

try {
  if (args.includes('--prepare-baseline')) await prepareBaseline();
  else {
    await schemaRegression();
    if (args.includes('--live-auth') && !args.includes('--preflight-only')) await liveAuthenticationRegression();
  }
  results.result = 'PASS';
} catch (error) {
  results.result = 'FAIL'; results.failedCase = current; results.errorType = error?.name || 'Error';
  await writeFile(path.join(directory, 'h3a-test-failure.json'), JSON.stringify({ case: current, name: error?.name, message: error?.message, stack: error?.stack }, null, 2) + '\n', { mode: 0o600 });
  console.error(`FAIL: ${current}. Private diagnostics retained; no credentials or response bodies logged.`); process.exitCode = 1;
} finally {
  if (args.includes('--stop-fixture')) {
    try { compose(['stop']); results.fixtureStoppedWithoutVolumeRemoval = true; }
    catch { results.fixtureStopFailed = true; process.exitCode = 1; }
  }
  results.finishedAt = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
}
