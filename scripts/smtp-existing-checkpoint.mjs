// Read-only authoritative checkpoint discovery for reviewed SMTP operators.
export const reviewedSmtpOperators=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
export async function inspectExistingSmtp({operatorRoot='/opt/shadowbridge-operators',liveRoot='/opt/shadowbridge',readCommand,validateProfile,diagnoseEmpty=false,validateEmptyPreparation}={}){
 const fs=await import('node:fs/promises');const{execFileSync}=await import('node:child_process');const{pathToFileURL}=await import('node:url');
 const allowed=['cbca6a0c4ef9559081aaac7347370a774331b8ea','07cbcf6ea905eee89d80f66bf4a979f0252d5e17','a4e67c0f6c8c9832c26f7ac8e7a9d57e26108989','c1c94cc45e74535d712e0418c8749ed6bd618648','2e22ef0f755e18a73e2b0da9408b1cf54b529550'];
 const run=readCommand||((b,a)=>execFileSync(b,a,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:16777216}).trim());
 const meta=async file=>{try{const s=await fs.lstat(file);return{exists:true,type:s.isSymbolicLink()?'symlink':s.isFile()?'file':s.isDirectory()?'directory':'other',mode:(s.mode&511).toString(8),uid:s.uid,bytes:s.size};}catch(e){return{exists:e.code==='ENOENT'?false:null};}};
 const report={kind:'shadowbridge-existing-smtp-checkpoint',readOnly:true,changesMade:false,candidates:[],operatorInstalls:[],codeSent:false};
 const lockPath=liveRoot+'/.local/smtp-operator-lock/operation.lock';report.lock=await meta(lockPath);
 if(report.lock.type==='file'&&report.lock.mode==='600'){try{const p=JSON.parse(await fs.readFile(lockPath,'utf8'));if(Number.isInteger(p.pid)&&p.pid>1){report.lock.pid=p.pid;try{process.kill(p.pid,0);report.lock.processAlive=true;}catch(e){report.lock.processAlive=e.code==='ESRCH'?false:null;}}}catch{}}
 let names=[];try{names=await fs.readdir(operatorRoot);}catch{report.discoveryFailed=true;return report;}
 for(const name of names.filter(n=>/^smtp-[a-f0-9]{40}$/.test(n)).sort()){
  const release=name.slice(5),root=operatorRoot+'/'+name,pkg=root+'/.local/smtp-package-'+release,stateFile=pkg+'/operator-state.json';
  const rootInfo=await meta(root),localInfo=await meta(root+'/.local'),packageInfo=await meta(pkg);
  const install={sourceRelease:release,root:rootInfo,local:localInfo,package:packageInfo,reviewed:allowed.includes(release),checkoutMatches:false};report.operatorInstalls.push(install);
  if(rootInfo.type==='directory'&&rootInfo.mode==='700'&&await fs.realpath(root)===root){try{install.checkoutMatches=run('git',['-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'])===release&&!run('git',['-c','safe.directory='+root,'-C',root,'status','--porcelain']);}catch{}}
  // A missing file and a failed stat are different. Empty/partial packages and
  // permission failures must never look like a safe absence of previous work.
  const stateInfo=await meta(stateFile),credential=await meta(pkg+'/smtp-credential.env'),manifest=await meta(pkg+'/manifest.json');
  install.checkpoint=stateInfo;install.credentialFile=credential;install.manifest=manifest;
  if([stateInfo,credential,manifest,packageInfo].every(v=>v.exists===false))continue;
  const c={sourceRelease:release,checkpoint:stateInfo,credentialSaved:credential.exists===true,credentialFile:credential,phase:stateInfo.exists?'CHECKPOINT_UNREADABLE':'NO_CHECKPOINT',artifacts:{}};report.candidates.push(c);
  for(const f of ['database.sbb','database.key','configuration.sbb','configuration.key','certificates.sbb','certificates.key','database.private','configuration.private','certificates.private'])c.artifacts[f]=await meta(pkg+'/'+f);
  c.reviewed=install.reviewed;c.checkoutMatches=install.checkoutMatches;c.sealedProfileValid=false;
  if(!c.reviewed||rootInfo.type!=='directory'||rootInfo.mode!=='700'||await fs.realpath(root)!==root)continue;
  if(!c.checkoutMatches)continue;
  const transfer='/home/shadowadmin/.shadowbridge-smtp-'+release;c.transferDirectory=await meta(transfer);c.publishedStatus=await meta(transfer+'/status.json');
  if(stateInfo.type==='file'&&stateInfo.mode==='600'){try{const s=JSON.parse(await fs.readFile(stateFile,'utf8'));if(s.operatorRelease===release&&s.dir===pkg&&s.publicRegistration===false){c.phase=/^[A-Z_]{1,80}$/.test(s.phase||'')?s.phase:'CHECKPOINT_PHASE_INVALID';for(const k of ['offsiteVerified','smtpAuthVerified','confirmationVerified','recoveryVerified','rollbackVerified','ownerInteractiveAcceptance'])c[k]=s[k]===true;c.recordedBackupKinds=Object.keys(s.backups||{}).filter(k=>['database','configuration','certificates'].includes(k));}else c.phase='CHECKPOINT_IDENTITY_INVALID';}catch{}}
  if(credential.type==='file'&&credential.mode==='600'){try{const inspect=validateProfile||((await import(pathToFileURL(root+'/scripts/smtp-test-package.mjs').href)).inspectSmtpPackage);await inspect(pkg,{sealed:true});c.sealedProfileValid=true;}catch{c.sealedProfileError='SAVED_PROFILE_VALIDATION_FAILED';}}
 }
 if(diagnoseEmpty&&report.candidates.length===0&&report.lock.exists===false){
  const eligible=report.operatorInstalls.filter(c=>c.reviewed&&c.checkoutMatches&&c.root.type==='directory'&&c.root.mode==='700');
  report.prePackageCheck={status:'NOT_RUN',reason:eligible.length===1?'READ_ONLY_CHECK_PENDING':'UNIQUE_REVIEWED_EMPTY_OPERATOR_REQUIRED'};
  if(eligible.length===1){const c=eligible[0],root=operatorRoot+'/smtp-'+c.sourceRelease;let stage='preparation.private-parent';
   try{
    if(c.local.type!=='directory'||c.local.mode!=='700')throw Error('SMTP_PRIVATE_DIRECTORY_REQUIRED');
    stage='preparation.baseline';
    const validate=validateEmptyPreparation||async function(root,sourceRelease){
     const {collectProduction}=await import(pathToFileURL(root+'/scripts/smtp-production-operator.mjs').href);
     const {smtpCandidate}=await import(pathToFileURL(root+'/scripts/smtp-test-package.mjs').href);
     const r=await collectProduction();
     // The fictional recipient is only an in-memory shape probe. No SMTP call,
     // credential read, package creation, lock or checkpoint write is performed.
     try{smtpCandidate(r.base,{emails:['smtp-shape-probe@example.invalid'],project:r.project,credentialFile:root+'/.local/smtp-package-'+sourceRelease+'/smtp-credential.env'});}
     catch(e){e.safePreparationStage='preparation.candidate';throw e;}
    };
    await validate(root,c.sourceRelease);
    report.prePackageCheck={sourceRelease:c.sourceRelease,status:'PASS',stage:'preparation.candidate',credentialRead:false,profileWritten:false,reason:'NO_SAVED_PROFILE_HISTORICAL_INPUT_OR_FAILURE_NOT_RECOVERABLE'};
   }catch(e){report.prePackageCheck={sourceRelease:c.sourceRelease,status:'BLOCKED',stage:e.safePreparationStage==='preparation.candidate'?e.safePreparationStage:stage,reason:/^(?:SMTP_|APP_|AUTH_|ACCEPTED_|ACTIVE_|SOURCE_|PRODUCTION_|LIVE_|MIGRATION_|UNCHANGED_|PINNED_|PRIVATE_|OPERATOR_|UNIQUE_|N8N_|HTTPS_|TLS_|INSUFFICIENT_|EDGE_|LOCAL_|RESOLVED_|PROTECTED_|CHECKOUT_)[A-Z0-9_]{1,110}$/.test(e.message||'')?e.message:'READ_ONLY_PREPARATION_CHECK_FAILED',credentialRead:false,profileWritten:false};}
  }
 }
 try{const ids=run('docker',['--context','default','ps','-q']).split('\n').filter(Boolean),containers=ids.length?JSON.parse(run('docker',['--context','default','inspect',...ids])):[];report.runtime=containers.filter(c=>c.Config.Labels?.['com.docker.compose.service']==='app').map(c=>{const e=Object.fromEntries((c.Config.Env||[]).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));return{release:/^[a-f0-9]{40}$/.test(e.RELEASE_SHA||'')?e.RELEASE_SHA:null,mailMode:['disabled','allowlist','smtp'].includes(e.MAIL_DELIVERY_MODE)?e.MAIL_DELIVERY_MODE:'UNKNOWN',healthy:c.State.Health?.Status==='healthy'};});}catch{report.runtimeUnverified=true;}
 return report;
}
export function existingSmtpDiscoveryCode({diagnoseEmpty=false}={}){return `import{hostname}from'node:os';try{if(process.geteuid()!==0||process.env.SUDO_USER!=='shadowadmin'||hostname()!=='vmi3682957')throw Error('AUTHORIZED_READ_ONLY_OPERATOR_REQUIRED');const result=await (${inspectExistingSmtp.toString()})({diagnoseEmpty:${diagnoseEmpty===true}});console.log('SB_SMTP_CHECKPOINT_JSON_BEGIN');console.log(JSON.stringify(result));console.log('SB_SMTP_CHECKPOINT_JSON_END');}catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'CHECKPOINT_DISCOVERY_FAILED',stage:'checkpoint.discovery'}));process.exitCode=1;}`;}

export function parseSmtpDiscovery(stdout){const a='SB_SMTP_CHECKPOINT_JSON_BEGIN',b='SB_SMTP_CHECKPOINT_JSON_END',i=stdout.lastIndexOf(a),j=stdout.indexOf(b,i);if(i<0||j<0)throw Error('CHECKPOINT_DISCOVERY_RESPONSE_INVALID');const r=JSON.parse(stdout.slice(i+a.length,j).trim());if(r.kind!=='shadowbridge-existing-smtp-checkpoint'||r.readOnly!==true||!Array.isArray(r.candidates))throw Error('CHECKPOINT_DISCOVERY_RESPONSE_INVALID');return r;}
export function existingResumeSelection(report){
 const stop=(code,stage)=>{const e=Error(code);e.stage=stage;throw e;};if(report.discoveryFailed)stop('CHECKPOINT_DISCOVERY_FAILED','checkpoint.discovery');if(report.lock?.exists!==false)stop('SMTP_OPERATION_LOCK_PRESENT_NO_REMOVAL','checkpoint.lock');
 const active=report.candidates.filter(c=>c.phase!=='ROLLED_BACK_CONFIG_ONLY');if(active.length!==1)stop(active.length?'MULTIPLE_SAVED_SMTP_ATTEMPTS_REQUIRE_SELECTION':'NO_SAVED_SMTP_ATTEMPT_FOUND','checkpoint.selection');const c=active[0];
 if(!c.reviewed||!c.checkoutMatches)stop('SAVED_OPERATOR_IDENTITY_NOT_PROVEN','checkpoint.identity');if(!c.credentialSaved||!c.sealedProfileValid)stop('SAVED_SMTP_CREDENTIAL_OR_SEAL_NOT_PROVEN','checkpoint.credential');
 const allowed=['WAITING_REAL_OFFSITE','OFFSITE_VERIFIED','ALLOWLIST_ACTIVE_PENDING_DELIVERY','SIGNUP_MAIL_SENT','CONFIRMED','RECOVERY_MAIL_SENT','RECOVERY_VERIFIED_WAITING_HEADERS','ALLOWLIST_DELIVERY_VERIFIED'];
 if(['NO_CHECKPOINT','PREPARED','BACKUPS_IN_PROGRESS','BACKUPS_VERIFIED_WAITING_TRANSFER'].includes(c.phase))return{...c,resumeAction:'preparation'};if(!allowed.includes(c.phase))stop('CHECKPOINT_PHASE_REQUIRES_REPAIR_NO_AUTOMATIC_REPLAY','checkpoint.'+c.phase.toLowerCase());return{...c,resumeAction:'continue'};
}
// Explicit fresh capture only after authoritative evidence that no earlier
// package exists. Never turn an ordinary failed resume into a new preparation.
export function missingSmtpStartSelection(report){
 const stop=code=>{const e=Error(code);e.stage='checkpoint.missing-profile';throw e;};
 if(report.discoveryFailed)stop('CHECKPOINT_DISCOVERY_FAILED');
 if(report.lock?.exists!==false)stop('SMTP_OPERATION_LOCK_PRESENT_NO_REMOVAL');
 if(report.candidates.length)stop('EXISTING_SMTP_ARTIFACTS_USE_RESUME_NOT_START');
 const installs=report.operatorInstalls||[];
 if(installs.length!==1)stop('UNIQUE_EMPTY_SMTP_OPERATOR_REQUIRED');
 const c=installs[0];
 if(!c.reviewed||!c.checkoutMatches||c.root?.uid!==0||c.root?.mode!=='700'||c.root?.type!=='directory'||c.local?.uid!==0||c.local?.mode!=='700'||c.local?.type!=='directory')stop('SAVED_OPERATOR_IDENTITY_NOT_PROVEN');
 if([c.package,c.checkpoint,c.credentialFile,c.manifest].some(v=>v?.exists!==false))stop('EXISTING_SMTP_ARTIFACTS_USE_RESUME_NOT_START');
 return{sourceRelease:c.sourceRelease,phase:'NO_CHECKPOINT',resumeAction:'preparation',initializeEmpty:true};
}
