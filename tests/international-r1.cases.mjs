// Extends only a NEW fictional V1/V2 fixture. No owner installation or public
// server is loaded. Recovery uses a second, socket-only PostgreSQL cluster.
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile,readFile,symlink,stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { encryptArchive,decryptArchive } from '../scripts/staging-backup.mjs';
import { restoredVaultRolesSql } from '../scripts/vault-recovery-roles.mjs';
import { restoredSentinelRoleSql } from '../scripts/staging-ops.mjs';

export async function runR1Tests(ctx){
 const {root,directory,compose,admin,db,actors,h,result,fingerprint,restart}=ctx;
 const marker=JSON.parse(await readFile(path.join(directory,'fixture.json'),'utf8'));
 assert.match(marker.project,/^shadowbridge-vault-test-[a-f0-9]{10}$/);
 assert.equal(marker.kind,'shadowbridge-owner-vault-isolated-v1');
 const owner=actors.owner,source=compose(['ps','-q','postgres']);
 const docker=(args,input)=>execFileSync('docker',['--context','default',...args],{cwd:root,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024});
 const request=async(actor,url,options={})=>{
  try{return (await actor.client.request(url,{expected:200,...options})).data;}
  catch(error){
   // Replacing the real HTTP process can invalidate an undici keepalive socket.
   // Retry only one idempotent GET after that explicit transport failure.
   if((options.method||'GET')!=='GET'||!['UND_ERR_SOCKET','ECONNRESET','ECONNREFUSED'].includes(error.cause?.code))throw error;
   await new Promise(r=>setTimeout(r,100));return (await actor.client.request(url,{expected:200,...options})).data;
  }
 };
 const id=randomBytes(5).toString('hex'),future=new Date(Date.now()+120*86400000).toISOString().slice(0,10);
 const company=async actor=>(await admin.query('SELECT company_id FROM sb.applications WHERE user_id=$1',[actor.user.id])).rows[0].company_id;
 let {offer,rfq,opportunity,project,buyerB}=ctx.records||{};
 if(buyerB?.client?.cookies instanceof Array){const client=new h.Client();client.cookies=new Map(buyerB.client.cookies);client.csrf=buyerB.client.csrf;buyerB.client=client;}
 const phase=async(name,fn)=>{
  if(ctx.completed?.includes(name)){console.log('RETAINED PASS: '+name);return;}
  await ctx.phase(name,async()=>{await fn();if(ctx.saveRecords)await ctx.saveRecords({offer,rfq,opportunity,project,buyerB:buyerB?{...buyerB,client:{cookies:[...buyerB.client.cookies],csrf:buyerB.client.csrf}}:undefined});});
 };
 await phase('R1 no-mail capabilities fail closed; contact enquiries actually persist with CSRF and restricted review',async()=>{
  const anon=new h.Client(),configuration=await request({client:anon},'/api/config');
  assert.deepEqual(configuration.capabilities,{registration:false,passwordRecovery:false,emailVerification:false});
  for(const url of ['/api/auth/register','/api/auth/recover','/api/auth/resend-verification','/api/auth/password'])await anon.request(url,{method:'POST',body:{},expected:503});
  const body={name:'FICTIONAL R1 contact',email:`${id}@test.shadowbridge.invalid`,company:'FICTIONAL R1 organisation',role:'buyer',message:'FICTIONAL R1 local enquiry; no business communication or external email.',consent:true,website:''};
  await anon.request('/api/contact',{method:'POST',body,csrf:false,expected:403});
  const saved=await anon.request('/api/contact',{method:'POST',body,expected:201});assert.equal(saved.data.accepted,true);
  assert.equal((await admin.query('SELECT count(*) FROM sb.contact_enquiries WHERE public_id=$1',[saved.data.receipt])).rows[0].count,'1');
  await actors.buyer.client.request('/api/admin/contact-queue',{expected:403});
  const queue=await request(owner,'/api/admin/contact-queue');assert.ok(queue.items.some(i=>i.id===saved.data.receipt));
 });
 await phase('R1 seven staff roles obey their actual permission sets and cannot alter OWNER',async()=>{
  for(const [role,actor] of Object.entries(actors).filter(([r])=>!['buyer','supplier','partner'].includes(r))){
   const access=await request(actor,'/api/staff/access');assert.equal(access.owner,role==='owner');
   await request(actor,'/api/staff/overview');
   for(const [url,permission] of [['/api/staff/team','staff.read'],['/api/admin/accounts','accounts.read'],['/api/admin/applications','applications.read'],['/api/staff/categories','taxonomy.read']])await actor.client.request(url,{expected:access.permissions.includes(permission)?200:403});
   if(role!=='owner'){
    await actor.client.request('/api/staff/roles',{method:'POST',body:{userId:owner.user.id,role:'owner',active:false},expected:403});
    await actor.client.request('/api/staff/roles',{method:'POST',body:{userId:actor.user.id,role:'owner',active:true},expected:403});
   }
  }
  assert.equal((await admin.query("SELECT active FROM sb.staff_role_assignments WHERE user_id=$1 AND role_key='owner'",[owner.user.id])).rows[0].active,true);
 });
 await phase('R1 real supplier offer + buyer RFQ + delegated decisions update the operational counters',async()=>{
  const category=await h.catalogCategory(actors.supplier.client);
  const offerData={...category,productName:'FICTIONAL R1 polymer',description:'FICTIONAL R1 material for isolated testing.',specification:'FICTIONAL technical granules.',countryOfOrigin:'NO',quantity:'20',unit:'tonne',price:'1250',currency:'PLN',minimumOrderQuantity:'5',incoterms:'FCA',loadingLocation:'NO',deliveryTerms:'FICTIONAL collection terms',availability:'FICTIONAL within 30 days',validUntil:future,certificationsStatus:'Manual review required',notes:'FICTIONAL only'};
  offer=(await request(actors.supplier,'/api/offers',{method:'POST',body:{data:offerData},expected:201})).item;
  await request(actors.supplier,`/api/offers/${offer.id}/submit`,{method:'POST',body:{}});
  const submitted=await request(owner,'/api/staff/overview');assert.equal(submitted.counts.submittedOffers,1);
  await h.qualifySupplier(actors.procurement_manager,offer.id);
  await request(actors.procurement_manager,`/api/admin/offers/${offer.id}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL R1 delegated procurement decision, independently reviewed.'}});
  assert.equal((await request(owner,'/api/staff/overview')).counts.submittedOffers,0);
  const data={...category,product:'FICTIONAL R1 material request',specifications:'FICTIONAL isolated procurement.',quantity:'10',unit:'tonne',budget:'14000',currency:'PLN',deliveryCountry:'NO',deadline:future,certificates:'Manual review',requirements:'FICTIONAL business case only'};
  rfq=(await request(actors.buyer,'/api/rfqs',{method:'POST',body:{data},expected:201})).item;
  await request(actors.buyer,`/api/rfqs/${rfq.id}/submit`,{method:'POST',body:{}});
  assert.equal((await request(owner,'/api/staff/overview')).counts.submittedRfqs,1);
  await request(actors.sales_manager,`/api/admin/rfqs/${rfq.id}/decision`,{method:'POST',body:{decision:'in_review',reason:'FICTIONAL R1 delegated sales review.'}});
  assert.equal((await request(owner,'/api/staff/overview')).counts.submittedRfqs,0);
  opportunity=(await request(actors.sales_manager,'/api/admin/opportunities',{method:'POST',body:{sourceOfferId:offer.id,commercial:{...category,title:'FICTIONAL reviewed material opportunity',specification:'FICTIONAL non-identifying specification',quantity:'20',unit:'tonne',price:'1250',currency:'PLN',incoterms:'FCA',availability:'FICTIONAL by agreement',validUntil:future},reviewedNonIdentifying:true},expected:201})).item;
  assert.equal((await request(actors.buyer,'/api/opportunities')).items.length,0);
  await request(actors.sales_manager,`/api/admin/opportunities/${opportunity.id}/assign`,{method:'POST',body:{recipientCompanyId:await company(actors.buyer),role:'buyer'}});
  const cards=await request(actors.buyer,'/api/opportunities');assert.equal(cards.items.length,1);
  h.assertNoCounterpartySecrets(cards,[await company(actors.supplier),actors.supplier.user.id,actors.supplier.email,offer.id]);
  assert.equal(cards.items[0].data.currency,'PLN');
  project=(await request(actors.operations_manager,'/api/admin/projects',{method:'POST',body:{partnerCompanyId:await company(actors.partner),title:'FICTIONAL R1 assigned project',summary:'FICTIONAL approved scope without counterparties.',reviewedNonIdentifying:true},expected:201})).item;
  assert.equal((await request(actors.partner,'/api/projects')).items[0].id,project.id);
  assert.equal((await request(owner,'/api/staff/overview')).counts.activeProjects,1);
 });
 await phase('R1 independent second buyer stays isolated from assigned opportunities, offers, RFQs and Vault',async()=>{
  const configuration=JSON.parse(await readFile(path.join(directory,'compose.json'),'utf8'));
  const authOrigin='http://127.0.0.1:'+Number(compose(['port','auth','9999']).split(':').at(-1));
  const {createHmac}=await import('node:crypto');
  const claims=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const jwt=claims+'.'+createHmac('sha256',configuration.services.auth.environment.GOTRUE_JWT_SECRET).update(claims).digest('base64url');
  buyerB={email:`${id}.buyer-b@test.shadowbridge.invalid`,password:h.password(),client:new h.Client()};
  const response=await fetch(authOrigin+'/admin/users',{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({email:buyerB.email,password:buyerB.password,email_confirm:true})});assert.equal(response.status,200);buyerB.user=await response.json();
  await buyerB.client.signIn(buyerB);
  await db.asUser(buyerB.user,{aal:'aal1'},tx=>tx.query('SELECT sb.submit_application($1,$2::jsonb)',['buyer',JSON.stringify({legal_name:'FICTIONAL R1 independent buyer',registration_number:'FICTIONAL-R1-'+id,country:'NO'})]));
  const application=(await admin.query('SELECT id FROM sb.applications WHERE user_id=$1',[buyerB.user.id])).rows[0];
  await request(owner,`/api/admin/applications/${application.id}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL independent company for local isolation checks.'}});
  assert.equal((await request(buyerB,'/api/opportunities')).items.length,0);
  for(const [actor,url] of [[buyerB,`/api/rfqs/${rfq.id}`],[buyerB,`/api/offers/${offer.id}`],[actors.supplier,`/api/rfqs/${rfq.id}`],[actors.partner,`/api/offers/${offer.id}`]])await actor.client.request(url,{expected:[403,404]});
  await buyerB.client.request('/api/owner/vault/workspace/contacts',{expected:403});
 });
 await phase('R1 actual role dashboards and public/contact/login pages: desktop/mobile and accessibility',async()=>{
  const require=createRequire(import.meta.url),{loadTestDependency}=require('./dependencies.cjs');
  const {chromium,expect}=loadTestDependency('@playwright/test'),{default:AxeBuilder}=loadTestDependency('@axe-core/playwright');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});
  try{
   for(const [role,actor] of Object.entries(actors)){
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    try{
     await context.addCookies([...actor.client.cookies].map(([name,value])=>({name,value,url:process.env.SHADOWBRIDGE_TEST_URL,sameSite:'Lax'})));
     const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
     const member=['buyer','supplier','partner'].includes(role),route=member?role:'admin';
     await page.goto(process.env.SHADOWBRIDGE_TEST_URL+`/portal/${route}/`);
     await expect(page.locator(member?'[data-member-dashboard]':'[data-command-dashboard]')).toBeVisible();
     for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dashboard overflow: '+role+' '+width);}
     const report=await new AxeBuilder({page}).include('.dashboard-layout').withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(report.violations.map(v=>v.id),[]);
     assert.deepEqual(errors,[]);
    }finally{await context.close();}
   }
   const page=await browser.newPage({viewport:{width:320,height:950}});
   for(const route of ['/','/member-sign-in/','/apply/buyer/','/apply/supplier/','/apply/partner/','/legal/','/cartel/']){
    const response=await page.goto(process.env.SHADOWBRIDGE_TEST_URL+route);assert.equal(response.status(),200);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Public overflow: '+route);
   }
  }finally{await browser.close();}
 });
 await phase('R1 encrypted full backup restores 017 data, passwords, sessions, MFA and ACLs into an independent socket-only cluster',async()=>{
  const tables=(await admin.query("SELECT schemaname||'.'||tablename AS name FROM pg_tables WHERE schemaname IN ('sb','owner_vault','portal','auth','shadowbridge_migrations') ORDER BY 1")).rows.map(r=>r.name);
  const sqlHash=t=>{assert.match(t,/^(sb|owner_vault|portal|auth|shadowbridge_migrations)\.[a-z_]+$/);return `SELECT md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS hash FROM (SELECT to_jsonb(t)::text AS value FROM ${t} t) r`;};
  const hashes=Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await admin.query(sqlHash(t))).rows[0].hash])));
  const archive=path.join(directory,'r1-backup-'+id);await mkdir(archive,{mode:0o700});
  const bytes=execFileSync('docker',['--context','default','exec',source,'pg_dump','-U','postgres','-d','shadowbridge','-Fc'],{maxBuffer:32*1024*1024});
  await writeFile(path.join(archive,'database.dump'),bytes,{mode:0o600,flag:'wx'});
  await writeFile(path.join(archive,'fixture-config.json'),await readFile(path.join(directory,'compose.json')),{mode:0o600,flag:'wx'});
  const tar=path.join(archive,'payload.tar');execFileSync('tar',['--format=ustar','-cf',tar,'database.dump','fixture-config.json'],{cwd:archive});await (await import('node:fs/promises')).chmod(tar,0o600);
  const encrypted=await encryptArchive({archiveFile:tar,backupFile:path.join(archive,'r1.sbb'),keyFile:path.join(archive,'r1.key')});
  const decoded=path.join(archive,'decoded.tar');await decryptArchive({...encrypted,archiveFile:decoded});
  const digest=b=>createHash('sha256').update(b).digest('hex');assert.equal(digest(await readFile(tar)),digest(await readFile(decoded)));
  const extracted=path.join(archive,'restored');await mkdir(extracted,{mode:0o700});execFileSync('tar',['-xf',decoded,'-C',extracted]);
  const dump=await readFile(path.join(extracted,'database.dump'));assert.equal(digest(dump),digest(bytes));
  const cluster='/tmp/shadowbridge-r1-recovery-'+id;
  docker(['exec','--user','postgres',source,'initdb','-D',cluster,'--auth=trust','--no-locale']);
  const recoveryArgs=['exec','-i','--user','postgres','--env','PGHOST='+cluster,'--env','PGPORT=5543',source];
  docker(['exec','--user','postgres',source,'pg_ctl','-D',cluster,'-l',cluster+'/postgres.log','-o',`-c listen_addresses='' -k ${cluster} -p 5543`,'-w','start']);
  const recovery=query=>docker([...recoveryArgs,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge'],query).trim();
  try{
   docker([...recoveryArgs,'createdb','-U','postgres','shadowbridge']);
   assert.equal(recovery("SELECT to_regnamespace('sb') IS NULL AND to_regnamespace('owner_vault') IS NULL"),'t');
   docker([...recoveryArgs,'/bin/sh','/docker-entrypoint-initdb.d/10-sb.sh']);
   recovery(restoredVaultRolesSql);
   recovery(`CREATE ROLE vault_fixture_${marker.project.split('-').at(-1)} NOLOGIN NOINHERIT;`);
   docker([...recoveryArgs,'pg_restore','--clean','--if-exists','--exit-on-error','-U','postgres','-d','shadowbridge'],dump);
   recovery(restoredSentinelRoleSql);
   for(const t of tables)assert.equal(recovery(sqlHash(t)),hashes[t],`Restored full-row fingerprint differs: ${t}`);
   assert.equal(recovery("SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_vault' AND c.relkind='r'"),'t');
   assert.equal(recovery("SELECT has_table_privilege('shadowbridge_api','owner_vault.contacts','SELECT')"),'f');
   assert.equal(recovery("SELECT count(*) FROM shadowbridge_migrations.applied"),'17');
   for(const t of tables)assert.equal((await admin.query(sqlHash(t))).rows[0].hash,hashes[t],'Source must remain untouched: '+t);
   assert.equal((await stat(encrypted.backupFile)).mode&0o777,0o600);
   result.r1Recovery={encrypted:true,restored:true,fullRowEquality:true,tableCount:tables.length,separatePostgresCluster:true,separateContainer:false,networkListener:false,sourcePreserved:true};
   await writeFile(path.join(directory,'r1-recovery-proof.json'),JSON.stringify(result.r1Recovery,null,2)+'\n',{mode:0o600});
  }finally{docker(['exec','--user','postgres',source,'pg_ctl','-D',cluster,'-m','fast','-w','stop']);}
 });
 await phase('R1 actual application restart and rollback to production 7f794a2 preserve 017 data and existing authenticated sessions',async()=>{
  const snapshot=await fingerprint();await restart(root);assert.deepEqual(await fingerprint(),snapshot);
  for(const actor of Object.values(actors))assert.equal((await request(actor,'/api/session')).user.id,actor.user.id);
  const baseline=path.join(directory,'baseline-7f794a2');let created=true;
  try{await mkdir(baseline,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;created=false;}
  if(created){
   const sourceTree=execFileSync('git',['archive','7f794a298713d820af033ba2174cd60bfaa81e4b'],{cwd:root,maxBuffer:32*1024*1024});execFileSync('tar',['-xf','-','-C',baseline],{input:sourceTree});
   await symlink(path.join(root,'node_modules'),path.join(baseline,'node_modules'),'dir');
  }
  assert.equal(await readFile(path.join(baseline,'server/app.mjs'),'utf8'),execFileSync('git',['show','7f794a298713d820af033ba2174cd60bfaa81e4b:server/app.mjs'],{cwd:root,encoding:'utf8'}),'Retained rollback source must match the original production commit');
  const before=await fingerprint(),vaultBefore=(await admin.query('SELECT count(*) FROM owner_vault.contacts')).rows[0].count;
  await restart(baseline);assert.deepEqual(await fingerprint(),before);
  assert.equal((await request(owner,'/api/session')).user.aal,'aal2');await request(owner,'/api/staff/overview');
  assert.equal((await request(actors.supplier,'/api/offers')).items[0].id,offer.id);
  assert.equal((await request(actors.buyer,'/api/rfqs')).items[0].id,rfq.id);
  await owner.client.request('/api/owner/vault/workspace/companies',{expected:404});
  assert.equal((await admin.query('SELECT count(*) FROM owner_vault.contacts')).rows[0].count,vaultBefore);
  assert.equal((await admin.query('SELECT count(*) FROM shadowbridge_migrations.applied')).rows[0].count,'17');
  await restart(root);await request(owner,'/api/owner/vault/workspace/statistics');
  result.r1Rollback={actualRuntimeSwap:true,from:'R1 source',to:'7f794a2 source',forwardReactivation:true,migrationsRetained:17,dataPreserved:true,oldSessionsAndMfaValid:true,dockerImageRollbackTested:false};
 });
}
