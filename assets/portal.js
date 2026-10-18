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
  async function api(path, method = 'GET', body) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') { headers['X-CSRF-Token'] = csrfToken; headers['Content-Type'] = 'application/json'; }
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) { root.replaceChildren(); status('Session required.', 'Sign in again to access your authorized records.', true); }
      throw new Error(result.error || 'The secure service could not complete this request.');
    }
    return result;
  }
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
      const value = data?.[key];
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
        const result = await api(path); holder.replaceChildren();
        if (!Array.isArray(result.items)) throw new Error('Invalid response from the secure service.');
        if (!result.items.length) empty(holder, message);
        for (const item of result.items) await render(holder, item, refresh);
      } catch (error) { holder.replaceChildren(el('p', { class: 'portal-error', text: error.message })); }
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
      else if (type === 'select') { control = el('select', { id, name, required }); control.append(el('option', { value: '', text: 'Select…', disabled: required })); for (const option of options) control.append(el('option', { value: option, text: option })); }
      else control = el('input', { id, name, type, required, maxlength: type === 'number' ? null : 1000, ...(type === 'number' ? { min: 0, step: 'any' } : {}), ...(name === 'code' ? { inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: 6, autocomplete: 'one-time-code' } : {}), ...(name === 'agreementReference' ? { pattern: '(?:[A-Z0-9]|-){3,80}', minlength: 3, maxlength: 80, title: 'Use 3–80 uppercase letters, numbers and hyphens. Do not include company names or contact details.' } : {}) });
      if (type === 'checkbox') { control.checked = values[name] === true; grid.append(el('label', { class: 'entry-check' }, [control, document.createTextNode(label)])); }
      else { control.value = values[name] == null ? '' : Array.isArray(values[name]) ? values[name].join(', ') : text(values[name]); grid.append(el('label', { class: `entry-field${type === 'textarea' ? ' entry-wide' : ''}`, for: id }, [document.createTextNode(label), control])); }
    }
    const submit = el('button', { type: 'submit', class: 'entry-submit', text: submitLabel });
    const output = el('p', { class: 'portal-form-message', role: 'status', 'aria-live': 'polite' });
    fs.append(grid, submit); node.append(fs, output); parent.append(node);
    node.addEventListener('submit', async (event) => {
      event.preventDefault(); if (!node.reportValidity()) return;
      const fd = new FormData(node); const data = Object.fromEntries(fd.entries());
      for (const [name, , type] of fields) if (type === 'checkbox') data[name] = fd.has(name);
      fs.disabled = true; node.setAttribute('aria-busy', 'true'); output.textContent = '';
      try { const result = await onSubmit(data, node); if (result !== false) { output.textContent = 'Saved securely.'; if (node.dataset.preserveValues !== 'true') node.reset(); } }
      catch (error) { output.textContent = error.message; output.classList.add('portal-error'); }
      finally { fs.disabled = false; node.removeAttribute('aria-busy'); }
    }); return node;
  }
  const offerFields = [
    ['category', 'Product category', 'text', true], ['productName', 'Product name', 'text', true],
    ['description', 'Description — no counterparty names or contact details', 'textarea', true], ['specification', 'Technical specification', 'textarea', true],
    ['countryOfOrigin', 'Country of origin', 'text', true], ['quantity', 'Available quantity', 'number', true], ['unit', 'Quantity unit', 'text', true],
    ['price', 'Unit price', 'number', true], ['currency', 'Currency', 'select', true, ['EUR', 'USD', 'GBP', 'NOK']],
    ['minimumOrderQuantity', 'Minimum order quantity', 'number', true], ['incoterms', 'Incoterms', 'select', true, ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']],
    ['loadingLocation', 'Loading location', 'text', true], ['deliveryTerms', 'Delivery terms', 'textarea', true], ['availability', 'Availability', 'text', true],
    ['validUntil', 'Offer valid until', 'date', true], ['certificationsStatus', 'Certificates / document status (no uploads)', 'text'], ['notes', 'Internal notes for ShadowBridge', 'textarea'],
  ];
  const rfqFields = [
    ['product', 'Product required', 'text', true], ['specifications', 'Required specifications', 'textarea', true], ['quantity', 'Required quantity', 'number', true],
    ['unit', 'Quantity unit', 'text', true], ['budget', 'Target budget (optional)', 'number'], ['currency', 'Currency', 'select', true, ['EUR', 'USD', 'GBP', 'NOK']],
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
      form(host, [['body', 'Message to ShadowBridge', 'textarea', true]], 'Send to ShadowBridge', async (data) => {
        await api('/api/messages', 'POST', { resourceType, resourceId, body: data.body }); await refresh();
      });
    }, true));
  }
  function resourceWorkspace(kind, title, fields, dataTitle) {
    const grid = el('div', { class: 'portal-grid' }); root.append(grid);
    const create = section(`New ${title}`, 'Start with a title and save your private draft. Complete the commercial details before submitting it for individual ShadowBridge review. Submitting never publishes it automatically.', grid);
    create.append(el('p', { class: 'portal-document-notice', text: 'Document uploads are disabled. Only approved, non-identifying commercial summaries may be released by management.' }));
    const list = section(`Your ${kind === 'rfqs' ? 'purchase requests' : kind === 'offers' ? 'offers' : 'opportunities'}`, 'Only your own records are returned by the secure service.', grid);
    const singular = kind === 'rfqs' ? 'rfq' : kind === 'offers' ? 'offer' : 'proposal';
    const draftFields = fields.map(([name, label, type, required, options]) => [name, label, type, [dataTitle].includes(name), options]);
    const refresh = listLoader(list, `/api/${kind}`, async (parent, item, reload) => {
      const card = recordCard(parent, item, item.data?.[dataTitle]);
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
    const approvedFields = [['title', 'Commercial opportunity'], ['category', 'Category'], ['specification', 'Specification'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['price', 'Indicative unit price'], ['currency', 'Currency'], ['incoterms', 'Incoterms'], ['availability', 'Availability'], ['validUntil', 'Valid until']];
    listLoader(parent, '/api/opportunities', (holder, item) => {
      const card = recordCard(holder, item, item.data?.title); card.append(details(item.data, approvedFields));
      form(card, [['body', 'Enquiry to ShadowBridge', 'textarea', true]], 'Enquire through ShadowBridge', async (data) => {
        await api(`/api/opportunities/${encodeURIComponent(item.id)}/enquiries`, 'POST', { body: data.body });
      });
    }, 'No anonymous opportunities have been individually released to your company.');
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
    listLoader(projects, '/api/projects', (holder, item) => {
      const card = recordCard(holder, item, item.title || item.data?.title);
      card.append(details(item.data || item, [['title', 'Project'], ['scope', 'Assigned scope'], ['summary', 'Assigned cooperation'], ['stage', 'Cooperation stage'], ['status', 'Status'], ['updatedAt', 'Updated']]));
    }, 'No projects have been assigned to your account.');
    const commissions = section('Individually agreed commissions', 'Commission terms are negotiated for each cooperation. No default percentage is assumed.');
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
  function adminWorkspace() {
    const applications = section('Company applications', 'Management-only company details. Verify companies independently before approving any role.');
    listLoader(applications, '/api/admin/applications', (holder, item, refresh) => {
      const card = recordCard(holder, item, item.company?.name || item.companyName || item.id);
      card.append(details({ ...item, company: item.company, profile: item.profile }, [['userId', 'Internal account ID'], ['email', 'Applicant email'], ['companyId', 'Internal company ID'], ['company', 'Company details'], ['profile', 'Commercial profile'], ['role', 'Requested role'], ['status', 'Application status'], ['createdAt', 'Received']]));
      form(card, [['decision', 'Review decision', 'select', true, ['approved', 'rejected']], ['reason', 'Decision reason', 'textarea', true]], 'Record application decision', async (data) => {
        await api(`/api/admin/applications/${encodeURIComponent(item.id)}/decision`, 'POST', data); await refresh();
      });
      if (item.userId) form(card, [['status', 'Account status', 'select', true, ['suspended', 'active']]], 'Change account status', async (data) => {
        await api(`/api/admin/accounts/${encodeURIComponent(item.userId)}/status`, 'POST', data); await refresh();
      });
    }, 'No company applications are awaiting review.');
    const companies = section('Internal companies', 'Company identifiers and mappings are available only to authorized management. Never include these identifiers in released commercial summaries.');
    listLoader(companies, '/api/admin/companies', (holder, item) => {
      const card = recordCard(holder, item, item.name);
      card.append(details(item, [['id', 'Internal company ID'], ['name', 'Registered name'], ['registrationNumber', 'Registration number'], ['country', 'Country'], ['status', 'Status']]));
    }, 'No registered companies.');
    for (const [kind, title, fields, decisions] of [
      ['offers', 'Supplier offer review', offerFields, ['approved', 'rejected', 'clarification_requested']],
      ['rfqs', 'Buyer request review', rfqFields, ['in_review', 'clarification_requested', 'accepted', 'closed']],
      ['proposals', 'Partner opportunity review', proposalFields, ['in_review', 'accepted', 'declined']],
    ]) {
      const parent = section(title, 'Source records remain confidential. Approval of a source offer does not automatically release it to any buyer.');
      listLoader(parent, `/api/admin/${kind}`, (holder, item, refresh) => {
        const card = recordCard(holder, item, item.data?.productName || item.data?.product || item.data?.title);
        card.append(details(item, [['companyId', 'Internal owner company ID'], ['companyName', 'Owner company'], ['userId', 'Internal owner account ID']]));
        card.append(details(item.data, fields.map(([key, label]) => [key, label])));
        form(card, [['decision', 'Review decision', 'select', true, decisions], ['reason', 'Review notes / reason', 'textarea', true]], 'Record review decision', async (data) => {
          await api(`/api/admin/${kind}/${encodeURIComponent(item.id)}/decision`, 'POST', data); await refresh();
        });
        communications(card, kind === 'offers' ? 'offer' : kind === 'proposals' ? 'proposal' : 'rfq', item.id);
      }, 'No source records to review.');
    }
    const released = section('Prepare an anonymous commercial opportunity', 'Manually prepare a separate, non-identifying summary from an approved source offer. Remove company names, addresses, contacts, websites, product codes identifying a supplier, document metadata and CRM IDs. This is a controlled review, not automatic anonymization.');
    form(released, [['sourceOfferId', 'Approved ShadowBridge source offer ID', 'text', true], ['title', 'Anonymous commercial title', 'text', true], ['category', 'Category', 'text', true], ['specification', 'Reviewed non-identifying specification', 'textarea', true], ['quantity', 'Quantity', 'number', true], ['unit', 'Unit', 'text', true], ['price', 'Price', 'number', true], ['currency', 'Currency', 'select', true, ['EUR', 'USD', 'GBP', 'NOK']], ['incoterms', 'Incoterms', 'text', true], ['availability', 'Availability', 'text', true], ['validUntil', 'Valid until', 'date', true], ['reviewedNonIdentifying', 'I have reviewed the complete summary and confirm it contains no confidential or identifying counterparty information.', 'checkbox', true]], 'Create restricted anonymous opportunity', async (data) => {
      const { sourceOfferId, reviewedNonIdentifying, ...commercial } = data;
      await api('/api/admin/opportunities', 'POST', { sourceOfferId, commercial, reviewedNonIdentifying }); await refreshOpportunities();
    });
    const assignments = section('Individual opportunity release', 'Release each anonymous opportunity only to a specifically approved company and role. No unrestricted catalogue is created.');
    const refreshOpportunities = listLoader(assignments, '/api/admin/opportunities', (holder, item) => {
      const card = recordCard(holder, item, item.data?.title || item.commercial?.title);
      card.append(details(item.data || item.commercial, [['title', 'Released title'], ['category', 'Category'], ['specification', 'Reviewed specification']]));
      form(card, [['recipientCompanyId', 'Approved recipient company ID (internal)', 'text', true], ['role', 'Recipient role', 'select', true, ['buyer', 'partner']]], 'Assign anonymous opportunity', (data) => api(`/api/admin/opportunities/${encodeURIComponent(item.id)}/assign`, 'POST', data));
    }, 'No anonymous opportunities have been prepared.');
    const projectAssignment = section('Assign partner cooperation', 'Create a precisely scoped project for an approved partner. No counterparty names, contacts or identifying details may appear in the partner-visible title or summary.');
    form(projectAssignment, [['partnerCompanyId', 'Approved partner company ID (internal)', 'text', true], ['title', 'Project title visible to the partner', 'text', true], ['summary', 'Approved partner-visible cooperation summary', 'textarea', true], ['reviewedNonIdentifying', 'I have reviewed the partner-visible title and summary and confirm they contain no counterparty names, contacts or identifying details.', 'checkbox', true]], 'Assign partner project', async (data) => {
      const result = await api('/api/admin/projects', 'POST', data);
      status('Partner project assigned.', `Project reference: ${result.item?.id || 'recorded by the server'}. Only the assigned partner can access the released project.`);
    });
    const agreedCommission = section('Record an agreed partner commission', 'Enter actual agreed commercial terms only. The partner-visible agreement reference must be a non-identifying reference code of 3–80 characters using uppercase letters, numbers and hyphens. Do not use a contract filename, customer name or contact details.');
    form(agreedCommission, [['projectId', 'Assigned ShadowBridge project ID', 'text', true], ['amount', 'Agreed commission amount', 'number', true], ['currency', 'Currency', 'select', true, ['EUR', 'USD', 'GBP', 'NOK']], ['agreementReference', 'Non-identifying agreement reference code', 'text', true], ['reviewedNonIdentifying', 'I have reviewed this reference code and confirm it contains no counterparty names, contacts or identifying details.', 'checkbox', true], ['agreementConfirmed', 'I confirm these are actual individually agreed terms supported by the stated agreement.', 'checkbox', true]], 'Record agreed commission', (data) => api('/api/admin/commissions', 'POST', data));
    const audit = section('Activity log', 'Security and management decisions are recorded by the server. No editing or deletion of activity logs is available here.');
    listLoader(audit, '/api/admin/audit', (holder, item) => {
      const card = recordCard(holder, item, item.action || item.event);
      card.append(details(item, [['createdAt', 'Time'], ['actorId', 'Internal actor'], ['action', 'Action'], ['resourceType', 'Resource type'], ['resource', 'Resource'], ['resourceId', 'Resource reference'], ['details', 'Audit details'], ['metadata', 'Event metadata']]));
    }, 'No logged activity.');
  }
  async function start() {
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
    account.append(el('span', { class: 'portal-environment', text: config.environment === 'local' ? 'Local development — not production' : 'Secure member service' }), el('p', { text: session.email }), button('Sign out', async () => { await api('/api/auth/logout', 'POST', {}); location.assign('/member-sign-in/'); }, true));
    if (!session.emailVerified) { status('Verify your email.', 'Confirm your business email before accessing any private workspace. No private business records have been loaded.'); return; }
    if (!session.staff && session.applicationStatus !== 'approved') {
      const labels = { pending: 'Application under review.', rejected: 'Application not approved.', suspended: 'Account suspended.' };
      status(labels[session.applicationStatus] || 'Approval required.', 'Your current account status does not permit access to private commercial records. ShadowBridge reviews each company individually.');
      if (session.applicationStatus === 'not_submitted') {
        const application = section('Complete your company application', 'Your email is verified. Submit your company details for individual review. No private access is granted until management approves the application.');
        form(application, [['role', 'Business role', 'select', true, ['buyer', 'supplier', 'partner']], ['companyName', 'Registered company name', 'text', true], ['country', 'Country of registration', 'text', true], ['registrationNumber', 'Company registration number', 'text', true], ['countries', 'Markets or countries (comma separated)', 'text'], ['sectors', 'Commercial sectors (comma separated)', 'text'], ['summary', 'General business scope — no counterparty identities', 'textarea'], ['acknowledgement', 'I understand that email verification and manual company approval are required and that introductions are coordinated by ShadowBridge.', 'checkbox', true]], 'Submit company application', async (data) => {
          const company = { name: data.companyName, country: data.country, registrationNumber: data.registrationNumber };
          const profile = { countries: data.countries.split(',').map((value) => value.trim()).filter(Boolean), sectors: data.sectors.split(',').map((value) => value.trim()).filter(Boolean), summary: data.summary };
          await api('/api/application', 'POST', { role: data.role, company, profile }); location.reload(); return false;
        });
      }
      return;
    }
    const roles = Array.isArray(session.roles) ? session.roles : [];
    nav.hidden = false;
    nav.append(el('a', { href: '/portal/', text: 'Overview', 'aria-current': role === 'home' ? 'page' : null }));
    for (const value of ['buyer', 'supplier', 'partner']) if (roles.includes(value)) nav.append(el('a', { href: `/portal/${value}/`, text: value === 'partner' ? 'B2B Partner' : value[0].toUpperCase() + value.slice(1), 'aria-current': role === value ? 'page' : null }));
    if (session.staff) nav.append(el('a', { href: '/portal/admin/', text: 'Command Center', 'aria-current': role === 'admin' ? 'page' : null }));
    if (role === 'admin') {
      if (!session.staff) { status('Management authorization required.', 'This account has no Command Center privileges.', true); return; }
      if (session.aal !== 'aal2') { status('Second factor required.', 'Management records are protected by an additional authenticator verification.'); await mfaGate(); return; }
      status('Authorized management session.', 'Command Center contains confidential internal records. Release only reviewed anonymous information through the controlled workflow.'); adminWorkspace(); return;
    }
    if (role !== 'home' && !roles.includes(role)) { status('Role not approved.', 'This account is not authorized for the selected workspace.', true); return; }
    status('Approved account.', 'Your workspace contains only your records and individually assigned anonymous opportunities. All introductions pass through ShadowBridge.');
    if (role !== 'home') {
      const company = section('Your company profile', 'These details belong to your own company. Changes to registered company identity require management review.');
      company.append(details(session.company, [['name', 'Registered company'], ['country', 'Registration country'], ['registrationNumber', 'Registration number']]));
    }
    if (role === 'supplier') resourceWorkspace('offers', 'supplier offer', offerFields, 'productName');
    if (role === 'buyer') { resourceWorkspace('rfqs', 'purchase request', rfqFields, 'product'); opportunities(); }
    if (role === 'partner') { await partnerProfile(); resourceWorkspace('proposals', 'trade opportunity', proposalFields, 'title'); partnerAssignments(); opportunities(); }
    if (role === 'home') {
      const overview = section('Your approved cooperation', 'Choose an approved workspace above. Permissions and record access are checked by the server on every request.');
      overview.append(details(session.company, [['name', 'Your registered company'], ['country', 'Registration country'], ['registrationNumber', 'Registration number']]));
      if (!roles.length && !session.staff) empty(overview, 'No commercial role has been assigned. Contact ShadowBridge about your company review.');
      if (session.staff && session.aal !== 'aal2') empty(overview, 'Open Command Center to set up or verify your management second factor.');
    }
  }
  start().catch((error) => { root.replaceChildren(); status('Private service unavailable.', `${error.message} No private workspace has been activated.`, true); });
})();
