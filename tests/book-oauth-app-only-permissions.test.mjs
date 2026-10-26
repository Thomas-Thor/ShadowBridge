import test from 'node:test';import assert from 'node:assert/strict';
import {mkdir,writeFile,lstat,chmod,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {prepareStaging,repositoryRoot} from '../scripts/staging-prepare.mjs';
import {privatePath,expectedSourceMode} from '../scripts/book-oauth-app-only.mjs';
import {metadata,collectFileEvidence,checkpointSummary,appRuntimeSummary,acceptedBase,targetRelease,expectedOperator} from '../scripts/book-oauth-app-only-diagnose.mjs';

const sentinel='FICTIONAL_DO_NOT_DISPLAY_'+randomUUID();let fixture;
async function setup(){
 if(fixture)return fixture;
 const root=path.join(repositoryRoot,'.local','permissions-diagnostic-'+randomUUID());await mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
 const source=path.join(root,'.local','source');await prepareStaging({directory:source,project:'shadowbridge-stageg-permdiag-'+randomUUID().slice(0,8)});
 const folder=path.join(root,'.local','r1-owner-release-'+targetRelease),baseFolder=path.join(root,'.local','r1-owner-release-'+acceptedBase);await mkdir(folder,{mode:0o700});await mkdir(baseFolder,{mode:0o700});
 await writeFile(path.join(baseFolder,'state.json'),JSON.stringify({release:acceptedBase,sourceDirectory:source,phase:'DEPLOYED_AND_VERIFIED',purpose:'book-write',ownerInteractiveAcceptance:true,privateFixture:sentinel}),{mode:0o600});
 const stateFile=path.join(folder,'state.json');await writeFile(stateFile,JSON.stringify({phase:'PLANNED',release:targetRelease,installerRelease:expectedOperator,previousRelease:acceptedBase,schemaChanged:false,privateFixture:sentinel}),{mode:0o600});
 await writeFile(path.join(folder,'application.json'),JSON.stringify({services:{app:{image:'sha256:'+'a'.repeat(64)}}}),{mode:0o600});
 await writeFile(path.join(folder,'runtime-build.log'),sentinel,{mode:0o600});
 fixture={root,source,folder,stateFile,ca:path.join(source,'certs','internal-ca.crt'),key:path.join(source,'certs','internal-ca.key')};return fixture;
}
test('real existing profile generator requires public CA 0644; original installer check is reproduced and exact-path correction succeeds',async()=>{
 const f=await setup();assert.equal((await lstat(f.ca)).mode&0o777,0o644);
 await assert.rejects(privatePath(f.ca),e=>e.fileMetadata?.expectedMode==='0600'&&e.fileMetadata.actualMode==='0644');
 assert.equal(expectedSourceMode(f.ca,f.source),0o644);await privatePath(f.ca,false,expectedSourceMode(f.ca,f.source));
});
test('all other certs/private keys and configuration retain 0600, scripts 0700; unsafe types/modes and symlinks remain denied',async()=>{
 const f=await setup();assert.equal(expectedSourceMode(f.key,f.source),0o600);assert.equal(expectedSourceMode(path.join(f.source,'certs','postgres.crt'),f.source),0o600);assert.equal(expectedSourceMode(path.join(f.source,'other','internal-ca.crt'),f.source),0o600);assert.equal(expectedSourceMode(path.join(f.folder,'rollback.sh'),f.source),0o700);
 try{await chmod(f.key,0o644);await assert.rejects(privatePath(f.key,false,expectedSourceMode(f.key,f.source)));}finally{await chmod(f.key,0o600);}
 try{await chmod(f.ca,0o666);await assert.rejects(privatePath(f.ca,false,expectedSourceMode(f.ca,f.source)));}finally{await chmod(f.ca,0o644);}
 await assert.rejects(privatePath(f.folder,false));
 const link=path.join(f.folder,'linked.key');await symlink(f.key,link);await assert.rejects(privatePath(link),/symlink/);
 const observed=await metadata(f.root,link);assert.equal(observed.actualType,'symlink');assert.equal(observed.readRefused,true);
});
test('diagnostic identifies concrete CA path/mode conflict and partial PLANNED artifacts without displaying private values or logs',async()=>{
 const f=await setup(),r=await collectFileEvidence(f.root);
 assert.equal(r.firstObservedMismatch.path,f.ca);assert.equal(r.publicCaExpectationConflict,true);assert.equal(r.checkpoint.phase,'PLANNED');assert.equal(r.checkpoint.image,null);assert.equal(r.checkpoint.configHashCount,0);assert.equal(r.checkpoint.backupPairCount,0);assert.equal(r.overlayImage,'sha256:'+'a'.repeat(64));
 const ca=r.checks.find(c=>c.path===f.ca);assert.equal(ca.installerExpectedMode,'0600');assert.equal(ca.establishedExpectedMode,'0644');assert.equal(ca.actualType,'file');assert.equal(ca.uid,process.getuid());assert.equal(ca.gid,process.getgid());assert.equal(ca.establishedPolicyMatches,true);
 assert.ok(r.artifacts.some(a=>a.path.endsWith('runtime-build.log')&&a.exists));assert.ok(!JSON.stringify(r).includes(sentinel));assert.equal(r.privateFileContentsDisplayed,false);
});
test('a real checkpoint permission mismatch is reported before the CA bug; no guessed chmod or owner repair',async()=>{
 const f=await setup();try{await chmod(f.stateFile,0o644);const r=await collectFileEvidence(f.root);assert.equal(r.firstObservedMismatch.path,f.stateFile);assert.equal(r.firstObservedMismatch.establishedPolicyMatches,false);assert.equal((await lstat(f.stateFile)).mode&0o777,0o644);}finally{await chmod(f.stateFile,0o600);}
});
test('missing/symlinked checkpoints and unexpected content cannot leak private state through summary or traversal',async()=>{
 const f=await setup(),summary=checkpointSummary({phase:sentinel,release:sentinel,image:sentinel,token:sentinel,backups:{database:{key:sentinel}}});assert.ok(!JSON.stringify(summary).includes(sentinel));assert.equal(summary.phase,'UNKNOWN');
 const missing=await metadata(f.root,path.join(f.folder,'not-created.json'));assert.equal(missing.exists,false);
 const bad=await metadata(f.root,path.join(f.root,'..','outside'));assert.equal(bad.readRefused,true);
});
test('metadata collection changes neither checkpoint bytes, mode, uid/gid nor mtime',async()=>{
 const f=await setup(),before=await lstat(f.stateFile),bytes=await readFile(f.stateFile);await collectFileEvidence(f.root);const after=await lstat(f.stateFile);assert.deepEqual(await readFile(f.stateFile),bytes);assert.equal(before.mode,after.mode);assert.equal(before.uid,after.uid);assert.equal(before.gid,after.gid);assert.equal(before.mtimeMs,after.mtimeMs);
});
test('runtime reporting emits only release/image/state, never container environment credentials',()=>{
 const c={Id:'a'.repeat(64),Image:'sha256:'+'b'.repeat(64),Config:{Env:['RELEASE_SHA='+acceptedBase,'PASSWORD='+sentinel,'ACCESS_TOKEN='+sentinel],Other:sentinel},State:{Running:true,StartedAt:'2026-10-26T00:00:00.000000000Z'}};
 const r=appRuntimeSummary(c);assert.equal(r.release,acceptedBase);assert.equal(r.running,true);assert.ok(!JSON.stringify(r).includes(sentinel));
});
