// Operator-only checkpoint. Uses existing encrypted backup/verification, never
// imports data, issues credentials, impersonates OWNER or changes MFA.
import {readFile,writeFile,mkdir,lstat,open,unlink,statfs} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {hostname} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {repositoryRoot} from './staging-prepare.mjs';import {checkProduction} from './production-config.mjs';
import {checkApplicationPlan,checkMergedApplication} from './international-r1.mjs';
import {publicCompose,verifyBackupArchive} from './production-ops.mjs';import {backupInstallation} from './staging-ops.mjs';import {assertNoOtherReleaseLock} from './r1-production-release.mjs';import {migrationSources,validateApplied} from './staging-migrate.mjs';
const must=(v,m)=>{if(!v)throw Error(m);};
export async function certifyReviewBackup(ops){
 const before=await ops.review();must(before.phase==='approved'&&before.snapshotCurrent===true,'Exact OWNER-approved current preview required.');
 const backup=await ops.backup(before);const proof=await ops.verify(backup);must(proof.archiveAuthenticated===true&&proof.catalogReadable===true,'Encrypted backup authentication/catalog failed.');
 const after=await ops.review();must(after.phase==='approved'&&after.snapshotCurrent===true&&after.candidateHash===before.candidateHash&&after.snapshotHash===before.snapshotHash&&after.approvedAt===before.approvedAt,'Review changed; no import receipt issued.');
 return ops.record(before,backup);
}
async function privateFile(file){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600,'Unsafe checkpoint file.');return JSON.parse(await readFile(file,'utf8'));}
export async function bookAppendBackup({reviewId,release}){
 must(/^[a-f0-9-]{36}$/.test(reviewId||'')&&/^[a-f0-9]{40}$/.test(release||''),'Explicit review UUID and approved release required.');
 must(process.geteuid?.()===0&&process.env.SUDO_USER==='shadowadmin'&&hostname()==='vmi3682957'&&repositoryRoot==='/opt/shadowbridge','Run only through existing shadowadmin sudo on Contabo.');
 const exec=(bin,args)=>{try{return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2,cwd:repositoryRoot}).trim();}catch{throw Error('Private operator check failed; output suppressed.');}};
 must(exec('git',['-c','safe.directory='+repositoryRoot,'rev-parse','HEAD'])===release&&!exec('git',['-c','safe.directory='+repositoryRoot,'status','--porcelain']),'Release checkout must be exact and clean.');
 const dir=path.join(repositoryRoot,'.local','r1-owner-release-'+release);await assertNoOtherReleaseLock(path.join(repositoryRoot,'.local'),dir);
 const lock=path.join(dir,'operation.lock'),handle=await open(lock,'wx',0o600);await handle.write(String(process.pid));await handle.close();
 try{
  const state=await privateFile(path.join(dir,'state.json'));must(state.release===release&&state.purpose==='book-create'&&state.phase==='DEPLOYED_AND_VERIFIED'&&state.ownerInteractiveAcceptance===true,'Accepted temporary-append release required; do not interrupt deployment.');
  const profile=await checkProduction({directory:state.sourceDirectory});const plan=await checkApplicationPlan({profile,directory:state.planDirectory});checkMergedApplication(profile,state.planDirectory,plan);must(plan.ownerBookMcpCreate===true&&plan.image===state.image,'Invalid active append plan.');
  const query=q=>publicCompose(profile,['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',q]);
  const image=JSON.parse(exec('docker',['--context','default','inspect',publicCompose(profile,['ps','-q','app'])]))[0];must(image.State.Running&&image.Image===state.image&&['RELEASE_SHA='+release,'OWNER_BOOK_MCP_CREATE_ENABLED=true'].every(v=>image.Config.Env.includes(v)),'Unexpected running application.');
  const sources=await migrationSources(),ledger=JSON.parse(query('SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));validateApplied(sources,ledger);must(ledger.length===20,'Complete reviewed 001–020 ledger required.');
  const folder=path.join(repositoryRoot,'.local','book-append-backups',reviewId);await mkdir(folder,{recursive:true,mode:0o700});must((await lstat(folder)).isDirectory()&&!(await lstat(folder)).isSymbolicLink(),'Unsafe backup checkpoint.');
  const checkpoint=path.join(folder,'state.json');let cached;try{cached=await privateFile(checkpoint);}catch(e){if(e.code!=='ENOENT')throw e;}
  const review=()=>{const r=JSON.parse(query("SELECT json_build_object('phase',r.phase,'candidateHash',r.candidate_hash,'snapshotHash',r.snapshot_hash,'approvedAt',r.approved_at,'snapshotCurrent',owner_book.append_snapshot(r.owner_id)=r.snapshot_hash AND sb.book_owner_active(r.owner_id) AND g.revoked_at IS NULL AND w.create_revoked_at IS NULL AND w.create_until>now()) FROM owner_book.append_reviews r JOIN owner_book.oauth_grants g ON g.id=r.grant_id JOIN owner_book.oauth_create_grants w ON w.grant_id=g.id WHERE r.id='"+reviewId+"'"));must(r,'Review not found.');return r;};
  const outcome=await certifyReviewBackup({review,backup:async r=>{
   if(cached){must(cached.release===release&&cached.reviewId===reviewId&&cached.candidateHash===r.candidateHash&&cached.snapshotHash===r.snapshotHash&&cached.approvedAt===r.approvedAt,'Different saved backup generation.');return cached.backup;}
   const bytes=Number(query('SELECT pg_database_size(current_database())')),free=await statfs(profile.sourceDirectory);must(free.bavail*free.bsize>4*bytes+1024**3,'Insufficient backup/verification reserve.');
   const backup=await backupInstallation(profile.sourceDirectory);const record={release,reviewId,...r,backup};await writeFile(checkpoint,JSON.stringify(record)+'\n',{mode:0o600,flag:'wx'});return backup;
  },verify:backup=>verifyBackupArchive({directory:profile.sourceDirectory,...backup}),record:async(r,backup)=>{
   const hasher=createHash('sha256');for await(const chunk of createReadStream(backup.backupFile))hasher.update(chunk);const digest=hasher.digest('hex');
   const receipt=query("INSERT INTO owner_book.append_backup_receipts(review_id,candidate_hash,snapshot_hash,archive_sha256) SELECT id,candidate_hash,snapshot_hash,'"+digest+"' FROM owner_book.append_reviews WHERE id='"+reviewId+"' AND phase='approved' AND candidate_hash='"+r.candidateHash+"' AND snapshot_hash='"+r.snapshotHash+"' AND owner_book.append_snapshot(owner_id)=snapshot_hash ON CONFLICT(review_id) DO UPDATE SET archive_sha256=excluded.archive_sha256,verified_at=now() WHERE owner_book.append_backup_receipts.candidate_hash=excluded.candidate_hash AND owner_book.append_backup_receipts.snapshot_hash=excluded.snapshot_hash RETURNING review_id");must(receipt===reviewId,'No matching receipt issued.');
   return {status:'BACKUP_VERIFIED_IMPORT_NOT_APPLIED',release,reviewId,archiveAuthenticated:true,readBackStillRequired:true};
  }});console.log(JSON.stringify(outcome));return outcome;
 }finally{await unlink(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2||!args[0].startsWith('--review=')||!args[1].startsWith('--release='))throw Error('Use --review=APPROVED_UUID --release=FULL_SHA');
 bookAppendBackup({reviewId:args[0].slice(9),release:args[1].slice(10)}).catch(()=>{console.error('BLOCKED: checkpoint retained; import was not performed.');process.exitCode=1;});
}
