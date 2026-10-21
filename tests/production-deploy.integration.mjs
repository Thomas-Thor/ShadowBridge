// Real public-profile integration, restricted to a NEW fictional Docker project.
// Public hostname is resolved to loopback. SMTP is overridden to private Mailpit;
// this runner never connects to Gmail, Contabo, public DNS, or an owner's DB.
import assert from 'node:assert/strict';
import https from 'node:https';
import { createServer } from 'node:http';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { prepareStaging, checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { prepareProduction, checkProduction } from '../scripts/production-config.mjs';
import { backupStaging } from '../scripts/staging-backup.mjs';
import { databaseFingerprints, proveBackup, verifyPublic } from '../scripts/production-ops.mjs';

const args = process.argv.slice(2);
const action = args[0];
const dirArg = args.find(value => value.startsWith('--dir='))?.slice(6);
const root = repositoryRoot;
const output = '/tmp/shadowbridge-production-integration-results.json';
const docker = (parts, options={}) => execFileSync('docker',['--context','default',...parts], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024,...options});
const sha = value => createHash('sha256').update(value).digest('hex');
let imageApp = args.find(value => value.startsWith('--image-app='))?.slice(12) || 'shadowbridge-production-test-app:latest';
let imageMigrator = args.find(value => value.startsWith('--image-migrator='))?.slice(17) || 'shadowbridge-production-test-migrator:latest';
function validateImages(app, migrator) {
  assert.match(app, /^shadowbridge-production-test-app:[A-Za-z0-9_.-]{1,128}$/, 'Use an explicitly built local test app image');
  assert.match(migrator, /^shadowbridge-production-test-migrator:[A-Za-z0-9_.-]{1,128}$/, 'Use an explicitly built local test migrator image');
}
validateImages(imageApp, imageMigrator);

async function prepare() {
  assert.equal(dirArg, undefined, 'Preparation always creates a fresh random fixture');
  const id=randomBytes(5).toString('hex');
  const checked=await prepareStaging({directory:'.local/production-test-'+id,project:'shadowbridge-stageg-production-'+id,httpsPort:18465,httpPort:18466});
  const releaseSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const production=await prepareProduction({directory:checked.directory,smtpPassword:randomBytes(8).toString('hex'),releaseSha});
  assert.equal(docker(['ps','-aq','--filter','label=com.docker.compose.project='+checked.project]).trim(),'');
  assert.equal(docker(['volume','ls','-q','--filter','label=com.docker.compose.project='+checked.project]).trim(),'');
  const certs=path.join(checked.directory,'certs');
  const openssl=parts=>execFileSync('openssl',parts,{stdio:['ignore','pipe','pipe']});
  const ext=path.join(certs,'production-test.ext');
  await writeFile(ext,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:shadow-bridge.eu\n',{mode:0o600});
  openssl(['req','-new','-newkey','rsa:3072','-nodes','-keyout',path.join(certs,'production-test.key'),'-out',path.join(certs,'production-test.csr'),'-subj','/CN=shadow-bridge.eu']);
  openssl(['x509','-req','-in',path.join(certs,'production-test.csr'),'-CA',path.join(certs,'internal-ca.crt'),'-CAkey',path.join(certs,'internal-ca.key'),'-set_serial','0x'+randomBytes(16).toString('hex'),'-days','2','-sha256','-extfile',ext,'-out',path.join(certs,'production-test.crt')]);
  let caddy=await readFile(path.join(production.directory,'Caddyfile'),'utf8');
  caddy=caddy.replace('{\n','{\n\tauto_https disable_redirects\n').replace('https://shadow-bridge.eu {','https://shadow-bridge.eu {\n\ttls /run/secrets/test-public.crt /run/secrets/test-public.key');
  const testCaddy=path.join(checked.directory,'production-test.Caddyfile');
  await writeFile(testCaddy,caddy,{mode:0o600});
  const config=JSON.parse(docker(['compose','--profile','tools','--project-name',checked.project,'--env-file',path.join(production.directory,'compose.env'),'-f',path.join(root,'deploy/production/compose.yaml'),'config','--format','json'],{env:{...process.env,...production.composeEnvironment}}));
  config.services.app.image=imageApp; delete config.services.app.build;
  config.services.migrator.image=imageMigrator; delete config.services.migrator.build;
  // No external network on Auth during tests: every SMTP message is fictional.
  config.services.auth.networks={private:null};
  Object.assign(config.services.auth.environment,{GOTRUE_SMTP_HOST:'mailpit',GOTRUE_SMTP_PORT:'1025',GOTRUE_SMTP_USER:'',GOTRUE_SMTP_PASS:'',GOTRUE_SMTP_ADMIN_EMAIL:'test-auth@shadowbridge.invalid',GOTRUE_RATE_LIMIT_EMAIL_SENT:'200',GOTRUE_SMTP_MAX_FREQUENCY:'1s'});
  config.services.gateway.ports=[{target:443,published:'443',host_ip:'127.0.0.1',protocol:'tcp'}];
  config.services.gateway.volumes=config.services.gateway.volumes.map(v=>v.target==='/etc/caddy/Caddyfile'?{...v,source:testCaddy}:v);
  config.services.gateway.secrets.push({source:'test-public.crt',target:'test-public.crt'},{source:'test-public.key',target:'test-public.key'});
  config.secrets['test-public.crt']={file:path.join(certs,'production-test.crt')};
  config.secrets['test-public.key']={file:path.join(certs,'production-test.key')};
  await writeFile(path.join(checked.directory,'production-test.compose.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  await writeFile(path.join(checked.directory,'production-test-fixture.json'),JSON.stringify({kind:'shadowbridge-production-isolated-v1',project:checked.project,releaseSha,createdAt:new Date().toISOString(),images:{app:imageApp,migrator:imageMigrator}},null,2)+'\n',{mode:0o600});
  console.log('PREPARED: '+checked.directory);
}
async function fixture() {
  assert.ok(dirArg,'Explicit --dir required');
  const checked=await checkStaging({directory:dirArg});
  assert.match(checked.project,/^shadowbridge-stageg-production-[a-f0-9]{10}$/);
  const file=path.join(checked.directory,'production-test-fixture.json');
  assert.equal((await lstat(file)).mode&0o777,0o600);
  const f=JSON.parse(await readFile(file,'utf8'));assert.equal(f.kind,'shadowbridge-production-isolated-v1');assert.equal(f.project,checked.project);
  validateImages(f.images?.app, f.images?.migrator);
  imageApp=f.images.app;imageMigrator=f.images.migrator;
  const production=await checkProduction({directory:checked.directory});
  const compose=(parts,options={})=>docker(['compose','--project-name',checked.project,'-f',path.join(checked.directory,'production-test.compose.json'),...parts],options);
  return {...checked,f,production,compose};
}
function sql(c,query) {return c.compose(['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',query]).trim();}
async function start(c) {
  assert.equal(docker(['ps','-aq','--filter','label=com.docker.compose.project='+c.project]).trim(),'','Start requires a new fixture without containers');
  c.compose(['up','-d','--no-build','--wait','--wait-timeout','120','postgres','mailpit','auth']);
  c.compose(['run','--rm','--no-deps','migrator']);
  c.compose(['up','-d','--no-build','--wait','--wait-timeout','120','app','gateway']);
  assert.equal(sql(c,'SELECT count(*) FROM shadowbridge_migrations.applied'),'15');
  console.log('STARTED: real public profile on loopback443; no public service or real SMTP');
}
async function test(c) {
  let prior=null;
  if(args.includes('--resume')) {
    prior=JSON.parse(await readFile(output,'utf8'));
    assert.equal(prior.kind,'real-production-profile-integration');assert.equal(prior.project,c.project,'Resume results must belong to this explicit fixture');
  }
  const results=prior||{kind:'real-production-profile-integration',project:c.project,startedAt:new Date().toISOString(),cases:[],mocksUsed:false,externalEmailSent:false,publicAcmeTested:false,productionDomainDeployed:false,imageBuildTested:true};
  delete results.failedCase;delete results.errorType;delete results.result;
  let current='readiness',browser,mailProxy;
  const actors={},records={};
  const originalFetch=globalThis.fetch;
  const ca=await readFile(path.join(c.directory,'certs/internal-ca.crt'));
  const appOrigin='https://localhost:18465';
  const realTransport=(input,options={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(![appOrigin,'https://shadow-bridge.eu'].includes(url.origin))return originalFetch(input,options);
    const headers=new Headers(options.headers);
    headers.set('Host','shadow-bridge.eu');
    if(headers.has('Origin')&&headers.get('Origin')===appOrigin)headers.set('Origin','https://shadow-bridge.eu');
    const cookie=headers.get('Cookie')||'';
    const localAddress='127.0.0.'+(2+Number.parseInt(sha(cookie).slice(0,4),16)%220);
    return new Promise((resolve,reject)=>{
      const req=https.request({hostname:'127.0.0.1',port:443,servername:'shadow-bridge.eu',ca,localAddress,path:url.pathname+url.search,method:options.method||'GET',headers:Object.fromEntries(headers)},res=>{
        const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{
          const responseHeaders=new Headers();
          for(let i=0;i<res.rawHeaders.length;i+=2)responseHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);
          resolve(new Response(options.method==='HEAD'?null:Buffer.concat(parts),{status:res.statusCode,headers:responseHeaders}));
        });
      });
      req.setTimeout(20_000,()=>req.destroy(new Error('Local public-profile request timed out')));req.on('error',reject);req.end(options.body);
    });
  };
  globalThis.fetch=realTransport;
  const encode=actor=>({...actor,client:{cookies:[...actor.client.cookies],csrf:actor.client.csrf}});
  const save=async()=>writeFile(path.join(c.directory,'production-test-actors.json'),JSON.stringify({kind:'fictional-production-fixtures',project:c.project,actors:Object.fromEntries(Object.entries(actors).map(([k,v])=>[k,encode(v)])),records})+'\n',{mode:0o600});
  const phase=async(name,work)=>{current=name;if(results.cases.some(item=>item.name===name&&item.result==='PASS')){console.log('RETAINED PASS: '+name);return;}await work();results.cases.push({name,result:'PASS'});await save();await writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});console.log('PASS: '+name);};
  try {
    await phase('built images, public routes, release identity and no Basic Auth',async()=>{
      for(const file of ['app.mjs','config.mjs','client-address.mjs']) {
        const source=sha(await readFile(path.join(root,'server',file)));
        const image=docker(['run','--rm','--entrypoint','sha256sum',imageApp,'/app/server/'+file]).split(' ')[0];assert.equal(image,source);
      }
      for(const route of ['/','/apply/buyer/','/apply/supplier/','/apply/partner/','/member-sign-in/','/legal/','/cartel/','/health','/api/config']) {
        const response=await fetch(appOrigin+route);assert.equal(response.status,200);assert.equal(response.headers.get('www-authenticate'),null);assert.equal(response.headers.get('x-shadowbridge-release'),c.f.releaseSha);await response.arrayBuffer();
      }
      assert.equal((await(await fetch(appOrigin+'/api/config')).json()).releaseSha,c.f.releaseSha);
      for(const route of ['/server/app.mjs','/.git/config','/.local/app.env','/deploy/staging/compose.yaml','/prototypes/buyer/'])assert.equal((await fetch(appOrigin+route)).status,404);
      assert.equal((await fetch(appOrigin+'/portal/admin/')).status,303);
      const configs=JSON.parse(c.compose(['config','--format','json']));
      for(const service of ['postgres','auth','app','mailpit'])assert.equal(configs.services[service].ports,undefined);
      assert.deepEqual(Object.keys(configs.services.auth.networks),['private']);
      assert.equal(configs.services.auth.environment.GOTRUE_SMTP_HOST,'mailpit');
      assert.equal(configs.services.auth.environment.GOTRUE_SMTP_PORT,'1025');
      assert.equal(configs.services.gateway.ports.length,1);assert.equal(configs.services.gateway.ports[0].host_ip,'127.0.0.1');
      results.fixtureOnlyLoopback=true;results.smtpCaptureOnly=true;
    });
    const appContainer=c.compose(['ps','-q','app']).trim(),pgContainer=c.compose(['ps','-q','postgres']).trim();
    mailProxy=createServer((req,res)=>{
      if(req.method!=='GET'||!/^\/api\/v1\/(?:messages|message\/[a-zA-Z0-9-]+)(?:\?.*)?$/.test(req.url||'')){res.writeHead(404).end();return;}
      try {const data=docker(['exec',appContainer,'node','-e',`fetch(${JSON.stringify('http://mailpit:8025'+req.url)}).then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`]);res.writeHead(200,{'Content-Type':'application/json'}).end(data);}catch{res.writeHead(502).end('{}');}
    });
    await new Promise(resolve=>mailProxy.listen(0,'127.0.0.1',resolve));
    Object.assign(process.env,{SHADOWBRIDGE_TEST_URL:appOrigin,SHADOWBRIDGE_MAILPIT_URL:'http://127.0.0.1:'+mailProxy.address().port,SHADOWBRIDGE_DB_CONTAINER:pgContainer,SHADOWBRIDGE_TEST_DATABASE:'shadowbridge',DOCKER_CONTEXT:'default'});
    const h=await import('../server/tests/helpers.mjs');
    if(prior) {
      const state=JSON.parse(await readFile(path.join(c.directory,'production-test-actors.json'),'utf8'));
      assert.equal(state.kind,'fictional-production-fixtures');assert.equal(state.project,c.project);
      for(const [name,value]of Object.entries(state.actors)) {
        assert.match(value.email,/@test[.]shadowbridge[.]invalid$/);
        assert.equal(sql(c,`SELECT count(*) FROM auth.users WHERE id=${h.sqlLiteral(value.user.id)}::uuid AND email=${h.sqlLiteral(value.email)}`),'1');
        const client=new h.Client();client.cookies=new Map(value.client.cookies);client.csrf=value.client.csrf;actors[name]={...value,client};
      }
      Object.assign(records,state.records);
    }
    async function verified(role,label) {
      const actor=await h.registerActor(role,'production-'+label);
      const message=await h.waitForMessage(actor.email);
      const content=[message.HTML,message.Text,message.html,message.text].filter(Boolean).join('\n').replaceAll('&amp;','&');
      const link=(content.match(/https?:\/\/[^\s<>"']+/g)||[]).find(value=>/\/auth\/confirm/.test(value));
      assert.ok(link,'Real GoTrue email link required');const url=new URL(link);assert.equal(url.origin,'https://shadow-bridge.eu');
      await actor.client.request(url.pathname+url.search,{expected:303});await actor.client.request('/api/config',{expected:200});
      actor.user=(await actor.client.signIn(actor)).session.user;assert.equal(actor.user.emailVerified,true);return actor;
    }
    await phase('real registration, email confirmation, owner MFA and seven staff roles',async()=>{
      assert.equal(sql(c,'SELECT count(*) FROM auth.users'),'0','New fictional database required');
      actors.owner=await verified('partner','owner');h.bootstrapOwner(actors.owner);await h.enableMfa(actors.owner);
      for(const role of ['general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst']) {
        const actor=await verified('partner',role);actors[role]=actor;
        await actors.owner.client.request('/api/staff/roles',{method:'POST',body:{userId:actor.user.id,role,active:true},expected:200});
        await actor.client.request('/api/staff/access',{expected:403});await h.enableMfa(actor);
        await actor.client.request('/api/staff/overview',{expected:200});
      }
      for(const role of ['buyer','supplier','partner']) {
        const actor=await verified(role,role);actors[role]=actor;
        actor.companyId=sql(c,`SELECT company_id FROM sb.applications WHERE user_id=${h.sqlLiteral(actor.user.id)}::uuid`);
        const applicationId=sql(c,`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(actor.user.id)}::uuid`);
        await actor.client.request('/api/staff/access',{expected:403});
        await actors.owner.client.request('/api/admin/applications/'+applicationId+'/decision',{method:'POST',body:{decision:'approved',reason:'FICTIONAL production-profile integration manually reviewed after actual email confirmation.'},expected:200});
      }
    });
    await phase('Supplier offer, Buyer RFQ, anonymous assignment and Partner project',async()=>{
      const category=await h.catalogCategory(actors.owner.client),future=new Date(Date.now()+60*86400000).toISOString().slice(0,10);
      records.offer=(await actors.supplier.client.request('/api/offers',{method:'POST',body:{data:{...category,productName:'FICTIONAL public-profile material',specification:'Fictional non-identifying test goods.',countryOfOrigin:'NO',quantity:5,unit:'tonne',price:125,currency:'PLN',incoterms:'FCA'}},expected:201})).data.item.id;
      await actors.supplier.client.request('/api/offers/'+records.offer+'/submit',{method:'POST',body:{},expected:200});
      await h.qualifySupplier(actors.procurement_manager,records.offer);
      await actors.procurement_manager.client.request('/api/staff/offers/'+records.offer+'/decision',{method:'POST',body:{decision:'approved',reason:'FICTIONAL manual qualification evidence checked.'},expected:200});
      records.rfq=(await actors.buyer.client.request('/api/rfqs',{method:'POST',body:{data:{...category,product:'FICTIONAL demand',specifications:'Fictional requirements.',quantity:3,unit:'tonne',budget:500,currency:'PLN',deliveryCountry:'NO',deadline:future}},expected:201})).data.item.id;
      await actors.buyer.client.request('/api/rfqs/'+records.rfq+'/submit',{method:'POST',body:{},expected:200});
      records.opportunity=(await actors.owner.client.request('/api/admin/opportunities',{method:'POST',body:{sourceOfferId:records.offer,commercial:{...category,title:'FICTIONAL anonymous opportunity',specification:'Generic industrial material.',quantity:5,unit:'tonne',price:125,currency:'PLN',incoterms:'FCA',validUntil:future},reviewedNonIdentifying:true},expected:201})).data.item.id;
      await actors.owner.client.request('/api/admin/opportunities/'+records.opportunity+'/assign',{method:'POST',body:{recipientCompanyId:actors.buyer.companyId,role:'buyer'},expected:200});
      const opportunities=(await actors.buyer.client.request('/api/opportunities',{expected:200})).data.items;
      assert.equal(opportunities.length,1);h.assertNoCounterpartySecrets(opportunities,[actors.supplier.companyName,actors.supplier.email,actors.supplier.companyId,actors.supplier.user.id,records.offer]);
      assert.equal((await actors.partner.client.request('/api/opportunities',{expected:200})).data.items.length,0);
      await actors.buyer.client.request('/api/offers/'+records.offer,{expected:403});await actors.supplier.client.request('/api/rfqs/'+records.rfq,{expected:403});
      records.project=(await actors.operations_manager.client.request('/api/admin/projects',{method:'POST',body:{partnerCompanyId:actors.partner.companyId,title:'FICTIONAL production-profile project',summary:'Limited fictional scope.',reviewedNonIdentifying:true},expected:201})).data.item.id;
      assert.equal((await actors.partner.client.request('/api/projects',{expected:200})).data.items.length,1);
    });
    await phase('contact form commits controlled queue; CSRF and management access remain enforced',async()=>{
      const client=new h.Client(),input={name:'FICTIONAL test',email:h.runId+'.contact@test.shadowbridge.invalid',company:'FICTIONAL company',role:'buyer',message:'FICTIONAL test enquiry; no real confidential data.',consent:true,website:''};
      await client.request('/api/contact',{method:'POST',body:input,csrf:false,expected:403});
      const response=await client.request('/api/contact',{method:'POST',body:input,expected:201});assert.equal(response.data.accepted,true);
      assert.equal(sql(c,`SELECT count(*) FROM sb.contact_enquiries WHERE public_id=${h.sqlLiteral(response.data.receipt)}`),'1');
      await actors.buyer.client.request('/api/admin/contact-queue',{expected:403});await actors.owner.client.request('/api/admin/contact-queue',{expected:200});
    });
    await phase('real browser desktop/mobile member dashboards and OWNER MFA',async()=>{
      const require=createRequire(import.meta.url),{loadTestDependency}=require('./dependencies.cjs'),{chromium,expect}=loadTestDependency('@playwright/test');
      const cert=new X509Certificate(await readFile(path.join(c.directory,'certs/production-test.crt'))),pin=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
      browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP shadow-bridge.eu 127.0.0.1',`--ignore-certificate-errors-spki-list=${pin}`]});
      for(const role of ['buyer','supplier','partner','owner']) {
        const ctx=await browser.newContext({baseURL:'https://shadow-bridge.eu',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
        try {const page=await ctx.newPage();await page.goto('/member-sign-in/');const form=page.locator('#sign-in-form');await expect(form.locator('[name=email]')).toBeEnabled();await form.locator('[name=email]').fill(actors[role].email);await form.locator('[name=password]').fill(actors[role].password);await form.locator('button[type=submit]').click();await expect(page.locator('#portal-account')).toContainText(actors[role].email);
          await page.goto('/portal/'+(role==='owner'?'admin':role)+'/');
          if(role==='owner') {await expect(page.getByRole('heading',{name:'Management security verification',exact:true})).toBeVisible();await page.getByLabel('Six-digit authenticator code',{exact:true}).fill(h.totp(actors.owner.mfaSecret));await page.getByRole('button',{name:'Verify second factor',exact:true}).click();await expect(page.locator('[data-command-dashboard]')).toBeVisible();}
          else await expect(page.locator('[data-member-dashboard]')).toBeVisible();
          for(const width of [1440,390,320]) {await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
          await page.screenshot({path:'/tmp/shadowbridge-production-'+role+'-320.png',fullPage:false});
        }finally{await ctx.close();}
      }
    });
    await phase('restart preserves accounts, passwords, MFA and existing API sessions',async()=>{
      const query="SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM auth.users t",before=sql(c,query),mfaBefore=sql(c,"SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM auth.mfa_factors t");
      c.compose(['restart','postgres','auth','app','gateway']);
      await new Promise(resolve=>setTimeout(resolve,3000));
      for(const actor of Object.values(actors)){const session=(await actor.client.request('/api/session',{expected:200})).data;assert.equal(session.user.id,actor.user.id);}
      assert.equal(sql(c,query),before);assert.equal(sql(c,"SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM auth.mfa_factors t"),mfaBefore);
    });
    await phase('encrypted database/config backup restores into new isolated PostgreSQL with all protected records',async()=>{
      if(!results.backupRestoreVerified) {
        const folder=path.join(c.directory,'recovery-proof-'+randomBytes(5).toString('hex'));
        await mkdir(folder,{mode:0o700});c.compose(['stop','app','auth']);
        try {
          const expected=await databaseFingerprints(c.directory);
          const recovery=await backupStaging({directory:c.directory,backupFile:path.join(folder,'database.sbb'),keyFile:path.join(folder,'database.key')});
          assert.equal((await lstat(recovery.backupFile)).mode&0o777,0o600);assert.equal((await lstat(recovery.keyFile)).mode&0o777,0o600);
          const proof=await proveBackup({directory:c.directory,...recovery,expected});assert.equal(proof.verified,true);
          results.backupRestoreVerified=true;results.backupPreserved=true;
        } finally {c.compose(['start','auth','app']);}
      }
      const deadline=Date.now()+60000;let ready=false;
      while(Date.now()<deadline) {try{const r=await fetch(appOrigin+'/health');if(r.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
      assert.equal(ready,true,'API must become healthy before retained-session checks');
      for(const role of ['owner','buyer','supplier','partner'])assert.equal((await actors[role].client.request('/api/session',{expected:200})).data.user.id,actors[role].user.id);
    });
    await phase('real recovery email, password reset, invalid CSRF and normal logout',async()=>{
      const actor=actors.partner,client=new h.Client(),after=Date.now()-1000;
      await client.request('/api/auth/recover',{method:'POST',body:{email:actor.email},expected:202});
      const message=await h.waitForMessage(actor.email,{after});
      const content=[message.HTML,message.Text,message.html,message.text].filter(Boolean).join('\n').replaceAll('&amp;','&');
      const link=(content.match(/https?:\/\/[^\s<>"']+/g)||[]).find(value=>/\/auth\/recover/.test(value));
      assert.ok(link,'Real GoTrue recovery email required');const url=new URL(link);assert.equal(url.origin,'https://shadow-bridge.eu');
      await client.request(url.pathname+url.search,{expected:303});await client.request('/api/config',{expected:200});
      await client.request('/api/projects',{expected:403});
      const replacement=h.password();await client.request('/api/auth/password',{method:'POST',body:{password:replacement},expected:200});
      const oldLogin=new h.Client();await oldLogin.request('/api/auth/login',{method:'POST',body:{email:actor.email,password:actor.password},expected:401});
      actor.password=replacement;actor.client=new h.Client();await actor.client.signIn(actor);
      await actor.client.request('/api/auth/logout',{method:'POST',body:{},csrf:false,expected:403});
      assert.equal((await actor.client.request('/api/session',{expected:200})).data.user.id,actor.user.id);
      await actor.client.request('/api/auth/logout',{method:'POST',body:{},expected:200});
      assert.equal((await actor.client.request('/api/session',{expected:200})).data.user,null);
      await actor.client.signIn(actor);
    });
    await phase('operator public verification checks the actual local HTTPS gateway',async()=>{
      const verified=await verifyPublic(c.f.releaseSha,{request:realTransport});
      assert.equal(verified.publicSmokeVerified,true);assert.equal(verified.releaseSha,c.f.releaseSha);
    });
    results.result='PASS';
  }catch(error){results.result='FAIL';results.failedCase=current;results.errorType=error?.name||'Error';await writeFile(path.join(c.directory,'production-test-failure.json'),JSON.stringify({case:current,name:error?.name,message:error?.message,stack:error?.stack},null,2)+'\n',{mode:0o600});console.error('FAIL: '+current+'; private diagnostics retained');process.exitCode=1;}
  finally {if(browser)await browser.close();if(mailProxy)await new Promise(resolve=>mailProxy.close(resolve));globalThis.fetch=originalFetch;results.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});}
}

if(action==='prepare')await prepare();
else {
  const c=await fixture();
  if(action==='start')await start(c);
  else if(action==='test')await test(c);
  else if(action==='stop') {
    c.compose(['stop']);
    try {const result=JSON.parse(await readFile(output,'utf8'));if(result.project===c.project){result.fixtureStoppedWithoutVolumeRemoval=true;await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});}}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  else throw new Error('Use prepare, start, test or stop');
}
