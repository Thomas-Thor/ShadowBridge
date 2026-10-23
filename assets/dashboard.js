/* Presentation only. Permissions, identity and persistence remain in the BFF.
   Widgets receive approved DTOs; this file never requests or stores records. */
(() => {
  'use strict';
  const display = value => value == null || value === '' ? '—' : typeof value === 'object' ? 'Not provided' : String(value);
  const safeHref = value => typeof value === 'string' && (/^\/(?!\/)/.test(value) || /^#/.test(value) || /^\.\.?\//.test(value));
  function create(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') element.textContent = display(value);
      else if (key === 'class') element.className = value;
      else if (key === 'onClick' && typeof value === 'function') element.addEventListener('click', value);
      else if (key === 'href' && !safeHref(value)) continue;
      else if (value !== false && value != null) element.setAttribute(key, value === true ? '' : String(value));
    }
    element.append(...children.filter(item => item !== undefined && item !== null && item !== false));
    return element;
  }
  function sectionHeader({ title, description, eyebrow, href, linkLabel = 'View details', level = 2 }) {
    const copy = create('div', { class: 'dashboard-section-copy' });
    if (eyebrow) copy.append(create('p', { class: 'dashboard-eyebrow', text: eyebrow }));
    copy.append(create(level === 3 ? 'h3' : 'h2', { text: title }));
    if (description) copy.append(create('p', { class: 'dashboard-description', text: description }));
    const header = create('header', { class: 'dashboard-section-header' }, [copy]);
    if (safeHref(href)) header.append(create('a', { class: 'dashboard-inline-link', href, text: linkLabel }));
    return header;
  }
  function metric({ label, value, detail, href, linkLabel = 'Open workspace' }) {
    const card = create('article', { class: 'dashboard-kpi' }, [
      create('h3', { class: 'dashboard-kpi-label', text: label }),
      create('p', { class: 'dashboard-kpi-value portal-metric', text: value }),
    ]);
    if (detail) card.append(create('p', { class: 'dashboard-kpi-detail', text: detail }));
    if (safeHref(href)) card.append(create('a', { class: 'dashboard-inline-link', href, text: linkLabel }));
    return card;
  }
  function statusBadge(status, label) {
    return create('span', { class: 'dashboard-status', 'data-status': typeof status === 'string' ? status : '', text: label || (typeof status === 'string' ? status.replaceAll('_', ' ') : 'Not provided') });
  }
  function statusDistribution({ title, description, items = [], emptyText = 'No records available in this view.' }) {
    const panel = create('section', { class: 'dashboard-panel dashboard-distribution' }, [sectionHeader({ title, description, level: 3 })]);
    const values = items.map(item => ({ ...item, value: typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0 ? item.value : 0 }));
    const total = values.reduce((sum, item) => sum + item.value, 0);
    if (!values.length || total === 0) {
      panel.append(create('p', { class: 'dashboard-empty', text: emptyText }));
      return panel;
    }
    const list = create('ul', { class: 'dashboard-bars' });
    for (const item of values) {
      const meter = create('meter', { min: 0, max: total, value: item.value, 'aria-label': `${display(item.label)}: ${item.value} of ${total}` });
      meter.textContent = `${item.value} / ${total}`;
      list.append(create('li', {}, [create('div', { class: 'dashboard-bar-label' }, [statusBadge(item.status, item.label), create('span', { text: item.value })]), meter]));
    }
    panel.append(list); return panel;
  }
  function activity({ title, description, items = [], emptyText = 'No recent activity is available.' }) {
    const panel = create('section', { class: 'dashboard-panel' }, [sectionHeader({ title, description, level: 3 })]);
    if (!items.length) { panel.append(create('p', { class: 'dashboard-empty', text: emptyText })); return panel; }
    const list = create('ol', { class: 'dashboard-activity' });
    for (const item of items) {
      const copy = create('div', { class: 'dashboard-activity-copy' }, [safeHref(item.href) ? create('a', { href: item.href, text: item.title }) : create('strong', { text: item.title })]);
      if (item.detail) copy.append(create('p', { text: item.detail }));
      const date = new Date(item.at);
      if (item.at && Number.isFinite(date.valueOf())) copy.append(create('time', { datetime: date.toISOString(), text: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date) }));
      const row = create('li', {}, [create('span', { class: 'dashboard-activity-dot', 'aria-hidden': true }), copy]);
      if (item.status) row.append(statusBadge(item.status));
      list.append(row);
    }
    panel.append(list); return panel;
  }
  function alert({ title, message, tone = 'neutral' }) {
    return create('div', { class: 'dashboard-alert', 'data-tone': ['neutral', 'warning', 'error', 'success'].includes(tone) ? tone : 'neutral' }, [create('strong', { text: title }), create('p', { text: message })]);
  }
  function actions({ title = 'Next actions', description, items = [] }) {
    const panel = create('section', { class: 'dashboard-panel' }, [sectionHeader({ title, description, level: 3 })]);
    if (!items.length) { panel.append(create('p', { class: 'dashboard-empty', text: 'No further action is suggested by the records in this view.' })); return panel; }
    const list = create('ul', { class: 'dashboard-actions' });
    for (const item of items) {
      if (!safeHref(item.href)) continue;
      const link = create('a', { href: item.href }, [create('strong', { text: item.label }), create('span', { class: 'dashboard-action-arrow', 'aria-hidden': true, text: '↗' })]);
      if (item.detail) link.append(create('small', { text: item.detail }));
      list.append(create('li', {}, [link]));
    }
    panel.append(list); return panel;
  }
  let sidebar;
  let moduleSlot;
  // One presentation map for every administrative page. The caller supplies
  // the effective access returned by the BFF after its existing MFA/session gate.
  const managementModules = Object.freeze([
    ['overview', 'Overview', 'overview.read'], ['contact', 'Contact queue', 'contact.read'],
    ['accounts', 'Accounts', Object.freeze(['accounts.read', 'applications.read', 'counterparties.read'])], ['applications', 'Applications', 'applications.read'], ['companies', 'Companies', 'companies.read'],
    ['offers', 'Offers', 'offers.read'], ['rfqs', 'Buyer requests', 'rfqs.read'],
    ['proposals', 'Partner opportunities', 'proposals.read'], ['opportunities', 'Anonymous releases', 'opportunities.read'],
    ['projects', 'Projects', 'projects.read'], ['commissions', 'Commissions', 'commissions.read'],
    ['audit', 'Activity log', 'audit.read'], ['team', 'Team and access', 'staff.read'],
    ['risk', 'Controlled approvals', 'commissions.create'], ['categories', 'Categories', 'taxonomy.read'],
  ].map(Object.freeze));
  function workspaceNavigation({ navigation, user, role } = {}) {
    if (!navigation || !user) return;
    const links = [create('a', { href: '/portal/', text: 'Overview', 'aria-current': role === 'home' ? 'page' : null })];
    const roles = Array.isArray(user.roles) ? user.roles : [];
    for (const value of ['buyer', 'supplier', 'partner']) if (roles.includes(value)) links.push(create('a', {
      href: `/portal/${value}/`, text: value === 'partner' ? 'B2B Partner' : value[0].toUpperCase() + value.slice(1),
      'aria-current': role === value ? 'page' : null,
    }));
    if (user.staff === true) links.push(create('a', { href: '/portal/admin/', text: 'Command Center', 'aria-current': role === 'admin' ? 'page' : null }));
    navigation.replaceChildren(...links);
    navigation.hidden = false;
  }
  function managementNavigation({ access, selected = 'overview' } = {}) {
    const navigation = create('nav', { class: 'portal-navigation', 'aria-label': 'Command Center modules' });
    const allowed = permission => Array.isArray(permission) ? permission.every(allowed) : access?.owner === true || access?.permissions?.includes(permission) === true;
    for (const [key, label, permission] of managementModules) if (allowed(permission)) navigation.append(create('a', {
      href: key === 'offers' ? '/portal/offers/' : `/portal/admin/${key === 'overview' ? '' : `?module=${key}`}`,
      text: label, 'aria-current': selected === key ? 'page' : null, 'data-command-module': key,
    }));
    if (access?.owner === true) navigation.append(create('a', { href: '/portal/admin/?module=vault', text: 'OWNER VAULT', 'aria-current': selected === 'vault' ? 'page' : null, 'data-command-module': 'vault' }));
    return navigation;
  }
  function mountShell({ navigation, role = 'home' } = {}) {
    const main = document.querySelector('#main');
    if (!main || document.querySelector('.dashboard-layout')) return;
    document.body.classList.add('dashboard-enabled');
    const layout = create('div', { class: 'dashboard-layout' });
    sidebar = create('aside', { class: 'dashboard-sidebar', 'aria-label': 'Workspace navigation' });
    sidebar.append(create('div', { class: 'dashboard-sidebar-title' }, [create('span', { class: 'dashboard-eyebrow', text: 'SHADOWBRIDGE' }), create('p', { text: role === 'admin' || role === 'offers' ? 'Command Center' : 'Private workspace' })]));
    if (navigation) { navigation.classList.add('dashboard-primary-nav'); sidebar.append(navigation); }
    moduleSlot = create('div', { class: 'dashboard-module-slot' }); sidebar.append(moduleSlot);
    sidebar.append(create('div', { class: 'dashboard-sidebar-note' }, [create('span', { class: 'dashboard-security-mark', 'aria-hidden': true, text: '◈' }), create('p', { text: 'Controlled introductions. Protected counterparties.' }), create('a', { href: '/', text: 'Public website' })]));
    main.before(layout); layout.append(sidebar, main);
  }
  function placeModules(navigation) {
    if (!navigation || !moduleSlot) return;
    navigation.classList.add('dashboard-module-nav');
    moduleSlot.replaceChildren(create('p', { class: 'dashboard-nav-heading', text: 'Operations' }), navigation);
  }
  function clearPrivate() {
    moduleSlot?.replaceChildren();
    if (sidebar) for (const node of sidebar.querySelectorAll('[data-dashboard-private]')) node.remove();
  }
  window.ShadowDashboard = Object.freeze({ create, metric, statusDistribution, activity, alert, actions, sectionHeader, statusBadge, managementModules, workspaceNavigation, managementNavigation, mountShell, placeModules, clearPrivate });
})();
