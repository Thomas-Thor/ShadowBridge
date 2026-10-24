// Host-only, gateway-only operation. No SSH, DNS changes, app build, migrations,
// database commands, n8n restart, credential changes or volume removal.
import { execFileSync } from 'node:child_process';
import { open, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProduction } from './production-config.mjs';
import { publicComposeArguments } from './production-ops.mjs';
import { repositoryRoot } from './staging-prepare.mjs';
import { productionBase, automationOrigin, edgeNetwork, n8nContainer, caddyImage, gatewayFolder, gatewayState, saveGatewayState, prepareGatewayProfile, checkGatewayProfile, sha } from './n8n-gateway-profile.mjs';

const must=(ok,message)=>{if(!ok)throw new Error(message);};
const permitted=new Set(['deploy/automation/Caddyfile.append','scripts/n8n-gateway.mjs','scripts/n8n-gateway-profile.mjs','scripts/production-config.mjs','scripts/production-ops.mjs','tests/n8n-gateway.test.mjs','tests/n8n-gateway.integration.mjs','docs/N8N-HTTPS-GATEWAY.md','docs/N8N-HTTPS-GATEWAY-RESULTS.json']);
export function assertPatchPaths(paths){must(paths.every(p=>permitted.has(p)),'STOP: gałąź zawiera zmiany aplikacji/migracji poza poprawką bramy.');}
function checkCode(){
 const git=args=>execFileSync('git',args,{cwd:repositoryRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['merge-base','--is-ancestor',productionBase,'HEAD']);
 assertPatchPaths(git(['diff','--name-only',productionBase,'HEAD']).split('\n').filter(Boolean));
 must(!git(['diff','--name-only','HEAD']),'STOP: niezapisane zmiany śledzonych plików.');
}
const docker=(args,{input,...options}={})=>{
 try{return execFileSync('docker',['--context','default',...args],{cwd:repositoryRoot,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024,timeout:120000,input,...options}).trim();}
 catch{throw new Error('Operacja Docker przerwana. Nie publikuj surowych inspect/config/logów; zachowaj dane i pliki stanu.');}
};
const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
export function assertN8n(n8n,network){
 must(network.Name===edgeNetwork&&network.Internal===true&&network.Driver==='bridge','Sieć shadowbridge-edge musi już istnieć jako wewnętrzny bridge.');
 must(n8n.Name==='/'+n8nContainer&&n8n.State?.Running&&n8n.NetworkSettings?.Networks?.[edgeNetwork],'Istniejący n8n musi działać i być podłączony do shadowbridge-edge.');
 const bindings=Object.values(n8n.HostConfig?.PortBindings||{}).flat().filter(Boolean);
 must(bindings.every(p=>['127.0.0.1','::1'].includes(p.HostIp)),'STOP: n8n ma port opublikowany poza localhost.');
 const env=Object.fromEntries((n8n.Config?.Env||[]).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 const expected={N8N_HOST:'automation.shadow-bridge.eu',N8N_PROTOCOL:'https',N8N_PROXY_HOPS:'1',N8N_WEBHOOK_URL:automationOrigin+'/',N8N_EDITOR_BASE_URL:automationOrigin};
 const missing=Object.entries(expected).filter(([k,v])=>(['N8N_WEBHOOK_URL','N8N_EDITOR_BASE_URL'].includes(k)?(env[k]||'').replace(/\/$/,''):env[k])!==(k==='N8N_WEBHOOK_URL'?v.replace(/\/$/,''):v)).map(([k,v])=>k+'='+v);
 must(!missing.length,'Przed publikacją ustaw w istniejącej konfiguracji n8n (bez zmiany sekretów/wolumenów): '+missing.join(', '));
 must(env.N8N_SECURE_COOKIE!=='false','STOP: N8N_SECURE_COOKIE nie może być false przy publicznym HTTPS.');
}
export function assertGatewayOnly(base,merged,folder){
 const adjusted=structuredClone(merged),expected=structuredClone(base);
 const before=base.services.gateway,after=merged.services.gateway;
 must(after.image===caddyImage&&base.name===merged.name,'Tożsamość projektu lub obrazu Caddy zmieniona.');
 const volume=after.volumes.find(v=>v.target==='/etc/caddy/Caddyfile');
 must(volume?.type==='bind'&&volume.read_only===true&&volume.source===path.join(folder,'Caddyfile'),'Nieprawidłowy mount konfiguracji bramy.');
 must(Object.keys(volume).every(k=>['type','source','target','read_only','bind'].includes(k))&&(!volume.bind||Object.entries(volume.bind).every(([k,v])=>k==='create_host_path'&&v===false)),'Nieoczekiwane opcje montowania Caddyfile.');
 const expectedMount=before.volumes.find(v=>v.target==='/etc/caddy/Caddyfile');
 adjusted.services.gateway.volumes=after.volumes.map(v=>v.target==='/etc/caddy/Caddyfile'?expectedMount:v);
 must(Object.hasOwn(after.networks,'automation_edge'),'Brak trwałej sieci edge.');
 delete adjusted.services.gateway.networks.automation_edge;
 must(merged.networks.automation_edge?.external===true&&merged.networks.automation_edge?.name===edgeNetwork,'Sieć edge nie może być tworzona ani zastępowana.');
 delete adjusted.networks.automation_edge;
 must(isDeepStrictEqual(adjusted,expected),'STOP: overlay zmienia coś poza mountem Caddyfile i siecią bramy.');
}
export const gatewayUp=['up','-d','--no-deps','--no-build','--pull','never','gateway'];
function compose(profile,args){return docker(publicComposeArguments(profile,args),{env:{...process.env,...profile.composeEnvironment}});}
function snapshot(container){return {id:container.Id,image:container.Image,name:container.Name,mounts:container.Mounts.map(m=>({type:m.Type,name:m.Name||null,source:m.Source,target:m.Destination,rw:m.RW})).sort((a,b)=>a.target.localeCompare(b.target)),ports:container.HostConfig.PortBindings||{}};}
function containers(profile,{requireGateway=true}={}){
 const items=JSON.parse(docker(['ps','-q','--filter','label=com.docker.compose.project='+profile.project]).split('\n').filter(Boolean).length?docker(['inspect',...docker(['ps','-q','--filter','label=com.docker.compose.project='+profile.project]).split('\n').filter(Boolean)]):'[]');
 const result={};for(const c of items){const service=c.Config.Labels?.['com.docker.compose.service'];if(['gateway','postgres','app','auth','mailpit'].includes(service)){must(!result[service],'Więcej niż jeden kontener usługi: '+service);result[service]=c;}}
 for(const name of [...(requireGateway?['gateway']:[]),'postgres','app','auth'])must(result[name]?.State.Running,'Brak działającej usługi produkcyjnej: '+name);
 return result;
}
function protectedState(profile){const all=containers(profile,{requireGateway:false});delete all.gateway;return {...Object.fromEntries(Object.entries(all).map(([k,c])=>[k,snapshot(c)])),n8n:snapshot(inspect(n8nContainer))};}
async function preflight(profile,{rollback=false}={}){
 must(profile.releaseSha===productionBase,'STOP: to nie produkcja 7f794a2.');
 const all=containers(profile,{requireGateway:!rollback}),gateway=all.gateway;
 if(gateway)must(gateway.Config.Image===caddyImage,'STOP: nieznany obraz istniejącej bramy.');
 const appEnv=all.app.Config.Env||[];must(appEnv.includes('RELEASE_SHA='+productionBase),'Uruchomiona aplikacja nie zgłasza wersji bazowej 7f794a2.');
 for(const service of ['postgres','auth','app','mailpit'])if(all[service])must(!Object.values(all[service].HostConfig.PortBindings||{}).some(p=>p?.length),'STOP: usługa prywatna ma host port: '+service);
 const n8n=inspect(n8nContainer);
 if(!rollback){
  const network=JSON.parse(docker(['network','inspect',edgeNetwork]))[0];assertN8n(n8n,network);
  must(Object.keys(network.Containers||{}).every(id=>[gateway.Id,n8n.Id].includes(id)),'STOP: nieznany kontener w izolowanej sieci edge.');
 }
 const base=JSON.parse(compose({...profile,gatewayOverride:undefined},['config','--format','json']));
 const allowed=new Set([base.networks.private.name,base.networks.public.name,edgeNetwork]);
 if(gateway)must(Object.keys(gateway.NetworkSettings.Networks).every(n=>allowed.has(n)),'STOP: brama ma dodatkową nieznaną sieć; wymagana decyzja operatora.');
 const mount=gateway?.Mounts.find(m=>m.Destination==='/etc/caddy/Caddyfile');
 const state=await gatewayState(profile);
 const expectedMount=state&&['active','applying','rollback_failed'].includes(state.phase)?path.join(gatewayFolder(profile),'Caddyfile'):path.join(profile.directory,'Caddyfile');
 if(gateway)must(mount?.Source===expectedMount||(rollback&&mount?.Source===path.join(profile.directory,'Caddyfile')),'STOP: uruchomiona brama korzysta z nieznanego Caddyfile.');
 const networks=gateway?Object.keys(gateway.NetworkSettings.Networks):[];
 if(!rollback)must(networks.includes(edgeNetwork),'Najpierw podłącz istniejącą bramę do shadowbridge-edge zgodnie ze stanem infrastruktury.');
 return {base,gateway,networks,protected:protectedState(profile)};
}
function validateCaddy(gateway,caddy){
 docker(['exec','-i',gateway.Id,'/bin/sh','-c','SB_PROXY_TOKEN="$(cat /run/secrets/proxy-token)"; export SB_PROXY_TOKEN; exec caddy validate --config - --adapter caddyfile'],{input:caddy});
}
export async function requestPublic(hostname,pathname){return new Promise((resolve,reject)=>{
 const req=https.get({hostname,port:443,path:pathname,servername:hostname,rejectUnauthorized:true,timeout:10000,headers:{'User-Agent':'ShadowBridge-gateway-check',Accept:pathname==='/signin'?'text/html':'application/json'}},res=>{
  let size=0;const chunks=[];res.on('data',c=>{size+=c.length;if(size>1024*1024)req.destroy(new Error('Zbyt duża odpowiedź kontroli bramy.'));else chunks.push(c);});
  res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));res.on('error',reject);
 });req.once('error',()=>reject(new Error('Nie potwierdzono HTTPS dla '+hostname+'; nie pomijaj sprawdzania certyfikatu.')));req.once('timeout',()=>req.destroy());
});}
export async function verifyMain(request=requestPublic){
 const app=await request('shadow-bridge.eu','/health');
 must(app.status===200&&app.headers['x-shadowbridge-release']===productionBase&&JSON.parse(app.body).ok===true,'Główna domena nie potwierdziła dotychczasowej wersji aplikacji.');
}
export async function verifyGateway({request=requestPublic}={}){
 await verifyMain(request);
 const health=await request('automation.shadow-bridge.eu','/healthz');
 must(health.status===200&&JSON.parse(health.body).status==='ok','n8n nie potwierdził /healthz przez HTTPS.');
 const editor=await request('automation.shadow-bridge.eu','/signin');
 must(editor.status===200&&!editor.headers['www-authenticate']&&/text\/html/.test(editor.headers['content-type']||''),'Nie potwierdzono ekranu logowania n8n.');
 return {https:true,mainRelease:productionBase,n8nHealth:true,signInPage:true,realAccountSignInTested:false};
}
export async function completeGatewayChange({start,validate,verify,activate,rollback,failed,attempts=18,pause=()=>new Promise(r=>setTimeout(r,5000))}){
 try{
  await start();await validate();let verified;
  for(let i=0;i<attempts;i++){try{verified=await verify();break;}catch{if(i===attempts-1)throw new Error('Public HTTPS verification failed');await pause();}}
  await activate();return verified;
 }catch{
  try{await rollback();}catch{await failed();throw new Error('Aktualizacja i rollback wymagają kontroli operatora. Zachowaj pliki stanu; nie resetuj danych.');}
  throw new Error('Aktualizacja nie przeszła kontroli; poprzednia brama przywrócona. Sprawdź ACME, logi i n8n przed ponowieniem.');
 }
}
async function rollbackGateway(profile,state){
 must(state?.checkpoint&&/^[a-f0-9]{16}$/.test(state.checkpoint),'Brak poprawnego checkpointu bramy.');
 const checkpoint=path.join(gatewayFolder(profile),'checkpoints',state.checkpoint);
 const previous=JSON.parse(await readFile(path.join(checkpoint,'previous.json'),'utf8'));
 must(sha(await readFile(path.join(checkpoint,'previous.json')))===state.checkpointSha,'Fingerprint checkpointu nie odpowiada plikowi stanu.');
 const now=await preflight(profile,{rollback:true});
 must(isDeepStrictEqual(now.protected,previous.protected),'Zmieniły się inne kontenery; nie wykonano automatycznego rollback.');
 compose({...profile,gatewayOverride:undefined},gatewayUp);
 const restored=containers(profile).gateway;
 must(restored.Image===previous.gateway.image,'Obraz odtworzonej bramy nie odpowiada poprzedniemu.');
 if(previous.networks.includes(edgeNetwork)&&!restored.NetworkSettings.Networks[edgeNetwork])docker(['network','connect',edgeNetwork,restored.Id]);
 must(isDeepStrictEqual(protectedState(profile),previous.protected),'Rollback wykrył zmianę pozostałych kontenerów.');
 for(let i=0;i<12;i++){try{await verifyMain();break;}catch{if(i===11)throw new Error('Rollback nie potwierdził głównej domeny HTTPS.');await new Promise(r=>setTimeout(r,2000));}}
 await saveGatewayState(profile,{...state,phase:'rolled_back'});
 return {rolledBack:true};
}
export async function operateGateway({action='check',directory='.local/contabo-private'}={}){
 must(['check','apply','verify','rollback'].includes(action),'Użyj check, apply, verify lub rollback.');
 checkCode();
 const profile=await checkProduction({directory,includeAutomation:false});
 if(action==='check'){await preflight(profile);return {preflight:true,productionRelease:productionBase,changed:false};}
 if(action==='verify'){await preflight(profile);await checkGatewayProfile(profile);must((await gatewayState(profile))?.phase==='active','Brama nie ma aktywnego checkpointu.');return verifyGateway();}
 const lock=path.join(profile.sourceDirectory,'production-operation.lock');
 const handle=await open(lock,'wx',0o600).catch(()=>{throw new Error('Trwa inna operacja produkcyjna; nie usuwaj jej blokady.');});
 try{
  let state=await gatewayState(profile);
  if(action==='rollback'){
   if(state?.phase==='rolled_back'){await preflight(profile,{rollback:true});await verifyMain();return {rolledBack:true,changed:false};}
   await checkGatewayProfile(profile);try{return await rollbackGateway(profile,state);}catch(error){if(state?.checkpoint)await saveGatewayState(profile,{...state,phase:'rollback_failed'});throw error;}
  }
  const before=await preflight(profile);
  if(state?.phase==='active'){await checkGatewayProfile(profile);return {...await verifyGateway(),changed:false};}
  must(!state||['prepared','rolled_back'].includes(state.phase),'Niedokończona operacja: najpierw rollback bramy.');
  const candidate=await prepareGatewayProfile(profile);
  const mergedProfile={...profile,gatewayOverride:candidate.override};
  const merged=JSON.parse(compose(mergedProfile,['config','--format','json']));assertGatewayOnly(before.base,merged,candidate.directory);
  const caddy=await readFile(path.join(candidate.directory,'Caddyfile'),'utf8');validateCaddy(before.gateway,caddy);
  const direct=JSON.parse(docker(['exec',before.gateway.Id,'wget','-qO-','-T','5','http://'+n8nContainer+':5678/healthz']));must(direct.status==='ok','Brak gotowości n8n w sieci edge.');
  const checkpoint=(await import('node:crypto')).randomBytes(8).toString('hex');
  const folder=path.join(candidate.directory,'checkpoints',checkpoint);await mkdir(folder,{recursive:true,mode:0o700});
  const previous=JSON.stringify({protected:before.protected,gateway:snapshot(before.gateway),networks:before.networks})+'\n';
  await writeFile(path.join(folder,'previous.json'),previous,{mode:0o600,flag:'wx'});
  for(const [name,file] of [['Caddyfile.before',path.join(profile.directory,'Caddyfile')],['manifest.production.before.json',path.join(profile.directory,'manifest.json')],['compose.before.yaml',path.join(repositoryRoot,'deploy/production/compose.yaml')]])await writeFile(path.join(folder,name),await readFile(file),{mode:0o600,flag:'wx'});
  state={phase:'applying',checkpoint,checkpointSha:sha(previous)};await saveGatewayState(profile,state);
  const verified=await completeGatewayChange({start:()=>compose(mergedProfile,gatewayUp),validate:async()=>{
   const gateway=containers(profile).gateway;
   must(gateway.Image===before.gateway.Image&&gateway.NetworkSettings.Networks[edgeNetwork],'Nowa brama zmieniła obraz lub utraciła sieć edge.');
   for(const target of ['/data','/config'])must(isDeepStrictEqual(snapshot(gateway).mounts.find(m=>m.target===target),snapshot(before.gateway).mounts.find(m=>m.target===target)),'Wolumen Caddy zmieniony.');
   must(isDeepStrictEqual(protectedState(profile),before.protected),'Zmienił się kontener poza bramą.');
  },verify:()=>verifyGateway(),activate:async()=>{await checkGatewayProfile(profile);await saveGatewayState(profile,{...state,phase:'active'});},rollback:()=>rollbackGateway(profile,state),failed:()=>saveGatewayState(profile,{...state,phase:'rollback_failed'})});
  return {...verified,changed:true,checkpoint};
 }finally{await handle.close();await rm(lock,{force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const action=process.argv[2]||'check',args=process.argv.slice(3);
 if(args.some(a=>!a.startsWith('--dir='))||args.length>1){console.error('Użyj: node scripts/n8n-gateway.mjs check|apply|verify|rollback --dir=.local/contabo-private');process.exitCode=1;}
 else operateGateway({action,directory:args[0]?.slice(6)}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
