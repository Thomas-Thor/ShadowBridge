const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
let helpers;

test.beforeAll(async () => {
  helpers = await import('../server/tests/helpers.mjs');
  const response = await fetch(`${helpers.appOrigin}/api/config`);
  if (response.status !== 200 || (await response.json()).backendEnabled !== true) {
    throw new Error('Start the real local BFF/Auth/PostgreSQL/Mailpit stack; contact tests do not mock the backend');
  }
});

test('public contact persists to the private queue and renders safely for MFA management', async ({ page }, testInfo) => {
  const email = `${helpers.runId}.${testInfo.project.name}@test.shadowbridge.invalid`;
  const message = `FICTIONAL ${helpers.runId} local UI enquiry: <img src=x onerror="window.contactInjection=true">. No real confidential data.`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#contact');
  const form = page.locator('#enquiry-form');
  await expect(form.locator('#send-enquiry')).toBeEnabled();
  await form.locator('[name=name]').fill(`FICTIONAL ${helpers.runId} contact`);
  await form.locator('[name=email]').fill(email);
  await form.locator('[name=company]').fill('FICTIONAL test company');
  await form.locator('[name=role]').selectOption('buyer');
  await form.locator('[name=message]').fill(message);
  await form.locator('[name=consent]').check();
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/contact' && response.request().method() === 'POST');
  await form.locator('#send-enquiry').click();
  const result = await saved;
  expect(result.status()).toBe(201);
  const { receipt } = await result.json();
  expect(receipt).toMatch(/^SB-CONTACT-/);
  await expect(page.locator('#enquiry-status')).toContainText(receipt);
  expect(helpers.db(`SELECT count(*) FROM sb.contact_enquiries WHERE public_id=${helpers.sqlLiteral(receipt)} AND email=${helpers.sqlLiteral(email)} AND status='new'`)).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  const owner = await helpers.verifyActor(await helpers.registerActor('partner', `${testInfo.project.name}-queue-owner`));
  helpers.bootstrapOwner(owner);
  const factor = (await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 201 })).data;
  await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: factor.id, code: helpers.totp(factor.totp.secret) }, expected: 200 });
  await page.context().addCookies([...owner.client.cookies].map(([name, value]) => ({ name, value, url: helpers.appOrigin, httpOnly: true, sameSite: 'Lax' })));
  await page.goto('/portal/admin/?module=contact');
  const queue = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Contact enquiry queue', exact: true }) });
  const record = queue.locator('.portal-record').filter({ has: page.getByRole('heading', { name: receipt, exact: true }) });
  await expect(record).toBeVisible();
  await expect(record).toContainText(message);
  await expect(record.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.contactInjection)).toBeUndefined();
  await record.locator('[name=status]').selectOption('in_review');
  await record.locator('button[type=submit]').click();
  await expect(record.locator('small').first()).toContainText('in_review');
  expect(helpers.db(`SELECT status FROM sb.contact_enquiries WHERE public_id=${helpers.sqlLiteral(receipt)}`)).toBe('in_review');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a second tab reading configuration preserves CSRF and saves exactly one enquiry', async ({ page }, testInfo) => {
  const email = `${helpers.runId}.${testInfo.project.name}.two-tabs@test.shadowbridge.invalid`;
  await page.goto('/#contact');
  const form = page.locator('#enquiry-form');
  await expect(form.locator('#send-enquiry')).toBeEnabled();
  await form.locator('[name=name]').fill('FICTIONAL two-tab contact');
  await form.locator('[name=email]').fill(email);
  await form.locator('[name=company]').fill('FICTIONAL local test company');
  await form.locator('[name=role]').selectOption('partner');
  await form.locator('[name=message]').fill(`FICTIONAL local two-tab CSRF regression ${helpers.runId}. No real business data.`);
  await form.locator('[name=consent]').check();

  // Real configuration reads in another tab must preserve the token.
  // No response is mocked: the enquiry is committed once to PostgreSQL.
  const otherTab = await page.context().newPage();
  const rotation = await otherTab.goto('/api/config');
  expect(rotation.status()).toBe(200);
  await otherTab.close();
  const posts = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/contact' && response.request().method() === 'POST') posts.push(response);
  });
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/contact' && response.request().method() === 'POST' && response.status() === 201);
  await form.locator('#send-enquiry').click();
  const result = await saved;
  const { receipt } = await result.json();
  await expect(page.locator('#enquiry-status')).toContainText(receipt);
  expect(posts.map(response => response.status())).toEqual([201]);
  expect(helpers.db(`SELECT count(*) FROM sb.contact_enquiries WHERE email=${helpers.sqlLiteral(email)}`)).toBe('1');
  expect(helpers.db(`SELECT count(*) FROM sb.contact_enquiries WHERE public_id=${helpers.sqlLiteral(receipt)} AND email=${helpers.sqlLiteral(email)}`)).toBe('1');
});

test('public entry points, WhatsApp and centred C.A.R.T.E.L. seal remain available without exposed Gmail', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('shadowbridge.trade@gmail.com');
  for (const role of ['buyer', 'supplier', 'partner']) {
    const link = page.locator(`a[href="apply/${role}/"]`).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('#application-form [name=email]')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/');
  }
  await expect(page.getByRole('link', { name: /Member Sign In/i }).first()).toBeVisible();
  const whatsapp = page.locator('#whatsapp-contact');
  await expect(whatsapp).toBeVisible();
  await expect(whatsapp).toHaveAccessibleName(/Discuss business on WhatsApp/);
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/4747747007(?:\?|$)/);
  await expect(whatsapp).toHaveAttribute('rel', /noopener/);
  const seal = page.locator('.footer-private-access img');
  await seal.scrollIntoViewIfNeeded();
  await expect(seal).toBeVisible();
  await expect.poll(() => seal.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const centred = await seal.evaluate(image => Math.abs(image.getBoundingClientRect().x + image.getBoundingClientRect().width / 2 - innerWidth / 2));
  expect(centred).toBeLessThanOrEqual(2);
  await page.getByRole('link', { name: 'C.A.R.T.E.L. Private Network — by invitation only', exact: true }).click();
  await expect(page).toHaveURL(/\/cartel\/$/);
  await expect(page.locator('body')).toContainText(/invitation.only|restricted.access/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
