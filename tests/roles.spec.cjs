const { loadTestDependency } = require('./dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');

let h;
let partner, projectId;
const actors = {};
const fullModules = ['Overview', 'Contact queue', 'Applications', 'Companies', 'Offers', 'Buyer requests', 'Partner opportunities', 'Anonymous releases', 'Projects', 'Commissions', 'Activity log', 'Team and access', 'Controlled approvals', 'Categories'];
// Independent role expectations exercise the actual UI and server policies.
// No role claims, authentication responses or permission checks are mocked.
const cases = [
  { role: 'owner', modules: fullModules, module: 'team', heading: 'Team and access' },
  { role: 'general_director', modules: fullModules, module: 'team', heading: 'Team and access' },
  { role: 'operations_manager', modules: fullModules.filter(x => !['Applications', 'Controlled approvals'].includes(x)), module: 'projects', heading: 'Cooperation projects', forbidden: 'applications', deniedApi: '/api/admin/applications' },
  { role: 'procurement_manager', modules: ['Overview', 'Applications', 'Companies', 'Offers', 'Anonymous releases', 'Team and access', 'Categories'], module: 'applications', heading: 'Company applications', forbidden: 'projects', deniedApi: '/api/admin/projects' },
  { role: 'sales_manager', modules: ['Overview', 'Contact queue', 'Applications', 'Companies', 'Offers', 'Buyer requests', 'Anonymous releases', 'Team and access', 'Categories'], module: 'rfqs', heading: 'Buyer request review', forbidden: 'commissions', deniedApi: '/api/admin/commissions' },
  { role: 'compliance_finance', modules: fullModules.filter(x => x !== 'Contact queue'), module: 'commissions', heading: 'Agreed commissions', forbidden: 'contact', deniedApi: '/api/admin/contact-queue' },
  { role: 'staff_analyst', modules: ['Overview'], module: 'overview', heading: 'Command Center Overview', forbidden: 'companies', deniedApi: '/api/admin/companies' },
];

test.describe.serial('Seven real staff panels: login, MFA and desktop/mobile authorization', () => {
  test.beforeAll(async () => {
    h = await import('../server/tests/helpers.mjs');
    if (!['localhost', '127.0.0.1'].includes(new URL(h.appOrigin).hostname)) throw new Error('Fictional role-panel tests are loopback-only');
    const owner = h.bootstrapOwner(await h.verifyActor(await h.registerActor('partner', 'panel-owner')));
    await h.enableMfa(owner); actors.owner = owner;
    for (const { role } of cases.filter(x => x.role !== 'owner')) {
      const actor = await h.verifyActor(await h.registerActor('partner', `panel-${role.replaceAll('_', '-')}`));
      await owner.client.request('/api/staff/roles', { method: 'POST', body: { userId: actor.user.id, role, active: true }, expected: 200 });
      await h.enableMfa(actor); actors[role] = actor;
    }
    partner = await h.verifyActor(await h.registerActor('partner', 'panel-project-recipient'));
    partner.applicationId = h.db(`SELECT id FROM sb.applications WHERE user_id=${h.sqlLiteral(partner.user.id)}`);
    partner.companyId = h.db(`SELECT company_id FROM sb.applications WHERE user_id=${h.sqlLiteral(partner.user.id)}`);
  });

  for (const [index, spec] of cases.entries()) test(`${spec.role}: genuine sign-in/MFA and permitted panels at 1440, 390 and 320 px`, async ({ page }) => {
    const actor = actors[spec.role];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Exercise the actual account-entry and TOTP controls on phones as well,
    // rather than resizing only an already authenticated desktop panel.
    await page.setViewportSize({ width: [1440, 390, 320][index % 3], height: 900 });
    await page.goto('/member-sign-in/');
    const form = page.locator('#sign-in-form');
    await expect(form.locator('[name=email]')).toBeEnabled();
    await form.locator('[name=email]').fill(actor.email);
    await form.locator('[name=password]').fill(actor.password);
    await form.locator('button[type=submit]').click();
    await expect(page.locator('#portal-account')).toContainText(actor.email);
    await page.goto('/portal/admin/');
    await expect(page.getByRole('heading', { name: 'Management security verification', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.portal-metric')).toHaveCount(0);
    expect((await page.request.get('/api/staff/overview')).status()).toBe(403);
    if (Math.floor(Date.now() / 30_000) === Math.floor(actor.mfaVerifiedAt / 30_000)) {
      await new Promise(resolve => setTimeout(resolve, 30_000 - Date.now() % 30_000 + 100));
    }
    await page.getByLabel('Six-digit authenticator code', { exact: true }).fill(h.totp(actor.mfaSecret));
    const verified = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/mfa/verify' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Verify second factor', exact: true }).click();
    expect((await verified).status()).toBe(200);
    await expect(page.getByRole('heading', { name: spec.role === 'owner' ? 'Owner Overview' : 'Command Center Overview', exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Command Center modules', exact: true });
    await expect(nav.getByRole('link')).toHaveText(spec.modules);
    const access = await page.request.get('/api/staff/access');
    expect(access.status()).toBe(200);
    expect((await access.json()).roles).toEqual([spec.role]);

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${spec.role} Overview at ${width}px`).toBe(true);
    }
    await page.goto(`/portal/admin/?module=${spec.module}`);
    await expect(page.getByRole('heading', { name: spec.heading, exact: true })).toBeVisible();
    if (spec.role === 'owner') await expect(page.getByRole('button', { name: 'Reconfirm MFA', exact: true })).toBeVisible();
    if (spec.role === 'general_director') {
      await expect(page.getByRole('button', { name: 'Reconfirm MFA', exact: true })).toHaveCount(0);
      const options = await page.locator('select[name=role] option').allTextContents();
      expect(options).not.toContain('Owner');
      expect(options).not.toContain('General Director / CEO');
      await page.goto('/portal/admin/?module=applications');
      const applicant = page.locator('article.portal-record').filter({ has: page.getByRole('heading', { name: partner.companyName, exact: true }) });
      await expect(applicant).toBeVisible();
      await applicant.locator('[name=decision]').selectOption('approved');
      await applicant.locator('[name=reason]').fill('FICTIONAL director independently approves the verified local partner application.');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/applications/${partner.applicationId}/decision` && response.request().method() === 'POST');
      await applicant.getByRole('button', { name: 'Record application decision', exact: true }).click();
      expect((await saved).status()).toBe(200);
      expect(h.db(`SELECT status FROM sb.memberships WHERE user_id=${h.sqlLiteral(partner.user.id)} AND role='partner'`)).toBe('approved');
    }
    if (spec.role === 'operations_manager') {
      const assignment = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assign partner cooperation', exact: true }) });
      await assignment.locator('[name=partnerCompanyId]').fill(partner.companyId);
      await assignment.locator('[name=title]').fill(`FICTIONAL operations UI project ${h.runId}`);
      await assignment.locator('[name=summary]').fill('Fictional precisely scoped cooperation; no actual transaction or transport.');
      await assignment.locator('[name=reviewedNonIdentifying]').check();
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/projects' && response.request().method() === 'POST');
      await assignment.getByRole('button', { name: 'Assign partner project', exact: true }).click();
      const response = await saved;
      expect(response.status()).toBe(201);
      projectId = (await response.json()).item.id;
      expect((await partner.client.request('/api/projects', { expected: 200 })).data.items.some(item => item.id === projectId)).toBe(true);
    }
    if (spec.role === 'compliance_finance') {
      expect(projectId).toBeTruthy();
      const commission = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Record an agreed partner commission', exact: true }) });
      await commission.locator('[name=projectId]').fill(projectId);
      await commission.locator('[name=amount]').fill('50');
      await commission.locator('[name=currency]').selectOption('EUR');
      await commission.locator('[name=agreementReference]').fill(`FICTIONAL-${h.runId.toUpperCase()}`);
      await commission.locator('[name=reviewedNonIdentifying]').check();
      await commission.locator('[name=agreementConfirmed]').check();
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/commissions' && response.request().method() === 'POST');
      await commission.getByRole('button', { name: 'Record agreed commission', exact: true }).click();
      expect((await saved).status()).toBe(201);
      const terms = (await partner.client.request('/api/commissions', { expected: 200 })).data.items.find(item => item.projectId === projectId);
      expect(Number(terms.amount)).toBe(50);
      expect(terms.currency).toBe('EUR');
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${spec.role} module at ${width}px`).toBe(true);
    }
    if (spec.forbidden) {
      await page.goto(`/portal/admin/?module=${spec.forbidden}`);
      await expect(page.locator('#portal-status')).toContainText('Module unavailable.');
      await expect(page.locator('#portal-content .portal-record, #portal-content form')).toHaveCount(0);
      expect((await page.request.get(spec.deniedApi)).status()).toBe(403);
    }
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#sign-in-form [name=email]')).toBeEnabled();
    expect((await (await page.request.get('/api/session')).json()).user).toBeNull();
  });
});
