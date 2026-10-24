import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {inspectApi} from './collect-readiness.mjs';

test('readiness collector performs GET only and emits aggregates, never keys, credentials or source records',()=>{
 const setup=`const calls=[];globalThis.fetch=async(url,o)=>{
  if(o.method&&o.method!=='GET')throw Error('mutation');calls.push(url);
  if(!url.startsWith('http://127.0.0.1:5678/'))throw Error('external call');
  let d=url.includes('/healthz')?{status:'ok'}:url.includes('/rest/settings')?{data:{versionCli:'2.44.6'}}:url.includes('/executions')?{data:[{status:'success',data:{private:'DO_NOT_EXPORT'}}]}:{data:[{name:'DO_NOT_EXPORT',nodes:[{type:'httpRequest',name:'Apollo',parameters:{url:'https://api.apollo.io/search',secret:'DO_NOT_EXPORT'},credentials:{httpHeaderAuth:{id:'DO_NOT_EXPORT'}}}]}]};
  return{status:200,text:async()=>JSON.stringify(d)};
 };process.on('exit',()=>{if(calls.length!==4)process.exitCode=3});`;
 const out=execFileSync(process.execPath,['--input-type=module','-e',setup+inspectApi],{input:JSON.stringify({key:'FICTIONAL_SECRET_CANARY'}),encoding:'utf8'});
 assert.ok(!out.includes('DO_NOT_EXPORT'));assert.ok(!out.includes('FICTIONAL_SECRET_CANARY'));
 const r=JSON.parse(out);assert.equal(r.healthOk,true);assert.equal(r.version,'2.44.6');assert.equal(r.providerReferences.apollo,1);assert.equal(r.publicApi.workflowReadStatus,200);assert.equal(r.publicApi.importPermissionVerified,false);assert.equal(r.providerCreditsVerified,false);assert.equal(r.crmMachineSinkVerified,false);
});
test('without an existing API key the collector never requests workflows or executions',()=>{
 const setup=`globalThis.fetch=async(url)=>{if(/workflows|executions/.test(url))throw Error('unauthorized request');return{status:200,text:async()=>JSON.stringify(url.endsWith('/healthz')?{status:'ok'}:{})}};`;
 const out=execFileSync(process.execPath,['--input-type=module','-e',setup+inspectApi],{input:'{"key":null}',encoding:'utf8'});
 const r=JSON.parse(out);assert.equal(r.publicApi.keySupplied,false);assert.equal(r.workflowCountInspected,0);assert.equal(r.providerCreditsVerified,false);
});
test('standalone collector refuses the non-Contabo workspace without changing services',()=>{
 const out=spawnSync(process.execPath,[new URL('./collect-readiness.mjs',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(out.status,2);const r=JSON.parse(out.stdout);assert.equal(r.status,'BLOCKED');assert.equal(r.changesMade,false);
});
