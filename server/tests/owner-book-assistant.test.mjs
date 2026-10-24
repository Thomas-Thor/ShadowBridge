import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID,randomBytes,createHash}from'node:crypto';import{routeBookToken}from'../owner-book.mjs';
const raw='sbob_'+randomBytes(32).toString('base64url'),clientHash='a'.repeat(64);
function fixture(){const calls=[];return{calls,sessionPool:{query:async(q,args)=>{calls.push(args);return{rows:[{result:{status:200,data:{ok:true}}}]};}}};}
const url=new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/assistant/entries');
test('assistant JSON writes map to the unchanged scoped SQL operation, audit and stable command UUID',async()=>{
 const f=fixture(),id=randomUUID();const body=async()=>({requestKey:id,explicitWrite:true,entry:{kind:'idea',title:'FICTIONAL plugin idea'}});
 await routeBookToken({...f,req:{method:'POST',headers:{authorization:'Bearer '+raw}},url,body,clientHash});assert.equal(f.calls[0][0],createHash('sha256').update(raw).digest('hex'));assert.equal(f.calls[0][1],'save');assert.equal(f.calls[0][2],'idea');assert.equal(f.calls[0][4],id);assert.equal(f.calls[0][5],true);assert.ok(!JSON.stringify(f.calls).includes(raw));
});
test('an unconfirmed command, cookie, forbidden resource or account operation never reaches a write RPC',async()=>{
 for(const change of [p=>p.explicitWrite=false,p=>delete p.explicitWrite,p=>p.entry.kind='decision',p=>p.entry.owner_id=randomUUID(),p=>p.requestKey='bad-command']){const f=fixture(),p={requestKey:randomUUID(),explicitWrite:true,entry:{kind:'task',title:'FICTIONAL'}};change(p);await assert.rejects(routeBookToken({...f,req:{method:'POST',headers:{authorization:'Bearer '+raw}},url,body:async()=>p,clientHash}));assert.ok(f.calls.every(a=>a[1]==='invalid'));}
 const f=fixture();await assert.rejects(routeBookToken({...f,req:{method:'POST',headers:{authorization:'Bearer '+raw,cookie:'blocked'}},url,body:async()=>({}),clientHash}));assert.ok(f.calls.every(a=>a[1]==='invalid'));
});
test('ordinary API writes still require their original explicit command headers',async()=>{
 const f=fixture();await assert.rejects(routeBookToken({...f,req:{method:'POST',headers:{authorization:'Bearer '+raw}},url:new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/entries'),body:async()=>({entry:{kind:'note',title:'FICTIONAL'},requestKey:randomUUID()}),clientHash}));assert.ok(f.calls.every(a=>a[1]==='invalid'));
});
test('delegated journal access never returns private CRM/security event IDs, actions, records or counts',async()=>{
 const privateValue='FICTIONAL-PRIVATE-CRM-ID',data={items:[{at:'2026-10-24T12:00:00Z',source:'owner_vault.events',sourceRef:privateValue,action:'private-action',record:privateValue}],total:1,page:1,limit:25,window:{},counts:{bookChanges:2,tasksMarkedDone:1,plannedItems:0,crmContacts:123,crmCompanies:45},automation:{status:'not_connected',verifiedAgentRuns:null,actualCredits:null,actualMoneyCost:null},privateRecords:privateValue};
 const sessionPool={query:async()=>({rows:[{result:{status:200,data}}]})};const r=await routeBookToken({sessionPool,req:{method:'GET',headers:{authorization:'Bearer '+raw}},url:new URL('https://shadow-bridge.eu/api/integrations/owner-book/v1/journal'),body:async()=>({}),clientHash});
 assert.ok(!JSON.stringify(r).includes(privateValue));assert.ok(!JSON.stringify(r).includes('private-action'));assert.equal(r.data.counts.crmContacts,undefined);assert.equal(r.data.items[0].source,'redacted_platform_metadata');assert.equal(r.data.counts.bookChanges,2);
});
