// Real PostgreSQL performance/security test. No new n8n is installed or started.
// Only the retained fictional R1 PostgreSQL on the isolated /tmp daemon is used.
import assert from 'node:assert/strict';import{execFileSync,spawn}from'node:child_process';import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomBytes,createHash}from'node:crypto';import{performance}from'node:perf_hooks';import path from'node:path';
import{inspectSpace}from'../../scripts/workspace-space.mjs';import{acquisition}from'./core.mjs';
assert.equal(process.env.SHADOWBRIDGE_GLOBAL_TEST,'1','Explicit isolated test opt-in required');
const root=path.resolve(new URL('../..',import.meta.url).pathname),pool='/tmp/shadowbridge-r1-isolated';assert.equal((await inspectSpace({directory:pool,dockerRoot:pool+'/overlay-data',workspace:root})).result,'PASS');
const D=['--host','unix://'+pool+'/overlay.sock'];const pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
const info=JSON.parse(execFileSync('docker',[...D,'inspect',pg]))[0];assert.equal(info.Config.Labels['com.docker.compose.project'],'shadowbridge-stageg-r1full-cd6f2078e0');assert.equal(info.State.Running,true);
const id=randomBytes(4).toString('hex'),db='nightly_global_test_'+id,group='sb_acq_client_'+id,executor='sb_acq_exec_'+id,dir=path.join(root,'.local','global-test-'+id);await mkdir(dir,{recursive:true,mode:0o700});
const result={kind:'real-postgresql-synthetic-acquisition-benchmark',cases:[],realProvidersCalled:false,n8nStarted:false,contaboTouched:false,fixture:db};
const sql=(q,role)=>{try{return execFileSync('docker',[...D,'exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],{input:(role?'SET SESSION AUTHORIZATION '+role+';\n':'')+q,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024**2}).trim();}catch(e){throw Object.assign(new Error('Isolated SQL failed'),{privateDiagnostic:String(e.stderr)});}};
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>literal(JSON.stringify(v))+'::jsonb';const roles=Object.fromEntries(['LATAM','ASIA','EUROPE','REPORT'].map(r=>[r,'sb_acq_'+r.toLowerCase()+'_'+id]));
let clock=new Date('2026-10-24T01:15:00Z');
const setClock=()=>sql(`CREATE OR REPLACE FUNCTION acquisition_ops.clock() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT ${literal(clock.toISOString())}::timestamptz $$;`);
const advance=seconds=>{clock=new Date(clock.getTime()+seconds*1000);setClock();};
const claim=r=>JSON.parse(sql(`SELECT acquisition_ops.claim(${literal(r)})`,roles[r]));
const commit=(r,j,p)=>JSON.parse(sql(`SELECT acquisition_ops.commit_page(${j.id},${literal(j.lease)}::uuid,${json(p)})`,roles[r]));
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});await writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('PASS: '+name);};
const source=(r)=>({identityNamespace:'fictional_shared',action:'read_stored_or_search_results',endpoint:'https://api.apollo.io/api/v1/mixed_companies/search',method:'POST',pageSize:100,entityType:r==='EUROPE'?'opportunity':'contact',category:'industrial-supplies',countryMap:{},mapping:{rows:['items'],companyId:['id'],companyName:['name'],country:['country'],registrationNumber:['reg'],industry:['industry'],description:['description'],contactId:['personId'],contactName:['fullName'],email:['email'],opportunityId:['lotId'],opportunityType:['kind'],opportunityDescription:['lotDescription'],opportunityUrl:['lotUrl']},pagination:{mode:'page',requestField:'page',sizeField:'per_page',totalPagesPath:['pages']}});
const data=(r,page)=>Array.from({length:100},(_,i)=>{const n=(page-1)*100+i,country={LATAM:'MX',ASIA:'IN',EUROPE:'PL'}[r];return{id:r+'-'+n,name:'FICTIONAL company '+n,reg:'FICTIONAL-'+r+'-'+n,country,industry:'FICTIONAL manufacturing',description:'FICTIONAL generated test only',personId:'person-'+r+'-'+n,fullName:'FICTIONAL Person '+n,email:'fictional-'+r+'-'+n+'@example.invalid',lotId:'lot-'+r+'-'+n,kind:['BUY','SELL','SURPLUS'][i%3],lotDescription:'FICTIONAL explicit listing',lotUrl:'https://example.invalid/lot/'+r+'-'+n};});
try{
 execFileSync('docker',[...D,'exec',pg,'createdb','-U','postgres',db],{stdio:['ignore','pipe','pipe']});
 let schema=await readFile(new URL('./storage.sql',import.meta.url),'utf8');schema=schema.replaceAll('shadowbridge_acquisition_executor',executor).replaceAll('shadowbridge_acquisition_client',group);sql(schema);setClock();
 await phase('new operational schema, private rows, no OWNER role or CRM migration',async()=>{
  for(const[r,role]of Object.entries(roles))sql(`CREATE ROLE ${role} NOLOGIN INHERIT NOSUPERUSER NOBYPASSRLS;GRANT ${group} TO ${role};INSERT INTO acquisition_ops.bindings(login,region,active) VALUES(${literal(role)},${literal(r)},true);`);
  assert.equal(claim('LATAM').reason,'OWNER_APPROVAL_REQUIRED');sql('UPDATE acquisition_ops.settings SET enabled=true');
  sql("INSERT INTO acquisition_ops.accounts(provider,api_access_verified,daily_request_limit) VALUES('apollo',true,100)");
  for(const r of ['LATAM','ASIA','EUROPE'])sql(`INSERT INTO acquisition_ops.sources(key,provider,regions,approved,contract_verified,retention_approved,config,daily_request_limit,max_credits_per_request) VALUES(${literal(r.toLowerCase())},'apollo',ARRAY[${literal(r)}],true,true,true,${json(source(r))},20,0)`);
  assert.throws(()=>sql('SELECT * FROM acquisition_ops.outbox',roles.LATAM));assert.throws(()=>sql("SELECT acquisition_ops.claim('ASIA')",roles.LATAM));assert.throws(()=>sql("SELECT acquisition_ops.owner_report('2026-10-24')",roles.LATAM));assert.throws(()=>sql('SET ROLE '+executor,roles.LATAM));
 });
 let replay,firstJob;
 await phase('1200 unique synthetic records in bounded SQL batches, durable cursors and replay safety',async()=>{
  const start=performance.now();
  for(let page=1;page<=2;page++)for(const r of ['LATAM','ASIA','EUROPE']){
   const j=claim(r);assert.equal(j.fetch,true);assert.equal(j.cursor.page,page);const p=acquisition('page',{job:j,response:{statusCode:200,body:{items:data(r,page),pages:2}},now:clock.toISOString()});
   const saved=commit(r,j,p);assert.equal(saved.added,200);assert.equal(saved.crmDelivered,0);if(!replay){replay=p;firstJob=j;}
   advance(3);
  }
  result.performance={records:1200,companyRecords:600,contactRecords:400,opportunityRecords:200,batches:6,batchSize:200,elapsedMs:Math.round(performance.now()-start),providerLatencyIncluded:false,n8nExecutionIncluded:false,realRecordsAcquired:0};
  assert.equal(sql('SELECT count(*) FROM acquisition_ops.outbox'),'1200');assert.equal(commit('LATAM',firstJob,replay).replay,true);assert.equal(sql('SELECT count(*) FROM acquisition_ops.outbox'),'1200');
  assert.throws(()=>commit('LATAM',firstJob,{...replay,nextCursor:{page:999}}));assert.equal(claim('LATAM').fetch,false);
 });
 await phase('source identity duplicates do not overwrite records and distinct companies survive similar names',async()=>{
  const cfg=source('LATAM');sql(`INSERT INTO acquisition_ops.sources(key,provider,regions,approved,contract_verified,retention_approved,config,daily_request_limit,max_credits_per_request) VALUES('latam_repeat','apollo',ARRAY['LATAM'],true,true,true,${json(cfg)},20,0)`);
  const j=claim('LATAM'),p=acquisition('page',{job:j,response:{statusCode:200,body:{items:data('LATAM',1),pages:1}},now:clock.toISOString()});const r=commit('LATAM',j,p);assert.equal(r.added,0);assert.equal(r.duplicates,200);assert.equal(sql('SELECT count(*) FROM acquisition_ops.outbox'),'1200');
 });
 await phase('unknown or exhausted credit balances block calls; 429 pauses all future jobs for that source',async()=>{
  sql("INSERT INTO acquisition_ops.sources(key,provider,regions,approved,contract_verified,retention_approved,config,daily_request_limit,max_credits_per_request,daily_credit_limit,monthly_credit_limit,balance_confirmed_at,confirmed_available_credits) SELECT 'paid_probe',provider,regions,true,true,true,config,20,2,10,100,acquisition_ops.clock(),100 FROM acquisition_ops.sources WHERE key='latam'");
  assert.equal(claim('LATAM').fetch,false);sql("UPDATE acquisition_ops.accounts SET daily_credit_limit=10,monthly_credit_limit=100,available_credits=1,verified_at=acquisition_ops.clock() WHERE provider='apollo'");assert.equal(claim('LATAM').fetch,false);
  sql("UPDATE acquisition_ops.accounts SET available_credits=10 WHERE provider='apollo'");const j=claim('LATAM');assert.equal(j.fetch,true);const e=acquisition('page',{job:j,response:{statusCode:429,headers:{'Retry-After':'172800'}},now:clock.toISOString()});commit('LATAM',j,e);assert.equal(claim('LATAM').fetch,false);assert.equal(sql("SELECT sum(credits_upper_bound) FROM acquisition_ops.calls"),'2');
 });
 await phase('parallel claims obey a global limit and expired lease cannot overwrite a replacement checkpoint',async()=>{
  sql("INSERT INTO acquisition_ops.accounts(provider,api_access_verified,daily_request_limit) VALUES('clay',true,100)");
  for(let i=0;i<3;i++)sql(`INSERT INTO acquisition_ops.sources(key,provider,regions,approved,contract_verified,retention_approved,config,daily_request_limit,max_credits_per_request) VALUES('parallel_${i}','clay',ARRAY['LATAM'],true,true,true,${json(source('LATAM'))},20,0)`);
  const once=()=>new Promise((resolve,reject)=>{const p=spawn('docker',[...D,'exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db]);let out='';p.stdout.on('data',b=>out+=b);p.stderr.resume();p.once('error',reject);p.once('exit',c=>c?reject(new Error('Concurrent fixture query failed')):resolve(JSON.parse(out.trim())));p.stdin.end(`SET SESSION AUTHORIZATION ${roles.LATAM};SELECT acquisition_ops.claim('LATAM');`);});
  const leased=(await Promise.all(Array.from({length:8},once))).filter(v=>v.fetch);assert.equal(leased.length,3);assert.equal(new Set(leased.map(v=>v.lease)).size,3);
  advance(121);const next=claim('LATAM');assert.equal(next.fetch,true);const original=leased.find(v=>v.id===next.id);assert.ok(original);assert.notEqual(original.lease,next.lease);
  const p=acquisition('page',{job:next,response:{statusCode:200,body:{items:[],pages:0}},now:clock.toISOString()});assert.throws(()=>commit('LATAM',original,p));assert.equal(commit('LATAM',next,p).added,0);
  sql("UPDATE acquisition_ops.jobs SET status='done',lease=NULL,lease_until=NULL WHERE source_key LIKE 'parallel_%'");
 });
 await phase('actual PostgreSQL Oslo daily keys survive repeated autumn 0200 and spring recovery after missing 0200',async()=>{
  clock=new Date('2026-10-25T00:15:00Z');setClock();const first=claim('ASIA');assert.equal(first.fetch,true);clock=new Date('2026-10-25T01:15:00Z');setClock();const second=claim('ASIA');assert.equal(second.id,first.id);assert.notEqual(second.lease,first.lease);assert.equal(sql("SELECT count(*) FROM acquisition_ops.jobs WHERE region='ASIA' AND day='2026-10-25' AND source_key='asia'"),'1');
  clock=new Date('2026-03-29T01:15:00Z');setClock();sql(`INSERT INTO acquisition_ops.sources(key,provider,regions,approved,contract_verified,retention_approved,config,daily_request_limit,max_credits_per_request) VALUES('spring_recovery','clay',ARRAY['ASIA'],true,true,true,${json(source('ASIA'))},20,0)`);
  const recovered=claim('ASIA');assert.equal(recovered.fetch,true);assert.equal(recovered.source.key,'spring_recovery');assert.equal(recovered.day,'2026-03-29');
 });
 await phase('OWNER 0800 aggregate separates companies/contacts/opportunities, queues and actual credit uncertainty',async()=>{
  const r=JSON.parse(sql("SELECT acquisition_ops.owner_report('2026-10-24')",roles.REPORT));assert.equal(r.newRecords,1200);assert.equal(r.companies,600);assert.equal(r.contacts,400);assert.equal(r.BUY+r.SELL+r.SURPLUS,200);assert.equal(r.duplicates,200);assert.equal(r.crmDelivered,0);assert.equal(r.crmPending,1200);assert.equal(r.actualCredits,null);assert.equal(r.errors,1);
  assert.ok(!/[\u2013\u2014]/.test(acquisition('reportText',{report:r})));assert.ok(!JSON.stringify(r).includes('@example.invalid'));result.ownerReport=r;
 });
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.message;await writeFile(path.join(dir,'private-failure.json'),JSON.stringify({message:e.message,stack:e.stack,diagnostic:e.privateDiagnostic})+'\n',{mode:0o600});console.error('FAIL: private test diagnostics retained in '+dir);process.exitCode=1;}
finally{result.retainedDatabase=db;result.originalDatabasesNotReset=true;await writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir);if(result.performance)console.log(JSON.stringify(result.performance));}
