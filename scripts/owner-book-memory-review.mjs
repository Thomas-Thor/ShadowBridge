// Comparison only. Uses the existing import validator; never writes to Book,
// reads credentials, invents current counts or resolves uncertain matches.
import {importRecords} from '../server/owner-book.mjs';
const norm=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const date=v=>v==null?null:Number.isFinite(Date.parse(v))?new Date(v).toISOString():String(v);
const content=e=>JSON.stringify([e.kind,norm(e.title),norm(e.body),...['due_at','starts_at','ends_at','remind_at'].map(k=>date(e[k])),[...(e.dependencies||[])].sort()]);
export function reviewMemoryImport(candidates,current,coverage){
 const proposed=importRecords({items:candidates});
 if(!Array.isArray(current)||current.length>10000)throw Error('Bounded current Book snapshot required.');
 const kinds=[...new Set(proposed.map(e=>e.kind))];
 if(coverage?.authorizedRead!==true||kinds.some(k=>coverage.kinds?.[k]?.archived!=='all'||coverage.kinds[k].complete!==true||!Number.isSafeInteger(coverage.kinds[k].total)||coverage.kinds[k].total!==current.filter(e=>e.kind===k).length))return {status:'BLOCKED_CURRENT_BOOK_INCOMPLETE',approved:false,missing:null,duplicates:null,conflicts:null,currentBookReconciled:false};
 const ids=current.map(e=>e.id);if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('Duplicate or missing current entry IDs; stop before review.');
 const missing=[],duplicates=[],conflicts=[],completed=[],seen=new Set();
 for(const entry of proposed){
  if(!entry.source_ref||seen.has(entry.source_ref))throw Error('Distinct stable source_ref required for every candidate.');seen.add(entry.source_ref);
  const refs=current.filter(e=>e.source_ref===entry.source_ref);
  const exact=current.filter(e=>content(e)===content(entry));
  const sameTitle=current.filter(e=>e.kind===entry.kind&&norm(e.title)===norm(entry.title));
  const found=refs.length?refs:exact;
  if(found.length){
   if(found.length!==1||content(found[0])!==content(entry))conflicts.push({sourceRef:entry.source_ref,currentIds:found.map(e=>e.id),reason:'EXISTING_SOURCE_EDITED_OR_AMBIGUOUS_KEEP_CURRENT'});
   else{duplicates.push({sourceRef:entry.source_ref,currentId:found[0].id,preserveCurrent:true});if(found[0].status==='done')completed.push({currentId:found[0].id,sourceRef:entry.source_ref});}
  }else if(sameTitle.length)conflicts.push({sourceRef:entry.source_ref,currentIds:sameTitle.map(e=>e.id),reason:'SAME_TITLE_IS_NOT_PROOF_OF_DUPLICATION'});
  else missing.push(entry);
 }
 return {status:conflicts.length?'REVIEW_CONFLICTS_BEFORE_APPROVAL':'REVIEW_REQUIRED',approved:false,currentBookReconciled:true,missing,duplicates,conflicts,completed,writeRequested:false};
}
