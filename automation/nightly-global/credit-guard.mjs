// Only a separately approved, contract-verified provider adapter may be passed.
// This package never reveals/enriches emails against a real provider by itself.
import {createHash} from 'node:crypto';
const stageKey=(key,stage)=>{const h=createHash('sha256').update(key+':'+stage).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export async function guardedPaidOperation({approved=false,crm,provider,record,companySourceId,requiredFields,requestKey,operation}){
 // Selected Trial work-email discovery is now permitted by OWNER. This generic
 // legacy route lacks company-wide email reservations and the approved Sheets
 // sink. It must not become the Trial controller through an approved flag.
 if(record?.source?.system==='clay'||provider?.provider==='clay')return {status:'CLAY_DEDICATED_EMAIL_ROUTE_REQUIRED',providerCalls:0};
 if(!approved||provider?.contractVerified!==true||typeof provider.call!=='function')return {status:'PAID_DISABLED',providerCalls:0};
 let r,missing;
 try{
  const free=await crm.call('intake',{record,companySourceId,requestKey:stageKey(requestKey,'free')});
  if(!free||!['accepted','duplicate_prevented','review_required'].includes(free.status))return {status:'DEFER_INVALID_CRM_RESPONSE',providerCalls:0};
  if(free.status==='review_required')return {status:'review_required',providerCalls:0};
  const check=await crm.call('check',{record,companySourceId,requiredFields});
  if(check.decision!=='missing_fields')return {status:check.decision,providerCalls:0};
  missing=check.missing;
  if(!Array.isArray(missing)||!missing.length)return {status:'DEFER_INVALID_CRM_RESPONSE',providerCalls:0};
  r=await crm.call('reserve',{record,companySourceId,requiredFields:missing,requestKey,operation});
  if(!r.allowed)return {status:r.decision,providerCalls:0};
  const go=await crm.call('dispatch',{reservation:r.reservation});
  if(!go.dispatch)return {status:go.decision,providerCalls:0};
 }catch{return {status:'DEFER_CRM_UNAVAILABLE_NO_PAYMENT',providerCalls:0};}
 try{
  // The provider must receive its documented idempotency key if supported.
  // No transparent retries. A timeout after dispatch is an uncertain purchase.
  const enriched=await provider.call({record,requiredFields:missing,idempotencyKey:r.reservation});
  const saved=await crm.call('finish',{reservation:r.reservation,record:enriched,companySourceId,requestKey:stageKey(requestKey,'finish')});
  return {status:'CRM_INTAKE_RECORDED',receipt:saved.receipt,providerCalls:1};
 }catch{
  await crm.call('uncertain',{reservation:r.reservation}).catch(()=>{});
  return {status:'UNCERTAIN_NO_AUTOMATIC_RETRY',reservation:r.reservation,providerCalls:1};
 }
}
