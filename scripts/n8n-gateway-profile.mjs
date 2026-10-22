// Additive gateway profile. Existing production files/manifests/secrets are READ
// ONLY. No new app profile, release selection, database, image or volume.
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from './staging-prepare.mjs';

export const productionBase='7f794a298713d820af033ba2174cd60bfaa81e4b';
export const automationOrigin='https://automation.shadow-bridge.eu';
export const edgeNetwork='shadowbridge-edge';
export const n8nContainer='shadowbridge-automation-n8n-1';
export const caddyImage='caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
export const sha=data=>createHash('sha256').update(data).digest('hex');
const must=(ok,message)=>{if(!ok)throw new Error(message);};
export const gatewayFolder=profile=>path.join(profile.sourceDirectory,'automation-gateway');
async function regular(file,mode=0o600,directory=false){const s=await lstat(file);must(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile())&&(s.mode&0o777)===mode,'Niebezpieczny plik lub katalog profilu bramy.');}
export async function gatewayState(profile){
 const folder=gatewayFolder(profile);
 try{await regular(folder,0o700,true);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const file=path.join(folder,'state.json');try{await regular(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const state=JSON.parse(await readFile(file,'utf8'));
 must(state.kind==='shadowbridge-n8n-gateway-state-v1'&&['prepared','applying','active','rolled_back','rollback_failed'].includes(state.phase),'Nieprawidłowy stan operacji bramy.');
 return state;
}
export async function saveGatewayState(profile,state){
 const folder=gatewayFolder(profile);await regular(folder,0o700,true);
 const tmp=path.join(folder,'.state-'+randomBytes(6).toString('hex'));
 await writeFile(tmp,JSON.stringify({kind:'shadowbridge-n8n-gateway-state-v1',...state})+'\n',{mode:0o600,flag:'wx'});
 await rename(tmp,path.join(folder,'state.json'));
}
export function gatewayOverride(folder){return {services:{gateway:{volumes:[{type:'bind',source:path.join(folder,'Caddyfile'),target:'/etc/caddy/Caddyfile',read_only:true,bind:{create_host_path:false}}],networks:{automation_edge:{}}}},networks:{automation_edge:{external:true,name:edgeNetwork}}};}
async function expectedProfile(profile){
 must(profile.releaseSha===productionBase&&profile.mailMode==='disabled','Ta poprawka obsługuje wyłącznie istniejącą produkcję 7f794a2 bez poczty.');
 const folder=gatewayFolder(profile);
 return {
  Caddyfile:(await readFile(path.join(profile.directory,'Caddyfile'),'utf8'))+(await readFile(path.join(repositoryRoot,'deploy/automation/Caddyfile.append'),'utf8')),
  'compose.override.json':JSON.stringify(gatewayOverride(folder),null,2)+'\n',
 };
}
async function identity(profile){return {
 kind:'shadowbridge-n8n-gateway-profile-v1',project:profile.project,baseRelease:productionBase,
 sourceDirectory:profile.sourceDirectory,productionDirectory:profile.directory,origin:automationOrigin,
 network:edgeNetwork,upstream:n8nContainer+':5678',
 baseProductionManifestSha:sha(await readFile(path.join(profile.directory,'manifest.json'))),
 privateManifestSha:sha(await readFile(path.join(profile.sourceDirectory,'manifest.json'))),
 baseComposeSha:sha(await readFile(path.join(repositoryRoot,'deploy/production/compose.yaml'))),
 entrypointSha:sha(await readFile(path.join(repositoryRoot,'deploy/production/caddy-entrypoint.sh'))),
 };}
export async function checkGatewayProfile(profile){
 const folder=gatewayFolder(profile);await regular(folder,0o700,true);await regular(path.join(folder,'manifest.json'));
 const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
 for(const [key,value] of Object.entries(await identity(profile)))must(manifest[key]===value,'Manifest bramy nie odpowiada istniejącej produkcji: '+key);
 const files=await expectedProfile(profile);
 for(const [name,expected] of Object.entries(files)){
  await regular(path.join(folder,name));const actual=await readFile(path.join(folder,name));
  must(sha(actual)===manifest.hashes?.[name]&&actual.toString()===expected,'Fingerprint profilu bramy zmieniony: '+name);
 }
 return {directory:folder,override:path.join(folder,'compose.override.json'),manifest};
}
export async function prepareGatewayProfile(profile){
 const folder=gatewayFolder(profile);
 try{await lstat(folder);return checkGatewayProfile(profile);}catch(e){if(e.code!=='ENOENT')throw e;}
 const files=await expectedProfile(profile),meta=await identity(profile);
 await mkdir(folder,{mode:0o700});
 for(const [name,value] of Object.entries(files))await writeFile(path.join(folder,name),value,{mode:0o600,flag:'wx'});
 await writeFile(path.join(folder,'manifest.json'),JSON.stringify({...meta,hashes:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,sha(v)]))},null,2)+'\n',{mode:0o600,flag:'wx'});
 await saveGatewayState(profile,{phase:'prepared'});
 return checkGatewayProfile(profile);
}
// Used by ordinary compose argument construction after activation. A partial
// operation fails closed; an unrelated application release cannot adopt this.
export async function selectedGatewayOverride(profile){
 const state=await gatewayState(profile);if(!state)return null;
 if(['applying','rollback_failed'].includes(state.phase))throw new Error('Niedokończona operacja bramy n8n; użyj jej procedury rollback.');
 if(state.phase!=='active')return null;
 return (await checkGatewayProfile(profile)).override;
}
