/* Private DTOs are fetched only from the authenticated same-origin BFF.
   No tokens, private data, role claims or MFA secrets are persisted in browser storage. */
(() => {
  'use strict';
  const role = document.body.dataset.portalRole;
  const root = document.querySelector('#portal-content');
  const notice = document.querySelector('#portal-status');
  const nav = document.querySelector('#portal-navigation');
  let csrfToken;
  let session;
  let managementAccess;
  let memberDashboard;
  let businessCatalog = { categories: [], currencies: [] };
  const currencyOptions = () => businessCatalog.currencies.map(({ code, label }) => ({ value: code, label }));
  const categoryOptions = () => businessCatalog.categories.filter(item => !item.parentId).map(({ id, label }) => ({ value: id, label }));
  const subcategoryOptions = () => businessCatalog.categories.filter(item => item.parentId).map(({ id, label }) => ({ value: id, label }));
  const classificationFields = () => [
    ['categoryId', 'Product category', 'select', true, categoryOptions],
    ['subcategoryId', 'Product subcategory (optional)', 'select', false, subcategoryOptions],
  ];
  const canManage = (permission) => Array.isArray(permission) ? permission.every(canManage) : managementAccess?.owner === true || managementAccess?.permissions?.includes(permission) === true;
  let closed = false;
  let sessionCheck;
  let epoch = 0;
  const pending = new Set();
  const sessionChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('shadowbridge-session') : null;
  const changedMessage = 'The account in this browser changed or signed out. Reload the page to continue. Use separate browser profiles or a private window for different accounts.';
  function sessionChanged() {
    if (closed) return;
    closed = true; epoch++;
    for (const controller of pending) controller.abort();
    pending.clear(); csrfToken = null; session = null;
    memberDashboard?.clear();
    window.ShadowOwnerVault?.clearPrivate();
    window.ShadowOwnerBook?.clearPrivate();
    window.ShadowDashboard?.clearPrivate();
    root.replaceChildren(); nav.replaceChildren(); nav.hidden = true;
    document.querySelector('#portal-account')?.replaceChildren();
    status('Browser session changed.', changedMessage, true);
    root.append(el('p', {}, [el('a', { class: 'access-entry-link', href: '/member-sign-in/', text: 'Member Sign In' })]));
  }
  function announceSessionChange() { sessionChannel?.postMessage({ sessionChanged: true }); }
  const text = (value) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') node.textContent = text(value);
      else if (key === 'class') node.className = value;
      else if (key === 'onClick') node.addEventListener('click', value);
      else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...children.filter(Boolean)); return node;
  }
  function status(title, message, error = false) {
    notice.replaceChildren(el('strong', { text: title }), el('p', { text: message }));
    notice.classList.toggle('entry-notice-error', error);
  }
  async function request(path, method = 'GET', body) {
    if (closed) throw new Error(changedMessage);
    const requestEpoch = epoch;
    const controller = new AbortController(); pending.add(controller);
    const headers = { Accept: 'application/json' };
    if (csrfToken) headers['X-Session-Token'] = csrfToken;
    if (method !== 'GET') { headers['X-CSRF-Token'] = csrfToken; headers['Content-Type'] = 'application/json'; }
    try {
      const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json().catch(() => ({}));
      if (closed || requestEpoch !== epoch) throw new Error(changedMessage);
      if (!response.ok) {
        if (response.status === 401 || result.code === 'session_changed' || result.code === 'csrf_failed') sessionChanged();
        if ((path.startsWith('/api/owner/vault') || path.startsWith('/api/owner/book')) && response.status === 403 && result.code !== 'FRESH_MFA_REQUIRED') sessionChanged();
        throw new Error(closed ? changedMessage : result.error || 'The secure service could not complete this request.');
      }
      return result;
    } finally { pending.delete(controller); }
  }
  async function verifySession() {
    if (closed || !csrfToken) return;
    if (sessionCheck) return sessionCheck;
    sessionCheck = (async () => {
      const result = await request('/api/session');
      const sameAccess = session && result.user && ['id', 'status', 'staff', 'aal', 'applicationStatus', 'recoveryOnly'].every(key => result.user[key] === session[key])
        && JSON.stringify([...(result.user.roles || [])].sort()) === JSON.stringify([...(session.roles || [])].sort());
      if (result.csrfToken !== csrfToken || (session && !sameAccess)) {
        sessionChanged(); throw new Error(changedMessage);
      }
      if (managementAccess?.owner === true) {
        const current = await request('/api/staff/access');
        if (current.owner !== true) { sessionChanged(); throw new Error(changedMessage); }
      }
    })();
    try { await sessionCheck; } finally { sessionCheck = null; }
  }
  async function api(path, method = 'GET', body) {
    // A preflight keeps stale drafts from being submitted after an account
    // switch. Session-bound headers also protect the gap before the POST.
    if (method !== 'GET') await verifySession();
    const result = await request(path, method, body);
    if (result.csrfToken && result.csrfToken !== csrfToken && ['/api/auth/mfa/verify', '/api/auth/logout'].includes(path)) {
      csrfToken = result.csrfToken;
      if (path === '/api/auth/mfa/verify' && result.user) session = result.user;
      announceSessionChange();
    }
    return result;
  }
  sessionChannel?.addEventListener('message', (event) => { if (event.data?.sessionChanged === true) sessionChanged(); });
  function checkVisibleSession() { if (!document.hidden && !closed && session) verifySession().catch(() => {}); }
  window.addEventListener('focus', checkVisibleSession);
  document.addEventListener('visibilitychange', checkVisibleSession);
  window.addEventListener('pageshow', (event) => { if (event.persisted) sessionChanged(); });
  window.setInterval(checkVisibleSession, 15_000);
  function button(label, action, secondary = false) {
    const node = el('button', { type: 'button', class: `portal-button${secondary ? ' portal-button-secondary' : ''}`, text: label });
    node.addEventListener('click', async () => {
      node.disabled = true;
      try { await action(); } catch (error) { status('Request not completed.', error.message, true); }
      finally { if (node.isConnected) node.disabled = false; }
    }); return node;
  }
  function section(title, description, parent = root) {
    const node = el('section', { class: 'portal-section' }, [el('h2', { text: title }), description ? el('p', { text: description }) : null]);
    parent.append(node); return node;
  }
  function details(data, fields) {
    const dl = el('dl');
    for (const [key, label] of fields) {
      let value = data?.[key];
      if (['categoryId', 'subcategoryId'].includes(key) && value) value = businessCatalog.categories.find(item => item.id === value)?.label || 'Classification requires staff review';
      if (value !== undefined && value !== null && value !== '') dl.append(el('dt', { text: label }), el('dd', { text: value }));
    }
    return dl;
  }
  function empty(parent, message) { parent.append(el('p', { class: 'portal-empty', text: message })); }
  function listLoader(parent, path, render, message = 'No records have been assigned to this account.') {
    const holder = el('div', { 'aria-live': 'polite' }); parent.append(holder);
    async function refresh() {
      holder.setAttribute('aria-busy', 'true');
      try {
        const result = await api(path);
        if (closed) return;
        if (!Array.isArray(result.items)) throw new Error('Invalid response from the secure service.');
        memberDashboard?.observe(path, result);
        holder.replaceChildren();
        if (!result.items.length) empty(holder, message);
        for (const item of result.items) await render(holder, item, refresh);
      } catch (error) { if (!closed) { memberDashboard?.fail(path); holder.replaceChildren(el('p', { class: 'portal-error', text: error.message })); } }
      finally { holder.removeAttribute('aria-busy'); }
    }
    refresh(); return refresh;
  }
  let fieldSequence = 0;
  function form(parent, fields, submitLabel, onSubmit, values = {}) {
    const node = el('form', { class: 'entry-panel', method: 'post' });
    const fs = el('fieldset'); const grid = el('div', { class: 'entry-fields' });
    fs.style.border = '0'; fs.style.padding = '0'; fs.style.minWidth = '0';
    for (const item of fields) {
      const [name, label, type = 'text', required = false, options] = item;
      const id = `portal-field-${++fieldSequence}`;
      let control;
      if (type === 'textarea') control = el('textarea', { id, name, rows: 4, maxlength: 5000, required });
      else if (type === 'select') { control = el('select', { id, name, required }); control.append(el('option', { value: '', text: 'Select…', disabled: required })); for (const option of typeof options === 'function' ? options() : options || []) control.append(el('option', { value: typeof option === 'object' ? option.value : option, text: typeof option === 'object' ? option.label : option })); }
      else control = el('input', { id, name, type, required, maxlength: type === 'number' ? null : 1000, ...(type === 'number' ? { min: 0, step: 'any' } : {}), ...(name === 'code' ? { inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code' } : {}), ...(name === 'agreementReference' ? { pattern: '(?:[A-Z0-9]|-){3,80}', minlength: 3, maxlength: 80, title: 'Use 3–80 uppercase letters, numbers and hyphens. Do not include company names or contact details.' } : {}) });
      if (type === 'checkbox') { control.checked = values[name] === true; grid.append(el('label', { class: 'entry-check' }, [control, document.createTextNode(label)])); }
      else { control.value = values[name] == null ? '' : Array.isArray(values[name]) ? values[name].join(', ') : text(values[name]); grid.append(el('label', { class: `entry-field${type === 'textarea' ? ' entry-wide' : ''}`, for: id }, [document.createTextNode(label), control])); }
    }
    const category = node.querySelector('[name="categoryId"]') || grid.querySelector('[name="categoryId"]');
    const subcategory = grid.querySelector('[name="subcategoryId"]');
    if (category && subcategory) {
      const updateSubcategories = (selected = '') => {
        subcategory.replaceChildren(el('option', { value: '', text: 'Select…' }));
        for (const item of businessCatalog.categories.filter(item => item.parentId === category.value)) subcategory.append(el('option', { value: item.id, text: item.label }));
        subcategory.value = [...subcategory.options].some(option => option.value === selected) ? selected : '';
        subcategory.disabled = !category.value || subcategory.options.length === 1;
      };
      category.addEventListener('change', () => updateSubcategories());
      updateSubcategories(values.subcategoryId || '');
      node.addEventListener('reset', () => queueMicrotask(() => updateSubcategories()));
    }
    const submit = el('button', { type: 'submit', class: 'entry-submit', text: submitLabel });
    const output = el('p', { class: 'portal-form-message', role: 'status', 'aria-live': 'polite' });
    fs.append(grid, submit); node.append(fs, output); parent.append(node);
    node.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!node.reportValidity()) return;
      const fd = new FormData(node); const data = Object.fromEntries(fd.entries());
      if (category && !Object.hasOwn(data, 'subcategoryId')) data.subcategoryId = '';
      for (const [name, , type] of fields) if (type === 'checkbox') data[name] = fd.has(name);
      fs.disabled = true; node.setAttribute('aria-busy', 'true'); output.textContent = '';
      try { const result = await onSubmit(data, node); if (result !== false) { output.textContent = 'Saved securely.'; if (node.dataset.preserveValues !== 'true') node.reset(); } }
      catch (error) { output.textContent = error.message; output.classList.add('portal-error'); }
      finally { fs.disabled = false; node.removeAttribute('aria-busy'); }
    }); return node;
  }
  const offerFields = [
    ...classificationFields(), ['productName', 'Product name', 'text', true],
    ['description', 'Description — no counterparty names or contact details', 'textarea', true], ['specification', 'Technical specification', 'textarea', true],
    ['countryOfOrigin', 'Country of origin', 'text', true], ['quantity', 'Available quantity', 'number', true], ['unit', 'Quantity unit', 'text', true],
    ['price', 'Unit price', 'number', true], ['currency', 'Currency', 'select', true, currencyOptions],
    ['minimumOrderQuantity', 'Minimum order quantity', 'number', true], ['incoterms', 'Incoterms', 'select', true, ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']],
    ['loadingLocation', 'Loading location', 'text', true], ['deliveryTerms', 'Delivery terms', 'textarea', true], ['availability', 'Availability', 'text', true],
    ['validUntil', 'Offer valid until', 'date', true], ['certificationsStatus', 'Certificates / document status (no uploads)', 'text'], ['notes', 'Internal notes for ShadowBridge', 'textarea'],
  ];
  const rfqFields = [
    ...classificationFields(), ['product', 'Product required', 'text', true], ['specifications', 'Required specifications', 'textarea', true], ['quantity', 'Required quantity', 'number', true],
    ['unit', 'Quantity unit', 'text', true], ['budget', 'Target budget (optional)', 'number'], ['currency', 'Currency', 'select', true, currencyOptions],
    ['deliveryCountry', 'Delivery country', 'text', true], ['deadline', 'Required delivery date', 'date', true], ['certificates', 'Required certificates', 'textarea'], ['requirements', 'Additional requirements for ShadowBridge', 'textarea'],
  ];
  const proposalFields = [['title', 'Opportunity title', 'text', true], ['description', 'Opportunity summary for ShadowBridge', 'textarea', true], ['countries', 'Relevant countries', 'text', true], ['sectors', 'Relevant sectors', 'text', true], ['scope', 'Your proposed cooperation', 'textarea', true]];
  function recordCard(parent, item, heading) {
    const card = el('article', { class: 'portal-record' }, [el('h3', { text: heading || item.id }), el('small', { text: `${item.id || ''} · ${item.status || ''}` })]);
    parent.append(card); return card;
  }
  function communications(parent, resourceType, resourceId) {
    const host = el('div'); parent.append(host);
    host.append(button('Open ShadowBridge conversation', async () => {
      host.replaceChildren(el('h4', { text: 'Conversation with ShadowBridge' }));
      const messages = el('div'); host.append(messages);
      const refresh = listLoader(messages, `/api/messages?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`,
        (holder, item) => holder.append(el('div', { class: 'portal-record' }, [el('small', { text: item.createdAt || '' }), el('p', { text: item.body })])), 'No messages in this conversation.');
      if (!managementAccess || canManage('messages.create')) form(host, [['body', 'Message to ShadowBridge', 'textarea', true]], 'Send to ShadowBridge', async (data) => {
        await api('/api/messages', 'POST', { resourceType, resourceId, body: data.body }); await refresh();
      });
    }, true));
  }
  function resourceWorkspace(kind, title, fields, dataTitle) {
    const grid = el('div', { class: 'portal-grid' }); root.append(grid);
    const create = section(`New ${title}`, 'Start with a title and save your private draft. Complete the commercial details before submitting it for individual ShadowBridge review. Submitting never publishes it automatically.', grid);
    create.append(el('p', { class: 'portal-document-notice', text: 'Document uploads are disabled. Only approved, non-identifying commercial summaries may be released by management.' }));
    const list = section(`Your ${kind === 'rfqs' ? 'purchase requests' : kind === 'offers' ? 'offers' : 'opportunities'}`, 'Only your own records are returned by the secure service.', grid);
    create.id = 'workspace-draft'; list.id = 'workspace-records';
    const singular = kind === 'rfqs' ? 'rfq' : kind === 'offers' ? 'offer' : 'proposal';
    const draftFields = fields.map(([name, label, type, required, options]) => [name, label, type, [dataTitle, 'categoryId'].includes(name), options]);
    const refresh = listLoader(list, `/api/${kind}`, async (parent, item, reload) => {
      const card = recordCard(parent, item, item.data?.[dataTitle]);
      if (item.classificationReviewRequired || item.data?.classificationReviewRequired) card.append(el('p', { class: 'portal-document-notice', text: 'This earlier record needs a reviewed category assignment before submission or release. Its previous commercial data has been preserved.' }));
      card.append(details(item.data, fields.map(([key, label]) => [key, label])));
      const actions = el('div', { class: 'portal-actions' }); card.append(actions);
      if (['draft', 'clarification_requested'].includes(item.status)) {
        actions.append(button('Edit draft', async () => {
          if (card.querySelector('form[data-editor]')) return;
          const editor = form(card, draftFields, 'Save draft changes', async (data, node) => {
            await api(`/api/${kind}/${encodeURIComponent(item.id)}`, 'PATCH', { data }); node.remove(); await reload();
          }, item.data); editor.dataset.editor = 'true'; editor.scrollIntoView({ block: 'nearest' });
        }, true));
        actions.append(button('Submit for review', async () => { await api(`/api/${kind}/${encodeURIComponent(item.id)}/submit`, 'POST', {}); await reload(); }));
      }
      if (singular !== 'proposal') communications(card, singular, item.id);
    }, 'No records yet. Save your first private draft to begin.');
    form(create, draftFields, 'Save private draft', async (data) => { await api(`/api/${kind}`, 'POST', { data }); await refresh(); });
  }
  function opportunities() {
    const parent = section('Individually released opportunities', 'Only anonymous commercial information explicitly assigned to your company is available. Counterparty identities and introductions remain with ShadowBridge.');
    parent.id = 'workspace-opportunities';
    const approvedFields = [['title', 'Commercial opportunity'], ['categoryId', 'Category'], ['subcategoryId', 'Subcategory'], ['specification', 'Specification'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['price', 'Indicative unit price'], ['currency', 'Currency'], ['incoterms', 'Incoterms'], ['availability', 'Availability'], ['validUntil', 'Valid until']];
    let criteria = { q: '', categoryId: '', subcategoryId: '', sort: 'newest' }, page = 1, loadSequence = 0;
    const countSummary = el('p', { class: 'portal-document-notice', 'aria-live': 'polite' });
    const holder = el('div', { 'aria-live': 'polite' });
    const pagination = el('nav', { class: 'portal-actions', 'aria-label': 'Assigned opportunity pages' });
    const filter = form(parent, [['q', 'Search assigned opportunities', 'search'], ...classificationFields().map(([name, label, type, , options]) => [name, label, type, false, options]), ['sort', 'Sort assigned opportunities', 'select', true, [{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }, { value: 'title', label: 'Commercial title' }]]], 'Filter assigned opportunities', async data => {
      criteria = data; page = 1; await load(); return false;
    }, criteria);
    filter.dataset.preserveValues = 'true';
    parent.append(countSummary, holder, pagination);
    async function load() {
      if (closed) return;
      const currentLoad = ++loadSequence;
      holder.setAttribute('aria-busy', 'true');
      try {
        const query = new URLSearchParams({ page: String(page), limit: '12' });
        for (const [key, value] of Object.entries(criteria)) if (value) query.set(key, value);
        const result = await api(`/api/opportunities?${query}`);
        if (currentLoad !== loadSequence || closed) return;
        if (!Array.isArray(result.items)) throw new Error('Invalid response from the secure opportunity service.');
        memberDashboard?.observe(`/api/opportunities?${query}`, result);
        holder.replaceChildren(); pagination.replaceChildren();
        if (!result.items.length) empty(holder, [criteria.q, criteria.categoryId, criteria.subcategoryId].some(Boolean) ? 'No individually assigned anonymous opportunities match these filters.' : 'No anonymous opportunities have been individually released to your company.');
        for (const item of result.items) {
          const card = recordCard(holder, item, item.data?.title); card.append(details(item.data, approvedFields));
          form(card, [['body', 'Enquiry to ShadowBridge', 'textarea', true]], 'Enquire through ShadowBridge', async data => {
            await api(`/api/opportunities/${encodeURIComponent(item.id)}/enquiries`, 'POST', { body: data.body });
          });
        }
        const total = Number(result.total) || 0, pages = Number(result.pages) || 0;
        const availableCounts = new Map((result.categoryCounts || []).map(item => [item.categoryId, Number(item.count) || 0]));
        const category = filter.querySelector('[name="categoryId"]');
        for (const option of category.options) if (option.value) {
          const label = businessCatalog.categories.find(item => item.id === option.value)?.label || 'Category';
          option.textContent = `${label} (${availableCounts.get(option.value) || 0})`;
        }
        countSummary.textContent = `${total} assigned opportunit${total === 1 ? 'y' : 'ies'} match. Counts include only information authorized for your company.`;
        if (page > 1) pagination.append(button('Previous page', async () => { page--; await load(); }, true));
        pagination.append(el('span', { text: pages ? `Page ${page} of ${pages}` : 'No assigned pages' }));
        if (page < pages) pagination.append(button('Next page', async () => { page++; await load(); }, true));
      } catch (error) { if (currentLoad === loadSequence && !closed) { memberDashboard?.fail('/api/opportunities'); holder.replaceChildren(el('p', { class: 'portal-error', text: error.message })); } }
      finally { if (currentLoad === loadSequence) holder.removeAttribute('aria-busy'); }
    }
    load();
  }
  async function partnerProfile() {
    const parent = section('Your professional profile', 'Update your commercial focus. Company identity and account permissions require management review.');
    try {
      const result = await api('/api/profile');
      const profileForm = form(parent, [['countries', 'Countries and markets', 'text', true], ['sectors', 'Commercial sectors', 'text', true], ['summary', 'Professional summary', 'textarea', true]], 'Save profile', (profile) => api('/api/profile', 'PATCH', { profile: { ...profile, countries: profile.countries.split(',').map((value) => value.trim()).filter(Boolean), sectors: profile.sectors.split(',').map((value) => value.trim()).filter(Boolean) } }), result.profile || {});
      profileForm.dataset.preserveValues = 'true';
    } catch (error) { empty(parent, error.message); }
  }
  function partnerAssignments() {
    const projects = section('Assigned cooperation', 'Only projects explicitly assigned to your account are returned.');
    projects.id = 'workspace-projects';
    listLoader(projects, '/api/projects', (holder, item) => {
      const card = recordCard(holder, item, item.title || item.data?.title);
      card.append(details(item.data || item, [['title', 'Project'], ['scope', 'Assigned scope'], ['summary', 'Assigned cooperation'], ['stage', 'Cooperation stage'], ['status', 'Status'], ['updatedAt', 'Updated']]));
    }, 'No projects have been assigned to your account.');
    const commissions = section('Individually agreed commissions', 'Commission terms are negotiated for each cooperation. No default percentage is assumed.');
    commissions.id = 'workspace-commissions';
    listLoader(commissions, '/api/commissions', (holder, item) => {
      const card = recordCard(holder, item, item.projectId || item.id);
      card.append(details(item.data || item, [['projectId', 'Project reference'], ['basis', 'Agreed basis'], ['rate', 'Agreed rate'], ['amount', 'Agreed amount'], ['currency', 'Currency'], ['agreementReference', 'Agreement reference'], ['status', 'Status']]));
    }, 'No individual commission agreements have been assigned to your account.');
  }
  async function mfaGate() {
    const parent = section('Management security verification', 'Command Center requires an authorized management account and a second authentication factor. No management records are loaded before verification.');
    let factors;
    try { factors = (await api('/api/auth/factors')).factors || []; } catch (error) { empty(parent, error.message); return; }
    function verification(factorId) {
      form(parent, [['code', 'Six-digit authenticator code', 'text', true]], 'Verify second factor', async ({ code }) => {
        await api('/api/auth/mfa/verify', 'POST', { factorId, code }); location.reload(); return false;
      });
    }
    const verified = factors.find((item) => item.status === 'verified' && (!item.factor_type || item.factor_type === 'totp'));
    if (verified) { verification(verified.id); return; }
    parent.append(button('Set up authenticator app', async () => {
      const factor = await api('/api/auth/mfa/enroll', 'POST', {});
      if (!factor.id || !factor.totp?.secret) throw new Error('The authentication service did not return a valid factor.');
      parent.append(el('p', { text: 'Add a time-based one-time password account in your authenticator app using this secret. Do not share it or store it in a screenshot.' }), el('code', { class: 'portal-mfa-secret', text: factor.totp.secret }));
      verification(factor.id);
    }));
  }
  function ownerReconfirmation(parent) {
    if (!managementAccess.owner) return;
    const security = el('div', { class: 'portal-document-notice' }, [el('h3', { text: 'Owner security confirmation' }), el('p', { text: 'Owner role changes, strategic permissions, decision limits and controlled approvals require a real authenticator confirmation within the last five minutes. A rejected request is not saved. Confirm again when the server requests it.' })]);
    parent.append(security);
    security.append(button('Reconfirm MFA', async () => {
      if (security.querySelector('form')) return;
      const factors = (await api('/api/auth/factors')).factors || [];
      const verified = factors.find(item => item.status === 'verified' && (!item.factor_type || item.factor_type === 'totp'));
      if (!verified) throw new Error('No verified authenticator is available. Use the controlled owner recovery procedure; no security bypass is available here.');
      form(security, [['code', 'Six-digit authenticator code', 'text', true]], 'Confirm owner security', async ({ code }) => {
        await api('/api/auth/mfa/verify', 'POST', { factorId: verified.id, code });
        location.reload(); return false;
      });
    }, true));
  }
  async function managementOverview() {
    const parent = section(managementAccess.owner ? 'Owner Overview' : 'Command Center Overview', 'A concise view of the work you are authorized to supervise. Open a module to view its confidential records.');
    const overview = await api('/api/staff/overview');
    if (closed) return;
    if (managementAccess.owner && window.ShadowOwnerVault) await window.ShadowOwnerVault.overview({ host: parent, api, access: managementAccess });
    if (managementAccess.owner && window.ShadowOwnerBook) await window.ShadowOwnerBook.overview({ host: parent, api, access: managementAccess });
    if (closed) return;
    if (window.ShadowCommandDashboard) {
      const activity = section('Recent activity', 'Recent authorized actions recorded by the server.');
      window.ShadowCommandDashboard.render({ host: parent, activityHost: activity, overview, access: managementAccess });
      return;
    }
    const metrics = [
      ['pendingApplications', 'Company applications awaiting review', 'applications'],
      ['submittedOffers', 'New supplier offers', 'offers'],
      ['submittedRfqs', 'New buyer requests', 'rfqs'],
      ['activeProjects', 'Active cooperation projects', 'projects'],
      ['pendingProposals', 'Partner opportunities awaiting review', 'proposals'],
      ['openContactEnquiries', 'Contact enquiries awaiting attention', 'contact'],
      ['pendingRiskApprovals', 'Controlled decisions awaiting approval', 'approvals'],
    ];
    const grid = el('div', { class: 'portal-grid', 'aria-label': 'Operational summary' }); parent.append(grid);
    for (const [key, label, module] of metrics) {
      const value = overview.counts?.[key];
      if (value === undefined || value === null) continue;
      const card = recordCard(grid, {}, label);
      card.querySelector('small')?.remove();
      card.append(el('p', { class: 'portal-metric', text: value }));
      const permission = { applications: 'applications.read', offers: 'offers.read', rfqs: 'rfqs.read', projects: 'projects.read', proposals: 'proposals.read', contact: 'contact.read', approvals: 'risk_approvals.read' }[module];
      if ((module === 'approvals' && (managementAccess.owner || canManage('commissions.create'))) || (module !== 'approvals' && canManage(permission))) card.append(el('a', { class: 'access-entry-link', href: module === 'offers' ? '/portal/offers/' : `/portal/admin/?module=${module === 'approvals' ? 'risk' : module}`, text: 'Open module' }));
    }
    if (!grid.children.length) empty(parent, 'No operational counters are available for your assigned permissions.');
    parent.append(el('p', { class: 'portal-document-notice', text: 'Transaction settlement and task management are not active modules. Project counts refer to cooperation projects, not completed transactions.' }));
    if (Array.isArray(overview.warnings)) for (const warning of overview.warnings) parent.append(el('p', { class: 'portal-error', text: warning }));
    const activity = section('Recent activity', 'Recent authorized actions recorded by the server.');
    if (!Array.isArray(overview.recentActivity) || !overview.recentActivity.length) empty(activity, 'No recent activity is available for your assigned permissions.');
    for (const item of overview.recentActivity || []) {
      const card = recordCard(activity, {}, item.action || 'Recorded action'); card.querySelector('small')?.remove();
      card.append(details(item, [['createdAt', 'Time'], ['resourceType', 'Module']]));
    }
  }
  async function managementTeam() {
    const parent = section('Team and access', 'Assign permissions only to verified existing accounts. Creating or changing a grant does not send an invitation email. Owner and strategic permissions remain under owner control.');
    ownerReconfirmation(parent);
    const holder = el('div', { 'aria-live': 'polite' }); parent.append(holder);
    async function refresh() {
      const result = await api('/api/staff/team');
      if (closed) return;
      if (!Array.isArray(result.items)) throw new Error('Invalid team response from the secure service.');
      holder.replaceChildren();
      if (!result.items.length) empty(holder, 'No team grants are currently recorded.');
      for (const item of result.items) {
        const card = recordCard(holder, { id: item.userId, status: item.active === false ? 'inactive' : '' }, item.email || item.userId);
        card.append(details(item, [['userId', 'Verified account ID'], ['status', 'Account status'], ['roles', 'Active roles'], ['assignments', 'Role grants and expiry'], ['permissions', 'Permission overrides'], ['limits', 'Decision limits']]));
        if (canManage('accounts.suspend') && (managementAccess.owner || !item.roles?.some(role => ['owner', 'general_director'].includes(role)))) form(card, [['status', 'Account status', 'select', true, ['active', 'suspended']]], 'Save team account status', async data => {
          await api(`/api/admin/accounts/${encodeURIComponent(item.userId)}/status`, 'POST', data); await refresh();
        }, { status: item.status });
      }
      return result;
    }
    const team = await refresh();
    if (closed) return;
    if (!canManage('staff.manage')) return;
    const userOptions = (team.eligibleUsers || []).map(item => ({ value: item.userId, label: item.email || item.userId }));
    if (!userOptions.length) { empty(parent, 'No verified eligible accounts are available for a new management grant.'); return; }
    const userField = ['userId', 'Verified existing account', 'select', true, userOptions];
    const roleOptions = (managementAccess.roleCatalog || []).filter(item => !item.ownerOnly || managementAccess.owner).map(item => ({ value: item.key, label: item.label || item.key }));
    const permissionOptions = (managementAccess.permissionCatalog || []).filter(item => !['security.manage', 'strategic.manage'].includes(item.key) && (!item.ownerControlled || managementAccess.owner)).map(item => ({ value: item.key, label: item.label || item.key }));
    if (roleOptions.length) form(parent, [userField, ['role', 'Management role', 'select', true, roleOptions], ['active', 'Enable this role grant', 'checkbox'], ['expiresAt', 'Optional expiry — your local time', 'datetime-local']], 'Save role grant', async data => {
      const payload = { userId: data.userId, role: data.role, active: data.active };
      if (data.expiresAt) { const expiry = new Date(data.expiresAt); if (!Number.isFinite(expiry.getTime())) throw new Error('Select a valid expiry date.'); payload.expiresAt = expiry.toISOString(); }
      await api('/api/staff/roles', 'POST', payload); await refresh();
    });
    if (permissionOptions.length) form(parent, [userField, ['permission', 'Individual permission', 'select', true, permissionOptions], ['effect', 'Permission decision', 'select', true, [{ value: 'allow', label: 'Allow this permission' }, { value: 'deny', label: 'Deny this permission' }, { value: 'remove', label: 'Inherit permissions from roles' }]]], 'Save permission override', async data => { await api('/api/staff/permissions', 'POST', data); await refresh(); });
    if (managementAccess.owner) form(parent, [userField, ['amount', 'Maximum financial decision amount', 'number', true], ['currency', 'Currency of the limit', 'select', true, currencyOptions]], 'Save decision limit', async data => { await api('/api/staff/limits', 'POST', data); await refresh(); });
    parent.append(el('p', { class: 'portal-document-notice', text: 'A financial limit does not grant permission to reveal identities, settle transactions or change security controls. Separate backend authorization is required for every action.' }));
  }
  function managementRisk() {
    const parent = section('Controlled financial approvals', 'Requests above a delegated financial limit require a separate owner decision. A request cannot approve itself and approval applies only to the exact recorded terms. No payment or transaction is executed here.');
    ownerReconfirmation(parent);
    const refresh = listLoader(parent, '/api/staff/risk-approvals', (holder, item, reload) => {
      const card = recordCard(holder, item, `${item.action || 'Financial decision'} · ${item.amount} ${item.currency}`);
      card.append(details(item, [['id', 'Approval reference'], ['requestedBy', 'Requesting account'], ['status', 'Status'], ['createdAt', 'Requested'], ['expiresAt', 'Expires']]));
      if (managementAccess.owner && item.status === 'pending' && item.requestedBy !== session.id) form(card, [['decision', 'Owner decision', 'select', true, ['approved', 'rejected']]], 'Record controlled decision', async data => { await api(`/api/staff/risk-approvals/${encodeURIComponent(item.id)}/decision`, 'POST', data); await reload(); });
      else if (managementAccess.owner && item.status === 'pending') empty(card, 'You cannot approve a request that you created.');
    }, 'No controlled financial decisions are awaiting review.');
    if (canManage('commissions.create')) form(parent, [['projectId', 'Assigned ShadowBridge project ID', 'text', true], ['amount', 'Requested commission amount', 'number', true], ['currency', 'Currency', 'select', true, currencyOptions], ['agreementReference', 'Non-identifying agreement reference', 'text', true], ['reviewed', 'I have checked these agreed terms and removed counterparty-identifying information from the reference.', 'checkbox', true]], 'Request controlled approval', async ({ reviewed, ...data }) => {
      await api('/api/staff/risk-approvals', 'POST', { ...data, action: 'commissions.create', status: 'agreed' }); await refresh();
    });
  }
  async function managementCategories() {
    const parent = section('Commercial classification', 'Shared controlled categories for supplier offers, buyer requests and individually released anonymous opportunities. Deactivation preserves existing record identifiers. It does not publish any offer.');
    const holder = el('div', { 'aria-live': 'polite' }); parent.append(holder);
    let createForm;
    async function refresh() {
      const result = await api('/api/staff/categories');
      holder.replaceChildren();
      for (const item of result.categories || []) {
        const card = recordCard(holder, { id: item.key, status: item.active ? 'active' : 'inactive' }, item.label);
        card.append(details({ parent: item.parentId ? result.categories.find(category => category.id === item.parentId)?.label || 'Unavailable parent' : 'Top-level category', position: item.position }, [['parent', 'Classification level'], ['position', 'Sort position']]));
        if (canManage('taxonomy.edit')) form(card, [['label', 'Category name', 'text', true], ['position', 'Sort position', 'number', true], ['active', 'Available for new records', 'checkbox']], 'Save category changes', async data => {
          await api(`/api/staff/categories/${encodeURIComponent(item.id)}`, 'POST', { ...data, position: Number(data.position) });
          businessCatalog = await api('/api/catalog'); await refresh();
        }, item);
      }
      if (!holder.children.length) empty(holder, 'No controlled categories are available.');
      const parentSelect = createForm?.querySelector('[name="parentId"]');
      if (parentSelect) {
        const selected = parentSelect.value;
        parentSelect.replaceChildren(el('option', { value: '', text: 'Top-level category' }));
        for (const item of result.categories.filter(item => !item.parentId && item.active)) parentSelect.append(el('option', { value: item.id, text: item.label }));
        parentSelect.value = [...parentSelect.options].some(option => option.value === selected) ? selected : '';
      }
      return result;
    }
    const result = await refresh();
    if (canManage('taxonomy.create')) createForm = form(parent, [['key', 'Stable classification key', 'text', true], ['label', 'Category name', 'text', true], ['parentId', 'Parent category — leave empty for top-level', 'select', false, (result.categories || []).filter(item => !item.parentId && item.active).map(item => ({ value: item.id, label: item.label }))], ['position', 'Sort position', 'number', true], ['active', 'Available for new records', 'checkbox']], 'Create controlled category', async data => {
      await api('/api/staff/categories', 'POST', { ...data, parentId: data.parentId || null, position: Number(data.position) });
      businessCatalog = await api('/api/catalog'); await refresh();
    }, { position: 0, active: true });
  }
  const accountStageLabels = Object.freeze({
    email_pending: 'Email confirmation pending', application_missing: 'Application not submitted',
    pending_review: 'Application awaiting approval', approved: 'Application approved',
    rejected: 'Application rejected', suspended: 'Account suspended',
  });
  function recordedDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Not recorded';
  }
  function managementPages({ parent, path, type, filterFields, render, emptyMessage, afterLoad }) {
    let criteria = {}, page = 1, loadSequence = 0;
    const summary = el('p', { class: 'portal-document-notice', 'aria-live': 'polite', 'data-recruitment-count': type });
    const holder = el('div', { class: 'recruitment-records', 'aria-live': 'polite' });
    const pagination = el('nav', { class: 'portal-actions recruitment-pagination', 'aria-label': type === 'account' ? 'Accounts pages' : 'Application pages' });
    const filter = form(parent, filterFields, type === 'account' ? 'Filter accounts' : 'Filter applications', async data => {
      criteria = data; page = 1; await load(); return false;
    });
    filter.dataset.preserveValues = 'true';
    filter.setAttribute('aria-label', type === 'account' ? 'Account filters' : 'Application filters');
    filter.querySelector(type === 'account' ? '[name="stage"] option[value=""]' : '[name="status"] option[value=""]').textContent = type === 'account' ? 'All account stages' : 'All application statuses';
    parent.append(summary, holder, pagination);
    async function load() {
      if (closed) return;
      const sequence = ++loadSequence;
      holder.setAttribute('aria-busy', 'true');
      pagination.replaceChildren();
      try {
        const query = new URLSearchParams({ page: String(page), limit: '12' });
        for (const [key, value] of Object.entries(criteria)) if (value) query.set(key, value);
        const result = await api(`${path}?${query}`);
        if (sequence !== loadSequence || closed) return;
        if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0
          || !Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 24 || result.items.length > result.limit
          || !Number.isSafeInteger(result.page) || result.page < 1 || !Number.isSafeInteger(result.pages) || result.pages < 0) throw new Error('Invalid response from the secure recruitment service.');
        page = result.page;
        holder.replaceChildren();
        if (!result.items.length) empty(holder, emptyMessage);
        for (const item of result.items) render(holder, item, load);
        const noun = type === 'account' ? 'account' : 'application';
        summary.textContent = `${result.total} ${noun}${result.total === 1 ? '' : 's'} match the current filters. Only this page has been loaded.`;
        if (page > 1) pagination.append(button('Previous page', async () => { page--; await load(); }, true));
        pagination.append(el('span', { text: result.pages ? `Page ${page} of ${result.pages}` : 'No matching pages' }));
        if (page < result.pages) pagination.append(button('Next page', async () => { page++; await load(); }, true));
        afterLoad?.(result);
      } catch (error) {
        if (sequence === loadSequence && !closed) {
          holder.replaceChildren(el('p', { class: 'portal-error', text: error.message }));
          summary.textContent = 'Recruitment records could not be loaded.';
          pagination.replaceChildren();
          afterLoad?.(null);
        }
      } finally { if (sequence === loadSequence) holder.removeAttribute('aria-busy'); }
    }
    load();
    return load;
  }
  function managementAccounts() {
    const parent = section('Accounts', 'Registration, email confirmation and application approval are separate stages. An active account or an approved application does not establish independent company verification. No access is granted by this list.');
    const stages = el('section', { class: 'recruitment-stage-summary', 'aria-labelledby': 'account-stages-title' }, [el('h3', { id: 'account-stages-title', text: 'Matching accounts by stage' }), el('p', { text: 'Counts follow your search across all stages, independently of the selected stage filter.' })]);
    const counts = el('dl', { class: 'recruitment-stages' }); stages.append(counts); parent.append(stages);
    managementPages({ parent, path: '/api/admin/accounts', type: 'account',
      filterFields: [['q', 'Search accounts', 'search'], ['stage', 'Account stage', 'select', false, Object.entries(accountStageLabels).map(([value, label]) => ({ value, label }))]],
      emptyMessage: 'No accounts match these filters. Unconfirmed registrations appear here, while Applications contains confirmed submissions.',
      afterLoad: result => {
        counts.replaceChildren();
        if (!result?.counts) { counts.append(el('div', { class: 'recruitment-stage-card' }, [el('dt', { text: 'Stage counts unavailable' }), el('dd', { text: '—' })])); return; }
        for (const [key, label] of Object.entries(accountStageLabels)) {
          const value = result.counts[key];
          counts.append(el('div', { class: 'recruitment-stage-card' }, [el('dt', { text: label }), el('dd', { text: Number.isSafeInteger(value) && value >= 0 ? value : '—' })]));
        }
      },
      render: (holder, item) => {
        const card = recordCard(holder, { id: item.userId, status: accountStageLabels[item.stage] || 'Review required' }, item.email);
        card.dataset.recruitmentRecord = 'account';
        card.append(details({ ...item, emailState: item.emailVerified === true ? 'Confirmed' : 'Not confirmed', applicationState: item.applicationStatus || 'Not submitted', companyName: item.companyName || (item.applicationId ? 'Company details unavailable with current permissions' : 'No submitted company application'), registeredAt: recordedDate(item.createdAt), confirmedAt: recordedDate(item.emailVerifiedAt), decisionAt: recordedDate(item.reviewedAt) }, [['userId', 'Internal account ID'], ['status', 'Account access status'], ['emailState', 'Email confirmation'], ['confirmedAt', 'Email confirmed'], ['registeredAt', 'Registered'], ['applicationState', 'Application status'], ['role', 'Requested role'], ['companyName', 'Submitted company'], ['decisionAt', 'Application reviewed'], ['decisionReason', 'Latest decision reason']]));
        if (canManage('applications.read')) card.append(el('a', { class: 'dashboard-inline-link', href: '/portal/admin/?module=applications', text: 'Open Applications' }));
      },
    });
  }
  function applicationDecisionHistory(card, applicationId) {
    const host = el('section', { class: 'recruitment-history', hidden: true, 'aria-label': 'Application decision history' });
    let page = 1, sequence = 0;
    const records = el('ol', { class: 'recruitment-history-records', 'aria-live': 'polite' });
    const pages = el('nav', { class: 'portal-actions recruitment-pagination', 'aria-label': 'Application decision history pages' });
    host.append(el('h4', { text: 'Recorded decision history' }), el('p', { class: 'portal-document-notice', text: 'History is loaded in pages. An imported legacy snapshot records only the latest decision available before history tracking was introduced.' }), records, pages);
    async function load() {
      if (closed) return;
      const current = ++sequence;
      host.hidden = false; records.setAttribute('aria-busy', 'true'); pages.replaceChildren();
      try {
        const result = await api(`/api/admin/applications/${encodeURIComponent(applicationId)}/history?page=${page}&limit=12`);
        if (current !== sequence || closed) return;
        if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) || result.page < 1
          || !Number.isSafeInteger(result.pages) || result.pages < 0 || !Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 24 || result.items.length > result.limit) throw new Error('Invalid response from the secure decision history service.');
        page = result.page;
        records.replaceChildren();
        if (!result.items.length) records.append(el('li', { text: 'No recorded decisions are available for this application.' }));
        for (const item of result.items) records.append(el('li', {}, [
          el('strong', { text: `${item.decision || 'Decision'} · ${recordedDate(item.createdAt)}` }),
          el('p', { text: item.reason || 'No reason was recorded in the legacy snapshot.' }),
          el('small', { text: `${item.source === 'legacy_snapshot' ? 'Imported latest decision — earlier history unavailable' : 'Recorded decision'} · Reviewing account: ${item.actorId || 'Not recorded'}` }),
        ]));
        if (page > 1) pages.append(button('Previous history page', async () => { page--; await load(); }, true));
        pages.append(el('span', { text: result.pages ? `Page ${page} of ${result.pages}` : 'No recorded pages' }));
        if (page < result.pages) pages.append(button('Next history page', async () => { page++; await load(); }, true));
      } catch (error) { if (current === sequence && !closed) records.replaceChildren(el('li', { class: 'portal-error', text: error.message })); }
      finally { if (current === sequence) records.removeAttribute('aria-busy'); }
    }
    card.append(button('Load decision history', load, true), host);
  }
  function managementApplications() {
    const parent = section('Company applications', 'Only email-confirmed submissions enter this queue. Review countries, sectors and the full business scope before making a decision. Application approval and independent company verification remain separate. Rejected applications are retained in the review history.');
    managementPages({ parent, path: '/api/admin/applications', type: 'application',
      filterFields: [['q', 'Search applications', 'search'], ['status', 'Application status', 'select', false, [{ value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved applications' }, { value: 'rejected', label: 'Rejected applications — history' }]]],
      emptyMessage: 'No confirmed company applications match these filters. Unconfirmed accounts are listed separately in Accounts.',
      render: (holder, item, refresh) => {
        const card = recordCard(holder, item, item.company?.name || item.companyName || item.id);
        card.dataset.recruitmentRecord = 'application';
        card.append(details({ ...item, confirmed: item.emailVerified === true ? 'Confirmed' : 'Not confirmed', received: recordedDate(item.createdAt), reviewed: recordedDate(item.reviewedAt) }, [['userId', 'Internal account ID'], ['email', 'Applicant email'], ['confirmed', 'Email confirmation'], ['companyId', 'Internal company ID'], ['role', 'Requested role'], ['accountStatus', 'Account access status'], ['status', 'Application status'], ['received', 'Received'], ['reviewed', 'Last reviewed'], ['reviewedBy', 'Reviewing account'], ['decisionReason', 'Latest decision reason']]));
        card.append(details(item.company, [['name', 'Submitted company name'], ['country', 'Country of registration'], ['registrationNumber', 'Submitted registration number']]));
        const profile = item.profile || {};
        card.append(details({ countries: Array.isArray(profile.countries) && profile.countries.length ? profile.countries.join(', ') : 'Not provided', sectors: Array.isArray(profile.sectors) && profile.sectors.length ? profile.sectors.join(', ') : 'Not provided', summary: typeof profile.summary === 'string' && profile.summary ? profile.summary : 'Not provided' }, [['countries', 'Countries and markets'], ['sectors', 'Commercial sectors'], ['summary', 'Full business scope']]));
        const decisions = ['approved', 'rejected'].filter(value => canManage(`applications.${value === 'approved' ? 'approve' : 'reject'}`));
        applicationDecisionHistory(card, item.id);
        if (decisions.length && item.status === 'pending') form(card, [['decision', 'Review decision', 'select', true, decisions], ['reason', 'Decision reason', 'textarea', true]], 'Record application decision', async data => {
          await api(`/api/admin/applications/${encodeURIComponent(item.id)}/decision`, 'POST', data); await refresh();
        });
        if (item.userId && canManage('accounts.suspend')) form(card, [['status', 'Account status', 'select', true, ['suspended', 'active']]], 'Change account status', async data => {
          await api(`/api/admin/accounts/${encodeURIComponent(item.userId)}/status`, 'POST', data); await refresh();
        });
      },
    });
  }
  async function adminWorkspace() {
    managementAccess = await api('/api/staff/access');
    if (closed) return;
    const modules = window.ShadowDashboard?.managementModules;
    if (!modules) throw new Error('The shared Command Center navigation is unavailable. Reload the page before continuing.');
    const selected = new URLSearchParams(location.search).get('module') || 'overview';
    const moduleNav = window.ShadowDashboard.managementNavigation({ access: managementAccess, selected }); root.append(moduleNav);
    window.ShadowDashboard?.placeModules(moduleNav);
    if (selected === 'book') {
      if (!managementAccess.owner || !window.ShadowOwnerBook) { status('Module unavailable.', 'Command Book requires the active OWNER role and MFA.', true); return; }
      window.ShadowOwnerBook.mount({ host: root, api, access: managementAccess, form, ownerReconfirmation }); return;
    }
    if (selected === 'vault') {
      if (!managementAccess.owner || !window.ShadowOwnerVault) { status('Module unavailable.', 'OWNER VAULT requires the active OWNER role and MFA.', true); return; }
      window.ShadowOwnerVault.mount({ host: root, api, access: managementAccess, form, ownerReconfirmation }); return;
    }
    const available = modules.find(([key]) => key === selected);
    if (!available || !canManage(available[2])) { status('Module unavailable.', 'Your assigned management permissions do not allow access to this module.', true); return; }
    if (selected === 'overview') { await managementOverview(); return; }
    if (selected === 'team') { await managementTeam(); return; }
    if (selected === 'risk') { managementRisk(); return; }
    if (selected === 'categories') { await managementCategories(); return; }
    if (selected === 'accounts') { managementAccounts(); return; }
    if (selected === 'applications') { managementApplications(); return; }
    if (selected === 'contact') {
    const contactQueue = section('Contact enquiry queue', 'Confidential public enquiries for authorized management only. These records do not create member accounts or publish offers. Changing a status records your review; it does not send an email.');
    listLoader(contactQueue, '/api/admin/contact-queue', (holder, item, refresh) => {
      const card = recordCard(holder, item, item.id);
      card.append(details(item, [
        ['name', 'Contact name'], ['email', 'Reply email'], ['company', 'Company'],
        ['role', 'Enquiry role'], ['message', 'Enquiry message'], ['createdAt', 'Received'],
        ['reviewedAt', 'Last reviewed'],
      ]));
      if (canManage('contact.edit')) form(card, [['status', 'Review status — no email is sent', 'select', true, ['new', 'in_review', 'replied', 'closed']]], 'Record enquiry status', async (data) => {
        await api(`/api/admin/contact-queue/${encodeURIComponent(item.id)}/status`, 'POST', data);
        await refresh();
      }, { status: item.status });
    }, 'No contact enquiries have been received.');
    }
    if (selected === 'companies') {
    const companies = section('Internal companies', 'Company identifiers and mappings are available only to authorized management. Never include these identifiers in released commercial summaries.');
    listLoader(companies, '/api/admin/companies', (holder, item) => {
      const card = recordCard(holder, item, item.name);
      card.append(details(item, [['id', 'Internal company ID'], ['name', 'Registered name'], ['registrationNumber', 'Registration number'], ['country', 'Country'], ['status', 'Status']]));
      if (canManage('memberships.edit')) form(card, [['userId', 'Verified existing member account ID', 'text', true], ['role', 'Company role', 'select', true, ['buyer', 'supplier', 'partner']], ['status', 'Membership decision', 'select', true, ['approved', 'revoked']]], 'Save company membership', data => api('/api/staff/company-members', 'POST', { companyId: item.id, ...data }));
    }, 'No registered companies.');
    }
    for (const [kind, title, fields, decisions] of [
      ['offers', 'Supplier offer review', offerFields, ['approved', 'rejected', 'clarification_requested']],
      ['rfqs', 'Buyer request review', rfqFields, ['in_review', 'clarification_requested', 'accepted', 'closed']],
      ['proposals', 'Partner opportunity review', proposalFields, ['in_review', 'accepted', 'declined']],
    ]) {
      if (selected !== kind) continue;
      const parent = section(title, 'Source records remain confidential. Approval of a source offer does not automatically release it to any buyer.');
      listLoader(parent, `/api/admin/${kind}`, (holder, item, refresh) => {
        const card = recordCard(holder, item, item.data?.productName || item.data?.product || item.data?.title);
        card.append(details(item, [['companyId', 'Internal owner company ID'], ['companyName', 'Owner company'], ['userId', 'Internal owner account ID']]));
        card.append(details(item.data, fields.map(([key, label]) => [key, label])));
        const availableDecisions = decisions.filter(value => canManage(`${kind}.${['approved', 'accepted'].includes(value) ? 'approve' : ['rejected', 'declined'].includes(value) ? 'reject' : 'edit'}`));
        if (availableDecisions.length) form(card, [['decision', 'Review decision', 'select', true, availableDecisions], ['reason', 'Review notes / reason', 'textarea', true]], 'Record review decision', async (data) => {
          await api(`/api/admin/${kind}/${encodeURIComponent(item.id)}/decision`, 'POST', data); await refresh();
        });
        if (canManage('messages.read')) communications(card, kind === 'offers' ? 'offer' : kind === 'proposals' ? 'proposal' : 'rfq', item.id);
      }, 'No source records to review.');
    }
    if (selected === 'opportunities') {
    if (canManage('opportunities.create')) {
    const released = section('Prepare an anonymous commercial opportunity', 'Manually prepare a separate, non-identifying summary from an approved source offer. Remove company names, addresses, contacts, websites, product codes identifying a supplier, document metadata and CRM IDs. This is a controlled review, not automatic anonymization.');
    form(released, [['sourceOfferId', 'Approved ShadowBridge source offer ID', 'text', true], ['title', 'Anonymous commercial title', 'text', true], ...classificationFields(), ['specification', 'Reviewed non-identifying specification', 'textarea', true], ['quantity', 'Quantity', 'number', true], ['unit', 'Unit', 'text', true], ['price', 'Price', 'number', true], ['currency', 'Currency', 'select', true, currencyOptions], ['incoterms', 'Incoterms', 'text', true], ['availability', 'Availability', 'text', true], ['validUntil', 'Valid until', 'date', true], ['reviewedNonIdentifying', 'I have reviewed the complete summary and confirm it contains no confidential or identifying counterparty information.', 'checkbox', true]], 'Create restricted anonymous opportunity', async (data) => {
      const { sourceOfferId, reviewedNonIdentifying, ...commercial } = data;
      await api('/api/admin/opportunities', 'POST', { sourceOfferId, commercial, reviewedNonIdentifying }); await refreshOpportunities();
    });
    }
    const assignments = section('Individual opportunity release', 'Release each anonymous opportunity only to a specifically approved company and role. No unrestricted catalogue is created.');
    const refreshOpportunities = listLoader(assignments, '/api/admin/opportunities', (holder, item) => {
      const card = recordCard(holder, item, item.data?.title || item.commercial?.title);
      card.append(details(item.data || item.commercial, [['title', 'Released title'], ['categoryId', 'Category'], ['subcategoryId', 'Subcategory'], ['specification', 'Reviewed specification']]));
      if (canManage('opportunities.share')) form(card, [['recipientCompanyId', 'Approved recipient company ID (internal)', 'text', true], ['role', 'Recipient role', 'select', true, ['buyer', 'partner']]], 'Assign anonymous opportunity', (data) => api(`/api/admin/opportunities/${encodeURIComponent(item.id)}/assign`, 'POST', data));
    }, 'No anonymous opportunities have been prepared.');
    }
    if (selected === 'projects') {
    const projectList = section('Cooperation projects', 'Actual assigned cooperation projects. This list does not represent settled transactions.');
    listLoader(projectList, '/api/admin/projects', (holder, item) => {
      const card = recordCard(holder, item, item.title || item.data?.title);
      card.append(details(item, [['companyId', 'Assigned partner company ID'], ['partnerCompanyId', 'Assigned partner company ID'], ['title', 'Title'], ['summary', 'Partner-visible scope'], ['status', 'Status'], ['createdAt', 'Created']]));
      if (item.data) card.append(details(item.data, [['title', 'Title'], ['summary', 'Partner-visible scope'], ['status', 'Status']]));
    }, 'No cooperation projects have been assigned.');
    if (canManage('projects.create')) {
    const projectAssignment = section('Assign partner cooperation', 'Create a precisely scoped project for an approved partner. No counterparty names, contacts or identifying details may appear in the partner-visible title or summary.');
    form(projectAssignment, [['partnerCompanyId', 'Approved partner company ID (internal)', 'text', true], ['title', 'Project title visible to the partner', 'text', true], ['summary', 'Approved partner-visible cooperation summary', 'textarea', true], ['reviewedNonIdentifying', 'I have reviewed the partner-visible title and summary and confirm they contain no counterparty names, contacts or identifying details.', 'checkbox', true]], 'Assign partner project', async (data) => {
      const result = await api('/api/admin/projects', 'POST', data);
      status('Partner project assigned.', `Project reference: ${result.item?.id || 'recorded by the server'}. Only the assigned partner can access the released project.`);
    });
    }
    }
    if (selected === 'commissions') {
    const commissionList = section('Agreed commissions', 'Individually agreed commercial terms recorded for assigned cooperation. Recording a commission does not execute a payment.');
    listLoader(commissionList, '/api/admin/commissions', (holder, item) => {
      const card = recordCard(holder, item, item.projectId || item.id);
      card.append(details(item, [['projectId', 'Project'], ['partnerCompanyId', 'Partner company ID'], ['amount', 'Amount'], ['currency', 'Currency'], ['agreementReference', 'Agreement reference'], ['status', 'Status']]));
      if (item.data) card.append(details(item.data, [['amount', 'Amount'], ['currency', 'Currency'], ['agreementReference', 'Agreement reference'], ['status', 'Status']]));
    }, 'No agreed commissions have been recorded.');
    if (canManage('commissions.create')) {
    const agreedCommission = section('Record an agreed partner commission', 'Enter actual agreed commercial terms only. The partner-visible agreement reference must be a non-identifying reference code of 3–80 characters using uppercase letters, numbers and hyphens. Do not use a contract filename, customer name or contact details.');
    agreedCommission.append(el('p', { text: 'Your effective financial limit is enforced by the server. For terms above that limit, request a controlled approval first, then enter its approved reference below.' }));
    form(agreedCommission, [['projectId', 'Assigned ShadowBridge project ID', 'text', true], ['amount', 'Agreed commission amount', 'number', true], ['currency', 'Currency', 'select', true, currencyOptions], ['agreementReference', 'Non-identifying agreement reference code', 'text', true], ['approvalId', 'Controlled approval reference — if required', 'text'], ['reviewedNonIdentifying', 'I have reviewed this reference code and confirm it contains no counterparty names, contacts or identifying details.', 'checkbox', true], ['agreementConfirmed', 'I confirm these are actual individually agreed terms supported by the stated agreement.', 'checkbox', true]], 'Record agreed commission', ({ approvalId, ...data }) => api('/api/admin/commissions', 'POST', { ...data, ...(approvalId ? { approvalId } : {}) }));
    }
    }
    if (selected === 'audit') {
    const audit = section('Activity log', 'Security and management decisions are recorded by the server. No editing or deletion of activity logs is available here.');
    listLoader(audit, '/api/admin/audit', (holder, item) => {
      const card = recordCard(holder, item, item.action || item.event);
      card.append(details(item, [['createdAt', 'Time'], ['actorId', 'Internal actor'], ['action', 'Action'], ['resourceType', 'Resource type'], ['resource', 'Resource'], ['resourceId', 'Resource reference'], ['details', 'Audit details'], ['metadata', 'Event metadata']]));
    }, 'No logged activity.');
    }
  }
  async function start() {
    window.ShadowDashboard?.mountShell({ navigation: nav, role });
    const config = await api('/api/config');
    if (config.backendEnabled !== true || !config.csrfToken) return;
    csrfToken = config.csrfToken;
    const result = await api('/api/session'); csrfToken = result.csrfToken || csrfToken;
    session = result.user;
    if (!session) {
      status('Sign in required.', 'Private records are available only through an authorized server session.');
      root.append(el('p', {}, [el('a', { class: 'access-entry-link', href: '/member-sign-in/', text: 'Member Sign In' })])); return;
    }
    const account = document.querySelector('#portal-account'); account.className = 'portal-account';
    account.append(el('span', { class: 'portal-environment', text: config.environment === 'local' ? 'Local development — not production' : 'Secure member service' }), el('p', { text: session.email }), button('Sign out', async () => { await api('/api/auth/logout', 'POST', {}); announceSessionChange(); sessionChanged(); location.assign('/member-sign-in/'); }, true));
    if (!session.emailVerified) { status('Verify your email.', 'Confirm your business email before accessing any private workspace. No private business records have been loaded.'); return; }
    if (!session.staff && session.applicationStatus !== 'approved') {
      const labels = { pending: 'Application under review.', rejected: 'Application not approved.', suspended: 'Account suspended.' };
      status(labels[session.applicationStatus] || 'Approval required.', 'Your current account status does not permit access to private commercial records. ShadowBridge reviews each company individually.');
      if (session.applicationStatus === 'not_submitted') {
        const { draft } = await api('/api/application/draft');
        if (closed) return;
        if (!draft || !['missing', 'review_required', 'ready', 'submitted', 'blocked'].includes(draft.state)) throw new Error('The saved application could not be verified. No replacement application was submitted.');
        if (draft.state === 'submitted') {
          const ready = section('Application received', 'Your original application has been restored. Refresh to view its current review status.');
          ready.append(button('Refresh application status', () => location.reload()));
          return;
        }
        if (draft.state === 'blocked') return;
        if (draft.state === 'review_required' || draft.state === 'ready') {
          const recovery = section('Resume your original application', 'Review the saved role and company details. Resuming uses these original details and still requires individual management approval. It does not grant private access.');
          const choices = draft.state === 'ready' ? [draft] : draft.choices;
          if (!Array.isArray(choices) || !choices.length) { empty(recovery, 'Contact ShadowBridge for review of the original application. No role or company has been guessed.'); return; }
          for (const saved of choices) {
            const card = el('article', { class: 'portal-record' }); recovery.append(card);
            card.append(el('h3', { text: `${saved.role === 'partner' ? 'B2B Partner' : saved.role} — ${saved.company?.legal_name || 'Saved company application'}` }));
            card.append(details(saved.company, [['country', 'Registration country'], ['registration_number', 'Registration number']]));
            card.append(details(saved.professional, [['countries', 'Markets/countries'], ['sectors', 'Sectors'], ['summary', 'Business scope']]));
            if (saved.expired) card.append(el('p', { text: 'This older application needs your explicit confirmation before it can be resumed.' }));
            form(card, [['acknowledgement', 'I have reviewed this original role and company application and want to submit it for review.', 'checkbox', true]], 'Resume this application', async () => {
              await api('/api/application/resume', 'POST', { ...(saved.id ? { draftId: saved.id } : {}), acknowledged: true });
              location.reload(); return false;
            });
          }
          return;
        }
        const application = section('Complete your company application', 'No original application can be recovered for this verified account. Explicitly choose your business role and submit your company details for individual review. This does not verify your company or grant private access.');
        form(application, [['role', 'Business role', 'select', true, ['buyer', 'supplier', 'partner']], ['companyName', 'Registered company name', 'text', true], ['country', 'Country of registration', 'text', true], ['registrationNumber', 'Company registration number', 'text', true], ['countries', 'Markets or countries (comma separated)', 'text'], ['sectors', 'Commercial sectors (comma separated)', 'text'], ['summary', 'General business scope — no counterparty identities', 'textarea'], ['acknowledgement', 'I understand that email verification and manual company approval are required and that introductions are coordinated by ShadowBridge.', 'checkbox', true]], 'Submit company application', async (data) => {
          const company = { name: data.companyName, country: data.country, registrationNumber: data.registrationNumber };
          const profile = { countries: data.countries.split(',').map((value) => value.trim()).filter(Boolean), sectors: data.sectors.split(',').map((value) => value.trim()).filter(Boolean), summary: data.summary };
          await api('/api/application', 'POST', { role: data.role, company, profile }); location.reload(); return false;
        });
      }
      return;
    }
    const roles = Array.isArray(session.roles) ? session.roles : [];
    businessCatalog = await api('/api/catalog');
    if (!Array.isArray(businessCatalog.categories) || !Array.isArray(businessCatalog.currencies) || !businessCatalog.categories.length || !businessCatalog.currencies.length) throw new Error('The controlled commercial classification service is unavailable. No unclassified record can be submitted.');
    window.ShadowDashboard?.workspaceNavigation({ navigation: nav, user: session, role });
    if (role === 'admin') {
      if (!session.staff) { status('Management authorization required.', 'This account has no Command Center privileges.', true); return; }
      if (session.aal !== 'aal2') { status('Second factor required.', 'Management records are protected by an additional authenticator verification.'); await mfaGate(); return; }
      status('Authorized management session.', 'Command Center contains confidential internal records. Release only reviewed anonymous information through the controlled workflow.'); await adminWorkspace(); return;
    }
    if (role !== 'home' && !roles.includes(role)) { status('Role not approved.', 'This account is not authorized for the selected workspace.', true); return; }
    status('Approved account.', 'Your workspace contains only your records and individually assigned anonymous opportunities. All introductions pass through ShadowBridge.');
    if (['buyer', 'supplier', 'partner'].includes(role) && window.ShadowMemberDashboard) {
      const summary = el('section', { class: 'dashboard-member' }); root.append(summary);
      memberDashboard = window.ShadowMemberDashboard.mount({ role, session, host: summary });
    }
    if (role !== 'home') {
      const company = section('Your company profile', 'These details belong to your own company. Changes to registered company identity require management review.');
      company.append(details(session.company, [['name', 'Registered company'], ['country', 'Registration country'], ['registrationNumber', 'Registration number']]));
    }
    if (role === 'supplier') resourceWorkspace('offers', 'supplier offer', offerFields, 'productName');
    if (role === 'buyer') { resourceWorkspace('rfqs', 'purchase request', rfqFields, 'product'); opportunities(); }
    if (role === 'partner') { await partnerProfile(); if (closed) return; resourceWorkspace('proposals', 'trade opportunity', proposalFields, 'title'); partnerAssignments(); opportunities(); }
    if (role === 'home') {
      const overview = section('Your approved cooperation', 'Choose an approved workspace above. Permissions and record access are checked by the server on every request.');
      overview.append(details(session.company, [['name', 'Your registered company'], ['country', 'Registration country'], ['registrationNumber', 'Registration number']]));
      if (window.ShadowDashboard) overview.append(window.ShadowDashboard.actions({ title: 'Your workspaces', description: 'Open an existing workspace authorized for your account.', items: [
        ...roles.filter(value => ['buyer', 'supplier', 'partner'].includes(value)).map(value => ({ label: value === 'partner' ? 'B2B Partner Workspace' : `${value[0].toUpperCase() + value.slice(1)} Workspace`, href: `/portal/${value}/` })),
        ...(session.staff ? [{ label: 'Command Center', href: '/portal/admin/', detail: 'Management access requires your second authentication factor.' }] : []),
      ] }));
      if (!roles.length && !session.staff) empty(overview, 'No commercial role has been assigned. Contact ShadowBridge about your company review.');
      if (session.staff && session.aal !== 'aal2') empty(overview, 'Open Command Center to set up or verify your management second factor.');
    }
  }
  start().catch((error) => { if (!closed) { memberDashboard?.clear(); window.ShadowOwnerBook?.clearPrivate(); window.ShadowDashboard?.clearPrivate(); root.replaceChildren(); status('Private service unavailable.', `${error.message} No private workspace has been activated.`, true); } });
})();
