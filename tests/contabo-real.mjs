// Operator-run REAL integration. No API responses, identity claims or database
// results are mocked. Mailpit forwarding is only local Docker transport.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkStaging, readEnv, repositoryRoot } from '../scripts/staging-prepare.mjs';

const args=process.argv.slice(2);
const directory=path.resolve(repositoryRoot,args.find(a=>a.startsWith('--dir='))?.slice(6)||'.local/contabo-g3-regression');
const checked=await checkStaging({directory});
assert.match(checked.project,/^shadowbridge-stageg-/,'This destructive fixture runner requires a separate stageg test project.');
const require=createRequire(import.meta.url);
const {loadTestDependency}=require('./dependencies.cjs');
const {chromium,expect}=loadTestDependency('@playwright/test');
const basic='Basic '+Buffer.from('reviewer:'+(await readFile(path.join(directory,'tester-password'),'utf8')).trim()).toString('base64');
const realFetch=globalThis.fetch;
globalThis.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.origin===checked.origin){const headers=new Headers(options.headers);headers.set('Authorization',basic);options={...options,headers};}
  return realFetch(input,options);
};
const docker=(command,options={})=>execFileSync('docker',['--context','default',...command],{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe'],...options});
const pgContainer=docker(['ps','-q','--filter',`label=com.docker.compose.project=${checked.project}`,'--filter','label=com.docker.compose.service=postgres']).trim();
const appContainer=docker(['ps','-q','--filter',`label=com.docker.compose.project=${checked.project}`,'--filter','label=com.docker.compose.service=app']).trim();
assert.ok(pgContainer&&appContainer,'Only the explicitly isolated running containers may be used.');
process.env.SHADOWBRIDGE_TEST_URL=checked.origin;
process.env.SHADOWBRIDGE_DB_CONTAINER=pgContainer;
process.env.SHADOWBRIDGE_TEST_DATABASE='shadowbridge';
const mailProxy=createServer((req,res)=>{
  if(req.method!=='GET'||!/^\/api\/v1\/(?:messages|message\/[a-zA-Z0-9-]+)(?:\?.*)?$/.test(req.url||'')){res.writeHead(404);return res.end();}
  try{
    const body=docker(['exec',appContainer,'node','-e',`fetch(${JSON.stringify('http://mailpit:8025'+req.url)}).then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`]);
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(502);res.end('{}');}
});
await new Promise(resolve=>mailProxy.listen(0,'127.0.0.1',resolve));
process.env.SHADOWBRIDGE_MAILPIT_URL=`http://127.0.0.1:${mailProxy.address().port}`;
const h=await import('../server/tests/helpers.mjs');
const output=args.includes('--verify-state')?`/tmp/shadowbridge-contabo-state-${checked.project}-${Date.now()}.json`:'/tmp/shadowbridge-contabo-real-results.json';
const results={kind:'real-contabo-local-integration',project:checked.project,startedAt:new Date().toISOString(),cases:[],screenshots:[]};
let current='initial readiness',browser;
const actors={};let records={};
const recordFile=path.join(directory,'test-record.json');
async function save(){
  if(!Object.keys(actors).length)return;
  const serial={kind:'fictional-stageg-real-fixtures',origin:checked.origin,project:checked.project,records,actors:Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,{...a,client:{cookies:[...a.client.cookies],csrf:a.client.csrf}}]))};
  await writeFile(recordFile,JSON.stringify(serial,null,2)+'\n',{mode:0o600});
}
async function phase(label,work){current=label;await work();results.cases.push({name:label,result:'PASS'});console.log('PASS: '+label);await save();await writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function login(page,actor,role){
  await page.goto('/member-sign-in/');
  const form=page.locator('#sign-in-form');await expect(form.locator('[name=email]')).toBeEnabled();
  await form.locator('[name=email]').fill(actor.email);await form.locator('[name=password]').fill(actor.password);await form.locator('button[type=submit]').click();
  await expect(page.locator('#portal-account')).toContainText(actor.email);await page.goto(`/portal/${role}/`);
}
async function responsive(page){for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Dashboard overflow');}}
const kpi=(page,key)=>page.locator(`[data-dashboard-kpi="${key}"] .portal-metric`);
async function snapshot(page,name,width){await page.setViewportSize({width,height:1100});const file=`/tmp/shadowbridge-contabo-${name}-${width}.png`;await page.screenshot({path:file,fullPage:false});results.screenshots.push(file);}
async function context(){return browser.newContext({baseURL:checked.origin,httpCredentials:{username:'reviewer',password:(await readFile(path.join(directory,'tester-password'),'utf8')).trim()},viewport:{width:1440,height:1000},reducedMotion:'reduce'});}
async function approved(actor){const app=h.db(`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(actor.user.id)}`);actor.companyId=h.db(`SELECT company_id FROM sb.applications WHERE user_id=${h.sqlLiteral(actor.user.id)}`);await actors.owner.client.request(`/api/admin/applications/${app}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL isolated Contabo package regression after real email verification.'},expected:200});}
function section(page,title){return page.locator('section').filter({has:page.getByRole('heading',{name:title,exact:true})});}
async function fill(form,values){for(const[name,value]of Object.entries(values)){const field=form.locator(`[name=${name}]`);if(await field.evaluate(el=>el.tagName)==='SELECT')await field.selectOption(String(value));else await field.fill(String(value));}}
const staffRoles=['owner','general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst'];
const metricKeys=['pendingApplications','submittedOffers','submittedRfqs','activeProjects','pendingProposals','openContactEnquiries','pendingRiskApprovals'];
const metricPermissions=['applications.read','offers.read','rfqs.read','projects.read','proposals.read','contact.read',null];
const denies={operations_manager:'/api/admin/applications',procurement_manager:'/api/admin/projects',sales_manager:'/api/admin/commissions',compliance_finance:'/api/admin/contact-queue',staff_analyst:'/api/admin/companies'};
try{
  await phase('TLS, reviewer gate and database migrations',async()=>{
    const rejected=await realFetch(checked.origin+'/api/config');assert.equal(rejected.status,401);
    const cfg=await fetch(checked.origin+'/api/config');assert.equal(cfg.status,200);assert.equal((await cfg.json()).environment,'production');
    assert.equal(h.db('SELECT count(*) FROM shadowbridge_migrations.applied'),'11');
    const tls=h.db("SELECT bool_and(ssl) FROM pg_stat_ssl JOIN pg_stat_activity a USING(pid) WHERE a.usename IN ('shadowbridge_api','shadowbridge_sessions','supabase_auth_admin')");assert.equal(tls,'t');
    assert.equal(h.db("SELECT count(*) FROM pg_roles WHERE rolname IN ('shadowbridge_api','shadowbridge_sessions') AND (rolsuper OR rolbypassrls OR rolcreaterole)"),'0');
  });
  const certificate=new X509Certificate(await readFile(path.join(directory,'certs/public.crt')));
  const pin=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox',`--ignore-certificate-errors-spki-list=${pin}`]});
  if(args.includes('--verify-state')){
    const saved=JSON.parse(await readFile(recordFile,'utf8'));records=saved.records;
    for(const[name,value]of Object.entries(saved.actors)){const client=new h.Client();client.cookies=new Map(value.client.cookies);client.csrf=value.client.csrf;actors[name]={...value,client};}
    await phase('persisted accounts, passwords, MFA and sessions after lifecycle operation',async()=>{
      for(const name of ['owner','buyerA','supplier','partnerA']){const actor=actors[name];const session=(await actor.client.request('/api/session',{expected:200})).data;assert.equal(session.user.id,actor.user.id,'Persisted session identity');if(name==='owner')assert.equal(session.user.aal,'aal2');}
      assert.equal((await actors.buyerA.client.request('/api/rfqs',{expected:200})).data.items.some(i=>i.id===records.rfqId),true);
      assert.equal((await actors.supplier.client.request('/api/offers',{expected:200})).data.items.some(i=>i.id===records.offerId),true);
      assert.equal((await actors.partnerA.client.request('/api/projects',{expected:200})).data.items.some(i=>i.id===records.projectId),true);
      assert.equal(h.db(`SELECT count(*) FROM auth.mfa_factors WHERE user_id=${h.sqlLiteral(actors.owner.user.id)} AND status='verified'`),'1');
      const client=new h.Client();await client.signIn(actors.buyerA);assert.equal((await client.request('/api/session',{expected:200})).data.user.id,actors.buyerA.user.id);
    });
  }else{
    await phase('real registrations, Mailpit confirmation, individual approval and seven staff MFA factors',async()=>{
      actors.owner=h.bootstrapOwner(await h.verifyActor(await h.registerActor('partner','contabo-owner')));await h.enableMfa(actors.owner);
      for(const role of staffRoles.slice(1)){const actor=await h.verifyActor(await h.registerActor('partner',`contabo-${role.replaceAll('_','-')}`));await actors.owner.client.request('/api/staff/roles',{method:'POST',body:{userId:actor.user.id,role,active:true},expected:200});await actor.client.request('/api/staff/overview',{expected:403});await h.enableMfa(actor);actors[role]=actor;}
      for(const[name,role]of [['buyerA','buyer'],['buyerB','buyer'],['supplier','supplier'],['partnerA','partner'],['partnerB','partner']]){actors[name]=await h.verifyActor(await h.registerActor(role,'contabo-'+name.toLowerCase()));await approved(actors[name]);}
      assert.equal(new Set(Object.values(actors).map(a=>a.user.id)).size,12);
    });
    const category=await h.catalogCategory(actors.owner.client);
    const future=new Date(Date.now()+90*86400000).toISOString().slice(0,10);
    await phase('Buyer real UI draft and submit update RFQ KPIs; cross-company isolation',async()=>{
      const ctx=await context();try{const page=await ctx.newPage();await login(page,actors.buyerA,'buyer');await expect(kpi(page,'rfqs-loaded')).toHaveText('0');
        const form=section(page,'New purchase request');records.rfqTitle=`FICTIONAL G3 RFQ ${h.runId}`;
        await fill(form,{product:records.rfqTitle,specifications:'Fictional private industrial requirement.',quantity:4,unit:'tonne',budget:500,currency:'PLN',deliveryCountry:'NO',deadline:future});await form.locator('[name=categoryId]').selectOption(category.categoryId);
        const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/rfqs'&&r.request().method()==='POST');await form.getByRole('button',{name:'Save private draft',exact:true}).click();const response=await saved;assert.equal(response.status(),201);records.rfqId=(await response.json()).item.id;
        await expect(kpi(page,'rfqs-loaded')).toHaveText('1');await expect(kpi(page,'drafts')).toHaveText('1');
        const card=page.locator('article.portal-record').filter({has:page.getByRole('heading',{name:records.rfqTitle,exact:true})});await card.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(kpi(page,'drafts')).toHaveText('0');
        await actors.sales_manager.client.request(`/api/admin/rfqs/${records.rfqId}/decision`,{method:'POST',body:{decision:'clarification_requested',reason:'FICTIONAL quantity clarification for local test.'},expected:200});await page.reload();await expect(kpi(page,'clarifications')).toHaveText('1');
        await actors.buyerB.client.request(`/api/rfqs/${records.rfqId}`,{expected:404});assert.deepEqual((await actors.buyerB.client.request('/api/rfqs',{expected:200})).data.items,[]);await actors.supplier.client.request(`/api/rfqs/${records.rfqId}`,{expected:403});
        await responsive(page);await snapshot(page,'buyer',390);assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
      }finally{await ctx.close();}
    });
    await phase('Supplier review status, approved anonymous opportunity and recipient confidentiality',async()=>{
      const ctx=await context();try{const page=await ctx.newPage();await login(page,actors.supplier,'supplier');await expect(kpi(page,'offers-loaded')).toHaveText('0');
        const form=section(page,'New supplier offer');records.offerTitle=`FICTIONAL G3 material ${h.runId}`;
        await fill(form,{productName:records.offerTitle,specification:'Fictional industrial material.',countryOfOrigin:'NO',quantity:20,unit:'tonne',price:125});await form.locator('[name=categoryId]').selectOption(category.categoryId);await form.locator('[name=currency]').selectOption('PLN');await form.locator('[name=incoterms]').selectOption('FCA');
        const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/offers'&&r.request().method()==='POST');await form.getByRole('button',{name:'Save private draft',exact:true}).click();const response=await saved;assert.equal(response.status(),201);records.offerId=(await response.json()).item.id;await expect(kpi(page,'offers-loaded')).toHaveText('1');
        const card=page.locator('article.portal-record').filter({has:page.getByRole('heading',{name:records.offerTitle,exact:true})});await card.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(kpi(page,'pending-review')).toHaveText('1');
        await actors.procurement_manager.client.request(`/api/staff/offers/${records.offerId}/decision`,{method:'POST',body:{decision:'clarification_requested',reason:'FICTIONAL product evidence clarification.'},expected:200});await page.reload();await expect(kpi(page,'clarifications')).toHaveText('1');
        await h.qualifySupplier(actors.procurement_manager,records.offerId);await actors.procurement_manager.client.request(`/api/staff/offers/${records.offerId}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL four-stage qualification complete.'},expected:200});await page.reload();await expect(kpi(page,'approved')).toHaveText('1');await expect(kpi(page,'clarifications')).toHaveText('0');
        const commercial={...category,title:`FICTIONAL anonymous opportunity ${h.runId}`,specification:'Approved generic non-identifying material.',quantity:20,unit:'tonne',price:125,currency:'PLN',incoterms:'FCA',availability:'By agreement',validUntil:future};
        records.opportunityId=(await actors.owner.client.request('/api/admin/opportunities',{method:'POST',body:{sourceOfferId:records.offerId,commercial,reviewedNonIdentifying:true},expected:201})).data.item.id;
        await actors.owner.client.request(`/api/admin/opportunities/${records.opportunityId}/assign`,{method:'POST',body:{recipientCompanyId:actors.buyerA.companyId,role:'buyer'},expected:200});
        const assigned=(await actors.buyerA.client.request('/api/opportunities',{expected:200})).data.items;assert.equal(assigned.length,1);h.assertNoCounterpartySecrets(assigned,[actors.supplier.companyName,actors.supplier.email,actors.supplier.companyId,actors.supplier.user.id,records.offerId]);assert.deepEqual((await actors.buyerB.client.request('/api/opportunities',{expected:200})).data.items,[]);await actors.buyerA.client.request(`/api/offers/${records.offerId}`,{expected:403});
        await responsive(page);await snapshot(page,'supplier',1440);
        const recipient=await context();try{const buyerPage=await recipient.newPage();await login(buyerPage,actors.buyerA,'buyer');await expect(kpi(buyerPage,'assigned-opportunities')).toHaveText('1');await expect(buyerPage.locator('#portal-content')).not.toContainText(actors.supplier.companyName);await expect(buyerPage.locator('#portal-content')).not.toContainText(actors.supplier.email);}finally{await recipient.close();}
      }finally{await ctx.close();}
    });
    await phase('Partner assigned projects, own proposal and separate source-currency commissions',async()=>{
      const ctx=await context();try{const page=await ctx.newPage();await login(page,actors.partnerA,'partner');await expect(kpi(page,'projects-loaded')).toHaveText('0');
        const baseline=(await actors.owner.client.request('/api/staff/overview',{expected:200})).data.counts.activeProjects;
        records.projectId=(await actors.operations_manager.client.request('/api/admin/projects',{method:'POST',body:{partnerCompanyId:actors.partnerA.companyId,title:`FICTIONAL G3 assigned cooperation ${h.runId}`,summary:'Fictional limited project scope.',reviewedNonIdentifying:true},expected:201})).data.item.id;
        for(const[currency,amount]of [['EUR',47.5],['PLN',125]])await actors.owner.client.request('/api/admin/commissions',{method:'POST',body:{projectId:records.projectId,amount,currency,agreementReference:`G3-${currency}-${h.runId.toUpperCase()}`,reviewedNonIdentifying:true,agreementConfirmed:true},expected:201});
        await actors.partnerA.client.request('/api/proposals',{method:'POST',body:{data:{title:`FICTIONAL G3 proposal ${h.runId}`,description:'Fictional cooperation proposed only for isolated testing.'}},expected:201});
        await page.reload();await expect(kpi(page,'projects-loaded')).toHaveText('1');await expect(kpi(page,'open-projects')).toHaveText('1');await expect(kpi(page,'proposals-loaded')).toHaveText('1');await expect(kpi(page,'commission-records')).toHaveText('2');await expect(page.locator('[data-dashboard-currency=EUR]')).toContainText('47.50');await expect(page.locator('[data-dashboard-currency=PLN]')).toContainText('125.00');
        assert.equal(Number((await actors.owner.client.request('/api/staff/overview',{expected:200})).data.counts.activeProjects),Number(baseline)+1);assert.deepEqual((await actors.partnerB.client.request('/api/projects',{expected:200})).data.items,[]);assert.deepEqual((await actors.partnerB.client.request('/api/commissions',{expected:200})).data.items,[]);await responsive(page);await snapshot(page,'partner',390);
      }finally{await ctx.close();}
    });
    for(const role of staffRoles)await phase(`Command Center real UI login, MFA, scoped overview and mobile: ${role}`,async()=>{
      const actor=actors[role],ctx=await context();try{const page=await ctx.newPage();await login(page,actor,'admin');await expect(page.getByRole('heading',{name:'Management security verification',exact:true})).toBeVisible();assert.equal((await page.request.get('/api/staff/overview')).status(),403);await expect(page.locator('.portal-metric')).toHaveCount(0);
        if(Math.floor(Date.now()/30000)===Math.floor(actor.mfaVerifiedAt/30000))await pause(30000-Date.now()%30000+150);
        await page.getByLabel('Six-digit authenticator code',{exact:true}).fill(h.totp(actor.mfaSecret));const verified=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/mfa/verify'&&r.request().method()==='POST');await page.getByRole('button',{name:'Verify second factor',exact:true}).click();assert.equal((await verified).status(),200);
        await expect(page.locator('[data-command-dashboard]')).toBeVisible();const overview=await(await page.request.get('/api/staff/overview')).json(),access=await(await page.request.get('/api/staff/access')).json();assert.deepEqual(access.roles,[role]);
        const expected=metricKeys.flatMap((key,i)=>Object.hasOwn(overview.counts,key)&&(metricPermissions[i]===null||access.owner||access.permissions.includes(metricPermissions[i]))?[String(overview.counts[key])]:[]);await expect(page.locator('[data-command-dashboard] .portal-metric')).toHaveText(expected);
        if(denies[role])assert.equal((await page.request.get(denies[role])).status(),403);
        if(role==='general_director')await actors.general_director.client.request('/api/staff/roles',{method:'POST',body:{userId:actor.user.id,role:'owner',active:true},expected:403});
        await responsive(page);if(role==='owner'){await snapshot(page,'owner',1440);await snapshot(page,'owner',390);}if(role==='operations_manager')await snapshot(page,'operations',1440);
        assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
      }finally{await ctx.close();}
    });
    await phase('two-tab real logout and replacement account clear dashboard and private navigation',async()=>{
      const ctx=await context();try{const page=await ctx.newPage();await login(page,actors.buyerA,'buyer');await expect(kpi(page,'rfqs-loaded')).toHaveText('1');const other=await ctx.newPage();await login(other,actors.buyerB,'buyer');await expect(page.locator('#portal-status')).toContainText('Browser session changed.');await expect(page.locator('[data-member-dashboard]')).toHaveCount(0);await expect(page.locator('.dashboard-module-slot')).toBeEmpty();await page.reload();await expect(kpi(page,'rfqs-loaded')).toHaveText('0');await expect(page.locator('#portal-content')).not.toContainText(records.rfqTitle);await other.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.locator('#portal-status')).toContainText('Browser session changed.');await expect(page.locator('[data-member-dashboard]')).toHaveCount(0);assert.equal((await(await page.request.get('/api/session')).json()).user,null);
      }finally{await ctx.close();}
    });
  }
  results.finishedAt=new Date().toISOString();results.result='PASS';await writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});console.log(`Complete: ${results.cases.length} real integration cases PASS. Sanitized report: ${output}`);
}catch(error){results.result='FAIL';results.failedCase=current;results.errorType=error?.name||'Error';await writeFile(path.join(directory,'test-failure.json'),JSON.stringify({case:current,name:error?.name,message:error?.message,stack:error?.stack},null,2)+'\n',{mode:0o600});await writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});console.error(`FAIL: ${current} (${results.errorType}). Private details deliberately omitted.`);process.exitCode=1;}
finally{if(browser)await browser.close();await new Promise(r=>mailProxy.close(r));globalThis.fetch=realFetch;}
