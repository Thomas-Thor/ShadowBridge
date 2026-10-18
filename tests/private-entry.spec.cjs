const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const AxeBuilder = loadTestDependency('@axe-core/playwright').default;

const roles = [
  { role: 'buyer', label: 'Apply for Access', group: 'requests', filter: 'review', count: 2 },
  { role: 'supplier', label: 'Submit a Business Application', group: 'offers', filter: 'draft', count: 3 },
  { role: 'partner', label: 'Apply to Join Our Network', group: 'projects', filter: 'active', count: 3 },
];
const newPaths = [...roles.map(({ role }) => `apply/${role}/`), 'member-sign-in/'];
const browserIssues = new WeakMap();

test.beforeEach(async ({ page }) => {
  const issues = [];
  browserIssues.set(page, issues);
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (message.type() === 'error') issues.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) issues.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => issues.push(`${request.failure()?.errorText} ${request.url()}`));
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page), 'Unexpected browser or asset failure').toEqual([]);
});

async function noOverflow(page) {
  await page.evaluate(() => document.fonts.ready);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport + 1);
}

async function noPersistence(page) {
  expect(await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookies: document.cookie,
  }))).toEqual({ local: [], session: [], cookies: '' });
  expect(await page.context().cookies()).toEqual([]);
}

async function allDisabled(locator) {
  const controls = await locator.all();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) await expect(control).toBeDisabled();
}

test('three homepage entries lead to their real application pages and common sign-in', async ({ page }) => {
  for (const { role, label } of roles) {
    await page.goto('./');
    const entry = page.locator('.access-entry-link').filter({ hasText: label });
    await expect(entry).toHaveCount(1);
    await expect(entry).toBeVisible();
    const box = await entry.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/apply/${role}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#application-status')).toContainText('Applications are not open yet.');
    await expect(page.locator('[aria-current="page"]')).toHaveText(role === 'partner' ? 'B2B PARTNER' : role.toUpperCase());
    await noOverflow(page);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Member Sign In' }).click();
    await expect(page).toHaveURL(/\/member-sign-in\/$/);
    await expect(page.locator('#sign-in-status')).toContainText('Sign in is not enabled.');
    await page.getByRole('link', { name: 'Back to ShadowBridge' }).click();
    await expect(page).toHaveURL(/\/#work-with-us$/);
  }
  await page.goto('./');
  await page.locator('.role-note .member-entry-link').click();
  await expect(page).toHaveURL(/\/member-sign-in\/$/);
});

test('application and sign-in fields cannot collect information or submit requests', async ({ page }) => {
  const outgoing = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) || ['fetch', 'xhr', 'websocket'].includes(request.resourceType())) {
      outgoing.push(`${request.method()} ${request.resourceType()} ${request.url()}`);
    }
  });
  for (const route of newPaths) {
    await page.goto(route);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex.*nofollow/);
    await expect(page.locator('fieldset')).toHaveAttribute('disabled', '');
    await allDisabled(page.locator('form input, form textarea, form select, form button'));
    await expect(page.locator('input[type="file"]:enabled, button[type="submit"]:enabled')).toHaveCount(0);
    await expect(page.locator('form [name], form [action]')).toHaveCount(0);
    await noPersistence(page);
    await noOverflow(page);
  }
  expect(outgoing).toEqual([]);
});

test('native checklist and recovery disclosures work with the keyboard', async ({ page }) => {
  await page.goto('apply/buyer/');
  const checklist = page.getByText('Application preparation checklist', { exact: true });
  await checklist.focus();
  await page.keyboard.press('Enter');
  await expect(checklist.locator('..')).toHaveAttribute('open', '');
  await expect(checklist.locator('..').getByText('Company registration and business contact details.', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(checklist.locator('..')).not.toHaveAttribute('open');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Member Sign In' }).click();
  const recovery = page.getByText('Account recovery', { exact: true });
  await recovery.focus();
  await page.keyboard.press('Space');
  await expect(recovery.locator('..')).toHaveAttribute('open', '');
  await expect(recovery.locator('..')).toContainText('Neither is available in this preview.');
  await noPersistence(page);
});

for (const { role, group, filter, count } of roles) {
  test(`${role} design uses anonymous fictional records and memory-only template/filter actions`, async ({ page }) => {
    const outgoing = [];
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method()) || ['fetch', 'xhr', 'websocket'].includes(request.resourceType())) {
        outgoing.push(`${request.method()} ${request.resourceType()} ${request.url()}`);
      }
    });
    await page.goto('prototypes/');
    await page.getByRole('link', { name: `View ${role} design`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/prototypes/${role}/$`));
    await expect(page.locator('.proto-banner')).toHaveText('Design prototype · fictional data only · no authentication or storage');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await allDisabled(page.locator('fieldset input, fieldset textarea, fieldset select'));
    await expect(page.locator('input[type="file"]:enabled, input:enabled, textarea:enabled, button[type="submit"]:enabled')).toHaveCount(0);
    await expect(page.locator('a[href^="mailto:"], a[href^="tel:"], a[href^="http"]')).toHaveCount(0);
    for (const id of await page.locator('.proto-record-id').allTextContents()) expect(id).toMatch(/^SB-DEMO-/);
    await noOverflow(page);

    const firstField = page.locator('[data-proto-field]').first();
    await expect(firstField).toHaveValue('');
    await page.locator(`[data-proto-template="${role}"]`).click();
    await expect(firstField).toHaveValue(/FICTIONAL EXAMPLE/);
    await expect(page.locator('[data-proto-feedback]')).toContainText('Nothing has been saved, sent or submitted.');
    await expect(firstField).toBeDisabled();
    await page.locator('[data-proto-reset]').click();
    await expect(firstField).toHaveValue('');
    await expect(page.locator('[data-proto-feedback]')).toContainText('No stored data exists.');
    await expect(page.locator(`[data-proto-group="${group}"]:visible`)).toHaveCount(count);
    await page.locator(`[data-proto-filter="${group}"]`).selectOption(filter);
    await expect(page.locator(`[data-proto-group="${group}"]:visible`)).toHaveCount(1);
    await expect(page.locator(`[data-proto-filter-feedback="${group}"]`)).toContainText('1 fictional item shown.');
    await page.locator(`[data-proto-filter="${group}"]`).selectOption('all');
    await expect(page.locator(`[data-proto-group="${group}"]:visible`)).toHaveCount(count);
    await noPersistence(page);
    expect(outgoing).toEqual([]);
    await page.reload();
    await expect(page.locator('[data-proto-field]').first()).toHaveValue('');
    await expect(page.locator(`[data-proto-filter="${group}"]`)).toHaveValue('all');
    await noPersistence(page);
  });
}

test('without JavaScript forms remain disabled and no fake sign-in or private access appears', async ({ browser }, testInfo) => {
  const { viewport, isMobile, hasTouch } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport,
    isMobile: Boolean(isMobile),
    hasTouch: Boolean(hasTouch),
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    for (const route of ['member-sign-in/', 'apply/supplier/', 'prototypes/supplier/']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await allDisabled(page.locator('fieldset input, fieldset textarea, fieldset select'));
      await expect(page.locator('input:enabled, textarea:enabled, input[type="file"]:enabled, button[type="submit"]:enabled')).toHaveCount(0);
      if (route.startsWith('prototypes/')) {
        await expect(page.locator('[data-proto-template], [data-proto-reset], [data-proto-filter]')).toHaveCount(3);
        await allDisabled(page.locator('[data-proto-template], [data-proto-reset], [data-proto-filter]'));
        await expect(page.locator('noscript p')).toBeVisible();
      }
      await noOverflow(page);
    }
  } finally { await context.close(); }
});

test('existing C.A.R.T.E.L. footer button keeps the restricted information page and return link', async ({ page }) => {
  await page.goto('./');
  const cartel = page.locator('.cartel-footer-link');
  await expect(cartel).toHaveAccessibleName('C.A.R.T.E.L. Division');
  await expect(page.locator('#cartel-footer-subtitle')).toHaveText('By invitation only');
  await cartel.click();
  await expect(page).toHaveURL(/\/cartel\/$/);
  await expect(page.locator('.access-label')).toContainText('ACCESS RESTRICTED');
  await expect(page.locator('.restricted-invitation')).toHaveText('Admission is granted exclusively by invitation.');
  await expect(page.locator('input, form')).toHaveCount(0);
  await page.getByRole('link', { name: 'Return to ShadowBridge' }).click();
  await expect(page).toHaveURL(/\/#home$/);
});

test('existing buyer contact path still prepares a Gmail mailto draft without sending it', async ({ page }) => {
  const outgoing = [];
  page.on('request', request => { if (request.method() !== 'GET') outgoing.push(request.url()); });
  await page.goto('./');
  await page.evaluate(() => {
    window.__drafts = [];
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (link?.getAttribute('href')?.startsWith('mailto:')) {
        event.preventDefault();
        window.__drafts.push(link.getAttribute('href'));
      }
    }, true);
  });
  await page.locator('[data-enquiry-role="buyer"]').click();
  await expect(page.locator('#enquiry-role')).toHaveValue('buyer');
  const form = page.locator('#enquiry-form');
  await form.locator('[name="name"]').fill('Fictional Review User');
  await form.locator('[name="email"]').fill('review@example.com');
  await form.locator('[name="company"]').fill('Fictional review company');
  await form.locator('[name="message"]').fill('Fictional review enquiry only: please assess a general purchasing opportunity.');
  await page.locator('#prepare-email').click();
  await expect(page.locator('#enquiry-status')).toContainText('It has not been sent to ShadowBridge by this website.');
  const hrefs = await page.evaluate(() => window.__drafts);
  expect(hrefs).toHaveLength(1);
  const draft = new URL(hrefs[0]);
  expect(draft.protocol).toBe('mailto:');
  expect(draft.pathname).toBe('shadowbridge.trade@gmail.com');
  expect(draft.searchParams.get('body')).toContain('Fictional review enquiry only');
  expect(outgoing).toEqual([]);
  await noPersistence(page);
});

test('new entry and workspace pages have no WCAG A/AA accessibility violations or overflow', async ({ page }) => {
  const routes = [...newPaths, 'prototypes/', ...roles.map(({ role }) => `prototypes/${role}/`)];
  for (const route of routes) {
    await page.goto(route);
    await noOverflow(page);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), route).toEqual([]);
  }
});
