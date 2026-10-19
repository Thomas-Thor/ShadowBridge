import test from 'node:test';
import assert from 'node:assert/strict';
import { businessData } from '../validation.mjs';
// Syntactically valid fixture ID; category existence is covered by actual API/RLS tests.
const categoryId = '10000000-0000-4000-8000-000000000001';

test('public commercial text rejects contacts, domains and internal identifiers without hiding them',()=>{
 for(const marker of ['supplier@example.invalid','https://supplier.invalid','supplier.invalid','+47 47747007','0047 47747007','47747007','e1b6aa43-9a16-4592-9ac0-65c6f4818e62']) {
  assert.throws(()=>businessData('commercial',{categoryId,title:`Contact ${marker}`,specification:'Generic material'}),error=>error.code==='IDENTIFYING_CONTENT');
 }
 assert.throws(()=>businessData('commercial',{categoryId,title:'Generic material',specification:'Reviewed product',supplierCompanyId:'hidden'}),error=>error.code==='INVALID_FIELDS');
});
test('reviewed product-only information and numerical quantities remain usable',()=>{
 const card=businessData('commercial',{categoryId,title:'Industrial polymer',specification:'ISO 9001 product grade; density 0.95',quantity:100000000,unit:'kg',price:2.5,currency:'EUR',incoterms:'FCA',validUntil:'2028-10-01'});
 assert.equal(card.quantity,100000000);assert.equal(card.validUntil,'2028-10-01');
 assert.throws(()=>businessData('commercial',{categoryId,title:'Product',specification:'Generic',validUntil:'2027-02-31'}),error=>error.code==='INVALID_INPUT');
 assert.deepEqual(Object.keys(card).sort(),['categoryId','title','specification','quantity','unit','price','currency','incoterms','validUntil'].sort());
});
