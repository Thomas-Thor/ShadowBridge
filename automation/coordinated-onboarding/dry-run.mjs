// Reuses existing source normalization and credit guard. No network or CRM writes.
import{acquisition}from'./vendor/core.mjs';import{guardedPaidOperation}from'./vendor/credit-guard.mjs';import{createHash}from'node:crypto';
export{acquisition,guardedPaidOperation};
export async function planSourcing({mode='DRY_RUN',page,lookupVault=async()=>({decision:'unavailable'})}){
 if(mode!=='DRY_RUN')throw Error('SOURCING_ACTIVATION_REQUIRES_SEPARATE_OWNER_DECISION');
 if(page?.job?.source?.approved!==true||page?.job?.source?.contractVerified!==true||page?.job?.source?.reuseApproved!==true)return{mode,status:'BLOCKED_SOURCE_APPROVAL',providerCalls:0,crmWrites:0,credits:0,plans:[]};
 const parsed=acquisition('page',page);if(!parsed.ok)return{mode,providerCalls:0,crmWrites:0,credits:0,retryAt:parsed.retryAt,failed:1,plans:[]};
 const seen=new Set(),plans=[],counts={fetched:parsed.records.length,new:0,duplicate:0,review:0,failed:0,stored:0,deferredByDryRunLimit:Math.max(0,parsed.records.length-50),companyOnly:0,contacts:0,stockSignals:0,verifiedDeals:0};
 for(const record of parsed.records.slice(0,50)){const c=record.company||{},domain=(()=>{try{return new URL(c.website).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}})();let key=record.key;
 if(record.type==='company'&&c.country)key=c.registrationNumber?'registry:'+c.country+':'+c.registrationNumber:domain?'domain:'+c.country+':'+domain:key;
 if(record.type==='contact'&&record.contact?.email)key='contact:'+record.contact.email.toLowerCase()+':'+(domain||record.companyKey);
 if(seen.has(key)){counts.duplicate++;continue;}seen.add(key);let existing;try{existing=await lookupVault({key,record});}catch{existing={decision:'unavailable'};}
 if(existing?.decision==='exists'){counts.duplicate++;continue;}
 if(existing?.decision!=='missing'){counts.review++;continue;}
 counts.new++;if(record.type==='company')counts.companyOnly++;if(record.type==='contact')counts.contacts++;if(record.type==='opportunity')counts.stockSignals++;
 plans.push({idempotencyKey:createHash('sha256').update(key).digest('hex'),classification:record.type==='opportunity'?'STOCK_SIGNAL':'LEAD',source:record.source,status:'unconfirmed',destination:'EXISTING_OWNER_VAULT_PENDING_V3',writeEnabled:false});
 }
 return{mode,providerCalls:0,crmWrites:0,credits:0,counts,plans,nextCursor:parsed.nextCursor};
}
