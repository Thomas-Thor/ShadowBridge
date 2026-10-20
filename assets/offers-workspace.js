/* Private offers are fetched in bounded pages. Authorization and DTO redaction
   are enforced by the API and PostgreSQL, never by this interface. */
(() => {
  'use strict';
  const workspace = document.querySelector('#offers-workspace');
  const notice = document.querySelector('#offers-status');
  const grid = document.querySelector('#offers-grid');
  const filters = document.querySelector('#offers-filters');
  const pagination = document.querySelector('#offers-pagination');
  const dialog = document.querySelector('#offer-detail');
  const detail = document.querySelector('#offer-detail-body');
  const pending = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('shadowbridge-session') : null;
  const changedMessage = 'The account in this browser changed or signed out. Reload this page before continuing. Use separate browser profiles for simultaneous accounts.';
  let csrfToken;
  let user;
  let permissions = [];
  let catalog = { categories: [], currencies: [] };
  let closed = false;
  let epoch = 0;
  let listSequence = 0;
  let detailSequence = 0;
  let listController;
  let detailController;
  let sessionCheck;
  let timer;
  let page = 1;
  let pages = 1;
  let restoreFocus;
  const labels = { archived: 'Archived', company: 'Company verification', approved_cooperation: 'Approved cooperation', unreviewed: 'Unreviewed source', supplier_owned: 'Supplier-owned goods', manufacturer_authorized: 'Manufacturer-authorized', independent_inspection: 'Independent inspection reviewed', marketplace_copy: 'Marketplace copy — unverified', clarification_requested: 'Clarification requested', in_review: 'Under review', approved: 'Approved', rejected: 'Rejected', submitted: 'Submitted', draft: 'Draft', not_started: 'Not started', application: 'Application', company_verification: 'Company verification', right_to_sell: 'Right to sell', documents_goods: 'Documents & goods', decision: 'Decision', cooperation_approved: 'Approved cooperation', manufacturer: 'Manufacturer', distributor: 'Distributor', stock_owner: 'Stock owner', authorized_seller: 'Authorized seller' };
  const format = (value) => value == null || value === '' ? 'Not provided' : typeof value === 'object' ? 'Not provided' : String(value);
  const label = (value) => labels[value] || format(value).replaceAll('_', ' ');
  function node(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') element.textContent = format(value);
      else if (value != null) element.setAttribute(key, String(value));
    }
    element.append(...children.filter(Boolean)); return element;
  }
  function report(title, message, error = false) {
    notice.replaceChildren(node('strong', { text: title }), node('p', { text: message }));
    notice.classList.toggle('entry-notice-error', error);
  }
  function linkAction(text, href) {
    document.querySelector('#offers-access-action').replaceChildren(node('p', { class: 'portal-policy' }, [node('a', { class: 'access-entry-link', href, text })]));
  }
  function invalidate(title = 'Browser session changed.', message = changedMessage) {
    if (closed) return;
    closed = true; epoch++; listSequence++; detailSequence++;
    for (const controller of pending) controller.abort();
    pending.clear(); clearTimeout(timer); csrfToken = null; user = null;
    window.ShadowDashboard?.clearPrivate();
    grid.replaceChildren(); detail.replaceChildren();
    if (dialog.open) dialog.close();
    workspace.hidden = true; pagination.hidden = true;
    document.querySelector('#offers-navigation').hidden = true;
    document.querySelector('#offers-account').replaceChildren();
    report(title, message, true); linkAction('Member Sign In', '/member-sign-in/');
  }
  async function api(path, { method = 'GET', body, controller = new AbortController() } = {}) {
    if (closed) throw new Error(changedMessage);
    const requestEpoch = epoch;
    pending.add(controller);
    const headers = { Accept: 'application/json' };
    if (csrfToken) headers['X-Session-Token'] = csrfToken;
    if (method !== 'GET') { headers['X-CSRF-Token'] = csrfToken; headers['Content-Type'] = 'application/json'; }
    try {
      const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json().catch(() => ({}));
      if (closed || requestEpoch !== epoch) throw new Error(changedMessage);
      if (!response.ok) {
        if (response.status === 401 || response.status === 409 || ['session_changed', 'csrf_failed'].includes(result.code)) invalidate();
        if (response.status === 403 && user) invalidate('Workspace authorization changed.', 'Your current permissions or MFA no longer allow this workspace. Sign in or verify your second factor in Command Center.');
        throw new Error(closed ? changedMessage : result.error || 'The secure service could not complete this request.');
      }
      return result;
    } finally { pending.delete(controller); }
  }
  async function verifySession() {
    if (closed || !csrfToken || !user) return;
    if (sessionCheck) return sessionCheck;
    sessionCheck = (async () => {
      const result = await api('/api/session');
      if (result.csrfToken !== csrfToken || result.user?.id !== user.id) { invalidate(); throw new Error(changedMessage); }
      if (workspace.hidden === false && (result.user?.staff !== true || result.user?.aal !== 'aal2' || result.user?.emailVerified !== true)) {
        invalidate('Workspace authorization changed.', 'Your current staff permissions or second factor no longer allow access to this workspace.');
        throw new Error('Workspace authorization changed.');
      }
    })();
    try { await sessionCheck; } finally { sessionCheck = null; }
  }
  function checkVisibleSession() { if (!document.hidden && !closed && user) verifySession().catch(() => {}); }
  channel?.addEventListener('message', (event) => { if (event.data?.sessionChanged === true) invalidate(); });
  window.addEventListener('focus', checkVisibleSession);
  document.addEventListener('visibilitychange', checkVisibleSession);
  window.addEventListener('pageshow', (event) => { if (event.persisted) invalidate(); });
  window.setInterval(checkVisibleSession, 15_000);
  function pictureIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.1');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M5 6h22v20H5z M5 22l7-8 6 7 4-5 5 6 M21 11h.01');
    svg.append(path); return svg;
  }
  function badge(status) { return node('span', { class: 'offer-status', 'data-status': status || '', text: label(status) }); }
  function date(value) {
    if (!value) return 'Not provided';
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? 'Not provided' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  }
  function fact(labelText, value) { return node('span', {}, [node('small', { text: labelText }), node('span', { text: value })]); }
  function amount(data) { return data.price == null || data.price === '' ? 'Not provided' : `${format(data.price)} ${format(data.currency)}${data.unit ? ` / ${format(data.unit)}` : ''}`; }
  function quantity(data) { return data.quantity == null || data.quantity === '' ? 'Not provided' : `${format(data.quantity)} ${data.unit || ''}`.trim(); }
  function card(item) {
    const data = item.data || {};
    const button = node('button', { type: 'button', class: 'offer-card', 'aria-label': `Open ${format(data.productName)} — ${format(item.id)}` }, [
      node('span', { class: 'offer-card-visual' }, [pictureIcon(), node('span', { text: 'No approved images' })]),
      node('span', { class: 'offer-card-content' }, [
        node('span', { class: 'offer-card-reference' }, [node('span', { text: item.id }), badge(item.status)]),
        node('span', { class: 'offer-card-title', text: data.productName || 'Confidential offer' }),
        node('span', { class: 'offer-card-meta' }, [fact('Available quantity', quantity(data)), fact('Unit price', amount(data)), fact('Origin', data.countryOfOrigin), fact('Incoterms', data.incoterms)]),
        node('span', { class: 'offer-card-foot', text: `${label(item.verification?.stage)} · Responsible: ${format(item.responsible?.label)}` }),
        node('span', { class: 'offer-card-action', text: 'Open offer details →' }),
      ]),
    ]);
    button.addEventListener('click', () => openDetail(item.id, button)); return button;
  }
  async function loadList({ reset = false } = {}) {
    if (closed) return;
    if (reset) page = 1;
    listController?.abort(); listController = new AbortController();
    const sequence = ++listSequence;
    const query = new URLSearchParams(new FormData(filters));
    query.set('page', String(page)); query.set('limit', document.querySelector('#offers-limit').value);
    grid.setAttribute('aria-busy', 'true');
    document.querySelector('#offers-previous').disabled = true;
    document.querySelector('#offers-next').disabled = true;
    try {
      const result = await api(`/api/staff/offers?${query}`, { controller: listController });
      if (closed || sequence !== listSequence) return;
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 24 || result.items.length > result.limit || !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) || result.page < 1 || !Number.isSafeInteger(result.pages) || result.pages < 0) throw new Error('The service returned an invalid offer page.');
      page = Number.isSafeInteger(result.page) ? result.page : page;
      pages = Math.max(1, result.pages);
      updateCategoryCounts(result.categoryCounts);
      grid.replaceChildren(...result.items.map(card));
      if (!result.items.length) grid.append(node('p', { class: 'offers-empty', text: 'No offers match your current filters and access permissions.' }));
      const first = result.total === 0 ? 0 : (page - 1) * result.limit + 1;
      const last = result.total === 0 ? 0 : first + result.items.length - 1;
      document.querySelector('#offers-count').textContent = `${first}–${last} of ${result.total} accessible offers`;
      document.querySelector('#offers-page-label').textContent = `Page ${page} of ${pages}`;
      pagination.hidden = result.total === 0;
      document.querySelector('#offers-previous').disabled = page <= 1;
      document.querySelector('#offers-next').disabled = page >= pages;
    } catch (error) {
      if (closed || sequence !== listSequence || error.name === 'AbortError') return;
      grid.replaceChildren(node('p', { class: 'offers-empty portal-error', text: error.message }));
      document.querySelector('#offers-count').textContent = 'Offers could not be loaded.'; pagination.hidden = true;
    } finally { if (sequence === listSequence) grid.setAttribute('aria-busy', 'false'); }
  }
  function section(title, fields, data, className = '') {
    const element = node('section', { class: `offer-detail-section ${className}` }, [node('h3', { text: title })]);
    const list = node('dl');
    for (const [key, name] of fields) list.append(node('dt', { text: name }), node('dd', { text: data?.[key] }));
    element.append(list); return element;
  }
  function renderDetail(item) {
    const data = item.data || {};
    const technical = section('Commercial & technical information', [
      ['category', 'Category'], ['subcategory', 'Subcategory'], ['specification', 'Specification'], ['countryOfOrigin', 'Country of origin'], ['quantity', 'Available quantity'], ['unit', 'Unit'], ['price', 'Unit price'], ['currency', 'Currency'], ['minimumOrderQuantity', 'Minimum order'], ['incoterms', 'Incoterms'], ['availability', 'Availability'], ['validUntil', 'Valid until'],
    ], data);
    const logistics = section('Packaging & transport', [['dimensions', 'Dimensions'], ['weight', 'Weight'], ['packaging', 'Packaging'], ['transport', 'Transport requirements'], ['loadingLocation', 'Loading location'], ['deliveryTerms', 'Delivery terms']], data);
    const verification = section('Supplier qualification', [['sourceKind', 'Source review'], ['sellerKind', 'Supplier profile'], ['stage', 'Verification stage'], ['status', 'Verification status']], Object.fromEntries(Object.entries(item.verification || {}).map(([key, value]) => [key, label(value)])));
    verification.append(node('p', { class: 'portal-policy', text: 'Company registration does not establish a right to sell or verify the goods. A marketplace copy is not evidence of ownership or an independently inspected product.' }));
    if (Array.isArray(item.supplierQualification?.reviews) && item.supplierQualification.reviews.length) {
      const reviews = node('details', { class: 'offer-action' }, [node('summary', { text: 'Supplier qualification decisions & evidence references' })]);
      for (const review of item.supplierQualification.reviews) reviews.append(node('p', { text: `${label(review.stage)} · ${label(review.decision)} · ${date(review.at)}` }), node('p', { text: review.note }), node('p', { text: review.evidenceReference }));
      verification.append(reviews);
    }
    const ownership = section('Responsibility & status', [['responsible', 'Responsible'], ['createdAt', 'Created'], ['updatedAt', 'Last updated']], { responsible: item.responsible?.label, createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) });
    const materials = node('section', { class: 'offer-detail-section offer-detail-wide' }, [node('h3', { text: 'Photos & documents' }), node('div', { class: 'offer-materials' }, [
      node('div', { class: 'offer-material-placeholder' }, [pictureIcon(), node('p', { text: 'No approved product photos are available. Supplier images and independently inspected images will be identified separately.' })]),
      node('div', { class: 'offer-material-placeholder' }, [pictureIcon(), node('p', { text: 'No approved documents are available. Private upload, scanning, anonymization and individually authorized delivery are not enabled.' })]),
    ])]);
    const history = node('section', { class: 'offer-detail-section offer-detail-wide' }, [node('h3', { text: 'Offer history' }), node('p', { class: 'portal-policy', text: 'The latest 50 recorded changes are shown. Complete history is retained in the private audit.' })]);
    if (Array.isArray(item.history) && item.history.length) {
      history.append(node('ol', { class: 'offer-history' }, item.history.map((entry) => node('li', {}, [node('span', { text: label(entry.action) }), entry.status ? node('span', { text: ` · ${label(entry.status)}` }) : null, node('small', { text: `${date(entry.at)} · ${format(entry.actor)}` })]))));
    } else history.append(node('p', { text: 'No visible history is available for this offer.' }));
    detail.replaceChildren(node('h2', { id: 'offer-detail-title', text: data.productName || 'Confidential offer' }), node('p', { class: 'offer-detail-reference' }, [node('span', { text: item.id }), badge(item.status)]), node('p', { class: 'offer-confidentiality', text: item.identityRestricted ? 'Your permissions allow only reviewed, non-identifying commercial information. Counterparty identities and unreleased source details have been omitted by the server.' : 'Internal staff workspace. Protect source information and counterparty identities. Source approval does not authorize release to a buyer.' }), node('div', { class: 'offer-detail-grid' }, [technical, logistics, verification, ownership, materials, history]));
    if (item.classificationReviewRequired) detail.append(node('p', { class: 'offer-confidentiality', text: 'Legacy classification needs manual review. Choose an approved category before a new offer decision.' }));
    renderActions(item);
    if (Array.isArray(item.decisionNotes) && item.decisionNotes.length) {
      const reviews = node('section', { class: 'offer-detail-section' }, [node('h3', { text: 'Internal decision records' })]);
      for (const entry of item.decisionNotes) reviews.append(node('p', { text: `${label(entry.decision)} · ${date(entry.at)} · ${entry.actor}` }), node('p', { text: entry.reason }));
      detail.append(reviews);
    }
  }
  const can = (permission) => permissions.includes(permission);
  const roots = () => catalog.categories.filter((entry) => !entry.parentId && entry.active !== false);
  function fillCategories(select, selected = '', empty = 'Choose category') {
    select.replaceChildren(node('option', { value: '', text: empty }), ...roots().map((entry) => node('option', { value: entry.id, text: entry.label })));
    select.value = selected || '';
  }
  function fillSubcategories(select, categoryId, selected = '', empty = 'No subcategory') {
    const options = catalog.categories.filter((entry) => entry.parentId === categoryId && entry.active !== false);
    select.replaceChildren(node('option', { value: '', text: empty }), ...options.map((entry) => node('option', { value: entry.id, text: entry.label })));
    select.disabled = options.length === 0; select.value = selected || '';
  }
  function updateCategoryCounts(counts) {
    if (!Array.isArray(counts)) return;
    const totals = new Map(counts.map((entry) => [entry.categoryId, entry.count]));
    for (const option of document.querySelector('#offers-category').options) {
      const entry = roots().find((category) => category.id === option.value);
      if (entry) option.textContent = `${entry.label} (${totals.get(entry.id) || 0})`;
    }
  }
  document.querySelector('#offers-category').addEventListener('change', (event) => {
    fillSubcategories(document.querySelector('#offers-subcategory'), event.target.value, '', 'All subcategories');
    clearTimeout(timer); loadList({ reset: true });
  });
  let formNumber = 0;
  function actionForm(parent, title, fields, submitLabel, callback) {
    const disclosure = node('details', { class: 'offer-action' }, [node('summary', { text: title })]);
    const form = node('form', { class: 'offer-action-form' });
    const controls = {};
    for (const field of fields) {
      const id = `offer-action-${++formNumber}`;
      const input = field.options ? node('select', { id, name: field.key }) : field.type === 'textarea' ? node('textarea', { id, name: field.key, rows: 3 }) : node('input', { id, name: field.key, type: field.type || 'text' });
      if (field.options) for (const [value, text] of field.options) input.append(node('option', { value, text }));
      input.value = field.value ?? ''; input.required = field.required === true;
      if (field.minLength) input.minLength = field.minLength;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.type === 'number') { input.min = '0'; input.step = 'any'; }
      controls[field.key] = input;
      form.append(node('label', { class: `entry-field${field.type === 'textarea' ? ' offer-action-wide' : ''}`, for: id }, [node('span', { text: field.label }), input]));
    }
    const status = node('p', { class: 'portal-policy offer-action-wide', role: 'status', 'aria-live': 'polite' });
    const submit = node('button', { type: 'submit', class: 'portal-button', text: submitLabel });
    form.append(status, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!form.reportValidity() || closed) return;
      const actionSequence = detailSequence;
      submit.disabled = true; status.textContent = 'Checking permissions and saving the decision…';
      try {
        await verifySession();
        const result = await callback(Object.fromEntries(new FormData(form)));
        if (closed || !result.item || !dialog.open || actionSequence !== detailSequence) return;
        renderDetail(result.item); await loadList();
      } catch (error) { if (!closed) { status.textContent = error.message; status.classList.add('portal-error'); submit.disabled = false; } }
    });
    disclosure.append(form); parent.append(disclosure); return controls;
  }
  function renderActions(item) {
    const actions = node('section', { class: 'offer-detail-section offer-management-actions' }, [node('h3', { text: 'Authorized management actions' }), node('p', { class: 'portal-policy', text: 'Every decision is checked on the server and recorded in the audit. Source approval never publishes an offer automatically.' })]);
    const post = (operation, body) => api(`/api/staff/offers/${encodeURIComponent(item.id)}/${operation}`, { method: 'POST', body });
    const reason = { key: 'reason', label: 'Internal decision reason', type: 'textarea', minLength: 10, maxLength: 2000, required: true };
    const decisions = [];
    if (can('offers.approve') && item.status !== 'draft') decisions.push(['approved', 'Approve reviewed source offer']);
    if (can('offers.reject') && item.status !== 'draft') decisions.push(['rejected', 'Reject offer']);
    if (can('offers.edit') && item.status !== 'draft') decisions.push(['clarification_requested', 'Request clarification']);
    if (can('offers.archive')) decisions.push(['archived', 'Archive offer']);
    if (decisions.length) actionForm(actions, 'Record offer decision', [{ key: 'decision', label: 'Decision', options: decisions, required: true }, reason], 'Save decision', (data) => post('decision', data));
    if (can('offers.edit')) actionForm(actions, 'Assign responsibility', [{ key: 'responsible', label: 'Responsible manager', options: [['me', 'Assign to me'], ['unassigned', 'Unassigned']], value: item.responsible?.isSelf ? 'me' : 'unassigned', required: true }], 'Update responsibility', (data) => post('assignment', data));
    if (can('offers.edit') && can('supplier_verifications.edit') && can('counterparties.read')) actionForm(actions, 'Review source evidence', [
      { key: 'sourceKind', label: 'Evidence classification', options: ['unreviewed','supplier_owned','manufacturer_authorized','independent_inspection','marketplace_copy'].map((value) => [value, label(value)]), value: item.verification?.sourceKind, required: true },
      { ...reason, label: 'Evidence reviewed and conclusion', minLength: 20 },
    ], 'Record source review', (data) => post('source-review', data));
    if (can('supplier_verifications.edit') && can('counterparties.read') && item.verification?.stage !== 'approved_cooperation') {
      const stage = item.verification?.stage === 'application' ? 'company' : item.verification?.stage || 'company';
      const decisions = [['verified', stage === 'decision' ? 'Approve supplier cooperation' : 'Stage verified']];
      if (can('supplier_verifications.reject')) decisions.push(['rejected', 'Reject at this stage']);
      if (stage !== 'decision' || can('supplier_verifications.approve')) actionForm(actions, `Supplier review: ${label(stage)}`, [
        { key: 'stage', label: 'Required next stage', options: [[stage, label(stage)]], required: true },
        { key: 'sellerKind', label: 'Supplier profile', options: ['manufacturer','distributor','stock_owner','authorized_seller'].map((value) => [value, label(value)]), value: item.verification?.sellerKind || 'manufacturer', required: true },
        { key: 'decision', label: 'Review outcome', options: decisions, required: true },
        { ...reason, label: 'Checks performed and conclusion', minLength: 20 },
        { key: 'evidenceReference', label: 'Internal reviewed-evidence reference', minLength: 6, maxLength: 300, required: true },
      ], 'Save supplier verification stage', (data) => post('supplier-qualification', data));
    }
    if (can('offers.edit') && can('counterparties.read')) {
      const data = item.data || {};
      const fields = [
        { key: 'categoryId', label: 'Category', options: [['', 'Choose category'], ...roots().map((entry) => [entry.id, entry.label])], value: data.categoryId || item.categoryId, required: true },
        { key: 'subcategoryId', label: 'Subcategory', options: [['', 'No subcategory']], value: data.subcategoryId || item.subcategoryId },
        ...[['productName','Product'], ['description','Description'], ['specification','Specification'], ['countryOfOrigin','Country of origin'], ['quantity','Available quantity','number'], ['unit','Unit'], ['price','Source price','number'], ['minimumOrderQuantity','Minimum order quantity','number'], ['incoterms','Incoterms'], ['availability','Availability'], ['validUntil','Valid until','date'], ['dimensions','Dimensions'], ['weight','Weight'], ['packaging','Packaging'], ['transport','Transport requirements'], ['loadingLocation','Loading location'], ['deliveryTerms','Delivery terms']].map(([key, label, type]) => ({ key, label, type: ['description','specification'].includes(key) ? 'textarea' : type, value: data[key], maxLength: ['description','specification'].includes(key) ? 8000 : 250 })),
        { key: 'currency', label: 'Source currency — no conversion', options: catalog.currencies.map((entry) => [entry.code, entry.label]), value: data.currency || 'EUR' },
      ];
      const controls = actionForm(actions, 'Edit commercial details & category', fields, 'Save and require a fresh review', (data) => {
        if (!data.subcategoryId) data.subcategoryId = null;
        for (const key of ['quantity','price','minimumOrderQuantity']) if (data[key] !== '') data[key] = Number(data[key]);
        return post('details', { data });
      });
      fillSubcategories(controls.subcategoryId, controls.categoryId.value, data.subcategoryId || item.subcategoryId);
      controls.categoryId.addEventListener('change', () => fillSubcategories(controls.subcategoryId, controls.categoryId.value));
    }
    if (actions.querySelector('form')) detail.append(actions);
  }
  async function openDetail(id, trigger) {
    if (closed) return;
    detailController?.abort(); detailController = new AbortController();
    const sequence = ++detailSequence; restoreFocus = trigger;
    detail.replaceChildren(node('h2', { id: 'offer-detail-title', text: 'Loading offer…' }), node('p', { class: 'portal-policy', text: 'Checking current access permissions.' }));
    if (!dialog.open) dialog.showModal();
    detail.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/api/staff/offers/${encodeURIComponent(id)}`, { controller: detailController });
      if (closed || sequence !== detailSequence || !dialog.open) return;
      if (!result.item || result.item.id !== id) throw new Error('The service returned an invalid offer detail.');
      renderDetail(result.item); dialog.scrollTop = 0;
    } catch (error) { if (!closed && sequence === detailSequence && error.name !== 'AbortError') detail.replaceChildren(node('h2', { id: 'offer-detail-title', text: 'Offer unavailable' }), node('p', { class: 'portal-policy portal-error', text: error.message })); }
    finally { if (sequence === detailSequence) detail.removeAttribute('aria-busy'); }
  }
  document.querySelector('#offer-detail-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { detailSequence++; detailController?.abort(); detail.replaceChildren(); if (!closed && restoreFocus?.isConnected) restoreFocus.focus(); restoreFocus = null; });
  filters.addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(timer); loadList({ reset: true }); });
  document.querySelector('#offers-search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadList({ reset: true }), 350); });
  for (const id of ['offers-state', 'offers-sort', 'offers-limit', 'offers-subcategory']) document.querySelector(`#${id}`).addEventListener('change', () => { clearTimeout(timer); loadList({ reset: true }); });
  document.querySelector('#offers-previous').addEventListener('click', () => { if (page > 1) { page--; loadList(); } });
  document.querySelector('#offers-next').addEventListener('click', () => { if (page < pages) { page++; loadList(); } });
  async function start() {
    window.ShadowDashboard?.mountShell({ navigation: document.querySelector('#offers-navigation'), role: 'offers' });
    const config = await api('/api/config');
    if (config.backendEnabled !== true || !config.csrfToken) return;
    csrfToken = config.csrfToken;
    const session = await api('/api/session');
    csrfToken = session.csrfToken || csrfToken; user = session.user;
    if (!user) { report('Sign in required.', 'A staff session and individually granted permissions are required.'); linkAction('Member Sign In', '/member-sign-in/'); return; }
    if (!user.staff || !user.emailVerified || user.aal !== 'aal2') { report('Staff authorization & MFA required.', 'Verify your staff account and second factor in Command Center before accessing offers.'); linkAction('Open Command Center', '/portal/admin/'); return; }
    const access = await api('/api/staff/access');
    if (!Array.isArray(access.permissions) || !access.permissions.includes('offers.read')) { report('Offer access not granted.', 'Your current role does not grant permission to read offers. No offer data has been requested.'); linkAction('Return to Command Center', '/portal/admin/'); return; }
    permissions = access.permissions;
    catalog = await api('/api/catalog');
    if (!Array.isArray(catalog.categories) || !Array.isArray(catalog.currencies)) throw new Error('The business classification is unavailable.');
    fillCategories(document.querySelector('#offers-category'), '', 'All categories');
    const account = document.querySelector('#offers-account');
    const signOut = node('button', { class: 'portal-button portal-button-secondary', type: 'button', text: 'Sign out' });
    signOut.addEventListener('click', async () => {
      signOut.disabled = true;
      try { await verifySession(); await api('/api/auth/logout', { method: 'POST', body: {} }); channel?.postMessage({ sessionChanged: true }); invalidate(); location.assign('/member-sign-in/'); }
      catch (error) { if (!closed) { report('Sign out not completed.', error.message, true); signOut.disabled = false; } }
    });
    account.replaceChildren(node('span', { class: 'portal-environment', text: config.environment === 'local' ? 'Local development — not production' : 'Secure staff service' }), node('p', { text: user.email }), signOut);
    report('Authorized offers workspace.', 'Only offers and fields allowed by your current permissions are returned. Source records are never automatically visible to counterparties.');
    document.querySelector('#offers-navigation').hidden = false;
    workspace.hidden = false; await loadList();
  }
  start().catch((error) => { if (!closed) { window.ShadowDashboard?.clearPrivate(); grid.replaceChildren(); workspace.hidden = true; report('Private service unavailable.', `${error.message} No private workspace has been activated.`, true); } });
})();
