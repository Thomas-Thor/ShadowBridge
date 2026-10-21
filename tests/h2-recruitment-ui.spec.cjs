// Presentation regression only: clearly fictional DTOs, no Auth/PostgreSQL,
// authorization enforcement, persistence, real email or registry verification.
const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const { default: AxeBuilder } = loadTestDependency('@axe-core/playwright');
const { dashboardFixture } = require('./dashboard-fixture.cjs');
const stamp = '2026-10-21T09:00:00.000Z';
const stages = ['email_pending', 'application_missing', 'pending_review', 'approved', 'rejected', 'suspended'];
const accountRecords = Array.from({ length: 14 }, (_, index) => {
  const stage = stages[index] || 'pending_review';
  const hasApplication = !['email_pending', 'application_missing'].includes(stage);
  return { userId: `FICTIONAL-ACCOUNT-${index}`, email: `fictional.account${index}@recruitment.shadowbridge.invalid`,
    status: stage === 'suspended' ? 'suspended' : 'active', emailVerified: stage !== 'email_pending',
    emailVerifiedAt: stage === 'email_pending' ? null : stamp, createdAt: stamp,
    applicationId: hasApplication ? `FICTIONAL-APPLICATION-${index}` : null,
    applicationStatus: hasApplication ? ({ approved: 'approved', rejected: 'rejected' }[stage] || 'pending') : null,
    role: hasApplication ? 'buyer' : null, companyId: hasApplication ? `FICTIONAL-COMPANY-${index}` : null,
    companyName: hasApplication ? `FICTIONAL COMPANY ${index}` : null,
    reviewedAt: ['approved', 'rejected'].includes(stage) ? stamp : null,
    decisionReason: stage === 'rejected' ? 'FICTIONAL historical rejection must remain available.' : null,
    stage };
});
const applicationRecords = ['pending', 'approved', 'rejected'].map((status, index) => ({
  id: `FICTIONAL-APPLICATION-${index}`, userId: `FICTIONAL-APPLICANT-${index}`, companyId: `FICTIONAL-APPLICANT-COMPANY-${index}`,
  email: `fictional.${status}@recruitment.shadowbridge.invalid`, role: ['buyer', 'supplier', 'partner'][index], status,
  company: { name: `FICTIONAL ${status.toUpperCase()} APPLICANT`, country: 'NO', registrationNumber: 'FICTIONAL-ONLY-NOT-VERIFIED' },
  profile: { countries: ['NO', 'PL'], sectors: ['FICTIONAL industrial sector', 'FICTIONAL hospitality sector'],
    summary: `FICTIONAL ${status} full business scope.\n${'Complete fictional profile context. '.repeat(28)}END-OF-FULL-${status.toUpperCase()}-PROFILE` },
  createdAt: stamp, reviewedAt: status === 'pending' ? null : stamp,
  reviewedBy: status === 'pending' ? null : 'FICTIONAL-REVIEWER',
  decisionReason: status === 'rejected' ? 'FICTIONAL historical rejection reason: representation evidence was insufficient.' : status === 'approved' ? 'FICTIONAL manually reviewed application.' : null,
  accountStatus: 'active', emailVerified: true,
}));
async function recruitmentFixture(page) {
  const state = await dashboardFixture(page, { staffRole: 'owner' });
  state.recruitmentCalls = [];
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    if (/^\/api\/admin\/applications\/[^/]+\/history$/.test(url.pathname)) {
      state.recruitmentCalls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ decision: 'rejected', reason: 'FICTIONAL EARLIER REVIEW retained in append-only history.', actorId: 'FICTIONAL-PRIOR-REVIEWER', createdAt: stamp, source: 'recorded' }], page: 1, limit: 12, pages: 1, total: 1 }) });
    }
    if (!['/api/admin/accounts', '/api/admin/applications'].includes(url.pathname)) return route.fallback();
    state.recruitmentCalls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const accounts = url.pathname.endsWith('/accounts');
    const query = url.searchParams.get('q') || '', filter = url.searchParams.get(accounts ? 'stage' : 'status') || '';
    const source = accounts ? accountRecords : applicationRecords;
    const matching = source.filter(item => (!filter || filter === 'all' || (accounts ? item.stage : item.status) === filter)
      && (!query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())));
    const limit = Number(url.searchParams.get('limit') || 12), pageNumber = Number(url.searchParams.get('page') || 1);
    const counts = Object.fromEntries(stages.map(stage => [stage, accountRecords.filter(item => item.stage === stage).length]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      items: matching.slice((pageNumber - 1) * limit, pageNumber * limit),
      page: pageNumber, limit, pages: Math.ceil(matching.length / limit), total: matching.length,
      ...(accounts ? { counts } : {}),
    }) });
  });
  return state;
}
const rows = (page, kind) => page.locator(`[data-recruitment-record="${kind}"]`);
async function responsive(page) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
}

test('H2-C presentation: Accounts distinguishes stages, filters and paginates server-provided records', async ({ page }) => {
  const state = await recruitmentFixture(page);
  await page.goto('/portal/admin/?module=accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await expect(page.locator('[data-command-module="accounts"]')).toHaveAttribute('aria-current', 'page');
  await expect(rows(page, 'account')).toHaveCount(12);
  await expect(rows(page, 'account').first()).toContainText(accountRecords[0].email);
  const pagination = page.getByRole('navigation', { name: 'Accounts pages', exact: true });
  await pagination.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(rows(page, 'account')).toHaveCount(2);
  await expect(rows(page, 'account').first()).toContainText(accountRecords[12].email);
  expect(state.recruitmentCalls.at(-1).query.page).toBe('2');
  const filters = page.getByRole('form', { name: 'Account filters', exact: true });
  await filters.getByRole('combobox', { name: 'Account stage', exact: true }).selectOption('email_pending');
  await filters.getByRole('button', { name: 'Filter accounts', exact: true }).click();
  await expect(rows(page, 'account')).toHaveCount(1);
  await expect(rows(page, 'account').first()).toContainText(accountRecords[0].email);
  expect(state.recruitmentCalls.at(-1).query.stage).toBe('email_pending');
  expect(state.recruitmentCalls.at(-1).query.page).toBe('1');
  await filters.getByRole('combobox', { name: 'Account stage', exact: true }).selectOption('');
  await filters.getByLabel('Search accounts', { exact: true }).fill(accountRecords[4].email);
  await filters.getByRole('button', { name: 'Filter accounts', exact: true }).click();
  await expect(rows(page, 'account')).toHaveCount(1);
  await expect(rows(page, 'account').first()).toContainText(accountRecords[4].decisionReason);
  expect(state.recruitmentCalls.at(-1).query.q).toBe(accountRecords[4].email);
  await responsive(page);
});

test('H2-C presentation: Applications displays full profile and retained rejection history accessibly', async ({ page }) => {
  const state = await recruitmentFixture(page);
  await page.goto('/portal/admin/?module=applications');
  await expect(page.getByRole('heading', { name: 'Company applications', exact: true })).toBeVisible();
  const filters = page.getByRole('form', { name: 'Application filters', exact: true });
  await filters.getByRole('combobox', { name: 'Application status', exact: true }).selectOption('rejected');
  await filters.getByRole('button', { name: 'Filter applications', exact: true }).click();
  await expect(rows(page, 'application')).toHaveCount(1);
  const record = rows(page, 'application').first();
  await expect(record).toContainText(applicationRecords[2].company.name);
  await expect(record).toContainText('END-OF-FULL-REJECTED-PROFILE');
  await expect(record).toContainText('FICTIONAL industrial sector');
  await expect(record).toContainText('FICTIONAL hospitality sector');
  await expect(record.getByText('NO, PL', { exact: true })).toBeVisible();
  await expect(record).toContainText(applicationRecords[2].decisionReason);
  await expect(record.getByRole('button', { name: 'Record application decision', exact: true })).toHaveCount(0);
  expect(state.recruitmentCalls.at(-1).query.status).toBe('rejected');
  await filters.getByLabel('Search applications', { exact: true }).fill(applicationRecords[2].email);
  const searchResults = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/admin/applications' && url.searchParams.get('q') === applicationRecords[2].email; });
  await filters.getByRole('button', { name: 'Filter applications', exact: true }).click();
  await searchResults;
  await expect(rows(page, 'application')).toHaveCount(1);
  expect(state.recruitmentCalls.at(-1).query.q).toBe(applicationRecords[2].email);
  expect(state.recruitmentCalls.some(call => call.path.endsWith('/history'))).toBe(false);
  await record.getByRole('button', { name: 'Load decision history', exact: true }).click();
  await expect(record.getByRole('region', { name: 'Application decision history', exact: true })).toContainText('FICTIONAL EARLIER REVIEW retained in append-only history.');
  expect(state.recruitmentCalls.at(-1).path).toMatch(/\/history$/);
  await responsive(page);
  const accessibility = await new AxeBuilder({ page }).include('.dashboard-layout').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.map(item => ({ id: item.id, impact: item.impact }))).toEqual([]);
});

test('H2-C presentation: changed session removes Accounts records and private module navigation', async ({ page }) => {
  const state = await recruitmentFixture(page);
  await page.goto('/portal/admin/?module=accounts');
  await expect(rows(page, 'account')).toHaveCount(12);
  state.user = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
  await expect(rows(page, 'account')).toHaveCount(0);
  await expect(page.locator('.dashboard-module-slot')).toBeEmpty();
  await expect(page.locator('#portal-account')).toBeEmpty();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

// This checks presentation gates only; real API/RLS authorization is tested by
// the separate integration runner against PostgreSQL and GoTrue.
test('H2-C presentation: Accounts requires all three reviewer permissions before requesting records', async ({ page }) => {
  const state = await recruitmentFixture(page);
  await page.route('**/api/staff/access', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    owner: false, roles: ['staff_analyst'], permissions: ['accounts.read', 'counterparties.read'],
    roleCatalog: [], permissionCatalog: [],
  }) }));
  await page.goto('/portal/admin/?module=accounts');
  await expect(page.locator('#portal-status')).toContainText('Module unavailable.');
  await expect(page.locator('[data-command-module="accounts"]')).toHaveCount(0);
  await expect(rows(page, 'account')).toHaveCount(0);
  expect(state.recruitmentCalls.some(call => call.path === '/api/admin/accounts')).toBe(false);
});
