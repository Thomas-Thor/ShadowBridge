// Standalone READ ONLY inventory. No updater imports, writes, cleanup or auth minting.
import {lstat,readFile,readdir,realpath,statfs} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import http from 'node:http';import {hostname} from 'node:os';
import path from 'node:path';import {fileURLToPath} from 'node:url';
export const acceptedBase='80f4a0d333d31a6d57ada714b0df17bc0584a07b';
export const attempted='e871f2e09c25dc79f5222fa738ac446a103f1edc';
const repo='/opt/shadowbridge',MiB=1024**2;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)?v:null;
const imageId=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v)?v:null;
const phases=new Set(['PLANNED','RECOVERY_VALIDATED','BACKUPS_IN_PROGRESS','BACKUPS_VERIFIED_WAITING_OFFSITE','SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED','ROLLED_BACK_APPLICATION_ONLY','MIGRATING','SCHEMA_VERIFIED','APP_STARTING','WRITE_DISABLED','API_DISABLED','CANCELLED_BEFORE_MIGRATION']);
const run=(bin,args,timeout=15000)=>{try{return execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:8*MiB}).trim();}catch{return null;}};
const docker=args=>run('docker',['--context','default',...args]);
const json=v=>{try{return JSON.parse(v);}catch{return null;}};
const inside=(root,p)=>typeof p==='string'&&p.length<4096&&!/[\x00-\x1f\x7f]/.test(p)&&path.normalize(p)===p&&(p===root||p.startsWith(root+path.sep));
async function noLinks(p,root){if(!inside(root,p))return false;for(let q=p;;q=path.dirname(q)){try{if((await lstat(q)).isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')return false;}if(q===root)return true;}}
async function readJson(p,root=repo+'/.local'){if(!await noLinks(p,root))return null;try{const s=await lstat(p);return s.isFile()&&s.size<=MiB?json(await readFile(p,'utf8')):null;}catch{return null;}}
export async function fileInfo(p){try{const s=await lstat(p);return{path:p,exists:true,type:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':s.isFile()?'file':'other',mode:(s.mode&0o7777).toString(8).padStart(4,'0'),uid:s.uid,gid:s.gid,apparentBytes:s.size,allocatedBytes:s.blocks*512,modifiedAt:s.mtime.toISOString()};}catch(e){return{path:p,exists:e.code==='ENOENT'?false:null,status:e.code==='ENOENT'?'ABSENT':'METADATA_UNAVAILABLE'};}}
async function treeSize(p){const s=await fileInfo(p);if(!s.exists)return s;if(s.type!=='directory')return s;const a=run('du',['--summarize','--one-file-system','--block-size=1','--',p]),b=run('du',['--summarize','--one-file-system','--apparent-size','--block-size=1','--',p]);return{...s,allocatedBytes:a&&/^\d+\s/.test(a)?Number(a.split(/\s/)[0]):null,apparentBytes:b&&/^\d+\s/.test(b)?Number(b.split(/\s/)[0]):null,sizeComplete:a!==null&&b!==null};}
export function checkpointSummary(s){return !s?{readable:false}:{readable:true,phase:phases.has(s.phase)?s.phase:'UNKNOWN',release:sha(s.release),operator:sha(s.installerRelease),image:imageId(s.image),previousImage:imageId(s.previousImage),migratorImage:imageId(s.migratorImage),schemaChanged:typeof s.schemaChanged==='boolean'?s.schemaChanged:null,ownerAccepted:s.ownerInteractiveAcceptance===true,backupPairs:s.backups&&typeof s.backups==='object'?Object.keys(s.backups).length:0,backupStages:Object.fromEntries(Object.entries(s.backupStages||{}).filter(([k])=>['database','configuration','certificates'].includes(k)).map(([k,v])=>[k,['CREATING','VERIFIED'].includes(v?.phase)?v.phase:'UNKNOWN'])),originRecorded:!!s.recoveryOrigin,bundleRecorded:typeof s.bundle==='string',offsiteCurrentlyAuthenticated:false};}

export async function lockEvidence(p,{proc='/proc'}={}){
 const info=await fileInfo(p);if(info.exists===false)return{...info,status:'ABSENT',blocksKnownReleaseGate:false};
 const out={...info,status:'UNVERIFIED',blocksKnownReleaseGate:/\/r1-owner-release-[a-f0-9]{40}\/operation\.lock$/.test(p),removalAuthorized:false};
 if(info.type!=='file'||info.apparentBytes>32)return out;
 let text;try{text=(await readFile(p,'utf8')).trim();}catch{return out;}
 if(!/^[1-9][0-9]{0,8}$/.test(text))return{...out,status:'INVALID_CONTENT_NOT_DISPLAYED'};
 const pid=Number(text);out.pid=pid;
 try{const stat=await readFile(path.join(proc,String(pid),'stat'),'utf8'),at=stat.lastIndexOf(')'),tail=stat.slice(at+2).split(' '),startTicks=Number(tail[19]);out.processState=/^[A-Z]$/.test(tail[0])?tail[0]:null;
  const comm=stat.slice(stat.indexOf('(')+1,at);out.processKind=['node','sudo','sh','bash','docker','dockerd'].includes(comm)?comm:'OTHER';
  try{out.cwdIsRepository=await realpath(path.join(proc,String(pid),'cwd'))===repo;}catch{out.cwdIsRepository=null;}
  const hz=Number(run('getconf',['CLK_TCK'])),uptime=Number((await readFile(path.join(proc,'uptime'),'utf8')).split(' ')[0]);
  if(hz>0&&Number.isFinite(startTicks)&&Number.isFinite(uptime)){const startMs=Date.now()-uptime*1000+startTicks/hz*1000;out.processStartedAfterLock=startMs>new Date(info.modifiedAt).getTime()+2000;}
  out.status=out.processStartedAfterLock?'PID_REUSED_OR_UNCERTAIN':out.processState==='Z'?'ZOMBIE_REVIEW_REQUIRED':'LIVE_PROCESS_POSSIBLE';
 }catch(e){out.status=e.code==='ENOENT'?'NO_PROCESS_STALE_CANDIDATE':'PROCESS_READ_UNAVAILABLE';}
 return out;
}
export function summarizeContainer(c){
 const label=c.Config?.Labels||{},name=typeof c.Name==='string'?c.Name.replace(/^\//,''):null;
 return{id:c.Id,image:imageId(c.Image),name,service:label['com.docker.compose.service']||null,project:label['com.docker.compose.project']||null,running:c.State?.Running===true,status:c.State?.Status||null,health:c.State?.Health?.Status||null,startedAt:c.State?.StartedAt||null,revision:sha(label['org.opencontainers.image.revision']),networks:Object.keys(c.NetworkSettings?.Networks||{}),configFiles:(label['com.docker.compose.project.config_files']||'').split(',').filter(p=>inside(repo,p)),bindSources:(c.Mounts||[]).filter(m=>m.Type==='bind').map(m=>m.Source).filter(p=>inside(repo,p)),volumes:(c.Mounts||[]).filter(m=>m.Type==='volume').map(m=>m.Name),ports:Object.entries(c.HostConfig?.PortBindings||{}).flatMap(([port,values])=>(values||[]).map(v=>({port,hostIp:v.HostIp,hostPort:v.HostPort}))),technicalImageReader:label['shadowbridge.operator-purpose']==='oauth-recovery-image-read',mountCount:(c.Mounts||[]).length,writableLayerBytes:Number.isFinite(c.SizeRw)?c.SizeRw:null};
}
const row=(decision,kind,id,bytes,risk,reason,extra={})=>({decision,kind,id,bytes,risk,reason,actionNow:'NONE',requiresSeparateOwnerApproval:true,...extra});
export function classifyContainer(c){return c.technicalImageReader&&!c.running&&c.mountCount===0&&c.status==='created'?row('DELETE','container',c.id,c.writableLayerBytes,'LOW','Unstarted operator-only image reader without mounts; candidate only after explicit approval.',{image:c.image}):row('KEEP','container',c.id,c.writableLayerBytes,'HIGH','Running or nontechnical/historical container; preserve service and data dependencies.',{name:c.name,image:c.image});}
export function guardCandidates(table,complete){return table.map(r=>!complete&&r.decision!=='KEEP'?{...r,originalCandidateDecision:r.decision,decision:'KEEP',reason:'Incomplete dependency inventory: preserve until the missing evidence is obtained.'}:r);}
export function classifyImage(i,{containers=[],keepImages=new Set(),attemptImages=new Set(),checkpointRefs=[]}={}){
 const refs=containers.filter(c=>c.image===i.Id),running=refs.filter(c=>c.running),unique=Number.isFinite(i.SharedSize)&&i.SharedSize>=0?Math.max(0,i.Size-i.SharedSize):null;
 const extra={sizeMeaning:'virtual image bytes; not guaranteed reclaim',sharedBytes:i.SharedSize>=0?i.SharedSize:null,estimatedUniqueBytes:unique,guaranteedReclaimBytes:null,containerReferences:refs.map(c=>c.id),checkpointReferences:checkpointRefs};
 if(running.length||keepImages.has(i.Id))return row('KEEP','image',i.Id,i.Size,'HIGH','Active runtime or accepted rollback/recovery image.',extra);
 if(attemptImages.has(i.Id))return row('ARCHIVE','image',i.Id,i.Size,'MEDIUM','Attempt-only image: preserve provenance/checkpoints and an independently verified OCI archive before considering exact-image deletion.',{...extra,prerequisites:['No running consumer','Resolve stopped-container references','Preserve checkpoint/image dependency manifest','Verify archive and restore strategy']});
 return row('KEEP','image',i.Id,i.Size,'HIGH','Outside the abandoned-attempt scope or dependency unresolved; no global prune.',extra);
}
export function classifyRoot(p,{liveReferences=[],lock,phase,attemptRoot=false,bytes}={}){
 const live=liveReferences.filter(f=>inside(p,f));
 if(live.length)return row('KEEP','directory',p,bytes,'HIGH','Still referenced by running Compose configuration or bind mounts; moving it would break administration/recovery.',{liveReferences:live});
 if(lock?.exists!==false&&lock)return row('KEEP','directory',p,bytes,'HIGH','Contains a release-gate lock; its process and checkpoint dependency must be resolved first.');
 if(['SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','MIGRATING','APP_STARTING'].includes(phase))return row('KEEP','directory',p,bytes,'HIGH','Unfinished transition requires reconciliation with the active image, not cleanup.');
 return attemptRoot?row('ARCHIVE','directory',p,bytes,'HIGH','Abandoned attempt history candidate, only after encrypted/offsite archive verification and a path/reference migration plan.'):row('KEEP','directory',p,bytes,'HIGH','Accepted/historical recovery material; retention/dependency review required.');
}

async function engineGet(socket,p){return new Promise(resolve=>{let done=false;const finish=v=>{if(!done){done=true;resolve(v);}};const req=http.get({socketPath:socket,path:p},res=>{let text='',bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>32*MiB){req.destroy();finish(null);}else text+=b;});res.on('end',()=>finish(res.statusCode===200?json(text):null));res.on('error',()=>finish(null));});req.setTimeout(20000,()=>{req.destroy();finish(null);});req.on('error',()=>finish(null));});}
async function diskInfo(p){try{const [s,f]=await Promise.all([lstat(p),statfs(p)]);return{path:p,device:s.dev,totalBytes:f.blocks*f.bsize,availableBytes:f.bavail*f.bsize,freeBytes:f.bfree*f.bsize,freeInodes:f.ffree};}catch{return{path:p,status:'UNAVAILABLE'};}}
async function httpProbe(route,{html=false}={}){
 if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return{status:'INSECURE_TLS_REFUSED'};
 try{const r=await fetch(route,{headers:{Accept:html?'text/html':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)}),type=r.headers.get('content-type')||'';let body=null;if(!html&&type.includes('json'))body=await r.json();else await r.body?.cancel();return{url:route,status:r.status,tlsVerificationEnabled:true,revision:sha(r.headers.get('x-shadowbridge-release'))||sha(body?.release),ok:body?.ok===true||body?.status==='ok',html:html?/^text\/html(?:;|$)/i.test(type):undefined,location:html&&r.headers.get('location')==='/member-sign-in/'?'/member-sign-in/':undefined};}catch{return{url:route,status:'HTTPS_UNAVAILABLE'};}
}
async function directoryArtifacts(root){
 const results=[];async function walk(p,depth){if(depth>4||results.length>=100||(await fileInfo(p)).type!=='directory')return;let names;try{names=await readdir(p);}catch{return;}
  for(const n of names){if(results.length>=100)break;const file=path.join(p,n),s=await fileInfo(file);if(s.type==='symlink')continue;
   if(s.type==='directory'){if(['recovery'].includes(n)||/^certificates\.scratch-[a-f0-9-]{36}$/.test(n)){results.push(await treeSize(file));if(n==='recovery')await walk(file,depth+1);}continue;}
   if(/^(state|recovery-state|origin|application|rollback|manifest|offsite-receipt)\.json$|^operation\.lock$|^runtime-build\.log$|\.(sbb|key)$|^\.?verify-[a-f0-9-]+\.(dump|tar)$|\.private\.(dump|tar)$|^image-read-[a-f0-9-]+\.tar$/.test(n))results.push(s);
  }}await walk(root,0);return{files:results,possiblyTruncated:results.length>=100};
}

export function safeWorktree(output){if(output===null)return{status:'UNAVAILABLE'};const lines=output?output.split('\n'):[];return{trackedClean:lines.every(l=>l.startsWith('??')),untrackedCount:lines.filter(l=>l.startsWith('??')).length,changedTrackedCount:lines.filter(l=>!l.startsWith('??')).length};}

export async function collectAudit(){
 if(process.geteuid?.()!==0||hostname()!=='vmi3682957'||await realpath(repo)!==repo)throw Error('Wrong audit host/user/path.');
 const endpoint=json(docker(['context','inspect','default','--format','{{json .Endpoints.docker}}']));if(!['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(endpoint?.Host))throw Error('Local Docker context not proven.');
 const socket=endpoint.Host.slice(7),info=await engineGet(socket,'/info'),version=await engineGet(socket,'/version');if(!version?.ApiVersion)throw Error('Docker API unavailable.');
 if(!/^1\.[0-9]{1,3}$/.test(version.ApiVersion))throw Error('Unexpected Docker API version.');
 const prefix='/v'+version.ApiVersion,listed=await engineGet(socket,prefix+'/containers/json?all=true');if(!Array.isArray(listed))throw Error('Container inventory unavailable.');
 const raw=[];for(const c of listed){const v=await engineGet(socket,prefix+'/containers/'+c.Id+'/json?size=true');if(v)raw.push(v);}
 const containers=raw.map(summarizeContainer),liveReferences=containers.filter(c=>c.running).flatMap(c=>[...c.configFiles,...c.bindSources]);
 const engineDf=await engineGet(socket,prefix+'/system/df');
 const images=engineDf?.Images||((await engineGet(socket,prefix+'/images/json?all=true'))||[]),imageRevisions=new Map();
 for(const i of images){const v=await engineGet(socket,prefix+'/images/'+i.Id+'/json');imageRevisions.set(i.Id,sha(v?.Config?.Labels?.['org.opencontainers.image.revision']));}
 const releaseRoots=[];let rootsComplete=true;try{for(const n of await readdir(repo+'/.local'))if(/^r1-owner-release-[a-f0-9]{40}$/.test(n)){const p=path.join(repo,'.local',n);if(await noLinks(p,repo+'/.local')&&(await fileInfo(p)).type==='directory')releaseRoots.push(p);else rootsComplete=false;}}catch{rootsComplete=false;}
 const checkpoints=[],keepImages=new Set(containers.filter(c=>c.running).map(c=>c.image)),attemptImages=new Set(),imageRefs=new Map(),sourceDirs=new Set(),table=[],targetRoot=path.join(repo,'.local','r1-owner-release-'+attempted);
 for(const root of releaseRoots){const lock=await lockEvidence(path.join(root,'operation.lock')),states=[];
  for(const name of ['state.json','recovery-state.json']){const file=path.join(root,name),s=await readJson(file);states.push({file,metadata:await fileInfo(file),summary:checkpointSummary(s)});
   if(!s){if(states.at(-1).metadata.exists!==false)rootsComplete=false;continue;}
 if(inside(repo+'/.local',s.sourceDirectory))sourceDirs.add(s.sourceDirectory);
   for(const [key,id]of Object.entries({image:s.image,previousImage:s.previousImage,migratorImage:s.migratorImage})){if(!imageId(id))continue;const refs=imageRefs.get(id)||[];refs.push({checkpoint:file,field:key});imageRefs.set(id,refs);if(root===targetRoot&&key==='image')attemptImages.add(id);else keepImages.add(id);}
   const backups=[];for(const [kind,pair]of Object.entries(s.backups||{})){if(!['database','configuration','certificates'].includes(kind))continue;for(const k of ['backupFile','keyFile'])if(inside(repo+'/.local',pair?.[k]))backups.push({kind,part:k,metadata:await fileInfo(pair[k]),authenticatedThisAudit:false});}
   states.at(-1).backups=backups;
   if(typeof s.bundle==='string'&&/^\/home\/shadowadmin\/\.shadowbridge-(?:r1-|oauth-app-only-|oauth-recovery-)[a-f0-9]{40}$/.test(s.bundle))states.at(-1).transferFolder=s.bundle;
  }
  const size=await treeSize(root),phase=states.find(v=>v.file.endsWith('/recovery-state.json')&&v.summary.readable)?.summary.phase||states[0]?.summary.phase;
  table.push(classifyRoot(root,{liveReferences,lock,phase,attemptRoot:root===targetRoot,bytes:size.allocatedBytes}));
  checkpoints.push({root,size,lock,states,artifacts:root===targetRoot?await directoryArtifacts(root):undefined});
 }
 for(const root of checkpoints){for(const name of ['application.json','rollback.json']){const file=path.join(root.root,name),v=await readJson(file),id=imageId(v?.services?.app?.image);if(id){const refs=imageRefs.get(id)||[];refs.push({checkpoint:file,field:'overlay.image'});imageRefs.set(id,refs);if(root.root===targetRoot&&name==='application.json')attemptImages.add(id);else keepImages.add(id);}}}
 for(const i of images)if(imageRevisions.get(i.Id)===attempted)attemptImages.add(i.Id);
 const app=containers.filter(c=>c.running&&c.service==='app'&&(c.configFiles.some(p=>inside(repo,p))));
 const project=app.length===1?app[0].project:null;
 // Bind-mounted sources and all profile/accepted-plan references remain KEEP.
 for(const p of sourceDirs)table.push(row('KEEP','installation',p,null,'HIGH','Contains live profile/secrets, plan chain and recovery backups; no whole-directory relocation.'));
 for(const i of images)table.push({...classifyImage(i,{containers,keepImages,attemptImages,checkpointRefs:imageRefs.get(i.Id)||[]}),revision:imageRevisions.get(i.Id)});
 for(const c of containers)table.push(classifyContainer(c));
 for(const v of engineDf?.Volumes||[]){const refs=containers.filter(c=>c.volumes.includes(v.Name)).map(c=>c.id);table.push(row('KEEP','volume',v.Name,v.UsageData?.Size??null,'HIGH','Potential persistent database/auth/n8n/certificate data; never prune or remove in this audit.',{containerReferences:refs,engineRefCount:v.UsageData?.RefCount??null}));}
 const transfers=new Set(checkpoints.flatMap(c=>c.states.map(s=>s.transferFolder).filter(Boolean)));
 for(const p of ['/home/shadowadmin/.shadowbridge-oauth-app-only-'+attempted,'/home/shadowadmin/.shadowbridge-oauth-recovery-'+attempted])if((await fileInfo(p)).exists)transfers.add(p);
 const transferRows=[];for(const p of transfers){if(!await noLinks(p,'/home/shadowadmin'))continue;const size=await treeSize(p),candidate=p.endsWith(attempted);table.push(row(candidate?'ARCHIVE':'KEEP','transfer-directory',p,size.allocatedBytes,'HIGH',candidate?'Attempt backup transfer copy; archive with its canonical backup/key/receipt dependencies before any deletion.':'Historical recovery/transfer material; no retention approval yet.'));transferRows.push({size,artifacts:await directoryArtifacts(p)});}
 for(const artifact of checkpoints.find(c=>c.root===targetRoot)?.artifacts?.files||[]){if(artifact.path.endsWith('/operation.lock'))continue;const log=artifact.path.endsWith('.log');table.push(row(log?'ARCHIVE':'KEEP','file',artifact.path,artifact.allocatedBytes,log?'MEDIUM':'HIGH',log?'Attempt build log: preserve securely with history; contents not inspected.':'Checkpoint/overlay/backup/key/plaintext evidence; preserve and archive only as a verified dependency bundle.',{includedInDirectoryTotal:targetRoot,fileType:artifact.type,mode:artifact.mode}));}
 for(const c of checkpoints)if(c.lock.exists)table.push(row('KEEP','lock',c.lock.path,c.lock.allocatedBytes,'HIGH','Never delete an operation lock solely because its PID is absent; reconcile checkpoint and process identity first.',{lock:c.lock}));
 const resources={filesystems:await Promise.all([...new Set(['/',repo,info?.DockerRootDir].filter(Boolean))].map(diskInfo)),docker:{dataRoot:info?.DockerRootDir,driver:info?.Driver,reportedLayerBytes:engineDf?.LayersSize??null,dfReadComplete:!!engineDf,cacheEntries:engineDf?.BuildCache?.length??null,cacheSizeSumNotReclaimEstimate:(engineDf?.BuildCache||[]).reduce((n,c)=>n+(c.Size||0),0),cacheDeletionAuthorized:false}};
 try{const mem=await readFile('/proc/meminfo','utf8'),get=k=>Number(mem.match(new RegExp('^'+k+':\\s+(\\d+)','m'))?.[1])*1024;resources.host={memoryTotalBytes:get('MemTotal'),memoryAvailableBytes:get('MemAvailable'),swapTotalBytes:get('SwapTotal'),swapFreeBytes:get('SwapFree'),loadAverage:(await readFile('/proc/loadavg','utf8')).split(' ').slice(0,3).map(Number)};}catch{}
 const relevant=containers.filter(c=>c.running&&(c.project===project||c.name==='shadowbridge-automation-n8n-1'||/caddy|auth-proxy/i.test(c.name||'')||c.service==='caddy'));
 resources.containerSample=[];if(relevant.length){const out=docker(['stats','--no-stream','--format','{{json .}}',...relevant.map(c=>c.id)]);for(const line of(out||'').split('\n')){const s=json(line);if(s)resources.containerSample.push({id:s.ID,name:s.Name,cpu:s.CPUPerc,memory:s.MemUsage,memoryPercent:s.MemPerc,pids:s.PIDs,blockIo:s.BlockIO,netIo:s.NetIO});}}
 const httpEvidence=await Promise.all([httpProbe('https://shadow-bridge.eu/health'),httpProbe('https://automation.shadow-bridge.eu/healthz'),httpProbe('https://automation.shadow-bridge.eu/signin',{html:true}),httpProbe('https://shadow-bridge.eu/member-sign-in/',{html:true})]);
 let database={status:'UNVERIFIED'};const pg=containers.filter(c=>c.running&&c.service==='postgres'&&c.project===project);
 if(pg.length===1){const q="BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; WITH owners AS (SELECT r.user_id FROM sb.staff_role_assignments r JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND g.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND a.status='active' AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=r.user_id AND f.factor_type='totp' AND f.status='verified')) SELECT json_build_object('connectionOk',true,'serverVersion',current_setting('server_version'),'databaseBytes',pg_database_size(current_database()),'migrationCount',(SELECT count(*) FROM shadowbridge_migrations.applied),'activeOwnersWithVerifiedTotp',(SELECT count(*) FROM owners),'lastOwnerMfaAt',(SELECT max(e.created_at) FROM sb.audit_events e JOIN owners o ON o.user_id=e.actor_id WHERE e.action='auth.mfa_verified'),'connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()));ROLLBACK;";database=json(docker(['exec',pg[0].id,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',q]))||database;database.readOnlyTransaction=true;}
 let internalAuthHealth={status:'UNVERIFIED'};if(app.length===1){const p=docker(['exec',app[0].id,'node','--input-type=module','-e',"try{const r=await fetch('https://auth-proxy:8444/auth/v1/health',{signal:AbortSignal.timeout(8000)});console.log(JSON.stringify({status:r.status,tlsVerificationEnabled:process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'}))}catch{console.log(JSON.stringify({status:'UNAVAILABLE'}))}"]);internalAuthHealth=json(p)||internalAuthHealth;}
 const targetCheckpoint=checkpoints.find(c=>c.root===targetRoot),artifactRoots=[targetCheckpoint?.size,...transferRows.filter(t=>t.size.path.endsWith(attempted)).map(t=>t.size)].filter(Boolean);
 const dependencyInventoryComplete=rootsComplete&&!!engineDf&&raw.length===listed.length&&app.length===1&&sourceDirs.size>0;
 table.splice(0,table.length,...guardCandidates(table,dependencyInventoryComplete));
 return{kind:'shadowbridge-oauth-closeout-read-only-audit',observedAt:new Date().toISOString(),host:hostname(),readOnly:true,changesMade:false,mcpWriteWork:'PAUSED_BY_OWNER',productionDeploymentClaimed:false,dependencyInventoryComplete,repository:{head:sha(run('git',['-c','safe.directory='+repo,'-C',repo,'rev-parse','HEAD'])),worktree:safeWorktree(run('git',['-c','safe.directory='+repo,'-C',repo,'status','--porcelain=v1','--untracked-files=normal']))},httpEvidence,services:relevant,database,internalAuthHealth,ownerAccess:{authenticatedBookReadTested:false,interactiveOwnerLoginTested:false,ownerReportedReadSufficient:true,scope:'No sessions/tokens created or reused; configured MFA evidence is not an interactive login test.'},checkpoints,transfers:transferRows,resources,failedAttemptFileUsage:{scope:'Target e871f2e checkpoint directory plus its known transfer copies; historical releases and Docker data are reported separately.',roots:artifactRoots,allocatedBytes:artifactRoots.length&&artifactRoots.every(s=>Number.isFinite(s.allocatedBytes))?artifactRoots.reduce((n,s)=>n+s.allocatedBytes,0):null,imagesReportedSeparately:true,sharedLayersAndCachesNotAdded:true},table,cleanupAuthorized:false,limitations:['No authenticated Book read or browser OWNER/TOTP test was possible in this audit.','Backup contents were not decrypted; offsite copies and restore viability are not newly verified.','Image/cache sizes share layers; guaranteed reclaim is unknown and sizes must not be added blindly.','No container/volume/cache/file/lock removal, migration, rollback, restart or permission repair performed.']};
}
async function sshAudit(){
 if(!process.stdin.isTTY)throw Error('Interactive OWNER terminal required.');
 const source=await readFile(fileURLToPath(import.meta.url),'utf8'),program=source+'\ntry{console.log(JSON.stringify(await collectAudit(),null,2));}catch{console.log(JSON.stringify({status:"READ_ONLY_AUDIT_INCOMPLETE",readOnly:true,changesMade:false}));process.exitCode=1;}\n',quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 const r=spawnSync('ssh',['-t','-o','StrictHostKeyChecking=yes','-o','ServerAliveInterval=15','shadowadmin@169.58.232.69','sudo node --input-type=module -e '+quote(program)],{stdio:'inherit'});if(r.error||r.status!==0)throw Error('SSH audit incomplete; no production change requested.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length!==3||process.argv[2]!=='--ssh')throw Error('Use --ssh on OWNER Pop!_OS; this is not an updater.');sshAudit().catch(()=>{console.error('READ_ONLY_AUDIT_INCOMPLETE; no deployment/cleanup was invoked.');process.exitCode=1;});}
