const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const { default: AxeBuilder } = loadTestDependency('@axe-core/playwright');
const { dashboardFixture } = require('./dashboard-fixture.cjs');
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const metricValue = (scope, key) => scope.locator(`[data-dashboard-kpi="${key}"] .dashboard-kpi-value`);
async function responsive(page) {
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 950 }); await noOverflow(page); }
}

test('C shell: responsive navigation, existing form and keyboard remain usable', async ({ page }) => {
  const state = await dashboardFixture(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/portal/buyer/');
  await expect(page.locator('#portal-status')).toContainText('Approved account.');
  await expect(page.locator('.dashboard-layout')).toBeVisible();
  await expect(page.locator('.dashboard-sidebar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New purchase request', exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await noOverflow(page);
    const link = page.locator('#portal-navigation a[href="/portal/buyer/"]');
    await link.focus(); await expect(link).toBeFocused();
    await expect(link).toHaveAttribute('aria-current', 'page');
  }
  expect(state.calls.filter(call => call.path.startsWith('/api/staff/') || call.path.startsWith('/api/admin/') || call.path === '/api/offers')).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).include('.dashboard-layout').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.map(item => ({ id: item.id, impact: item.impact }))).toEqual([]);
});

test('C shell: unavailable, pending and MFA gates never load private dashboards', async ({ browser }) => {
  for (const spec of [{ enabled: false, route: 'buyer', message: 'Private service unavailable.' }, { status: 'pending', route: 'buyer', message: 'Application under review.' }, { staffRole: 'owner', aal: 'aal1', route: 'admin', message: 'Second factor required.' }]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const state = await dashboardFixture(page, spec);
      await page.goto(`/portal/${spec.route}/`);
      await expect(page.locator('#portal-status')).toContainText(spec.message);
      await expect(page.locator('#portal-content .portal-record, #portal-content .portal-metric')).toHaveCount(0);
      expect(state.calls.some(call => ['/api/offers', '/api/rfqs', '/api/projects', '/api/commissions', '/api/staff/overview'].includes(call.path))).toBe(false);
      await noOverflow(page);
    } finally { await context.close(); }
  }
});

test('C shell: a changed session clears moved module navigation and all private content', async ({ page }) => {
  const state = await dashboardFixture(page, { staffRole: 'owner' });
  await page.goto('/portal/admin/');
  await expect(page.getByRole('heading', { name: 'Owner Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Command Center modules', exact: true })).toBeVisible();
  state.user = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
  await expect(page.locator('#portal-content .portal-section')).toHaveCount(0);
  await expect(page.locator('.dashboard-sidebar nav[aria-label="Command Center modules"] a')).toHaveCount(0);
  await expect(page.locator('#portal-account')).toBeEmpty();
});

test('C shell: static UI transport rejects backend, secrets and repository files', async ({ request }) => {
  for (const path of ['/api/session', '/.local/development.env', '/server/app.mjs', '/docs/dashboard-system.md', '/package.json']) expect((await request.get(path)).status()).toBe(404);
});

test('D member: Buyer summary follows existing RFQ saves and only authorized source lists', async ({ page }) => {
  const state = await dashboardFixture(page);
  await page.goto('/portal/buyer/');
  const summary = page.locator('[data-member-dashboard="buyer"]');
  await expect(summary.getByRole('heading', { name: 'Buyer overview', exact: true })).toBeVisible();
  await expect(metricValue(summary, 'rfqs-loaded')).toHaveText('2');
  await expect(metricValue(summary, 'drafts')).toHaveText('1');
  await expect(metricValue(summary, 'assigned-opportunities')).toHaveText('1');
  await expect(summary).toContainText('Loaded records only');
  await expect(summary.getByRole('link', { name: /^Complete your draft RFQs\b/ })).toHaveAttribute('href', '#workspace-records');
  const create = page.locator('section').filter({ has: page.getByRole('heading', { name: 'New purchase request', exact: true }) });
  await create.locator('[name=categoryId]').selectOption('10000000-0000-4000-8000-000000000001');
  await create.locator('[name=product]').fill('FICTIONAL newly drafted requirement');
  await create.getByRole('button', { name: 'Save private draft', exact: true }).click();
  await expect(metricValue(summary, 'rfqs-loaded')).toHaveText('3');
  await expect(metricValue(summary, 'drafts')).toHaveText('2');
  expect(state.rfqs).toHaveLength(3);
  expect(state.calls.some(call => call.path === '/api/offers' || call.path.startsWith('/api/admin/') || call.path.startsWith('/api/staff/'))).toBe(false);
  await expect(page.locator('body')).not.toContainText('FICTIONAL polymer granules');
  await responsive(page);
});

test('D member: Supplier review and clarification are visible without invented performance', async ({ page }) => {
  const state = await dashboardFixture(page, { role: 'supplier' });
  await page.goto('/portal/supplier/');
  const summary = page.locator('[data-member-dashboard="supplier"]');
  await expect(summary.getByRole('heading', { name: 'Supplier overview', exact: true })).toBeVisible();
  await expect(metricValue(summary, 'offers-loaded')).toHaveText('3');
  await expect(metricValue(summary, 'clarifications')).toHaveText('1');
  await expect(metricValue(summary, 'approved')).toHaveText('1');
  await expect(summary.getByRole('link', { name: /^Respond to clarification requests\b/ })).toHaveAttribute('href', '#workspace-records');
  await expect(summary.getByRole('heading', { name: 'Offer review status', exact: true })).toBeVisible();
  await expect(summary.locator('meter')).toHaveCount(3);
  await expect(summary).toContainText('no unread-message total');
  expect(state.calls.some(call => call.path === '/api/rfqs' || call.path.startsWith('/api/admin/') || call.path.startsWith('/api/staff/'))).toBe(false);
  await responsive(page);
});

test('D member: Partner separates source currencies and excludes unspecified amounts', async ({ page }) => {
  const state = await dashboardFixture(page, { role: 'partner' });
  state.commissions[2].status = 'agreed'; // Null is a missing amount, not zero.
  await page.goto('/portal/partner/');
  const summary = page.locator('[data-member-dashboard="partner"]');
  await expect(summary.getByRole('heading', { name: 'Partner overview', exact: true })).toBeVisible();
  await expect(metricValue(summary, 'projects-loaded')).toHaveText('1');
  await expect(metricValue(summary, 'open-projects')).toHaveText('1');
  await expect(metricValue(summary, 'commission-records')).toHaveText('3');
  await expect(summary.locator('[data-dashboard-currency="EUR"]')).toContainText('100.00');
  await expect(summary.locator('[data-dashboard-currency="PLN"]')).toContainText('250.00');
  await expect(summary.locator('[data-dashboard-currency="NOK"]')).toHaveCount(0);
  await expect(summary).toContainText('1 record(s) have no usable amount');
  await expect(summary).toContainText('No conversion or payment confirmation');
  await expect(summary).toContainText('performance metrics are not connected');
  await expect(summary).not.toContainText('350.00');
  expect(state.calls.some(call => call.path === '/api/offers' || call.path === '/api/rfqs' || call.path.startsWith('/api/admin/') || call.path.startsWith('/api/staff/'))).toBe(false);
  await responsive(page);
});

test('D member: empty and unavailable snapshots remain distinct and clear after account change', async ({ browser }) => {
  for (const failed of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 950 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const state = await dashboardFixture(page, { empty: true, failures: failed ? ['/api/rfqs'] : [] });
      await page.goto('/portal/buyer/');
      const summary = page.locator('[data-member-dashboard="buyer"]');
      await expect(metricValue(summary, 'rfqs-loaded')).toHaveText(failed ? '—' : '0');
      if (failed) await expect(summary).toContainText('Unavailable. Reload this workspace to retry.');
      else await expect(summary).toContainText('No records in the loaded snapshot yet.');
      await noOverflow(page);
      state.user = null;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
      await expect(page.locator('[data-member-dashboard]')).toHaveCount(0);
    } finally { await context.close(); }
  }
});
