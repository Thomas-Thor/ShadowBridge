import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,rm,open} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {validateReceipt,controlledApply,runRelease,verifiedTar,releaseAncestors,runOperatorCommand} from '../scripts/r1-production-release.mjs';
import {bootstrap,digestFile} from '../scripts/r1-owner-deploy.mjs';
import {encryptArchive} from '../scripts/staging-backup.mjs';
const release='a'.repeat(40),names=['database','configuration','certificates'].flatMap(n=>[n+'.sbb',n+'.key']);
const manifest=()=>({kind:'shadowbridge-r1-offsite-bundle-v1',release,nonce:'fictional-one-release',files:names.map(name=>({name,bytes:100,sha256:'b'.repeat(64)}))});
const receipt=m=>({...m,kind:'shadowbridge-r1-offsite-receipt-v1',verifiedOnDifferentHost:true});
test('a successful build with output redirected to a private log does not become a false failure',async()=>{
 const dir=new URL('../.local/r1-build-log-'+randomBytes(5).toString('hex')+'/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});const file=new URL('build.log',dir),fd=await open(file,'wx',0o600);
 try{assert.equal(runOperatorCommand(process.execPath,['-e',"process.stdout.write('FICTIONAL build completed')"],{stdio:['ignore',fd.fd,fd.fd]}),'');await fd.close();assert.equal(await readFile(file,'utf8'),'FICTIONAL build completed');}
 finally{await fd.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
test('failed operator command retains diagnostic category and exit status without exposing stderr or arguments',()=>{
 assert.throws(()=>runOperatorCommand(process.execPath,['-e',"process.stderr.write('FICTIONAL_SECRET EACCES permission denied');process.exit(9)"]),e=>e.status===9&&e.category==='PERMISSION_DENIED'&&!e.message.includes('FICTIONAL_SECRET')&&!String(e.stack).includes('process.stderr'));
});
test('all six offsite artifacts must match this exact release and backup generation',()=>{
 const m=manifest();assert.doesNotThrow(()=>validateReceipt(m,receipt(m)));
 for(const mutate of [r=>r.release='c'.repeat(40),r=>r.nonce='old-backup',r=>r.verifiedOnDifferentHost=false,r=>r.files.pop(),r=>r.files[0].sha256='d'.repeat(64),r=>r.files[1].bytes=1]){const r=receipt(structuredClone(m));mutate(r);assert.throws(()=>validateReceipt(m,r));}
});
test('no migration occurs before configuration, authenticated backup, offsite receipt and stable snapshot checks',async()=>{
 for(const failed of ['check','verifyBackups','verifyOffsite','preservedBefore']){const calls=[];const ops=Object.fromEntries(['check','verifyBackups','verifyOffsite','preservedBefore','migrate','preservedAfter','start','verify','rollback'].map(n=>[n,async()=>{calls.push(n);if(n===failed)throw Error('FICTIONAL');}]));await assert.rejects(controlledApply(ops));assert.ok(!calls.includes('migrate'));assert.ok(!calls.includes('start'));assert.ok(!calls.includes('rollback'));}
});
test('a migration, preservation, application-start or verification error invokes application-only rollback',async()=>{
 for(const failed of ['migrate','preservedAfter','start','verify']){const calls=[];const ops=Object.fromEntries(['check','verifyBackups','verifyOffsite','preservedBefore','migrate','preservedAfter','start','verify','rollback'].map(n=>[n,async()=>{calls.push(n);if(n===failed)throw Error('FICTIONAL');}]));await assert.rejects(controlledApply(ops));assert.equal(calls.at(-1),'rollback');if(failed==='migrate'||failed==='preservedAfter')assert.ok(!calls.includes('start'));}
});
test('successful sequence has no deployment before backup verification and no database-restore operation',async()=>{
 const calls=[],order=['check','verifyBackups','verifyOffsite','preservedBefore','migrate','preservedAfter','start','verify'];await controlledApply(Object.fromEntries([...order,'rollback'].map(n=>[n,async()=>calls.push(n)])));assert.deepEqual(calls,order);
});
test('server coordinator rejects Codex or an ordinary local computer before Docker, writes or SQL',async()=>{
 await assert.rejects(runRelease({phase:'prepare',release}),/wyłącznie przez sudo/);
});
test('bootstrap is shell-valid, SHA pinned, guarded, and never resets main or trusts an unknown SSH key',async()=>{
 const s=bootstrap(release);execFileSync('sh',['-n'],{input:s});assert.ok(s.includes("git -c safe.directory=/opt/shadowbridge rev-parse HEAD)\" = '"+release+"'"));assert.ok(s.includes('merge --ff-only'));assert.ok(s.includes('status --porcelain'));assert.ok(!/reset|force|prune|down -v|main\n/.test(s));assert.throws(()=>bootstrap('main; arbitrary'));
 assert.equal(releaseAncestors.at(-1),'46414fb7c02939ead7622f9a3bb0a5ed9bc16ef2');
});
test('real GCM configuration/certificate verification rejects bad contents and never changes source files',async()=>{
 const id=randomBytes(5).toString('hex'),dir=new URL('../.local/r1-release-crypto-'+id+'/',import.meta.url),file=new URL('payload',dir),archive=new URL('source.tar',dir);
 await mkdir(dir,{recursive:true,mode:0o700});
 try{
  const content='FICTIONAL public configuration',sha=createHash('sha256').update(content).digest('hex');await writeFile(file,content,{mode:0o600});execFileSync('tar',['--format=ustar','-cf',archive.pathname,'-C',dir.pathname,'payload']);
  const pair={backupFile:new URL('copy.sbb',dir).pathname,keyFile:new URL('copy.key',dir).pathname};await encryptArchive({archiveFile:archive.pathname,...pair});
  assert.equal((await verifiedTar(pair,{files:{payload:sha}})).authenticated,true);await assert.rejects(verifiedTar(pair,{files:{payload:'0'.repeat(64)}}));
  assert.equal(await readFile(file,'utf8'),content);assert.equal(await digestFile(file.pathname),sha);
  const edge={kind:'shadowbridge-r1-edge-backup-v1',project:'FICTIONAL',release,hashes:{payload:sha}};await writeFile(new URL('edge.json',dir),JSON.stringify(edge),{mode:0o600});execFileSync('tar',['--format=ustar','-cf',archive.pathname,'-C',dir.pathname,'payload','edge.json']);
  const e={backupFile:new URL('edge.sbb',dir).pathname,keyFile:pair.keyFile};await encryptArchive({archiveFile:archive.pathname,...e});assert.equal((await verifiedTar(e,{edge:true,profile:{project:'FICTIONAL'},plan:{releaseSha:release}})).filesVerified,1);
  await assert.rejects(verifiedTar(e,{edge:true,profile:{project:'OTHER'},plan:{releaseSha:release}}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
