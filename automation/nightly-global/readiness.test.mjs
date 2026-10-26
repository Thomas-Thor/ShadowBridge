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
test('Google Sheets bindings are summarized without document IDs, credential IDs or source records',()=>{
 const setup=`globalThis.fetch=async url=>({status:200,text:async()=>JSON.stringify(url.includes('/workflows')?{data:[{active:true,nodes:[{name:'Apollo existing search',type:'n8n-nodes-base.httpRequest',credentials:{httpHeaderAuth:{id:'PRIVATE_CREDENTIAL'}},parameters:{url:'https://api.apollo.io/api/v1/mixed_people/api_search',secret:'PRIVATE_SECRET'}},{name:'PRIVATE_SHEET_NAME',type:'n8n-nodes-base.googleSheets',credentials:{googleSheetsOAuth2Api:{id:'PRIVATE_CREDENTIAL'}},parameters:{operation:'appendOrUpdate',documentId:{value:'PRIVATE_DOCUMENT_ID'}}}]}]}:{data:[]})});`;
 const out=execFileSync(process.execPath,['--input-type=module','-e',setup+inspectApi],{input:'{"key":"PRIVATE_API_KEY"}',encoding:'utf8'}),r=JSON.parse(out);
 for(const s of ['PRIVATE_CREDENTIAL','PRIVATE_SECRET','PRIVATE_SHEET_NAME','PRIVATE_DOCUMENT_ID','PRIVATE_API_KEY'])assert.ok(!out.includes(s));
 assert.equal(r.workflowListingComplete,true);assert.equal(r.workflowFamilies.apollo.active,1);assert.equal(r.workflowFamilies.apollo.boundCredentialNodes,1);
 assert.equal(r.googleSheets.nodeReferences,1);assert.equal(r.googleSheets.writeNodeReferences,1);assert.equal(r.googleSheets.sourceAndSheetSameWorkflow.apollo,1);
 assert.equal(r.googleSheets.staticDocumentFingerprints.length,1);assert.match(r.googleSheets.staticDocumentFingerprints[0],/^[a-f0-9]{64}$/);assert.equal(r.googleSheets.writeReadVerified,false);
});
test('partial pagination and dynamic sheet bindings stay explicitly unverified and never activate a workflow',()=>{
 const setup=`globalThis.fetch=async(url,o)=>{if(o.method&&o.method!=='GET')throw Error('mutation');return{status:200,text:async()=>JSON.stringify(url.includes('/workflows')?{nextCursor:'PRIVATE_CURSOR',data:[{active:false,nodes:[{name:'Clay',type:'n8n-nodes-base.httpRequest',credentials:{httpHeaderAuth:{id:'OWNER_SELECT_EXISTING_CLAY'}}},{type:'n8n-nodes-base.googleSheets',parameters:{documentId:{value:'={{ $json.privateSheet }}'}}}]}]}:{data:[]})}};`;
 const out=execFileSync(process.execPath,['--input-type=module','-e',setup+inspectApi],{input:'{"key":"FICTIONAL_SECRET"}',encoding:'utf8'}),r=JSON.parse(out);
 assert.equal(r.workflowListingComplete,false);assert.equal(r.workflowFamilies.clay.active,0);assert.equal(r.workflowFamilies.clay.boundCredentialNodes,0);assert.equal(r.googleSheets.dynamicDocumentNodes,5);assert.equal(r.googleSheets.staticDocumentFingerprints.length,0);assert.ok(!out.includes('PRIVATE_CURSOR'));assert.ok(!out.includes('privateSheet'));
});
