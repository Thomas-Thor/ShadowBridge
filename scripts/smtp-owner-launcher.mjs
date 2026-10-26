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
 const inventory=`
  try {
   if ((process.env.DB_TYPE||'sqlite')!=='sqlite') {console.log(JSON.stringify({status:'METADATA_NOT_VERIFIED_NON_SQLITE',authorizationVerified:false}));}
   else {
    const {DatabaseSync}=await import('node:sqlite');const path=await import('node:path');
    const prefix=process.env.DB_TABLE_PREFIX||'';if(!/^[a-zA-Z0-9_]{0,64}$/.test(prefix))throw Error();
    const database=path.resolve(process.env.N8N_USER_FOLDER||'/home/node','.n8n',process.env.DB_SQLITE_DATABASE||'database.sqlite');
    const db=new DatabaseSync(database,{readOnly:true});
    try {const rows=db.prepare('SELECT type,count(*) AS count FROM "'+prefix+'credentials_entity" WHERE type IN (?,?) GROUP BY type').all('gmailOAuth2','smtp');
    console.log(JSON.stringify({status:'METADATA_READ_ONLY',authorizationVerified:false,gmailOAuthCandidates:Number(rows.find(r=>r.type==='gmailOAuth2')?.count||0),smtpCandidates:Number(rows.find(r=>r.type==='smtp')?.count||0)}));}
    finally{db.close();}
   }
  } catch {console.log(JSON.stringify({status:'METADATA_NOT_VERIFIED',authorizationVerified:false}));}`;
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
 const candidate=report.auth.externalSmtpConfigured||(report.n8n.gmailOAuthCandidates||0)>0||(report.n8n.smtpCandidates||0)>0;
 report.status='BLOCKED';report.reason=candidate?'EXISTING_MAIL_CANDIDATE_REQUIRES_AUTHORIZED_SEND_TEST':report.n8n.status==='METADATA_READ_ONLY'?'NO_AUTHORIZED_MAIL_CHANNEL_FOUND':'NO_AUTHORIZED_MAIL_CHANNEL_PROVEN_N8N_UNVERIFIED';
 report.missingDependency=candidate?'Validate existing SMTP/OAuth authorization server-side before any message.':'One-time outbound authorization for an existing sender. Inbox access and recipient address do not authorize sending.';
}catch(e){report.status='BLOCKED';report.reason=/^[A-Z_]{4,100}$/.test(e.message||'')?e.message:'READ_ONLY_MAIL_DISCOVERY_FAILED';}
console.log(JSON.stringify(report,null,2));`;
}

// Bundled into smtp-owner-launcher.mjs; never deploys before remote interactive GO.
import{spawnSync}from'node:child_process';import{mkdir,mkdtemp,chmod,readFile as localReadFile,writeFile as localWriteFile,lstat as localLstat,realpath as localRealpath,statfs as localStatfs}from'node:fs/promises';import{hostname,homedir,platform}from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{createInterface as wizardReadline}from'node:readline/promises';
const server='shadowadmin@169.58.232.69',quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function remoteOperatorCommand(release,phase){must(/^[a-f0-9]{40}$/.test(release)&&['inspect','prepare','offsite','apply','resume','delivery','rollback','public-go-no-go'].includes(phase),'LAUNCHER_ARGUMENTS_INVALID');return'sudo node /opt/shadowbridge-operators/smtp-'+release+'/scripts/smtp-production-operator.mjs '+phase+' --release='+release;}
function bootstrapCode(release){must(/^[a-f0-9]{40}$/.test(release),'RELEASE_REQUIRED');return`import{execFileSync}from'node:child_process';import{mkdir,lstat,realpath}from'node:fs/promises';import{hostname}from'node:os';const release='${release}',dir='/opt/shadowbridge-operators/smtp-'+release;const ok=(v)=>{if(!v)throw Error('PINNED_BOOTSTRAP_BLOCKED');};ok(process.geteuid()===0&&process.env.SUDO_USER==='shadowadmin'&&hostname()==='vmi3682957');const git=a=>execFileSync('git',['-c','safe.directory='+dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await mkdir('/opt/shadowbridge-operators',{mode:0o700,recursive:true});const parent=await lstat('/opt/shadowbridge-operators');ok(!parent.isSymbolicLink()&&parent.uid===0&&(parent.mode&0o777)===0o700);let exists=true;try{await lstat(dir);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}if(!exists){await mkdir(dir,{mode:0o700});git(['init',dir]);git(['-C',dir,'remote','add','origin','https://github.com/Thomas-Thor/ShadowBridge.git']);git(['-C',dir,'fetch','--depth','1','origin',release]);git(['-C',dir,'checkout','--detach',release]);}ok(await realpath(dir)===dir&&git(['-C',dir,'rev-parse','HEAD'])===release&&!git(['-C',dir,'status','--porcelain']));console.log(JSON.stringify({operatorPrepared:true,release,liveCheckoutChanged:false,servicesChanged:false}));`;
}
const execute=(bin,args,{capture=false,timeout=180000}={})=>{const p=spawnSync(bin,args,{stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:'utf8',timeout,maxBuffer:2*1024**2});must(!p.error&&p.status===0,'OWNER_ACTION_STOPPED_CHECK_REMOTE_CHECKPOINT');return capture?p.stdout.trim():'';};
const remote=command=>execute('ssh',['-tt','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15',server,command],{timeout:900000});
const status=release=>{const p='/home/shadowadmin/.shadowbridge-smtp-'+release+'/status.json',code="import{readFile}from'node:fs/promises';try{console.log(await readFile("+JSON.stringify(p)+",'utf8'));}catch(e){if(e.code!=='ENOENT')process.exit(1);console.log(JSON.stringify({phase:'NONE'}));}";return JSON.parse(execute('ssh',['-T','-o','StrictHostKeyChecking=yes',server,'node --input-type=module -e '+quote(code)],{capture:true}));};
async function verifyLocalOffsite({manifest,directory,release,hostHash}){verifyTransferManifest(manifest,release);must(hostHash!==manifest.serverHostHash,'OFFSITE_MUST_BE_DIFFERENT_MACHINE');for(const f of manifest.files){const file=directory+'/'+(f.name.endsWith('.key')?'keys/':'archives/')+f.name,bytes=await privateRead(file);must(hash(bytes)===f.sha256&&bytes.length===f.bytes,'OFFSITE_DOWNLOADED_BYTES_MISMATCH');}for(const name of ['database','configuration','certificates'])await authenticateArchiveOnly(directory+'/archives/'+name+'.sbb',directory+'/keys/'+name+'.key');const receipt={kind:'shadowbridge-smtp-offsite-receipt-v1',operatorRelease:release,nonce:manifest.nonce,manifestHash:hash(JSON.stringify(manifest)),verifierHostHash:hostHash,differentHost:true,authenticatedArchives:true,verifiedAt:new Date().toISOString(),files:manifest.files};verifyOffsiteReceipt(manifest,receipt,release);return receipt;}
async function launch(args=process.argv.slice(2)){
 const release=args.find(a=>a.startsWith('--release='))?.slice(10);must(/^[a-f0-9]{40}$/.test(release||'')&&args.every(a=>a==='--rollback'||a==='--preflight-only'||a==='--mail-wizard'||a.startsWith('--release=')),'LAUNCHER_ARGUMENTS_INVALID');must(process.stdin.isTTY&&platform()==='linux'&&hostname()!=='vmi3682957','RUN_ON_OWNER_POP_OS_INTERACTIVELY');
 if(args.includes('--mail-wizard')){const input=wizardReadline({input:process.stdin,output:process.stdout,terminal:true});let email;try{email=validWizardEmail(await input.question('Adres e-mail, który kontrolujesz [shadowbridge.trade@gmail.com]: ')||'shadowbridge.trade@gmail.com');}finally{input.close();process.stdin.pause();}remote('sudo node --input-type=module -e '+quote(mailChannelProbeCode(email)));return;}
 remote('sudo node --input-type=module -e '+quote(bootstrapCode(release)));
 if(args.includes('--rollback')){remote(remoteOperatorCommand(release,'rollback'));return;}
 let s=status(release);if(s.phase==='NONE'){remote(remoteOperatorCommand(release,'inspect'));if(args.includes('--preflight-only'))return;remote(remoteOperatorCommand(release,'prepare'));s=status(release);}else if(args.includes('--preflight-only')){console.log(JSON.stringify(s));return;}
 if(s.phase==='WAITING_REAL_OFFSITE'){
  const localRoot=path.join(homedir(),'.local/state/shadowbridge-smtp-offsite');await mkdir(localRoot,{mode:0o700,recursive:true});const folder=path.join(localRoot,release);try{await mkdir(folder,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  for(const name of ['archives','keys'])await mkdir(folder+'/'+name,{mode:0o700,recursive:true});for(const d of [localRoot,folder,folder+'/archives',folder+'/keys']){const st=await localLstat(d);must(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o777)===0o700&&await localRealpath(d)===d,'PRIVATE_OFFSITE_DIRECTORY_REQUIRED');}
  const transfer='/home/shadowadmin/.shadowbridge-smtp-'+release,scp=(source,dest)=>execute('scp',['-p','-o','StrictHostKeyChecking=yes',source,dest]);
  // Never silently overwrite an existing verified backup or receipt.
  const get=async(name,target)=>{try{await privateRead(target);return;}catch(e){if(e.code!=='ENOENT')throw e;}scp(server+':'+transfer+'/'+name,target);await chmod(target,0o600);};
  await get('manifest.json',folder+'/manifest.json');const manifest=JSON.parse(await privateRead(folder+'/manifest.json'));verifyTransferManifest(manifest,release);const space=await localStatfs(folder);must(space.bavail*space.bsize>manifest.files.reduce((sum,f)=>sum+f.bytes,0)*1.25+256*1024**2&&space.ffree>100,'INSUFFICIENT_REAL_OFFSITE_SPACE');
  for(const f of manifest.files)await get(f.name,folder+'/'+(f.name.endsWith('.key')?'keys/':'archives/')+f.name);
  const receipt=await verifyLocalOffsite({manifest,directory:folder,release,hostHash:hash(await localReadFile('/etc/machine-id'))}),file=folder+'/offsite-receipt.json';try{await localWriteFile(file,JSON.stringify(receipt)+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;verifyOffsiteReceipt(manifest,JSON.parse(await privateRead(file)),release);}scp(file,server+':'+transfer+'/offsite-receipt.json');remote(remoteOperatorCommand(release,'offsite'));s=status(release);
 }
 if(s.phase==='OFFSITE_VERIFIED'){remote(remoteOperatorCommand(release,'apply'));s=status(release);}
 if(s.phase==='APPLYING_ALLOWLIST'){remote(remoteOperatorCommand(release,'resume'));s=status(release);}
 if(['ALLOWLIST_ACTIVE_PENDING_DELIVERY','SIGNUP_REQUEST_IN_PROGRESS','SIGNUP_MAIL_SENT','CONFIRMED','RECOVERY_REQUEST_IN_PROGRESS','RECOVERY_MAIL_SENT','RECOVERY_VERIFIED_WAITING_HEADERS','PASSWORD_RESET_IN_PROGRESS'].includes(s.phase)){remote(remoteOperatorCommand(release,'delivery'));s=status(release);}
 if(s.phase==='ALLOWLIST_DELIVERY_VERIFIED'){remote(remoteOperatorCommand(release,'rollback'));s=status(release);}
 if(['BACKUPS_IN_PROGRESS','PREPARED','ROLLBACK_UNVERIFIED'].includes(s.phase))throw Error('PARTIAL_CHECKPOINT_REQUIRES_READ_ONLY_RECONCILIATION_NO_RETRY');
 console.log(JSON.stringify({status:s.phase==='ROLLED_BACK_CONFIG_ONLY'&&s.recoveryVerified&&s.rollbackVerified?'REAL_SMTP_TEST_VERIFIED_AND_ROLLED_BACK':'READY_FOR_OWNER_ACTION',...s,chatgptWrite:'PARKED',sourcing:'DRY_RUN_DISABLED',productionPublicSignup:false,offsiteDirectory:path.join(homedir(),'.local/state/shadowbridge-smtp-offsite',release)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))launch().catch(e=>{console.error(JSON.stringify({status:'BLOCKED',reason:/^[A-Z_]{4,120}$/.test(e.message||'')?e.message:'OWNER_ACTION_INCOMPLETE_RETAIN_CHECKPOINT',noSuccessClaimed:true}));process.exitCode=1;});
