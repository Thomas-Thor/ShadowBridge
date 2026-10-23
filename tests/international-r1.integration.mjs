// Resume ONLY the retained, explicitly identified fictional R1/Vault fixture.
// Creates additional fictional actors once; never resets an existing account.
import assert from 'node:assert/strict';
import { randomBytes,createHmac } from 'node:crypto';
import { readFile,writeFile,statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { createApp } from '../server/app.mjs';
import { createDatabase } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { runR1Tests } from './international-r1.cases.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const arg=process.argv.find(v=>v.startsWith('--dir='))?.slice(6);assert.ok(arg,'Explicit completed fictional --dir required');
const directory=path.resolve(root,arg);assert.match(directory,new RegExp('^'+root+'/[.]local/vault-test-[a-f0-9]{10}$'));
const marker=JSON.parse(await readFile(path.join(directory,'fixture.json'),'utf8'));assert.equal(marker.kind,'shadowbridge-owner-vault-isolated-v1');assert.match(marker.project,/^shadowbridge-vault-test-[a-f0-9]{10}$/);
const previous=JSON.parse(await readFile(path.join(directory,'results.json'),'utf8'));
assert.equal(previous.cases.filter(c=>c.result==='PASS').length,17,'Requires the preserved successful V1/V2 cases before R1');
const configuration=JSON.parse(await readFile(path.join(directory,'compose.json'),'utf8'));
const docker=(args,options={})=>execFileSync('docker',['--context','default',...args],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024,...options}).trim();
const compose=args=>docker(['compose','-p',marker.project,'-f',path.join(directory,'compose.json'),...args]);
const original=docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort();
const stateFile=path.join(directory,'r1-state.json');
let state,app,db,admin,actors={},current='R1 fixture resume';
try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const result={...state?.result,kind:'real-international-r1-resume',cases:state?.cases||[],baseVaultCasesRetained:17,mocksUsed:false,externalEmailSent:false,ownerInstallationModified:false,contaboDeployed:false};
const encodeActors=()=>Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,{...a,client:{cookies:[...a.client.cookies],csrf:a.client.csrf}}]));
const save=async()=>{state.actors=encodeActors();state.cases=result.cases;state.result=result;await writeFile(stateFile,JSON.stringify(state)+'\n',{mode:0o600});};
try{
 const disk=await statfs(root);assert(disk.bavail*disk.bsize>128*1024*1024,'Need 128 MiB for test recovery cluster; nothing is removed.');
 compose(['start','postgres']);
 for(let i=0;;i++){try{compose(['exec','-T','postgres','pg_isready','-U','postgres','-d','shadowbridge']);break;}catch{assert(i<60,'Fictional PostgreSQL restart failed');await new Promise(r=>setTimeout(r,200));}}
 compose(['start','auth']);
 const pgPort=Number(compose(['port','postgres','5432']).split(':').at(-1)),authPort=Number(compose(['port','auth','9999']).split(':').at(-1));
 const pgEnv=configuration.services.postgres.environment;
 const connection=role=>`postgres://${role==='postgres'?'postgres':'shadowbridge_'+role}:${pgEnv[role==='postgres'?'POSTGRES_PASSWORD':role==='api'?'SB_API_PASSWORD':'SB_SESSION_PASSWORD']}@127.0.0.1:${pgPort}/shadowbridge`;
 admin=new pg.Client({connectionString:connection('postgres')});await admin.connect();
 assert.equal((await admin.query("SELECT count(*) FROM auth.users WHERE email !~ '@test[.]shadowbridge[.]invalid$'")).rows[0].count,'0','Fixture contains non-test accounts; stop');
 const sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const appPort=sock.address().port;await new Promise(r=>sock.close(r));
 process.env.SHADOWBRIDGE_TEST_URL='http://127.0.0.1:'+appPort;
 const authOrigin='http://127.0.0.1:'+authPort;
 for(let i=0;;i++){try{if((await fetch(authOrigin+'/health')).ok)break;}catch{}assert(i<100,'Fictional GoTrue restart failed');await new Promise(r=>setTimeout(r,200));}
 const jwt=role=>{const v=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return v+'.'+createHmac('sha256',configuration.services.auth.environment.GOTRUE_JWT_SECRET).update(v).digest('base64url');};
 state ||= {kind:'fictional-r1-retained-fixture',project:marker.project,sessionKey:randomBytes(32).toString('base64'),actors:{},records:{},cases:[]};
 assert.equal(state.kind,'fictional-r1-retained-fixture');assert.equal(state.project,marker.project);
 const config=loadConfig({APP_ENV:'test',APP_URL:process.env.SHADOWBRIDGE_TEST_URL,HOST:'127.0.0.1',PORT:String(appPort),SUPABASE_URL:authOrigin,SUPABASE_ANON_KEY:jwt('anon'),DATABASE_URL:connection('api'),SESSION_DATABASE_URL:connection('sessions'),SESSION_ENCRYPTION_KEY:state.sessionKey,MAIL_DELIVERY_MODE:'disabled'});
 const restart=async codeRoot=>{if(app)await app.close();db=createDatabase({connectionString:config.databaseUrl,sessionConnectionString:config.sessionDatabaseUrl});const runtime=codeRoot===root?{createApp}:await import(new URL('file://'+path.join(codeRoot,'server/app.mjs')));app=runtime.createApp({config,db});await new Promise(r=>app.server.listen(appPort,'127.0.0.1',r));};
 await restart(root);const h=await import('../server/tests/helpers.mjs');
 for(const [role,a] of Object.entries(state.actors)){const client=new h.Client();client.cookies=new Map(a.client.cookies);client.csrf=a.client.csrf;actors[role]={...a,client};}
 if(!Object.keys(actors).length){
  const before=(await admin.query("SELECT jsonb_object_agg(id::text,to_jsonb(u)) AS rows FROM auth.users u")).rows[0].rows;
  const dump=execFileSync('docker',['--context','default','exec',compose(['ps','-q','postgres']),'pg_dump','-U','postgres','-d','shadowbridge','-Fc'],{maxBuffer:32*1024*1024});
  await writeFile(path.join(directory,'before-r1-fixtures.dump'),dump,{mode:0o600,flag:'wx'});
  const id=randomBytes(5).toString('hex');
  for(const role of ['owner','general_director','operations_manager','procurement_manager','sales_manager','compliance_finance','staff_analyst','buyer','supplier','partner']){
   const actor={email:`${id}.r1.${role}@test.shadowbridge.invalid`,password:h.password(),client:new h.Client()};
   const response=await fetch(authOrigin+'/admin/users',{method:'POST',headers:{Authorization:'Bearer '+jwt('service_role'),'Content-Type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password,email_confirm:true})});assert.equal(response.status,200);actor.user=await response.json();actors[role]=actor;await actor.client.signIn(actor);
   if(['buyer','supplier','partner'].includes(role))await db.asUser(actor.user,{aal:'aal1'},tx=>tx.query('SELECT sb.submit_application($1,$2::jsonb)',[role,JSON.stringify({legal_name:'FICTIONAL R1 '+id+' '+role,registration_number:'FICTIONAL-'+id+'-'+role,country:'NO'})]));
   else{
    await admin.query('INSERT INTO sb.staff_grants(user_id,active) VALUES($1,true)',[actor.user.id]);
    await admin.query('INSERT INTO sb.staff_role_assignments(user_id,role_key,assigned_by) VALUES($1,$2,$3)',[actor.user.id,role,actors.owner.user.id]);await h.enableMfa(actor);
   }
  }
  for(const role of ['buyer','supplier','partner']){const application=(await admin.query('SELECT id FROM sb.applications WHERE user_id=$1',[actors[role].user.id])).rows[0];await actors.owner.client.request(`/api/admin/applications/${application.id}/decision`,{method:'POST',body:{decision:'approved',reason:'FICTIONAL R1 isolated company fixture; no existing account changed.'},expected:200});}
  for(const [id,row] of Object.entries(before))assert.deepEqual((await admin.query('SELECT to_jsonb(u) AS row FROM auth.users u WHERE id=$1',[id])).rows[0].row,row);
  await save();console.log('PASS: additional fictional R1 actors seeded; all previous auth.users rows preserved');
 }
 const fingerprint=async()=>{
  const tables=['auth.users','auth.mfa_factors','auth.sessions','auth.refresh_tokens','sb.sessions','sb.accounts','sb.companies','sb.memberships','sb.staff_grants','sb.staff_role_assignments','sb.offers','sb.rfqs','sb.projects'];const hashes={};
  for(const t of tables)hashes[t]=(await admin.query(`SELECT md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS hash FROM (SELECT to_jsonb(t)::text AS value FROM ${t} t) r`)).rows[0].hash;return hashes;
 };
 const phase=async(name,fn)=>{current=name;await fn();result.cases.push({name,result:'PASS'});await save();await writeFile(path.join(directory,'r1-results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('PASS: '+name);};
 await runR1Tests({root,directory,compose,admin,db,actors,h,phase,result,fingerprint,restart,records:state.records,completed:result.cases.map(c=>c.name),saveRecords:async records=>{state.records=records;await save();}});
 result.result='PASS';
}catch(error){result.result='FAIL';result.failedCase=current;result.errorType=error.name;await writeFile(path.join(directory,'r1-failure.json'),JSON.stringify({phase:current,message:error.message,stack:error.stack,causeCode:error.cause?.code,causeMessage:error.cause?.message})+'\n',{mode:0o600});console.error('FAIL: '+current+'; private diagnostics retained.');process.exitCode=1;}
finally{
 if(app)await app.close();else if(db)await db.close();if(admin)await admin.end();
 compose(['stop','postgres','auth']);assert.deepEqual(docker(['ps','--format','{{.ID}} {{.Names}}']).split('\n').filter(Boolean).sort(),original);
 result.originalRunningContainersPreserved=true;result.fixtureStoppedWithoutDeletion=true;result.finishedAt=new Date().toISOString();await writeFile(path.join(directory,'r1-results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
}
