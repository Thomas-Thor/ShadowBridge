// REAL local H1 authentication regression. No mocks, demo accounts, image build,
// external SMTP or VPS connection. Prepare/start/test are intentionally separate.
import assert from 'node:assert/strict';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, cp, readdir, lstat, chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { prepareStaging, checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { migrationSources } from '../scripts/staging-migrate.mjs';

const args = process.argv.slice(2);
const action = args.find(value => ['--prepare', '--start', '--test', '--stop'].includes(value));
const arg = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const docker = (parts, options = {}) => execFileSync('docker', ['--context', 'default', ...parts], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const reportFile = '/tmp/shadowbridge-h1-auth-results.json';
const sourcePaths = ['package.json','package-lock.json','index.html','robots.txt','sitemap.xml','server','assets','apply','member-sign-in','legal','cartel','portal','scripts/staging-migrate.mjs','scripts/bootstrap-admin.mjs','supabase/migrations'];
async function readableSource(directory) {
  const stat = await lstat(directory);
  assert.equal(stat.isSymbolicLink(), false, 'Source snapshot refuses symlinks');
  await chmod(directory, stat.isDirectory() ? 0o755 : 0o644);
  if (stat.isDirectory()) for (const child of await readdir(directory)) await readableSource(path.join(directory, child));
}
async function snapshotSource(snapshot) {
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  for (const [name, item] of Object.entries(lock.packages)) if (name.startsWith('node_modules/')) {
    const installed = JSON.parse(await readFile(path.join(repositoryRoot, name, 'package.json'), 'utf8'));
    assert.equal(installed.version, item.version, 'Existing dependency differs from the pinned lockfile');
  }
  for (const name of [...sourcePaths, 'node_modules']) {
    const target = path.join(snapshot, name);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await cp(path.join(repositoryRoot, name), target, { recursive: true, force: true,
      filter: source => !source.includes('/server/tests') && !/\/assets\/prototypes\.(?:js|css)$/.test(source) });
  }
  await readableSource(snapshot);
  for (const forbidden of ['.local','.git','tests','prototypes']) {
    await assert.rejects(lstat(path.join(snapshot, forbidden)), { code: 'ENOENT' });
  }
}
async function configuration() {
  assert.ok(arg('dir'), 'Pass the NEW prepared --dir explicitly');
  const checked = await checkStaging({ directory: arg('dir') });
  assert.match(checked.project, /^shadowbridge-stageg-h1-[a-f0-9]{10}$/);
  const fixture = JSON.parse(await readFile(path.join(checked.directory, 'h1-fixture.json'), 'utf8'));
  assert.equal(fixture.kind, 'shadowbridge-h1-isolated-auth');
  assert.equal(fixture.project, checked.project);
  assert.match(fixture.snapshot, /^\/tmp\/shadowbridge-h1-source-[a-f0-9]{10}$/);
  const generated = await readEnv(path.join(checked.directory, 'compose.env'));
  return { ...checked, fixture, environment: { ...process.env, ...generated } };
}
function compose(checked, parts, options = {}) {
  return docker(['compose', '--project-name', checked.project, '--env-file', path.join(checked.directory,'compose.env'), '-f', path.join(repositoryRoot,'deploy/staging/compose.yaml'), '-f', path.join(checked.directory,'h1-override.json'), ...parts], { env: checked.environment, ...options });
}
async function prepare() {
  assert.equal(arg('dir'), undefined, 'Preparation always chooses a fresh random directory');
  const id = randomBytes(5).toString('hex');
  const checked = await prepareStaging({ directory: `.local/h1-test-${id}`, project: `shadowbridge-stageg-h1-${id}`, httpsPort: Number(arg('port') || 18445), httpPort: 18446 });
  const snapshot = `/tmp/shadowbridge-h1-source-${id}`;
  await mkdir(snapshot, { mode: 0o755 });
  await snapshotSource(snapshot);
  const node = 'node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f';
  // Private proxy exclusions are intentionally inherited from the REAL Compose
  // source, not duplicated here, so the regression covers its security settings.
  const base = { image: node, build: null, user: '1000:1000', working_dir: '/app', volumes: [`${snapshot}:/app:ro`] };
  const override = { services: { app: { ...base, entrypoint: ['node'], command: ['server/app.mjs'] }, migrator: { ...base, entrypoint: ['node'], command: ['scripts/staging-migrate.mjs'] } } };
  await writeFile(path.join(checked.directory,'h1-override.json'),JSON.stringify(override,null,2)+'\n',{mode:0o600,flag:'wx'});
  await writeFile(path.join(checked.directory,'h1-fixture.json'),JSON.stringify({kind:'shadowbridge-h1-isolated-auth',project:checked.project,snapshot})+'\n',{mode:0o600,flag:'wx'});
  console.log(`PREPARED: ${checked.directory}\nCA: ${checked.directory}/certs/internal-ca.crt\nNo services started; existing configuration unchanged.`);
}
async function start(checked) {
  assert.equal(docker(['ps','-aq','--filter',`label=com.docker.compose.project=${checked.project}`]).trim(), '', 'Fresh test project already has containers');
  assert.equal(docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${checked.project}`]).trim(), '', 'Fresh test project already has a volume');
  await snapshotSource(checked.fixture.snapshot);
  compose(checked,['config','--quiet']);
  compose(checked,['up','-d','--no-build','--wait','--wait-timeout','120','postgres','mailpit','auth']);
  compose(checked,['run','--rm','--no-deps','migrator']);
  compose(checked,['up','-d','--no-build','--wait','--wait-timeout','120','app','gateway']);
  console.log('STARTED: isolated PostgreSQL/GoTrue/API/Caddy; cached Node image and read-only source, no image build.');
}
async function test(checked) {
  const results = { kind: 'h1-real-auth-integration', project: checked.project, cases: [], externalEmailSent: false, imageBuildTested: false };
  let current = 'initialization', browser, mailProxy;
  const originalFetch = globalThis.fetch;
  const reviewer = (await readFile(path.join(checked.directory,'tester-password'),'utf8')).trim();
  const basic = 'Basic '+Buffer.from(`reviewer:${reviewer}`).toString('base64');
  globalThis.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin === checked.origin) { const headers = new Headers(options.headers); headers.set('Authorization',basic); options = { ...options, headers }; }
    return originalFetch(input, options);
  };
  const run = async (name, work) => { current = name; await work(); results.cases.push({ name, result: 'PASS' }); console.log('PASS: '+name); };
  try {
    const appContainer = compose(checked,['ps','-q','app']).trim(), pgContainer = compose(checked,['ps','-q','postgres']).trim();
    assert.ok(appContainer && pgContainer, 'Isolated app/database must be running');
    process.env.SHADOWBRIDGE_TEST_URL = checked.origin;
    process.env.SHADOWBRIDGE_DB_CONTAINER = pgContainer;
    process.env.SHADOWBRIDGE_TEST_DATABASE = 'shadowbridge';
    process.env.DOCKER_CONTEXT = 'default';
    mailProxy = createServer((req,res) => {
      if (req.method !== 'GET' || !/^\/api\/v1\/(?:messages|message\/[a-zA-Z0-9-]+)(?:\?.*)?$/.test(req.url || '')) { res.writeHead(404);return res.end(); }
      try {
        const payload = docker(['exec',appContainer,'node','-e',`fetch(${JSON.stringify('http://mailpit:8025'+req.url)}).then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`]);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(payload);
      } catch { res.writeHead(502);res.end('{}'); }
    });
    await new Promise(resolve => mailProxy.listen(0,'127.0.0.1',resolve));
    process.env.SHADOWBRIDGE_MAILPIT_URL = `http://127.0.0.1:${mailProxy.address().port}`;
    const h = await import('../server/tests/helpers.mjs');
    const require = createRequire(import.meta.url);
    const {loadTestDependency} = require('./dependencies.cjs');
    const {chromium,expect} = loadTestDependency('@playwright/test');
    const cert = new X509Certificate(await readFile(path.join(checked.directory,'certs/public.crt')));
    const pin = createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
    browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox',`--ignore-certificate-errors-spki-list=${pin}`]});
    await run('TLS, private reviewer gate and actual source migration history',async()=>{
      assert.equal((await originalFetch(checked.origin+'/api/config')).status,401);
      const config = await fetch(checked.origin+'/api/config');assert.equal(config.status,200);
      assert.equal((await config.json()).environment,'production');
      assert.equal(h.db('SELECT count(*) FROM shadowbridge_migrations.applied'),String((await migrationSources()).length));
      assert.equal(h.db("SELECT count(*) FROM pg_roles WHERE rolname IN ('shadowbridge_api','shadowbridge_sessions') AND (rolsuper OR rolbypassrls)"),'0');
    });
    let owner;
    await run('real email confirmation is mandatory before explicit OWNER bootstrap',async()=>{
      owner = await h.registerActor('partner','h1-owner');
      let refused = false;
      try { compose(checked,['run','--rm','--no-deps','migrator','scripts/bootstrap-admin.mjs',`--email=${owner.email}`,'--grant-owner']); } catch { refused = true; }
      assert.equal(refused,true,'Unverified account must not receive OWNER');
      await h.verifyActor(owner);
      compose(checked,['run','--rm','--no-deps','migrator','scripts/bootstrap-admin.mjs',`--email=${owner.email}`,'--grant-owner']);
      assert.equal(h.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${h.sqlLiteral(owner.user.id)} AND action='owner.bootstrap'`),'1');
      await owner.client.request('/api/staff/overview',{expected:403});
    });
    await run('session cookies and CSRF reject missing tokens and foreign origins',async()=>{
      const separate = new h.Client();await separate.request('/api/config',{expected:200});
      const signed = await separate.request('/api/auth/login',{method:'POST',body:{email:owner.email,password:owner.password},expected:200});
      assert.equal(signed.headers.getSetCookie().some(value=>value.includes('__Host-sb_session=')&&/HttpOnly/i.test(value)&&/Secure/i.test(value)),true);
      await separate.request('/api/auth/logout',{method:'POST',body:{},csrf:false,expected:403});
      await separate.request('/api/auth/logout',{method:'POST',body:{},origin:'https://foreign.invalid',expected:403});
      await separate.request('/api/auth/logout',{method:'POST',body:{},expected:200});
      assert.equal((await separate.request('/api/session',{expected:200})).data.user,null);
    });
    const context = await browser.newContext({baseURL:checked.origin,httpCredentials:{username:'reviewer',password:reviewer},viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    try {
      const page = await context.newPage();
      await run('Member Sign In and first authenticator enrollment unlock OWNER only after MFA',async()=>{
        await page.goto('/member-sign-in/');
        const form = page.locator('#sign-in-form');await expect(form.locator('[name=email]')).toBeEnabled();
        await form.locator('[name=email]').fill(owner.email);await form.locator('[name=password]').fill(owner.password);await form.locator('button[type=submit]').click();
        await expect(page.locator('#portal-account')).toContainText(owner.email);await page.goto('/portal/admin/');
        await expect(page.getByRole('heading',{name:'Management security verification',exact:true})).toBeVisible();
        assert.equal((await page.request.get('/api/staff/overview')).status(),403);
        await page.getByRole('button',{name:'Set up authenticator app',exact:true}).click();
        await expect(page.locator('.portal-mfa-secret')).toBeVisible();
        const secret = await page.locator('.portal-mfa-secret').textContent();
        await page.getByLabel('Six-digit authenticator code',{exact:true}).fill(h.totp(secret));
        const verified = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/mfa/verify'&&response.request().method()==='POST');
        await page.getByRole('button',{name:'Verify second factor',exact:true}).click();assert.equal((await verified).status(),200);
        await expect(page.getByRole('heading',{name:'Owner Overview',exact:true})).toBeVisible();
        assert.equal((await (await page.request.get('/api/session')).json()).user.aal,'aal2');
        await expect(page.locator('.portal-mfa-secret')).toHaveCount(0);
      });
      await run('desktop/mobile Command Center and two-tab logout clear private content',async()=>{
        for(const width of [1440,390,320]) {await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
        await page.setViewportSize({width:1440,height:1000});
        await page.screenshot({path:'/tmp/shadowbridge-h1-owner-1440.png',fullPage:false});
        const other = await context.newPage();await other.goto('/portal/admin/');
        await expect(other.getByRole('heading',{name:'Owner Overview',exact:true})).toBeVisible();
        await other.getByRole('button',{name:'Sign out',exact:true}).click();
        await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
        await expect(page.locator('[data-command-dashboard]')).toHaveCount(0);
        await expect(page.locator('.dashboard-module-slot')).toBeEmpty();
        assert.equal((await (await page.request.get('/api/session')).json()).user,null);
        assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
      });
    } finally {await context.close();}
    results.result = 'PASS';
  } catch(error) {
    results.result = 'FAIL';results.failedCase = current;results.errorType = error?.name || 'Error';
    await writeFile(path.join(checked.directory,'h1-test-failure.json'),JSON.stringify({case:current,name:error?.name,message:error?.message,stack:error?.stack},null,2)+'\n',{mode:0o600});
    console.error(`FAIL: ${current} (${results.errorType}); private details retained, no raw identity/secret data logged.`);process.exitCode = 1;
  } finally {
    if(browser)await browser.close();if(mailProxy)await new Promise(resolve=>mailProxy.close(resolve));globalThis.fetch = originalFetch;
    await writeFile(reportFile,JSON.stringify(results,null,2)+'\n',{mode:0o600});
  }
}
try {
  if(action==='--prepare')await prepare();
  else {const checked=await configuration();if(action==='--start')await start(checked);else if(action==='--test')await test(checked);else if(action==='--stop'){compose(checked,['stop']);console.log('Only isolated H1 services stopped; all containers and volumes retained.');}else throw new Error('Use --prepare, --start, --test or --stop.');}
} catch(error) {
  const directory = arg('dir') && path.resolve(repositoryRoot,arg('dir'));
  if(directory?.startsWith(path.join(repositoryRoot,'.local/h1-test-'))) await writeFile(path.join(directory,'h1-setup-failure.json'),JSON.stringify({action,name:error?.name,message:error?.message,stderr:error?.stderr?.toString()},null,2)+'\n',{mode:0o600}).catch(()=>{});
  console.error(`H1 integration stopped (${error?.name||'Error'}). No original installation was targeted.`);process.exitCode=1;
}
