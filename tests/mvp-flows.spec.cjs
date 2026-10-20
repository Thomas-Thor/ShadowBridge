const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
let helpers;
let owner;
let supplier;
let buyer;
let partner;
const future = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

function section(page, title) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}
async function fill(form, values) {
  for (const [name, value] of Object.entries(values)) await form.locator(`[name=${name}]`).fill(value);
}
async function signIn(page, actor, role) {
  await page.goto('/member-sign-in/');
  const form = page.locator('#sign-in-form');
  await expect(form.locator('[name=email]')).toBeEnabled();
  await fill(form, { email: actor.email, password: actor.password });
  await form.locator('button[type=submit]').click();
  await expect(page.locator('#portal-status')).toContainText('Approved account.');
  await page.goto(`/portal/${role}/`);
}
async function ownerContext(browser, { viewport, isMobile = false, hasTouch = false }) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch, reducedMotion: 'reduce' });
  // An opaque, real GoTrue-backed AAL2 BFF session, created through real MFA.
  // No JWT, password or fixture credential is written to an artifact/file.
  await context.addCookies([...owner.client.cookies].map(([name, value]) => ({ name, value, url: helpers.appOrigin, httpOnly: true, sameSite: 'Lax' })));
  const page = await context.newPage();
  await page.goto('/portal/admin/');
  await expect(page.locator('#portal-status')).toContainText('Authorized management session.');
  return { context, page };
}

test.describe('Real supplier, management and partner workflows', () => {
  test.beforeAll(async () => {
    helpers = await import('../server/tests/helpers.mjs');
    owner = await helpers.verifyActor(await helpers.registerActor('partner', 'desktop-owner'));
    helpers.bootstrapOwner(owner);
    const enrollment = await owner.client.request('/api/auth/mfa/enroll', { method: 'POST', body: {}, expected: 201 });
    await owner.client.request('/api/auth/mfa/verify', { method: 'POST', body: { factorId: enrollment.data.id, code: helpers.totp(enrollment.data.totp.secret) }, expected: 200 });
    supplier = await helpers.verifyActor(await helpers.registerActor('supplier', 'desktop-supplier'));
    buyer = await helpers.verifyActor(await helpers.registerActor('buyer', 'desktop-buyer'));
    partner = await helpers.verifyActor(await helpers.registerActor('partner', 'desktop-partner'));
    for (const actor of [supplier, buyer, partner]) {
      const application = helpers.db(`SELECT id FROM sb.applications WHERE user_id=${helpers.sqlLiteral(actor.user.id)}`);
      actor.companyId = helpers.db(`SELECT company_id FROM sb.applications WHERE user_id=${helpers.sqlLiteral(actor.user.id)}`);
      await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional desktop UI test approved after real email verification' }, expected: 200 });
    }
  });

  test('supplier creates, edits and submits; verified management individually releases an anonymous card', async ({ page, browser }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await signIn(page, supplier, 'supplier');
    const create = section(page, 'New supplier offer');
    const product = `Fictional supplier UI material ${helpers.runId}`;
    await fill(create, {
      productName: product, description: 'Fictional desktop test material. No actual commercial availability.',
      specification: 'Generic non-hazardous industrial test granules.', countryOfOrigin: 'NO', quantity: '20', unit: 'tonne', price: '1250',
      minimumOrderQuantity: '5', loadingLocation: 'Norway', deliveryTerms: 'Collection by agreement', availability: 'Within 30 days',
      validUntil: future, certificationsStatus: 'Manual review required', notes: 'Fictional local UI verification only.',
    });
    const category = await helpers.catalogCategory(owner.client);
    await create.locator('[name=categoryId]').selectOption(category.categoryId);
    if (category.subcategoryId) await create.locator('[name=subcategoryId]').selectOption(category.subcategoryId);
    await create.locator('[name=currency]').selectOption('PLN');
    await create.locator('[name=incoterms]').selectOption('FCA');
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/offers' && response.request().method() === 'POST');
    await create.getByRole('button', { name: 'Save private draft', exact: true }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(201);
    const offer = (await savedResponse.json()).item;
    const record = page.locator('.portal-record').filter({ has: page.getByRole('heading', { name: product, exact: true }) });
    await expect(record).toBeVisible();
    await record.getByRole('button', { name: 'Edit draft', exact: true }).click();
    const editor = record.locator('form[data-editor]');
    await editor.locator('[name=quantity]').fill('24');
    await editor.getByRole('button', { name: 'Save draft changes', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const ownOffer = (await (await page.request.get(`/api/offers/${offer.id}`)).json()).item;
    expect(ownOffer.data.quantity).toBe(24);
    expect(ownOffer.data.categoryId).toBe(category.categoryId);
    expect(ownOffer.data.currency).toBe('PLN');
    await record.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await expect(record.locator('small').first()).toContainText('submitted');
    await expect(record.getByRole('button', { name: 'Edit draft', exact: true })).toHaveCount(0);

    const management = await ownerContext(browser, testInfo.project.use);
    try {
      management.page.on('pageerror', error => errors.push(error.message));
      await helpers.qualifySupplier(owner, offer.id);
      await owner.client.request(`/api/staff/offers/${offer.id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional UI flow source reviewed after four explicit supplier verification stages.' }, expected: 200 });
      await management.page.goto('/portal/admin/?module=opportunities');
      expect((await buyer.client.request('/api/opportunities', { expected: 200 })).data.items).toEqual([]);
      const anonymous = section(management.page, 'Prepare an anonymous commercial opportunity');
      const title = `Reviewed industrial opportunity ${helpers.runId}`;
      await fill(anonymous, {
        sourceOfferId: offer.id, title, specification: 'Reviewed generic non-identifying industrial specification.',
        quantity: '24', unit: 'tonne', price: '1250', incoterms: 'FCA', availability: 'By agreement', validUntil: future,
      });
      await anonymous.locator('[name=categoryId]').selectOption(category.categoryId);
      if (category.subcategoryId) await anonymous.locator('[name=subcategoryId]').selectOption(category.subcategoryId);
      await anonymous.locator('[name=currency]').selectOption('PLN');
      await anonymous.locator('[name=reviewedNonIdentifying]').check();
      const released = management.page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/opportunities' && response.request().method() === 'POST');
      await anonymous.getByRole('button', { name: 'Create restricted anonymous opportunity', exact: true }).click();
      const releaseResponse = await released;
      expect(releaseResponse.status()).toBe(201);
      const card = (await releaseResponse.json()).item;
      const assignment = section(management.page, 'Individual opportunity release').locator('.portal-record').filter({ has: management.page.getByRole('heading', { name: title, exact: true }) });
      await expect(assignment).toBeVisible();
      await assignment.locator('[name=recipientCompanyId]').fill(buyer.companyId);
      await assignment.locator('[name=role]').selectOption('buyer');
      await assignment.getByRole('button', { name: 'Assign anonymous opportunity', exact: true }).click();
      await expect(assignment.locator('.portal-form-message')).toHaveText('Saved securely.');
      const assigned = (await buyer.client.request('/api/opportunities', { expected: 200 })).data.items;
      expect(assigned).toHaveLength(1);
      expect(assigned[0].id).toBe(card.id);
      helpers.assertNoCounterpartySecrets(assigned, [supplier.companyName, supplier.email, supplier.companyId, supplier.user.id, offer.id]);
      expect(await management.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await management.context.close(); }
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('partner edits profile and submits own proposal; assigned project and negotiated commission appear in UI', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await signIn(page, partner, 'partner');
    const profile = section(page, 'Your professional profile');
    await fill(profile, { countries: 'NO, SE', sectors: 'Industrial materials, Logistics', summary: 'Fictional approved partner commercial focus.' });
    await profile.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(profile.locator('.portal-form-message')).toHaveText('Saved securely.');
    const storedProfile = await (await page.request.get('/api/profile')).json();
    expect(storedProfile.profile.countries).toEqual(['NO', 'SE']);
    expect(storedProfile.profile.sectors).toEqual(['Industrial materials', 'Logistics']);
    await page.reload();
    await expect(section(page, 'Your professional profile').locator('[name=countries]')).toHaveValue('NO, SE');
    await expect(section(page, 'Your professional profile').locator('[name=sectors]')).toHaveValue('Industrial materials, Logistics');
    const create = section(page, 'New trade opportunity');
    const title = `Fictional partner proposal ${helpers.runId}`;
    await fill(create, { title, description: 'A fictional opportunity for ShadowBridge screening.', countries: 'NO, SE', sectors: 'Industrial materials', scope: 'Screened cooperation with individually agreed commercial terms.' });
    await create.getByRole('button', { name: 'Save private draft', exact: true }).click();
    const record = page.locator('.portal-record').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(record).toBeVisible();
    await record.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await expect(record.locator('small').first()).toContainText('submitted');
    const projectTitle = `Fictional assigned cooperation ${helpers.runId}`;
    const project = (await owner.client.request('/api/admin/projects', { method: 'POST', body: { partnerCompanyId: partner.companyId, title: projectTitle, summary: 'Approved non-identifying partner scope for local UI verification.', reviewedNonIdentifying: true }, expected: 201 })).data.item;
    const agreementReference = `UI-TERMS-${helpers.runId.toUpperCase()}`;
    await owner.client.request('/api/admin/commissions', { method: 'POST', body: { projectId: project.id, amount: 47.5, currency: 'EUR', agreementReference, reviewedNonIdentifying: true, agreementConfirmed: true }, expected: 201 });
    await page.reload();
    const projects = section(page, 'Assigned cooperation');
    await expect(projects.getByRole('heading', { name: projectTitle, exact: true })).toBeVisible();
    const commission = section(page, 'Individually agreed commissions');
    await expect(commission.getByText(agreementReference, { exact: true })).toBeVisible();
    await expect(commission.getByText('47.50', { exact: true })).toBeVisible();
    await expect(commission.getByText('EUR', { exact: true })).toBeVisible();
    const stored = (await (await page.request.get('/api/proposals')).json()).items;
    expect(stored).toHaveLength(1);
    expect(stored[0].data.title).toBe(title);
    expect(stored[0].status).toBe('submitted');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(errors).toEqual([]);
  });
});
