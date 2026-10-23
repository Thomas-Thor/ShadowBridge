/* OWNER presentation only. The BFF and PostgreSQL authorize every read/write.
   No CRM records, tokens or drafts are placed in browser storage. */
(() => {
  'use strict';
  const base = '/api/owner/vault';
  const states = new Set();
  const href = (view = 'contacts', id = '', extra = {}) => `/portal/admin/?${new URLSearchParams({ module: 'vault', view, ...(id ? { id } : {}), ...extra })}`;
  const ui = () => window.ShadowDashboard;
  const el = (...args) => ui().create(...args);
  const label = value => String(value || 'Not provided').replaceAll('_', ' ');
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded';
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const statuses = ['unconfirmed', 'confirmed', 'review_required'];
  const fact = (title, value) => el('div', {}, [el('dt', { text: title }), el('dd', { text: value == null || value === '' ? 'Not provided' : Array.isArray(value) ? value.join(', ') : String(value) })]);
  const facts = entries => el('dl', { class: 'vault-facts' }, entries.map(([k, v]) => fact(k, v)));
  const badge = value => ui().statusBadge(value, label(value));
  const link = (text, view, id, extra) => el('a', { class: 'dashboard-inline-link', href: href(view, id, extra), text });
  const state = host => {
    const s = { host, disposed: false, sequence: 0, clear() { s.disposed = true; s.sequence++; host.replaceChildren(); host.remove(); states.delete(s); } };
    states.add(s); return s;
  };
  const live = s => !s.disposed && s.host.isConnected;
  const unavailable = (host, error) => host.replaceChildren(ui().alert({ title: 'Private CRM unavailable', message: error.message || 'No CRM data was returned.', tone: 'error' }));
  function validatePage(data) {
    if (!data || !Array.isArray(data.items) || !count(data.total) || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 50 || data.items.length > data.limit) throw new Error('The private service returned an invalid page.');
    return data;
  }
  function windowText(w) { return w ? `${date(w.start)} – ${date(w.end)} · Europe/Oslo · end excluded` : 'Latest completed 18:00–08:00 interval, Europe/Oslo'; }
  function validateStats(data) {
    for (const key of ['companies', 'contacts', 'duplicatesPrevented', 'newRecordsOvernight', 'newContactsOvernight', 'newCompaniesOvernight', 'reviewRequired', 'contactReviews', 'companyReviews']) if (!count(data?.[key])) throw new Error('CRM counters are unavailable; missing values have not been replaced with zero.');
    if (data.overnight?.timezone !== 'Europe/Oslo' || !Number.isFinite(Date.parse(data.overnight.start)) || !Number.isFinite(Date.parse(data.overnight.end))) throw new Error('The server did not return a valid overnight interval.');
    return data;
  }
  async function overview({ host, api, access }) {
    if (access?.owner !== true) return;
    const frame = el('section', { class: 'vault-overview dashboard-stack', 'data-owner-vault': '', 'aria-label': 'OWNER VAULT overview' }); host.append(frame);
    const s = state(frame);
    frame.append(ui().sectionHeader({ title: 'OWNER VAULT', eyebrow: 'PRIVATE CRM · OWNER ONLY', description: 'A separate private record of companies and business contacts. It grants no platform membership.' }), el('p', { role: 'status', text: 'Loading private CRM statistics…' }));
    try {
      const data = validateStats(await api(`${base}/workspace/statistics`)); if (!live(s)) return;
      frame.querySelector('[role=status]')?.remove();
      const grid = el('div', { class: 'dashboard-grid vault-kpis' });
      for (const [key, title, view, detail] of [
        ['companies', 'Companies', 'companies', 'Private CRM companies. Company verification is independent of member approval.'],
        ['contacts', 'Contacts', 'contacts', 'Private business contacts; no account or membership is created.'],
        ['duplicatesPrevented', 'Duplicates Prevented', 'duplicates', 'Intakes stopped as duplicates, including documented manual links.'],
        ['newRecordsOvernight', 'Overnight Activity', 'overnight', `${data.newCompaniesOvernight} companies + ${data.newContactsOvernight} contacts. ${windowText(data.overnight)}`],
      ]) {
        const card = el('a', { class: 'dashboard-kpi vault-kpi-link', href: href(view), 'data-vault-kpi': key }, [el('h3', { class: 'dashboard-kpi-label', text: title }), el('p', { class: 'dashboard-kpi-value', text: data[key] }), el('p', { class: 'dashboard-kpi-detail', text: detail }), el('span', { class: 'dashboard-inline-link', text: 'Open details →' })]);
        grid.append(card);
      }
      frame.append(grid, el('div', { class: 'vault-review-entry' }, [link(`Review queue · ${data.reviewRequired} unresolved intakes`, 'review'),
        link(`Flagged contacts · ${data.contactReviews}`, 'contacts', '', { status: 'review_required' }), link(`Flagged companies · ${data.companyReviews}`, 'companies', '', { status: 'review_required' })]));
    } catch (error) { if (live(s)) unavailable(frame, error); }
  }
  function mount({ host, api, access, form, ownerReconfirmation }) {
    if (access?.owner !== true) return;
    const frame = el('section', { class: 'portal-section dashboard-stack vault-workspace', 'data-owner-vault': '', 'aria-label': 'OWNER VAULT workspace' }); host.append(frame);
    const s = state(frame), params = new URLSearchParams(location.search);
    let view = params.get('view') || 'companies';
    if (!['companies', 'contacts', 'review', 'duplicates', 'overnight', 'intakes', 'history'].includes(view)) view = 'companies';
    const id = params.get('id');
    frame.append(ui().sectionHeader({ title: 'OWNER VAULT', eyebrow: 'SHADOWBRIDGE INTERNATIONAL · PRIVATE CRM', description: 'OWNER + MFA. Separate from platform members, Market and C.A.R.T.E.L.' }));
    const nav = el('nav', { class: 'vault-tabs', 'aria-label': 'OWNER VAULT sections' });
    for (const [v, title] of [['companies', 'Companies'], ['contacts', 'Contacts'], ['review', 'Review queue'], ['duplicates', 'Duplicates prevented'], ['overnight', 'Overnight activity'], ['intakes', 'Intake history'], ['history', 'Change history']]) nav.append(el('a', { href: href(v), text: title, 'aria-current': v === view ? 'page' : null }));
    frame.append(nav);
    const security = el('details', { class: 'vault-security' }, [el('summary', { text: 'MFA confirmation for changes' }), el('p', { text: 'Edits, verification and conflict decisions require an authenticator confirmation within five minutes. No security checks are bypassed.' })]);
    ownerReconfirmation(security); frame.append(security);
    const content = el('div', { class: 'dashboard-stack vault-content' }); frame.append(content);
    const run = async fn => { try { await fn(); } catch (error) { if (live(s)) unavailable(content, error); } };
    const button = (title, fn) => { const b = el('button', { type: 'button', class: 'portal-button portal-button-secondary', text: title }); b.addEventListener('click', () => run(fn)); return b; };
    const editForm = (holder, fields, title, values, submit) => {
      const d = el('details', { class: 'vault-editor' }, [el('summary', { text: title })]); holder.append(d);
      const f = form(d, [...fields, ['reason', 'Reason and evidence for this decision (10–500 characters)', 'textarea', true]], 'Save reviewed change', async data => { if (!live(s)) return false; await submit(data); return false; }, values);
      f.autocomplete = 'off'; f.dataset.preserveValues = 'true';
      f.querySelector('[name=reason]').minLength = 10; f.querySelector('[name=reason]').maxLength = 500;
      return d;
    };
    const renderContact = (item, detail = false) => {
      const card = el('article', { class: 'dashboard-card vault-record' }, [el('h3', { text: item.full_name }), badge(item.verification_status),
        facts([['Company', item.company_name], ['Country', item.country], ['Position', item.title], ['Business email', item.work_email], ['Email kind', item.email_kind], ['Source', item.source_system], ['Source record', item.source_record_id], ['Added', date(item.created_at)]])]);
      card.append(link('Contact details', 'contacts', item.id), link('Company details', 'companies', item.company_id));
      if (detail) {
        card.append(facts([['Professional URL', item.professional_url], ['Source URL', item.source_url], ['Updated', date(item.updated_at)], ['Version', item.version]]), link('Audited change history', 'history', item.id));
        editForm(card, [['fullName', 'Full name', 'text', true], ['title', 'Position', 'text'], ['workEmail', 'Business email', 'email'], ['emailKind', 'Email kind', 'select', true, ['unknown', 'shared', 'individual']], ['professionalUrl', 'Canonical HTTPS professional URL', 'url']], 'Edit contact — identity keys remain protected',
          { fullName: item.full_name, title: item.title, workEmail: item.work_email, emailKind: item.email_kind, professionalUrl: item.professional_url }, async ({ reason, ...data }) => { await api(`${base}/contacts/${item.id}`, 'PATCH', { data, version: item.version, reason }); if (live(s)) await contactDetail(); });
        editForm(card, [['status', 'Contact verification — does not verify the company', 'select', true, statuses]], 'Record contact verification', { status: item.verification_status }, async ({ status, reason }) => { await api(`${base}/contacts/${item.id}/review`, 'POST', { status, version: item.version, reason }); if (live(s)) await contactDetail(); });
      }
      return card;
    };
    const renderCompany = (item, detail = false) => {
      const card = el('article', { class: 'dashboard-card vault-record' }, [el('h3', { text: item.name }), badge(item.verification_status),
        facts([['Country', item.country], ['Registration number', item.registration_number], ['Sector', item.sector], ['Website', item.website], ['Added', date(item.created_at)], ['Contacts', item.contact_count], ['Sources', item.sources]])]);
      card.append(link('Company details', 'companies', item.id));
      if (detail) {
        card.append(el('p', { class: 'dashboard-description', text: 'Country and registration identity are locked. Edits never reassign contacts or approve platform membership.' }), link('Audited change history', 'history', item.id));
        editForm(card, [['name', 'Legal company name', 'text', true], ['sector', 'Sector', 'text'], ['website', 'Canonical HTTPS website', 'url'], ['verificationStatus', 'Company verification — independent documented evidence required', 'select', true, statuses]], 'Edit company details and verification',
          { name: item.name, sector: item.sector, website: item.website, verificationStatus: item.verification_status }, async ({ reason, ...data }) => { await api(`${base}/companies/${item.id}`, 'PATCH', { data, version: item.version, reason }); if (live(s)) await companyDetail(); });
      }
      return card;
    };
    const renderIntake = item => {
      const p = item.payload || {}, card = el('article', { class: 'dashboard-card vault-record' }, [el('h3', { text: p.company?.name || (item.reason_code === 'owner_review' ? 'Documented verification decision' : 'Private intake') }), badge(item.effective_status),
        facts([['Contact', p.contact?.fullName], ['Source', p.source?.system], ['Source record', p.source?.recordId], ['Source URL', p.source?.url], ['Received', date(item.created_at)], ['Reason code', label(item.reason_code)], ['Original outcome', label(item.status)], ['Review evidence', p.reviewReason]])]);
      if (item.contact_id) card.append(link('Contact record', 'contacts', item.contact_id));
      if (item.resolution) card.append(facts([['Decision', label(item.resolution.decision)], ['Decision reason', item.resolution.reason], ['Decided', date(item.resolution.created_at)]]));
      if (view === 'review' && item.effective_status === 'review_required') {
        card.append(el('details', {}, [el('summary', { text: 'Submitted evidence (private)' }), facts([
          ['Legal name', p.company?.name], ['Country', p.company?.country], ['Registry number', p.company?.registrationNumber], ['Sector', p.company?.sector], ['Website', p.company?.website],
          ['Full name', p.contact?.fullName], ['Position', p.contact?.title], ['Email', p.contact?.workEmail], ['Email kind', p.contact?.emailKind], ['Profile', p.contact?.professionalUrl],
        ])]));
        const candidates = el('div', { class: 'vault-candidates' }, [el('p', { text: 'Compare the recorded candidates before deciding. Linking preserves the existing record and cannot steal conflicting identity keys or change a company.' })]); card.append(candidates);
        for (const candidate of item.candidates || []) candidates.append(link('Compare candidate contact', 'contacts', candidate));
        editForm(card, [['decision', 'Decision', 'select', true, [{ value: 'dismiss', label: 'Dismiss intake — preserve history and existing contacts' }, { value: 'link_existing', label: 'Link to a recorded existing candidate — no merge or overwrite' }]],
          ['contactId', 'Candidate contact (only for linking; leave blank for dismissal)', 'select', false, (item.candidates || []).map(value => ({ value, label: value }))]], 'Resolve intake with documented evidence', { decision: 'dismiss' }, async ({ decision, contactId, reason }) => {
          await api(`${base}/intakes/${item.id}/resolve`, 'POST', { decision, contactId: contactId || null, version: item.review_version, reason });
          if (live(s)) await showList('intakes', 'Unresolved intake reviews', renderIntake, { queue: 'open' });
        });
      }
      return card;
    };
    const renderHistory = item => el('article', { class: 'dashboard-card vault-record' }, [el('h3', { text: `${label(item.resource_type)} edit` }), facts([['Recorded', date(item.created_at)], ['Resource', item.resource_id], ['Reason', item.reason]]),
      el('details', {}, [el('summary', { text: 'Before and after (private audit)' }), el('pre', { class: 'vault-json', text: JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2) })])]);
    async function showList(type, title, renderer, fixed = {}, parent = content) {
      const token = ++s.sequence;
      parent.replaceChildren(el('h3', { text: title }));
      let page = 1;
      const filters = el('form', { class: 'vault-filters', role: 'search', 'aria-label': `Filter ${title}` });
      if (type !== 'history') {
        filters.append(el('label', { class: 'entry-field' }, [document.createTextNode('Search private records'), el('input', { type: 'search', name: 'q', maxlength: 100, autocomplete: 'off' })]));
        if (!fixed.status && !fixed.queue) filters.append(el('label', { class: 'entry-field' }, [document.createTextNode('Verification / outcome'), el('select', { name: 'status' }, [el('option', { value: '', text: 'All states' }),
          ...(type === 'intakes' ? ['accepted', 'duplicate_prevented', 'review_required', 'dismissed'] : statuses).map(v => el('option', { value: v, text: label(v) }))])]));
        filters.append(el('label', { class: 'entry-field' }, [document.createTextNode('Country (ISO, optional)'), el('input', { name: 'country', maxlength: 2, pattern: '[A-Za-z]{2}', autocomplete: 'off', placeholder: 'NO' })]));
      }
      filters.append(el('label', { class: 'entry-field' }, [document.createTextNode('Records per page'), el('select', { name: 'limit' }, [10, 25, 50].map(v => el('option', { value: v, text: v })))]), el('button', { class: 'portal-button', type: 'submit', text: 'Apply filters' }));
      const output = el('p', { role: 'status', 'aria-live': 'polite' }), list = el('div', { class: 'vault-records' });
      const pagination = el('nav', { class: 'vault-pagination', 'aria-label': `${title} pages` });
      const prev = button('Previous', async () => { page--; await load(); }), next = button('Next', async () => { page++; await load(); });
      pagination.append(prev, next); parent.append(filters, output, list, pagination);
      if (params.get('status') && type !== 'history' && filters.elements.status) filters.elements.status.value = params.get('status');
      if (type === 'intakes' && view === 'intakes') parent.prepend(link('Resolved decisions archive', 'intakes', '', { queue: 'resolved' }));
      let loading = 0;
      async function load() {
        const call = ++loading, query = new URLSearchParams(new FormData(filters));
        for (const [k, v] of Object.entries(fixed)) query.set(k, v);
        query.set('page', page); list.setAttribute('aria-busy', 'true'); prev.disabled = true; next.disabled = true;
        try {
          const data = validatePage(await api(`${base}/workspace/${type}${type === 'history' && id ? `/${encodeURIComponent(id)}` : ''}?${query}`));
          if (!live(s) || token !== s.sequence || call !== loading) return;
          const pages = Math.max(1, Math.ceil(data.total / data.limit));
          output.textContent = `${data.total} records · Page ${data.page} of ${pages}${data.overnight ? ` · ${windowText(data.overnight)}` : ''}`;
          list.replaceChildren(...data.items.map(item => renderer(item)));
          if (!data.items.length) list.append(el('p', { class: 'dashboard-empty', text: 'No records match this authorized view.' }));
          prev.disabled = data.page <= 1; next.disabled = data.page >= pages;
        } catch (error) { if (live(s) && token === s.sequence && call === loading) { list.replaceChildren(ui().alert({ title: 'Records unavailable', message: error.message, tone: 'error' })); output.textContent = ''; } }
        finally { if (live(s) && call === loading) list.removeAttribute('aria-busy'); }
      }
      filters.addEventListener('submit', event => { event.preventDefault(); if (!filters.reportValidity()) return; page = 1; load(); });
      await load();
    }
    async function contactDetail() {
      const data = validatePage(await api(`${base}/workspace/contacts/${encodeURIComponent(id)}`)); if (!live(s)) return;
      content.replaceChildren(el('h3', { text: 'Contact details' }), ...(data.items.length ? [renderContact(data.items[0], true)] : [el('p', { text: 'Contact not found.' })]));
    }
    async function companyDetail() {
      const data = validatePage(await api(`${base}/workspace/companies/${encodeURIComponent(id)}`)); if (!live(s)) return;
      content.replaceChildren(el('h3', { text: 'Company details' }));
      if (!data.items.length) { content.append(el('p', { text: 'Company not found.' })); return; }
      content.append(renderCompany(data.items[0], true)); const contacts = el('section', { class: 'dashboard-stack' }); content.append(contacts);
      await showList('contacts', 'Company contacts', renderContact, { companyId: id }, contacts);
    }
    run(async () => {
      if (id && view === 'contacts') return contactDetail();
      if (id && view === 'companies') return companyDetail();
      if (view === 'companies') return showList('companies', 'Private companies', renderCompany);
      if (view === 'contacts') return showList('contacts', 'Private business contacts', renderContact);
      if (view === 'review') return showList('intakes', 'Unresolved intake reviews', renderIntake, { queue: 'open' });
      if (view === 'duplicates') return showList('intakes', 'Duplicates prevented — intake history', renderIntake, { status: 'duplicate_prevented' });
      if (view === 'intakes') return showList('intakes', 'Intake history', renderIntake, params.get('queue') === 'resolved' ? { queue: 'resolved' } : {});
      if (view === 'history') return showList('history', 'Audited change history', renderHistory);
      if (view === 'overnight') {
        const type = params.get('type') === 'companies' ? 'companies' : 'contacts';
        content.append(link('Companies created overnight', 'overnight', '', { type: 'companies' }), link('Contacts created overnight', 'overnight'));
        const records = el('section', { class: 'dashboard-stack' }); content.append(records);
        return showList(type, `Overnight ${type}`, type === 'contacts' ? renderContact : renderCompany, { period: 'overnight' }, records);
      }
    });
    return s;
  }
  function clearPrivate() { for (const item of [...states]) item.clear(); }
  window.ShadowOwnerVault = Object.freeze({ overview, mount, clearPrivate });
})();
