// Standalone metadata-only diagnostic. No prepare/apply, writes, locks or chmod.
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const expectedOperator='53cc1ae500f55f2386d913731e3e73679b856069';
export const acceptedBase='80f4a0d333d31a6d57ada714b0df17bc0584a07b';
export const targetRelease='e871f2e09c25dc79f5222fa738ac446a103f1edc';
const hash=b=>createHash('sha256').update(b).digest('hex');
const safeSha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:null;
const safeImage=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v)?v:null;
const phases=new Set(['PLANNED','BACKUPS_VERIFIED_WAITING_OFFSITE','SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED','ROLLED_BACK_APPLICATION_ONLY']);
const privateNames=['compose.env','postgres.env','auth.env','app.env','migration.env','tester-password','Caddyfile','manifest.json',...['internal-ca.crt','internal-ca.key','postgres.crt','postgres.key','auth-proxy.crt','auth-proxy.key','public.crt','public.key'].map(n=>'certs/'+n)];
const knownArtifacts=['state.json','operation.lock','runtime-build.log','application.json','rollback.json','database.private.dump','database.sbb','database.key','configuration.private.tar','configuration.sbb','configuration.key','certificates.private.tar','certificates.sbb','certificates.key'];
const run=(bin,args)=>{try{return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:2*1024**2}).trim();}catch{return null;}};
function accountName(kind,id){const s=run('getent',[kind,String(id)]);const name=s?.split(':')[0];return /^[A-Za-z0-9_.-]{1,64}$/.test(name||'')?name:null;}
async function safePath(repo,file,allowLeafSymlink=false){
 if(typeof file!=='string'||file.length>4096||/[\x00-\x1f\x7f]/.test(file)||!file.startsWith(repo+'/.local/')||path.normalize(file)!==file)return false;
 let p=file;
 while(p!==repo){try{if((await lstat(p)).isSymbolicLink()&&!(allowLeafSymlink&&p===file))return false;}catch(e){if(e.code!=='ENOENT')return false;}p=path.dirname(p);}
 return true;
}
export async function metadata(repo,file,{type='file',mode='0600',establishedMode=mode,context=''}={}){
 const output={path:file,context,expectedType:type,installerExpectedMode:mode,establishedExpectedMode:establishedMode};
 if(!await safePath(repo,file,true))return{...output,safePath:false,readRefused:true};
 try{const s=await lstat(file),actualType=s.isFile()?'file':s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'other',actualMode=(s.mode&0o7777).toString(8).padStart(4,'0');
  return{...output,exists:true,safePath:!s.isSymbolicLink(),readRefused:s.isSymbolicLink(),actualType,actualMode,uid:s.uid,gid:s.gid,owner:accountName('passwd',s.uid),group:accountName('group',s.gid),bytes:s.size,modifiedAt:s.mtime.toISOString(),installerMatches:actualType===type&&(s.mode&0o777)===parseInt(mode,8),establishedPolicyMatches:actualType===type&&(s.mode&0o777)===parseInt(establishedMode,8)};
 }catch(e){return{...output,safePath:true,exists:false,error:e.code==='ENOENT'?'MISSING':'METADATA_UNAVAILABLE'};}
}
async function privateJson(repo,file){
 if(!await safePath(repo,file))return null;
 try{const s=await lstat(file);if(!s.isFile()||s.size>1024**2)return null;return JSON.parse(await readFile(file,'utf8'));}catch{return null;}
}
export function checkpointSummary(s){
 if(!s||typeof s!=='object'||Array.isArray(s))return{jsonReadable:false};
 return{jsonReadable:true,phase:phases.has(s.phase)?s.phase:'UNKNOWN',purpose:['book-write','book-create','book-oauth','book-api'].includes(s.purpose)?s.purpose:null,release:safeSha(s.release),installerRelease:safeSha(s.installerRelease),previousRelease:safeSha(s.previousRelease),image:safeImage(s.image),previousImage:safeImage(s.previousImage),schemaChanged:typeof s.schemaChanged==='boolean'?s.schemaChanged:null,ownerInteractiveAcceptance:s.ownerInteractiveAcceptance===true,configHashCount:s.configHashes&&typeof s.configHashes==='object'?Object.keys(s.configHashes).length:0,backupPairCount:s.backups&&typeof s.backups==='object'?Object.keys(s.backups).length:0,hasBundleManifestHash:/^[a-f0-9]{64}$/.test(s.bundleManifestSha||''),hasAppContinuityHash:/^[a-f0-9]{64}$/.test(s.appEnvironmentHash||'')};
}
export function appRuntimeSummary(c){
 const release=c.Config?.Env?.find(v=>v.startsWith('RELEASE_SHA='))?.slice(12);
 return{id:/^[a-f0-9]{64}$/.test(c.Id||'')?c.Id:null,image:safeImage(c.Image),running:c.State?.Running===true,release:safeSha(release),startedAt:/^[0-9T:.Z-]{20,35}$/.test(c.State?.StartedAt||'')?c.State.StartedAt:null};
}
export async function collectFileEvidence(repo){
 const folder=path.join(repo,'.local','r1-owner-release-'+targetRelease),baseFile=path.join(repo,'.local','r1-owner-release-'+acceptedBase,'state.json'),stateFile=path.join(folder,'state.json');
 const checks=[await metadata(repo,folder,{type:'directory',mode:'0700',context:'initial privatePath(folder,true)'}),await metadata(repo,baseFile,{context:'read accepted base checkpoint'}),await metadata(repo,stateFile,{context:'load existing target checkpoint; absent is allowed for first prepare'})];
 const base=await privateJson(repo,baseFile),state=await privateJson(repo,stateFile);
 const source=typeof base?.sourceDirectory==='string'&&await safePath(repo,base.sourceDirectory)?base.sourceDirectory:null;
 if(source){for(const name of privateNames)checks.push(await metadata(repo,path.join(source,name),{establishedMode:name==='certs/internal-ca.crt'?'0644':'0600',context:'build source configuration loop in original installer'}));}
 if(state?.configHashes&&typeof state.configHashes==='object')for(const file of Object.keys(state.configHashes).slice(0,500)){if(await safePath(repo,file))checks.push(await metadata(repo,file,{mode:file.endsWith('.sh')?'0700':'0600',establishedMode:source&&file===path.join(source,'certs','internal-ca.crt')?'0644':file.endsWith('.sh')?'0700':'0600',context:'check(configHashes) in original installer'}));}
 if(state?.backups&&typeof state.backups==='object')for(const pair of Object.values(state.backups))for(const field of ['backupFile','keyFile'])if(await safePath(repo,pair?.[field]))checks.push(await metadata(repo,pair[field],{context:'encrypted backup path metadata only'}));
 const artifacts=[];
 for(const name of knownArtifacts)artifacts.push(await metadata(repo,path.join(folder,name),{context:'artifact existence only; no contents displayed'}));
 try{for(const name of await readdir(folder))if(/^certificates\.scratch-[a-f0-9-]{36}$/.test(name))artifacts.push(await metadata(repo,path.join(folder,name),{type:'directory',mode:'0700',context:'partial certificate copy directory; contents not read'}));}catch{}
 const overlay=await privateJson(repo,path.join(folder,'application.json')),overlayImage=safeImage(overlay?.services?.app?.image);
 const sourceManifest=source?await privateJson(repo,path.join(source,'manifest.json')):null;
 const project=/^shadowbridge-(?:contabo|stageg)-[a-z0-9-]{3,60}$/.test(sourceManifest?.project||'')?sourceManifest.project:null;
 const mismatches=checks.filter(v=>v.exists&&v.installerMatches===false);
 return{checks,artifacts,checkpoint:checkpointSummary(state),acceptedCheckpoint:checkpointSummary(base),sourceDirectory:source,project,overlayImage,originalInstallerMismatches:mismatches,firstObservedMismatch:mismatches[0]||null,publicCaExpectationConflict:!!source&&checks.some(c=>c.path===path.join(source,'certs','internal-ca.crt')&&c.establishedPolicyMatches===true&&c.installerMatches===false),privateFileContentsDisplayed:false};
}
async function runtimeEvidence(repo,project){
 const docker=args=>run('docker',['--context','default',...args]);
 let endpoint;try{endpoint=JSON.parse(docker(['context','inspect','default','--format','{{json .Endpoints.docker}}'])||'null');}catch{}
 if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint?.Host))return{status:'LOCAL_DOCKER_NOT_PROVEN'};
 const ids=(docker(['ps','-q','--no-trunc','--filter','label=com.docker.compose.service=app'])||'').split('\n').filter(v=>/^[a-f0-9]{64}$/.test(v));
 let all=[];try{all=ids.length?JSON.parse(docker(['inspect',...ids])||'[]'):[];}catch{}
 const candidates=all.filter(c=>project?c.Config?.Labels?.['com.docker.compose.project']===project:c.Config?.Labels?.['com.docker.compose.project.working_dir']===repo);
 const output={runningAppCandidates:candidates.length};
 if(candidates.length===1){const c=candidates[0];output.app=appRuntimeSummary(c);
  try{const image=JSON.parse(docker(['image','inspect',c.Image]));output.app.imageRevision=safeSha(image[0]?.Config?.Labels?.['org.opencontainers.image.revision']);}catch{}
  const pgIds=(docker(['ps','-q','--no-trunc','--filter','label=com.docker.compose.service=postgres','--filter','label=com.docker.compose.project='+c.Config.Labels['com.docker.compose.project']])||'').split('\n').filter(v=>/^[a-f0-9]{64}$/.test(v));
  if(pgIds.length===1){
   const value=docker(['exec',pgIds[0],'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',"BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT coalesce(json_agg(json_build_object('name',name,'sha256',sha256) ORDER BY name),'[]'::json) FROM shadowbridge_migrations.applied;ROLLBACK;"]);
   try{const rows=JSON.parse(value);const valid=Array.isArray(rows)&&rows.every(r=>/^[0-9]{12}_[a-z0-9_]+\.sql$/.test(r.name)&&/^[a-f0-9]{64}$/.test(r.sha256));
    if(valid){output.ledger={count:rows.length,readOnlyTransaction:true,hashesMatchAcceptedBase:rows.every(r=>{try{const b=execFileSync('git',['-c','safe.directory='+repo,'-C',repo,'show',acceptedBase+':supabase/migrations/'+r.name],{stdio:['ignore','pipe','pipe'],maxBuffer:1024**2});return hash(b)===r.sha256;}catch{return false;}})};}
   }catch{output.ledger={status:'READ_UNAVAILABLE'};}
  }
 }
 try{const image=JSON.parse(docker(['image','inspect','shadowbridge-oauth-fix:'+targetRelease])||'null');output.targetImageArtifact={exists:true,image:safeImage(image[0]?.Id),revision:safeSha(image[0]?.Config?.Labels?.['org.opencontainers.image.revision'])};}catch{output.targetImageArtifact={exists:false};}
 return output;
}
async function publicHealth(){
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return{status:'INSECURE_TLS_ENV_REFUSED'};
 try{const r=await fetch('https://shadow-bridge.eu/health',{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});const d=await r.json();return{status:r.status,tlsVerificationEnabled:true,ok:d.ok===true,release:safeSha(r.headers.get('x-shadowbridge-release'))||safeSha(d.release)};}catch{return{status:'HTTPS_READ_UNAVAILABLE'};}
}
export async function mainServerReadOnly(){
 const repo='/opt/shadowbridge';
 if(process.geteuid?.()!==0||hostname()!=='vmi3682957'||await realpath(repo)!==repo)throw Error('READ_ONLY_DIAGNOSTIC_WRONG_HOST_OR_USER');
 const files=await collectFileEvidence(repo),git=args=>run('git',['-c','safe.directory='+repo,'-C',repo,...args]);
 const runtime=await runtimeEvidence(repo,files.project),health=await publicHealth(),head=safeSha(git(['rev-parse','HEAD']));
 const result={kind:'shadowbridge-app-only-permissions-read-only-evidence',readOnly:true,changesMade:false,observedAt:new Date().toISOString(),expectedOperator,repository:{head,matchesExpectedOperator:head===expectedOperator,branch:git(['branch','--show-current'])==='release/shadowbridge-international-r1'?'release/shadowbridge-international-r1':'OTHER_OR_UNAVAILABLE',clean:git(['status','--porcelain'])===''},...files,runtime,health};
 try{const current=await readFile(path.join(repo,'scripts/book-oauth-app-only.mjs')),expected=git(['show',expectedOperator+':scripts/book-oauth-app-only.mjs']);result.repository.coordinatorMatchesExpectedOperator=typeof expected==='string'&&current.toString().trim()===expected;}catch{result.repository.coordinatorMatchesExpectedOperator=null;}
 result.checkedPathCount=files.checks.length;
 result.checks=files.checks.filter(c=>!c.exists||c.installerMatches===false||/checkpoint|initial privatePath/.test(c.context)||files.sourceDirectory&&['internal-ca.crt','internal-ca.key'].some(n=>c.path===path.join(files.sourceDirectory,'certs',n)));
 result.artifacts=files.artifacts.filter(a=>a.exists);result.missingArtifactCount=files.artifacts.filter(a=>!a.exists).length;
 result.ownershipPolicy='Original installer does not enforce a UID/GID. Numeric UID/GID are reported; no ownership repair is inferred.';
 result.productionReleaseAgreement=!!runtime.app?.release&&runtime.app.release===health.release;
 result.runningAcceptedBaseConfirmed=result.productionReleaseAgreement&&health.status===200&&runtime.app.release===acceptedBase&&runtime.app.imageRevision===acceptedBase&&runtime.app.image===files.acceptedCheckpoint.image;
 result.runningTargetConfirmed=result.productionReleaseAgreement&&health.status===200&&runtime.app.release===targetRelease&&runtime.app.imageRevision===targetRelease;
 result.targetImageMatchesOverlay=!!files.overlayImage&&runtime.targetImageArtifact?.image===files.overlayImage&&runtime.targetImageArtifact?.revision===targetRelease;
 result.resumeAuthorized=false;
 console.log(JSON.stringify(result,null,2));
}
function runOverExistingSsh(){
 if(!process.stdin.isTTY)throw Error('Use an interactive OWNER terminal for existing SSH/sudo; never pipe a password.');
 const self=fileURLToPath(import.meta.url);
 return readFile(self,'utf8').then(source=>{
  const program=source+'\ntry{await mainServerReadOnly();}catch{console.log(JSON.stringify({status:"READ_ONLY_DIAGNOSTIC_UNAVAILABLE",readOnly:true,changesMade:false}));process.exitCode=1;}\n',quoted="'"+program.replaceAll("'","'\\''")+"'";
  const r=spawnSync('ssh',['-t','-o','StrictHostKeyChecking=yes','shadowadmin@169.58.232.69','sudo node --input-type=module -e '+quoted],{stdio:'inherit'});
  if(r.error||r.status!==0)throw Error('READ_ONLY_SSH_DIAGNOSTIC_NOT_COMPLETED; no updater was invoked.');
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=='--ssh')throw Error('Use --ssh on OWNER Pop!_OS. No installer is run.');
 runOverExistingSsh().catch(()=>{console.error('READ_ONLY_DIAGNOSTIC_UNAVAILABLE; no production update claimed.');process.exitCode=1;});
}
