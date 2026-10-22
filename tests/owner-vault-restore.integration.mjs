// Restore regression ONLY for an already completed fictional Vault fixture.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { archiveHasVault, restoredVaultRolesSql, privateArchiveCatalog } from '../scripts/vault-recovery-roles.mjs';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const arg=process.argv.find(v=>v.startsWith('--dir='))?.slice(6);assert.ok(arg,'Explicit fictional fixture required');
const directory=path.resolve(root,arg);assert.match(directory,new RegExp('^'+root+'/[.]local/vault-test-[a-f0-9]{10}$'));
const marker=JSON.parse(await readFile(path.join(directory,'fixture.json'),'utf8'));
assert.equal(marker.kind,'shadowbridge-owner-vault-isolated-v1');assert.match(marker.project,/^shadowbridge-vault-test-[a-f0-9]{10}$/);
const previous=JSON.parse(await readFile(path.join(directory,'results.json'),'utf8'));assert.equal(previous.result,'PASS');
const config=JSON.parse(await readFile(path.join(directory,'compose.json'),'utf8'));
const restoreConfig=path.join(directory,'restore-compose.json');
await writeFile(restoreConfig,JSON.stringify({services:{recovery:{...config.services.postgres,ports:[],profiles:['recovery']}}})+'\n',{mode:0o600,flag:'wx'});
const docker=(args,options={})=>execFileSync('docker',['--context','default',...args],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024,...options}).trim();
const compose=args=>docker(['compose','-p',marker.project,'-f',path.join(directory,'compose.json'),'-f',restoreConfig,...args]);
const sql=(service,query)=>docker(['exec','-i',compose(['ps','-q',service]),'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge'],{input:query});
const fingerprints=service=>{
 const tables=sql(service,"SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('owner_vault','sb') OR schemaname='auth' AND tablename IN ('users','identities','mfa_factors','sessions','refresh_tokens') ORDER BY 1").split('\n');
 return Object.fromEntries(tables.map(t=>{assert.match(t,/^(owner_vault|sb|auth)\.[a-z_]+$/);return [t,sql(service,`SELECT md5(coalesce(string_agg(value,',' ORDER BY value),'')) FROM (SELECT to_jsonb(t)::text AS value FROM ${t} t) r`)];}));
};
const report={kind:'real-owner-vault-restore',cases:[],mocksUsed:false,contaboDeployed:false,existingInstallationModified:false};
const phase=(name,fn)=>{fn();report.cases.push({name,result:'PASS'});console.log('PASS: '+name);};
try {
 compose(['up','-d','--wait','--wait-timeout','120','postgres','recovery']);
 assert.equal(sql('postgres',"SELECT count(*) FROM auth.users WHERE email !~ '@test[.]shadowbridge[.]invalid$'"),'0');
 const sourceBefore=fingerprints('postgres');
 const dump=path.join(directory,'vault-full.dump');
 // Disposable test-only direct function grants to the fictional worker are not
 // a production principal and must not become recovery ACL dependencies.
 const login='vault_fixture_'+marker.project.split('-').at(-1);
 sql('postgres',`REVOKE EXECUTE ON FUNCTION owner_vault.ingest(jsonb,uuid) FROM ${login};REVOKE USAGE ON SCHEMA owner_vault FROM ${login};`);
 const bytes=execFileSync('docker',['--context','default','exec',compose(['ps','-q','postgres']),'pg_dump','-U','postgres','-d','shadowbridge','-Fc'],{maxBuffer:32*1024*1024});
 await writeFile(dump,bytes,{mode:0o600,flag:'wx'});assert.equal((await stat(dump)).mode&0o777,0o600);
 const args=['--context','default','exec','-i',compose(['ps','-q','recovery']),'pg_restore','--list'];
 const catalog=await privateArchiveCatalog({args,environment:process.env,cwd:root,dumpFile:dump});assert.equal(archiveHasVault(catalog),true);
 phase('empty-target Vault recovery creates only the two reserved NOLOGIN roles',()=>{
  sql('recovery',restoredVaultRolesSql);
  assert.equal(sql('recovery',"SELECT count(*) FROM pg_roles WHERE rolname IN ('shadowbridge_vault_executor','shadowbridge_vault_ingest') AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper"),'2');
  assert.throws(()=>sql('recovery',restoredVaultRolesSql));
 });
 phase('full pg_dump restores function ownership, data, RLS and minimal ACLs into an isolated PostgreSQL',()=>{
  docker(['exec','-i',compose(['ps','-q','recovery']),'pg_restore','--clean','--if-exists','--exit-on-error','-U','postgres','-d','shadowbridge'],{input:bytes});
  assert.deepEqual(fingerprints('recovery'),sourceBefore);
  assert.equal(sql('recovery',"SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owner_vault' AND c.relkind='r'"),'t');
  assert.equal(sql('recovery',"SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='owner_vault.statistics(timestamptz)'::regprocedure"),'shadowbridge_vault_executor');
  assert.equal(sql('recovery',"SELECT has_table_privilege('shadowbridge_api','owner_vault.contacts','SELECT')"),'f');
  assert.equal(sql('recovery',"SELECT has_function_privilege('shadowbridge_vault_ingest','owner_vault.statistics(timestamptz)','EXECUTE')"),'f');
  assert.deepEqual(fingerprints('postgres'),sourceBefore);
  assert.throws(()=>sql('recovery',restoredVaultRolesSql));
 });
 report.result='PASS';
}catch(error){report.result='FAIL';report.errorType=error.name;await writeFile(path.join(directory,'restore-failure.json'),JSON.stringify({message:error.message,stack:error.stack})+'\n',{mode:0o600});console.error('FAIL: Vault restore; private diagnostics retained.');process.exitCode=1;}
finally {compose(['stop','postgres','recovery']);report.fixtureStopped=true;report.finishedAt=new Date().toISOString();await writeFile('/tmp/shadowbridge-owner-vault-restore-results.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});}
