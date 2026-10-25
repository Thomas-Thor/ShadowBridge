import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{acquisition as f}from'./core.mjs';import{workflows}from'./build-workflows.mjs';
const source=()=>({key:'fixture',identityNamespace:'fixture',provider:'apollo',approved:true,contractVerified:true,action:'read_stored_or_search_results',endpoint:'https://api.apollo.io/api/v1/mixed_companies/search',method:'POST',maxCreditsPerRequest:0,pageSize:100,entityType:'contact',category:'industrial-supplies',countryMap:{Mexico:'MX'},mapping:{rows:['organizations'],companyId:['id'],companyName:['name'],country:['country'],registrationNumber:['reg'],industry:['industry'],description:['description'],website:['website'],contactId:['personId'],contactName:['fullName'],email:['email'],profile:['profile'],opportunityId:['lotId'],opportunityType:['kind'],opportunityDescription:['lotDescription'],opportunityUrl:['lotUrl']},pagination:{mode:'page',requestField:'page',sizeField:'per_page',totalPagesPath:['totalPages']}});
const job=()=>({id:'1',lease:'fictional-lease',source:source(),cursor:{page:1}});
const company=(id='1')=>({id,name:'FICTIONAL company '+id,country:'Mexico',reg:'FICTIONAL-'+id,personId:'p'+id,fullName:'FICTIONAL Person '+id,email:'person'+id+'@example.invalid',description:'FICTIONAL - business'});
const page=(j,rows)=>f('page',{job:j,response:{statusCode:200,body:{organizations:rows,totalPages:2}},now:'2026-10-24T01:00:00Z'});
test('four independent inactive workflows retain required Oslo hours and no messaging/agent executions',()=>{
 assert.deepEqual(workflows().map(w=>[w.region,w.workflow.nodes[1].parameters.rule.interval[0].expression]),[['LATAM','0 1 * * *'],['ASIA','0 2 * * *'],['EUROPE','0 3 * * *'],['REPORT','0 8 * * *']]);
 for(const{workflow:w}of workflows()){assert.equal(w.active,false);assert.equal(w.settings.timezone,'Europe/Oslo');assert.equal(w.nodes.find(n=>n.name==='OWNER approval gate').parameters.assignments.assignments[0].value,false);assert.ok(w.nodes.every(n=>!/(email|whatsapp|agent|code)/i.test(n.type)));}
});
test('source, cost and host gates reject unsafe/unapproved reads and execution endpoints',()=>{
 for(const modify of [s=>s.approved=false,s=>s.contractVerified=false,s=>s.maxCreditsPerRequest=null,s=>s.endpoint='http://api.apollo.io/a',s=>s.endpoint='https://127.0.0.1/a',s=>s.endpoint='https://api.apollo.io/api/enrich',s=>s.endpoint='https://api.apollo.io/agents/trigger',s=>s.endpoint='https://api.apollo.io/messages/send',s=>s.endpoint='https://api.apollo.io/campaigns',s=>s.endpoint='https://api.apollo.io/agents/run']){const j=job();modify(j.source);assert.throws(()=>f('request',{job:j}));}
 assert.equal(f('request',{job:job()}).body.per_page,100);
});
test('committed import files match the tested generator and retain parameterized SQL',async()=>{
 for(const {region,workflow}of workflows()){
  const exported=JSON.parse(await readFile(new URL('./'+region.toLowerCase()+'.json',import.meta.url),'utf8'));
  assert.deepEqual(exported,workflow);
  for(const node of exported.nodes.filter(n=>n.type==='n8n-nodes-base.postgres')){assert.match(node.parameters.query,/\$1/);assert.equal(typeof node.parameters.options.queryReplacement,'string');}
 }
});
test('company and person are separate; IDs persist; contacts and Unicode long dash are not invented',()=>{
 const r=page(job(),[company()]);assert.equal(r.records.length,2);assert.equal(r.records[0].type,'company');assert.equal(r.records[1].type,'contact');assert.equal(r.records[0].company.country,'MX');
 const v=company();delete v.email;delete v.phone;v.description='Trade \u2014 possible';const q=page(job(),[v]);assert.equal(q.records[1].contact.email,null);assert.equal(q.records[1].contact.phone,undefined);assert.ok(!q.records[0].company.description.includes('\u2014'));
});
test('same company/individual does not gain opportunity from a manufacturing description',()=>{const r=page(job(),[company()]);assert.equal(r.records.filter(x=>x.type==='opportunity').length,0);});
test('only explicit BUY SELL SURPLUS plus source evidence creates an opportunity',()=>{
 const j=job();j.source.entityType='opportunity';for(const kind of ['BUY','SELL','SURPLUS']){const r=page(j,[{...company(),kind,lotId:'l1',lotDescription:'FICTIONAL actual listing declaration',lotUrl:'https://example.invalid/lot/1'}]);assert.equal(r.records.at(-1).opportunity.kind,kind);assert.equal(r.records.at(-1).status,'review_required');}
 assert.equal(page(j,[{...company(),kind:'SURPLUS',lotId:'l1'}]).records.length,1);
});
test('company registry keys cross sources, similar names do not; shared emails never identify people',()=>{
 const j=job(),a=page(j,[company('1'),company('2')]).records;assert.notEqual(a[0].key,a[2].key);j.source.identityNamespace='another';assert.equal(page(j,[company('1')]).records[0].key,a[0].key);
 const r=page(j,[{...company(),email:'info@example.invalid'}]);assert.equal(r.records[1].contact.email,'info@example.invalid');assert.equal(r.records[1].contact.emailKind,'shared');assert.ok(r.records[1].key.startsWith('source-person:'));
});
test('429 and HTTP date respect Retry-After, errors never produce records; malformed pages stop',()=>{
 const now='2026-10-24T01:00:00Z';for(const status of [0,429,503,403]){const r=f('page',{job:job(),now,response:{statusCode:status,headers:{'Retry-After':'172800'}}});assert.equal(r.records.length,0);assert.equal(r.retryAt,'2026-10-26T01:00:00.000Z');assert.equal(r.permanent,status===403);}
 assert.throws(()=>page(job(),Array.from({length:101},()=>company())));assert.throws(()=>f('page',{job:job(),now,response:{statusCode:200,body:{unexpected:[]}}}));
});
test('DST job keys use one Oslo calendar day for repeated 02:00 and primary 03:00 survives spring gap',()=>{
 const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Oslo',dateStyle:'short'}).format(new Date(v));assert.equal(day('2026-10-25T00:00:00Z'),day('2026-10-25T01:00:00Z'));
 const hour=v=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',hour:'2-digit',hourCycle:'h23'}).format(new Date(v));assert.equal(hour('2026-03-29T01:00:00Z'),'03');
 const asia=workflows().find(x=>x.region==='ASIA').workflow;assert.ok(asia.nodes.some(n=>n.name==='Resume unfinished jobs'&&n.disabled));
});

test('phone data is not collected even if returned unsolicited; phone mappings are rejected before a request',()=>{const j=job(),v={...company(),phone:'FICTIONAL-PHONE-NOT-TO-SAVE'};const r=page(j,[v]);assert.ok(!JSON.stringify(r).includes('FICTIONAL-PHONE-NOT-TO-SAVE'));assert.ok(!Object.hasOwn(r.records[1].contact,'phone'));j.source.mapping.phone=['phone'];assert.throws(()=>f('request',{job:j}),/Phone collection/);});
