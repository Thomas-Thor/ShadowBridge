import test from 'node:test';import assert from 'node:assert/strict';
import {retirePilots,retiredPilotNames,incomingDependencies,fingerprint} from './retire-pilots.mjs';
function fixture(){const workflows=new Map(retiredPilotNames.map((name,i)=>[String(i+1),{id:String(i+1),name,active:i===0,nodes:[],connections:{},settings:{}}])),archives=new Map(),events=[],state={kind:'shadowbridge-pilot-retirement-v1'},history=[{id:'exec1',workflowId:'1',status:'success',data:{PRIVATE_FICTIONAL_DATA:true}}];let saved;
 const api=async(method,route)=>{events.push(method+' '+route);
  if(route.startsWith('/workflows?'))return{data:[...workflows.values()].map(({id,name})=>({id,name}))};
  if(route.startsWith('/executions?'))return{data:history.filter(e=>workflows.has(e.workflowId)).map(({id,workflowId,status})=>({id,workflowId,status}))};
  if(route.startsWith('/executions/'))return structuredClone(history.find(e=>route.split('/')[2].split('?')[0]===e.id));
  const key=route.split('/')[2],w=workflows.get(key);if(!w){const e=Error('NOT_FOUND');e.httpStatus=404;throw e;}
  if(method==='GET')return structuredClone(w);
  if(method==='POST'){assert.ok(route.endsWith('/deactivate'));w.active=false;w.versionId='new-version';return structuredClone(w);}
  if(method==='DELETE'){assert.ok(archives.has('workflow-'+key+'.json'));assert.ok(archives.has('workflow-1.json'));assert.ok(archives.has('workflow-2.json'));assert.ok(archives.has('execution-exec1.json'));workflows.delete(key);return{};}
  throw Error('UNEXPECTED_API_CALL');
 };
 const store=async(name,v)=>{events.push('archive '+name);if(archives.has(name))assert.equal(fingerprint(archives.get(name)),fingerprint(v));else archives.set(name,structuredClone(v));return{file:'/PRIVATE_LOCAL/'+name,sha256:fingerprint(v)};};
 store.verify=async(name,hash)=>{assert.equal(fingerprint(archives.get(name)),hash);return structuredClone(archives.get(name));};
 return{workflows,archives,events,state,history,api,store,save:async s=>{saved=structuredClone(s);},saved:()=>saved};
}
test('both JSON definitions and history are verified before deletion; no credential or Data Table route is touched',async()=>{
 const f=fixture(),r=await retirePilots(f);assert.equal(r.archivedAndDeleted,2);assert.equal(r.replacement.active,false);assert.equal(r.replacement.created,false);assert.equal(r.crmWrites,0);
 assert.equal(f.archives.get('workflow-1.json').active,true);assert.ok(f.archives.get('execution-exec1.json').data.PRIVATE_FICTIONAL_DATA);
 const mutations=f.events.filter(e=>/^(POST|DELETE)/.test(e));assert.deepEqual(mutations,['POST /workflows/1/deactivate','DELETE /workflows/1','DELETE /workflows/2']);
 const count=f.events.filter(e=>e.startsWith('DELETE')).length;await retirePilots(f);assert.equal(f.events.filter(e=>e.startsWith('DELETE')).length,count);
});
test('running, waiting and unknown executions retain workflow archives but block all n8n mutations',async()=>{
 for(const status of ['running','waiting','new','unknown']){const f=fixture();f.history[0].status=status;await assert.rejects(retirePilots(f),/LIVE_OR_UNCERTAIN/);assert.equal(f.archives.size,2);assert.ok(!f.events.some(e=>/^(POST|DELETE)/.test(e)));}
});
test('incoming and dynamic dependencies block retirement without editing the caller',async()=>{
 for(const workflowId of ['1','={{ $json.workflow }}']){const f=fixture();f.workflows.set('caller',{id:'caller',name:'Untouched caller',nodes:[{type:'n8n-nodes-base.executeWorkflow',parameters:{workflowId:{value:workflowId}}}]});await assert.rejects(retirePilots(f),/DEPENDENCY/);assert.ok(!f.events.some(e=>/^(POST|DELETE)/.test(e)));assert.equal(f.workflows.get('caller').nodes.length,1);}
});
test('ambiguous names, binary payloads and failed backups refuse deletion',async()=>{
 {const f=fixture();f.workflows.set('duplicate',{...f.workflows.get('1'),id:'duplicate'});await assert.rejects(retirePilots(f),/DUPLICATE/);assert.equal(f.archives.size,0);}
 {const f=fixture();f.history[0].data.binary={file:{id:'private-binary-reference'}};await assert.rejects(retirePilots(f),/BINARY_BACKUP/);assert.ok(!f.events.some(e=>/^(POST|DELETE)/.test(e)));}
 {const f=fixture();f.store=async()=>{throw Error('DISK_ERROR');};await assert.rejects(retirePilots(f),/DISK_ERROR/);assert.ok(!f.events.some(e=>/^(POST|DELETE)/.test(e)));}
});
test('a lost DELETE receipt is reconciled by GET404 and verified archive, without sending the DELETE again',async()=>{
 const f=fixture(),api=f.api;let once=true;f.api=async(method,route)=>{const r=await api(method,route);if(method==='DELETE'&&route==='/workflows/1'&&once){once=false;throw Error('LOST_RESPONSE');}return r;};await assert.rejects(retirePilots(f),/LOST_RESPONSE/);assert.equal(f.saved().targets['1'].deletePending,true);
 const r=await retirePilots(f);assert.equal(r.archivedAndDeleted,2);assert.equal(f.events.filter(e=>e==='DELETE /workflows/1').length,1);
});
test('a lost deactivation receipt resumes from its unchanged definition and preserves the original active JSON',async()=>{
 const f=fixture(),api=f.api;let once=true;f.api=async(method,route)=>{const r=await api(method,route);if(method==='POST'&&once){once=false;throw Error('LOST_DEACTIVATION');}return r;};await assert.rejects(retirePilots(f),/LOST_DEACTIVATION/);
 const r=await retirePilots(f);assert.equal(r.archivedAndDeleted,2);assert.equal(f.events.filter(e=>e==='POST /workflows/1/deactivate').length,1);assert.equal(f.archives.get('workflow-1.json').active,true);
});
test('unknown dependency schema stays blocked and no unrelated workflow is selected by partial names',()=>{
 assert.equal(incomingDependencies([{id:'outside',nodes:[{type:'n8n-nodes-base.executeWorkflow',parameters:{}}]}],['1']).length,1);
 assert.throws(()=>incomingDependencies([{id:'outside'}],['1']),/NOT_VERIFIED/);
});
