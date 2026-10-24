// Real PostgreSQL, a NEW database copied from the retained fictional fixture.
// No owner installation, provider account, real email, or n8n is touched.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {inspectSpace} from '../../scripts/workspace-space.mjs';
import {guardedPaidOperation} from './credit-guard.mjs';
assert.equal(process.env.SHADOWBRIDGE_GLOBAL_TEST,'1');
const base='/tmp/shadowbridge-r1-isolated',socket='unix://'+base+'/overlay.sock',container='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
assert.equal((await inspectSpace({directory:base,dockerRoot:base+'/overlay-data',workspace:process.cwd()})).result,'PASS');
const info=JSON.parse(execFileSync('docker',['--host',socket,'inspect',container]))[0];assert.equal(info.Config.Labels['com.docker.compose.project'],'shadowbridge-stageg-r1full-cd6f2078e0');
const tag=randomBytes(4).toString('hex'),db='acquisition_crm_test_'+tag,dir=new URL('../../.local/crm-guard-'+tag+'/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const roles=Object.fromEntries(['apollo','clay','relevance'].map(x=>[x,'sb_guard_'+x+'_'+tag]));
const literal=x=>"'"+String(x).replaceAll("'","''")+"'",j=x=>literal(JSON.stringify(x))+'::jsonb',list=x=>'ARRAY['+x.map(literal).join(',')+']::text[]';
const execute=(q,role,database=db)=>{try{return execFileSync('docker',['--host',socket,'exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:(role?'SET SESSION AUTHORIZATION '+role+';\n':'')+q,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();}catch(e){throw Object.assign(Error('Isolated SQL failed'),{privateDiagnostic:String(e.stderr)});}};
const query=(q,provider)=>JSON.parse(execute('SELECT '+q,roles[provider]));
const rec=(provider='apollo',id='one',name='FICTIONAL Alex Trade',reg='FICTIONAL-ACQ-1',email='alex@example.invalid')=>({company:{name:'FICTIONAL business '+reg,country:'NO',registrationNumber:reg,sector:'FICTIONAL industrial',website:'https://example.invalid/'},contact:{fullName:name,title:'FICTIONAL director',workEmail:email,emailKind:'individual',professionalUrl:''},source:{system:provider,recordId:id,url:'https://example.invalid/source'}});
const check=(p,needed=['workEmail'])=>query(`acquisition_guard.check_record(${j(p)},'co1',${list(needed)})`,p.source.system);
const save=(p,key=randomUUID(),co='co1')=>query(`acquisition_guard.save_record(${j(p)},${literal(co)},${literal(key)}::uuid)`,p.source.system);
const reserveSql=(p,key=randomUUID(),needed=['workEmail'])=>`acquisition_guard.reserve(${j(p)},'co1',${list(needed)},${literal(key)}::uuid,'email_reveal')`;
const reserve=p=>query(reserveSql(p),p.source.system);
const fingerprint=()=>execute("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY user_id)::text,'[]')) FROM sb.accounts t",null,'shadowbridge');
const result={kind:'actual-postgresql-central-vault-guard',cases:[],providerCallsReal:0,productionChanges:false,n8nImported:false};
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});};
const before=fingerprint();
try{
 execute('CREATE DATABASE '+db+' TEMPLATE shadowbridge',null,'postgres');
 execute(await readFile(new URL('./crm-guard.sql',import.meta.url),'utf8'));
 for(const [provider,role]of Object.entries(roles))execute(`CREATE ROLE ${role} NOLOGIN INHERIT NOSUPERUSER NOBYPASSRLS;GRANT shadowbridge_vault_ingest TO ${role};INSERT INTO owner_vault.agents(label,source_system,database_role,active,created_by) VALUES('FICTIONAL guard',${literal(provider)},${literal(role)},true,${literal(randomUUID())});`);
 await phase('guard disabled by default; raw Vault reads and executor impersonation denied',async()=>{
  assert.throws(()=>check(rec()));assert.throws(()=>execute('SELECT * FROM owner_vault.contacts',roles.apollo));assert.throws(()=>execute('SET ROLE shadowbridge_vault_executor',roles.apollo));execute('UPDATE acquisition_guard.settings SET enabled=true');
 });
 let initialCompanyCount=Number(execute('SELECT count(*) FROM owner_vault.companies')),initialContactCount=Number(execute('SELECT count(*) FROM owner_vault.contacts'));
 await phase('Apollo to existing Vault, payload-bound retries, Clay deduplication and cross-provider aliases',async()=>{
  const p=rec(),key=randomUUID(),first=save(p,key);assert.equal(first.status,'accepted');assert.equal(save(p,key).receipt,first.receipt);assert.throws(()=>save({...p,contact:{...p.contact,title:'changed'}},key));
  assert.equal(check(rec('clay','clay-one')).decision,'already_complete');assert.equal(save(rec('clay','clay-one')).status,'duplicate_prevented');
  assert.equal(Number(execute('SELECT count(*) FROM owner_vault.companies')),initialCompanyCount+1);assert.equal(Number(execute('SELECT count(*) FROM owner_vault.contacts')),initialContactCount+1);
  assert.equal(reserve(rec('clay','clay-one')).decision,'already_complete');
 });
 await phase('exact name/company or shared domain ambiguity blocks purchases; same names in different companies stay distinct',async()=>{
  const weak=rec('clay','another','FICTIONAL Alex Trade','FICTIONAL-ACQ-1','');assert.equal(check(weak).decision,'review_required');assert.equal(save(weak).status,'review_required');assert.equal(reserve(weak).allowed,false);
  const other=rec('apollo','other','FICTIONAL Alex Trade','FICTIONAL-ACQ-2','another@example.invalid');assert.equal(save(other,randomUUID(),'co2').status,'accepted');
  const domain=rec('clay','domain','FICTIONAL New','','');assert.equal(query(`acquisition_guard.check_record(${j(domain)},'unbound-domain',ARRAY['workEmail'])`,'clay').decision,'review_required');
 });
 await phase('company-only intake reuses central CRM without fictitious contact records',async()=>{
  const p=rec('apollo','company-only','unused','FICTIONAL-ACQ-3');delete p.contact;const n=execute('SELECT count(*) FROM owner_vault.contacts');assert.equal(save(p,randomUUID(),'co3').status,'accepted');assert.equal(execute('SELECT count(*) FROM owner_vault.contacts'),n);
 });
 await phase('free facts awaiting controlled merge count as already owned, without overwriting curated CRM data',async()=>{
  const p=rec('apollo','company-history','unused','FICTIONAL-ACQ-4');delete p.contact;p.company.website='';p.company.sector='';save(p,randomUUID(),'co4');
  const enriched={...p,company:{...p.company,website:'https://new.example.invalid/',sector:'FICTIONAL known sector'}};save(enriched,randomUUID(),'co4');
  assert.equal(query(`acquisition_guard.check_record(${j(enriched)},'co4',ARRAY['website','sector'])`,'apollo').decision,'already_complete');assert.equal(execute("SELECT website FROM owner_vault.companies WHERE registration_number='FICTIONAL-ACQ-4'"),'');
  const c=rec('apollo','profile-history','FICTIONAL Profile','FICTIONAL-ACQ-1','profile@example.invalid');save(c);const extra={...c,contact:{...c.contact,professionalUrl:'https://example.invalid/professional/profile-history'}};assert.equal(save(extra).status,'review_required');assert.equal(check(extra,['professionalUrl']).decision,'already_complete');
 });
 const pending=rec('apollo','pending','FICTIONAL New Person','FICTIONAL-ACQ-1','');
 await phase('paid disabled and unknown API/budget metadata stop requests before any dispatch',async()=>{
  assert.equal(reserve(pending).decision,'paid_disabled');execute('UPDATE acquisition_guard.settings SET paid_enabled=true');assert.equal(reserve(pending).decision,'unverified_budget_or_contract');
  for(const provider of ['apollo','clay','relevance'])execute(`INSERT INTO acquisition_guard.policies(provider,operation,approved,unit_credit_max,daily_cap,monthly_cap,available_credits,verified_at) VALUES(${literal(provider)},'email_reveal',true,2,4,4,20,clock_timestamp())`);
 });
 let reserved;
 await phase('eight concurrent cross-provider requests reserve one field once; dispatch and timeout never redispatch',async()=>{
  const once=i=>new Promise((resolve,reject)=>{const p=i%2?{...pending,source:{...pending.source,system:'clay',recordId:'clay-pending'}}:pending;const c=spawn('docker',['--host',socket,'exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db]);let out='';c.stdout.on('data',x=>out+=x);c.stderr.resume();c.once('error',reject);c.once('exit',code=>code?reject(Error('Concurrent guard query failed')):resolve({...JSON.parse(out.trim()),provider:p.source.system}));c.stdin.end('SET SESSION AUTHORIZATION '+roles[p.source.system]+';SELECT '+reserveSql(p));});
  const all=await Promise.all(Array.from({length:8},(_,i)=>once(i)));assert.equal(all.filter(x=>x.allowed).length,1);reserved=all.find(x=>x.allowed);
  assert.equal(query(`acquisition_guard.dispatch(${literal(reserved.reservation)}::uuid)`,reserved.provider).dispatch,true);assert.equal(query(`acquisition_guard.dispatch(${literal(reserved.reservation)}::uuid)`,reserved.provider).dispatch,false);
  execute(`SELECT acquisition_guard.uncertain(${literal(reserved.reservation)}::uuid)`,roles[reserved.provider]);assert.equal(reserve(pending).allowed,false);
  save(pending);assert.equal(reserve(pending).allowed,false); // Target cannot change after a contact gains its CRM ID.
 });
 await phase('daily and monthly credit ceilings stop new purchases without releasing uncertain charges',async()=>{
  const provider=reserved.provider,second=rec(provider,'second','FICTIONAL Second','FICTIONAL-ACQ-1',''),third=rec(provider,'third','FICTIONAL Third','FICTIONAL-ACQ-1','');assert.equal(reserve(second).allowed,true);assert.equal(reserve(third).decision,'budget_stop');
  execute(`UPDATE acquisition_guard.policies SET daily_cap=100 WHERE provider=${literal(provider)}`);assert.equal(reserve(third).decision,'budget_stop');
 });
 await phase('CRM is checked again at dispatch; successful synthetic enrichment is durably recorded in central Vault',async()=>{
  const p=rec('relevance','between','FICTIONAL Between','FICTIONAL-ACQ-1',''),r=reserve(p);assert.equal(r.allowed,true);save({...p,contact:{...p.contact,workEmail:'between@example.invalid'}});assert.equal(query(`acquisition_guard.dispatch(${literal(r.reservation)}::uuid)`,'relevance').dispatch,false);
  execute("UPDATE acquisition_guard.policies SET daily_cap=100,monthly_cap=100 WHERE provider='relevance'");
  const fresh=rec('relevance','success','FICTIONAL Success','FICTIONAL-ACQ-1','');
  const crm={call:async(action,input)=>{if(action==='intake')return save(input.record,input.requestKey);if(action==='check')return check(input.record,input.requiredFields);if(action==='reserve')return query(reserveSql(input.record,input.requestKey,input.requiredFields),'relevance');if(action==='dispatch')return query(`acquisition_guard.dispatch(${literal(input.reservation)}::uuid)`,'relevance');if(action==='finish')return query(`acquisition_guard.finish(${literal(input.reservation)}::uuid,${j(input.record)},'co1',${literal(input.requestKey)}::uuid)`,'relevance');throw Error('Unexpected action');}};
  let calls=0;const provider={contractVerified:true,call:async({record,requiredFields})=>{calls++;assert.deepEqual(requiredFields,['workEmail']);return {...record,contact:{...record.contact,workEmail:'success@example.invalid'}};}};
  const args={approved:true,crm,provider,record:fresh,companySourceId:'co1',requiredFields:['workEmail','title'],requestKey:randomUUID(),operation:'email_reveal'};
  assert.equal((await guardedPaidOperation(args)).status,'CRM_INTAKE_RECORDED');assert.equal(calls,1);assert.equal((await guardedPaidOperation({...args,requestKey:randomUUID()})).providerCalls,0);assert.equal(calls,1);result.syntheticProviderCalls=calls;
 });
 await phase('search fingerprint remembers filters and cursor across sessions, rejects stale lease, never resets an exhausted query',async()=>{
  const filters={country:'MX',sector:'FICTIONAL industry',sourceKey:'fictional-search',queryVersion:1};
  const claim=()=>query(`acquisition_guard.search_page(${j(filters)})`,'apollo');const first=claim();assert.equal(first.fetch,true);assert.equal(claim().fetch,false);
  query(`acquisition_guard.search_page(${j(filters)},'{"page":2}'::jsonb,${literal(first.lease)}::uuid,false)`,'apollo');const second=claim();assert.equal(second.cursor.page,2);
  assert.throws(()=>query(`acquisition_guard.search_page(${j(filters)},'{"page":3}'::jsonb,${literal(first.lease)}::uuid,false)`,'apollo'));
  query(`acquisition_guard.search_page(${j(filters)},'{"page":3}'::jsonb,${literal(second.lease)}::uuid,true)`,'apollo');assert.equal(claim().exhausted,true);
  assert.equal(query(`acquisition_guard.search_page(${j({...filters,country:'BR'})})`,'apollo').cursor.page,1);
 });
 await phase('provider-scoped report distinguishes new records, duplicates, reserved credits and unconfirmed actual costs',async()=>{
  const report=query('acquisition_guard.usage()','apollo');assert.equal(report.provider,'apollo');assert.ok(report.newCompanies>=1);assert.ok(report.duplicates>=1);assert.equal(report.actualCredits,null);assert.equal(report.actualMoneyCost,null);assert.equal(report.billingReconciled,false);assert.ok(!JSON.stringify(report).includes('@example.invalid'));result.providerReport=report;
 });
 assert.equal(fingerprint(),before);result.originalAccountFingerprintPreserved=true;result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.message;await writeFile(new URL('private-failure.json',dir),JSON.stringify({stack:e.stack,diagnostic:e.privateDiagnostic})+'\n',{mode:0o600});console.error('FAIL: '+e.message+'; private details retained');process.exitCode=1;}
finally{result.databaseRetained=db;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
