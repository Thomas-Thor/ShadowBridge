// Clearly fictional presentation DTOs only. These tests do NOT verify real Auth,
// authorization, database isolation, persistence or email delivery.
const categoryId = '10000000-0000-4000-8000-000000000001';
const subcategoryId = '10000000-0000-4000-8000-000000000101';
const stamp = '2026-10-20T09:00:00.000Z';
const rootPermissions = ['overview.read', 'applications.read', 'companies.read', 'offers.read', 'rfqs.read', 'proposals.read', 'opportunities.read', 'projects.read', 'commissions.read', 'audit.read', 'staff.read', 'commissions.create', 'taxonomy.read', 'contact.read'];
function record(id, status, data) { return { id, status, data: { categoryId, subcategoryId, ...data }, createdAt: stamp, updatedAt: stamp }; }
async function dashboardFixture(page, { role = 'buyer', staffRole = null, aal = 'aal2', status = 'approved', enabled = true, empty = false, failures = [] } = {}) {
  const user = { id: '00000000-0000-4000-8000-00000000f001', email: `fictional.${staffRole || role}@dashboard.shadowbridge.invalid`,
    emailVerified: true, status: 'active', applicationStatus: status, roles: staffRole ? [] : [role], staff: Boolean(staffRole), aal,
    recoveryOnly: false, company: { name: 'FICTIONAL DASHBOARD OWN COMPANY', country: 'NO', registrationNumber: 'FICTIONAL-UI-ONLY' } };
  const state = { user, enabled, calls: [], failures: new Set(failures),
    offers: empty ? [] : [record('SB-OF-FICTIONAL-001', 'draft', { productName: 'FICTIONAL polymer granules', quantity: 25, price: 125, currency: 'PLN' }), record('SB-OF-FICTIONAL-002', 'clarification_requested', { productName: 'FICTIONAL packaging material' }), record('SB-OF-FICTIONAL-003', 'approved', { productName: 'FICTIONAL warehouse equipment' })],
    rfqs: empty ? [] : [record('SB-RF-FICTIONAL-001', 'draft', { product: 'FICTIONAL purchase requirement', quantity: 5, currency: 'PLN' }), record('SB-RF-FICTIONAL-002', 'accepted', { product: 'FICTIONAL screened requirement' })],
    proposals: empty ? [] : [record('SB-PR-FICTIONAL-001', 'submitted', { title: 'FICTIONAL cooperation proposal' })],
    projects: empty ? [] : [{ id: 'SB-PJ-FICTIONAL-001', title: 'FICTIONAL assigned project', status: 'active', summary: 'FICTIONAL approved cooperation scope only.', createdAt: stamp }],
    commissions: empty ? [] : [{ projectId: 'SB-PJ-FICTIONAL-001', amount: '100.00', currency: 'EUR', agreementReference: 'FICTIONAL-AGREEMENT', status: 'agreed', createdAt: stamp }, { projectId: 'SB-PJ-FICTIONAL-001', amount: '250.00', currency: 'PLN', agreementReference: 'FICTIONAL-PLN', status: 'agreed', createdAt: stamp }, { projectId: 'SB-PJ-FICTIONAL-001', amount: null, currency: 'NOK', agreementReference: 'FICTIONAL-NOT-SET', status: 'under_agreement', createdAt: stamp }],
    opportunities: empty ? [] : [record('SB-OP-FICTIONAL-001', 'approved', { title: 'FICTIONAL anonymous opportunity', specification: 'FICTIONAL reviewed non-identifying commercial information.', quantity: 10, currency: 'EUR' })],
  };
  const permissions = staffRole === 'staff_analyst' ? ['overview.read'] : staffRole === 'operations_manager'
    ? ['overview.read', 'companies.read', 'offers.read', 'rfqs.read', 'proposals.read', 'opportunities.read', 'projects.read', 'commissions.read', 'contact.read', 'staff.read', 'audit.read'] : rootPermissions;
  const csrfToken = 'fictional-presentation-csrf-not-a-real-credential';
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    state.calls.push({ path: url.pathname, method });
    const send = (data, statusCode = 200) => route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(data) });
    if (state.failures.has(url.pathname)) return send({ error: 'FICTIONAL test service is unavailable.' }, 503);
    if (url.pathname === '/api/config') return send({ backendEnabled: state.enabled, environment: 'local', csrfToken });
    if (url.pathname === '/api/session') return send({ user: state.user, csrfToken });
    if (url.pathname === '/api/catalog') return send({ categories: [{ id: categoryId, key: 'industrial-supplies', label: 'Industrial supplies', parentId: null, active: true }, { id: subcategoryId, key: 'materials', label: 'Materials', parentId: categoryId, active: true }], currencies: ['EUR', 'USD', 'GBP', 'NOK', 'PLN'].map(code => ({ code, label: code })) });
    if (url.pathname === '/api/staff/access') return send({ owner: staffRole === 'owner', roles: [staffRole], permissions, limits: { commissionAmount: 100, currency: 'EUR' }, roleCatalog: [], permissionCatalog: [] });
    if (url.pathname === '/api/staff/overview') {
      const counts = staffRole === 'staff_analyst' ? { pendingRiskApprovals: 0 } : staffRole === 'operations_manager'
        ? { submittedOffers: 3, submittedRfqs: 2, activeProjects: 4, pendingProposals: 1, openContactEnquiries: 2, pendingRiskApprovals: 0 }
        : { pendingApplications: 5, submittedOffers: 3, submittedRfqs: 2, activeProjects: 4, pendingProposals: 1, openContactEnquiries: 2, pendingRiskApprovals: 1 };
      return send(state.overview || { counts, recentActivity: permissions.includes('audit.read') ? [{ action: 'FICTIONAL offer reviewed', resourceType: 'offers', createdAt: stamp }] : [], warnings: [] });
    }
    if (url.pathname === '/api/auth/factors') return send({ factors: [{ id: 'FICTIONAL-FACTOR', status: 'verified', factor_type: 'totp' }] });
    if (url.pathname === '/api/auth/logout') { state.user = null; return send({ signedOut: true, csrfToken }); }
    if (url.pathname === '/api/profile') return send({ profile: { countries: ['NO'], sectors: ['Industrial supplies'], summary: 'FICTIONAL presentation profile.' } });
    if (url.pathname === '/api/opportunities') return send({ items: state.opportunities, page: 1, limit: 12, pages: state.opportunities.length ? 1 : 0, total: state.opportunities.length, categoryCounts: [{ categoryId, count: state.opportunities.length }] });
    for (const kind of ['offers', 'rfqs', 'proposals', 'projects', 'commissions']) {
      if (url.pathname === `/api/${kind}`) {
        if (method === 'GET') return send({ items: state[kind] });
        if (method === 'POST' && ['offers', 'rfqs', 'proposals'].includes(kind)) {
          const input = request.postDataJSON();
          const item = record(`SB-${kind.toUpperCase()}-FICTIONAL-NEW`, 'draft', input.data);
          state[kind].push(item); return send({ item }, 201);
        }
      }
    }
    if (url.pathname.startsWith('/api/admin/')) return send({ items: [] });
    if (url.pathname.startsWith('/api/messages')) return send({ items: [] });
    return send({ error: 'FICTIONAL UI fixture does not implement this endpoint.' }, 404);
  });
  return state;
}
module.exports = { dashboardFixture, categoryId, subcategoryId };
