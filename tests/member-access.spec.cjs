const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const AxeBuilder = loadTestDependency('@axe-core/playwright').default;

test('homepage Member Access remains reachable with the existing navigation at desktop/mobile widths', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 1200, 1024, 1001, 1000, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const member = page.getByRole('link', { name: 'Member Access', exact: true });
    await expect(member).toBeVisible();
    await expect(member).toHaveAttribute('href', 'member-sign-in/');
    const bounds = await member.boundingBox();
    expect(bounds.width >= 44 && bounds.height >= 44, `44px member target at ${width}px`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`).toBe(true);
    await member.focus();
    await expect(member).toBeFocused();
    if (width <= 1000) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Let’s talk' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    } else {
      await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Let’s talk' })).toBeVisible();
    }
    if ([1440, 390].includes(width)) await page.screenshot({ path: `/tmp/shadowbridge-member-access-${width}.png` });
    await member.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/member-sign-in\/$/);
    await expect(page.getByRole('form', { name: 'Member sign in', exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('homepage section anchors and account/legal entry targets remain valid; header passes accessibility check', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  expect(await nav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['#about', '#services', '#industries', '#approach', '#network', '#contact']);
  for (const id of ['home', 'about', 'services', 'industries', 'approach', 'network', 'work-with-us', 'contact']) await expect(page.locator(`#${id}`)).toHaveCount(1);
  for (const target of ['member-sign-in/', 'legal/', 'apply/buyer/', 'apply/supplier/', 'apply/partner/']) {
    await expect(page.locator(`a[href="${target}"]`).first()).toBeAttached();
    expect((await request.get(`/${target}`)).status()).toBe(200);
  }
  const cartel = page.locator('a[href="/cartel/"], a[href="cartel/"]').first();
  await expect(cartel).toBeAttached();
  expect((await request.get('/assets/member-access.svg')).status()).toBe(200);
  expect((await request.get('/.local/development.env')).status()).toBe(404);
  const result = await new AxeBuilder({ page }).include('.site-header').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map(item => ({ id: item.id, impact: item.impact }))).toEqual([]);
});
