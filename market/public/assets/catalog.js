// Hand-authored fictional fixtures. Not sourced from International, Vault or Scout.
export const countries = { PL: 'Poland', CZ: 'Czechia', DE: 'Germany', NL: 'Netherlands', NO: 'Norway' };
export const offerTypes = { wholesale: 'Wholesale', stocklot: 'Stocklot', surplus: 'Surplus' };
export const suppliers = [
  { id: 'demo-baltic', name: 'Baltic Field Supply (DEMO)', country: 'PL', city: 'Poznań', sector: 'Food & agricultural supplies', initials: 'BF', description: 'A fictional wholesale supplier used to demonstrate food and agricultural product listings. All company information and quantities are invented for interface testing.', featured: true },
  { id: 'demo-morava', name: 'Morava Works (DEMO)', country: 'CZ', city: 'Brno', sector: 'Machinery & industrial components', initials: 'MW', description: 'An invented industrial distributor demonstrating machinery and component offers. This profile is not a registered or verified trading company.', featured: true },
  { id: 'demo-rhein', name: 'Rhein Materials (DEMO)', country: 'DE', city: 'Düsseldorf', sector: 'Materials & workplace supplies', initials: 'RM', description: 'A fictional materials supplier for the Market prototype. Product specifications, commercial terms and availability are demonstration content only.', featured: false },
  { id: 'demo-delta', name: 'Delta Trade Collective (DEMO)', country: 'NL', city: 'Rotterdam', sector: 'Hospitality & wholesale goods', initials: 'DT', description: 'An invented wholesale business illustrating hospitality goods and mixed stocklots. No real company, inventory or commercial contact is represented.', featured: true },
  { id: 'demo-fjord', name: 'Fjord Resource Supply (DEMO)', country: 'NO', city: 'Bergen', sector: 'Energy & infrastructure equipment', initials: 'FR', description: 'A fictional equipment supplier illustrating cross-border B2B listings. This company and its product offers exist only in this local demonstration.', featured: false },
  { id: 'demo-northline', name: 'Northline Relief Goods (DEMO)', country: 'PL', city: 'Gdańsk', sector: 'Emergency & humanitarian supplies', initials: 'NR', description: 'An invented supplier for demonstrating humanitarian goods categories. No quality certification, field inspection or supplier verification is claimed.', featured: false },
];
// id, supplier, title, subcategory key, offer type, quantity, unit, MOQ, unit price,
// ISO source currency, published day. Null price means genuinely unspecified.
const rows = [
  ['001','baltic','Bulk rolled oats','grains-ingredients','wholesale',24000,'kg',1000,0.85,'EUR','2026-10-23'],
  ['002','morava','Modular conveyor sections','industrial-machinery','surplus',24,'sections',4,320,'EUR','2026-10-22'],
  ['003','delta','Stackable hospitality chairs','furniture-fittings','stocklot',600,'chairs',50,38,'EUR','2026-10-21'],
  ['004','fjord','Commercial solar modules','renewables','wholesale',180,'modules',30,890,'NOK','2026-10-20'],
  ['005','rhein','Industrial work gloves','safety-equipment','stocklot',8000,'pairs',500,1.9,'EUR','2026-10-19'],
  ['006','baltic','Still drinking water · 1.5 L','drinking-water','wholesale',20000,'bottles',1000,1.25,'PLN','2026-10-18'],
  ['007','northline','Foldable emergency shelters','shelter-relief','wholesale',120,'shelters',10,null,'USD','2026-10-17'],
  ['008','delta','Mixed packaging stocklot','surplus-stock','stocklot',80,'pallets',10,null,'EUR','2026-10-16'],
  ['009','morava','Precision bearing sets','spare-parts','wholesale',3200,'sets',100,12.5,'EUR','2026-10-15'],
  ['010','rhein','Aluminium profile bundles','raw-materials','surplus',12000,'kg',500,3.4,'EUR','2026-10-14'],
  ['011','baltic','Preserved vegetable assortment','processed-food','stocklot',6000,'cases',200,42,'PLN','2026-10-13'],
  ['012','delta','Hotel linen sets','hospitality-consumables','wholesale',2400,'sets',100,24,'GBP','2026-10-12'],
  ['013','fjord','Water filtration housings','water-treatment','wholesale',160,'units',10,450,'NOK','2026-10-11'],
  ['014','northline','Emergency food supply boxes','emergency-food-water','wholesale',1000,'boxes',50,19,'USD','2026-10-10'],
  ['015','morava','Agricultural trailer components','agricultural-equipment','surplus',180,'sets',20,95,'EUR','2026-10-09'],
  ['016','rhein','Infrastructure cable trays','construction-infrastructure','wholesale',2000,'metres',100,8.75,'EUR','2026-10-08'],
  ['017','delta','Reusable warehouse crates','other-goods-services','stocklot',1500,'crates',100,6,'EUR','2026-10-07'],
  ['018','northline','Portable relief lighting kits','humanitarian-equipment','wholesale',360,'kits',30,48,'USD','2026-10-06'],
];
const productImages = { '005':'work-gloves','009':'bearing-sets','011':'preserved-food','012':'hotel-linen','013':'filtration-housings','015':'trailer-components','016':'cable-trays','017':'warehouse-crates','018':'relief-lighting' };
export function createOffers(taxonomy) {
  return rows.map(([number,supplier,title,subcategoryKey,type,quantity,unit,moq,price,currency,day]) => {
    const subcategory = taxonomy.categories.find(c => c.key === subcategoryKey);
    if (!subcategory?.parentId) throw new Error(`Missing canonical subcategory: ${subcategoryKey}`);
    return { id: `DEMO-MKT-${number}`, supplierId: `demo-${supplier}`, title, imageKey: productImages[number] || null, categoryId: subcategory.parentId, subcategoryId: subcategory.id, type, quantity, unit, moq, price, currency, publishedAt: `${day}T09:00:00Z`, incoterms: number === '007' || number === '008' ? null : 'FCA', availability: 'Illustrative only — not live inventory', description: `Fictional ${title.toLowerCase()} listing for the ShadowBridge Market prototype. The quantity, price and trading terms demonstrate the interface; no goods are offered for sale.`, specifications: [{ label: 'Packaging', value: 'Illustrative palletised shipment' }, { label: 'Condition', value: type === 'surplus' ? 'Unused surplus — demo scenario' : 'New goods — demo scenario' }, { label: 'Documents', value: 'Not provided in this prototype' }] };
  });
}
export function validateCatalog(taxonomy, offers) {
  const ids = new Set();
  for (const offer of offers) {
    const category = taxonomy.categories.find(c => c.id === offer.categoryId && !c.parentId);
    const subcategory = taxonomy.categories.find(c => c.id === offer.subcategoryId && c.parentId === offer.categoryId);
    if (ids.has(offer.id) || !/^DEMO-MKT-\d{3}$/.test(offer.id) || !category || !subcategory || !suppliers.some(s => s.id === offer.supplierId) || !offerTypes[offer.type] || !taxonomy.currencies.some(c => c.code === offer.currency) || !(offer.quantity > 0 && offer.moq > 0 && offer.moq <= offer.quantity) || !(offer.price === null || offer.price >= 0)) throw new Error('Invalid fictional catalogue.');
    ids.add(offer.id);
  }
  return true;
}
export function selectOffers(offers, taxonomy, criteria = {}, supplierId = null) {
  const query = String(criteria.q || '').normalize('NFKC').trim().toLocaleLowerCase('en').slice(0,120);
  const base = offers.filter(o => {
    const supplier = suppliers.find(s => s.id === o.supplierId);
    const category = taxonomy.categories.find(c => c.id === o.categoryId);
    const subcategory = taxonomy.categories.find(c => c.id === o.subcategoryId);
    return (!supplierId || supplierId === o.supplierId) && (!criteria.country || supplier.country === criteria.country) && (!criteria.type || o.type === criteria.type) && (!criteria.currency || o.currency === criteria.currency) && (!query || [o.title,o.id,supplier.name,supplier.city,countries[supplier.country],category.label,subcategory.label].join(' ').toLocaleLowerCase('en').includes(query));
  });
  const categoryCounts = Object.fromEntries(taxonomy.categories.filter(c => !c.parentId).map(c => [c.id,base.filter(o => o.categoryId === c.id).length]));
  const filtered = base.filter(o => (!criteria.category || o.categoryId === criteria.category) && (!criteria.subcategory || o.subcategoryId === criteria.subcategory));
  const sorters = { newest: (a,b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id), 'title-asc': (a,b) => a.title.localeCompare(b.title,'en') || a.id.localeCompare(b.id), 'title-desc': (a,b) => b.title.localeCompare(a.title,'en') || a.id.localeCompare(b.id), country: (a,b) => countries[suppliers.find(s => s.id === a.supplierId).country].localeCompare(countries[suppliers.find(s => s.id === b.supplierId).country],'en') || a.id.localeCompare(b.id) };
  filtered.sort(sorters[criteria.sort] || sorters.newest);
  const pageSize = 9, pages = Math.max(1,Math.ceil(filtered.length/pageSize));
  const page = Math.max(1,Math.min(pages,Math.floor(Number(criteria.page)) || 1));
  return { items: filtered.slice((page-1)*pageSize,page*pageSize), total: filtered.length, page, pages, pageSize, categoryCounts };
}
