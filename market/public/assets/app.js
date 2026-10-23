import { countries, offerTypes, suppliers, createOffers, validateCatalog, selectOffers } from './catalog.js';
import { t, number, money, date } from './en.js';

const main = document.querySelector('main');
const dialog = document.querySelector('#demo-dialog');
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let taxonomy, offers;
const category = id => taxonomy.categories.find(c => c.id === id);
const supplierOf = offer => suppliers.find(s => s.id === offer.supplierId);
const roots = () => taxonomy.categories.filter(c => !c.parentId);
const url = (criteria = {}) => {
  const params = new URLSearchParams(Object.entries(criteria).filter(([,value]) => value && value !== '1'));
  return `/offers/${params.size ? `?${params}` : ''}`;
};
const link = (href,label,classes = '') => `<a class="${classes}" href="${html(href)}">${label}</a>`;
const options = (items, selected, first) => `<option value="">${html(first)}</option>${items.map(({value,label}) => `<option value="${html(value)}"${value === selected ? ' selected' : ''}>${html(label)}</option>`).join('')}`;
const rootOptions = selected => options(roots().map(c => ({value:c.id,label:c.label})),selected,t('allCategories'));
const image = (offer,classes = '',lazy = true) => `<img class="${classes}" src="/assets/images/${offer.imageKey || category(offer.categoryId).key}.svg" alt="Illustration for ${html(offer.title)}; not a product photograph" width="640" height="420" ${lazy ? 'loading="lazy"' : ''}>`;
const pill = offer => `<span class="pill">${html(offerTypes[offer.type])}</span>`;
const price = offer => offer.price === null ? `<strong class="price-unspecified">${t('priceNotProvided')}</strong>` : `<strong>${html(money(offer.price,offer.currency))}</strong><span> / ${html(({kg:'kg',sections:'section',chairs:'chair',modules:'module',pairs:'pair',bottles:'bottle',shelters:'shelter',pallets:'pallet',sets:'set',cases:'case',units:'unit',boxes:'box',metres:'metre',crates:'crate',kits:'kit'})[offer.unit] || offer.unit)}</span>`;
const supplierLink = supplier => link(`/suppliers/${supplier.id}/`,html(supplier.name),'supplier-link');
function card(offer) {
  const supplier = supplierOf(offer), href = `/offers/${offer.id}/`;
  return `<article class="offer-card" data-offer-id="${offer.id}">
    <a class="offer-visual" href="${href}">${image(offer)}<span class="visual-label">DEMO IMAGE</span></a>
    <div class="offer-body"><div class="offer-meta">${pill(offer)}<span>${html(countries[supplier.country])}</span></div>
    <p class="category-label">${html(category(offer.categoryId).label)}</p><h3>${link(href,html(offer.title))}</h3>
    ${supplierLink(supplier)}<p class="offer-quantity">${number(offer.quantity)} ${html(offer.unit)} available <span>· MOQ ${number(offer.moq)}</span></p>
    <div class="offer-bottom"><div class="offer-price">${price(offer)}</div>${link(href,'<span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span><span class="sr-only">View '+html(offer.title)+'</span>','card-arrow')}</div></div></article>`;
}
function searchForm() {
  return `<form class="hero-search" data-market-search action="/offers/"><div class="search-field"><label for="hero-q">${t('searchLabel')}</label><input id="hero-q" name="q" type="search" maxlength="120" placeholder="e.g. machinery, food, stocklots"></div><div class="search-category"><label for="hero-category">Product category</label><select id="hero-category" name="category">${rootOptions('')}</select></div><button class="button" type="submit"><span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg></span> ${t('search')}</button></form>`;
}
function supplierCard(supplier) {
  return `<article class="supplier-card"><div class="supplier-monogram" aria-hidden="true">${supplier.initials}</div><span class="eyebrow">FICTIONAL SUPPLIER</span><h3>${supplierLink(supplier)}</h3><p>${html(supplier.sector)}</p><div class="supplier-card-bottom"><span>${html(supplier.city)}, ${html(countries[supplier.country])}</span>${link(`/suppliers/${supplier.id}/`,'View profile <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span>')}</div></article>`;
}
function home() {
  const latest = selectOffers(offers,taxonomy).items.slice(0,6);
  return `<section class="hero"><div class="container"><div class="hero-grid"><div class="hero-copy"><span class="eyebrow"><span class="tiny-line"></span> THE INTERNATIONAL B2B MARKETPLACE CONCEPT</span><h1>Global trade.<br>A clearer <em>starting point.</em></h1><p>Explore products, wholesale offers and stocklots.<br class="desktop-break"> Find your next business connection — one clear step at a time.</p></div><div class="hero-illustration"><img src="/assets/images/trade-network.svg" width="620" height="360" alt="Original illustration of a bridge connecting trade routes across a globe"><span class="illustration-note">Built for connections. Designed for clarity.</span></div></div>${searchForm()}<div class="hero-bottom"><span><strong>${offers.length}</strong> demo offers</span><span><strong>${Object.keys(countries).length}</strong> countries in this demo</span><span><strong>${roots().length}</strong> product categories</span><span class="hero-footnote">A European demo. A global direction.</span></div></div></section>
    <section class="section container" id="categories"><div class="section-heading"><div><span class="eyebrow">EXPLORE BY SECTOR</span><h2>A world of business, organised.</h2></div>${link('/offers/','Browse all offers <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></span>','text-link')}</div><div class="category-grid">${roots().map((c,i) => `<a class="category-card" href="${url({category:c.id})}"><span class="category-number">0${i+1}</span><h3>${html(c.label)}</h3><span>${offers.filter(o => o.categoryId === c.id).length} demo offers <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span></span></a>`).join('')}</div></section>
    <section class="section container" id="new-offers"><div class="section-heading"><div><span class="eyebrow">THE DEMO CATALOGUE</span><h2>New to the marketplace.</h2><p>Fictional listings. Real browsing experience.</p></div>${link('/offers/',`View all ${offers.length} demo offers <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></span>`,'text-link')}</div><div class="offers-grid home-offers">${latest.map(card).join('')}</div></section>
    <section class="supplier-section"><div class="container section"><div class="section-heading"><div><span class="eyebrow">MEET THE DEMO BUSINESSES</span><h2>Featured supplier profiles.</h2><p>Examples of public company pages — no verification or endorsement implied.</p></div></div><div class="supplier-grid">${suppliers.filter(s => s.featured).map(supplierCard).join('')}</div></div></section>
    <section class="section container audience-grid"><article class="audience-card" id="buyers"><span class="eyebrow">FOR BUYERS</span><h2>Find a useful starting point.</h2><p>Search by product, category and country. Compare clear commercial terms, then explore the supplier profile.</p>${link('/offers/','Explore buying opportunities <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></span>','button')}<small>Browsing only in M1. No accounts or transactions.</small></article><article class="audience-card seller-card" id="suppliers"><span class="eyebrow">FOR SUPPLIERS</span><h2>See how your business could appear.</h2><p>A focused company profile and easy-to-read offers. Preview the supplier experience before real publication is introduced.</p>${link('/suppliers/demo-morava/','Preview a supplier profile <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></span>','button button-outline')}<small>Listing submissions are not available in this prototype.</small></article></section>`;
}
const criteriaFromURL = () => Object.fromEntries(new URLSearchParams(location.search));
function browse() {
  const criteria = criteriaFromURL(), result = selectOffers(offers,taxonomy,criteria);
  const subcategories = taxonomy.categories.filter(c => c.parentId && c.parentId === criteria.category);
  const sort = criteria.sort || 'newest';
  return `<div class="browse-heading"><div class="container"><span class="eyebrow">EXPLORE THE DEMO CATALOGUE</span><h1>Opportunities worth a closer look.</h1><p>Discover fictional wholesale offers, stocklots and surplus goods.</p></div></div><div class="container browse-layout"><aside class="filters"><form id="filter-form" data-market-filters action="/offers/"><details class="filter-panel" ${innerWidth >= 800 ? 'open' : ''}><summary>Filters <span aria-hidden="true">＋</span></summary><div class="filter-content"><h2>Refine your search</h2><label for="filter-q">Search offers</label><input id="filter-q" name="q" type="search" maxlength="120" value="${html(criteria.q || '')}" placeholder="Product or supplier"><label for="filter-category">Category</label><select id="filter-category" name="category">${options(roots().map(c => ({value:c.id,label:`${c.label} (${result.categoryCounts[c.id]})`})),criteria.category,t('allCategories'))}</select><label for="filter-subcategory">Subcategory</label><select id="filter-subcategory" name="subcategory" ${!criteria.category ? 'disabled' : ''}>${options(subcategories.map(c => ({value:c.id,label:c.label})),criteria.subcategory,t('allSubcategories'))}</select><label for="filter-country">Supplier country</label><select id="filter-country" name="country">${options(Object.entries(countries).map(([value,label]) => ({value,label})),criteria.country,t('allCountries'))}</select><label for="filter-type">Offer type</label><select id="filter-type" name="type">${options(Object.entries(offerTypes).map(([value,label]) => ({value,label})),criteria.type,t('allTypes'))}</select><label for="filter-currency">Source currency</label><select id="filter-currency" name="currency">${options(taxonomy.currencies.map(c => ({value:c.code,label:c.label})),criteria.currency,t('allCurrencies'))}</select><button type="submit" class="button">Apply filters</button>${link('/offers/',t('reset'),'clear-link')}</div></details></form><p class="filter-note">All listings and company profiles are fictional. Prices are shown in their source currency; no conversion is applied.</p></aside><section class="browse-results" aria-labelledby="results-heading"><div class="results-toolbar"><div><h2 id="results-heading">${result.total} demo ${result.total === 1 ? 'offer' : 'offers'}</h2><p role="status">${result.total ? `Showing ${(result.page-1)*result.pageSize+1}–${Math.min(result.page*result.pageSize,result.total)} of ${result.total}` : 'Try another search or clear your filters.'}</p></div><div class="sort-field"><label for="sort">Sort by</label><select id="sort" name="sort" form="filter-form">${['newest','title-asc','title-desc','country'].map(value => `<option value="${value}"${sort === value ? ' selected' : ''}>${html(({newest:t('newest'),'title-asc':t('titleAscending'),'title-desc':t('titleDescending'),country:t('country')})[value])}</option>`).join('')}</select></div></div>${result.total ? `<div class="offers-grid">${result.items.map(card).join('')}</div>` : `<div class="empty-state"><span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg></span><h3>${t('noResults')}</h3><p>The prototype contains ${offers.length} fictional listings. No other catalogue is connected.</p>${link('/offers/',t('reset'),'button button-outline')}</div>`}${result.pages > 1 ? `<nav class="pagination" aria-label="Offer pages">${result.page > 1 ? link(url({...criteria,page:result.page-1}),t('previous')) : '<span class="disabled">Previous</span>'}${Array.from({length:result.pages},(_,i) => link(url({...criteria,page:i+1}),String(i+1),result.page === i+1 ? 'current-page' : '')).join('')}${result.page < result.pages ? link(url({...criteria,page:result.page+1}),t('next')) : '<span class="disabled">Next</span>'}<span>Page ${result.page} of ${result.pages}</span></nav>` : ''}</section></div>`;
}
const breadcrumb = items => `<nav class="breadcrumb" aria-label="Breadcrumb">${link('/','Market')}<span aria-hidden="true">/</span>${items.join('<span aria-hidden="true">/</span>')}</nav>`;
const facts = items => `<dl class="facts">${items.map(([label,value]) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>`;
function offerDetails(offer) {
  const supplier = supplierOf(offer), parent = category(offer.categoryId), sub = category(offer.subcategoryId);
  return `<div class="container detail-page">${breadcrumb([link('/offers/','Browse offers'),`<span aria-current="page">${html(offer.title)}</span>`])}<div class="offer-detail-grid"><div><div class="detail-image">${image(offer,'',false)}<span class="visual-label">DEMO PRODUCT ILLUSTRATION</span></div><section class="detail-section"><span class="eyebrow">ABOUT THIS DEMO LISTING</span><h2>Product overview</h2><p>${html(offer.description)}</p>${facts(offer.specifications.map(s => [s.label,s.value]))}</section><section class="notice"><h2>Demonstration, not a live offer.</h2><p>No inventory, certificates or supplier identity have been verified. The image is an original illustration, not a photograph of available goods.</p></section></div><div class="detail-summary"><div class="detail-tags">${pill(offer)}<span class="demo-badge">DEMO LISTING</span></div><p class="category-label">${html(parent.label)} / ${html(sub.label)}</p><h1>${html(offer.title)}</h1><p class="listing-id">${offer.id} · Published ${date(offer.publishedAt)}</p><div class="detail-price">${price(offer)}<p>Illustrative terms in ${offer.currency}. No currency conversion.</p></div>${facts([['Quantity',`${number(offer.quantity)} ${offer.unit}`],['Minimum order',`${number(offer.moq)} ${offer.unit}`],['Supplier country',countries[supplier.country]],['Incoterms',offer.incoterms || 'Not provided'],['Availability',offer.availability]])}<button class="button enquiry-button" type="button" data-enquire="${offer.id}">${t('demoEnquiry')} <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg></span></button><p class="action-note">Demonstration only. No message will be sent.</p><section class="supplier-summary"><span class="eyebrow">SUPPLIER · FICTIONAL PROFILE</span><h2>${supplierLink(supplier)}</h2><p>${html(supplier.city)}, ${html(countries[supplier.country])}</p>${link(`/suppliers/${supplier.id}/`,`${t('viewSupplier')} <span aria-hidden="true"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></span>`,'text-link')}</section></div></div><section class="section related-section"><div class="section-heading"><div><span class="eyebrow">KEEP EXPLORING</span><h2>More from this demo supplier.</h2></div></div><div class="offers-grid">${offers.filter(o => o.supplierId === supplier.id && o.id !== offer.id).slice(0,3).map(card).join('')}</div></section></div>`;
}
function supplierProfile(supplier) {
  const listings = offers.filter(o => o.supplierId === supplier.id);
  return `<div class="container supplier-page">${breadcrumb([link('/offers/','Browse offers'),`<span aria-current="page">Demo supplier profile</span>`])}<section class="supplier-profile"><div class="profile-top"><div class="supplier-monogram large" aria-hidden="true">${supplier.initials}</div><div><span class="eyebrow">FICTIONAL COMPANY · DEMONSTRATION PROFILE</span><h1>${html(supplier.name)}</h1><p>${html(supplier.city)}, ${html(countries[supplier.country])} <span aria-hidden="true">·</span> ${html(supplier.sector)}</p></div></div><div class="profile-body"><div><h2>About this demo business</h2><p>${html(supplier.description)}</p><p class="muted">No real company contact details, website or registration number are provided.</p></div>${facts([['Country',countries[supplier.country]],['Industry',supplier.sector],['Demo listings',String(listings.length)],['Verification','Not assessed — fictional business']])}</div></section><section class="section"><div class="section-heading"><div><span class="eyebrow">SUPPLIER CATALOGUE</span><h2>Demo offers from this company.</h2></div><span class="demo-badge">${listings.length} FICTIONAL LISTINGS</span></div><div class="offers-grid supplier-offers">${listings.map(card).join('')}</div></section><section class="notice"><h2>Public profile concept. No private access.</h2><p>A future Market account will not automatically grant access to ShadowBridge International, C.A.R.T.E.L. or any internal administration tools.</p></section></div>`;
}
function render({focus = false} = {}) {
  const route = location.pathname;
  let content, title;
  if (route === '/') { content = home(); title = 'B2B marketplace demo'; }
  else if (route === '/offers/') { content = browse(); title = 'Browse demo offers'; }
  else {
    const offer = offers.find(o => route === `/offers/${o.id}/`);
    const supplier = suppliers.find(s => route === `/suppliers/${s.id}/`);
    if (offer) { content = offerDetails(offer); title = offer.title; }
    else if (supplier) { content = supplierProfile(supplier); title = supplier.name; }
    else { content = `<div class="container empty-state"><h1>Demo page not found.</h1><p>This record is not part of the fictional catalogue.</p>${link('/offers/','Browse demo offers','button')}</div>`; title = 'Page not found'; }
  }
  main.innerHTML = content;
  document.title = `${title} | ShadowBridge Market`;
  document.querySelector('[data-nav="offers"]').toggleAttribute('aria-current',route.startsWith('/offers/'));
  if (route.startsWith('/offers/')) document.querySelector('[data-nav="offers"]').setAttribute('aria-current','page');
  document.querySelector('.menu-button').setAttribute('aria-expanded','false');
  document.querySelector('#main-nav').classList.remove('is-open');
  const currentPage = main.querySelector('.current-page');
  if (currentPage) currentPage.setAttribute('aria-current','page');
  if (focus) { main.focus(); window.scrollTo(0,0); }
  if (location.hash) requestAnimationFrame(() => { const target = document.getElementById(location.hash.slice(1)); if (target) { target.scrollIntoView(); target.setAttribute('tabindex','-1'); target.focus({preventScroll:true}); } });
}
function navigate(href) {
  if (dialog.open) dialog.close();
  history.pushState({},'',href);
  render({focus:true});
}
dialog.addEventListener('keydown',event => {
  if (event.key !== 'Tab') return;
  const buttons = [...dialog.querySelectorAll('button:not([disabled])')];
  const first = buttons[0], last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
document.querySelector('.menu-button').addEventListener('click',event => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  event.currentTarget.setAttribute('aria-expanded',String(open));
  document.querySelector('#main-nav').classList.toggle('is-open',open);
});
document.addEventListener('keydown',event => {
  if (event.key === 'Escape' && document.querySelector('#main-nav').classList.contains('is-open')) {
    document.querySelector('#main-nav').classList.remove('is-open');
    document.querySelector('.menu-button').setAttribute('aria-expanded','false');
    document.querySelector('.menu-button').focus();
  }
});
document.addEventListener('click',event => {
  const enquiry = event.target.closest('[data-enquire]');
  if (enquiry) {
    document.querySelector('#dialog-context').textContent = `${enquiry.dataset.enquire}: ${offers.find(o => o.id === enquiry.dataset.enquire).title}.`;
    dialog.showModal(); return;
  }
  if (event.target.closest('[data-close-dialog]')) { dialog.close(); return; }
  const anchor = event.target.closest('a[href]');
  if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target || anchor.hasAttribute('download') || !taxonomy) return;
  const target = new URL(anchor.href);
  if (target.origin !== location.origin) return;
  if (anchor.classList.contains('skip-link')) return;
  event.preventDefault(); navigate(target.pathname+target.search+target.hash);
});
document.addEventListener('submit',event => {
  if (!event.target.matches('[data-market-search],[data-market-filters]')) return;
  event.preventDefault();
  navigate(url(Object.fromEntries(new FormData(event.target))));
});
document.addEventListener('change',event => {
  if (event.target.id === 'filter-category') {
    const select = document.querySelector('#filter-subcategory');
    select.innerHTML = options(taxonomy.categories.filter(c => c.parentId === event.target.value).map(c => ({value:c.id,label:c.label})),'',t('allSubcategories'));
    select.disabled = !event.target.value;
  }
  if (event.target.id === 'sort') document.querySelector('#filter-form').requestSubmit();
});
window.addEventListener('popstate',() => render({focus:true}));
try {
  const response = await fetch('/data/taxonomy.json', {credentials:'omit'});
  if (!response.ok) throw new Error('Catalogue unavailable.');
  taxonomy = await response.json(); offers = createOffers(taxonomy); validateCatalog(taxonomy,offers); render();
} catch {
  taxonomy = null;
  main.innerHTML = '<div class="container empty-state" role="alert"><h1>The demo catalogue could not load.</h1><p>No live service is connected. Check the local preview server, then reload this page.</p><a class="button" href="/">Reload demo</a></div>';
}
