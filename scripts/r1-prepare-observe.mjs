// Operator diagnostics: deliberately no raw stderr, SQL values, credentials or
// environment dumps in the public report. No deployment/SQL/provider mutations.
import {open,readFile,lstat,readdir,statfs,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const codes=new Set(['EACCES','EPERM','EEXIST','ENOENT','ENOSPC','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','ENOMEM','ENOBUFS']);
const categories=new Set(['UNRECORDED_COMMAND_FAILURE','DISK_FULL','EXISTING_ARTIFACT','PERMISSION_DENIED','TLS_CERTIFICATE_FAILURE','DNS_FAILURE','TIMEOUT','SQL_OBJECT_MISMATCH','DEPENDENCY_BUILD_FAILURE']);
const steps=new Set(['PREVIOUS_ACCEPTANCE','READ_ONLY_INVENTORY','RUNTIME_PREFLIGHT','DISK_RESERVE','FRESH_OWNER_MFA','CURRENT_APP_IMAGE','BUILD_LOG_OPEN','BUILD_RUNTIME','BUILD_MIGRATOR','IMAGE_IDENTITY','APPLICATION_PLAN','PLANNED_CHECKPOINT']);
const phases=new Set(['PLANNED','BACKUPS_VERIFIED_WAITING_OFFSITE','MIGRATING','SCHEMA_VERIFIED','APP_STARTING','DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED','ROLLED_BACK_APPLICATION_ONLY','API_DISABLED','MCP_DISABLED','OAUTH_DISABLED','CREATE_DISABLED']);
export function safeFailure(error){
 const raw=String(error?.stderr||'')+'\n'+String(error?.message||'')+'\n'+(codes.has(error?.code)?error.code:'');
 let category=categories.has(error?.category)?error.category:'UNRECORDED_COMMAND_FAILURE';
 if(/no space left|ENOSPC/i.test(raw))category='DISK_FULL';
 else if(/EEXIST|file exists/i.test(raw))category='EXISTING_ARTIFACT';
 else if(/permission denied|EACCES|EPERM/i.test(raw))category='PERMISSION_DENIED';
 else if(/certificate|x509|CERT_HAS_EXPIRED|unable to verify/i.test(raw))category='TLS_CERTIFICATE_FAILURE';
 else if(/ENOTFOUND|EAI_AGAIN|could not resolve|temporary failure in name resolution/i.test(raw))category='DNS_FAILURE';
 else if(/timeout|ETIMEDOUT|timed out/i.test(raw))category='TIMEOUT';
 else if(/does not exist|undefined column|undefined table/i.test(raw))category='SQL_OBJECT_MISMATCH';
 else if(/npm (?:ERR!|error)|npm ci/i.test(raw))category='DEPENDENCY_BUILD_FAILURE';
 return {category,code:codes.has(error?.code)?error.code:null,exitStatus:Number.isInteger(error?.status)?error.status:null,signal:['SIGTERM','SIGKILL','SIGABRT'].includes(error?.signal)?error.signal:null};
}
export async function prepareAttempt(folder){
 const attempt=randomUUID(),file=path.join(folder,'prepare-'+attempt+'.jsonl'),fd=await open(file,'wx',0o600);
 const event=async(step,outcome,error)=>fd.write(JSON.stringify({at:new Date().toISOString(),attempt,step,outcome,...(error?{failure:safeFailure(error)}:{})})+'\n').then(()=>fd.sync());
 return {attempt,file,buildLog:path.join(folder,'build-'+attempt+'.log'),async run(step,fn){
  if(!steps.has(step))throw Error('Invalid prepare step.');
  await event(step,'STARTED');try{const result=await fn();await event(step,'COMPLETED');return result;}catch(e){await event(step,'FAILED',e);throw e;}
 },close:()=>fd.close()};
}
export async function checkpointEvidence({root,release}){
 if(!/^[a-f0-9]{40}$/.test(release))throw Error('Full release SHA required.');
 const folder=path.join(root,'.local','r1-owner-release-'+release);
 const info=async f=>{try{const s=await lstat(f);if(s.isSymbolicLink())return{exists:true,unsafeSymlink:true};return{exists:true,file:s.isFile(),directory:s.isDirectory(),mode:(s.mode&511).toString(8),bytes:s.size};}catch(e){if(e.code==='ENOENT')return{exists:false};throw e;}};
 const dir=await info(folder),out={release,directory:dir,checkpoint:{exists:false},lock:await info(path.join(folder,'operation.lock')),attempts:[],buildLogs:[]};
 if(!dir.exists||dir.unsafeSymlink||!dir.directory)return out;
 out.checkpoint=await info(path.join(folder,'state.json'));
 if(out.checkpoint.exists&&out.checkpoint.file&&out.checkpoint.mode==='600'){
  const s=JSON.parse(await readFile(path.join(folder,'state.json'),'utf8'));
  out.checkpoint.phase=phases.has(s.phase)?s.phase:'UNRECOGNIZED';
  out.checkpoint.releaseMatches=s.release===release;
 }
 const names=await readdir(folder);
 const recent=async regex=>(await Promise.all(names.filter(n=>regex.test(n)).map(async n=>({n,time:(await lstat(path.join(folder,n))).mtimeMs})))).sort((a,b)=>a.time-b.time).slice(-8).map(x=>x.n);
 for(const name of await recent(/^prepare-[a-f0-9-]{36}\.jsonl$/)){
  const f=path.join(folder,name),s=await info(f);if(s.unsafeSymlink||!s.file||s.bytes>1024*1024)continue;
  const rows=(await readFile(f,'utf8')).trim().split('\n').map(v=>{try{return JSON.parse(v);}catch{return{};}});
  out.attempts.push(...rows.filter(r=>steps.has(r.step)&&['STARTED','COMPLETED','FAILED'].includes(r.outcome)).map(r=>({step:r.step,outcome:r.outcome,...(r.failure?{failure:{category:categories.has(r.failure.category)?r.failure.category:'UNKNOWN',code:codes.has(r.failure.code)?r.failure.code:null,exitStatus:Number.isInteger(r.failure.exitStatus)?r.failure.exitStatus:null}}:{})})));
 }
 for(const name of await recent(/^(?:build\.log|build-[a-f0-9-]{36}\.log)$/)){
  const f=path.join(folder,name),s=await info(f);if(s.unsafeSymlink||!s.file)continue;
  const fd=await open(f,'r');let tail;try{const b=Buffer.alloc(Math.min(s.bytes,128*1024));await fd.read(b,0,b.length,Math.max(0,s.bytes-b.length));tail=b.toString();}finally{await fd.close();}
  out.buildLogs.push({legacy:name==='build.log',bytes:s.bytes,category:safeFailure({stderr:tail}).category,completedHint:/exporting to image|writing image sha256:|naming to .*done|FINISHED/i.test(tail)});
 }
 out.legacyBuildLogBlocksUnmodifiedRetry=!out.checkpoint.exists&&out.buildLogs.some(x=>x.legacy);
 out.lastRecordedFailure=out.attempts.filter(a=>a.outcome==='FAILED').at(-1)||null;
 return out;
}
const value=(c,k)=>(c?.Config?.Env||[]).find(v=>v.startsWith(k+'='))?.slice(k.length+1);
export const n8nReadProbe=`const out={healthStatus:null,workflowApiStatus:null,credentialsVerified:false,providerBalancesVerified:false,crmWriteReadVerified:false};for(const [key,url] of [['healthStatus','/healthz'],['workflowApiStatus','/api/v1/workflows?limit=1']]){try{const r=await fetch('http://127.0.0.1:5678'+url,{redirect:'error',signal:AbortSignal.timeout(5000)});out[key]=r.status;await r.body?.cancel();}catch{}}process.stdout.write(JSON.stringify(out));`;
export async function observeProduction({root='/opt/shadowbridge',release,execute}={}){
 const run=execute||((args)=>execFileSync('docker',['--context','default',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:4*1024**2}).trim());
 const result={kind:'shadowbridge-prepare-read-only-evidence',readOnly:true,changesMade:false,observedAt:new Date().toISOString(),...await checkpointEvidence({root,release})};
 const f=await statfs(root);result.freeBytes=f.bavail*f.bsize;
 const ids=run(['ps','-q','--filter','label=com.docker.compose.service=app']).split('\n').filter(x=>/^[a-f0-9]{12,64}$/.test(x));
 const apps=ids.map(id=>JSON.parse(run(['inspect',id]))[0]).filter(c=>c.Config?.Labels?.['com.docker.compose.project.working_dir']===root&&c.State?.Running);
 if(apps.length!==1){result.runtime={status:'UNIQUE_APP_NOT_FOUND'};return result;}
 const app=apps[0],project=app.Config.Labels['com.docker.compose.project'];
 if(!/^shadowbridge-(?:contabo|stageg)-[a-z0-9-]+$/.test(project))throw Error('Unrecognized project.');
 result.runtime={release:/^[a-f0-9]{40}$/.test(value(app,'RELEASE_SHA')||'')?value(app,'RELEASE_SHA'):null,createEnabled:value(app,'OWNER_BOOK_MCP_CREATE_ENABLED')==='true',mailMode:['disabled','allowlist','smtp','captured'].includes(value(app,'MAIL_DELIVERY_MODE'))?value(app,'MAIL_DELIVERY_MODE'):'UNVERIFIED',transactionalMailEnabled:value(app,'TRANSACTIONAL_MAIL_ENABLED')==='true',acquisitionGatewayConfigured:!!value(app,'ACQUISITION_GATEWAY_FILE')};
 result.buildImages={};for(const [target,tag]of [['runtime','shadowbridge-r1:'+release],['migrator',project+'-migrator']])try{const i=JSON.parse(run(['image','inspect',tag]))[0];result.buildImages[target]={found:true,revisionMatches:i.Config?.Labels?.['org.opencontainers.image.revision']===release};}catch{result.buildImages[target]={found:false};}
 try{const p=path.join(root,'.local','r1-owner-release-599fc3359ecd3d87868cb6056e35214c0baa3c00','state.json'),s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw Error('Unsafe saved acceptance.');const old=JSON.parse(await readFile(p,'utf8'));result.previousOAuth={accepted:old.release==='599fc3359ecd3d87868cb6056e35214c0baa3c00'&&old.purpose==='book-oauth'&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.ownerInteractiveAcceptance===true};if(typeof old.sourceDirectory!=='string'||!old.sourceDirectory.startsWith(path.join(root,'.local')+path.sep)||await realpath(old.sourceDirectory)!==old.sourceDirectory)throw Error('Unverified profile path.');const f=path.join(old.sourceDirectory,'international-r1',release,'plan.json');try{const stat=await lstat(f);result.applicationPlan={exists:stat.isFile()&&!stat.isSymbolicLink(),fingerprintsVerified:false};}catch(e){if(e.code!=='ENOENT')throw e;result.applicationPlan={exists:false};}}catch{result.applicationPlan={status:'UNVERIFIED'};}
 const service=name=>{const list=run(['ps','-q','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service='+name]).split('\n').filter(x=>/^[a-f0-9]{12,64}$/.test(x));if(list.length!==1)throw Error('Unique service required.');return list[0];};
 try{const auth=JSON.parse(run(['inspect',service('auth')]))[0];result.mail={signupDisabled:value(auth,'GOTRUE_DISABLE_SIGNUP')==='true',smtpHostIsGmail:value(auth,'GOTRUE_SMTP_HOST')==='smtp.gmail.com',smtpCredentialPresent:!!value(auth,'GOTRUE_SMTP_PASS'),confirmationPathCorrect:value(auth,'GOTRUE_MAILER_URLPATHS_CONFIRMATION')==='/auth/confirm',recoveryPathCorrect:value(auth,'GOTRUE_MAILER_URLPATHS_RECOVERY')==='/auth/recover',siteUrlCorrect:value(auth,'GOTRUE_SITE_URL')==='https://shadow-bridge.eu',deliveryTested:false};}catch(e){result.mail={status:'UNVERIFIED',failure:safeFailure(e)};}
 try{
  const sql="BEGIN READ ONLY;SELECT json_build_object('migrationCount',(SELECT count(*) FROM shadowbridge_migrations.applied),'recentMfaEventCount',(SELECT count(*) FROM sb.audit_events WHERE action='auth.mfa_verified' AND created_at>now()-interval '30 minutes'));ROLLBACK;";
  result.database=JSON.parse(run(['exec',service('postgres'),'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',sql]));
 }catch(e){result.database={status:'READ_FAILED',failure:safeFailure(e)};}
 try{result.n8n=JSON.parse(run(['exec','shadowbridge-automation-n8n-1','node','--input-type=module','-e',n8nReadProbe]));}catch(e){result.n8n={status:'UNVERIFIED',failure:safeFailure(e)};}
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 (async()=>{if(hostname()!=='vmi3682957'||process.geteuid?.()!==0||process.env.SUDO_USER!=='shadowadmin'||await realpath('/opt/shadowbridge')!=='/opt/shadowbridge')throw Error('Run via shadowadmin sudo on existing Contabo.');
 const a=process.argv.slice(2);if(a.length!==1||!a[0].startsWith('--release='))throw Error('Explicit release required.');console.log(JSON.stringify(await observeProduction({release:a[0].slice(10)}),null,2));
 })().catch(e=>{console.error(JSON.stringify({status:'READ_ONLY_DIAGNOSTIC_INCOMPLETE',failure:safeFailure(e),changesMade:false}));process.exitCode=1;});
}
