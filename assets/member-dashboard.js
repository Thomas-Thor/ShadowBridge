/* Presentation of existing, role-scoped DTOs only. This module performs no
   requests, grants access or persists records/credentials in browser storage. */
(() => {
  'use strict';
  const labels = {
    draft: 'Draft', submitted: 'Submitted', in_review: 'Under review',
    clarification_requested: 'Clarification requested', approved: 'Approved',
    rejected: 'Rejected', archived: 'Archived', accepted: 'Accepted', closed: 'Closed',
    declined: 'Declined', assigned: 'Assigned', active: 'Active', on_hold: 'On hold',
    completed: 'Completed', cancelled: 'Cancelled', under_agreement: 'Under agreement',
    agreed: 'Agreed', accrued: 'Accrued', paid: 'Recorded paid',
  };
  const roles = {
    buyer: { title: 'Buyer overview', path: '/api/rfqs', noun: 'RFQs', name: 'product',
      paths: ['/api/rfqs', '/api/opportunities'] },
    supplier: { title: 'Supplier overview', path: '/api/offers', noun: 'offers', name: 'productName',
      paths: ['/api/offers'] },
    partner: { title: 'Partner overview', path: '/api/proposals', noun: 'proposals', name: 'title',
      paths: ['/api/proposals', '/api/projects', '/api/commissions', '/api/opportunities'] },
  };
  const count = (items, statuses) => items.filter(item => statuses.includes(item.status)).length;
  const snapshotScope = 'Loaded records only · up to 200 per list. This is not a global total.';

  function mount({ role, session, host }) {
    const ui = window.ShadowDashboard;
    const spec = roles[role];
    const inert = { observe() {}, fail() {}, clear() {} };
    if (!ui || !spec || !host || !session?.emailVerified || session.status !== 'active'
      || session.recoveryOnly || !session.roles?.includes(role)) return inert;
    let disposed = false;
    const datasets = new Map(spec.paths.map(path => [path, { state: 'loading' }]));
    host.dataset.memberDashboard = role;
    host.classList.add('dashboard-member');
    host.setAttribute('aria-label', `${spec.title} summary`);
    const node = ui.create;
    const dataset = path => datasets.get(path);
    const ready = path => dataset(path)?.state === 'ready';
    const records = path => ready(path) ? dataset(path).items : [];

    function sourcePath(path) {
      try {
        const url = new URL(path, location.origin);
        return url.origin === location.origin && datasets.has(url.pathname) ? url.pathname : null;
      } catch { return null; }
    }
    function hint(path) {
      const source = dataset(path);
      return source?.state === 'error' ? 'Unavailable. Reload this workspace to retry.'
        : source?.state === 'loading' ? 'Loading your authorized records…' : snapshotScope;
    }
    function metric(grid, key, label, path, value, href, detail) {
      const card = ui.metric({ label, value: ready(path) ? value : null,
        detail: detail || hint(path), href, linkLabel: 'Open workspace section' });
      card.dataset.dashboardKpi = key;
      grid.append(card);
    }
    function distribution(path, title) {
      if (!ready(path)) return ui.alert({ title,
        message: hint(path), tone: dataset(path)?.state === 'error' ? 'warning' : 'neutral' });
      const groups = new Map();
      for (const item of records(path)) {
        const status = typeof item.status === 'string' ? item.status : 'unspecified';
        groups.set(status, (groups.get(status) || 0) + 1);
      }
      return ui.statusDistribution({ title, description: snapshotScope,
        items: [...groups].map(([status, value]) => ({ status, label: labels[status] || status.replaceAll('_', ' '), value })),
        emptyText: 'No records in the loaded snapshot yet.' });
    }
    function activity() {
      const sources = [spec.path, ...(role === 'partner' ? ['/api/projects'] : [])];
      if (!sources.some(ready)) return ui.alert({ title: 'Recent record activity',
        message: sources.some(path => dataset(path)?.state === 'error') ? 'Record activity is unavailable.' : 'Loading recent record changes…' });
      const items = sources.flatMap(path => records(path).map(item => ({ item, path })))
        .sort((a, b) => (Date.parse(b.item.updatedAt || b.item.createdAt) || 0) - (Date.parse(a.item.updatedAt || a.item.createdAt) || 0))
        .slice(0, 6).map(({ item, path }) => ({
          title: item.data?.[spec.name] || item.title || item.id || 'Saved record',
          detail: [item.id, labels[item.status] || item.status].filter(Boolean).join(' · '),
          at: item.updatedAt || item.createdAt,
          href: path === '/api/projects' ? '#workspace-projects' : '#workspace-records',
          status: item.status,
        }));
      return ui.activity({ title: 'Recent record activity',
        description: 'Latest changes in the loaded authorized records. This is not the internal audit log.',
        items, emptyText: 'No recent changes in this snapshot.' });
    }
    function nextActions() {
      const own = records(spec.path);
      const items = [];
      if (ready(spec.path) && count(own, ['clarification_requested'])) items.push({
        label: 'Respond to clarification requests', href: '#workspace-records',
        detail: 'Open the relevant record and its existing ShadowBridge conversation.' });
      if (ready(spec.path) && count(own, ['draft'])) items.push({
        label: `Complete your draft ${spec.noun}`, href: '#workspace-records',
        detail: 'Review the saved details before submitting them for approval.' });
      items.push({ label: role === 'buyer' ? 'Start a purchase request' : role === 'supplier' ? 'Start a supplier offer' : 'Submit a trade opportunity',
        href: '#workspace-draft', detail: 'Use the existing private draft form.' });
      if (role === 'partner') items.push({ label: 'Review assigned cooperation', href: '#workspace-projects',
        detail: 'Only individually assigned projects are available.' },
      { label: 'Review commission terms', href: '#workspace-commissions', detail: 'Recorded agreements, separated by source currency.' });
      if (role !== 'supplier') items.push({ label: 'Review assigned anonymous opportunities', href: '#workspace-opportunities',
        detail: 'Introductions and enquiries remain coordinated through ShadowBridge.' });
      return ui.actions({ title: 'Next actions',
        description: 'Suggested links from existing workflows, not a task or unread-message count.', items });
    }
    function commissionSnapshot() {
      const path = '/api/commissions';
      if (!ready(path)) return ui.alert({ title: 'Recorded commission terms', message: hint(path),
        tone: dataset(path)?.state === 'error' ? 'warning' : 'neutral' });
      const panel = node('section', { class: 'dashboard-panel', 'aria-label': 'Commission amounts by source currency' });
      panel.append(ui.sectionHeader({ title: 'Recorded commission terms',
        description: 'Loaded agreed, accrued and recorded-paid terms, by source currency. No conversion or payment confirmation.', level: 3 }));
      const groups = new Map();
      let unspecified = 0;
      for (const item of records(path)) {
        if (!['agreed', 'accrued', 'paid'].includes(item.status)) continue;
        const raw = typeof item.amount === 'string' ? item.amount.trim()
          : typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount >= 0
            && Number.isSafeInteger(Math.round(item.amount * 100)) ? item.amount.toFixed(2) : '';
        if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !/^[A-Z]{3}$/.test(item.currency || '')) { unspecified++; continue; }
        // The current database stores amounts at two decimal places. Keep
        // source-currency sums exact instead of rounding a floating-point sum.
        const [whole, fraction = ''] = raw.split('.');
        const minorUnits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
        groups.set(item.currency, (groups.get(item.currency) || 0n) + minorUnits);
      }
      if (!groups.size) panel.append(node('p', { class: 'dashboard-empty', text: 'No agreed commission amounts are available in this snapshot.' }));
      for (const [currency, value] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const amount = `${(value / 100n).toLocaleString('en-GB')}.${String(value % 100n).padStart(2, '0')}`;
        panel.append(node('p', { class: 'dashboard-commission-row', 'data-dashboard-currency': currency }, [
          node('span', { text: currency }), node('strong', { text: amount }),
        ]));
      }
      if (unspecified) panel.append(node('p', { class: 'dashboard-scope', text: `${unspecified} record(s) have no usable amount or currency and are excluded from the totals.` }));
      panel.append(node('p', { class: 'dashboard-scope', text: 'Under-agreement and cancelled records are excluded. Records are limited to the loaded snapshot.' }));
      return panel;
    }
    function render() {
      if (disposed) return;
      const focus = host.contains(document.activeElement) && document.activeElement?.closest('a');
      const previousFocus = focus && { href: focus.getAttribute('href'), text: focus.textContent };
      const own = records(spec.path);
      const grid = node('div', { class: 'dashboard-kpi-grid' });
      const panels = node('div', { class: 'dashboard-columns' });
      const content = [ui.sectionHeader({ title: spec.title, eyebrow: 'PRIVATE COMMERCIAL WORKSPACE',
        description: 'Your own records and explicitly assigned cooperation. Counterparty introductions remain with ShadowBridge.' }), grid];
      if (role === 'buyer') {
        metric(grid, 'rfqs-loaded', 'RFQs loaded', spec.path, own.length, '#workspace-records');
        metric(grid, 'drafts', 'Draft RFQs', spec.path, count(own, ['draft']), '#workspace-records');
        metric(grid, 'clarifications', 'Needs clarification', spec.path, count(own, ['clarification_requested']), '#workspace-records');
      } else if (role === 'supplier') {
        metric(grid, 'offers-loaded', 'Offers loaded', spec.path, own.length, '#workspace-records');
        metric(grid, 'pending-review', 'Awaiting review', spec.path, count(own, ['submitted']), '#workspace-records');
        metric(grid, 'clarifications', 'Needs clarification', spec.path, count(own, ['clarification_requested']), '#workspace-records');
        metric(grid, 'approved', 'Approved offers', spec.path, count(own, ['approved']), '#workspace-records');
      } else {
        const projects = records('/api/projects');
        metric(grid, 'projects-loaded', 'Projects loaded', '/api/projects', projects.length, '#workspace-projects');
        metric(grid, 'open-projects', 'Open cooperation', '/api/projects', count(projects, ['assigned', 'active', 'on_hold']), '#workspace-projects', ready('/api/projects') ? 'Assigned, active and on-hold projects in the loaded snapshot.' : hint('/api/projects'));
        metric(grid, 'proposals-loaded', 'Proposals loaded', spec.path, own.length, '#workspace-records');
        metric(grid, 'commission-records', 'Commission records', '/api/commissions', records('/api/commissions').length, '#workspace-commissions');
      }
      if (role !== 'supplier') {
        const opportunities = dataset('/api/opportunities');
        metric(grid, 'assigned-opportunities', 'Assigned opportunities', '/api/opportunities', opportunities?.total,
          '#workspace-opportunities', ready('/api/opportunities') ? 'Authorized total for the current opportunity filters, not a public catalogue.' : hint('/api/opportunities'));
      }
      if (ready(spec.path) && count(own, ['clarification_requested'])) content.push(ui.alert({
        title: 'Clarification requested', tone: 'warning',
        message: `${count(own, ['clarification_requested'])} loaded record(s) need an update. Open their ShadowBridge conversation; no unread-message total is available.` }));
      panels.append(distribution(spec.path, role === 'supplier' ? 'Offer review status' : role === 'buyer' ? 'RFQ workflow' : 'Proposal pipeline'), nextActions(), activity());
      if (role === 'partner') panels.append(distribution('/api/projects', 'Assigned project workflow'), commissionSnapshot(), ui.alert({
        title: 'Leads & performance', message: 'Lead CRM, conversion, revenue and performance metrics are not connected in this MVP. Existing proposal and project statuses are shown above.' }));
      else panels.append(ui.alert({ title: 'ShadowBridge communications',
        message: 'Messages are attached to each offer or purchase request. Open its conversation below; follow-up tasks and unread-message counts are not available.' }));
      content.push(panels);
      host.replaceChildren(...content);
      if (previousFocus) [...host.querySelectorAll('a')].find(link => link.getAttribute('href') === previousFocus.href && link.textContent === previousFocus.text)?.focus();
    }
    function accept(path, result, failed) {
      if (disposed || !host.isConnected) return;
      const key = sourcePath(path);
      if (!key) return;
      const valid = !failed && Array.isArray(result?.items)
        && result.items.every(item => item && typeof item === 'object' && !Array.isArray(item))
        && (key !== '/api/opportunities' || (Number.isSafeInteger(result.total) && result.total >= 0));
      datasets.set(key, valid ? { state: 'ready', items: result.items, total: result.total } : { state: 'error' });
      render();
    }
    render();
    return {
      observe(path, result) { accept(path, result, false); },
      fail(path) { accept(path, null, true); },
      clear() { disposed = true; datasets.clear(); host.replaceChildren(); },
    };
  }
  window.ShadowMemberDashboard = Object.freeze({ mount });
})();
