// Presentation-only checks. The restricted static transport has no API.
const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const AxeBuilder = loadTestDependency('@axe-core/playwright').default;

test('private entry artwork remains beside desktop sign-in and follows the form on phones', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/member-sign-in/');
    const figure = page.locator('figure.member-threshold');
    await expect(figure).toBeVisible();
    for (const asset of ['member-entry-gate.svg', 'member-entry-seal.svg']) {
      const graphic = figure.locator(`img[src$="${asset}"]`);
      await expect(graphic).toBeVisible();
      expect(await graphic.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`).toBe(true);
    const panel = await page.locator('.entry-panel').boundingBox();
    const artwork = await figure.boundingBox();
    if (width === 1440) expect(artwork.x >= panel.x + panel.width, 'desktop art stays beside the form').toBe(true);
    else expect(artwork.y >= panel.y + panel.height, 'mobile art follows the complete sign-in panel').toBe(true);
    const accessibility = await new AxeBuilder({ page }).include('.entry-content').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.map(item => ({ id: item.id, impact: item.impact }))).toEqual([]);
    if ([1440, 390].includes(width)) await page.screenshot({ path: `/tmp/shadowbridge-member-entry-${width}.png`, fullPage: true });
  }
  await expect(page.locator('link[href="../assets/member-entry.css"]')).toBeAttached();
  for (const asset of ['member-entry.css', 'member-entry-gate.svg', 'member-entry-seal.svg']) expect((await request.get(`/assets/${asset}`)).status()).toBe(200);
  expect(errors).toEqual([]);
});

test('one unchanged account system fails closed without API and preserves recovery, applications and C.A.R.T.E.L.', async ({ page }) => {
  await page.goto('/member-sign-in/');
  const contracts = [
    ['#sign-in-form', 'login', '/api/auth/login'],
    ['#password-form', 'password', '/api/auth/password'],
    ['form[data-account-form="recover"]', 'recover', '/api/auth/recover'],
  ];
  await expect(page.locator('[data-account-form]')).toHaveCount(3);
  for (const [selector, kind, action] of contracts) {
    const form = page.locator(selector);
    await expect(form).toHaveAttribute('data-account-form', kind);
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form).toHaveAttribute('action', action);
    // Playwright's control-state matcher does not classify fieldset itself as
    // a disabled control; assert its native attribute and the submit control.
    await expect(form.locator('fieldset')).toHaveAttribute('disabled', '');
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
  }
  await expect(page.locator('#sign-in-form [name="email"]')).toHaveAttribute('autocomplete', 'username');
  await expect(page.locator('#sign-in-form [name="password"]')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#sign-in-status')).toContainText('Secure sign in is unavailable.');
  expect(await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => script.getAttribute('src')))).toEqual(['../assets/account.js']);
  await page.locator('#account-recovery summary').click();
  await expect(page.getByRole('button', { name: 'Send recovery email', exact: true })).toBeVisible();
  for (const role of ['buyer', 'supplier', 'partner']) await expect(page.locator(`.entry-aside a[href="../apply/${role}/"]`)).toBeVisible();
  await expect(page.locator('a[href="../legal/"]')).toBeVisible();
  await expect(page.locator('.entry-cartel-network')).toHaveAttribute('href', '../cartel/');
  await expect(page.locator('.entry-cartel-network img')).toHaveAttribute('src', '../assets/cartel-eye.png');
  await expect(page.getByRole('heading', { name: 'Access is individually approved.', exact: true })).toBeVisible();
  await page.goto('/member-sign-in/?recovery=1');
  await expect(page.locator('#sign-in-form')).toBeHidden();
  await expect(page.locator('#password-form')).toBeVisible();
  await expect(page.locator('#password-form button[type="submit"]')).toBeDisabled();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
