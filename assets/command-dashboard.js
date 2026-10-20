/* Presentation only: authorized Overview DTOs remain the sole data source.
   No additional records, identities or browser storage are requested here. */
(() => {
  'use strict';

  const metrics = [
    { key: 'pendingApplications', label: 'Company applications awaiting review', queue: 'Company applications', module: 'applications', permission: 'applications.read' },
    { key: 'submittedOffers', label: 'New supplier offers', queue: 'Supplier offers', module: 'offers', permission: 'offers.read' },
    { key: 'submittedRfqs', label: 'New buyer requests', queue: 'Buyer requests', module: 'rfqs', permission: 'rfqs.read' },
    { key: 'activeProjects', label: 'Active cooperation projects', module: 'projects', permission: 'projects.read' },
    { key: 'pendingProposals', label: 'Partner opportunities awaiting review', queue: 'Partner opportunities', module: 'proposals', permission: 'proposals.read' },
    { key: 'openContactEnquiries', label: 'Contact enquiries awaiting attention', queue: 'Contact enquiries', module: 'contact', permission: 'contact.read' },
    { key: 'pendingRiskApprovals', label: 'Controlled decisions awaiting approval', queue: 'Controlled decisions', module: 'risk', permission: null },
  ];
  const moduleHref = module => module === 'offers' ? '/portal/offers/' : `/portal/admin/?module=${module}`;
  const count = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const title = value => String(value || 'Recorded action').replaceAll('_', ' ').replaceAll('.', ' · ');

  function render({ host, activityHost, overview, access = {} }) {
    const ui = window.ShadowDashboard;
    if (!ui || !host) throw new Error('The shared dashboard interface is unavailable.');
    host.querySelector('[data-command-dashboard]')?.remove();
    activityHost?.querySelector('[data-command-activity]')?.remove();
    const can = permission => access.owner === true || access.permissions?.includes(permission) === true;
    const frame = ui.create('div', { class: 'dashboard-stack', 'data-command-dashboard': '', 'data-dashboard-context': access.owner ? 'owner' : 'staff' });
    host.append(frame);
    if (!overview || !overview.counts || typeof overview.counts !== 'object' || Array.isArray(overview.counts)) {
      frame.append(ui.alert({ title: 'Monitoring data unavailable', message: 'The service did not return a valid operational summary. Missing values have not been converted to zero.', tone: 'error' }));
      return frame;
    }

    const cards = ui.create('div', { class: 'dashboard-grid', 'aria-label': 'Operational summary' });
    const queues = [];
    const actions = [];
    let invalidValues = false;
    for (const metric of metrics) {
      if (metric.permission && !can(metric.permission) || !Object.hasOwn(overview.counts, metric.key)) continue;
      const value = count(overview.counts[metric.key]);
      if (value === null) { invalidValues = true; continue; }
      const canOpen = metric.module === 'risk' ? access.owner === true || can('commissions.create') : can(metric.permission);
      cards.append(ui.metric({
        label: metric.label, value,
        detail: metric.key === 'activeProjects' ? 'Assigned, active or on hold. Cooperation projects, not settled transactions.' : 'Current server aggregate within your authorized scope.',
        href: canOpen ? moduleHref(metric.module) : undefined, linkLabel: 'Open module',
      }));
      if (metric.queue) queues.push({ label: metric.queue, value, status: value ? 'submitted' : 'closed' });
      if (canOpen && value > 0) actions.push({ label: metric.key === 'activeProjects' ? 'Open active cooperation' : `Review ${metric.queue.toLowerCase()}`, href: moduleHref(metric.module), detail: `${value} ${value === 1 ? 'record' : 'records'} in this authorized queue.` });
    }
    if (cards.children.length) frame.append(cards);
    else frame.append(ui.alert({ title: 'Limited operational view', message: 'No operational counters were returned for your current permissions. This does not represent a zero balance for the company.' }));
    if (invalidValues) frame.append(ui.alert({ title: 'Some counters are unavailable', message: 'Unreadable values were omitted rather than shown as zero. Open the authorized module to check its current records.', tone: 'warning' }));

    const working = ui.create('div', { class: 'dashboard-split' });
    working.append(ui.statusDistribution({
      title: 'Pending work by queue', description: 'Current authorized counts. Queues contain different record types; this is not a sales funnel or a unique company total.',
      items: queues, emptyText: 'No pending work is reported in the queues available to you.',
    }));
    working.append(ui.actions({
      title: 'Operational next actions', description: 'Open an existing module to act within your permissions. These suggestions do not create or assign tasks.',
      items: actions,
    }));
    frame.append(working);

    for (const warning of Array.isArray(overview.warnings) ? overview.warnings : []) {
      if (typeof warning === 'string' && warning.trim()) frame.append(ui.alert({ title: 'Attention required', message: warning, tone: 'warning' }));
    }
    const integration = ui.create('section', { class: 'dashboard-card dashboard-integration', 'aria-label': 'Monitoring integrations' }, [
      ui.sectionHeader({ title: 'Monitoring scope', description: 'The current MVP supports review queues and cooperation records. Other signals are not connected.', level: 3 }),
      ui.create('ul', { class: 'dashboard-availability' }, [
        ui.create('li', { text: 'Active company total — not available in this view.' }),
        ui.create('li', { text: 'Historical trends and online status — no monitoring data is available.' }),
        ui.create('li', { text: 'Assigned tasks, logistics and settlement — not active modules.' }),
      ]),
    ]);
    frame.append(integration);

    if (activityHost) {
      const events = can('audit.read') && Array.isArray(overview.recentActivity) ? overview.recentActivity.slice(0, 12) : [];
      const activity = ui.create('div', { 'data-command-activity': '' }, [ui.activity({
        title: 'Recorded decisions', description: 'Up to 12 recent events supplied by the service within your audit permissions. This is not online presence or a complete history.',
        items: events.filter(item => item && typeof item === 'object').map(item => ({ title: title(item.action), detail: item.resourceType || 'Authorized action', at: item.createdAt })),
        emptyText: can('audit.read') ? 'No recent activity was returned for this view.' : 'Activity records are not available with your current permissions.',
      })]);
      activityHost.append(activity);
    }
    return frame;
  }

  window.ShadowCommandDashboard = Object.freeze({ render });
})();
