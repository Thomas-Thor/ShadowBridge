const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
let helpers;
let applicant;

test.describe.serial('Real private B2B mobile workflow', () => {
  test.beforeAll(async () => {
    helpers = await import('../server/tests/helpers.mjs');
    const response = await fetch(`${helpers.appOrigin}/api/config`);
    if (response.status !== 200 || (await response.json()).backendEnabled !== true) {
      throw new Error('Start the real local BFF/Auth/PostgreSQL/Mailpit stack; these tests do not mock authentication');
    }
  });

  test('onboarding, real e-mail verification and pending sign-in reveal no private resources', async ({ page }, testInfo) => {
    const label = `mobile-${testInfo.project.name.split('-')[1]}`;
    applicant = {
      email: `${helpers.runId}.${label}@test.shadowbridge.invalid`, password: helpers.password(),
      companyName: `FICTIONAL ${helpers.runId} ${label} Ltd`, client: new helpers.Client(),
    };
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const role of ['buyer', 'supplier', 'partner']) {
      await page.goto(`/apply/${role}/`);
      await expect(page.locator('#application-form input[name=email]')).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByText('manual company approval', { exact: false }).first()).toBeVisible();
    }
    await page.goto('/apply/buyer/');
    const form = page.locator('#application-form');
    await expect(form.locator('[name=companyName]')).toBeEnabled();
    await form.locator('[name=companyName]').fill(applicant.companyName);
    await form.locator('[name=country]').fill('Norway');
    await form.locator('[name=registrationNumber]').fill(`DEMO-${helpers.runId}-${label}`);
    await form.locator('[name=email]').fill(applicant.email);
    await form.locator('[name=password]').fill(applicant.password);
    await form.locator('[name=passwordConfirm]').fill(applicant.password);
    await form.locator('[name=countries]').fill('NO');
    await form.locator('[name=sectors]').fill('Industrial materials');
    await form.locator('[name=summary]').fill('Fictional automated local UI test only.');
    await form.locator('[name=acknowledgement]').check();
    await form.getByRole('button', { name: 'Apply for Access', exact: true }).click();
    await expect(page.locator('#application-status')).toContainText('Check your email.');
    const email = await helpers.waitForMessage(applicant.email);
    const restrictedRequests = [];
    page.on('request', request => {
      if (/\/api\/(admin|offers|rfqs|opportunities)/.test(request.url())) restrictedRequests.push(new URL(request.url()).pathname);
    });
    await page.goto(helpers.confirmationLink(email).href);
    await expect(page.locator('#portal-status')).toContainText('Application under review.');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#sign-in-form [name=email]')).toBeEnabled();
    await page.locator('#sign-in-form [name=email]').fill(applicant.email);
    await page.locator('#sign-in-form [name=password]').fill(applicant.password);
    await page.locator('#sign-in-form button[type=submit]').click();
    await expect(page.locator('#portal-status')).toContainText('Application under review.');
    await expect(page.locator('#portal-content')).toBeEmpty();
    await expect(page.locator('#portal-navigation')).toBeHidden();
    expect(restrictedRequests).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    const current = await page.request.get('/api/session');
    applicant.user = (await current.json()).user;
  });

  test('manual approval unlocks own RFQ UI; saving and submitting persist through real API', async ({ page }) => {
    const owner = await helpers.verifyActor(await helpers.registerActor('partner', `ui-owner-${applicant.user.id.slice(0, 8)}`));
    helpers.bootstrapOwner(owner);
    const enrolled = await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: [200, 201] });
    await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: enrolled.data.id, code: helpers.totp(enrolled.data.totp.secret) }, expected: 200 });
    const application = helpers.db(`SELECT id FROM sb.applications WHERE user_id=${helpers.sqlLiteral(applicant.user.id)}`);
    await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional mobile UI test approved after real email verification' }, expected: 200 });
    await page.goto('/member-sign-in/');
    const signin = page.locator('#sign-in-form');
    await expect(signin.locator('[name=email]')).toBeEnabled();
    await signin.locator('[name=email]').fill(applicant.email);
    await signin.locator('[name=password]').fill(applicant.password);
    await signin.locator('button[type=submit]').click();
    await expect(page.locator('#portal-navigation').getByRole('link', { name: /buyer/i })).toBeVisible();
    await page.locator('#portal-navigation').getByRole('link', { name: /buyer/i }).click();
    const create = page.locator('section').filter({ has: page.getByRole('heading', { name: 'New purchase request', exact: true }) });
    await expect(create).toBeVisible();
    const values = {
      product: `Fictional mobile RFQ ${helpers.runId}`, specifications: 'Fictional specification, no confidential trade data.',
      quantity: '12', unit: 'tonne', budget: '15000', deliveryCountry: 'Norway',
      deadline: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), certificates: 'Manual review', requirements: 'ShadowBridge coordinates introductions.',
    };
    for (const [name, value] of Object.entries(values)) await create.locator(`[name=${name}]`).fill(value);
    const category = await helpers.catalogCategory(owner.client);
    await create.locator('[name=categoryId]').selectOption(category.categoryId);
    if (category.subcategoryId) await create.locator('[name=subcategoryId]').selectOption(category.subcategoryId);
    await create.locator('[name=currency]').selectOption('PLN');
    await create.getByRole('button', { name: 'Save private draft', exact: true }).click();
    const record = page.locator('.portal-record').filter({ has: page.getByRole('heading', { name: values.product, exact: true }) });
    await expect(record).toBeVisible();
    await expect(record.locator('small').first()).toContainText('draft');
    await record.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await expect(record.locator('small').first()).toContainText('submitted');
    await expect(record.getByRole('button', { name: 'Edit draft', exact: true })).toHaveCount(0);
    const stored = await page.request.get('/api/rfqs');
    const records = (await stored.json()).items;
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('submitted');
    expect(records[0].data.product).toBe(values.product);
    expect(records[0].data.categoryId).toBe(category.categoryId);
    expect(records[0].data.currency).toBe('PLN');
    await expect(page.getByText('No anonymous opportunities have been individually released to your company.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });
});
