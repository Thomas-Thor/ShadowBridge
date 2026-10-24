// One missing acceptance check, on a NEW clone of retained FICTIONAL data.
// No migration, account edit, live Auth login or real server access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {migrationSources} from '../scripts/staging-migrate.mjs';
import {inspectSpace} from '../scripts/workspace-space.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');
assert.equal((await inspectSpace({dockerRoot:'/tmp/shadowbridge-r1-isolated/overlay-data'})).result,'PASS');
const D=['--host','unix:///tmp/shadowbridge-r1-isolated/overlay.sock'],pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';
const docker=(args,input)=>execFileSync('docker',[...D,...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
assert.equal(JSON.parse(docker(['inspect',pg]))[0].Config.Labels['com.docker.compose.project'],'shadowbridge-stageg-r1full-cd6f2078e0');
const id=randomBytes(4).toString('hex'),db='r1_expiry_'+id,dir=new URL('../.local/r1-expiry-'+id+'/',import.meta.url);await mkdir(dir,{mode:0o700,recursive:true});
const sql=(q,database=db)=>docker(['exec','-i',pg,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],q);
const lit=s=>"'"+s.replaceAll("'","''")+"'",hash=s=>createHash('sha256').update(s).digest('hex');
const report={kind:'real-pg-expiry-and-merged-ledger',productionChanges:false,realAccounts:false,interactiveGoTrueLoginTested:false,databaseRetained:db};
try{
 sql('CREATE DATABASE '+db+' TEMPLATE owner_book_test_2db3cf7b','postgres');
 const sources=await migrationSources();assert.equal(sources.length,18);
 assert.deepEqual(JSON.parse(sql('SELECT json_agg(json_build_object(\'name\',name,\'sha256\',sha256) ORDER BY name) FROM shadowbridge_migrations.applied')),sources.map(s=>({name:s.name,sha256:s.sha256})));
 const owner=sql("SELECT id FROM auth.users WHERE email='fictional-owner-2db3cf7b@ownerbook.test.invalid'");assert.match(owner,/^[a-f0-9-]{36}$/);
 const protectedHash=()=>sql("SELECT md5(to_jsonb(u)::text||(SELECT jsonb_agg(to_jsonb(f) ORDER BY id)::text FROM auth.mfa_factors f WHERE user_id=u.id)) FROM auth.users u WHERE id="+lit(owner));const before=protectedHash();
 const raw='sbob_'+randomBytes(32).toString('base64url'),digest=hash(raw),p={name:'FICTIONAL expiry acceptance',mode:'read_only',scopes:['task.read'],tokenHash:digest,expiresAt:new Date(Date.now()+5000).toISOString()};
 const issued=JSON.parse(sql('SET SESSION AUTHORIZATION shadowbridge_api;BEGIN;SET LOCAL "request.jwt.claim.sub"='+lit(owner)+';SET LOCAL "request.jwt.claim.aal"=\'aal2\';SET LOCAL "request.jwt.claim.mfa_verified_at"='+lit(String(Math.floor(Date.now()/1000)))+';SELECT owner_book.owner_rpc(\'key_create\',NULL,'+lit(JSON.stringify(p))+'::jsonb,'+lit(randomUUID())+'::uuid,NULL);COMMIT;'));assert.equal(issued.status,200);
 const token=()=>JSON.parse(sql('SET SESSION AUTHORIZATION shadowbridge_sessions;SELECT owner_book.token_rpc('+lit(digest)+',\'list\',\'task\',\'{}\'::jsonb,NULL,false,'+lit(hash('fictional-expiry-client'))+','+lit(randomUUID())+'::uuid)'));
 assert.equal(token().status,200);await new Promise(r=>setTimeout(r,5100));assert.equal(token().status,401);assert.equal(protectedHash(),before);
 assert.equal(sql("SELECT count(*) FROM owner_book.audit WHERE key_id="+lit(issued.data.id)+"::uuid AND outcome='denied'"),'1');
 report.result='PASS';report.appliedMigrationChecksumsMatchMergedRelease=18;report.validBeforeExpiry=true;report.deniedAfterExpiry=true;report.denialAudited=true;report.accountAndMfaUnchanged=true;console.log('PASS real PostgreSQL: merged 001–018 checksums, valid key -> expired 401, audit and unchanged account/MFA');
}catch(e){report.result='FAIL';await writeFile(new URL('private-failure.json',dir),JSON.stringify({message:e.message,stderr:String(e.stderr||'')})+'\n',{mode:0o600});process.exitCode=1;console.error('FAIL: private expiry diagnostic retained');}
await writeFile(new URL('results.json',dir),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);
