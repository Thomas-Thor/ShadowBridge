import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createAcquisitionGateway,loadAcquisitionGateway,assertRestrictedAcquisitionRole} from '../../server/acquisition-gateway.mjs';
import {guardedPaidOperation} from './credit-guard.mjs';
const record={company:{name:'FICTIONAL business',country:'NO',registrationNumber:'FICTIONAL',website:'https://example.invalid'},contact:{fullName:'FICTIONAL Person',title:'FICTIONAL buyer',workEmail:'',emailKind:'unknown'},source:{system:'apollo',recordId:'fictional-1'}};
const input={record,companySourceId:'fictional-co',requiredFields:['workEmail'],requestKey:randomUUID(),operation:'email_reveal'};
test('generic legacy route cannot perform Clay paid work without a dedicated company-level Trial email controller',async()=>{
 for(const operation of ['email_reveal','enrichment'])for(const sourceHint of ['record','provider']){let crmCalls=0,providerCalls=0;
  const r=await guardedPaidOperation({...input,operation,approved:true,record:sourceHint==='record'?{...record,source:{...record.source,system:'clay'}}:record,crm:{call:async()=>{crmCalls++;throw Error('MUST_NOT_RUN');}},provider:{provider:sourceHint==='provider'?'clay':'apollo',contractVerified:true,call:async()=>{providerCalls++;}}});
  assert.equal(r.status,'CLAY_DEDICATED_EMAIL_ROUTE_REQUIRED');assert.equal(r.providerCalls,0);assert.equal(crmCalls,0);assert.equal(providerCalls,0);
 }
});
test('gateway startup refuses DBA, BYPASSRLS, operational roles and a mismatched source binding',()=>{
 const meta={rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,executor:false,api:false,sessions:false,policy:false,ingest:true,provider:'apollo'};
 assert.doesNotThrow(()=>assertRestrictedAcquisitionRole(meta,'apollo'));
 for(const key of Object.keys(meta).filter(x=>!['ingest','provider'].includes(x)))assert.throws(()=>assertRestrictedAcquisitionRole({...meta,[key]:true},'apollo'));
 assert.throws(()=>assertRestrictedAcquisitionRole({...meta,provider:'clay'},'apollo'));assert.throws(()=>assertRestrictedAcquisitionRole({...meta,ingest:false},'apollo'));
});
test('existing data, review, CRM outage and unknown contract produce zero provider calls',async()=>{
 for(const decision of ['already_complete','review_required','outage']){let calls=0;const provider={contractVerified:true,call:async()=>{calls++}};const crm={call:async action=>{if(decision==='outage')throw Error('offline');if(action==='intake')return{status:'accepted'};return{decision};}};const result=await guardedPaidOperation({...input,approved:true,crm,provider});assert.equal(calls,0);assert.equal(result.providerCalls,0);}
 assert.equal((await guardedPaidOperation({...input,approved:false})).status,'PAID_DISABLED');
 assert.equal((await guardedPaidOperation({...input,approved:true,provider:{contractVerified:false}})).providerCalls,0);
});
test('provider timeout and failed CRM finish never automatically repeat the purchase',async()=>{
 for(const failAt of ['provider','finish']){
  let calls=0,dispatched=false,uncertain=0;
  const crm={call:async action=>{if(action==='intake')return{status:'accepted'};if(action==='check')return{decision:'missing_fields',missing:['workEmail']};if(action==='reserve')return dispatched?{allowed:false,decision:'field_already_reserved'}:{allowed:true,reservation:randomUUID()};if(action==='dispatch'){dispatched=true;return{dispatch:true}}if(action==='uncertain'){uncertain++;return{}}if(action==='finish')throw Error('offline');}};
  const provider={contractVerified:true,call:async()=>{calls++;if(failAt==='provider')throw Error('timeout');return record;}};
  const first=await guardedPaidOperation({...input,approved:true,crm,provider});assert.equal(first.status,'UNCERTAIN_NO_AUTOMATIC_RETRY');
  await guardedPaidOperation({...input,approved:true,crm,provider});assert.equal(calls,1);assert.equal(uncertain,1);
 }
});
test('gateway is off without private configuration; bearer source scope cannot be replaced by OWNER cookies',async()=>{
 assert.equal(await loadAcquisitionGateway(),null);
 const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');let calls=0;
 const gateway=createAcquisitionGateway({principals:[{provider:'apollo',tokenSha256:hash}],queryFactory:()=>({query:async(q,args)=>{calls++;assert.match(q,/\$1/);assert.ok(!q.includes('FICTIONAL'));assert.equal(JSON.parse(args[0]).source.system,'apollo');return{rows:[{result:{decision:'already_complete',paidAllowed:false}}]};}})});
 const url=new URL('https://shadow-bridge.eu/api/integrations/acquisition/v1/check');const req={method:'POST',headers:{authorization:'Bearer '+token}};
 assert.equal((await gateway.handle(req,url,async()=>input)).data.decision,'already_complete');assert.equal(calls,1);
 await assert.rejects(gateway.handle({...req,headers:{...req.headers,cookie:'OWNER_SESSION_NOT_ACCEPTED'}},url,async()=>input),e=>e.status===403);
 await assert.rejects(gateway.handle({method:'POST',headers:{}},url,async()=>input),e=>e.status===401);
 await assert.rejects(gateway.handle(req,url,async()=>({...input,record:{...record,source:{...record.source,system:'clay'}}})),e=>e.status===403);
 assert.equal(calls,1);
});
test('CRM errors return only a safe unavailable response and stop payment',async()=>{
 const token=randomBytes(32).toString('base64url'),gateway=createAcquisitionGateway({principals:[{provider:'apollo',tokenSha256:createHash('sha256').update(token).digest('hex')}],queryFactory:()=>({query:async()=>{throw Error('PRIVATE_DATABASE_PASSWORD_AND_DATA')}})});
 await assert.rejects(gateway.handle({method:'POST',headers:{authorization:'Bearer '+token}},new URL('https://shadow-bridge.eu/api/integrations/acquisition/v1/check'),async()=>input),e=>e.status===503&&!e.message.includes('PRIVATE'));
});
