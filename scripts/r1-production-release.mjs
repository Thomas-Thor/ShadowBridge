// Operator-only R1 release coordinator. Never runs from the web application.
// Existing R1/backup/fingerprint mechanisms remain the authority. No DNS,
// account administration, mail activation, full compose up or DB rollback.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,readdir,open,unlink,rename,copyFile,chown,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {diagnose,ownerBookR1,ownerBookApiR1,ownerBookMcpR1} from './international-r1-diagnose.mjs';
import {checkProduction} from './production-config.mjs';
import {repositoryRoot} from './staging-prepare.mjs';
import {publicCompose,databaseFingerprints,assertPreserved,verifyBackupArchive} from './production-ops.mjs';
import {backupInstallation} from './staging-ops.mjs';
import {decryptArchive} from './staging-backup.mjs';
import {migrationSources,validateApplied} from './staging-migrate.mjs';
import {prepareApplicationPlan,checkApplicationPlan,checkMergedApplication,preflightExistingR1,backupApplicationConfiguration,applicationBackupFiles,backupGatewayVolumes,verifyR1Http,disabledApplicationArguments} from './international-r1.mjs';

const must=(v,m)=>{if(!v)throw Error(m);},hash=b=>createHash('sha256').update(b).digest('hex');
export const runOperatorCommand=(bin,args,options={})=>{try{const output=execFileSync(bin,args,{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024**2,...options});return typeof output==='string'?output.trim():'';}catch{throw Error('Operacja nie powiodła się; prywatne dane wyjściowe nie zostały opublikowane.');}};
const exec=runOperatorCommand;
const docker=args=>exec('docker',['--context','default',...args]);
const git=args=>exec('git',['-c','safe.directory='+repositoryRoot,...args]);
async function hashFile(file){const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex');}
export const releaseAncestors=['7f794a298713d820af033ba2174cd60bfaa81e4b','6d200ee084872b6c3123346e2f77c61010c94049','9a64cc0a0e4831e786e19bc1101a4126d66756ff','188cdafd8a91f215fd2c10aa4f893f482cb54564','46414fb7c02939ead7622f9a3bb0a5ed9bc16ef2'];
export function validateReceipt(manifest,receipt){
 must(manifest.kind==='shadowbridge-r1-offsite-bundle-v1'&&receipt.kind==='shadowbridge-r1-offsite-receipt-v1','Brak potwierdzenia kopii poza VPS.');
 must(receipt.release===manifest.release&&receipt.nonce===manifest.nonce&&receipt.verifiedOnDifferentHost===true,'Potwierdzenie dotyczy innego wydania.');
 must(Array.isArray(manifest.files)&&manifest.files.length===6&&Array.isArray(receipt.files)&&receipt.files.length===6,'Niekompletna kopia.');
 for(const f of manifest.files){const other=receipt.files.find(x=>x.name===f.name);must(other?.sha256===f.sha256&&other?.bytes===f.bytes,'Kopia poza VPS ma inny checksum lub rozmiar.');}
}
export async function controlledApply(ops){
 // The order is safety-critical and unit-tested with injected failures.
 await ops.check();await ops.verifyBackups();await ops.verifyOffsite();await ops.preservedBefore();
 try{await ops.migrate();await ops.preservedAfter();await ops.start();await ops.verify();}
 catch(error){await ops.rollback();throw error;}
}
async function privateJson(file,data){const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,file);}
async function privateRegular(file){const s=await lstat(file);must(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o777)===0o600,'Wymagany prywatny zwykły plik 0600.');return s;}
export async function verifiedTar(pair,{files,edge=false,profile,plan}){
 const scratch=path.join(path.dirname(pair.backupFile),'.verify-'+randomUUID()+'.tar');
 await decryptArchive({...pair,archiveFile:scratch});
 try{
  const member=name=>{must(!name.startsWith('/')&&!name.split('/').includes('..'),'Niebezpieczna ścieżka archiwum.');return execFileSync('tar',['-xOf',scratch,'--',name],{stdio:['ignore','pipe','pipe'],maxBuffer:64*1024**2});};
  if(edge){const meta=JSON.parse(member('edge.json'));must(meta.kind==='shadowbridge-r1-edge-backup-v1'&&meta.project===profile.project&&meta.release===plan.releaseSha,'Niezgodna kopia certyfikatów.');files=meta.hashes;}
  must(files&&Object.keys(files).length>0,'Brak wykazu plików kopii.');
  for(const [name,digest]of Object.entries(files))must(hash(member(name))===digest,'Kopia konfiguracji/certyfikatów nie przeszła kontroli.');
  return {authenticated:true,filesVerified:Object.keys(files).length};
 }finally{await unlink(scratch);}
}
function protectedServices(inventory){
 return inventory.containers.filter(c=>c.running&&c.service!=='app').map(c=>{
  const v=JSON.parse(docker(['inspect',c.name]))[0];
  return {name:c.name,id:v.Id,image:v.Image,networks:Object.keys(v.NetworkSettings.Networks).sort(),volumes:v.Mounts.filter(m=>m.Type==='volume').map(m=>({name:m.Name,target:m.Destination})),environmentSha256:hash(JSON.stringify(v.Config.Env))};
 });
}
function verifyProtected(state){
 for(const before of state.protected){const v=JSON.parse(docker(['inspect',before.name]))[0];must(v.State.Running&&v.Id===before.id&&v.Image===before.image&&hash(JSON.stringify(v.Config.Env))===before.environmentSha256&&JSON.stringify(Object.keys(v.NetworkSettings.Networks).sort())===JSON.stringify(before.networks)&&JSON.stringify(v.Mounts.filter(m=>m.Type==='volume').map(m=>({name:m.Name,target:m.Destination})))===JSON.stringify(before.volumes),'Zmieniono chronioną usługę; STOP bez resetów.');}
}
export async function assertNoOtherReleaseLock(root,ownFolder){
 for(const name of await readdir(root)){if(!/^r1-owner-release-[a-f0-9]{40}$/.test(name))continue;const dir=path.join(root,name);if(dir===ownFolder)continue;try{await lstat(path.join(dir,'operation.lock'));}catch(e){if(e.code==='ENOENT')continue;throw e;}throw Error('Another release checkpoint is locked; do not interrupt or delete its lock.');}
}
export async function runRelease({phase,release,bookApi=false,bookMcp=false,bookOAuth=false}){
 must([bookApi,bookMcp,bookOAuth].every(v=>typeof v==='boolean')&&[bookApi,bookMcp,bookOAuth].filter(Boolean).length<=1,'Invalid release purpose.');
 const purpose=bookOAuth?'book-oauth':bookMcp?'book-mcp':bookApi?'book-api':'foundation',runtimeBase=bookOAuth?ownerBookMcpR1:bookMcp?ownerBookApiR1:bookApi?ownerBookR1:undefined;bookApi=bookApi||bookMcp||bookOAuth;
 must(['prepare','apply','accept','rollback','cancel','off','resume','verify'].includes(phase)&&/^[a-f0-9]{40}$/.test(release||''),'Nieprawidłowy etap lub pełny SHA.');
 must(process.geteuid?.()===0&&hostname()==='vmi3682957'&&repositoryRoot==='/opt/shadowbridge'&&process.env.SUDO_USER==='shadowadmin','Uruchom wyłącznie przez sudo jako shadowadmin na vmi3682957.');
 must(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','Weryfikacja TLS nie może być wyłączona.');
 // Scope Git trust to this process and exact repo, never global git config.
 process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='safe.directory';process.env.GIT_CONFIG_VALUE_0=repositoryRoot;
 must(git(['branch','--show-current'])==='release/shadowbridge-international-r1'&&git(['rev-parse','HEAD'])===release&&!git(['status','--porcelain']),'Niezgodny lub nieczysty checkout R1. Niczego nie nadpisano.');
 for(const a of releaseAncestors)git(['merge-base','--is-ancestor',a,'HEAD']);
 const sources=await migrationSources();must(sources.length===(bookOAuth?19:18),'Użyj zatwierdzonego wydania i jego jawnego trybu migracji. OAuth wymaga 001–019.');
 const folder=path.join(repositoryRoot,'.local','r1-owner-release-'+release);await mkdir(folder,{mode:0o700,recursive:true});
 const info=await lstat(folder);must(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o777)===0o700,'Niebezpieczny katalog wydania.');
 const lock=path.join(folder,'operation.lock'),handle=await open(lock,'wx',0o600);await handle.write(String(process.pid));await handle.close();
 const stateFile=path.join(folder,'state.json');let state,profile,paused=false,migrationAttempted=false;
 const save=()=>privateJson(stateFile,state);
 const command=action=>exec('node',['scripts/international-r1.mjs',action,'--dir='+profile.sourceDirectory,'--plan='+state.planDirectory]);
 const query=q=>publicCompose(profile,['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c','BEGIN READ ONLY;'+q+';ROLLBACK;']);
 const ledger=()=>JSON.parse(query('SELECT json_agg(t ORDER BY name) FROM shadowbridge_migrations.applied t'));
 const recentOwnerCount=since=>{
  must(since===undefined||/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(since),'Nieprawidłowy czas odbioru.');
  const start=since?"'"+since+"'::timestamptz":"now()-interval '30 minutes'";
  return Number(query("SELECT count(*) FROM sb.staff_role_assignments r JOIN sb.staff_grants g USING(user_id) JOIN sb.accounts a USING(user_id) JOIN auth.users u ON u.id=r.user_id WHERE r.role_key='owner' AND r.active AND (r.expires_at IS NULL OR r.expires_at>now()) AND g.active AND a.status='active' AND a.email_verified_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND lower(a.email)=lower(u.email) AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.factor_type='totp' AND f.status='verified') AND EXISTS(SELECT 1 FROM sb.audit_events e WHERE e.actor_id=r.user_id AND e.action='auth.mfa_verified' AND e.created_at>"+start+")"));
 };

 const currentImage=()=>{const id=publicCompose(profile,['ps','-q','app']);must(/^[a-f0-9]{64}$/.test(id),'Brak jednego działającego app.');return JSON.parse(docker(['inspect',id]))[0];};
 const checkPaused=()=>{const r=publicCompose(profile,['ps','--services','--status','running']).split('\n');must(r.includes('postgres')&&!r.includes('app')&&!r.includes('auth'),'Aplikacja/Auth muszą pozostać wstrzymane do końca kopii/migracji.');};
 const checkPlan=async()=>{const p=await checkApplicationPlan({profile,directory:state.planDirectory});must(p.ownerBookApi===bookApi&&(!(bookMcp||bookOAuth)||p.ownerBookMcp===true)&&(!bookOAuth||p.ownerBookOAuth===true),'Nieprawidłowy zatwierdzony stan API Book.');checkMergedApplication(profile,state.planDirectory,p);return p;};
 const verifyBackups=async()=>{
  await verifyBackupArchive({directory:profile.sourceDirectory,...state.backups.database});
  const plan=await checkPlan();
  const files=await applicationBackupFiles(profile,state.planDirectory,plan);
  await verifiedTar(state.backups.configuration,{files,profile,plan});await verifiedTar(state.backups.certificates,{edge:true,profile,plan});
 };
 const verifyOffsite=async()=>{
  const manifestBytes=await readFile(path.join(state.bundle,'manifest.json'));must(hash(manifestBytes)===state.bundleManifestSha,'Zmieniono wykaz kopii.');const manifest=JSON.parse(manifestBytes);await privateRegular(path.join(state.bundle,'offsite-receipt.json'));const receipt=JSON.parse(await readFile(path.join(state.bundle,'offsite-receipt.json'),'utf8'));validateReceipt(manifest,receipt);
  for(const f of manifest.files)must(await hashFile(path.join(state.bundle,f.name))===f.sha256,'Zmieniono paczkę kopii.');
 };
 const verify=async()=>{
  await checkPlan();const c=currentImage();must(c.Image===state.image&&c.Config.Env.includes('RELEASE_SHA='+release)&&c.Config.Env.includes('OWNER_BOOK_API_ENABLED='+String(bookApi)),'Nie uruchomiono dokładnego obrazu lub wyłączonego API.');
  if(bookMcp||bookOAuth)must(c.Config.Env.includes('OWNER_BOOK_MCP_ENABLED=true'),'MCP flag mismatch.');
  validateApplied(sources,ledger());must(ledger().length===(bookOAuth?19:18),'Niekompletny ledger po migracji.');
  await verifyR1Http(release,{readOnly:true});verifyProtected(state);
  if(bookMcp||bookOAuth)await verifyMcpGate(true);
  if(bookOAuth){must(c.Config.Env.includes('OWNER_BOOK_OAUTH_ENABLED=true'),'OAuth flag mismatch.');await verifyOAuthGate(true);}
  const r=await fetch('https://shadow-bridge.eu/api/integrations/owner-book/v1/entries?kind=task',{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});must(bookApi?r.status===401&&(await r.json()).code==='BOOK_API_DENIED':r.status===503&&(await r.json()).code==='BOOK_API_DISABLED','Nieprawidłowa bramka API: dostęp bez klucza musi być odrzucony.');
 };
 const verifyMcpGate=async enabled=>{const r=await fetch('https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),redirect:'manual',signal:AbortSignal.timeout(10000)});const d=await r.json();must(enabled?r.status===401&&d.code==='BOOK_API_DENIED':r.status===503&&d.code==='BOOK_MCP_DISABLED','MCP anonymous gate mismatch.');};
 const verifyOAuthGate=async enabled=>{const r=await fetch('https://shadow-bridge.eu/.well-known/oauth-authorization-server',{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});const d=await r.json();must(enabled?r.status===200&&d.issuer==='https://shadow-bridge.eu'&&d.code_challenge_methods_supported?.includes('S256'):r.status===503&&d.code==='BOOK_OAUTH_DISABLED','OAuth discovery mismatch.');if(enabled){const x=await fetch('https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),redirect:'manual',signal:AbortSignal.timeout(10000)});must(x.status===401&&x.headers.get('www-authenticate')?.includes('resource_metadata='),'OAuth challenge missing.');}};
 const rollback=async()=>{
  // Never restart an old app while a migration container is still running.
  if(state.migratorName){const ids=docker(['ps','-q','--filter','name=^/'+state.migratorName+'$']);must(!ids,'Migrator nadal pracuje; nie wykonano automatycznego rollbacku.');}
  const applied=ledger();validateApplied(sources,applied);must(applied.length>=state.previousMigrationCount,'Nieprawidłowa historia po awarii.');
  if((migrationAttempted||state.migrated)&&!state.migrationPreserved){checkPaused();assertPreserved(state.before,await databaseFingerprints(profile.sourceDirectory),{allowMigrationBackfill:true});}
  await checkPlan();publicCompose(profile,['start','auth']);exec('sh',[path.join(state.planDirectory,'rollback-application.sh'),'--application-only-no-database-restore']);
  state.phase='ROLLED_BACK_APPLICATION_ONLY';await save();await verifyR1Http(state.previousRelease,{readOnly:true});verifyProtected(state);
 };
 try{
  await assertNoOtherReleaseLock(path.join(repositoryRoot,'.local'),folder);
  try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(phase==='prepare'&&!state){
   let previousAcceptance;
   if(bookMcp||bookOAuth){const previousStateFile=path.join(repositoryRoot,'.local','r1-owner-release-'+(bookOAuth?ownerBookMcpR1:ownerBookApiR1),'state.json');await privateRegular(previousStateFile);const old=JSON.parse(await readFile(previousStateFile,'utf8'));previousAcceptance=old;must(old.release===(bookOAuth?ownerBookMcpR1:ownerBookApiR1)&&old.purpose===(bookOAuth?'book-mcp':'book-api')&&old.phase==='DEPLOYED_AND_VERIFIED'&&old.ownerInteractiveAcceptance===true,'Accepted '+(bookOAuth?'35c41f7 MCP':'236e04b API')+' checkpoint required; do not rerun an earlier deployment.');}
   const inventory=await diagnose({runtimeRelease:runtimeBase});must(inventory.status==='READY FOR PREFLIGHT','Preflight BLOCKED: '+inventory.blockers.join(', '));
   profile=await checkProduction({directory:inventory.installation.sourceDirectory});await preflightExistingR1(profile,{runtimeRelease:runtimeBase});
   must(Math.min(inventory.disk.configurationFreeBytes,inventory.disk.dockerFreeBytes)>=Math.max(8*1024**3,8*inventory.database.databaseBytes+4*1024**3),'Za mało miejsca na pełne kopie, weryfikację i nowe obrazy.');
   must(recentOwnerCount()>0,'OWNER musi teraz zalogować się w przeglądarce i potwierdzić dotychczasowe TOTP.');
   const previous=currentImage(),buildLog=await open(path.join(folder,'build.log'),'wx',0o600);
   try{for(const target of bookApi&&!bookOAuth?['runtime']:['runtime','migrator'])exec('docker',['--context','default','build','--target',target,'--build-arg','SHADOWBRIDGE_RELEASE_SHA='+release,'-t',target==='runtime'?'shadowbridge-r1:'+release:profile.project+'-migrator','-f','deploy/staging/Dockerfile','.'],{stdio:['ignore',buildLog.fd,buildLog.fd],timeout:1200000});}finally{await buildLog.close();}
   const image=JSON.parse(docker(['image','inspect','shadowbridge-r1:'+release]))[0],migrator=bookApi&&!bookOAuth?null:JSON.parse(docker(['image','inspect',profile.project+'-migrator']))[0];must([image,...(migrator?[migrator]:[])].every(i=>i.Config.Labels['org.opencontainers.image.revision']===release),'Niezgodny obraz aplikacji/migratora.');
   const {directory}=await prepareApplicationPlan({profile,image:image.Id,releaseSha:release,previousImage:previous.Image,previousReleaseSha:inventory.application.release,ownerBookApi:bookApi,expectedPreviousReleaseSha:runtimeBase,previousAcceptance,ownerBookOAuth:bookOAuth?true:undefined,previousOwnerBookOAuth:bookOAuth?(previous.Config.Env.find(x=>x.startsWith('OWNER_BOOK_OAUTH_ENABLED='))?.split('=')[1]==='false'?false:undefined):undefined,ownerBookMcp:bookMcp||bookOAuth?true:undefined,previousOwnerBookMcp:bookOAuth?true:bookMcp?(previous.Config.Env.find(x=>x.startsWith('OWNER_BOOK_MCP_ENABLED='))?.split('=')[1]==='false'?false:undefined):undefined,previousOwnerBookApi:previous.Config.Env.find(x=>x.startsWith('OWNER_BOOK_API_ENABLED='))?.split('=')[1]==='true'?true:undefined});
   state={kind:'shadowbridge-r1-owner-release-v1',purpose,release,sourceDirectory:profile.sourceDirectory,planDirectory:directory,image:image.Id,migratorImage:migrator?.Id,previousRelease:inventory.application.release,previousImage:previous.Image,previousMigrationCount:inventory.database.migrationCount,protected:protectedServices(inventory),phase:'PLANNED'};await save();await checkPlan();
   paused=true;publicCompose(profile,['stop','app','auth']);
   const configuration=await backupApplicationConfiguration({profile,directory}),database=await backupInstallation(profile.sourceDirectory);
   state.before=await databaseFingerprints(profile.sourceDirectory);command('snapshot');
   publicCompose(profile,['stop','gateway']);let certificates;
   try{certificates=await backupGatewayVolumes({profile,directory});}finally{publicCompose(profile,['start','gateway']);}
   state.backups={database,configuration,certificates};await verifyBackups();
   const bundle='/home/shadowadmin/.shadowbridge-r1-'+release;await mkdir(bundle,{mode:0o700});
   const uid=Number(exec('id',['-u','shadowadmin'])),gid=Number(exec('id',['-g','shadowadmin']));await chown(bundle,uid,gid);
   const manifest={kind:'shadowbridge-r1-offsite-bundle-v1',release,nonce:randomUUID(),files:[]};
   for(const [name,pair]of Object.entries(state.backups))for(const [field,ext]of [['backupFile','sbb'],['keyFile','key']]){const file=name+'.'+ext,target=path.join(bundle,file);await privateRegular(pair[field]);await copyFile(pair[field],target,1);await chown(target,uid,gid);manifest.files.push({name:file,sha256:await hashFile(target),bytes:(await stat(target)).size});}
   await writeFile(path.join(bundle,'manifest.json'),JSON.stringify(manifest)+'\n',{mode:0o600,flag:'wx'});await chown(path.join(bundle,'manifest.json'),uid,gid);
   state.bundle=bundle;state.bundleManifestSha=hash(JSON.stringify(manifest)+'\n');state.phase='BACKUPS_VERIFIED_WAITING_OFFSITE';await save();
   console.log(JSON.stringify({status:state.phase,release,publicApplicationPaused:true,backupAuthenticated:true,backupRestoredOnProduction:false}));return;
  }
  must(state?.release===release&&(state.purpose??'foundation')===purpose,'Nie znaleziono przygotowanego wydania o tym przeznaczeniu.');profile=await checkProduction({directory:state.sourceDirectory});await checkPlan();
  if(phase==='verify'){must(bookOAuth&&state.phase==='DEPLOYED_AND_VERIFIED','Brak odebranego wydania OAuth.');await verify();console.log(JSON.stringify({status:'OAUTH_ENABLED_CHATGPT_NOT_CONNECTED',release,resumedWithoutDeployment:true,chatgptConnected:false}));return;}
  if(phase==='resume'){
   must(bookOAuth&&['MIGRATING','SCHEMA_VERIFIED','APP_STARTING'].includes(state.phase),'Nieznany etap wznowienia; STOP.');
   await verifyBackups();await verifyOffsite();validateApplied(sources,ledger());must(ledger().length===19,'Migracja nie jest potwierdzona; niczego nie powtórzono.');
   if(state.phase==='MIGRATING'){
    checkPaused();must(state.migratorName===profile.project+'-r1-'+release.slice(0,12),'Nieznany migrator.');
    const m=JSON.parse(docker(['inspect',state.migratorName]))[0];must(!m.State.Running&&m.State.ExitCode===0&&m.Image===state.migratorImage,'Migrator nadal działa albo nie zakończył się poprawnie.');
    assertPreserved(state.before,await databaseFingerprints(profile.sourceDirectory));command('preserved');state.migrated=true;state.schemaChanged=true;state.migrationPreserved=true;state.phase='SCHEMA_VERIFIED';await save();
   }
   must(state.migrationPreserved===true&&state.schemaChanged===true,'Niepotwierdzona ochrona danych.');
   if(state.phase==='SCHEMA_VERIFIED'){checkPaused();state.phase='APP_STARTING';await save();publicCompose(profile,['start','auth']);exec('sh',[path.join(state.planDirectory,'apply-application.sh'),'--after-reviewed-backup-and-migrations']);}
   // An interrupted start may have left the app stopped. Never rerun migrations.
   const id=publicCompose(profile,['ps','--all','-q','app']),c=JSON.parse(docker(['inspect',id]))[0];
   must([state.image,state.previousImage].includes(c.Image),'Nieznany obraz podczas wznowienia.');
   if(!c.State.Running){publicCompose(profile,['start','auth']);exec('sh',[path.join(state.planDirectory,'apply-application.sh'),'--after-reviewed-backup-and-migrations']);}
   try{await verify();}catch(e){publicCompose(profile,['stop','app','auth']);await rollback();throw e;}
   state.phase='DEPLOYED_PENDING_OWNER_ACCEPTANCE';state.appliedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:state.phase,release,migrationsRepeated:false,chatgptConnected:false}));return;
  }
  if(phase==='prepare'){must(state.phase==='BACKUPS_VERIFIED_WAITING_OFFSITE','Istniejący checkpoint wymaga kontroli operatora; nie powtórzono operacji.');checkPaused();console.log(JSON.stringify({status:state.phase,release,resumed:true}));return;}
  if(phase==='off'){
   must(bookApi&&['DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED','API_DISABLED','MCP_DISABLED','OAUTH_DISABLED'].includes(state.phase),'Nie ma aktywnej generacji API do wyłączenia.');
   const c=currentImage();must(c.Image===state.image&&c.Config.Env.includes('RELEASE_SHA='+release),'Nie zmieniono nieznanej aplikacji.');
   docker(disabledApplicationArguments(profile,state.planDirectory,{mcpOnly:bookMcp,oauthOnly:bookOAuth}));
   if(bookOAuth){await verifyOAuthGate(false);state.phase='OAUTH_DISABLED';await save();console.log(JSON.stringify({status:state.phase,release,restApiPreserved:true,mcpPreserved:true,accountsChanged:false}));return;}
   if(bookMcp){await verifyMcpGate(false);state.phase='MCP_DISABLED';await save();console.log(JSON.stringify({status:state.phase,release,restApiPreserved:true,accountsChanged:false}));return;}
   const r=await fetch('https://shadow-bridge.eu/api/integrations/owner-book/v1/entries?kind=task',{redirect:'manual',signal:AbortSignal.timeout(10000)});must(r.status===503&&(await r.json()).code==='BOOK_API_DISABLED','Nie potwierdzono wyłączenia API.');
   state.phase='API_DISABLED';await save();console.log(JSON.stringify({status:state.phase,release,accountsChanged:false}));return;
  }
  if(phase==='cancel'){
   must(state.phase==='BACKUPS_VERIFIED_WAITING_OFFSITE'&&ledger().length===state.previousMigrationCount,'Nie wolno anulować etapu po migracji tą ścieżką.');
   const id=publicCompose(profile,['ps','--all','-q','app']),app=JSON.parse(docker(['inspect',id]))[0];must(app.Image===state.previousImage,'Nie przywrócono nieznanego kontenera.');
   publicCompose(profile,['start','auth','app']);state.phase='CANCELLED_BEFORE_MIGRATION';await save();console.log(JSON.stringify({status:state.phase,release:state.previousRelease,backupsRetained:true}));return;
  }
  if(phase==='apply'){
   must(state.phase==='BACKUPS_VERIFIED_WAITING_OFFSITE','Nieprawidłowy checkpoint aktualizacji.');
   await controlledApply({check:async()=>{checkPaused();await checkPlan();},verifyBackups,verifyOffsite,preservedBefore:async()=>assertPreserved(state.before,await databaseFingerprints(profile.sourceDirectory)),migrate:async()=>{
    if(bookApi&&!bookOAuth){state.phase='REPLACING_APP_NO_MIGRATIONS';state.schemaChanged=false;await save();return;}
    state.migratorName=profile.project+'-r1-'+release.slice(0,12);must(!docker(['ps','-aq','--filter','name=^/'+state.migratorName+'$']),'Zachowany kontener migratora wymaga przeglądu, bez ponawiania.');
    must(JSON.parse(docker(['image','inspect',profile.project+'-migrator']))[0].Id===state.migratorImage,'Niezgodny niezmienny obraz migratora.');state.phase='MIGRATING';await save();migrationAttempted=true;publicCompose(profile,['run','--name',state.migratorName,'--no-deps','--pull','never','migrator']);state.migrated=true;state.schemaChanged=true;await save();
   },preservedAfter:async()=>{command('preserved');state.migrationPreserved=true;if(bookOAuth)state.phase='SCHEMA_VERIFIED';await save();},start:async()=>{if(bookOAuth){state.phase='APP_STARTING';await save();}publicCompose(profile,['start','auth']);exec('sh',[path.join(state.planDirectory,'apply-application.sh'),'--after-reviewed-backup-and-migrations']);},verify,rollback:async()=>{
    // Stop only the new app/Auth so protected-data comparison has a stable view.
    publicCompose(profile,['stop','app','auth']);await rollback();
   }});
   state.phase='DEPLOYED_PENDING_OWNER_ACCEPTANCE';state.appliedAt=new Date().toISOString();await save();console.log(JSON.stringify({status:state.phase,release,remoteBookApiEnabled:bookApi,remoteBookMcpEnabled:bookMcp||bookOAuth,remoteBookOAuthEnabled:bookOAuth,mcpAuthenticatedReadVerified:false,chatgptConnected:false,accountsPreserved:true}));return;
  }
  if(phase==='rollback'){must(['DEPLOYED_PENDING_OWNER_ACCEPTANCE','DEPLOYED_AND_VERIFIED'].includes(state.phase),'Nieprawidłowy etap rollbacku.');publicCompose(profile,['stop','app','auth']);await rollback();console.log(JSON.stringify({status:state.phase,release:state.previousRelease,databaseRestored:false}));return;}
  must(state.phase==='DEPLOYED_PENDING_OWNER_ACCEPTANCE','Odbiór nie jest dostępny dla tego checkpointu.');
  await verify();must(recentOwnerCount(state.appliedAt)>0,'Brak potwierdzenia istniejącego OWNER + MFA po aktualizacji.');
  state.phase='DEPLOYED_AND_VERIFIED';state.ownerInteractiveAcceptance=true;await save();console.log(JSON.stringify({status:bookOAuth?'OAUTH_ENABLED_CHATGPT_NOT_CONNECTED':bookMcp?'MCP_ENABLED_CHATGPT_NOT_CONNECTED':bookApi?'API_ENABLED_CHATGPT_NOT_CONNECTED':state.phase,release,ownerInteractiveAcceptance:true,remoteBookApiEnabled:bookApi,remoteBookMcpEnabled:bookMcp||bookOAuth,remoteBookOAuthEnabled:bookOAuth,mcpAuthenticatedReadVerified:false,chatgptConnected:false}));
 }catch(e){
  // A pre-migration preparation error must resume existing services. A recorded
  // successful backup intentionally holds them paused for offsite transfer.
  if(paused&&state?.phase!=='BACKUPS_VERIFIED_WAITING_OFFSITE'&&!migrationAttempted)try{publicCompose(profile,['start','gateway','auth','app']);}catch{}
  throw e;
 }finally{await unlink(lock);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,...args]=process.argv.slice(2);must(args.length>=1&&args.length<=2&&args[0].startsWith('--release=')&&(args.length===1||['--book-api','--book-mcp','--book-oauth'].includes(args[1])),'Use prepare|apply|accept|rollback|cancel|off|resume|verify --release=FULL_SHA [--book-api|--book-mcp|--book-oauth]');
 runRelease({phase,release:args[0].slice(10),bookApi:args.includes('--book-api'),bookMcp:args.includes('--book-mcp'),bookOAuth:args.includes('--book-oauth')}).catch(e=>{console.error(JSON.stringify({status:'BLOCKED',reason:e.message,deploymentNotClaimed:true}));process.exitCode=1;});
}
