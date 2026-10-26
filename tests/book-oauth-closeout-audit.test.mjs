import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm,mkdir,symlink} from 'node:fs/promises';
import {classifyImage,classifyRoot,classifyContainer,guardCandidates,summarizeContainer,checkpointSummary,lockEvidence,fileInfo,safeWorktree} from '../scripts/book-oauth-closeout-audit.mjs';
const image='sha256:'+'1'.repeat(64),other='sha256:'+'2'.repeat(64),root='/opt/shadowbridge/.local/r1-owner-release-'+'a'.repeat(40);

test('running and accepted rollback images are kept; unknown images are never pruned',()=>{
 for(const options of [{containers:[{id:'runtime',image,running:true}]},{keepImages:new Set([image])},{}]){
  assert.equal(classifyImage({Id:image,Size:100,SharedSize:80},options).decision,'KEEP');
 }
});
test('unused attempt image is only an archive candidate; shared bytes are not promised as reclaimed',()=>{
 const r=classifyImage({Id:image,Size:100,SharedSize:80},{attemptImages:new Set([image]),containers:[{id:'old-reader',image,running:false}]});
 assert.equal(r.decision,'ARCHIVE');assert.equal(r.estimatedUniqueBytes,20);assert.equal(r.guaranteedReclaimBytes,null);
 assert.deepEqual(r.containerReferences,['old-reader']);assert.equal(r.actionNow,'NONE');assert.equal(r.requiresSeparateOwnerApproval,true);
});
test('accepted runtime referencing the failed rollback overlay prevents moving its directory',()=>{
 const c=summarizeContainer({Id:'accepted',Image:other,State:{Running:true},Config:{Labels:{'com.docker.compose.project.config_files':root+'/rollback.json'}}});
 assert.equal(classifyRoot(root,{attemptRoot:true,liveReferences:c.configFiles,lock:{exists:false}}).decision,'KEEP');
 assert.equal(classifyRoot(root,{attemptRoot:true,liveReferences:[root+'/recovery/bind'],lock:{exists:false}}).decision,'KEEP');
});
test('any existing or unreadable lock and all unfinished swaps prevent archival',()=>{
 for(const lock of [{exists:true,status:'NO_PROCESS_STALE_CANDIDATE'},{exists:null}])assert.equal(classifyRoot(root,{attemptRoot:true,lock}).decision,'KEEP');
 for(const phase of ['SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','MIGRATING','APP_STARTING'])assert.equal(classifyRoot(root,{attemptRoot:true,phase,lock:{exists:false}}).decision,'KEEP');
});
test('abandoned directory is only a proposal; siblings with similar names are not live references',()=>{
 const r=classifyRoot(root,{attemptRoot:true,phase:'PLANNED',lock:{exists:false},liveReferences:[root+'-other/file'],bytes:4096});
 assert.equal(r.decision,'ARCHIVE');assert.equal(r.bytes,4096);assert.equal(r.actionNow,'NONE');
 assert.equal(classifyRoot(root,{attemptRoot:false,lock:{exists:false}}).decision,'KEEP');
});
test('only proven never-started technical readers without mounts qualify for deletion',()=>{
 const c={id:'fixture',image,status:'created',technicalImageReader:true,running:false,mountCount:0};
 assert.equal(classifyContainer(c).decision,'DELETE');
 for(const patch of [{running:true},{mountCount:1},{status:'exited'},{technicalImageReader:false}])assert.equal(classifyContainer({...c,...patch}).decision,'KEEP');
});
test('incomplete dependencies turn every archive/delete proposal into KEEP',()=>{
 const source=[{decision:'DELETE',id:'reader'},{decision:'ARCHIVE',id:'attempt'},{decision:'KEEP',id:'db'}];
 assert.ok(guardCandidates(source,false).every(r=>r.decision==='KEEP'));
 assert.equal(source[0].decision,'DELETE');assert.deepEqual(guardCandidates(source,true),source);
});
test('Docker inspection output excludes environment, process args, health logs and unrelated path labels',()=>{
 const secret='PRIVATE_FIXTURE_DO_NOT_OUTPUT';
 const r=summarizeContainer({Id:'fixture',Image:image,Name:'/fixture',State:{Running:true,Health:{Status:'healthy',Log:[{Output:secret}]}},Config:{Env:['KEY='+secret],Cmd:[secret],Labels:{'unrelated':secret,'com.docker.compose.project.config_files':root+'/application.json,/private/'+secret}},Mounts:[{Type:'bind',Source:root+'/bind'},{Type:'bind',Source:'/private/'+secret}]});
 assert.ok(!JSON.stringify(r).includes(secret));assert.equal(r.health,'healthy');assert.equal(r.mountCount,2);
});
test('checkpoint summary never emits tokens, backup keys, receipts or arbitrary data',()=>{
 const secret='PRIVATE_FIXTURE_DO_NOT_OUTPUT';
 const r=checkpointSummary({phase:'PLANNED',release:'a'.repeat(40),secrets:secret,bundle:secret,backups:{database:{key:secret}},backupStages:{database:{phase:'VERIFIED',key:secret},unknown:secret},token:secret});
 assert.equal(r.phase,'PLANNED');assert.equal(r.backupPairs,1);assert.ok(!JSON.stringify(r).includes(secret));assert.equal(checkpointSummary({phase:secret}).phase,'UNKNOWN');
});
test('lock read reports absent/reused/unverified process without changing bytes or permissions',async()=>{
 const folder=await mkdtemp('/tmp/sb-closeout-test-');
 try{
  const p=folder+'/operation.lock',proc=folder+'/proc';await mkdir(proc);
  assert.equal((await lockEvidence(p,{proc})).status,'ABSENT');
  await writeFile(p,'12345\n',{mode:0o600});const before=await stat(p);
  const r=await lockEvidence(p,{proc});assert.equal(r.status,'NO_PROCESS_STALE_CANDIDATE');assert.equal(r.removalAuthorized,false);
  assert.equal(await readFile(p,'utf8'),'12345\n');const after=await stat(p);assert.equal(after.mode,before.mode);assert.equal(after.mtimeMs,before.mtimeMs);
  await writeFile(p,'secret-not-a-pid');assert.equal((await lockEvidence(p,{proc})).status,'INVALID_CONTENT_NOT_DISPLAYED');
  assert.ok(!JSON.stringify(await lockEvidence(p,{proc})).includes('secret-not-a-pid'));
  await symlink(p,folder+'/alias');assert.equal((await lockEvidence(folder+'/alias',{proc})).type,'symlink');
  assert.equal((await fileInfo(folder+'/absent')).exists,false);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('repository status reports counts, never private filenames',()=>{
 assert.deepEqual(safeWorktree(''),{trackedClean:true,untrackedCount:0,changedTrackedCount:0});
 assert.deepEqual(safeWorktree(' M private-file\n?? private-backup'),{trackedClean:false,untrackedCount:1,changedTrackedCount:1});
 assert.deepEqual(safeWorktree(null),{status:'UNAVAILABLE'});
});

test('PID reuse is uncertain, never permission to remove an existing lock',async()=>{
 const folder=await mkdtemp('/tmp/sb-closeout-pid-test-');
 try{
  const proc=folder+'/proc',p=folder+'/operation.lock';await mkdir(proc+'/12345',{recursive:true});
  await writeFile(p,'12345\n',{mode:0o600});await writeFile(proc+'/uptime','0 0');
  await writeFile(proc+'/12345/stat','12345 (private-process-label) '+['S',...Array(18).fill('0'),'1000000000'].join(' '));
  const r=await lockEvidence(p,{proc});assert.equal(r.status,'PID_REUSED_OR_UNCERTAIN');assert.equal(r.processKind,'OTHER');assert.equal(r.removalAuthorized,false);
  assert.ok(!JSON.stringify(r).includes('private-process-label'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
