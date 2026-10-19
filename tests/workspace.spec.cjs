const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
let h, owner, supplier, category, food, offers;
async function staffPage(browser, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addCookies([...owner.client.cookies].map(([name, value]) => ({ name, value, url: h.appOrigin, httpOnly: true, sameSite: 'Lax' })));
  const page = await context.newPage(); await page.goto('/portal/offers/');
  await expect(page.locator('#offers-workspace')).toBeVisible();
  await page.locator('#offers-search').fill(`Workspace ${h.runId}`);
  await expect(page.locator('#offers-count')).toContainText('of 25 accessible offers');
  return { context, page };
}
function action(page, name) { return page.locator('details.offer-action').filter({ has: page.getByText(name, { exact: true }) }); }
async function submitAction(page, title, values, submitLabel) {
  const section = action(page, title); await section.locator('summary').click();
  for (const [name, value] of Object.entries(values)) {
    const input = section.locator(`[name=${name}]`);
    if (await input.evaluate(el => el.tagName === 'SELECT')) await input.selectOption(value);
    else await input.fill(value);
  }
  const saved = page.waitForResponse(response => response.url().includes('/api/staff/offers/') && response.request().method() === 'POST');
  await section.getByRole('button', { name: submitLabel, exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('details.offer-action[open]')).toHaveCount(0);
}
test.describe.serial('Real offers workspace: bounded data, reviewed source, permissions and responsive cards', () => {
  test.beforeAll(async () => {
    h = await import('../server/tests/helpers.mjs');
    owner = h.bootstrapOwner(await h.verifyActor(await h.registerActor('partner', 'workspace-owner')));
    await h.enableMfa(owner);
    supplier = await h.verifyActor(await h.registerActor('supplier', 'workspace-supplier'));
    const application = h.db(`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(supplier.user.id)}`);
    await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional local workspace fixture approved after real email confirmation.' }, expected: 200 });
    category = await h.catalogCategory(owner.client); food = await h.catalogCategory(owner.client, 'food-agriculture');
    offers = [];
    for (let index = 1; index <= 25; index++) {
      const result = await supplier.client.request('/api/offers', { method: 'POST', body: { data: {
        ...category, productName: `Workspace ${h.runId} material ${String(index).padStart(2, '0')}`,
        specification: 'Fictional industrial local test material, no goods available.', countryOfOrigin: 'NO',
        quantity: index, unit: 'kg', price: index * 10, currency: 'PLN', incoterms: 'FCA',
        dimensions: 'Fictional 120 x 80 cm', weight: 'Fictional 25 kg', packaging: 'Fictional pallet', transport: 'Fictional road test',
      } }, expected: 201 });
      offers.push(result.data.item);
      await supplier.client.request(`/api/offers/${result.data.item.id}/submit`, { method: 'POST', body: {}, expected: 200 });
    }
  });
  test('cards paginate, authorized classification edits persist, supplier qualification is sequential and decisions are audited', async ({ browser }) => {
    const { context, page } = await staffPage(browser); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await expect(page.locator('.offer-card')).toHaveCount(12);
      await page.locator('#offers-limit').selectOption('24');
      await expect(page.locator('.offer-card')).toHaveCount(24);
      await page.locator('#offers-next').click(); await expect(page.locator('.offer-card')).toHaveCount(1);
      await page.locator('#offers-previous').click(); await expect(page.locator('.offer-card')).toHaveCount(24);
      await page.locator('#offers-sort').selectOption('oldest');
      await page.getByRole('button', { name: new RegExp(`material 01 — ${offers[0].id}`) }).click();
      await expect(page.locator('#offer-detail')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Photos & documents', exact: true })).toBeVisible();
      await expect(page.locator('#offer-detail-body')).toContainText('not enabled');
      await submitAction(page, 'Edit commercial details & category', { categoryId: food.categoryId, subcategoryId: food.subcategoryId || '', price: '257.50', currency: 'PLN' }, 'Save and require a fresh review');
      const stored = (await owner.client.request(`/api/staff/offers/${offers[0].id}`, { expected: 200 })).data.item;
      expect(stored.data.categoryId).toBe(food.categoryId); expect(stored.data.currency).toBe('PLN'); expect(stored.data.price).toBe(257.5);
      await submitAction(page, 'Assign responsibility', { responsible: 'me' }, 'Update responsibility');
      await expect(page.locator('#offer-detail-body')).toContainText('Assigned to you');
      for (const [stage, name] of [['company', 'Company verification'], ['right_to_sell', 'Right to sell'], ['documents_goods', 'Documents & goods'], ['decision', 'Decision']]) {
        await submitAction(page, `Supplier review: ${name}`, { stage, sellerKind: 'stock_owner', decision: 'verified', reason: `Fictional local evidence checked for ${stage}; no actual counterparty.`, evidenceReference: `FICTIONAL-UI-${stage}` }, 'Save supplier verification stage');
      }
      await submitAction(page, 'Review source evidence', { sourceKind: 'supplier_owned', reason: 'Fictional local ownership evidence reviewed. This is not an actual commercial offer.' }, 'Record source review');
      await submitAction(page, 'Record offer decision', { decision: 'rejected', reason: 'Fictional rejected offer decision recorded to test authorized operational review.' }, 'Save decision');
      await expect(page.locator('#offer-detail-body > .offer-detail-reference .offer-status')).toHaveText('Rejected');
      await submitAction(page, 'Record offer decision', { decision: 'approved', reason: 'Fictional source and supplier checks completed for this local test.' }, 'Save decision');
      await expect(page.locator('#offer-detail-body > .offer-detail-reference .offer-status')).toHaveText('Approved');
      await submitAction(page, 'Record offer decision', { decision: 'archived', reason: 'Fictional offer archived after the local test to verify the decision history.' }, 'Save decision');
      await expect(page.locator('#offer-detail-body > .offer-detail-reference .offer-status')).toHaveText('Archived');
      await expect(page.getByRole('heading', { name: 'Internal decision records', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close detail', exact: true }).click();
      await page.locator('#offers-category').selectOption(food.categoryId);
      await expect(page.locator('.offer-card')).toHaveCount(1);
      await expect(page.locator('#offers-count')).toContainText('of 1 accessible offers');
      if (food.subcategoryId) { await page.locator('#offers-subcategory').selectOption(food.subcategoryId); await expect(page.locator('.offer-card')).toHaveCount(1); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
  test('mobile cards and detail remain readable; supplier cannot access staff workspace or source decisions', async ({ browser }) => {
    const { context, page } = await staffPage(browser, { width: 320, height: 740 });
    try {
      await expect(page.locator('.offer-card')).toHaveCount(12);
      await page.locator('.offer-card').first().click();
      await expect(page.locator('#offer-detail')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('#offer-detail').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const denied = await supplier.client.request('/api/staff/offers'); expect([401, 403]).toContain(denied.status);
      const mutation = await supplier.client.request(`/api/staff/offers/${offers[0].id}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional unauthorized supplier direct API bypass attempt.' } }); expect([401, 403]).toContain(mutation.status);
      expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    } finally { await context.close(); }
  });
});
