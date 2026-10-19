const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
let helpers, owner, buyerA, buyerB;

async function login(page, actor) {
  await page.goto('/member-sign-in/');
  const form = page.locator('#sign-in-form');
  await expect(form.locator('[name=email]')).toBeEnabled();
  await form.locator('[name=email]').fill(actor.email);
  await form.locator('[name=password]').fill(actor.password);
  await form.locator('button[type=submit]').click();
  await expect(page.locator('#portal-status')).toContainText('Approved account.');
}

async function ownBuyer(page, actor) {
  await login(page, actor);
  await page.goto('/portal/buyer/');
  await expect(page.getByRole('heading', { name: 'New purchase request', exact: true })).toBeVisible();
  await expect(page.locator('#portal-account')).toContainText(actor.email);
}

async function noPrivateDOM(page, forbidden) {
  await expect(page.locator('#portal-status')).toContainText('Browser session changed.');
  await expect(page.locator('#portal-content .portal-section, #portal-content .portal-record, #portal-content form')).toHaveCount(0);
  await expect(page.locator('#portal-navigation')).toBeHidden();
  await expect(page.locator('#portal-account')).not.toContainText(forbidden);
  await expect(page.locator('#portal-content input, #portal-content textarea')).toHaveCount(0);
}

test.describe('Real two-tab account and session safety', () => {
  test.beforeAll(async () => {
    helpers = await import('../server/tests/helpers.mjs');
    if (!['localhost', '127.0.0.1'].includes(new URL(helpers.appOrigin).hostname)) throw new Error('Fictional session tests are local-only');
    owner = await helpers.verifyActor(await helpers.registerActor('partner', 'tabs-owner'));
    helpers.bootstrapOwner(owner);
    await helpers.enableMfa(owner);
    buyerA = await helpers.verifyActor(await helpers.registerActor('buyer', 'tabs-buyer-a'));
    buyerB = await helpers.verifyActor(await helpers.registerActor('buyer', 'tabs-buyer-b'));
    for (const actor of [buyerA, buyerB]) {
      const application = helpers.db(`SELECT id FROM sb.applications WHERE user_id=${helpers.sqlLiteral(actor.user.id)}`);
      await owner.client.request(`/api/admin/applications/${application}/decision`, { method: 'POST', body: { decision: 'approved', reason: 'Fictional local two-tab browser regression with real authentication' }, expected: 200 });
    }
  });

  test('another tab can open without breaking Save or Sign out; logout clears private DOM in both tabs', async ({ context, page }) => {
    await ownBuyer(page, buyerA);
    const other = await context.newPage();
    await other.goto('/portal/buyer/');
    await expect(other.getByRole('heading', { name: 'New purchase request', exact: true })).toBeVisible();
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'New purchase request', exact: true }) });
    const title = `FICTIONAL multi-tab draft ${helpers.runId}`;
    await section.locator('[name=product]').fill(title);
    const category = await helpers.catalogCategory(owner.client);
    await section.locator('[name=categoryId]').selectOption(category.categoryId);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/rfqs' && response.request().method() === 'POST');
    await section.getByRole('button', { name: 'Save private draft', exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await other.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(other.locator('#sign-in-form [name=email]')).toBeEnabled();
    await noPrivateDOM(page, buyerA.email);
    const current = await page.request.get('/api/session');
    expect((await current.json()).user).toBeNull();
    expect((await page.request.get('/api/rfqs')).status()).toBe(401);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  });

  test('logging another account into the same browser clears the old company and unsaved draft', async ({ context, page }) => {
    await ownBuyer(page, buyerA);
    await page.locator('#portal-content [name=product]').first().fill('FICTIONAL unsaved A-only draft');
    const other = await context.newPage();
    await login(other, buyerB);
    await noPrivateDOM(page, buyerA.email);
    await expect(page.locator('#portal-content')).not.toContainText(buyerB.companyName);
    await expect(page.locator('#portal-content')).not.toContainText('FICTIONAL unsaved A-only draft');
    const current = await other.request.get('/api/session');
    expect((await current.json()).user.id).toBe(buyerB.user.id);
    const ownRFQs = await other.request.get('/api/rfqs');
    expect((await ownRFQs.json()).items).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'New purchase request', exact: true })).toBeVisible();
    await expect(page.locator('#portal-account')).toContainText(buyerB.email);
    await expect(page.locator('#portal-content')).not.toContainText(`FICTIONAL multi-tab draft ${helpers.runId}`);
  });

  test('focus revalidates and clears a stale account even when BroadcastChannel is unavailable', async ({ context, page }) => {
    await page.addInitScript(() => { globalThis.BroadcastChannel = undefined; });
    await ownBuyer(page, buyerA);
    await page.locator('#portal-content [name=product]').first().fill('FICTIONAL focus-only draft');
    const other = await context.newPage();
    await login(other, buyerB);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await noPrivateDOM(page, buyerA.email);
    await expect(page.locator('#portal-content')).not.toContainText('FICTIONAL focus-only draft');
  });

  test('a stale draft cannot be saved as a replacement account even without broadcast or focus', async ({ context, page }) => {
    await page.addInitScript(() => { globalThis.BroadcastChannel = undefined; });
    await ownBuyer(page, buyerA);
    await page.locator('#portal-content [name=product]').first().fill('FICTIONAL must never be saved as B');
    const category = await helpers.catalogCategory(owner.client);
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'New purchase request', exact: true }) }).locator('[name=categoryId]').selectOption(category.categoryId);
    const writes = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/rfqs' && request.method() === 'POST') writes.push(true);
    });
    const other = await context.newPage();
    await login(other, buyerB);
    // Exercise the real form handler in the background tab without generating
    // focus. Its session preflight must reject before any business POST.
    await page.evaluate(() => {
      const form = [...document.querySelectorAll('#portal-content form')].find(node => node.querySelector('[name=product]'));
      form.requestSubmit();
    });
    await expect(page.locator('#portal-content form')).toHaveCount(0);
    await expect(page.locator('#portal-navigation')).toBeHidden();
    expect(writes).toEqual([]);
    const records = await other.request.get('/api/rfqs');
    expect(records.status()).toBe(200); expect((await records.json()).items).toEqual([]);
  });

  test('two browser profiles can use different accounts without sharing logout or private records', async ({ browser }) => {
    const profileA = await browser.newContext(), profileB = await browser.newContext();
    try {
      const pageA = await profileA.newPage(), pageB = await profileB.newPage();
      await ownBuyer(pageA, buyerA); await ownBuyer(pageB, buyerB);
      await pageA.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(pageA.locator('#sign-in-form [name=email]')).toBeEnabled();
      await pageB.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(pageB.getByRole('heading', { name: 'New purchase request', exact: true })).toBeVisible();
      await expect(pageB.locator('#portal-account')).toContainText(buyerB.email);
      const data = await pageB.request.get('/api/rfqs');
      expect(data.status()).toBe(200); expect((await data.json()).items).toEqual([]);
      expect(await pageB.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    } finally { await profileA.close(); await profileB.close(); }
  });

  test('owner overview stays concise and team grants use real owner MFA with auditable revocation', async ({ page }) => {
    const privateLists = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (['/api/admin/offers', '/api/admin/rfqs', '/api/admin/applications', '/api/admin/contact-queue'].includes(path)) privateLists.push(path);
    });
    await page.context().addCookies([...owner.client.cookies].map(([name, value]) => ({ name, value, url: helpers.appOrigin, httpOnly: true, sameSite: 'Lax' })));
    await page.goto('/portal/admin/');
    await expect(page.getByRole('heading', { name: 'Owner Overview', exact: true })).toBeVisible();
    await expect(page.locator('.portal-metric').first()).toBeVisible();
    const recent = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recent activity', exact: true }) });
    expect(await recent.locator('.portal-record').count()).toBeLessThanOrEqual(12);
    expect(privateLists).toEqual([]);
    await page.goto('/portal/admin/?module=team');
    const team = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Team and access', exact: true }) });
    await team.getByRole('button', { name: 'Reconfirm MFA', exact: true }).click();
    // A new real time step avoids reusing the enrollment code. No provider or
    // authorization response is mocked, and no secret enters an artifact.
    if (Math.floor(Date.now() / 30_000) === Math.floor(owner.mfaVerifiedAt / 30_000)) {
      await new Promise(resolve => setTimeout(resolve, 30_000 - Date.now() % 30_000 + 100));
    }
    await team.getByLabel('Six-digit authenticator code', { exact: true }).fill(helpers.totp(owner.mfaSecret));
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/mfa/verify' && response.request().method() === 'POST');
    const refreshedPage = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
    await team.getByRole('button', { name: 'Confirm owner security', exact: true }).click();
    expect((await verified).status()).toBe(200);
    await refreshedPage;
    await expect(team.getByRole('button', { name: 'Reconfirm MFA', exact: true })).toBeVisible();
    const grant = team.locator('form').filter({ has: page.locator('[name=role]') });
    await grant.locator('[name=userId]').selectOption(buyerB.user.id);
    await grant.locator('[name=role]').selectOption('staff_analyst');
    await grant.locator('[name=active]').check();
    const granted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/roles' && response.request().method() === 'POST');
    await grant.getByRole('button', { name: 'Save role grant', exact: true }).click();
    expect((await granted).status()).toBe(200);
    expect(helpers.db(`SELECT active FROM sb.staff_role_assignments WHERE user_id=${helpers.sqlLiteral(buyerB.user.id)} AND role_key='staff_analyst'`)).toBe('t');
    await grant.locator('[name=userId]').selectOption(buyerB.user.id);
    await grant.locator('[name=role]').selectOption('staff_analyst');
    await grant.locator('[name=active]').uncheck();
    const revoked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff/roles' && response.request().method() === 'POST');
    await grant.getByRole('button', { name: 'Save role grant', exact: true }).click();
    expect((await revoked).status()).toBe(200);
    expect(helpers.db(`SELECT active FROM sb.staff_role_assignments WHERE user_id=${helpers.sqlLiteral(buyerB.user.id)} AND role_key='staff_analyst'`)).toBe('f');
    expect(Number(helpers.db(`SELECT count(*) FROM sb.audit_events WHERE actor_id=${helpers.sqlLiteral(owner.user.id)} AND resource='sb.staff_role_assignments' AND metadata->>'active'='false'`))).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
