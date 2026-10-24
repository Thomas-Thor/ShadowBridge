// Decrypt a completed FICTIONAL fixture into a NEW PostgreSQL container, then
// smoke-test the retained pre-Book R1 app against a cloned upgraded database.
import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{readFile,writeFile,mkdir}from'node:fs/promises';import{randomBytes}from'node:crypto';import path from'node:path';
import{inspectSpace}from'../scripts/workspace-space.mjs';import{decryptArchive}from'../scripts/staging-backup.mjs';import{archiveHasBook,restoredBookRolesSql}from'../scripts/book-recovery-roles.mjs';
assert.equal(process.env.SHADOWBRIDGE_TEST_OWNER_BOOK,'1');const arg=process.argv.find(v=>v.startsWith('--fixture='))?.slice(10);assert.match(arg||'',/^[a-f0-9]{8}$/);
const pool='/tmp/shadowbridge-r1-isolated',D=['--host','unix://'+pool+'/overlay.sock'],pg='shadowbridge-stageg-r1full-cd6f2078e0-postgres-1';assert.equal((await inspectSpace({directory:pool,dockerRoot:pool+'/overlay-data',workspace:process.cwd()})).result,'PASS');
const sourceDir=new URL('../.local/owner-book-'+arg+'/',import.meta.url),previous=JSON.parse(await readFile(new URL('results.json',sourceDir),'utf8'));assert.equal(previous.result,'PASS');
const tag=randomBytes(4).toString('hex'),dir=new URL('../.local/owner-book-recovery-'+tag+'/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const fresh='shadowbridge-book-recovery-'+tag,oldApp='shadowbridge-book-rollback-'+tag;let freshStarted=false,oldStarted=false;
const result={kind:'owner-book-fresh-restore-and-rollback',cases:[],productionChanges:false,interactiveGoTrueLoginTested:false};
const docker=(args,opts={})=>execFileSync('docker',[...D,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:64*1024**2,...opts}).trim();
const sql=(container,database,q)=>docker(['exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:q});
const phase=async(name,fn)=>{await fn();result.cases.push({name,result:'PASS'});console.log('PASS '+name);await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});};
try{
 const archive=new URL('recovered.dump',dir).pathname;await decryptArchive({backupFile:new URL('full.sbb',sourceDir).pathname,keyFile:new URL('recovery.key',sourceDir).pathname,archiveFile:archive});
 const image=JSON.parse(docker(['inspect',pg]))[0].Config.Image;
 const envFile=new URL('postgres.env',dir).pathname;await writeFile(envFile,'POSTGRES_DB=shadowbridge\nPOSTGRES_PASSWORD='+randomBytes(32).toString('hex')+'\n',{mode:0o600});
 docker(['run','-d','--name',fresh,'--label','io.shadowbridge.test=owner-book-recovery','--network','none','--env-file',envFile,'--mount','type=volume,source='+fresh+'-data,target=/var/lib/postgresql/data',image]);freshStarted=true;
 for(let i=0;i<100;i++){try{if(sql(fresh,'shadowbridge','SELECT 1')==='1')break;}catch{}if(i===99)throw Error('Fresh PostgreSQL startup failed');await new Promise(r=>setTimeout(r,100));}
 const bookRole=sql(pg,previous.databaseRetained,"SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='owner_book.owner_rpc(text,text,jsonb,uuid,uuid)'::regprocedure");assert.match(bookRole,/^sb_book_executor_[a-f0-9]{8}$/);
 const roles=JSON.parse(sql(pg,'postgres',"SELECT json_agg(json_build_object('name',rolname,'bypass',rolbypassrls,'super',rolsuper)) FROM pg_roles WHERE rolname<>'postgres' AND rolname NOT LIKE 'pg_%'"));
 for(const r of roles){assert.match(r.name,/^[a-z0-9_]+$/);assert.equal(r.super,false);if(r.name!==bookRole)sql(fresh,'shadowbridge','CREATE ROLE '+r.name+' NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION '+(r.bypass?'BYPASSRLS':'NOBYPASSRLS'));}
 await phase('empty-target helper creates exactly the required non-login book role and rejects retries',async()=>{
  const catalog=docker(['exec','-i',fresh,'pg_restore','--list'],{input:await readFile(archive)});assert.equal(archiveHasBook(catalog),true);
  const definition=restoredBookRolesSql.replaceAll('shadowbridge_book_executor',bookRole);sql(fresh,'shadowbridge',definition);assert.throws(()=>sql(fresh,'shadowbridge',definition));
  assert.equal(sql(fresh,'shadowbridge',"SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname='"+bookRole+"'"),'t');
 });
 await phase('encrypted full backup restores into a fresh isolated PostgreSQL with all records, RLS and key ACLs',async()=>{
  docker(['exec','-i',fresh,'pg_restore','--exit-on-error','-U','postgres','-d','shadowbridge'],{input:await readFile(archive)});
  const tables=sql(pg,previous.databaseRetained,"SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('auth','sb','portal','owner_vault','owner_book','shadowbridge_migrations') ORDER BY 1").split('\n');
  for(const t of tables){assert.match(t,/^(auth|sb|portal|owner_vault|owner_book|shadowbridge_migrations)\.[a-z_]+$/);const q=`SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM ${t} x`;assert.equal(sql(fresh,'shadowbridge',q),sql(pg,previous.databaseRetained,q));}
  assert.equal(sql(fresh,'shadowbridge',"SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_book' AND c.relkind='r'"),'t');
  assert.equal(sql(fresh,'shadowbridge',"SELECT has_table_privilege('shadowbridge_api','owner_book.entries','SELECT')"),'f');
  assert.equal(sql(fresh,'shadowbridge',"SELECT has_function_privilege('shadowbridge_sessions','owner_book.owner_rpc(text,text,jsonb,uuid,uuid)','EXECUTE')"),'f');result.restoredTableCount=tables.length;
 });
 await phase('previous R1 runtime starts against upgraded DB without deleting Command Book data',async()=>{
  const template=JSON.parse(docker(['inspect','shadowbridge-stageg-r1full-cd6f2078e0-app-1']))[0];assert.ok(template.Config.Image);
  const cloned='book_rollback_'+tag;sql(pg,'postgres','CREATE DATABASE '+cloned+' TEMPLATE '+previous.databaseRetained);
  const before=sql(pg,cloned,"SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'[]')) FROM owner_book.entries e");
  const env=template.Config.Env.map(line=>{const index=line.indexOf('='),name=line.slice(0,index),value=line.slice(index+1);if(['DATABASE_URL','SESSION_DATABASE_URL'].includes(name)){const u=new URL(value);u.pathname='/'+cloned;return name+'='+u.href;}return line;});
  const file=new URL('rollback.env',dir).pathname;await writeFile(file,env.join('\n')+'\n',{mode:0o600});
  const network=Object.keys(template.NetworkSettings.Networks)[0];assert.match(network,/^shadowbridge-stageg-r1full-[a-f0-9]+_/);
  const args=['run','-d','--name',oldApp,'--label','io.shadowbridge.test=owner-book-rollback','--network',network,'--env-file',file];
  for(const m of template.Mounts){assert.equal(m.Type,'bind');args.push('--mount','type=bind,source='+m.Source+',target='+m.Destination+',readonly');}
  args.push(template.Config.Image);docker(args);oldStarted=true;
  let ok=false;for(let i=0;i<100;i++){try{ok=docker(['exec',oldApp,'node','-e',"fetch('http://127.0.0.1:8088/health').then(async r=>{if(!r.ok)process.exit(2);console.log((await r.json()).ok)})"])==='true';if(ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(ok,true);
  assert.equal(docker(['exec',oldApp,'node','-e',"fetch('http://127.0.0.1:8088/api/config').then(async r=>console.log((await r.json()).backendEnabled))"]),'true');
  assert.equal(docker(['exec',oldApp,'node','-e',"fetch('http://127.0.0.1:8088/assets/owner-book.js').then(r=>console.log(r.status))"]),'404');
  assert.equal(sql(pg,cloned,"SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'[]')) FROM owner_book.entries e"),before);
  result.rollbackDatabaseRetained=cloned;result.rollbackImage=template.Image;result.rollbackAuthenticatedUserFlowTested=false;
 });
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.message;await writeFile(new URL('private-failure.json',dir),JSON.stringify({message:e.message,stack:e.stack,stderr:String(e.stderr||'')})+'\n',{mode:0o600});console.error('FAIL private recovery diagnostic retained');process.exitCode=1;}
finally{if(oldStarted)docker(['stop',oldApp]);if(freshStarted)docker(['stop',fresh]);result.testContainersStopped=true;result.recoveryContainerRetained=fresh;await writeFile(new URL('results.json',dir),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT '+dir.pathname);}
