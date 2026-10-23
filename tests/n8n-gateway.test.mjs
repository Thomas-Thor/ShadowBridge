// Unit/file tests. Runtime Caddy/TLS checks have their own integration report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { prepareStaging, repositoryRoot } from '../scripts/staging-prepare.mjs';
import { prepareProduction, checkProduction } from '../scripts/production-config.mjs';
import { publicComposeArguments } from '../scripts/production-ops.mjs';
import { productionBase, automationOrigin, edgeNetwork, n8nContainer, caddyImage, prepareGatewayProfile, checkGatewayProfile, saveGatewayState, sha } from '../scripts/n8n-gateway-profile.mjs';
import { assertPatchPaths, assertN8n, assertGatewayOnly, gatewayUp, verifyGateway, completeGatewayChange } from '../scripts/n8n-gateway.mjs';

const n8n=()=>({Name:'/'+n8nContainer,State:{Running:true},NetworkSettings:{Networks:{[edgeNetwork]:{}}},HostConfig:{PortBindings:{'5678/tcp':[{HostIp:'127.0.0.1',HostPort:'5678'}]}},Config:{Env:['N8N_HOST=automation.shadow-bridge.eu','N8N_PROTOCOL=https','N8N_PROXY_HOPS=1','N8N_WEBHOOK_URL='+automationOrigin+'/','N8N_EDITOR_BASE_URL='+automationOrigin,'N8N_ENCRYPTION_KEY=FICTIONAL_DO_NOT_PRINT']}});
const network=()=>({Name:edgeNetwork,Internal:true,Driver:'bridge'});
const base=()=>({name:'shadowbridge-contabo-fictional',services:{gateway:{image:caddyImage,networks:{private:{aliases:['auth-proxy']},public:{}},ports:[{target:80,published:'80'},{target:443,published:'443'}],volumes:[{type:'bind',source:'/fictional/base/Caddyfile',target:'/etc/caddy/Caddyfile',read_only:true},{type:'volume',source:'caddy-data',target:'/data'}]},postgres:{image:'postgres:17',networks:{private:{}}},app:{image:'existing-app'}},networks:{private:{internal:true},public:{}}});
const merged=()=>{const m=base();m.services.gateway.volumes[0].source='/fictional/overlay/Caddyfile';m.services.gateway.networks.automation_edge={};m.networks.automation_edge={name:edgeNetwork,external:true};return m;};

test('patch allowlist rejects migration 016, app changes and arbitrary infrastructure files',()=>{
 assert.doesNotThrow(()=>assertPatchPaths(['deploy/automation/Caddyfile.append','scripts/n8n-gateway.mjs']));
 for(const p of ['supabase/migrations/202610220016_owner_vault.sql','server/app.mjs','package.json','deploy/production/compose.yaml'])assert.throws(()=>assertPatchPaths([p]));
 assert.deepEqual(gatewayUp,['up','-d','--no-deps','--no-build','--pull','never','gateway']);
});
test('existing n8n must use a private edge, correct proxy origins and loopback host ports',()=>{
 assert.doesNotThrow(()=>assertN8n(n8n(),network()));
 for(const change of [n=>n.HostConfig.PortBindings['5678/tcp'][0].HostIp='0.0.0.0',n=>n.Config.Env=n.Config.Env.filter(e=>!e.startsWith('N8N_PROXY_HOPS=')),n=>n.Config.Env.push('N8N_SECURE_COOKIE=false'),n=>n.State.Running=false,n=>delete n.NetworkSettings.Networks[edgeNetwork]]){const n=n8n();change(n);assert.throws(()=>assertN8n(n,network()));}
 assert.throws(()=>assertN8n(n8n(),{...network(),Internal:false}));
});
test('n8n 2.35+ requires N8N_WEBHOOK_URL; legacy WEBHOOK_URL alone cannot satisfy preflight',()=>{
 for(const value of [automationOrigin,automationOrigin+'/']){
  const n=n8n();n.Config.Env=n.Config.Env.filter(e=>!e.startsWith('N8N_WEBHOOK_URL='));n.Config.Env.push('N8N_WEBHOOK_URL='+value);
  assert.doesNotThrow(()=>assertN8n(n,network()));
 }
 const legacy=n8n();legacy.Config.Env=legacy.Config.Env.filter(e=>!e.startsWith('N8N_WEBHOOK_URL='));legacy.Config.Env.push('WEBHOOK_URL='+automationOrigin+'/');
 assert.throws(()=>assertN8n(legacy,network()),/N8N_WEBHOOK_URL=https:\/\/automation\.shadow-bridge\.eu\//);
 for(const value of ['', 'http://automation.shadow-bridge.eu/', 'https://unrelated.invalid/',automationOrigin+'/wrong-path']){
  const n=n8n();n.Config.Env=n.Config.Env.filter(e=>!e.startsWith('N8N_WEBHOOK_URL='));n.Config.Env.push('N8N_WEBHOOK_URL='+value,'WEBHOOK_URL='+automationOrigin+'/');
  assert.throws(()=>assertN8n(n,network()),/N8N_WEBHOOK_URL=/);
 }
});
test('merged Compose can change only the Caddyfile mount and gateway edge attachment',()=>{
 assert.doesNotThrow(()=>assertGatewayOnly(base(),merged(),'/fictional/overlay'));
 for(const change of [m=>m.services.postgres.ports=[{published:'5432'}],m=>m.services.app.image='new-app',m=>m.services.gateway.volumes[1].source='other-volume',m=>m.services.gateway.ports.push({published:'5678'}),m=>m.networks.automation_edge.external=false]){const m=merged();change(m);assert.throws(()=>assertGatewayOnly(base(),m,'/fictional/overlay'));}
});
test('verification requires unchanged main release, n8n health and normal sign-in page',async()=>{
 const request=async(host,p)=>p==='/health'?{status:200,headers:{'x-shadowbridge-release':productionBase},body:'{"ok":true}'}:p==='/healthz'?{status:200,body:'{"status":"ok"}',headers:{}}:{status:200,body:'<html>',headers:{'content-type':'text/html'}};
 assert.equal((await verifyGateway({request})).realAccountSignInTested,false);
 await assert.rejects(verifyGateway({request:async(h,p)=>p==='/health'?{...await request(h,p),headers:{'x-shadowbridge-release':'WRONG'}}:request(h,p)}));
 await assert.rejects(verifyGateway({request:async(h,p)=>p==='/signin'?{status:401,headers:{'www-authenticate':'Basic'},body:''}:request(h,p)}));
});
test('activation is committed only after verification; start/probe failures roll back',async()=>{
 for(const failure of ['none','start','validate','verify','activate']){
  const calls=[];const fn=name=>async()=>{calls.push(name);if(failure===name)throw new Error('Fictional failure');return {ok:true};};
  const action=completeGatewayChange({start:fn('start'),validate:fn('validate'),verify:fn('verify'),activate:fn('activate'),rollback:fn('rollback'),failed:fn('failed'),attempts:1});
  if(failure==='none'){assert.deepEqual(await action,{ok:true});assert.deepEqual(calls,['start','validate','verify','activate']);}
  else{await assert.rejects(action,/przywrócona/);assert.equal(calls.at(-1),'rollback');assert.ok(!calls.includes('failed'));}
 }
 const calls=[];await assert.rejects(completeGatewayChange({start:async()=>{throw Error();},rollback:async()=>{throw Error();},failed:async()=>calls.push('failure-recorded'),attempts:1}),/kontroli operatora/);assert.deepEqual(calls,['failure-recorded']);
});
test('profile is additive, fingerprinted, version-bound and persists through normal compose commands',async()=>{
 const id=randomBytes(5).toString('hex'),directory=path.join(repositoryRoot,'.local','n8n-profile-test-'+id);
 try{
  await prepareStaging({directory,project:'shadowbridge-stageg-n8n-test-'+id});
  const profile=await prepareProduction({directory,releaseSha:productionBase});
  const tracked=['manifest.json','Caddyfile','compose.env','app.env','auth.env','proxy-token'];
  const before=Object.fromEntries(await Promise.all(tracked.map(async n=>[n,sha(await readFile(path.join(profile.directory,n)))])));
  const candidate=await prepareGatewayProfile(profile);assert.equal((await prepareGatewayProfile(profile)).override,candidate.override);
  assert.equal((await checkProduction({directory})).gatewayOverride,undefined);
  await saveGatewayState(profile,{phase:'active',checkpoint:randomBytes(8).toString('hex')});
  const active=await checkProduction({directory});assert.equal(active.gatewayOverride,candidate.override);
  const args=publicComposeArguments(active,gatewayUp);assert.ok(args.includes(candidate.override));assert.equal(args.at(-1),'gateway');
  await saveGatewayState(profile,{phase:'applying'});await assert.rejects(checkProduction({directory}),/Niedokończona/);
  assert.equal((await checkProduction({directory,includeAutomation:false})).releaseSha,productionBase);
  await saveGatewayState(profile,{phase:'rolled_back'});assert.equal((await checkProduction({directory})).gatewayOverride,undefined);
  for(const n of tracked)assert.equal(sha(await readFile(path.join(profile.directory,n))),before[n]);
  const caddy=path.join(candidate.directory,'Caddyfile'),original=await readFile(caddy);
  await writeFile(caddy,'# tampered\n'+original);await assert.rejects(checkGatewayProfile(profile),/Fingerprint/);await writeFile(caddy,original);
  const manifestFile=path.join(candidate.directory,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  manifest.baseRelease=randomBytes(20).toString('hex');await writeFile(manifestFile,JSON.stringify(manifest));await assert.rejects(checkGatewayProfile(profile),/baseRelease/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
