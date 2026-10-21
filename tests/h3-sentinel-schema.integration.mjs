// H3-A preparation harness; Sentinel schema assertions are not implemented yet.
// A successful baseline preparation is NOT a passing H3-A migration test.
// Only an explicit guarded fictional fixture is
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
const appContainer = container('app'), pgContainer = container('postgres');
assert.ok(appContainer && pgContainer, 'The dedicated fictional API/database must be running');
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
  'staff_overrides',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id,permission)::text,'[]')) FROM sb.staff_permission_overrides t)
)::text`));

async function withRealAuth(work) {
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

try {
  if (args.includes('--prepare-baseline')) await prepareBaseline();
  else throw new Error('Use --prepare-baseline first; the schema contract test is not ready yet.');
  results.result = 'PASS';
} catch (error) {
  results.result = 'FAIL'; results.failedCase = current; results.errorType = error?.name || 'Error';
  await writeFile(path.join(directory, 'h3a-test-failure.json'), JSON.stringify({ case: current, name: error?.name, message: error?.message, stack: error?.stack }, null, 2) + '\n', { mode: 0o600 });
  console.error(`FAIL: ${current}. Private diagnostics retained; no credentials or response bodies logged.`); process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
}
