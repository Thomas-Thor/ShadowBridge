// Dedicated operator coordinator. Not copied into the runtime image.
// Only 80f4a0d -> e871f2e, no migrator, no account or service administration.
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,lstat,open,rename,unlink,readdir,realpath,statfs,copyFile,chown,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {originalOperator,validatePlannedOriginal,validateBuiltArtifacts,recoverPlannedFlow,checkpointedPair} from './book-oauth-recovery-flow.mjs';
import {repositoryRoot} from './staging-prepare.mjs';
import {checkProduction} from './production-config.mjs';
import {applicationArguments,applicationBackupFiles,assertApplicationOnly,checkApplicationPlan,checkMergedApplication,verifyR1Http} from './international-r1.mjs';
import {encryptArchive,decryptArchive} from './staging-backup.mjs';
import {migrationSources,validateApplied} from './staging-migrate.mjs';
import {runOperatorCommand,validateReceipt,verifiedTar,assertNoOtherReleaseLock} from './r1-production-release.mjs';

export const acceptedBase='80f4a0d333d31a6d57ada714b0df17bc0584a07b';
export const targetRelease='e871f2e09c25dc79f5222fa738ac446a103f1edc';
const stop=m=>Object.assign(Error(m),{safeReason:m});
const must=(v,m)=>{if(!v)throw stop(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=isDeepStrictEqual;
const imagePattern=/^sha256:[a-f0-9]{64}$/;
const flags=['OWNER_BOOK_API_ENABLED','OWNER_BOOK_MCP_ENABLED','OWNER_BOOK_OAUTH_ENABLED','OWNER_BOOK_MCP_CREATE_ENABLED','OWNER_BOOK_MCP_WRITE_ENABLED'];
const environment=c=>Object.fromEntries(c.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
const stableEnvironment=c=>hash(JSON.stringify(Object.entries(environment(c)).filter(([k])=>k!=='RELEASE_SHA').sort(([a],[b])=>a.localeCompare(b))));
const exec=(bin,args,options={})=>runOperatorCommand(bin,args,options);
const git=args=>exec('git',['-c','safe.directory='+repositoryRoot,...args]);
const docker=(args,options={})=>exec('docker',['--context','default',...args],options);
export function expectedSourceMode(file,sourceDirectory){return file===path.join(sourceDirectory,'certs','internal-ca.crt')?0o644:file.endsWith('.sh')?0o700:0o600;}
export async function privatePath(file,directory=false,mode=directory?0o700:0o600){
 must(file.startsWith(repositoryRoot+'/.local/'),'Private paths must stay under this installation .local.');
 let p=file;while(p!==repositoryRoot){const s=await lstat(p);must(!s.isSymbolicLink(),'Private path contains a symlink.');p=path.dirname(p);}
 const s=await lstat(file);
 if(!(directory?s.isDirectory():s.isFile())||(s.mode&0o777)!==mode){
  const error=stop('Private file/directory permissions mismatch.');
  error.fileMetadata={path:file,expectedType:directory?'directory':'file',expectedMode:mode.toString(8).padStart(4,'0'),actualType:s.isDirectory()?'directory':s.isFile()?'file':'other',actualMode:(s.mode&0o7777).toString(8).padStart(4,'0'),uid:s.uid,gid:s.gid};throw error;
 }
}
async function fileHash(file){const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');}
async function readPrivate(file){await privatePath(file);return JSON.parse(await readFile(file,'utf8'));}
async function savePrivate(file,value){const tmp=file+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file);}

export function validateBaseReceipt(s){
 must(s.release===acceptedBase&&s.purpose==='book-write'&&s.phase==='DEPLOYED_AND_VERIFIED'&&s.ownerInteractiveAcceptance===true&&imagePattern.test(s.image),'Accepted 80f4a0d OWNER checkpoint/image required.');
}
export function validateLedger(sources,ledger){validateApplied(sources,ledger);must(sources.length===21&&ledger.length===21,'Exactly unchanged migrations 001–021 required; no migration will run.');}
export function resumeAction(phase){
 if(phase==='NONE')return'prepare';
 if(phase==='BACKUPS_VERIFIED_WAITING_OFFSITE')return'apply';
 if(phase==='SWAPPING_APP')return'resume';
 if(phase==='DEPLOYED_PENDING_OWNER_ACCEPTANCE')return'accept';
 if(phase==='DEPLOYED_AND_VERIFIED')return'verify';
 throw stop('Checkpoint requires operator review; no automatic retry.');
}
// Used unchanged by the real operator and isolated fault-injection tests.
// There is deliberately no migration or other-service operation in this flow.
export async function appOnlyFlow(ops,phase){
 let s=await ops.load();
 if(phase==='prepare'){
  must(!s,'Existing checkpoint: resume, never overwrite.');
  const evidence=await ops.preflight();
  s={...evidence,phase:'PLANNED',schemaChanged:false};await ops.save(s);
  await ops.build(s);await ops.backup(s);await ops.verifyBackups(s);
  s.phase='BACKUPS_VERIFIED_WAITING_OFFSITE';await ops.save(s);return s;
 }
 must(s,'Missing checkpoint.');
 if(phase==='verify'){must(s.phase==='DEPLOYED_AND_VERIFIED','Release not accepted.');await ops.verify(s,false);return s;}
 if(phase==='accept'){
  must(s.phase==='DEPLOYED_PENDING_OWNER_ACCEPTANCE','Release not pending acceptance.');
  await ops.verify(s,false);await ops.ownerMfa(s.appliedAt);s.phase='DEPLOYED_AND_VERIFIED';s.ownerInteractiveAcceptance=true;await ops.save(s);return s;
 }
 if(phase==='rollback'){
  must(['SWAPPING_APP','DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED'].includes(s.phase),'No swappable checkpoint.');
  await ops.ownerMfa();
  await ops.rollback(s);await ops.verify(s,true);s.phase='ROLLED_BACK_APPLICATION_ONLY';await ops.save(s);return s;
 }
 must(phase==='apply'||phase==='resume','Unknown phase.');
 must(s.phase===(phase==='apply'?'BACKUPS_VERIFIED_WAITING_OFFSITE':'SWAPPING_APP'),'Unexpected checkpoint phase.');
 await ops.check(s);await ops.verifyBackups(s);await ops.verifyOffsite(s);await ops.ownerMfa();
 s.phase='SWAPPING_APP';await ops.save(s);
 try{
  // A resume inspects actual image/state; it never repeats a successful swap.
  if(!await ops.alreadyRunningTarget(s))await ops.replace(s);
  await ops.verify(s,false);
 }catch(error){
  try{await ops.rollback(s);await ops.verify(s,true);s.phase='ROLLED_BACK_APPLICATION_ONLY';await ops.save(s);}catch{throw stop('UPDATE_FAILED_AND_ROLLBACK_UNVERIFIED; preserve checkpoint, no reset.');}
  throw stop('UPDATE_FAILED_APPLICATION_ROLLED_BACK; database untouched.');
 }
 s.phase='DEPLOYED_PENDING_OWNER_ACCEPTANCE';s.appliedAt=new Date().toISOString();await ops.save(s);return s;
}

export function runtimePaths(names){return names.filter(f=>{
 if(f.startsWith('assets/prototypes.'))return false;
 const p=f.split('/');return ['package.json','index.html','robots.txt','sitemap.xml','member-sign-in/index.html','legal/index.html','cartel/index.html'].includes(f)||['apply/','portal/','assets/fonts/'].some(x=>f.startsWith(x))||p.length===2&&(p[0]==='server'&&f.endsWith('.mjs')||p[0]==='assets'&&/\.(js|css|svg|png)$/.test(f));
});}
export function composeSwapArguments(baseArgs,override){return[...baseArgs,'-f',override,'up','-d','--no-build','--no-deps','--pull','never','--wait','--wait-timeout','120','app'];}
export function imageFingerprintArguments(image,files){must(imagePattern.test(image)&&files.every(f=>!f.startsWith('/')&&!f.split('/').includes('..')),'Invalid image fingerprint request.');return['create','--label','shadowbridge.operator-purpose=oauth-recovery-image-read','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','32','--memory','64m','--entrypoint','sha256sum',image,...files.map(f=>'/app/'+f)];}
export async function verifyStoredImage(image,pins,directory){
 const files=Object.keys(pins),id=docker(imageFingerprintArguments(image,files));must(/^[a-f0-9]{64}$/.test(id),'One new stopped image-reader container required.');
 const scratch=path.join(directory,'image-read-'+randomUUID()+'.tar');let written=false;
 const owned=()=>{const c=JSON.parse(docker(['inspect',id]))[0];must(c.Image===image&&!c.State.Running&&c.Config.Labels?.['shadowbridge.operator-purpose']==='oauth-recovery-image-read','Image-reader ownership/state changed; no cleanup of an unknown container.');};
 try{
  owned();const file=await open(scratch,'wx',0o600);written=true;
  try{exec('docker',['--context','default','cp',id+':/app','-'],{stdio:['ignore',file.fd,'pipe']});}finally{await file.close();}
  for(const [name,sum]of Object.entries(pins)){const value=execFileSync('tar',['-xOf',scratch,'--','app/'+name],{stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2});must(hash(value)===sum,'Existing built image does not match immutable e871f2e bytes.');}
  return{filesVerified:files.length,applicationStarted:false};
 }finally{owned();docker(['rm',id]);if(written)await unlink(scratch);}
}
export const canonicalMounts=mounts=>[...mounts].sort((a,b)=>(a.Destination||a.Target).localeCompare(b.Destination||b.Target));
export function appContinuity(c){return{appEnvironmentHash:stableEnvironment(c),appHost:c.HostConfig,appMounts:canonicalMounts(c.Mounts),appNetworks:Object.keys(c.NetworkSettings.Networks).sort()};}
export function assertAppContinuity(c,s){
 const release=c.Image===s.previousImage?acceptedBase:targetRelease;
 must([s.previousImage,s.image].filter(Boolean).includes(c.Image)&&environment(c).RELEASE_SHA===release&&same(appContinuity(c),Object.fromEntries(['appEnvironmentHash','appHost','appMounts','appNetworks'].map(k=>[k,s[k]]))),'App configuration changed after preflight; no replacement/rollback of an unknown state.');
}
function serviceIdentity(c){return{id:c.Id,image:c.Image,environment:hash(JSON.stringify([...c.Config.Env].sort())),networks:Object.keys(c.NetworkSettings.Networks).sort(),mounts:canonicalMounts(c.Mounts),ports:c.HostConfig.PortBindings};}
function assertIdentity(c,previous){must(c.State.Running&&same(serviceIdentity(c),previous),'Protected container/configuration changed; STOP.');}

export async function runAppOnly({phase,installerRelease,recovery=false}){
 must((recovery?['recover-plan','apply','resume','accept','verify','rollback']:['prepare','apply','resume','accept','verify','rollback']).includes(phase),'Unknown app-only phase.');
 must(process.geteuid?.()===0&&hostname()==='vmi3682957'&&repositoryRoot==='/opt/shadowbridge'&&process.env.SUDO_USER==='shadowadmin','Use sudo as shadowadmin only on the existing Contabo installation.');
 must(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','TLS verification cannot be disabled.');
 must(/^[a-f0-9]{40}$/.test(installerRelease||''),'Full installer SHA required.');
 process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='safe.directory';process.env.GIT_CONFIG_VALUE_0=repositoryRoot;
 must(git(['rev-parse','HEAD'])===installerRelease&&git(['branch','--show-current'])==='release/shadowbridge-international-r1'&&!git(['status','--porcelain']),'Unexpected/dirty operator checkout.');
 git(['merge-base','--is-ancestor',targetRelease,installerRelease]);
 const names=git(['ls-tree','-r','--name-only',targetRelease]).split('\n'),runtime=runtimePaths(names);
 const pins=release=>Object.fromEntries(runtime.map(f=>[f,hash(execFileSync('git',['-c','safe.directory='+repositoryRoot,'show',release+':'+f],{cwd:repositoryRoot,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2}))]));
 const basePins=pins(acceptedBase),targetPins=pins(targetRelease);
 const changed=runtime.filter(f=>basePins[f]!==targetPins[f]).sort();
 must(same(changed,['server/owner-book-mcp.mjs','server/owner-book-oauth.mjs']),'Unexpected runtime payload.');
 for(const f of [...runtime,'package-lock.json','deploy/staging/Dockerfile','.dockerignore'])must(hash(await readFile(path.join(repositoryRoot,f)))===hash(execFileSync('git',['-c','safe.directory='+repositoryRoot,'show',targetRelease+':'+f],{stdio:['ignore','pipe','pipe'],maxBuffer:8*1024**2})),'Checkout differs from the pinned e871f2e runtime/build inputs.');
 const context=JSON.parse(docker(['context','inspect','default','--format','{{json .Endpoints.docker}}']));must(['unix:///var/run/docker.sock','unix:///run/docker.sock'].includes(context.Host),'Remote Docker context refused.');
 const folder=path.join(repositoryRoot,'.local','r1-owner-release-'+targetRelease);await mkdir(folder,{mode:0o700,recursive:true});await privatePath(folder,true);
 if(recovery)must((await lstat(folder)).uid===0,'Recovery checkpoint folder must retain root ownership.');
 const lock=path.join(folder,'operation.lock'),handle=await open(lock,'wx',0o600);await handle.write(String(process.pid));await handle.close();
 try{
 await assertNoOtherReleaseLock(path.join(repositoryRoot,'.local'),folder);
 const baseFile=path.join(repositoryRoot,'.local','r1-owner-release-'+acceptedBase,'state.json'),accepted=await readPrivate(baseFile);validateBaseReceipt(accepted);
 must(accepted.sourceDirectory.startsWith(repositoryRoot+'/.local/')&&await realpath(accepted.sourceDirectory)===accepted.sourceDirectory,'Unexpected installation directory.');
 const profile=await checkProduction({directory:accepted.sourceDirectory}),prior=await checkApplicationPlan({profile,directory:accepted.planDirectory});checkMergedApplication(profile,accepted.planDirectory,prior);
 must(prior.releaseSha===acceptedBase&&prior.image===accepted.image&&['ownerBookApi','ownerBookMcp','ownerBookOAuth','ownerBookMcpCreate','ownerBookMcpWrite'].every(k=>prior[k]===true),'Accepted plan mismatch.');
 const baseArgs=applicationArguments(profile,accepted.planDirectory).slice(0,-8),env={...process.env,...profile.composeEnvironment};
 const compose=args=>docker([...baseArgs,...args],{env}),inspect=id=>JSON.parse(docker(['inspect',id]))[0];
 const app=()=>{const id=compose(['ps','--all','-q','app']);must(/^[a-f0-9]{64}$/.test(id),'One existing app required.');return inspect(id);};
 const query=q=>compose(['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',"BEGIN READ ONLY;SET LOCAL statement_timeout='15s';"+q+';ROLLBACK;']);
 const sources=await migrationSources();
 for(const source of sources)must(source.sha256===hash(execFileSync('git',['-c','safe.directory='+repositoryRoot,'show',acceptedBase+':supabase/migrations/'+source.name],{stdio:['ignore','pipe','pipe']})),'Migration source drift.');
 const ledger=()=>JSON.parse(query("SELECT coalesce(json_agg(t ORDER BY name),'[]'::json) FROM shadowbridge_migrations.applied t"));
 const ownerMfa=async since=>{
  must(since===undefined||/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(since),'Invalid MFA timestamp.');
  const start=since?"'"+since+"'::timestamptz":"now()-interval '30 minutes'";
  const count=Number(query("SELECT count(*) FROM sb.staff_role_assignments r JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND lower(a.email)=lower(u.email) AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.factor_type='totp' AND f.status='verified') AND EXISTS(SELECT 1 FROM sb.audit_events e WHERE e.actor_id=r.user_id AND e.action='auth.mfa_verified' AND e.created_at>"+start+")"));
  must(count>0,'Fresh existing OWNER MFA required. No account/MFA reset performed.');
 };
 const merged=override=>JSON.parse(docker([...baseArgs,...(override?['-f',override]:[]),'config','--format','json'],{env}));
 const original=merged(),originalStateFile=path.join(folder,'state.json'),stateFile=path.join(folder,recovery?'recovery-state.json':'state.json'),recoveryFolder=path.join(folder,'recovery');
 async function checkSources(){await checkProduction({directory:profile.sourceDirectory});await checkApplicationPlan({profile,directory:accepted.planDirectory});checkMergedApplication(profile,accepted.planDirectory,prior);validateLedger(sources,ledger());}
 function verifyRuntime(c,release,image,expectedEnvHash,expectedHost,expectedMounts,expectedNetworks){
  must(c.State.Running&&c.Image===image&&c.Config.User==='node','Unexpected app identity/user/state.');
  must(stableEnvironment(c)===expectedEnvHash&&environment(c).RELEASE_SHA===release&&same(c.HostConfig,expectedHost)&&same(canonicalMounts(c.Mounts),expectedMounts)&&same(Object.keys(c.NetworkSettings.Networks).sort(),expectedNetworks),'App environment/security/mount/network drift.');
  must(inspectImage(image).Config.Labels['org.opencontainers.image.revision']===release,'Image release label mismatch.');
  must(same(c.Config.Cmd,inspectImage(image).Config.Cmd)&&same(c.Config.Entrypoint,inspectImage(image).Config.Entrypoint),'App command/entrypoint drift.');
  const pins=release===acceptedBase?basePins:targetPins;
  const lines=docker(['exec',c.Id,'sha256sum',...runtime.map(f=>'/app/'+f)]).split('\n');
  must(lines.length===runtime.length&&lines.every(line=>{const [sum,file]=line.split(/\s+/);return pins[file.replace('/app/','')]===sum;}),'Actual app file fingerprint mismatch.');
 }
 const inspectImage=image=>JSON.parse(docker(['image','inspect',image]))[0];
 async function check(s){
  await checkSources();must(hash(await readFile(baseFile))===s.acceptanceHash&&s.installerRelease===installerRelease&&s.release===targetRelease&&s.previousRelease===acceptedBase&&s.previousImage===accepted.image&&s.sourceDirectory===profile.sourceDirectory,'Checkpoint/acceptance changed.');
  if(recovery)await checkOrigin(s);
  for(const [file,sum]of Object.entries(s.configHashes)){await privatePath(file,false,expectedSourceMode(file,profile.sourceDirectory));must(await fileHash(file)===sum,'Configuration/plan fingerprint changed.');}
  for(const v of s.protected)assertIdentity(inspect(v.id),v);
  const c=app();assertAppContinuity(c,s);
  for(const [file,image,release]of [['application.json',s.image,targetRelease],['rollback.json',s.previousImage,acceptedBase]]){
   const override=path.join(folder,file);await privatePath(override);must(same(JSON.parse(await readFile(override)),{services:{app:{image,environment:{RELEASE_SHA:release}}}}),'App-only overlay changed.');
   assertApplicationOnly(original,merged(override),{image,releaseSha:release});
  }
 }
 async function verify(s,rollback){
  await check(s);const release=rollback?acceptedBase:targetRelease,c=app();
  verifyRuntime(c,release,rollback?s.previousImage:s.image,s.appEnvironmentHash,s.appHost,s.appMounts,s.appNetworks);
  must(docker(['exec',c.Id,'node','--input-type=module','-e',"const r=await fetch('https://auth-proxy:8444/auth/v1/health',{signal:AbortSignal.timeout(8000)});if(!r.ok)process.exit(1);console.log('PASS')"])==='PASS','Internal auth TLS failed.');
  await verifyR1Http(release,{readOnly:true});
  for(const route of ['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp']){
   const r=await fetch('https://shadow-bridge.eu'+route,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)}),d=await r.json();
   must(r.status===200&&d.scopes_supported.includes('note.write')&&d.scopes_supported.includes('task.write')&&d.scopes_supported.some(s=>s.endsWith('.create'))===rollback,'OAuth metadata does not match the exact old/new discovery contract.');
  }
  const r=await fetch('https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  must(r.status===401&&(await r.json()).code==='BOOK_API_DENIED'&&r.headers.get('www-authenticate')?.includes('resource_metadata='),'Anonymous MCP must remain denied.');
 }
 async function collectConfiguration(s){
  s.configHashes=Object.fromEntries(Object.entries(await applicationBackupFiles(profile,accepted.planDirectory,prior)).map(([f,h])=>[path.join(profile.sourceDirectory,f),h]));
  for(const f of ['compose.env','postgres.env','auth.env','app.env','migration.env','tester-password','Caddyfile','manifest.json',...['internal-ca.crt','internal-ca.key','postgres.crt','postgres.key','auth-proxy.crt','auth-proxy.key','public.crt','public.key'].map(n=>'certs/'+n)]){const file=path.join(profile.sourceDirectory,f);await privatePath(file,false,expectedSourceMode(file,profile.sourceDirectory));s.configHashes[file]=await fileHash(file);}
  for(const name of ['application.json','rollback.json'])s.configHashes[path.join(folder,name)]=await fileHash(path.join(folder,name));
 }
 async function readOriginal(){
  await privatePath(originalStateFile);const info=await lstat(originalStateFile);must(info.uid===0,'Original checkpoint must retain its recorded root ownership.');
  const bytes=await readFile(originalStateFile),state=JSON.parse(bytes);
  must(state.installerRelease===originalOperator&&state.phase==='PLANNED'&&state.schemaChanged===false&&state.release===targetRelease,'Only the diagnosed original PLANNED state may be recovered.');
  return{state,sha256:hash(bytes)};
 }
 async function checkOrigin(s){
  const old=await readOriginal();
  must(s.recoveryOrigin?.originalCheckpointSha256===old.sha256&&s.recoveryOrigin.originalOperator===originalOperator,'Original checkpoint changed; no recovery continuation.');
  const file=path.join(recoveryFolder,'origin.json');await privatePath(file);must((await lstat(file)).uid===0&&await fileHash(file)===s.recoveryOrigin.receiptSha256,'Recovery origin receipt changed.');
  const receipt=await readPrivate(file);must(receipt.originalCheckpointSha256===old.sha256&&receipt.recoveryOperator===installerRelease&&receipt.image===s.image&&receipt.previousImage===s.previousImage,'Recovery receipt identity mismatch.');
  for(const [name,sum]of Object.entries(receipt.overlayHashes))must(await fileHash(path.join(folder,name))===sum,'Original overlays changed; no recovery continuation.');
 }
 async function adoptOriginal(old,fresh){
  validatePlannedOriginal(old.state,fresh,{base:acceptedBase,target:targetRelease});
  for(const name of ['database.sbb','database.key','database.private.dump','configuration.sbb','configuration.key','configuration.private.tar','certificates.sbb','certificates.key'])must(!await exists(path.join(folder,name)),'Unexpected original backup artifacts; STOP without overwriting.');
  const overlayHashes={};for(const name of ['application.json','rollback.json']){const file=path.join(folder,name);await privatePath(file);must((await lstat(file)).uid===0,'Original overlays must retain root ownership.');overlayHashes[name]=await fileHash(file);}
  const appOverlay=await readPrivate(path.join(folder,'application.json')),rollbackOverlay=await readPrivate(path.join(folder,'rollback.json')),image=appOverlay.services?.app?.image;
  validateBuiltArtifacts(appOverlay,rollbackOverlay,{image,previousImage:fresh.previousImage,target:targetRelease,base:acceptedBase});
  const built=inspectImage(image),previous=inspectImage(fresh.previousImage);
  must(built.Id===image&&built.Config.Labels['org.opencontainers.image.revision']===targetRelease&&built.Config.User==='node'&&same(built.Config.Env,previous.Config.Env)&&same(built.Config.Cmd,previous.Config.Cmd)&&same(built.Config.Entrypoint,previous.Config.Entrypoint),'Existing target image configuration differs from the approved runtime.');
  const rollbackTag='shadowbridge-oauth-rollback:'+targetRelease;must(inspectImage(rollbackTag).Id===fresh.previousImage,'Existing rollback image tag is missing or changed.');
  await mkdir(recoveryFolder,{mode:0o700,recursive:true});await privatePath(recoveryFolder,true);
  must((await lstat(recoveryFolder)).uid===0,'Recovery evidence directory must be root-owned.');
  must(!built.Config.Volumes||Object.keys(built.Config.Volumes).length===0,'Verification must not create anonymous image volumes.');await verifyStoredImage(image,targetPins,recoveryFolder);
  const receipt={kind:'shadowbridge-app-only-recovery-origin-v1',originalOperator,recoveryOperator:installerRelease,originalCheckpointSha256:old.sha256,overlayHashes,image,previousImage:fresh.previousImage,acceptanceHash:fresh.acceptanceHash};
  const file=path.join(recoveryFolder,'origin.json');
  if(await exists(file))must(same(await readPrivate(file),receipt),'Existing recovery origin differs; nothing overwritten.');else await writeFile(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  const s={...fresh,image,rollbackTag,recoveryOrigin:{originalOperator,originalCheckpointSha256:old.sha256,receiptSha256:await fileHash(file)}};
  await collectConfiguration(s);s.configHashes[originalStateFile]=old.sha256;s.configHashes[file]=await fileHash(file);
  await check(s);return s;
 }
 async function recoveryBackups(s){
  await check(s);await privatePath(recoveryFolder,true);
  const postgres=compose(['ps','-q','postgres']);must(/^[a-f0-9]{64}$/.test(postgres),'One running PostgreSQL required.');
  const pairOps={save:operations.save,completePair:async p=>{for(const file of [p.backupFile,p.keyFile]){if(!await exists(file))return false;await privatePath(file);}return true;},anyArtifacts:async p=>{const prefix=p.backupFile.slice(0,-4);for(const file of [p.backupFile,p.keyFile,prefix+'.private.dump',prefix+'.private.tar'])if(await exists(file))return true;return(await readdir(recoveryFolder)).some(n=>n.startsWith(path.basename(prefix)+'.scratch-'));}};
  const expected=name=>({backupFile:path.join(recoveryFolder,name+'.sbb'),keyFile:path.join(recoveryFolder,name+'.key')});
  await checkpointedPair(pairOps,s,'database',expected('database'),{create:()=>backupOnlineDatabase(postgres,path.join(recoveryFolder,'database')),verify:p=>verifyOnlineDatabase(postgres,p)});
  s.configurationFiles=Object.fromEntries(Object.entries(s.configHashes).map(([f,h])=>[path.relative(repositoryRoot,f),h]));await operations.save(s);
  await checkpointedPair(pairOps,s,'configuration',expected('configuration'),{create:()=>encryptedTar(path.join(recoveryFolder,'configuration'),repositoryRoot,Object.keys(s.configurationFiles)),verify:p=>verifiedTar(p,{files:s.configurationFiles})});
  const gateway=s.protected.map(c=>inspect(c.id)).find(c=>c.Config.Labels?.['com.docker.compose.service']==='gateway'&&c.Config.Labels['com.docker.compose.project']===profile.project);
  await checkpointedPair(pairOps,s,'certificates',expected('certificates'),{create:async()=>{const b=await backupLiveCertificates(gateway.Id,path.join(recoveryFolder,'certificates'),async files=>{s.certificateFiles=files;await operations.save(s);});return b.pair;},verify:p=>{must(s.certificateFiles,'Certificate hash inventory was not checkpointed.');return verifiedTar(p,{files:s.certificateFiles});}});
  s.bundle='/home/shadowadmin/.shadowbridge-oauth-recovery-'+targetRelease;s.bundleNonce??=randomUUID();await operations.save(s);
  if(!await exists(s.bundle)){await mkdir(s.bundle,{mode:0o700});await chown(s.bundle,Number(exec('id',['-u','shadowadmin'])),Number(exec('id',['-g','shadowadmin'])));}
  const uid=Number(exec('id',['-u','shadowadmin'])),gid=Number(exec('id',['-g','shadowadmin'])),info=await lstat(s.bundle);must(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o777)===0o700&&info.uid===uid,'Unsafe/incomplete recovery transfer-folder ownership; preserve files for review.');
  const manifest={kind:'shadowbridge-r1-offsite-bundle-v1',release:targetRelease,nonce:s.bundleNonce,files:[]};
  for(const name of ['database','configuration','certificates'])for(const [key,ext]of [['backupFile','sbb'],['keyFile','key']]){const source=s.backups[name][key],filename=name+'.'+ext,target=path.join(s.bundle,filename),sum=await fileHash(source),bytes=(await lstat(source)).size;
   if(await exists(target)){const i=await lstat(target);must(i.isFile()&&!i.isSymbolicLink()&&(i.mode&0o777)===0o600&&i.uid===uid&&i.size===bytes&&await fileHash(target)===sum,'Existing recovery transfer file differs; nothing overwritten.');}else{await copyFile(source,target,1);await chown(target,uid,gid);}manifest.files.push({name:filename,sha256:sum,bytes});
  }
  const bytes=JSON.stringify(manifest)+'\n',target=path.join(s.bundle,'manifest.json');
  if(await exists(target)){const i=await lstat(target);must(i.isFile()&&!i.isSymbolicLink()&&(i.mode&0o777)===0o600&&i.uid===uid&&await fileHash(target)===hash(bytes),'Existing recovery manifest differs or ownership setup is incomplete.');}else{await writeFile(target,bytes,{mode:0o600,flag:'wx'});await chown(target,uid,gid);}
  s.bundleManifestSha=hash(bytes);await operations.save(s);
 }
 const operations={
  load:async()=>{if(!await exists(stateFile))return null;const s=await readPrivate(stateFile);must(s.kind==='shadowbridge-book-oauth-app-only-v1'&&s.installerRelease===installerRelease&&s.release===targetRelease,'Different installer/checkpoint; STOP.');if(recovery){must((await lstat(stateFile)).uid===0,'Recovery state must be root-owned.');await checkOrigin(s);}return s;},
  save:s=>savePrivate(stateFile,s),
  preflight:async()=>{
   await checkSources();await ownerMfa();
   const c=app(),image=inspectImage(c.Image);must(c.Image===accepted.image&&environment(c).RELEASE_SHA===acceptedBase&&flags.every(f=>environment(c)[f]==='true'),'Actual 80f4a0d with unchanged enabled Book flags required.');
   must(c.HostConfig.ReadonlyRootfs&&!c.HostConfig.Privileged&&c.HostConfig.CapDrop?.includes('ALL')&&c.HostConfig.SecurityOpt?.some(v=>['no-new-privileges','no-new-privileges:true'].includes(v))&&!Object.values(c.HostConfig.PortBindings||{}).some(p=>p?.length),'App security/port policy drift.');
   for(const [k,v]of Object.entries(original.services.app.environment))must(environment(c)[k]===String(v),'Running app differs from accepted merged configuration.');
   const ids=docker(['ps','-q','--no-trunc']).split('\n').filter(id=>id&&id!==c.Id),protectedContainers=ids.map(id=>inspect(id));
   must(protectedContainers.some(c=>c.Name==='/shadowbridge-automation-n8n-1')&&protectedContainers.some(c=>c.Config.Labels?.['com.docker.compose.service']==='gateway'&&c.Config.Labels['com.docker.compose.project']===profile.project),'Existing gateway/n8n missing.');
   must(Array.isArray(accepted.protected)&&accepted.protected.length>0,'Accepted protected-service evidence missing.');
   for(const v of accepted.protected){const current=inspect(v.id);must(current.State.Running&&current.Id===v.id&&current.Image===v.image&&hash(JSON.stringify(current.Config.Env))===v.environmentSha256&&same(Object.keys(current.NetworkSettings.Networks).sort(),v.networks)&&same(current.Mounts.filter(m=>m.Type==='volume').map(m=>({name:m.Name,target:m.Destination})).sort((a,b)=>a.target.localeCompare(b.target)),[...v.volumes].sort((a,b)=>a.target.localeCompare(b.target))),'Protected service differs from the accepted 80f4a0d checkpoint.');}
   const edge=JSON.parse(docker(['network','inspect','shadowbridge-edge']))[0],gateway=protectedContainers.find(c=>c.Config.Labels?.['com.docker.compose.service']==='gateway'&&c.Config.Labels['com.docker.compose.project']===profile.project),n8n=protectedContainers.find(c=>c.Name==='/shadowbridge-automation-n8n-1');
   must(edge.Internal&&[gateway,n8n].every(c=>c.NetworkSettings.Networks['shadowbridge-edge']?.NetworkID===edge.Id)&&environment(n8n).N8N_WEBHOOK_URL==='https://automation.shadow-bridge.eu/','Automation network/webhook drift.');
   for(const current of protectedContainers){const service=current.Config.Labels?.['com.docker.compose.service'];if(current.Config.Labels?.['com.docker.compose.project']===profile.project&&['postgres','auth','mailpit'].includes(service))must(!Object.values(current.HostConfig.PortBindings||{}).some(v=>v?.length),'Private service has published ports.');}
   must(Object.values(n8n.HostConfig.PortBindings||{}).flat().filter(Boolean).every(p=>['127.0.0.1','::1'].includes(p.HostIp)),'n8n must remain loopback-only.');
   const s={kind:'shadowbridge-book-oauth-app-only-v1',installerRelease,release:targetRelease,previousRelease:acceptedBase,previousImage:c.Image,sourceDirectory:profile.sourceDirectory,acceptanceHash:hash(await readFile(baseFile)),...appContinuity(c),protected:protectedContainers.map(serviceIdentity)};
   verifyRuntime(c,acceptedBase,c.Image,s.appEnvironmentHash,s.appHost,s.appMounts,s.appNetworks);
   must(docker(['exec',c.Id,'node','--input-type=module','-e',"const r=await fetch('https://auth-proxy:8444/auth/v1/health',{signal:AbortSignal.timeout(8000)});if(!r.ok)process.exit(1);console.log('PASS')"])==='PASS','Existing internal auth TLS must pass before update.');
   await verifyR1Http(acceptedBase,{readOnly:true});
   const bytes=Number(query('SELECT pg_database_size(current_database())')),dockerRoot=docker(['info','--format','{{.DockerRootDir}}']);
   for(const dir of [profile.sourceDirectory,dockerRoot]){const f=await statfs(dir);must(f.bavail*f.bsize>=Math.max(8*1024**3,bytes*8+4*1024**3)&&f.ffree>=100000,'Insufficient disk/inodes; STOP before build/backup.');}
   must(image.Config.Labels['org.opencontainers.image.revision']===acceptedBase,'Accepted app image label mismatch.');
   return s;
  },
  build:async s=>{
   const log=await open(path.join(folder,'runtime-build.log'),'wx',0o600);
   try{exec('docker',['--context','default','build','--target','runtime','--build-arg','SHADOWBRIDGE_RELEASE_SHA='+targetRelease,'-t','shadowbridge-oauth-fix:'+targetRelease,'-f','deploy/staging/Dockerfile','.'],{stdio:['ignore',log.fd,log.fd],timeout:1200000});}finally{await log.close();}
   const i=inspectImage('shadowbridge-oauth-fix:'+targetRelease);must(i.Config.Labels['org.opencontainers.image.revision']===targetRelease&&i.Config.User==='node','New image label/user mismatch.');s.image=i.Id;
   s.rollbackTag='shadowbridge-oauth-rollback:'+targetRelease;docker(['image','tag',s.previousImage,s.rollbackTag]);
   for(const [name,image,release]of [['application.json',s.image,targetRelease],['rollback.json',s.previousImage,acceptedBase]])await writeFile(path.join(folder,name),JSON.stringify({services:{app:{image,environment:{RELEASE_SHA:release}}}})+'\n',{mode:0o600,flag:'wx'});
   await collectConfiguration(s);
   await savePrivate(stateFile,s);await check(s);
  },
  backup:async s=>{
   if(recovery)return recoveryBackups(s);
   s.backups={};const postgres=compose(['ps','-q','postgres']);must(/^[a-f0-9]{64}$/.test(postgres),'One running PostgreSQL required.');
   s.backups.database=await backupOnlineDatabase(postgres,path.join(folder,'database'));
   s.configurationFiles=Object.fromEntries(Object.entries(s.configHashes).map(([f,h])=>[path.relative(repositoryRoot,f),h]));
   s.backups.configuration=await encryptedTar(path.join(folder,'configuration'),repositoryRoot,Object.keys(s.configurationFiles));
   // The gateway is left running. Require stable file hashes across a read-only
   // copy; concurrent ACME/certificate changes fail before the image swap.
   const gateway=s.protected.map(c=>inspect(c.id)).find(c=>c.Config.Labels?.['com.docker.compose.service']==='gateway'&&c.Config.Labels['com.docker.compose.project']===profile.project);
   const certificateBackup=await backupLiveCertificates(gateway.Id,path.join(folder,'certificates'));s.certificateFiles=certificateBackup.files;s.backups.certificates=certificateBackup.pair;
   await savePrivate(stateFile,s);
   s.bundle='/home/shadowadmin/.shadowbridge-oauth-app-only-'+targetRelease;await mkdir(s.bundle,{mode:0o700});
   const uid=Number(exec('id',['-u','shadowadmin'])),gid=Number(exec('id',['-g','shadowadmin']));await chown(s.bundle,uid,gid);
   const manifest={kind:'shadowbridge-r1-offsite-bundle-v1',release:targetRelease,nonce:randomUUID(),files:[]};
   for(const [name,pair]of Object.entries(s.backups))for(const [key,ext]of [['backupFile','sbb'],['keyFile','key']]){const file=name+'.'+ext,target=path.join(s.bundle,file);await privatePath(pair[key]);await copyFile(pair[key],target,1);await chown(target,uid,gid);manifest.files.push({name:file,sha256:await fileHash(target),bytes:(await lstat(target)).size});}
   const bytes=JSON.stringify(manifest)+'\n';await writeFile(path.join(s.bundle,'manifest.json'),bytes,{mode:0o600,flag:'wx'});await chown(path.join(s.bundle,'manifest.json'),uid,gid);s.bundleManifestSha=hash(bytes);
  },
  verifyBackups:async s=>{must(s.backups,'Missing encrypted backup.');await verifyOnlineDatabase(compose(['ps','-q','postgres']),s.backups.database);await verifiedTar(s.backups.configuration,{files:s.configurationFiles});await verifiedTar(s.backups.certificates,{files:s.certificateFiles});},
  verifyOffsite:async s=>{const bytes=await readFile(path.join(s.bundle,'manifest.json'));must(hash(bytes)===s.bundleManifestSha,'Backup manifest changed.');const m=JSON.parse(bytes);await privateRegularBundle(s.bundle);validateReceipt(m,JSON.parse(await readFile(path.join(s.bundle,'offsite-receipt.json'),'utf8')));for(const f of m.files)must(await fileHash(path.join(s.bundle,f.name))===f.sha256,'Offsite bundle changed.');},
  ownerMfa,check,verify,
  alreadyRunningTarget:async s=>{const c=app();must([s.previousImage,s.image].includes(c.Image),'Unknown app image during resume.');return c.Image===s.image&&c.State.Running;},
  replace:async s=>{await check(s);docker(composeSwapArguments(baseArgs,path.join(folder,'application.json')),{env});},
  rollback:async s=>{await check(s);docker(composeSwapArguments(baseArgs,path.join(folder,'rollback.json')),{env});}
 };
 if(recovery){operations.original=readOriginal;operations.adopt=adoptOriginal;}
 const s=recovery&&phase==='recover-plan'?await recoverPlannedFlow(operations):await appOnlyFlow(operations,phase);
 console.log(JSON.stringify({phase:s.phase,release:targetRelease,installerRelease,recovery,originalCheckpointRetained:recovery,migrationsExecuted:0,schemaChanged:false,otherServicesReplaced:false,chatgptWriteVerified:false,ownerInteractiveAcceptance:s.ownerInteractiveAcceptance===true}));
 }finally{await unlink(lock);}
}

export async function backupOnlineDatabase(postgres,prefix,database='shadowbridge'){
 must(/^[a-f0-9]{64}$/.test(postgres),'Invalid existing PostgreSQL identity.');
 must(/^[a-z][a-z0-9_]{0,62}$/.test(database),'Invalid database identity.');
 const dump=prefix+'.private.dump',handle=await open(dump,'wx',0o600);
 try{exec('docker',['--context','default','exec',postgres,'pg_dump','-U','postgres','-d',database,'--format=custom','--no-password'],{stdio:['ignore',handle.fd,'pipe']});}finally{await handle.close();}
 // pg_dump provides its own consistent online snapshot. No services are stopped.
 const pair=await encryptArchive({archiveFile:dump,backupFile:prefix+'.sbb',keyFile:prefix+'.key'});await unlink(dump);return pair;
}
export async function verifyOnlineDatabase(postgres,pair){
 must(/^[a-f0-9]{64}$/.test(postgres),'Invalid existing PostgreSQL identity.');
 const scratch=path.join(path.dirname(pair.backupFile),'.verify-'+randomUUID()+'.dump');await decryptArchive({...pair,archiveFile:scratch});
 const input=await open(scratch,'r');try{exec('docker',['--context','default','exec','-i',postgres,'pg_restore','--list'],{stdio:[input.fd,'ignore','pipe']});}finally{await input.close();await unlink(scratch);}
 return{archiveAuthenticated:true,catalogReadable:true,restored:false};
}
async function privateRegularBundle(bundle){
 const s=await lstat(path.join(bundle,'offsite-receipt.json'));must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600,'Unsafe offsite receipt.');
}

export async function encryptedTar(prefix,base,files){
 const archive=prefix+'.private.tar',old=process.umask(0o077);
 try{exec('tar',['--format=ustar','-cf',archive,'-C',base,'--',...files]);}finally{process.umask(old);}
 const pair=await encryptArchive({archiveFile:archive,backupFile:prefix+'.sbb',keyFile:prefix+'.key'});await unlink(archive);return pair;
}
export async function backupLiveCertificates(id,prefix,onInventory=async()=>{}){
 must(/^[a-f0-9]{64}$/.test(id),'Invalid gateway identity.');
 const gateway=JSON.parse(docker(['inspect',id]))[0];
 must(gateway.State.Running&&['/data','/config'].every(p=>gateway.Mounts.some(m=>m.Destination===p&&m.Type==='volume')),'Running gateway/persistent certificate volumes required.');
 const hashes=()=>parseCertificateHashes(docker(['exec',id,'find','/data','/config','-type','f','-exec','sha256sum','{}','+']));
 const before=hashes(),scratch=prefix+'.scratch-'+randomUUID();await mkdir(scratch,{mode:0o700});
 for(const dir of ['data','config']){await mkdir(path.join(scratch,dir),{mode:0o700});docker(['cp',id+':/'+dir+'/.',path.join(scratch,dir)]);}
 const files=await directoryHashes(scratch);must(same(before,files)&&same(before,hashes()),'Certificate state changed during online backup; STOP, no service was stopped.');
 await onInventory(files);
 const pair=await encryptedTar(prefix,scratch,['data','config']);await rm(scratch,{recursive:true});return{pair,files};
}
export function parseCertificateHashes(text){
 const result={};for(const line of text.split('\n').filter(Boolean)){const m=line.match(/^([a-f0-9]{64})\s+\/(data|config)\/(.+)$/);must(m&&!m[3].split('/').some(p=>p==='..'||p==='.'),'Unsafe certificate inventory.');result[m[2]+'/'+m[3]]=m[1];}
 must(Object.keys(result).length>0,'Certificate inventory empty.');return Object.fromEntries(Object.entries(result).sort());
}
async function directoryHashes(root){
 const values={};async function walk(dir){for(const name of await readdir(dir)){const file=path.join(dir,name),s=await lstat(file);must(!s.isSymbolicLink(),'Certificate copy contains a symlink.');if(s.isDirectory())await walk(file);else{must(s.isFile(),'Nonregular certificate file.');values[path.relative(root,file)]=hash(await readFile(file));}}}await walk(root);return Object.fromEntries(Object.entries(values).sort());
}
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,arg,...extra]=process.argv.slice(2);must(extra.length<=1&&extra.every(a=>a==='--recovery')&&arg?.startsWith('--installer-release='),'Use phase --installer-release=FULL_SHA [--recovery].');
 runAppOnly({phase,installerRelease:arg.slice(20),recovery:extra.includes('--recovery')}).catch(e=>{console.error(JSON.stringify({status:'BLOCKED',reason:e.safeReason||'PRIVATE_OPERATOR_FAILURE; retain checkpoint and private build log',category:e.category,fileMetadata:e.fileMetadata,checkpointRetained:true,productionSuccessNotClaimed:true}));process.exitCode=1;});
}
