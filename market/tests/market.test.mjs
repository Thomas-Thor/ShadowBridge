import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { countries, suppliers, createOffers, validateCatalog, selectOffers } from '../public/assets/catalog.js';
import { money } from '../public/assets/en.js';
import { previewServer } from '../scripts/preview.mjs';
const taxonomy = JSON.parse(await fs.readFile(new URL('../public/data/taxonomy.json',import.meta.url),'utf8'));
const offers = createOffers(taxonomy);
const parent = key => taxonomy.categories.find(c => c.key === key);

test('The public demo snapshot matches the existing canonical taxonomy without any database access',() => {
  const result = execFileSync(process.execPath,[new URL('../scripts/sync-taxonomy.mjs',import.meta.url).pathname,'--check'],{encoding:'utf8'});
  assert.match(result,/PASS/);
  assert.equal(new Set(taxonomy.categories.map(c => c.id)).size,32);
  for (const child of taxonomy.categories.filter(c => c.parentId)) assert.ok(taxonomy.categories.some(c => c.id === child.parentId && !c.parentId));
});
test('All fixtures are fictional, use known categories, preserve currencies and provide no contact fields',async () => {
  assert.equal(validateCatalog(taxonomy,offers),true);
  assert.equal(offers.length,18);
  assert.equal(new Set(offers.map(o => o.categoryId)).size,8);
  for (const supplier of suppliers) { assert.match(supplier.name,/\(DEMO\)$/); assert.ok(countries[supplier.country]); assert.equal(supplier.email,undefined); assert.equal(supplier.website,undefined); }
  for (const currency of ['EUR','USD','GBP','NOK','PLN']) assert.ok(offers.some(o => o.currency === currency));
  assert.ok(offers.some(o => o.price === null && o.incoterms === null));
  assert.match(money(1.25,'PLN'),/PLN/);
  for (const offer of offers) {
    const image = offer.imageKey || taxonomy.categories.find(c => c.id === offer.categoryId).key;
    assert.match(await fs.readFile(new URL(`../public/assets/images/${image}.svg`,import.meta.url),'utf8'),/<svg/);
  }
});
test('Search works across product, supplier, category, country and ID, with no fabricated fallback results',() => {
  for (const q of ['OATS','  Baltic  ','grains','Poland','DEMO-MKT-001']) assert.ok(selectOffers(offers,taxonomy,{q}).items.some(o => o.id === 'DEMO-MKT-001'));
  assert.equal(selectOffers(offers,taxonomy,{q:'not-in-any-fictional-catalogue'}).total,0);
  assert.equal(selectOffers(offers,taxonomy,{q:'<script>alert(1)</script>'}).total,0);
});
test('Combined country/type/category/subcategory/currency filters respect all selected constraints',() => {
  const criteria = {category:parent('food-agriculture').id,subcategory:parent('grains-ingredients').id,country:'PL',type:'wholesale',currency:'EUR'};
  assert.deepEqual(selectOffers(offers,taxonomy,criteria).items.map(o => o.id),['DEMO-MKT-001']);
  assert.equal(selectOffers(offers,taxonomy,{...criteria,country:'NO'}).total,0);
  const counts = selectOffers(offers,taxonomy,{country:'PL'}).categoryCounts;
  assert.equal(Object.values(counts).reduce((sum,n) => sum+n,0),6);
  assert.equal(selectOffers(offers,taxonomy,{category:'unknown'}).total,0);
});
test('Pagination is bounded, stable and never repeats or omits records; supplier filtering stays scoped',() => {
  const first=selectOffers(offers,taxonomy,{page:1}), second=selectOffers(offers,taxonomy,{page:2});
  assert.equal(first.items.length,9); assert.equal(second.items.length,9);
  assert.equal(new Set([...first.items,...second.items].map(o => o.id)).size,18);
  for (const page of ['-8','NaN','Infinity','1.7']) assert.equal(selectOffers(offers,taxonomy,{page}).page,page==='Infinity'?2:1);
  assert.equal(selectOffers(offers,taxonomy,{page:999}).page,2);
  const supplier=selectOffers(offers,taxonomy,{},'demo-morava');
  assert.equal(supplier.total,3); assert.ok(supplier.items.every(o => o.supplierId === 'demo-morava'));
});
test('Sorting keeps deterministic ties and does not compare unrelated currency amounts',() => {
  const a=selectOffers(offers,taxonomy,{sort:'title-asc'}), b=selectOffers(offers,taxonomy,{sort:'title-desc'});
  assert.equal(a.items[0].title,'Agricultural trailer components');
  assert.equal(b.items[0].title,'Water filtration housings');
  assert.equal(selectOffers(offers,taxonomy,{sort:'nonsense'}).items[0].id,'DEMO-MKT-001');
});
test('Broken references, duplicate listing IDs and unsupported currency cannot silently enter the demo',() => {
  assert.throws(() => validateCatalog(taxonomy,[...offers,offers[0]]));
  assert.throws(() => validateCatalog(taxonomy,[{...offers[0],currency:'XXX'}]));
  assert.throws(() => createOffers({...taxonomy,categories:[]}));
});
test('Loopback preview serves only Market assets/pages, rejects writes and never exposes repository/private files',async () => {
  const server=previewServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/','/offers/','/offers/DEMO-MKT-001/','/suppliers/demo-morava/','/assets/app.js','/data/taxonomy.json','/robots.txt']) {
      const response=await fetch(origin+path); assert.equal(response.status,200,path);
      assert.match(response.headers.get('x-robots-tag'),/noindex/);
      assert.match(response.headers.get('content-security-policy'),/form-action 'none'/);
    }
    for (const path of ['/api/session','/api/owner/vault/companies','/.env','/.local/development.env','/server/app.mjs','/docs/OWNER-VAULT.md','/package.json','/assets/../../package.json','/assets/%2e%2e%2f%2e%2e%2fpackage.json','/assets/.env']) assert.equal((await fetch(origin+path)).status,404,path);
    assert.equal((await fetch(origin+'/offers/',{method:'POST',body:'no write'})).status,405);
    assert.equal((await fetch(origin+'/assets/app.js',{method:'HEAD'})).status,200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
