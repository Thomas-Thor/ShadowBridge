import test from 'node:test';import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import {provisionInactive,crmGuardWorkflow} from './authorize-n8n.mjs';import{workflows}from './build-workflows.mjs';
import{regionalWorkflowRelease}from'./authorize-n8n.mjs';import{execFileSync}from'node:child_process';
test('inactive importer pins the reviewed no-phone workflow revision without downloading or activating anything',()=>{
 assert.equal(regionalWorkflowRelease,'10be0014738c30a9241fdb874b6bbe66bf1506a5');
 for(const region of ['latam','asia','europe','report']){const w=JSON.parse(execFileSync('git',['show',regionalWorkflowRelease+':automation/nightly-global/'+region+'.json'],{encoding:'utf8'}));assert.equal(w.active,false);assert.equal(w.nodes.find(n=>n.name==='OWNER approval gate').parameters.assignments.assignments[0].value,false);if(region!=='report')assert.ok(!JSON.stringify(w).includes("phone:read('phone'"));}
});
test('authorization imports inactive only, binds account credential, and never calls providers or activates workflows',async()=>{
 const calls=[],state={},known=[];let id=0;
 const api=async(method,url,body)=>{calls.push({method,url});assert.ok(!/activate|execute|reveal|enrich/.test(url));if(url==='/workflows?limit=100')return{data:known};if(method==='GET'&&url.startsWith('/credentials/schema/'))return{};if(method==='GET')return{active:false};if(url==='/workflows'){assert.ok(!Object.hasOwn(body,'active'));assert.equal(body.nodes.find(n=>n.name==='OWNER approval gate').parameters.assignments.assignments[0].value,false);known.push({name:body.name,active:false});}return{id:String(++id)}};
 const args={api,providers:{apollo:'FICTIONAL_SECRET_NOT_PUBLISHED',clay:''},workflows:workflows().map(x=>x.workflow),state,save:async()=>{}};
 const r=await provisionInactive(args);assert.equal(r.providerCreditsSpent,0);assert.equal(r.activeWorkflowsChanged,0);assert.equal(r.credentialCount,1);const posts=calls.filter(x=>x.method==='POST').length;assert.equal(posts,5);
 await provisionInactive(args);assert.equal(calls.filter(x=>x.method==='POST').length,posts);assert.ok(!JSON.stringify(state).includes('FICTIONAL_SECRET_NOT_PUBLISHED'));
});
test('shared CRM subworkflows save free facts, keep all gates closed and contain no paid/provider calls',async()=>{
 for(const provider of ['apollo','clay']){
  const w=crmGuardWorkflow(provider),disk=JSON.parse(await readFile(new URL('./crm-guard-'+provider+'.json',import.meta.url),'utf8'));assert.deepEqual(w,disk);assert.equal(w.active,false);
  const http=w.nodes.filter(n=>n.type.endsWith('.httpRequest'));assert.equal(http.length,2);assert.ok(http.every(n=>n.parameters.url.startsWith('https://shadow-bridge.eu/api/integrations/acquisition/v1/')));assert.ok(http.every(n=>!n.retryOnFail));
  assert.equal(w.nodes.find(n=>n.name==='OWNER approval gate').parameters.assignments.assignments[0].value,false);
 }
});
test('a lost POST response is checkpointed as uncertain and never repeated',async()=>{
 let posts=0;const state={},api=async(method,url)=>{if(method==='GET')return url.includes('workflows')?{data:[]}:{};posts++;throw Error('timeout after create');};
 const args={api,providers:{apollo:'FICTIONAL'},workflows:[],state,save:async()=>{}};await assert.rejects(provisionInactive(args));await assert.rejects(provisionInactive(args));assert.equal(posts,1);assert.equal(state.credentials.apollo.status,'uncertain');
});
test('existing active target causes a stop before creating any credential',async()=>{
 const w=workflows()[0].workflow;let mutations=0;const api=async(method)=>{if(method!=='GET')mutations++;return{data:[{name:w.name,active:true}]};};
 await assert.rejects(provisionInactive({api,providers:{apollo:'FICTIONAL'},workflows:[w],state:{},save:async()=>{}}));assert.equal(mutations,0);
});
