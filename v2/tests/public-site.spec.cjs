const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs/promises');

const industries = ['food', 'water', 'machinery', 'industrial', 'other'];
const confirmedContact = 'shadowbridge.trade@gmail.com';
const industryTitles = {
  food: 'Food & agriculture',
  water: 'Water & beverages',
  machinery: 'Machinery & equipment',
  industrial: 'Industrial supplies',
  other: 'Other opportunities',
};

async function captureMailtoDrafts(page) {
  // Cancel only actual mailto link clicks, including a.click() on a generated
  // anchor. This exercises draft generation without launching an email client.
  await page.evaluate(() => {
    window.__capturedMailtoDrafts = [];
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || !/^mailto:/i.test(link.getAttribute('href'))) return;
      event.preventDefault();
      window.__capturedMailtoDrafts.push(link.getAttribute('href'));
    }, true);
  });
}

async function fillEnquiry(page, overrides = {}) {
  const details = {
    name: 'Alicja Example',
    email: 'alicja@example.com',
    company: 'Example Trading',
    role: 'buyer',
    message: 'We seek 500 units of industrial equipment for delivery to Poland.',
    ...overrides,
  };
  const form = page.locator('#enquiry-form');
  for (const name of ['name', 'email', 'company', 'message']) {
    await form.locator(`[name="${name}"]`).fill(details[name]);
  }
  await form.locator('[name="role"]').selectOption(details.role);
  return details;
}

function inspectDraft(href) {
  const draft = new URL(href);
  expect(draft.protocol).toBe('mailto:');
  expect(decodeURIComponent(draft.pathname)).toBe(confirmedContact);
  expect([...draft.searchParams.keys()].sort()).toEqual(['body', 'subject']);
  expect(draft.searchParams.get('subject')).toMatch(/ShadowBridge/i);
  expect(draft.searchParams.get('subject')).toMatch(/enquiry/i);
  expect(draft.searchParams.get('body')).toMatch(/ShadowBridge/i);
  return draft;
}
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

test('every header, footer and homepage CTA follows its real destination', async ({ page }) => {
  await page.goto('./');
  const selector = 'header a[href], main a[href], footer a[href]';
  const links = await page.locator(selector).evaluateAll(elements => elements.map(element => ({
    href: element.getAttribute('href'),
    text: element.textContent.trim(),
  })));
  expect(links.length).toBeGreaterThan(15);
  expect(links.some(link => /C\.A\.R\.T\.E\.L\. Division/.test(link.text))).toBe(true);
  for (const [index, { href, text }] of links.entries()) {
    await page.goto('./');
    await captureMailtoDrafts(page);
    const link = page.locator(selector).nth(index);
    await expect(link, `Link list changed before clicking ${text}`).toHaveAttribute('href', href);
    const insideNavigation = await link.evaluate(element => Boolean(element.closest('#primary-nav')));
    if (insideNavigation && await page.locator('#nav-toggle').isVisible()) {
      await page.locator('#nav-toggle').click();
    }
    const destination = new URL(href, page.url());
    await link.click();
    if (destination.protocol === 'mailto:') {
      expect(await page.evaluate(() => window.__capturedMailtoDrafts)).toEqual([href]);
      expect(decodeURIComponent(destination.pathname)).toBe(confirmedContact);
    } else {
      await expect(page, `Destination of ${text}`).toHaveURL(destination.href);
      if (destination.hash) {
        await expect(page.locator(`[id="${decodeURIComponent(destination.hash.slice(1))}"]`)).toBeInViewport();
      } else {
        await expect(page.locator('h1')).toBeVisible();
      }
    }
  }
});

test('confirmed email is visible in static HTML and no public link enables registration', async ({ page, request }) => {
  const response = await request.get('./');
  const source = await response.text();
  // This verifies the contact is shipped in HTML, not inserted only by JS.
  expect(source).toContain(`href="mailto:${confirmedContact}"`);
  await page.goto('./');
  const emailLink = page.locator('#business-contact a');
  await expect(emailLink).toBeVisible();
  await expect(emailLink).toHaveText(confirmedContact);
  await expect(emailLink).toHaveAttribute('href', `mailto:${confirmedContact}`);
  const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(links.filter(href => /(?:registration|quick-register|dashboard|\/auth\b)/i.test(href))).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
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

test('without JavaScript navigation and confirmed email remain useful while form actions stay disabled', async ({ browser }, testInfo) => {
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
    await expect(page.locator('#download-brief')).toBeDisabled();
    const businessEmail = page.locator('#business-contact a');
    await expect(businessEmail).toBeVisible();
    await expect(businessEmail).toHaveText(confirmedContact);
    await expect(businessEmail).toHaveAttribute('href', `mailto:${confirmedContact}`);
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
  await captureMailtoDrafts(page);
  await form.getByRole('button', { name: 'Prepare email', exact: true }).click();
  expect(await form.evaluate(element => element.checkValidity())).toBe(false);
  await form.locator('[name="name"]').fill('Alicja Example');
  await form.locator('[name="email"]').fill('not-an-email');
  await form.locator('[name="company"]').fill('Example Trading');
  await form.locator('[name="role"]').selectOption('buyer');
  await form.locator('[name="message"]').fill('We are seeking a new supplier for an international procurement enquiry.');
  expect(await form.evaluate(element => element.checkValidity())).toBe(false);
  await form.getByRole('button', { name: 'Prepare email', exact: true }).click();
  expect(await page.evaluate(() => window.__capturedMailtoDrafts)).toEqual([]);
});

test('Prepare email creates an encoded complete draft without sending or storing an enquiry', async ({ page }) => {
  const transmissions = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) || ['fetch', 'xhr'].includes(request.resourceType())) {
      transmissions.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto('./');
  await captureMailtoDrafts(page);
  await page.locator('[data-industry="machinery"]').click();
  await page.locator('#industry-enquiry').click();
  const details = await fillEnquiry(page, {
    name: 'Łucja Żak',
    email: 'lucja+zak@example.com',
    company: 'Próba & Co. = 100%',
    message: 'Dzień dobry,\nSzukamy 500 sztuk sprzętu. Cena 100% & termin?\nDruga linia: zażółć gęślą jaźń.\nbcc: untrusted@example.net',
  });
  await page.getByRole('button', { name: 'Prepare email', exact: true }).click();
  const drafts = await page.evaluate(() => window.__capturedMailtoDrafts);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).not.toMatch(/[\r\n]/);
  expect(drafts[0]).toMatch(/%0A/i);
  expect(drafts[0]).toMatch(/%26/i);
  const draft = inspectDraft(drafts[0]);
  const body = draft.searchParams.get('body');
  for (const field of ['name', 'email', 'company', 'message']) expect(body).toContain(details[field]);
  expect(body).toContain('Buyer / importer');
  expect(body).toContain(industryTitles.machinery);
  await expect(page.locator('#enquiry-status')).toContainText(/not (?:been )?sent|nothing (?:has been |was )?sent/i);
  await expect(page.locator('#contact-explanation')).toContainText(/(?:email|mail).*app|(?:email|mail).*client/i);
  await expect(page.locator('#enquiry-status')).not.toContainText(/successfully sent|message sent|enquiry sent|submitted successfully/i);
  expect(transmissions).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

test('each sector and all enquiry roles carry through to the prepared email draft', async ({ page }) => {
  await page.goto('./');
  await captureMailtoDrafts(page);
  const roles = [
    ['buyer', 'Buyer / importer'],
    ['supplier', 'Supplier / manufacturer'],
    ['agent', 'Independent B2B agent'],
    ['partnership', 'Other business partner'],
  ];
  for (const [index, industry] of industries.entries()) {
    await page.locator(`[data-industry="${industry}"]`).click();
    await page.locator('#industry-enquiry').click();
    const [role, label] = roles[index % roles.length];
    await fillEnquiry(page, { role, company: '' });
    await page.getByRole('button', { name: 'Prepare email', exact: true }).click();
    const drafts = await page.evaluate(() => window.__capturedMailtoDrafts);
    expect(drafts).toHaveLength(index + 1);
    const body = inspectDraft(drafts.at(-1)).searchParams.get('body');
    expect(body).toContain(industryTitles[industry]);
    expect(body).toContain(label);
    expect(body).toMatch(/Company: Not specified/);
  }
});

test('long enquiries keep every detail in a downloadable brief without a truncated email draft', async ({ page }) => {
  await page.goto('./#contact');
  await captureMailtoDrafts(page);
  const message = Array.from({ length: 60 }, (_, index) =>
    `Item ${index + 1}: Łódź supplier; 100% complete terms & delivery requirements.`).join('\n');
  expect(message.length).toBeLessThanOrEqual(5000);
  const details = await fillEnquiry(page, { message });
  await page.getByRole('button', { name: 'Prepare email', exact: true }).click();
  expect(await page.evaluate(() => window.__capturedMailtoDrafts)).toEqual([]);
  await expect(page.locator('#email-draft-link')).not.toBeVisible();
  await expect(page.locator('#email-draft-link')).not.toHaveAttribute('href');
  await expect(page.locator('#enquiry-status')).toContainText(/download or copy/i);
  await expect(page.locator('#enquiry-status')).toContainText(confirmedContact);
  await expect(page.locator('#enquiry-status')).toContainText(/not sent/i);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download-brief').click();
  const download = await downloadPromise;
  const content = await fs.readFile(await download.path(), 'utf8');
  for (const field of ['name', 'email', 'company', 'message']) expect(content).toContain(details[field]);
  expect(content).toContain('Item 60:');
});

test('editing fields, role or sector invalidates stale email drafts before they can be reopened', async ({ page }) => {
  await page.goto('./#contact');
  await captureMailtoDrafts(page);
  await fillEnquiry(page);
  const draftLink = page.locator('#email-draft-link');
  const prepareButton = page.getByRole('button', { name: 'Prepare email', exact: true });
  for (const change of [
    () => page.locator('#enquiry-message').fill('Updated complete details for this international commercial enquiry.'),
    () => page.locator('#enquiry-role').selectOption('supplier'),
    () => page.locator('[data-industry="water"]').click(),
  ]) {
    await prepareButton.click();
    await expect(draftLink).toBeVisible();
    await expect(draftLink).toHaveAttribute('href', /^mailto:/);
    await change();
    await expect(draftLink).not.toBeVisible();
    await expect(draftLink).not.toHaveAttribute('href');
  }
  await prepareButton.click();
  const drafts = await page.evaluate(() => window.__capturedMailtoDrafts);
  expect(drafts).toHaveLength(4);
  const body = inspectDraft(drafts.at(-1)).searchParams.get('body');
  expect(body).toContain('Updated complete details');
  expect(body).toContain('Supplier / manufacturer');
  expect(body).toContain(industryTitles.water);
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

test('C.A.R.T.E.L. page is informative, responsive and unchanged by legacy access flags', async ({ page }) => {
  const failures = [];
  const calls = [];
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', request => failures.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType()) || !['GET', 'HEAD'].includes(request.method())) calls.push(request.url());
  });
  await page.goto('./');
  await page.getByRole('link', { name: 'C.A.R.T.E.L. Division', exact: true }).click();
  await expect(page).toHaveURL(/\/v2\/cartel\/$/);
  await expect(page.locator('h1')).toContainText(/C\.A\.R\.T\.E\.L\./i);
  await expect(page.locator('main')).toContainText(/restricted|private|internal/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  const standardContent = await page.locator('main').innerText();
  await page.goto('./cartel/?access=cartel&preview=1');
  await page.waitForLoadState('networkidle');
  expect(await page.locator('main').innerText()).toBe(standardContent);
  await expect(page.locator('form, input, [id$="-dashboard"]')).toHaveCount(0);
  const links = await page.locator('a[href]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(links.filter(href => /registration|quick-register|dashboard|\/auth\b/i.test(href))).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(failures).toEqual([]);
  expect(calls).toEqual([]);
  const returnLink = page.getByRole('link', { name: /(?:back|return) to (?:the )?(?:shadowbridge|home)/i }).first();
  await expect(returnLink).toBeVisible();
  await returnLink.click();
  await expect(page.locator('#hero-title')).toBeVisible();
  await expect(page).toHaveURL(/\/v2\/(?:index\.html)?(?:#home)?$/);
});

test('accessibility: C.A.R.T.E.L. information page passes axe WCAG 2.2 A and AA checks', async ({ page }) => {
  await page.goto('./cartel/');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
});
