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
  window.ShadowDashboard = Object.freeze({ create, metric, statusDistribution, activity, alert, actions, sectionHeader, statusBadge, mountShell, placeModules, clearPrivate });
})();
