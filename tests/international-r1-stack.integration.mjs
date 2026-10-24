// Real images + production Compose, exclusively on an explicitly isolated
// Docker daemon. Local Caddy CA replaces ACME; no production DNS/mail/SSH.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHmac,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import {prepareStaging,readEnv,repositoryRoot as root} from '../scripts/staging-prepare.mjs';
import {prepareProduction,checkProduction} from '../scripts/production-config.mjs';
import {productionBase,prepareGatewayProfile,saveGatewayState} from '../scripts/n8n-gateway-profile.mjs';
import {publicComposeArguments,databaseFingerprints,assertPreserved} from '../scripts/production-ops.mjs';
import {prepareApplicationPlan,checkMergedApplication,backupApplicationConfiguration,backupGatewayVolumes,verifyR1Http,preflightExistingR1} from '../scripts/international-r1.mjs';
import {backupStaging,decryptBackup,restoreConfiguration,decryptArchive} from '../scripts/staging-backup.mjs';
import {restoredVaultRolesSql} from '../scripts/vault-recovery-roles.mjs';
import {restoredSentinelRoleSql} from '../scripts/staging-ops.mjs';
import {inspectSpace} from '../scripts/workspace-space.mjs';

const privateRoot='/tmp/shadowbridge-r1-isolated';
assert.equal(process.env.SHADOWBRIDGE_R1_ISOLATED_TEST,'1','Explicit isolated fixture opt-in is required');
assert.ok(process.env.PATH.startsWith(privateRoot+'/bin:'),'Use the reviewed isolated Docker wrapper, never default Docker');
const docker=(args,input)=>execFileSync('docker',args,{cwd:root,encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:32*1024**2}).trim();
assert.equal(JSON.parse(docker(['info','--format','{{json .}}'])).DockerRootDir,privateRoot+'/overlay-data');
assert.equal(docker(['info','--format','{{.Driver}}']),'overlay2');
assert.equal((await inspectSpace({directory:privateRoot})).result,'PASS','Disk/inode/Docker isolation budget must pass before starting a fixture');
const arg=process.argv.find(v=>v.startsWith('--dir='))?.slice(6);
const id=arg?path.basename(arg).replace('r1-stack-',''):randomBytes(5).toString('hex');assert.match(id,/^[a-f0-9]{10}$/);
const directory=path.join(root,'.local','r1-stack-'+id),stateFile=path.join(directory,'state.json');
let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const candidate=JSON.parse(docker(['image','inspect','shadowbridge-r1-full:candidate']))[0];
state||={kind:'fictional-r1-full-stack-v1',project:'shadowbridge-stageg-r1full-'+id,cases:[],actors:{},sourceSha:candidate.Config.Labels['org.opencontainers.image.revision']};
assert.match(state.sourceSha,/^[a-f0-9]{40}$/);assert.equal(state.sourceSha,candidate.Config.Labels['org.opencontainers.image.revision']);
assert.equal(state.kind,'fictional-r1-full-stack-v1');assert.equal(state.project,'shadowbridge-stageg-r1full-'+id);
if(process.argv.includes('--repeat-recovery')){
 assert.ok(arg,'Repeat recovery requires the existing explicit fixture');
 state.previousRecoveryResults||=[];
 state.cases=state.cases.filter(c=>{if(c.name.startsWith('full encrypted backup')){state.previousRecoveryResults.push(c);return false;}return true;});
}
const result={kind:'real-international-r1-production-images',cases:state.cases,sourceSha:state.sourceSha,realN8n:true,publicAcmeTested:false,contaboDeployed:false,mailSent:false};
const save=async()=>writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const image=name=>JSON.parse(docker(['image','inspect',name]))[0].Id;
const requestAddress=process.env.SHADOWBRIDGE_R1_TEST_GATEWAY_ADDRESS;assert.match(requestAddress||'',/^172[.]17[.]0[.]\d+$/);
let profile,ca,h,current='prepare',actors={},port=443;
const compose=(p,args)=>docker(['--context','default',...publicComposeArguments(p,args)]);
const sql=(p,query)=>compose(p,['exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','shadowbridge','-c',query]);
const oldFetch=globalThis.fetch;
async function transport(input,options={}){
 const u=new URL(input);assert.ok(['shadow-bridge.eu','automation.shadow-bridge.eu','localhost'].includes(u.hostname),'No remote HTTP requests');
 const hostname=u.hostname==='automation.shadow-bridge.eu'?u.hostname:'shadow-bridge.eu';
 const headers=new Headers(options.headers);headers.set('Host',hostname);
 if(headers.has('Origin'))headers.set('Origin','https://shadow-bridge.eu');
 return new Promise((resolve,reject)=>{
  const req=https.request({host:requestAddress,port,servername:hostname,ca,method:options.method||'GET',path:u.pathname+u.search,headers:Object.fromEntries(headers)},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const hs=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)hs.append(res.rawHeaders[i],res.rawHeaders[i+1]);resolve(new Response(options.method==='HEAD'?null:Buffer.concat(chunks),{status:res.statusCode,headers:hs}));});
  });req.setTimeout(15000,()=>req.destroy(new Error('Isolated HTTPS timeout')));req.on('error',reject);req.end(options.body);
 });
}
async function ready(){
 for(let i=0;i<120;i++){try{if((await transport('https://shadow-bridge.eu/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,500));}throw new Error('Real app TLS readiness failed');
}
async function phase(name,fn){current=name;if(state.cases.some(c=>c.name===name&&c.result==='PASS')){console.log('RETAINED PASS: '+name);return;}assert.equal((await inspectSpace({directory:privateRoot})).result,'PASS','Resource reserve exceeded; preserve checkpoint and stop');await fn();state.cases.push({name,result:'PASS'});await save();console.log('PASS: '+name);}
async function testOverlay(p,published){
 const gateway=path.join(p.sourceDirectory,'test-only.Caddyfile');
 let caddy=await readFile(path.join(p.sourceDirectory,'automation-gateway','Caddyfile'),'utf8');
 caddy=caddy.replace('{\n','{\n\tauto_https disable_redirects\n').replace('https://shadow-bridge.eu {','https://shadow-bridge.eu {\n\ttls internal').replace('https://automation.shadow-bridge.eu {','https://automation.shadow-bridge.eu {\n\ttls internal');
 await writeFile(gateway,caddy,{mode:0o600});
 const overlay=path.join(p.sourceDirectory,'test-only.yaml');
 await writeFile(overlay,`services:\n  postgres:\n    image: ${image('postgres:17-alpine')}\n  auth:\n    image: ${image('supabase/gotrue:v2.184.0')}\n  gateway:\n    image: ${image('caddy:2-alpine')}\n    ports: !override\n      - target: 443\n        published: "${published}"\n        protocol: tcp\n        host_ip: 0.0.0.0\n    volumes:\n      - type: bind\n        source: ${gateway}\n        target: /etc/caddy/Caddyfile\n        read_only: true\n`,{mode:0o600});
 const wrapper=JSON.parse(await readFile(privateRoot+'/wrapper.json','utf8'));wrapper.overlays[p.project]=overlay;await writeFile(privateRoot+'/wrapper.json',JSON.stringify(wrapper),{mode:0o600});
}
async function getCa(p){
 const gateway=compose(p,['ps','--all','--quiet','gateway']);
 const target=path.join(p.sourceDirectory,'test-caddy-root.crt');docker(['cp',gateway+':/data/caddy/pki/authorities/local/root.crt',target]);return readFile(target);
}
const encodeActors=()=>Object.fromEntries(Object.entries(actors).map(([role,a])=>[role,{...a,client:{cookies:[...a.client.cookies],csrf:a.client.csrf}}]));
try{
 await phase('fresh isolated production profile, real n8n and exact pinned cache images',async()=>{
  if(!arg)assert.equal(docker(['ps','-aq']),'','New dedicated daemon must have no containers');
  const s=await prepareStaging({directory,project:state.project,httpsPort:18477,httpPort:18478});await save();
  let p=await prepareProduction({directory:s.directory,releaseSha:productionBase});await prepareGatewayProfile(p);await saveGatewayState(p,{phase:'active'});p=await checkProduction({directory});
  await testOverlay(p,443);
  docker(['tag','shadowbridge-r1-full:baseline',p.project+'-app']);docker(['tag','shadowbridge-r1-migrate:baseline',p.project+'-migrator']);
  if(!docker(['network','ls','-q','--filter','name=^shadowbridge-edge$']))docker(['network','create','--internal','shadowbridge-edge']);
  assert.equal(JSON.parse(docker(['network','inspect','shadowbridge-edge']))[0].Internal,true);
  if(!docker(['ps','-aq','--filter','name=^shadowbridge-automation-n8n-1$']))docker(['run','-d','--name','shadowbridge-automation-n8n-1','--network','shadowbridge-edge','--read-only','--tmpfs','/tmp','--tmpfs','/home/node/.cache:rw,uid=1000,gid=1000,mode=0700','--cap-drop','ALL','--security-opt','no-new-privileges:true','--env','N8N_HOST=automation.shadow-bridge.eu','--env','N8N_PROTOCOL=https','--env','N8N_WEBHOOK_URL=https://automation.shadow-bridge.eu/','--env','N8N_EDITOR_BASE_URL=https://automation.shadow-bridge.eu','--env','N8N_PROXY_HOPS=1','--env','N8N_DIAGNOSTICS_ENABLED=false','--env','N8N_VERSION_NOTIFICATIONS_ENABLED=false','--volume','r1-n8n-fictional:/home/node/.n8n',image('n8nio/n8n:2.44.6')]);
  compose(p,['up','-d','--no-build','--pull','never','--wait','--wait-timeout','120','postgres','auth']);
  for(let i=0;;i++){try{docker(['exec',compose(p,['ps','-q','postgres']),'wget','-qO-','-T','2','http://auth:9999/health']);break;}catch(e){if(i===80)throw e;await new Promise(r=>setTimeout(r,250));}}
  const migrator=p.project+'-migration-015';
  if(docker(['ps','-aq','--filter','name=^'+migrator+'$'])){docker(['start','--attach',migrator]);assert.equal(JSON.parse(docker(['inspect',migrator]))[0].State.ExitCode,0);}else compose(p,['run','--name',migrator,'--no-deps','migrator']);
  assert.equal(sql(p,'SELECT count(*) FROM shadowbridge_migrations.applied'),'15');
  compose(p,['up','-d','--no-build','--pull','never','--wait','--wait-timeout','120','app','gateway']);
 });
 profile=await checkProduction({directory});docker(['start','shadowbridge-automation-n8n-1']);compose(profile,['start','postgres','auth','app','gateway']);
 for(let i=0;;i++){try{ca=await getCa(profile);break;}catch(e){if(i===30)throw e;await new Promise(r=>setTimeout(r,300));}}globalThis.fetch=transport;await ready();
 process.env.SHADOWBRIDGE_TEST_URL='https://localhost:18477';process.env.SHADOWBRIDGE_DB_CONTAINER=compose(profile,['ps','-q','postgres']);process.env.SHADOWBRIDGE_TEST_DATABASE='shadowbridge';h=await import('../server/tests/helpers.mjs');
 for(const [role,a]of Object.entries(state.actors)){assert.match(a.email,/@test[.]shadowbridge[.]invalid$/);const client=new h.Client();client.cookies=new Map(a.client.cookies);client.csrf=a.client.csrf;actors[role]={...a,client};}
 await phase('real baseline credentials, OWNER MFA and company records over verified DB/Auth/public TLS',async()=>{
  assert.equal(sql(profile,'SELECT count(*) FROM auth.users'),'0');
  const auth=await readEnv(path.join(profile.directory,'auth.env'));
  const part=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const jwt=part+'.'+createHmac('sha256',auth.GOTRUE_JWT_SECRET).update(part).digest('base64url');
  for(const role of ['owner','buyer']){
   const a={email:`${id}.full.${role}@test.shadowbridge.invalid`,password:h.password(),client:new h.Client()};
   const script=`const r=await fetch('https://auth-proxy:8444/auth/v1/admin/users',{method:'POST',headers:{Authorization:${JSON.stringify('Bearer '+jwt)},'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({email:a.email,password:a.password,email_confirm:true})})});if(r.status!==200)process.exit(1);process.stdout.write(await r.text());`;
   a.user=JSON.parse(docker(['exec','-i',compose(profile,['ps','-q','app']),'node','--input-type=module'],script));
   await a.client.signIn(a);actors[role]=a;
   if(role==='owner'){h.bootstrapOwner(a);await h.enableMfa(a);}else{
    await a.client.request('/api/application',{method:'POST',body:{role:'buyer',company:{name:'FICTIONAL R1 full stack buyer',country:'NO',registrationNumber:'DEMO-'+id},profile:{countries:['NO'],sectors:['Industrial supplies'],summary:'FICTIONAL isolated release test company, no real counterparty.'}},expected:201});
    const app=sql(profile,`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(a.user.id)}::uuid`);
    await actors.owner.client.request('/api/admin/applications/'+app+'/decision',{method:'POST',body:{decision:'approved',reason:'FICTIONAL isolated release fixture reviewed manually.'},expected:200});
   }
  }
  await actors.owner.client.request('/api/staff/overview',{expected:200});
  const category=await h.catalogCategory(actors.buyer.client);
  state.rfq=(await actors.buyer.client.request('/api/rfqs',{method:'POST',body:{data:{...category,product:'FICTIONAL release RFQ',specifications:'Fictional non-identifying material.',quantity:7,unit:'tonne',currency:'PLN',budget:1000,deliveryCountry:'NO',deadline:new Date(Date.now()+60*86400000).toISOString().slice(0,10)}},expected:201})).data.item.id;
  assert.equal(sql(profile,"SELECT bool_and(ssl) FROM pg_stat_ssl JOIN pg_stat_activity USING(pid) WHERE usename IN ('shadowbridge_api','shadowbridge_sessions','supabase_auth_admin')"),'t');
  state.actors=encodeActors();
 });
 await phase('app-only production plan, authenticated backups and migrations 016/017 preserve all existing rows',async()=>{
  const planned=await prepareApplicationPlan({profile,image:image('shadowbridge-r1-full:candidate'),releaseSha:state.sourceSha,previousImage:image('shadowbridge-r1-full:baseline'),previousReleaseSha:productionBase});state.plan=planned.directory;
  checkMergedApplication(profile,state.plan,planned.plan);state.configBackup=await backupApplicationConfiguration({profile,directory:state.plan});
  compose(profile,['stop','app','auth']);
  state.before=await databaseFingerprints(directory);
  state.preMigrationBackup=await backupStaging({directory,backupFile:path.join(directory,'before-016.sbb'),keyFile:path.join(directory,'before-016.key')});
  docker(['tag','shadowbridge-r1-migrate:candidate',profile.project+'-migrator']);
  compose(profile,['run','--name',profile.project+'-migration-017','--no-deps','migrator']);
  assert.equal(sql(profile,'SELECT count(*) FROM shadowbridge_migrations.applied'),'17');
  assertPreserved(state.before,await databaseFingerprints(directory),{allowMigrationBackfill:true});
  compose(profile,['start','auth']);
  execFileSync(path.join(state.plan,'apply-application.sh'),['--after-reviewed-backup-and-migrations'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});await ready();
  assert.equal(JSON.parse(docker(['inspect',compose(profile,['ps','-q','app'])]))[0].Image,image('shadowbridge-r1-full:candidate'));
 });
 await phase('actual R1 image, real n8n HTTPS and retained OWNER/Buyer sessions, MFA, RFQ and VAULT',async()=>{
  // n8n health can become ready before its editor assets are generated.
  for(let i=0;;i++){try{const health=await transport('https://automation.shadow-bridge.eu/healthz'),signin=await transport('https://automation.shadow-bridge.eu/signin');if(health.status===200&&signin.status===200)break;}catch{}if(i===80)throw new Error('Real n8n health/editor did not become ready');await new Promise(r=>setTimeout(r,500));}
  const verified=await verifyR1Http(state.sourceSha,{request:transport});assert.equal(verified.automationHttpVerified,true);
  for(const role of ['owner','buyer'])assert.equal((await actors[role].client.request('/api/session',{expected:200})).data.user.id,actors[role].user.id);
  assert.equal((await actors.owner.client.request('/api/session',{expected:200})).data.user.aal,'aal2');
  await actors.owner.client.request('/api/owner/vault/companies',{expected:200});await actors.buyer.client.request('/api/owner/vault/companies',{expected:403});
  await actors.buyer.client.request('/api/rfqs/'+state.rfq,{expected:200});
  await actors.owner.client.request('/api/auth/mfa/verify',{method:'POST',body:{factorId:actors.owner.factorId,code:h.totp(actors.owner.mfaSecret)},expected:200});
  const record={company:{name:'FICTIONAL R1 recovery company',country:'NO',registrationNumber:'FICTIONAL-'+id,sector:'Fictional trade'},contact:{fullName:'FICTIONAL Alex Example',title:'FICTIONAL Manager',workEmail:'fictional-'+id+'@test.shadowbridge.invalid',emailKind:'individual'},source:{system:'manual',recordId:'r1-'+id}};
  await actors.owner.client.request('/api/owner/vault/contacts',{method:'POST',body:{record,requestKey:randomUUID()},expected:201});state.actors=encodeActors();
 });
 await phase('immutable image rollback and reapply retain SQL 017, sessions, MFA and newly created VAULT data',async()=>{
  compose(profile,['stop','app','auth']);const before=await databaseFingerprints(directory);compose(profile,['start','auth']);
  execFileSync(path.join(state.plan,'rollback-application.sh'),['--application-only-no-database-restore'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});await ready();
  assert.equal(JSON.parse(docker(['inspect',compose(profile,['ps','-q','app'])]))[0].Image,image('shadowbridge-r1-full:baseline'));
  assert.equal((await transport('https://shadow-bridge.eu/health')).headers.get('x-shadowbridge-release'),productionBase);
  assert.equal((await preflightExistingR1(profile,{request:transport})).readOnly,true);
  compose(profile,['stop','app','auth']);assertPreserved(before,await databaseFingerprints(directory));compose(profile,['start','auth']);
  execFileSync(path.join(state.plan,'apply-application.sh'),['--after-reviewed-backup-and-migrations'],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});await ready();
  assert.equal((await actors.owner.client.request('/api/session',{expected:200})).data.user.aal,'aal2');await actors.owner.client.request('/api/owner/vault/companies',{expected:200});
 });
 await phase('full encrypted backup restores into a separate production Compose project including persistent Caddy certificates',async()=>{
  const attempt=randomBytes(3).toString('hex'),work=path.join(directory,'recovery-'+attempt);await mkdir(work,{mode:0o700});
  compose(profile,['stop','app','auth']);const expected=await databaseFingerprints(directory);
  state.fullBackup=await backupStaging({directory,backupFile:path.join(work,'full-017.sbb'),keyFile:path.join(work,'full-017.key')});
  compose(profile,['stop','gateway']);
  state.edgeBackup=await backupGatewayVolumes({profile,directory:state.plan});
  const extracted=await decryptBackup({...state.fullBackup,destination:path.join(root,'.local','restore-r1full-'+id+'-'+attempt)});
  const recovered=await restoreConfiguration({restoredDirectory:extracted.directory,directory:path.join(root,'.local','contabo-restore-r1full-'+id+'-'+attempt),project:'shadowbridge-stageg-restore-r1full-'+id+'-'+attempt,httpsPort:19443});
  let p=await prepareProduction({directory:recovered.directory,releaseSha:productionBase});await prepareGatewayProfile(p);await saveGatewayState(p,{phase:'active'});p=await checkProduction({directory:recovered.directory});
  // Authenticate the second archive as well. Relocate only this NEW target's
  // paths/project manifests; preserve the original public proxy token and all
  // Auth/session/database secrets. Never rewrite the source configuration.
  const configTar=path.join(work,'authenticated-production.tar'),configCopy=path.join(work,'authenticated-production');await mkdir(configCopy,{mode:0o700});
  await decryptArchive({...state.configBackup,archiveFile:configTar});execFileSync('tar',['-xf',configTar,'-C',configCopy]);
  const plan=JSON.parse(await readFile(path.join(state.plan,'plan.json'),'utf8'));
  for(const [file,hash]of Object.entries(plan.fingerprints).filter(([f])=>f.startsWith(directory+path.sep))){const copy=path.join(configCopy,path.relative(directory,file));assert.equal(createHash('sha256').update(await readFile(copy)).digest('hex'),hash);}
  const publicCopy=path.join(configCopy,path.relative(directory,profile.directory)),targetManifestFile=path.join(p.directory,'manifest.json'),targetManifest=JSON.parse(await readFile(targetManifestFile,'utf8'));
  for(const file of ['app.env','auth.env','proxy-token']){const bytes=await readFile(path.join(publicCopy,file));await writeFile(path.join(p.directory,file),bytes,{mode:0o600});targetManifest.hashes[file]=createHash('sha256').update(bytes).digest('hex');}
  await writeFile(targetManifestFile,JSON.stringify(targetManifest,null,2)+'\n',{mode:0o600});
  // A NEW target gateway manifest is bound to its relocated production manifest.
  const targetGatewayFile=path.join(p.sourceDirectory,'automation-gateway','manifest.json'),targetGateway=JSON.parse(await readFile(targetGatewayFile,'utf8'));
  targetGateway.baseProductionManifestSha=createHash('sha256').update(await readFile(targetManifestFile)).digest('hex');await writeFile(targetGatewayFile,JSON.stringify(targetGateway,null,2)+'\n',{mode:0o600});
  p=await checkProduction({directory:p.sourceDirectory});
  state.restoreDirectory=p.sourceDirectory;await testOverlay(p,19443);
  docker(['tag','shadowbridge-r1-full:candidate',p.project+'-app']);docker(['tag','shadowbridge-r1-migrate:candidate',p.project+'-migrator']);
  // Restore only into this newly created, demonstrably empty target.
  assert.equal(docker(['ps','-aq','--filter','label=com.docker.compose.project='+p.project]),'');
  compose(p,['up','-d','--no-build','--pull','never','--wait','postgres']);
  assert.equal(sql(p,"SELECT to_regclass('auth.users') IS NULL AND to_regnamespace('sb') IS NULL"),'t');
  sql(p,restoredVaultRolesSql);
  docker(['exec','-i',compose(p,['ps','-q','postgres']),'pg_restore','--clean','--if-exists','--exit-on-error','-U','postgres','-d','shadowbridge'],await readFile(extracted.databaseDump));
  sql(p,restoredSentinelRoleSql);assertPreserved(expected,await databaseFingerprints(p.sourceDirectory));assertPreserved(expected,await databaseFingerprints(directory));
  const ledger="SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY name)::text) FROM shadowbridge_migrations.applied t";
  assert.equal(sql(p,'SELECT count(*) FROM shadowbridge_migrations.applied'),'17');assert.equal(sql(p,ledger),sql(profile,ledger));
  // App SHA is an explicit test-only override, not a change to the restored anchor.
  const testFile=path.join(p.sourceDirectory,'test-only.yaml');await writeFile(testFile,(await readFile(testFile,'utf8'))+'  app:\n    environment:\n      RELEASE_SHA: '+state.sourceSha+'\n',{mode:0o600});
  compose(p,['create','--no-build','--pull','never','app','auth','gateway']);
  const edgeTar=path.join(work,'authenticated-edge.tar'),edge=path.join(work,'authenticated-edge');await mkdir(edge,{mode:0o700});
  await decryptArchive({...state.edgeBackup,archiveFile:edgeTar});execFileSync('tar',['-xf',edgeTar,'-C',edge]);
  const meta=JSON.parse(await readFile(path.join(edge,'edge.json'),'utf8'));assert.equal(meta.project,profile.project);
  const dest=compose(p,['ps','--all','--quiet','gateway']);
  for(const target of ['/data','/config']){
   // Fresh volumes: inspect before copying; never overwrite a running target.
   const info=JSON.parse(docker(['inspect',dest]))[0];assert.equal(info.State.Running,false);
   assert.ok(info.Mounts.find(m=>m.Destination===target&&m.Type==='volume').Name.startsWith(p.project+'_'));
   docker(['cp',path.join(edge,target.slice(1))+'/.',dest+':'+target]);
  }
  const copied=path.join(work,'restored-edge-proof');await mkdir(copied,{mode:0o700});
  for(const name of ['data','config']){await mkdir(path.join(copied,name),{mode:0o700});docker(['cp',dest+':/'+name+'/.',path.join(copied,name)]);}
  for(const [file,hash]of Object.entries(meta.hashes)){assert.equal(createHash('sha256').update(await readFile(path.join(edge,file))).digest('hex'),hash);assert.equal(createHash('sha256').update(await readFile(path.join(copied,file))).digest('hex'),hash);}
  compose(p,['start','auth','app','gateway']);port=19443;ca=await getCa(p);assert.deepEqual(ca,await readFile(path.join(profile.sourceDirectory,'test-caddy-root.crt')));await ready();
  await verifyR1Http(state.sourceSha,{request:transport});
  assert.equal((await actors.owner.client.request('/api/session',{expected:200})).data.user.aal,'aal2');await actors.owner.client.request('/api/owner/vault/companies',{expected:200});
  assert.equal((await actors.buyer.client.request('/api/session',{expected:200})).data.user.id,actors.buyer.user.id);await actors.buyer.client.request('/api/rfqs/'+state.rfq,{expected:200});
  const login=new h.Client();assert.equal((await login.signIn(actors.buyer)).session.user.id,actors.buyer.user.id);
  state.restoredTables=Object.keys(expected).filter(x=>!x.startsWith('permission:')).length;
  state.caddyFilesRestored=Object.keys(meta.hashes).length;
  state.publicGatewayConfigurationRestored=true;
  state.migrationLedgerPreserved=true;
  compose(p,['stop']);port=443;ca=await getCa(profile);compose(profile,['start','auth','app','gateway']);await ready();
 });
 result.result='PASS';
}catch(error){result.result='FAIL';result.failedCase=current;result.errorType=error.name;await writeFile(path.join(directory,'failure.json'),JSON.stringify({phase:current,message:error.message,stack:error.stack,stderr:String(error.stderr||'').slice(-12000)})+'\n',{mode:0o600});console.error('FAIL: '+current+'; private diagnostics retained.');process.exitCode=1;}
finally{
 globalThis.fetch=oldFetch;state.actors=encodeActors();await save();
 for(const dir of [directory,state.restoreDirectory].filter(Boolean)){try{compose(await checkProduction({directory:dir}),['stop']);}catch{}}
 try{docker(['stop','shadowbridge-automation-n8n-1']);}catch{}
 result.restoredTables=state.restoredTables;result.migrationLedgerPreserved=state.migrationLedgerPreserved||false;result.caddyFilesRestored=state.caddyFilesRestored;result.publicGatewayConfigurationRestored=state.publicGatewayConfigurationRestored||false;result.finishedAt=new Date().toISOString();result.fixtureStoppedWithoutDeletion=true;
 await writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log('CHECKPOINT: '+directory);
}
