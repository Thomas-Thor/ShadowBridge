import test from'node:test';import assert from'node:assert/strict';import{reviewMemoryImport}from'../scripts/owner-book-memory-review.mjs';
const candidate=()=>({kind:'task',title:'FICTIONAL task',body:'FICTIONAL body',source_ref:'fictional-stable-reference',status:'open'});
const coverage=total=>({authorizedRead:true,kinds:{task:{complete:true,archived:'all',total}}});
test('partial, unauthenticated or active-only export never becomes a list of missing entries',()=>{
 for(const c of [undefined,{...coverage(0),authorizedRead:false},{authorizedRead:true,kinds:{task:{complete:true,archived:'false',total:0}}},coverage(1)]){const r=reviewMemoryImport([candidate()],[],c);assert.equal(r.status,'BLOCKED_CURRENT_BOOK_INCOMPLETE');assert.equal(r.missing,null);assert.equal(r.currentBookReconciled,false);}
});
test('complete empty scoped snapshot yields candidates for approval, never an approved import',()=>{const r=reviewMemoryImport([candidate()],[],coverage(0));assert.equal(r.missing.length,1);assert.equal(r.approved,false);assert.equal(r.writeRequested,false);});
test('same source or exact cross-source content is preserved; completed task never becomes open again',()=>{
 for(const source_ref of [candidate().source_ref,'another-source']){const old={...candidate(),id:'fictional-old',source_ref,status:'done'};const r=reviewMemoryImport([candidate()],[old],coverage(1));assert.equal(r.duplicates.length,1);assert.equal(r.completed.length,1);assert.equal(r.missing.length,0);assert.equal(old.status,'done');}
});
test('edited source and same title with other content require human review, not overwrite or silent duplicate',()=>{
 for(const source_ref of [candidate().source_ref,'another-source']){const old={...candidate(),id:'fictional-old',source_ref,body:'FICTIONAL OWNER edit'};const r=reviewMemoryImport([candidate()],[old],coverage(1));assert.equal(r.conflicts.length,1);assert.equal(r.missing.length,0);assert.equal(old.body,'FICTIONAL OWNER edit');}
});
test('repeating review is deterministic and cannot modify the snapshot or create a row',()=>{const input=[candidate()],old=[{...candidate(),id:'fictional-old'}],before=JSON.stringify({input,old});assert.deepEqual(reviewMemoryImport(input,old,coverage(1)),reviewMemoryImport(input,old,coverage(1)));assert.equal(JSON.stringify({input,old}),before);});
test('ambiguous IDs and repeated source references stop the review',()=>{
 assert.throws(()=>reviewMemoryImport([candidate()],[{...candidate(),id:'same'},{...candidate(),id:'same'}],coverage(2)));
 assert.throws(()=>reviewMemoryImport([candidate(),candidate()],[],coverage(0)));
 const changedDate={...candidate(),id:'dated',due_at:'2026-11-01T12:00:00Z'};assert.equal(reviewMemoryImport([candidate()],[changedDate],coverage(1)).conflicts.length,1);
});
