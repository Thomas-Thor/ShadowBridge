// Generated standalone OWNER launcher. Edit source modules, then rebuild.
import{open,readFile,lstat,unlink,writeFile,rename}from'node:fs/promises';import{createHash,randomUUID,createDecipheriv}from'node:crypto';import{createReadStream}from'node:fs';import{Writable}from'node:stream';import{pipeline}from'node:stream/promises';
const smtpRuntime='80f4a0d333d31a6d57ada714b0df17bc0584a07b';
const must=(v,code)=>{if(!v)throw Error(code);};export const hash=b=>createHash('sha256').update(b).digest('hex');
const safeFailure=e=>/^[A-Z][A-Z0-9_]{3,120}$/.test(e?.message||'')?e.message:'PRIVATE_OPERATOR_FAILURE_RETAIN_CHECKPOINT';
async function privateRead(file){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600,'PRIVATE_FILE_REQUIRED');return readFile(file);}
async function atomicState(file,state){const p=file+'.'+randomUUID();await writeFile(p,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(p,file);}
async function operatorLock(directory,fn){const file=directory+'/operation.lock',nonce=randomUUID();let handle;try{handle=await open(file,'wx',0o600);}catch{throw Error('SMTP_OPERATION_LOCK_PRESENT_NO_REMOVAL');}await handle.write(JSON.stringify({pid:process.pid,nonce}));await handle.close();try{return await fn();}finally{const current=JSON.parse((await privateRead(file)).toString());must(current.nonce===nonce&&current.pid===process.pid,'SMTP_LOCK_CHANGED_PRESERVE');await unlink(file);}}
function publicSignupDecision(){return{decision:'NO_GO',publicSignup:false,blockers:['PERSISTENT_ABUSE_AND_BOT_CONTROLS_NOT_PROVEN_ON_80F4A0D','PUBLIC_RESEND_UX_AND_MONITORING_NOT_ACCEPTED','GOOGLE_LIMITS_AND_REAL_DELIVERABILITY_NOT_PROVEN'],requiresSeparateInteractiveOwnerGo:true};}
function verifyTransferManifest(m,release){must(m?.kind==='shadowbridge-smtp-offsite-v1'&&m.operatorRelease===release&&m.runtime===smtpRuntime&&/^[a-f0-9]{64}$/.test(m.serverHostHash||'')&&/^[a-f0-9-]{36}$/.test(m.nonce||''),'OFFSITE_IDENTITY_MISMATCH');const names=['database.sbb','configuration.sbb','certificates.sbb','database.key','configuration.key','certificates.key'];must(Array.isArray(m.files)&&m.files.length===6&&new Set(m.files.map(f=>f.name)).size===6&&m.files.every(f=>names.includes(f.name)&&/^[a-f0-9]{64}$/.test(f.sha256||'')&&Number.isSafeInteger(f.bytes)&&f.bytes>0),'OFFSITE_MANIFEST_INVALID');return true;}
function verifyOffsiteReceipt(m,r,release){verifyTransferManifest(m,release);must(r?.kind==='shadowbridge-smtp-offsite-receipt-v1'&&r.operatorRelease===release&&r.nonce===m.nonce&&r.manifestHash===hash(JSON.stringify(m))&&r.differentHost===true&&r.authenticatedArchives===true&&/^[a-f0-9]{64}$/.test(r.verifierHostHash||'')&&r.verifierHostHash!==m.serverHostHash,'REAL_OFFSITE_PROOF_REQUIRED');must(Array.isArray(r.files)&&r.files.length===6&&m.files.every(f=>r.files.some(v=>v.name===f.name&&v.sha256===f.sha256&&v.bytes===f.bytes)),'OFFSITE_BYTES_MISMATCH');return true;}
async function authenticateArchiveOnly(archive,keyFile){const s=await lstat(archive);must(s.isFile()&&!s.isSymbolicLink()&&s.size>40,'INVALID_ENCRYPTED_ARCHIVE');const keyText=(await privateRead(keyFile)).toString().trim();must(/^[a-f0-9]{64}$/.test(keyText),'INVALID_BACKUP_KEY');const key=Buffer.from(keyText,'hex'),f=await open(archive,'r'),magic=Buffer.from('SB-BACKUP-01\0'),header=Buffer.alloc(magic.length+12),tag=Buffer.alloc(16);try{await f.read(header,0,header.length,0);await f.read(tag,0,16,s.size-16);must(header.subarray(0,magic.length).equals(magic),'INVALID_ENCRYPTED_ARCHIVE');const d=createDecipheriv('aes-256-gcm',key,header.subarray(magic.length));d.setAAD(header);d.setAuthTag(tag);await pipeline(createReadStream(archive,{start:header.length,end:s.size-17}),d,new Writable({write(_b,_e,cb){cb();}}));return true;}finally{key.fill(0);await f.close();}}
async function transitionAllowlist(ops,s){
 must(s.phase==='OFFSITE_VERIFIED','OFFSITE_PHASE_REQUIRED');await ops.preflight();await ops.verifyBackups();await ops.verifyOffsite();await ops.freshMfa();await ops.interactiveGo();await ops.preflight();await ops.verifyBackups();await ops.verifyOffsite();s.phase='APPLYING_ALLOWLIST';await ops.save(s);
 try{await ops.apply();await ops.verifyAllowlist();}catch{try{await ops.rollback();await ops.verifyRollback();s.phase='ROLLED_BACK_CONFIG_ONLY';await ops.save(s);}catch{s.phase='ROLLBACK_UNVERIFIED';await ops.save(s);throw Error('SMTP_APPLY_AND_ROLLBACK_UNVERIFIED_STOP');}throw Error('SMTP_APPLY_FAILED_ROLLED_BACK');}
 s.phase='ALLOWLIST_ACTIVE_PENDING_DELIVERY';await ops.save(s);return s;
}

// Structured subprocess diagnostics. Never return command arguments or raw output
// in an error. Remote state is uncertain after transport loss: no automatic retry.
import{spawn}from'node:child_process';
const safeToken=(v,pattern)=>typeof v==='string'&&pattern.test(v)?v:undefined;
function externalFailure(result,{stage='unknown',command='external'}={}){
 let reason='EXTERNAL_COMMAND_FAILED';const stderr=result.stderr||'',stdout=result.stdout||'';
 if(result.errorCode==='ENOENT')reason='LOCAL_COMMAND_NOT_FOUND';
 else if(result.timedOut||result.errorCode==='ETIMEDOUT')reason='EXTERNAL_COMMAND_TIMEOUT_CHECK_CHECKPOINT';
 else if(/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr))reason='SSH_HOST_KEY_VERIFICATION_FAILED';
 else if(/Permission denied.*(?:publickey|password)|Authentication failed/i.test(stderr))reason='SSH_AUTHENTICATION_FAILED';
 else if(/Connection refused/i.test(stderr))reason='SSH_CONNECTION_REFUSED';
 else if(/Connection timed out|Operation timed out/i.test(stderr))reason='SSH_CONNECTION_TIMEOUT';
 else if(/Could not resolve hostname/i.test(stderr))reason='SSH_HOSTNAME_UNRESOLVED';
 else if(/incorrect password attempts|sudo:.*password is required|sudo:.*authentication failure/i.test(stderr+stdout))reason='SUDO_AUTHENTICATION_FAILED';
 const diagnostic={status:'BLOCKED',reason,stage:safeToken(stage,/^[a-zA-Z0-9_.-]{1,100}$/)||'unknown',command:['ssh','scp','node'].includes(command)?command:'external',exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,signal:safeToken(result.signal,/^[A-Z0-9]{1,20}$/)||null,checkpointRetained:true,automaticRetry:false,noSuccessClaimed:true};
 for(const line of (stdout+'\n'+stderr).split(/\r?\n/).reverse()){try{const d=JSON.parse(line);if(d.status==='BLOCKED'){const code=safeToken(d.reason,/^(?:SMTP_|GMAIL_|OPERATOR_|FRESH_|PRIVATE_|SOURCE_|ACTIVE_|ACCEPTED_|PINNED_|LIVE_|AUTH_|APP_|N8N_|INSUFFICIENT_|EXISTING_|MAIL_|OWNER_|PRODUCTION_|MIGRATION_|UNIQUE_|TLS_|HTTPS_|LOCAL_|AUTHORIZED_|RECOVERY_|UNRECORDED_|SEALED_|BASELINE_|CHECKPOINT_|INVALID_|TRANSFER_|BACKUP_)[A-Z0-9_]{1,110}$/);if(code){diagnostic.remoteCode=code;diagnostic.remoteStage=safeToken(d.stage,/^[a-zA-Z0-9_.-]{1,80}$/)||null;diagnostic.reason='REMOTE_OPERATOR_BLOCKED';break;}}}catch{}}
 return diagnostic;
}
function launcherFailure(error){if(error?.diagnostic)return error.diagnostic;return{status:'BLOCKED',reason:safeToken(error?.message,/^[A-Z_]{4,120}$/)||'OWNER_ACTION_INCOMPLETE_RETAIN_CHECKPOINT',stage:safeToken(error?.stage,/^[a-zA-Z0-9_.-]{1,100}$/)||'launcher',checkpointRetained:true,automaticRetry:false,noSuccessClaimed:true};}
async function executeExternal(bin,args,{capture=false,tee=false,stage='unknown',timeout=180000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(bin,args,{stdio:['inherit','pipe','pipe']});let stdout='',stderr='',errorCode,timedOut=false;
  const retain=(old,chunk)=>(old+chunk.toString('utf8')).slice(-1048576);
  child.stdout.on('data',b=>{stdout=retain(stdout,b);if(!capture||tee)process.stdout.write(b);});
  child.stderr.on('data',b=>{stderr=retain(stderr,b);if(!capture||tee)process.stderr.write(b);});
  child.on('error',e=>{errorCode=e.code;});const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeout);
  child.on('close',(exitCode,signal)=>{clearTimeout(timer);if(errorCode||timedOut||exitCode!==0){const e=Error('EXTERNAL_COMMAND_FAILED');e.diagnostic=externalFailure({stdout,stderr,exitCode,signal,errorCode,timedOut},{stage,command:bin});reject(e);}else resolve(capture?stdout.trim():'');});
 });
}

// Read-only authoritative checkpoint discovery for reviewed SMTP operators.
const reviewedSmtpOperators=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
async function inspectExistingSmtp({operatorRoot='/opt/shadowbridge-operators',liveRoot='/opt/shadowbridge',readCommand,validateProfile}={}){
 const fs=await import('node:fs/promises');const{execFileSync}=await import('node:child_process');const{pathToFileURL}=await import('node:url');
 const allowed=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
 const run=readCommand||((b,a)=>execFileSync(b,a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16777216}).trim());
 const meta=async file=>{try{const s=await fs.lstat(file);return{exists:true,type:s.isSymbolicLink()?'symlink':s.isFile()?'file':s.isDirectory()?'directory':'other',mode:(s.mode&511).toString(8),uid:s.uid,bytes:s.size};}catch(e){return{exists:e.code==='ENOENT'?false:null};}};
 const report={kind:'shadowbridge-existing-smtp-checkpoint',readOnly:true,changesMade:false,candidates:[],codeSent:false};
 const lockPath=liveRoot+'/.local/smtp-operator-lock/operation.lock';report.lock=await meta(lockPath);
 if(report.lock.type==='file'&&report.lock.mode==='600'){try{const p=JSON.parse(await fs.readFile(lockPath,'utf8'));if(Number.isInteger(p.pid)&&p.pid>1){report.lock.pid=p.pid;try{process.kill(p.pid,0);report.lock.processAlive=true;}catch(e){report.lock.processAlive=e.code==='ESRCH'?false:null;}}}catch{}}
 let names=[];try{names=await fs.readdir(operatorRoot);}catch{report.discoveryFailed=true;return report;}
 for(const name of names.filter(n=>/^smtp-[a-f0-9]{40}$/.test(n)).sort()){
  const release=name.slice(5),root=operatorRoot+'/'+name,pkg=root+'/.local/smtp-package-'+release,stateFile=pkg+'/operator-state.json';
  const stateInfo=await meta(stateFile),credential=await meta(pkg+'/smtp-credential.env'),manifest=await meta(pkg+'/manifest.json');if(!stateInfo.exists&&!credential.exists&&!manifest.exists)continue;
  const c={sourceRelease:release,checkpoint:stateInfo,credentialSaved:credential.exists===true,credentialFile:credential,phase:stateInfo.exists?'CHECKPOINT_UNREADABLE':'NO_CHECKPOINT',artifacts:{}};report.candidates.push(c);
  for(const f of ['database.sbb','database.key','configuration.sbb','configuration.key','certificates.sbb','certificates.key','database.private','configuration.private','certificates.private'])c.artifacts[f]=await meta(pkg+'/'+f);
  const rootInfo=await meta(root);c.reviewed=allowed.includes(release);c.checkoutMatches=false;c.sealedProfileValid=false;
  if(!c.reviewed||rootInfo.type!=='directory'||rootInfo.mode!=='700'||await fs.realpath(root)!==root)continue;
  try{c.checkoutMatches=run('git',['-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'])===release&&!run('git',['-c','safe.directory='+root,'-C',root,'status','--porcelain']);}catch{}
  if(!c.checkoutMatches)continue;
  const transfer='/home/shadowadmin/.shadowbridge-smtp-'+release;c.transferDirectory=await meta(transfer);c.publishedStatus=await meta(transfer+'/status.json');
  if(stateInfo.type==='file'&&stateInfo.mode==='600'){try{const s=JSON.parse(await fs.readFile(stateFile,'utf8'));if(s.operatorRelease===release&&s.dir===pkg&&s.publicRegistration===false){c.phase=/^[A-Z_]{1,80}$/.test(s.phase||'')?s.phase:'CHECKPOINT_PHASE_INVALID';for(const k of ['offsiteVerified','smtpAuthVerified','confirmationVerified','recoveryVerified','rollbackVerified','ownerInteractiveAcceptance'])c[k]=s[k]===true;c.recordedBackupKinds=Object.keys(s.backups||{}).filter(k=>['database','configuration','certificates'].includes(k));}else c.phase='CHECKPOINT_IDENTITY_INVALID';}catch{}}
  if(credential.type==='file'&&credential.mode==='600'){try{const inspect=validateProfile||((await import(pathToFileURL(root+'/scripts/smtp-test-package.mjs').href)).inspectSmtpPackage);await inspect(pkg,{sealed:true});c.sealedProfileValid=true;}catch{c.sealedProfileError='SAVED_PROFILE_VALIDATION_FAILED';}}
 }
 try{const ids=run('docker',['--context','default','ps','-q']).split('\n').filter(Boolean),containers=ids.length?JSON.parse(run('docker',['--context','default','inspect',...ids])):[];report.runtime=containers.filter(c=>c.Config.Labels?.['com.docker.compose.service']==='app').map(c=>{const e=Object.fromEntries((c.Config.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));return{release:/^[a-f0-9]{40}$/.test(e.RELEASE_SHA||'')?e.RELEASE_SHA:null,mailMode:['disabled','allowlist','smtp'].includes(e.MAIL_DELIVERY_MODE)?e.MAIL_DELIVERY_MODE:'UNKNOWN',healthy:c.State.Health?.Status==='healthy'};});}catch{report.runtimeUnverified=true;}
 return report;
}
function existingSmtpDiscoveryCode(){return `import{hostname}from'node:os';try{if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');const result=await (${inspectExistingSmtp.toString()})();console.log('SB_SMTP_CHECKPOINT_JSON_BEGIN');console.log(JSON.stringify(result));console.log('SB_SMTP_CHECKPOINT_JSON_END');}catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'CHECKPOINT_DISCOVERY_FAILED',stage:'checkpoint.discovery'}));process.exitCode=1;}`;}

function parseSmtpDiscovery(stdout){const a='SB_SMTP_CHECKPOINT_JSON_BEGIN',b='SB_SMTP_CHECKPOINT_JSON_END',i=stdout.lastIndexOf(a),j=stdout.indexOf(b,i);if(i<0||j<0)throw Error('CHECKPOINT_DISCOVERY_RESPONSE_INVALID');const r=JSON.parse(stdout.slice(i+a.length,j).trim());if(r.kind!=='shadowbridge-existing-smtp-checkpoint'||r.readOnly!==true||!Array.isArray(r.candidates))throw Error('CHECKPOINT_DISCOVERY_RESPONSE_INVALID');return r;}
function existingResumeSelection(report){
 const stop=(code,stage)=>{const e=Error(code);e.stage=stage;throw e;};if(report.discoveryFailed)stop('CHECKPOINT_DISCOVERY_FAILED','checkpoint.discovery');if(report.lock?.exists!==false)stop('SMTP_OPERATION_LOCK_PRESENT_NO_REMOVAL','checkpoint.lock');
 const active=report.candidates.filter(c=>c.phase!=='ROLLED_BACK_CONFIG_ONLY');if(active.length!==1)stop(active.length?'MULTIPLE_SAVED_SMTP_ATTEMPTS_REQUIRE_SELECTION':'NO_SAVED_SMTP_ATTEMPT_FOUND','checkpoint.selection');const c=active[0];
 if(!c.reviewed||!c.checkoutMatches)stop('SAVED_OPERATOR_IDENTITY_NOT_PROVEN','checkpoint.identity');if(!c.credentialSaved||!c.sealedProfileValid)stop('SAVED_SMTP_CREDENTIAL_OR_SEAL_NOT_PROVEN','checkpoint.credential');
 const allowed=['WAITING_REAL_OFFSITE','OFFSITE_VERIFIED','ALLOWLIST_ACTIVE_PENDING_DELIVERY','SIGNUP_MAIL_SENT','CONFIRMED','RECOVERY_MAIL_SENT','RECOVERY_VERIFIED_WAITING_HEADERS','ALLOWLIST_DELIVERY_VERIFIED'];
 if(['NO_CHECKPOINT','PREPARED','BACKUPS_IN_PROGRESS','BACKUPS_VERIFIED_WAITING_TRANSFER'].includes(c.phase))return{...c,resumeAction:'preparation'};if(!allowed.includes(c.phase))stop('CHECKPOINT_PHASE_REQUIRES_REPAIR_NO_AUTOMATIC_REPLAY','checkpoint.'+c.phase.toLowerCase());return{...c,resumeAction:'continue'};
}

// Resume only preparation; no services, messages, migrations or credential input.
async function resumePreparedFlow(ops,state){
 if(!['NO_CHECKPOINT','PREPARED','BACKUPS_IN_PROGRESS','BACKUPS_VERIFIED_WAITING_TRANSFER'].includes(state.phase))throw Error('PREPARATION_RESUME_PHASE_INVALID');
 await ops.preflight();const plan=await ops.planBackups();await ops.freshMfa();await ops.archiveOriginal();state.backups=state.backups||{};state.phase='BACKUPS_IN_PROGRESS';await ops.save(state);
 for(const name of ['database','configuration','certificates']){const pair=plan[name]?await ops.verifyBackup(name,plan[name]):await ops.createBackup(name);state.backups[name]=pair;await ops.save(state);}
 state.phase='BACKUPS_VERIFIED_WAITING_TRANSFER';await ops.save(state);await ops.transfer(state);state.phase='WAITING_REAL_OFFSITE';await ops.save(state);return state;
}
async function resumeSavedPreparation(sourceRelease,installerRelease,flow){
 const fs=await import('node:fs/promises');const{execFileSync}=await import('node:child_process');const{createHash,randomUUID}=await import('node:crypto');const{pathToFileURL}=await import('node:url');const{isDeepStrictEqual}=await import('node:util');const path=await import('node:path');
 const allowed=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
 if(!allowed.includes(sourceRelease)||!/^[a-f0-9]{40}$/.test(installerRelease))throw Error('SAVED_OPERATOR_IDENTITY_NOT_PROVEN');
 let stage='recovery.identity';const must=(v,c)=>{if(!v)throw Error(c);},hash=b=>createHash('sha256').update(b).digest('hex');
 const run=(bin,args,opts={})=>{try{const r=execFileSync(bin,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:33554432,...opts});return typeof r==='string'?r.trim():'';}catch(e){const text=String(e.stderr||'');const reason=/permission denied/i.test(text)?'PRIVATE_COMMAND_PERMISSION_DENIED':/file name too long|file name is too long/i.test(text)?'BACKUP_PATH_TOO_LONG':/no such file|not found/i.test(text)?'PRIVATE_COMMAND_SOURCE_NOT_FOUND':'RECOVERY_COMMAND_FAILED';const error=Error(reason);error.exitCode=Number.isInteger(e.status)?e.status:null;throw error;}};
 const docker=(a,o)=>run('docker',['--context','default',...a],o),root='/opt/shadowbridge-operators/smtp-'+sourceRelease,dir=root+'/.local/smtp-package-'+sourceRelease,file=dir+'/operator-state.json';
 const check=await fs.lstat(root);must(check.isDirectory()&&!check.isSymbolicLink()&&(check.mode&511)===448&&await fs.realpath(root)===root,'SAVED_OPERATOR_PATH_UNSAFE');
 must(run('git',['-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'])===sourceRelease&&!run('git',['-c','safe.directory='+root,'-C',root,'status','--porcelain']),'SAVED_OPERATOR_IDENTITY_NOT_PROVEN');
 const core=await import(pathToFileURL(root+'/scripts/smtp-operator-core.mjs').href),pkg=await import(pathToFileURL(root+'/scripts/smtp-test-package.mjs').href),old=await import(pathToFileURL(root+'/scripts/smtp-production-operator.mjs').href),encryption=await import(pathToFileURL(root+'/scripts/staging-backup.mjs').href);
 const meta=async p=>{try{const s=await fs.lstat(p);return{exists:true,type:s.isSymbolicLink()?'symlink':s.isFile()?'file':s.isDirectory()?'directory':'other',mode:s.mode&511};}catch(e){if(e.code==='ENOENT')return{exists:false};throw e;}};
 const privateBytes=core.privateRead;let original=null,state,r;
 if((await meta(file)).exists){original=await privateBytes(file);state=JSON.parse(original);must(state.kind==='smtp-production-operator-v1'&&state.operatorRelease===sourceRelease&&state.dir===dir&&state.baseFile===dir+'/baseline.compose.json'&&state.baselineRelease==='80f4a0d333d31a6d57ada714b0df17bc0584a07b'&&state.publicRegistration===false,'SMTP_CHECKPOINT_IDENTITY_MISMATCH');must(!state.backups||(typeof state.backups==='object'&&!Array.isArray(state.backups)&&Object.keys(state.backups).every(k=>['database','configuration','certificates'].includes(k))),'BACKUP_MANIFEST_UNREVIEWED');}
 else state={phase:'NO_CHECKPOINT'};
 let fence=original?hash(original):null;const progress=()=>console.log(JSON.stringify({status:'PROGRESS',stage,sourceRelease,credentialReused:true}));
 const query=q=>docker(['exec',r.pg.Id,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',"BEGIN READ ONLY;SET LOCAL statement_timeout='5s';"+q+';ROLLBACK;']);
 const protectedUsers=ids=>{const list=ids.map(id=>{must(/^[a-f0-9-]{36}$/.test(id),'INVALID_USER_ID');return"'"+id+"'::uuid";}).join(',')||'NULL';return hash(query("SELECT jsonb_build_object('users',(SELECT jsonb_agg(jsonb_build_object('id',id,'password',encrypted_password,'emailConfirmed',email_confirmed_at) ORDER BY id) FROM auth.users WHERE id IN("+list+")),'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM sb.accounts t WHERE user_id IN("+list+")),'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id,role_key) FROM sb.staff_role_assignments t WHERE user_id IN("+list+")),'mfa',(SELECT jsonb_agg(to_jsonb(t)-'last_challenged_at'-'updated_at' ORDER BY id) FROM auth.mfa_factors t WHERE user_id IN("+list+")))"));};
 const envelope=async pair=>{await core.authenticateArchiveOnly(pair.backupFile,pair.keyFile);};
 const tarVerify=async pair=>{const scratch=dir+'/.resume-verify-'+randomUUID()+'.tar';try{await encryption.decryptArchive({...pair,archiveFile:scratch});const h=await fs.open(scratch,'r');try{run('tar',['-tf','-'],{stdio:[h.fd,'ignore','pipe']});}finally{await h.close();}}finally{if((await meta(scratch)).exists)await fs.unlink(scratch);}};
 const transferDir='/home/shadowadmin/.shadowbridge-smtp-'+sourceRelease;
 const transfer=async s=>{
  stage='recovery.transfer';progress();await pkg.inspectSmtpPackage(dir,{sealed:true});const uid=Number(run('id',['-u','shadowadmin'])),gid=Number(run('id',['-g','shadowadmin']));
  if(!(await meta(transferDir)).exists){await fs.mkdir(transferDir,{mode:448});await fs.chown(transferDir,uid,gid);}const st=await fs.lstat(transferDir);must(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&511)===448&&st.uid===uid,'PRIVATE_TRANSFER_DIRECTORY_UNSAFE');
  const manifestFile=transferDir+'/manifest.json';let m;
  if((await meta(manifestFile)).exists){m=JSON.parse(await privateBytes(manifestFile));core.verifyTransferManifest(m,sourceRelease);}else m={kind:'shadowbridge-smtp-offsite-v1',operatorRelease:sourceRelease,runtime:'80f4a0d333d31a6d57ada714b0df17bc0584a07b',nonce:randomUUID(),serverHostHash:hash(await fs.readFile('/etc/machine-id')),files:[]};
  const entries=[];for(const pair of Object.values(s.backups))for(const src of [pair.backupFile,pair.keyFile]){const name=path.basename(src),dst=transferDir+'/'+name,bytes=await privateBytes(src),item={name,bytes:bytes.length,sha256:hash(bytes)};if((await meta(dst)).exists)must(hash(await privateBytes(dst))===item.sha256,'TRANSFER_FILE_MISMATCH_NO_OVERWRITE');else{await fs.copyFile(src,dst,1);await fs.chown(dst,uid,gid);}entries.push(item);}
  if((await meta(manifestFile)).exists)must(isDeepStrictEqual([...m.files].sort((a,b)=>a.name.localeCompare(b.name)),[...entries].sort((a,b)=>a.name.localeCompare(b.name))),'TRANSFER_MANIFEST_MISMATCH_NO_OVERWRITE');else{m.files=entries;core.verifyTransferManifest(m,sourceRelease);await fs.writeFile(manifestFile,JSON.stringify(m)+'\n',{mode:384,flag:'wx'});await fs.chown(manifestFile,uid,gid);}
  s.transfer=transferDir;s.transferManifest=m;
 };
 const ops={
  preflight:async()=>{stage='recovery.preflight';progress();const p=await pkg.inspectSmtpPackage(dir,{sealed:true});r=await old.collectProduction(original?{state}:{});if(!original)must(isDeepStrictEqual(p.baseline,r.base),'SEALED_BASELINE_DIFFERS_FROM_RUNTIME');for(const role of ['app','auth']){const c=r[role],env=Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));for(const[k,v]of Object.entries(p.baseline.services[role].environment))must(env[k]===String(v),'BASELINE_RUNTIME_ENVIRONMENT_CHANGED');}if(original)must(protectedUsers(state.userIds)===state.userFingerprint,'EXISTING_USERS_MFA_OR_ROLES_CHANGED');else{const ids=JSON.parse(query("SELECT coalesce(json_agg(id),'[]') FROM auth.users"));Object.assign(state,{kind:'smtp-production-operator-v1',operatorRelease:sourceRelease,baselineRelease:'80f4a0d333d31a6d57ada714b0df17bc0584a07b',dir,baseFile:dir+'/baseline.compose.json',publicRegistration:false,project:r.project,pg:r.pg.Id,appImage:r.app.Image,authImage:r.auth.Image,appName:r.app.Name.replace(/^\//,''),authName:r.auth.Name.replace(/^\//,''),liveHead:r.liveHead,sourceHashes:r.sourceHashes,protected:r.protected,userIds:ids,userFingerprint:protectedUsers(ids),ledgerHash:r.ledgerHash});}stage='recovery.compose-validation';progress();docker(['compose','--project-name',state.project,'-f',dir+'/candidate.compose.json','config','--quiet']);},
  planBackups:async()=>{stage='recovery.backup-plan';progress();const plan={};for(const name of ['database','configuration','certificates']){const pair=state.backups?.[name];if(pair){must(pair.backupFile===dir+'/'+name+'.sbb'&&pair.keyFile===dir+'/'+name+'.key','BACKUP_PATH_UNREVIEWED');plan[name]=pair;}else{for(const ext of ['.sbb','.key','.private'])must(!(await meta(dir+'/'+name+ext)).exists,'UNRECORDED_BACKUP_ARTIFACTS_RETAINED_NO_REPLAY');plan[name]=null;}}return plan;},
  freshMfa:async()=>{stage='recovery.owner-mfa';progress();const time=Date.now();await old.question('Potwierdź teraz dotychczasowe OWNER TOTP w panelu, potem Enter. Nie wpisuj kodu ani hasła Gmail tutaj: ');must(Number(query("SELECT count(*) FROM sb.audit_events e JOIN sb.staff_role_assignments r ON r.user_id=e.actor_id JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at>now()) AND e.action='auth.mfa_verified' AND e.created_at>to_timestamp("+Math.floor(time/1000)+") AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=r.user_id AND f.factor_type='totp' AND f.status='verified')"))>0,'FRESH_OWNER_MFA_NOT_CONFIRMED');},
  archiveOriginal:async()=>{stage='recovery.preserve-original-checkpoint';const archive=dir+'/state-before-resume-'+installerRelease+'-'+(fence?fence.slice(0,16):'absent')+'.json',bytes=original||Buffer.from(JSON.stringify({kind:'smtp-checkpoint-reconstruction',originalAbsent:true,operatorRelease:sourceRelease}));if((await meta(archive)).exists)must((await privateBytes(archive)).equals(bytes),'RECOVERY_HISTORY_ALREADY_EXISTS_NO_OVERWRITE');else await fs.writeFile(archive,bytes,{mode:384,flag:'wx'});},
  save:async s=>{stage='recovery.checkpoint';const current=await meta(file);if(fence===null)must(!current.exists,'CHECKPOINT_CHANGED_DURING_RECOVERY');else must(current.exists&&hash(await privateBytes(file))===fence,'CHECKPOINT_CHANGED_DURING_RECOVERY');await core.atomicState(file,s);fence=hash(await privateBytes(file));},
  verifyBackup:async(name,pair)=>{stage='recovery.backup.'+name+'.verify';progress();await envelope(pair);if(name==='database')await old.verifyDatabaseArchive(r.pg.Id,pair,docker);else await tarVerify(pair);return pair;},
  createBackup:async name=>{stage='recovery.backup.'+name+'.create';progress();let pair;if(name==='database'){pair=await old.makeEncrypted(dir+'/database',fd=>docker(['exec',r.pg.Id,'pg_dump','--no-password','-U','postgres','-d','shadowbridge','--format=custom'],{stdio:['ignore',fd,'pipe'],timeout:120000}));await old.verifyDatabaseArchive(r.pg.Id,pair,docker);}else if(name==='configuration'){const inputs=[...Object.keys(state.sourceHashes),...['manifest.json','baseline.compose.json','candidate.compose.json','smtp-credential.env','seal.json'].map(n=>dir+'/'+n)];for(const c of [r.pg,r.auth,r.app,r.gateway])for(const m of c.Mounts)if(m.Type==='bind'&&m.Source.startsWith('/opt/shadowbridge/')&&(await fs.lstat(m.Source)).isFile())inputs.push(m.Source);pair=await old.makeEncrypted(dir+'/configuration',fd=>run('tar',['--format=pax','-cf','-','-C','/',...new Set(inputs.map(p=>p.slice(1)))],{stdio:['ignore',fd,'pipe'],timeout:120000}));await tarVerify(pair);}else pair=await old.backupCertificates(r.gateway,dir+'/certificates',docker);return pair;},
  transfer
 };
 try{return await core.operatorLock('/opt/shadowbridge/.local/smtp-operator-lock',()=>flow(ops,state));}catch(e){e.stage=stage;throw e;}
}
function preparationResumeCode(sourceRelease,installerRelease){if(!/^[a-f0-9]{40}$/.test(sourceRelease)||!/^[a-f0-9]{40}$/.test(installerRelease))throw Error('RESUME_RELEASE_INVALID');return `import{hostname}from'node:os';try{if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');const s=await (${resumeSavedPreparation.toString()})(${JSON.stringify(sourceRelease)},${JSON.stringify(installerRelease)},${resumePreparedFlow.toString()});console.log(JSON.stringify({phase:s.phase,sourceRelease:s.operatorRelease,credentialReused:true,productionChanged:false}));}catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'SMTP_RECOVERY_FAILED_RETAIN_CHECKPOINT',stage:e.stage||'recovery.initialization',exitCode:e.exitCode??null,checkpointRetained:true,productionSuccessNotClaimed:true}));process.exitCode=1;}`;}

// Runs inside the existing n8n container. Returns type/count only, never data,
// names, tokens or connection values. No credential export/decryption or writes.
async function readN8nMailMetadata({env=process.env,loadPg}={}){
 let stage='configuration';const type=env.DB_TYPE||'sqlite';
 const failure=()=>({status:'METADATA_NOT_VERIFIED',databaseType:type==='postgresdb'?'postgresdb':type==='sqlite'?'sqlite':'unsupported',failureStage:stage,authorizationVerified:false});
 try{
  const fs=await import('node:fs');const path=await import('node:path');
  const secretFile=file=>{const s=fs.statSync(file);if(!s.isFile()||s.size>131072)throw Error();return fs.readFileSync(file,'utf8').trim();};
  const value=(name,fallback='')=>{if(env[name]&&env[name+'_FILE'])throw Error();return env[name+'_FILE']?secretFile(env[name+'_FILE']):env[name]??fallback;};
  const prefix=value('DB_TABLE_PREFIX'),schema=value('DB_POSTGRESDB_SCHEMA','public');
  if(!/^[a-zA-Z0-9_]{0,64}$/.test(prefix)||! /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))throw Error();
  const types=['gmailOAuth2','smtp','googleOAuth2Api'];let rows;
  if(type==='sqlite'){
   stage='sqlite_driver';const{DatabaseSync}=await import('node:sqlite');
   const database=path.resolve(value('N8N_USER_FOLDER','/home/node'),'.n8n',value('DB_SQLITE_DATABASE','database.sqlite'));
   stage='sqlite_metadata';const db=new DatabaseSync(database,{readOnly:true});
   try{rows=db.prepare('SELECT type,count(*) AS count FROM "'+prefix+'credentials_entity" WHERE type IN (?,?,?) GROUP BY type').all(...types);}finally{db.close();}
  }else if(type==='postgresdb'){
   stage='postgres_driver';let pg;
   if(loadPg)pg=await loadPg();else{
    const{createRequire}=await import('node:module');const roots=[process.cwd(),'/usr/local/lib/node_modules/n8n','/opt/n8n/node_modules/n8n'];
    try{roots.unshift(path.dirname(path.dirname(fs.realpathSync('/usr/local/bin/n8n'))));}catch{}
    for(const root of roots){try{pg=createRequire(path.join(root,'package.json'))('pg');break;}catch{}}
   }
   if(typeof pg?.Client!=='function')throw Error();stage='postgres_configuration';
   const host=value('DB_POSTGRESDB_HOST','localhost'),port=Number(value('DB_POSTGRESDB_PORT','5432'));
   if(!host||!Number.isInteger(port)||port<1||port>65535||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error();
   const ca=value('DB_POSTGRESDB_SSL_CA'),cert=value('DB_POSTGRESDB_SSL_CERT'),key=value('DB_POSTGRESDB_SSL_KEY'),enabled=value('DB_POSTGRESDB_SSL_ENABLED','false');
   if(!['true','false'].includes(enabled)||!['true','false'].includes(value('DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED','true')))throw Error();
   const sslEnabled=enabled==='true'||!!ca||!!cert||!!key;
   if(sslEnabled&&value('DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED','true')!=='true')throw Error();
   const pem=v=>v.includes('-----BEGIN ')?v:secretFile(v);
   const ssl=sslEnabled?{rejectUnauthorized:true,servername:host,...(ca?{ca:pem(ca)}:{}),...(cert?{cert:pem(cert)}:{}),...(key?{key:pem(key)}:{})}:false;
   const client=new pg.Client({host,port,user:value('DB_POSTGRESDB_USER','postgres'),database:value('DB_POSTGRESDB_DATABASE','n8n'),password:value('DB_POSTGRESDB_PASSWORD'),ssl,application_name:'shadowbridge_mail_metadata_readonly',connectionTimeoutMillis:5000,query_timeout:6000,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000'});
   let connected=false;try{
    stage='postgres_connection';await client.connect();connected=true;stage='postgres_metadata';await client.query('BEGIN READ ONLY');
    if((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only!=='on')throw Error();
    rows=(await client.query('SELECT type,count(*)::integer AS count FROM "'+schema+'"."'+prefix+'credentials_entity" WHERE type=ANY($1::text[]) GROUP BY type',[types])).rows;
   }finally{if(connected){try{await client.query('ROLLBACK');}finally{await client.end();}}else await client.end().catch(()=>{});}
  }else return{status:'METADATA_NOT_VERIFIED_UNSUPPORTED_DATABASE',authorizationVerified:false};
  return{status:'METADATA_READ_ONLY',databaseType:type,authorizationVerified:false,gmailOAuthCandidates:Number(rows.find(r=>r.type==='gmailOAuth2')?.count||0),smtpCandidates:Number(rows.find(r=>r.type==='smtp')?.count||0),googleOAuthCandidates:Number(rows.find(r=>r.type==='googleOAuth2Api')?.count||0)};
 }catch{return failure();}
}
function n8nMailMetadataCode(){return 'console.log(JSON.stringify(await ('+readN8nMailMetadata.toString()+')()));';}

// Metadata-only channel discovery. No SMTP login, send, credential decryption,
// bootstrap, configuration write or application restart.
function validWizardEmail(value){
 if(typeof value!=='string')throw Error('MAIL_RECIPIENT_INVALID');
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^[-a-z0-9.!#$%&'*+/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)||/[\r\n]/.test(value))throw Error('MAIL_RECIPIENT_INVALID');
 return email;
}
function mailChannelProbeCode(recipient){
 const email=validWizardEmail(recipient);
 const inventory=n8nMailMetadataCode();
 return `import{execFileSync}from'node:child_process';import{lstat,readFile}from'node:fs/promises';import{hostname}from'node:os';
const report={kind:'shadowbridge-existing-mail-channel',readOnly:true,changesMade:false,recipient:${JSON.stringify(email)},codeSent:false,deliveryVerified:false,publicSignup:false};
const run=a=>execFileSync('docker',['--context','default',...a],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16*1024**2});
const env=c=>Object.fromEntries((c.Config.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
try{
 if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');
 const ids=run(['ps','-q']).trim().split('\\n').filter(Boolean),all=ids.length?JSON.parse(run(['inspect',...ids])):[];
 const apps=all.filter(c=>c.Config.Labels?.['com.docker.compose.service']==='app'&&env(c).RELEASE_SHA==='80f4a0d333d31a6d57ada714b0df17bc0584a07b');
 if(apps.length!==1)throw Error('ACCEPTED_APP_NOT_UNIQUE');
 const app=apps[0],project=app.Config.Labels['com.docker.compose.project'],auth=all.filter(c=>c.Config.Labels?.['com.docker.compose.project']===project&&c.Config.Labels?.['com.docker.compose.service']==='auth');
 if(auth.length!==1)throw Error('AUTH_NOT_UNIQUE');const a=env(auth[0]);
 report.runtime={release:env(app).RELEASE_SHA,healthy:app.State.Health?.Status==='healthy',mailMode:['disabled','allowlist','smtp'].includes(env(app).MAIL_DELIVERY_MODE)?env(app).MAIL_DELIVERY_MODE:'UNKNOWN'};
 report.auth={externalSmtpConfigured:!!a.GOTRUE_SMTP_HOST&&!['127.0.0.1','localhost','mailpit'].includes(a.GOTRUE_SMTP_HOST)&&!!a.GOTRUE_SMTP_USER&&!!a.GOTRUE_SMTP_PASS,smtpCredentialPresent:!!a.GOTRUE_SMTP_PASS,signupDisabled:a.GOTRUE_DISABLE_SIGNUP==='true',authorizationVerified:false};
 const n8n=all.find(c=>c.Name==='/shadowbridge-automation-n8n-1');
 if(n8n){try{report.n8n=JSON.parse(run(['exec',n8n.Id,'node','--input-type=module','-e',${JSON.stringify(inventory)}]));}catch{report.n8n={status:'METADATA_NOT_VERIFIED',authorizationVerified:false};}}
 else report.n8n={status:'NOT_RUNNING',authorizationVerified:false};
 const old='/opt/shadowbridge-operators/smtp-cbca6a0c4ef9559081aaac7347370a774331b8ea/.local/smtp-package-cbca6a0c4ef9559081aaac7347370a774331b8ea';
 report.previousAttempt={};for(const [key,file]of Object.entries({checkpoint:old+'/operator-state.json',lock:'/opt/shadowbridge/.local/smtp-operator-lock/operation.lock',credential:old+'/smtp-credential.env'})){try{const s=await lstat(file);report.previousAttempt[key]={exists:true,regular:s.isFile()&&!s.isSymbolicLink(),mode:(s.mode&511).toString(8)};}catch(e){report.previousAttempt[key]={exists:e.code==='ENOENT'?false:null};}}
 const candidate=report.auth.externalSmtpConfigured||(report.n8n.gmailOAuthCandidates||0)>0||(report.n8n.smtpCandidates||0)>0||(report.n8n.googleOAuthCandidates||0)>0;
 report.status='BLOCKED';report.reason=candidate?'EXISTING_MAIL_CANDIDATE_REQUIRES_AUTHORIZED_SEND_TEST':report.n8n.status==='METADATA_READ_ONLY'?'NO_AUTHORIZED_MAIL_CHANNEL_FOUND':'NO_AUTHORIZED_MAIL_CHANNEL_PROVEN_N8N_UNVERIFIED';
 report.missingDependency=candidate?'Validate existing SMTP/OAuth authorization server-side before any message.':'One-time outbound authorization for an existing sender. Inbox access and recipient address do not authorize sending.';
}catch(e){report.status='BLOCKED';report.reason=/^[A-Z_]{4,100}$/.test(e.message||'')?e.message:'READ_ONLY_MAIL_DISCOVERY_FAILED';}
console.log(JSON.stringify(report,null,2));`;
}

function n8nMailOnlyProbeCode(){
 const inventory=n8nMailMetadataCode();
 return `import{execFileSync}from'node:child_process';import{hostname}from'node:os';
 const report={kind:'shadowbridge-n8n-mail-metadata',readOnly:true,changesMade:false,codeSent:false,deliveryVerified:false,authorizationVerified:false};
 const run=a=>execFileSync('docker',['--context','default',...a],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:1048576});
 try{
 if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');
 const endpoint=JSON.parse(run(['context','inspect','default','--format','{{json .Endpoints.docker}}']));if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint.Host))throw Error('LOCAL_DOCKER_REQUIRED');
 const [container]=JSON.parse(run(['inspect','shadowbridge-automation-n8n-1']));if(container.Name!=='/shadowbridge-automation-n8n-1'||!container.State.Running)throw Error('EXISTING_N8N_NOT_RUNNING');
 report.n8n=JSON.parse(run(['exec',container.Id,'node','--input-type=module','-e',${JSON.stringify(inventory)}]));
 report.status=report.n8n.status==='METADATA_READ_ONLY'?'INVENTORY_COMPLETE':'BLOCKED';
 report.mailCandidateFound=(report.n8n.gmailOAuthCandidates||0)+(report.n8n.smtpCandidates||0)+(report.n8n.googleOAuthCandidates||0)>0;
 }catch(e){report.status='BLOCKED';report.reason=/^[A-Z_]{4,100}$/.test(e.message||'')?e.message:'N8N_METADATA_COMMAND_FAILED';}
 console.log(JSON.stringify(report,null,2));`;
}

// Bundled into smtp-owner-launcher.mjs; never deploys before remote interactive GO.
import{mkdir,mkdtemp,chmod,readFile as localReadFile,writeFile as localWriteFile,lstat as localLstat,realpath as localRealpath,statfs as localStatfs}from'node:fs/promises';import{hostname,homedir,platform}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{createInterface as wizardReadline}from'node:readline/promises';
const server='shadowadmin@169.58.232.69',quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function remoteOperatorCommand(release,phase){must(/^[a-f0-9]{40}$/.test(release)&&['inspect','prepare','offsite','apply','resume','delivery','rollback','public-go-no-go'].includes(phase),'LAUNCHER_ARGUMENTS_INVALID');return'sudo node /opt/shadowbridge-operators/smtp-'+release+'/scripts/smtp-production-operator.mjs '+phase+' --release='+release;}
function bootstrapCode(release){must(/^[a-f0-9]{40}$/.test(release),'RELEASE_REQUIRED');return`import{execFileSync}from'node:child_process';import{mkdir,lstat,realpath}from'node:fs/promises';import{hostname}from'node:os';const release='${release}',dir='/opt/shadowbridge-operators/smtp-'+release;const ok=(v)=>{if(!v)throw Error('PINNED_BOOTSTRAP_BLOCKED');};ok(process.geteuid()===0&&process.env.SUDO_USER==='shadowadmin'&&hostname()==='vmi3682957');const git=a=>execFileSync('git',['-c','safe.directory='+dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await mkdir('/opt/shadowbridge-operators',{mode:0o700,recursive:true});const parent=await lstat('/opt/shadowbridge-operators');ok(!parent.isSymbolicLink()&&parent.uid===0&&(parent.mode&0o777)===0o700);let exists=true;try{await lstat(dir);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}if(!exists){await mkdir(dir,{mode:0o700});git(['init',dir]);git(['-C',dir,'remote','add','origin','https://github.com/Thomas-Thor/ShadowBridge.git']);git(['-C',dir,'fetch','--depth','1','origin',release]);git(['-C',dir,'checkout','--detach',release]);}ok(await realpath(dir)===dir&&git(['-C',dir,'rev-parse','HEAD'])===release&&!git(['-C',dir,'status','--porcelain']));console.log(JSON.stringify({operatorPrepared:true,release,liveCheckoutChanged:false,servicesChanged:false}));`;
}
const execute=executeExternal;
const remote=(command,stage='remote.command',options={})=>execute('ssh',['-tt','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15',server,command],{timeout:900000,stage,...options});
const discover=async()=>parseSmtpDiscovery(await remote('sudo node --input-type=module -e '+quote(existingSmtpDiscoveryCode()),'checkpoint.discovery',{capture:true,tee:true}));
const status=async(release,{authoritative=false}={})=>{if(authoritative){const r=await discover();if(r.lock?.exists!==false)throw Error('SMTP_OPERATION_LOCK_PRESENT_NO_REMOVAL');const c=r.candidates.find(c=>c.sourceRelease===release);if(!c||!c.checkoutMatches||!c.sealedProfileValid)throw Error('CHECKPOINT_CHANGED_RECHECK_REQUIRED');return c;}const p='/home/shadowadmin/.shadowbridge-smtp-'+release+'/status.json',code="import{readFile}from'node:fs/promises';try{console.log(await readFile("+JSON.stringify(p)+",'utf8'));}catch(e){if(e.code!=='ENOENT')process.exit(1);console.log(JSON.stringify({phase:'NONE'}));}";const out=await execute('ssh',['-T','-o','StrictHostKeyChecking=yes',server,'node --input-type=module -e '+quote(code)],{capture:true,stage:'checkpoint.public-status'});try{return JSON.parse(out);}catch{throw Error('CHECKPOINT_PUBLIC_STATUS_RESPONSE_INVALID');}};
async function verifyLocalOffsite({manifest,directory,release,hostHash}){verifyTransferManifest(manifest,release);must(hostHash!==manifest.serverHostHash,'OFFSITE_MUST_BE_DIFFERENT_MACHINE');for(const f of manifest.files){const file=directory+'/'+(f.name.endsWith('.key')?'keys/':'archives/')+f.name,bytes=await privateRead(file);must(hash(bytes)===f.sha256&&bytes.length===f.bytes,'OFFSITE_DOWNLOADED_BYTES_MISMATCH');}for(const name of ['database','configuration','certificates'])await authenticateArchiveOnly(directory+'/archives/'+name+'.sbb',directory+'/keys/'+name+'.key');const receipt={kind:'shadowbridge-smtp-offsite-receipt-v1',operatorRelease:release,nonce:manifest.nonce,manifestHash:hash(JSON.stringify(manifest)),verifierHostHash:hostHash,differentHost:true,authenticatedArchives:true,verifiedAt:new Date().toISOString(),files:manifest.files};verifyOffsiteReceipt(manifest,receipt,release);return receipt;}
async function launch(args=process.argv.slice(2)){
 let release=args.find(a=>a.startsWith('--release='))?.slice(10);must(/^[a-f0-9]{40}$/.test(release||'')&&args.every(a=>a==='--rollback'||a==='--preflight-only'||a==='--mail-wizard'||a==='--n8n-mail-check'||a==='--resume-existing'||a==='--diagnose-existing'||a.startsWith('--release=')),'LAUNCHER_ARGUMENTS_INVALID');must(process.stdin.isTTY&&platform()==='linux'&&hostname()!=='vmi3682957','RUN_ON_OWNER_POP_OS_INTERACTIVELY');const modes=args.filter(a=>['--resume-existing','--diagnose-existing','--mail-wizard','--n8n-mail-check'].includes(a));must(modes.length<=1&&!(modes.length&&args.includes('--rollback')),'LAUNCHER_ARGUMENTS_INVALID');
 if(args.includes('--n8n-mail-check')){await remote('sudo node --input-type=module -e '+quote(n8nMailOnlyProbeCode()),'diagnostic.n8n-mail');return;}
 if(args.includes('--mail-wizard')){const input=wizardReadline({input:process.stdin,output:process.stdout,terminal:true});let email;try{email=validWizardEmail(await input.question('Adres e-mail, który kontrolujesz [shadowbridge.trade@gmail.com]: ')||'shadowbridge.trade@gmail.com');}finally{input.close();process.stdin.pause();}await remote('sudo node --input-type=module -e '+quote(mailChannelProbeCode(email)),'diagnostic.mail-channel');return;}
 const installerRelease=release;const resumeMode=args.includes('--resume-existing')||args.includes('--diagnose-existing');let s;
 if(resumeMode){const report=await discover();if(args.includes('--diagnose-existing')||args.includes('--preflight-only')){console.log(JSON.stringify(report));return;}s=existingResumeSelection(report);release=s.sourceRelease;}
 else{await remote('sudo node --input-type=module -e '+quote(bootstrapCode(release)),'operator.bootstrap');s=await status(release);}
 const reload=()=>status(release,{authoritative:resumeMode});
 if(resumeMode&&s.resumeAction==='preparation'){await remote('sudo node --input-type=module -e '+quote(preparationResumeCode(release,installerRelease)),'operator.resume-preparation');s=await reload();}
 if(args.includes('--rollback')){await remote(remoteOperatorCommand(release,'rollback'),'operator.rollback');return;}
 if(s.phase==='NONE'){await remote(remoteOperatorCommand(release,'inspect'),'operator.inspect');if(args.includes('--preflight-only'))return;await remote(remoteOperatorCommand(release,'prepare'),'operator.prepare');s=await reload();}else if(args.includes('--preflight-only')){console.log(JSON.stringify(s));return;}
 if(s.phase==='WAITING_REAL_OFFSITE'){
  const localRoot=path.join(homedir(),'.local/state/shadowbridge-smtp-offsite');await mkdir(localRoot,{mode:0o700,recursive:true});const folder=path.join(localRoot,release);try{await mkdir(folder,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  for(const name of ['archives','keys'])await mkdir(folder+'/'+name,{mode:0o700,recursive:true});for(const d of [localRoot,folder,folder+'/archives',folder+'/keys']){const st=await localLstat(d);must(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o777)===0o700&&await localRealpath(d)===d,'PRIVATE_OFFSITE_DIRECTORY_REQUIRED');}
  const transfer='/home/shadowadmin/.shadowbridge-smtp-'+release,scp=(source,dest,stage)=>execute('scp',['-p','-o','StrictHostKeyChecking=yes',source,dest],{stage});
  // Never silently overwrite an existing verified backup or receipt.
  const get=async(name,target)=>{try{await privateRead(target);return;}catch(e){if(e.code!=='ENOENT')throw e;}await scp(server+':'+transfer+'/'+name,target,'offsite.download.'+name);await chmod(target,0o600);};
  await get('manifest.json',folder+'/manifest.json');const manifest=JSON.parse(await privateRead(folder+'/manifest.json'));verifyTransferManifest(manifest,release);const space=await localStatfs(folder);must(space.bavail*space.bsize>manifest.files.reduce((sum,f)=>sum+f.bytes,0)*1.25+256*1024**2&&space.ffree>100,'INSUFFICIENT_REAL_OFFSITE_SPACE');
  for(const f of manifest.files)await get(f.name,folder+'/'+(f.name.endsWith('.key')?'keys/':'archives/')+f.name);
  const receipt=await verifyLocalOffsite({manifest,directory:folder,release,hostHash:hash(await localReadFile('/etc/machine-id'))}),file=folder+'/offsite-receipt.json';try{await localWriteFile(file,JSON.stringify(receipt)+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;verifyOffsiteReceipt(manifest,JSON.parse(await privateRead(file)),release);}await scp(file,server+':'+transfer+'/offsite-receipt.json','offsite.upload-receipt');await remote(remoteOperatorCommand(release,'offsite'),'operator.offsite');s=await reload();
 }
 if(s.phase==='OFFSITE_VERIFIED'){await remote(remoteOperatorCommand(release,'apply'),'operator.apply');s=await reload();}
 if(s.phase==='APPLYING_ALLOWLIST'){await remote(remoteOperatorCommand(release,'resume'),'operator.resume');s=await reload();}
 if(['ALLOWLIST_ACTIVE_PENDING_DELIVERY','SIGNUP_REQUEST_IN_PROGRESS','SIGNUP_MAIL_SENT','CONFIRMED','RECOVERY_REQUEST_IN_PROGRESS','RECOVERY_MAIL_SENT','RECOVERY_VERIFIED_WAITING_HEADERS','PASSWORD_RESET_IN_PROGRESS'].includes(s.phase)){await remote(remoteOperatorCommand(release,'delivery'),'operator.delivery');s=await reload();}
 if(s.phase==='ALLOWLIST_DELIVERY_VERIFIED'){await remote(remoteOperatorCommand(release,'rollback'),'operator.rollback');s=await reload();}
 if(['BACKUPS_IN_PROGRESS','PREPARED','ROLLBACK_UNVERIFIED'].includes(s.phase))throw Error('PARTIAL_CHECKPOINT_REQUIRES_READ_ONLY_RECONCILIATION_NO_RETRY');
 console.log(JSON.stringify({status:s.phase==='ROLLED_BACK_CONFIG_ONLY'&&s.recoveryVerified&&s.rollbackVerified?'REAL_SMTP_TEST_VERIFIED_AND_ROLLED_BACK':'READY_FOR_OWNER_ACTION',...s,chatgptWrite:'PARKED',sourcing:'DRY_RUN_DISABLED',productionPublicSignup:false,offsiteDirectory:path.join(homedir(),'.local/state/shadowbridge-smtp-offsite',release)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))launch().catch(e=>{console.error(JSON.stringify(launcherFailure(e)));process.exitCode=1;});
