const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const { default: AxeBuilder } = loadTestDependency('@axe-core/playwright');
const { dashboardFixture } = require('./dashboard-fixture.cjs');
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

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
