const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');

const industries = ['food', 'water', 'machinery', 'industrial', 'other'];
const runtimeErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), 'Unexpected browser error during the user interaction').toEqual([]);
});

test('public page and local resources load without browser errors or horizontal overflow', async ({ page }) => {
  const errors = [];
  const failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => failures.push(`${request.failure()?.errorText} ${request.url()}`));

  const response = await page.goto('./');
  expect(response.status()).toBe(200);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page).toHaveTitle(/ShadowBridge/i);
  await page.waitForLoadState('networkidle');

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test('every public local link has an existing target', async ({ page, request }) => {
  await page.goto('./');
  const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(links.length).toBeGreaterThan(5);
  for (const href of [...new Set(links)]) {
    expect(href).not.toBe('#');
    expect(href).not.toMatch(/^javascript:/i);
    const url = new URL(href, page.url());
    if (url.origin !== new URL(page.url()).origin) continue;
    if (url.pathname === new URL(page.url()).pathname && url.hash) {
      const target = page.locator(`[id="${decodeURIComponent(url.hash.slice(1))}"]`);
      await expect(target, `Missing anchor ${href}`).toHaveCount(1);
    } else {
      const response = await request.get(url.href);
      expect(response.status(), `Broken local link ${href}`).toBeLessThan(400);
    }
  }
});

test('navigation supports a keyboard-operable menu and follows section links', async ({ page }) => {
  await page.goto('./');
  const toggle = page.locator('#nav-toggle');
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await toggle.click();
  }
  const navigation = page.getByRole('navigation').first();
  const sectionLink = navigation.locator('a[href^="#"]').first();
  const href = await sectionLink.getAttribute('href');
  await sectionLink.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  if (await toggle.isVisible()) await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('skip link moves native keyboard focus to the main content', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: /Skip to content/i });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  await expect(page).toHaveURL(/#main$/);
});

test('without JavaScript navigation remains useful and enquiry actions cannot submit data', async ({ browser }, testInfo) => {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    viewport,
    isMobile: Boolean(isMobile),
    hasTouch: Boolean(hasTouch),
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8000/v2/');
    await expect(page.locator('html')).toHaveClass(/no-js/);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#nav-toggle')).not.toBeVisible();
    const navigation = page.locator('#primary-nav');
    for (const link of await navigation.getByRole('link').all()) await expect(link).toBeVisible();
    await navigation.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/#about$/);
    await expect(page.locator('#enquiry-form button[type="submit"]')).toBeDisabled();
    await expect(page.locator('#copy-brief')).toBeDisabled();
    // Playwright excludes the noscript container from its text matcher; assert
    // the actual rendered fallback paragraph in a JavaScript-disabled context.
    const fallbackNotice = page.locator('#enquiry-form noscript .notice');
    await expect(fallbackNotice).toBeVisible();
    await expect(fallbackNotice).toContainText(/requires JavaScript/i);
  } finally {
    await context.close();
  }
});

test('industry tabs expose all five opportunities with correct keyboard semantics', async ({ page }) => {
  await page.goto('./');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(industries.length);
  for (const industry of industries) {
    const tab = page.locator(`[role="tab"][data-industry="${industry}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const panelId = await tab.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toHaveAttribute('role', 'tabpanel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-labelledby', await tab.getAttribute('id'));
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  }
  await page.keyboard.press('ArrowRight');
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused();
});

test('buyer, supplier and agent paths prefill the contact role', async ({ page }) => {
  await page.goto('./');
  for (const role of ['buyer', 'supplier', 'agent']) {
    await page.locator(`[data-enquiry-role="${role}"]`).first().click();
    await expect(page.locator('#enquiry-role')).toHaveValue(role);
    await expect(page.locator('#enquiry-form')).toBeInViewport();
  }
});

test('contact form rejects empty or invalid required values', async ({ page }) => {
  await page.goto('./#contact');
  const form = page.locator('#enquiry-form');
  await form.getByRole('button', { name: /Download enquiry brief/i }).click();
  expect(await form.evaluate(element => element.checkValidity())).toBe(false);
  await form.locator('[name="name"]').fill('Alicja Example');
  await form.locator('[name="email"]').fill('not-an-email');
  await form.locator('[name="company"]').fill('Example Trading');
  await form.locator('[name="role"]').selectOption('buyer');
  await form.locator('[name="message"]').fill('We are seeking a new supplier for an international procurement enquiry.');
  expect(await form.evaluate(element => element.checkValidity())).toBe(false);
});

test('contact produces a real local enquiry brief without transmitting the enquiry', async ({ page }) => {
  const transmissions = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method())) transmissions.push(`${request.method()} ${request.url()}`);
  });
  await page.goto('./#contact');
  const form = page.locator('#enquiry-form');
  const details = {
    name: 'Alicja Example',
    email: 'alicja@example.com',
    company: 'Example Trading',
    message: 'We seek 500 units of industrial equipment for delivery to Poland.',
  };
  for (const [name, value] of Object.entries(details)) await form.locator(`[name="${name}"]`).fill(value);
  await form.locator('[name="role"]').selectOption('buyer');
  const downloadPromise = page.waitForEvent('download');
  await form.getByRole('button', { name: /Download enquiry brief/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.txt$/i);
  const content = await fs.readFile(await download.path(), 'utf8');
  for (const value of Object.values(details)) expect(content).toContain(value);
  expect(content).toMatch(/buyer/i);
  expect(content).toMatch(/ShadowBridge/i);
  await expect(page.locator('#contact')).toContainText(/not (?:been )?(?:sent|transmitted)|nothing (?:was |has been )?sent|no (?:data |information )?(?:has been |was )?(?:sent|transmitted)/i);
  expect(transmissions).toEqual([]);
});

test('copy brief writes the actual clipboard and offers download when permission is denied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./#contact');
  const form = page.locator('#enquiry-form');
  await form.locator('[name="name"]').fill('Alicja Example');
  await form.locator('[name="email"]').fill('alicja@example.com');
  await form.locator('[name="role"]').selectOption('supplier');
  await form.locator('[name="message"]').fill('We manufacture industrial components and would like to discuss international supply opportunities.');
  await form.getByRole('button', { name: /Copy brief instead/i }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Alicja Example');
  expect(copied).toContain('alicja@example.com');
  expect(copied).toMatch(/supplier/i);
  await expect(page.locator('#enquiry-status')).toContainText(/copied/i);
  await expect(page.locator('#enquiry-status')).toContainText(/not been sent/i);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException('Permission denied for this test', 'NotAllowedError');
    };
  });
  await form.getByRole('button', { name: /Copy brief instead/i }).click();
  await expect(page.locator('#enquiry-status')).toContainText(/unavailable/i);
  await expect(page.locator('#enquiry-status')).toContainText(/Download enquiry brief/i);
});

test('accessibility: public V2 passes axe WCAG 2.2 A and AA automated checks', async ({ page }) => {
  await page.goto('./');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
});
