// Targeted REAL H2-B navigation regression. Requires a NEW H1-guarded local
// PostgreSQL/GoTrue/API/Caddy fixture; never uses the owner's local installation.
// No mock API, fixture password in the repository, external SMTP or VPS access.
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';

const directoryArg = process.argv.find(value => value.startsWith('--dir='))?.slice(6);
assert.ok(directoryArg, 'An explicit new isolated --dir is required');
const checked = await checkStaging({ directory: directoryArg });
assert.match(checked.project, /^shadowbridge-stageg-h1-[a-f0-9]{10}$/);
const directory = checked.directory;
const fixture = JSON.parse(await readFile(path.join(directory, 'h1-fixture.json'), 'utf8'));
assert.equal(fixture.kind, 'shadowbridge-h1-isolated-auth');
assert.equal(fixture.project, checked.project);
assert.match(fixture.snapshot, /^\/tmp\/shadowbridge-h1-source-[a-f0-9]{10}$/);
const generated = await readEnv(path.join(directory, 'compose.env'));
const docker = (args, options = {}) => execFileSync('docker', ['--context', 'default', ...args], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const compose = args => docker(['compose', '--project-name', checked.project, '--env-file', path.join(directory, 'compose.env'), '-f', path.join(repositoryRoot, 'deploy/staging/compose.yaml'), '-f', path.join(directory, 'h1-override.json'), ...args], { env: { ...process.env, ...generated } });
const container = service => docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${checked.project}`, '--filter', `label=com.docker.compose.service=${service}`]).trim();
const appContainer = container('app'), pgContainer = container('postgres');
assert.ok(appContainer && pgContainer, 'The dedicated isolated API/database must be running');
const reportFile = '/tmp/shadowbridge-h2-navigation-regression.json';
const results = { kind: 'real-h2-navigation', project: checked.project, startedAt: new Date().toISOString(), cases: [], externalEmailSent: false, mocksUsed: false };
for (const name of ['assets/dashboard.js', 'assets/portal.js', 'assets/offers-workspace.js']) results[name] = createHash('sha256').update(await readFile(path.join(fixture.snapshot, name))).digest('hex');
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
let browser, context, current = 'isolated TLS fixture readiness';
async function phase(name, work) {
  current = name; await work();
  results.cases.push({ name, result: 'PASS' });
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: ' + name);
}
const modules = page => page.getByRole('navigation', { name: 'Command Center modules', exact: true });
async function ownSession(page, owner) {
  const response = await page.request.get('/api/session');
  assert.equal(response.status(), 200);
  const session = await response.json();
  assert.equal(session.user.id, owner.user.id);
  assert.equal(session.user.aal, 'aal2');
  assert.equal(session.user.staff, true);
  return session;
}
async function moduleSnapshot(page, active) {
  const nav = modules(page);
  await expect(nav).toBeVisible();
  await expect(nav.locator('[aria-current=page]')).toHaveCount(1);
  await expect(nav.locator('[aria-current=page]')).toHaveText(active);
  return nav.locator('a').evaluateAll(items => items.map(item => ({ label: item.textContent, href: item.getAttribute('href') })));
}
try {
  await phase('real TLS reviewer gate and dedicated runtime readiness', async () => {
    assert.equal((await realFetch(checked.origin + '/api/config')).status, 401);
    assert.equal((await fetch(checked.origin + '/api/config')).status, 200);
  });
  let owner;
  await phase('fictional verified OWNER created with the real bootstrap CLI', async () => {
    owner = await h.registerActor('partner', 'h2-navigation-owner');
    await h.verifyActor(owner);
    compose(['run', '--rm', '--no-deps', 'migrator', 'scripts/bootstrap-admin.mjs', `--email=${owner.email}`, '--grant-owner']);
    assert.equal(h.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${h.sqlLiteral(owner.user.id)} AND action='owner.bootstrap'`), '1');
  });
  const certificate = new X509Certificate(await readFile(path.join(directory, 'certs/public.crt')));
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] });
  context = await browser.newContext({ baseURL: checked.origin, httpCredentials: { username: 'reviewer', password: reviewer }, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await phase('real Member Sign In and MFA preserve the management authorization gate', async () => {
    await page.goto('/member-sign-in/');
    const form = page.locator('#sign-in-form');
    await expect(form.locator('[name=email]')).toBeEnabled();
    await form.locator('[name=email]').fill(owner.email);
    await form.locator('[name=password]').fill(owner.password);
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#portal-account')).toContainText(owner.email);
    await page.goto('/portal/offers/');
    await expect(page.locator('#offers-status')).toContainText('MFA required.');
    await expect(modules(page)).toHaveCount(0);
    assert.equal((await page.request.get('/api/staff/offers')).status(), 403);
    await page.goto('/portal/admin/');
    await expect(page.getByRole('heading', { name: 'Management security verification', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Set up authenticator app', exact: true }).click();
    await expect(page.locator('.portal-mfa-secret')).toBeVisible();
    const secret = await page.locator('.portal-mfa-secret').textContent();
    await page.getByLabel('Six-digit authenticator code', { exact: true }).fill(h.totp(secret));
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/mfa/verify' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Verify second factor', exact: true }).click();
    assert.equal((await verified).status(), 200);
    await expect(page.getByRole('heading', { name: 'Owner Overview', exact: true })).toBeVisible();
    await expect(page.locator('.portal-mfa-secret')).toHaveCount(0);
    await ownSession(page, owner);
  });
  const baseline = await moduleSnapshot(page, 'Overview');
  for (const label of ['Overview', 'Applications', 'Companies', 'Offers', 'Buyer requests', 'Projects', 'Team and access', 'Activity log']) assert.ok(baseline.some(item => item.label === label), 'The complete OWNER module menu must be present');
  const cookie = (await context.cookies()).find(item => item.name === '__Host-sb_session')?.value;
  assert.ok(cookie, 'A secure opaque BFF session is required');
  for (const width of [1440, 390, 320]) {
    await phase(`consistent Overview–Offers–Buyer requests–Companies navigation at ${width}px preserves the AAL2 session`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      const steps = [
        ['Offers', '/portal/offers/', 'Offers Workspace'],
        ['Buyer requests', '/portal/admin/?module=rfqs', 'Buyer request review'],
        ['Companies', '/portal/admin/?module=companies', 'Internal companies'],
        ['Overview', '/portal/admin/', 'Owner Overview'],
      ];
      for (const [label, destination, heading] of steps) {
        await modules(page).getByRole('link', { name: label, exact: true }).click();
        await expect(page).toHaveURL(checked.origin + destination);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        assert.deepEqual(await moduleSnapshot(page, label), baseline, 'Offers and every admin module must share the same complete permission-filtered navigation');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The page must fit the viewport without horizontal document scrolling');
        await ownSession(page, owner);
        assert.equal((await context.cookies()).find(item => item.name === '__Host-sb_session')?.value, cookie, 'Module navigation must retain the same authenticated BFF session');
        for (const link of await modules(page).getByRole('link').all()) assert.ok((await link.boundingBox()).height >= 44, 'Mobile and desktop module links must retain usable tap targets');
      }
    });
  }
  await phase('logout in another tab clears both Offers and Command Center private navigation and records', async () => {
    const offers = await context.newPage(); await offers.goto('/portal/offers/');
    await moduleSnapshot(offers, 'Offers');
    const signout = await context.newPage(); await signout.goto('/portal/admin/');
    await moduleSnapshot(signout, 'Overview');
    await signout.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(signout).toHaveURL(checked.origin + '/member-sign-in/');
    await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
    await expect(offers.locator('#offers-status')).toContainText('Browser session changed.');
    for (const stale of [page, offers]) {
      await expect(modules(stale)).toHaveCount(0);
      await expect(stale.locator('.dashboard-module-slot')).toBeEmpty();
      await expect(stale.locator('[data-command-dashboard]')).toHaveCount(0);
      assert.equal((await (await stale.request.get('/api/session')).json()).user, null);
      assert.deepEqual(await stale.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    }
    await expect(offers.locator('#offers-grid')).toBeEmpty();
    assert.equal((await offers.request.get('/api/staff/offers')).status(), 401);
    await offers.goto('/portal/offers/');
    // The server protects private HTML too: a logged-out navigation redirects
    // to Member Sign In before any Offers interface or private data is served.
    await expect(offers).toHaveURL(checked.origin + '/member-sign-in/');
    await expect(offers.locator('#sign-in-form')).toBeVisible();
    await expect(modules(offers)).toHaveCount(0);
  });
  results.result = 'PASS';
} catch (error) {
  results.result = 'FAIL'; results.failedCase = current; results.errorType = error?.name || 'Error';
  await writeFile(path.join(directory, 'h2-navigation-failure.json'), JSON.stringify({ case: current, name: error?.name, message: error?.message, stack: error?.stack }, null, 2) + '\n', { mode: 0o600 });
  console.error(`FAIL: ${current}. Private diagnostic retained; no credentials or request bodies logged.`);
  process.exitCode = 1;
} finally {
  results.finishedAt = new Date().toISOString();
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  if (context) await context.close();
  if (browser) await browser.close();
  await new Promise(resolve => mailProxy.close(resolve));
  globalThis.fetch = realFetch;
}
