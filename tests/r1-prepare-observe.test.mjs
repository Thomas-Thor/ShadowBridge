import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {safeFailure,prepareAttempt,checkpointEvidence,observeProduction,n8nReadProbe} from '../scripts/r1-prepare-observe.mjs';
const release='a'.repeat(40),fixture=async()=>{const root=await mkdtemp(path.join(tmpdir(),'sb-prepare-evidence-'));const folder=path.join(root,'.local','r1-owner-release-'+release);await mkdir(folder,{recursive:true,mode:0o700});return{root,folder};};
test('failures expose safe category/status only, never command, tokens, URL credentials or stderr',()=>{
 for(const [message,category]of [['permission denied','PERMISSION_DENIED'],['ENOSPC no space left','DISK_FULL'],['x509 certificate','TLS_CERTIFICATE_FAILURE'],['npm error','DEPENDENCY_BUILD_FAILURE'],['EAI_AGAIN','DNS_FAILURE'],['column does not exist','SQL_OBJECT_MISMATCH']]){
 const r=safeFailure({stderr:message+' FICTIONAL_SECRET https://u:p@host',message:'sensitive',status:17,code:'UNSAFE_SECRET'});assert.equal(r.category,category);assert.equal(r.exitStatus,17);assert.equal(r.code,null);assert.ok(!JSON.stringify(r).includes('SECRET'));}
});
test('each prepare attempt preserves legacy build log and records the exact failed step before state exists',async()=>{
 const{root,folder}=await fixture();await writeFile(path.join(folder,'build.log'),'FICTIONAL_SECRET npm error',{mode:0o600});
 const a=await prepareAttempt(folder),b=await prepareAttempt(folder);assert.notEqual(a.buildLog,b.buildLog);assert.equal((await lstat(a.file)).mode&511,384);
 await a.run('PREVIOUS_ACCEPTANCE',async()=>true);await assert.rejects(a.run('BUILD_RUNTIME',async()=>{throw Object.assign(Error('FICTIONAL_SECRET'),{code:'ENOSPC'});}));await a.close();await b.close();
 const r=await checkpointEvidence({root,release});assert.equal(r.checkpoint.exists,false);assert.equal(r.attempts.find(x=>x.outcome==='FAILED').step,'BUILD_RUNTIME');assert.equal(r.buildLogs[0].category,'DEPENDENCY_BUILD_FAILURE');assert.ok(!JSON.stringify(r).includes('FICTIONAL_SECRET'));assert.equal(await readFile(path.join(folder,'build.log'),'utf8'),'FICTIONAL_SECRET npm error');
});
test('evidence refuses symlinks and will not print arbitrary fields from a checkpoint or journal',async()=>{
 const{root,folder}=await fixture();await writeFile(path.join(folder,'state.json'),JSON.stringify({phase:'PRIVATE_TOKEN',password:'FICTIONAL_SECRET',release}),{mode:0o600});await symlink('/etc/passwd',path.join(folder,'build.log'));
 const r=await checkpointEvidence({root,release});assert.equal(r.checkpoint.phase,'UNRECOGNIZED');assert.equal(r.buildLogs.length,0);assert.ok(!JSON.stringify(r).includes('PRIVATE_TOKEN'));assert.ok(!JSON.stringify(r).includes('FICTIONAL_SECRET'));
});
test('read-only production fixture checks existing app, mail, DB and n8n without provider calls or exported secrets',async()=>{
 const{root}=await fixture(),commands=[];
 const app={Config:{Labels:{'com.docker.compose.project.working_dir':root,'com.docker.compose.project':'shadowbridge-contabo-fictional'},Env:['RELEASE_SHA='+'5'.repeat(40),'MAIL_DELIVERY_MODE=disabled','SESSION_ENCRYPTION_KEY=FICTIONAL_SECRET','OWNER_BOOK_MCP_CREATE_ENABLED=false']},State:{Running:true}};
 const execute=args=>{commands.push(args);if(args[0]==='ps')return(args.includes('label=com.docker.compose.service=app')?'1':args.includes('label=com.docker.compose.service=auth')?'2':'3').repeat(64);if(args[0]==='inspect')return JSON.stringify([args[1]==='1'.repeat(64)?app:{Config:{Env:['GOTRUE_DISABLE_SIGNUP=true','GOTRUE_SMTP_PASS=FICTIONAL_SECRET','GOTRUE_SITE_URL=https://shadow-bridge.eu','GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/confirm','GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/recover']}}]);if(args[1]==='3'.repeat(64))return JSON.stringify({migrationCount:19,recentOwnerMfaEvents:1});return JSON.stringify({healthStatus:200,workflowApiStatus:401,credentialsVerified:false,providerBalancesVerified:false,crmWriteReadVerified:false});};
 const r=await observeProduction({root,release,execute});assert.equal(r.database.migrationCount,19);assert.equal(r.n8n.workflowApiStatus,401);assert.equal(r.mail.smtpCredentialPresent,true);assert.equal(r.runtime.mailMode,'disabled');assert.ok(!JSON.stringify(r).includes('FICTIONAL_SECRET'));
 assert.ok(commands.every(a=>['ps','inspect','exec'].includes(a[0])||a[0]==='image'&&a[1]==='inspect'));const sql=commands.find(a=>a.includes('psql')).at(-1);assert.ok(sql.startsWith('BEGIN READ ONLY;'));assert.ok(!/INSERT|UPDATE|DELETE|ALTER|DROP/.test(sql));assert.ok(!/POST|PUT|DELETE|apollo|clay/.test(n8nReadProbe));
});
test('standalone observer refuses local machine before Docker or production access',()=>{
 let error;try{execFileSync(process.execPath,['scripts/r1-prepare-observe.mjs','--release='+release],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(e){error=e;}assert.equal(error.status,1);const r=JSON.parse(error.stderr);assert.equal(r.status,'READ_ONLY_DIAGNOSTIC_INCOMPLETE');assert.equal(r.changesMade,false);
});
