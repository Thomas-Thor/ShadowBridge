const { test, expect } = require('@playwright/test');

test.use({ baseURL: 'http://127.0.0.1:8000/' });

const pages = [
  'index.html',
  'docs/index.html',
  'quick-register.html',
  'agent-registration.html',
  'clients/client-registration.html',
  'suppliers/supplier-registration.html',
];
const registrations = [
  { role: 'agent', path: 'agent-registration.html', form: '#agentRegistrationForm' },
  { role: 'client', path: 'clients/client-registration.html', form: '#clientRegistrationForm' },
  { role: 'supplier', path: 'suppliers/supplier-registration.html', form: '#supplierRegistrationForm' },
];
const origin = 'http://127.0.0.1:8000';
const fontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

async function guardLegacyNetwork(page) {
  const state = { runtimeErrors: [], missingAssets: [], apiCalls: [], unexpectedDialogs: [] };
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (fontHosts.has(url.hostname)) return route.abort('blockedbyclient');
    // Never let a regression contact the historical backend during a local test.
    // Record the attempted request so this protection cannot hide a failure.
    if (['fetch', 'xhr'].includes(request.resourceType())
      && (url.origin !== origin || /\/(auth|dashboard)\//.test(url.pathname))) {
      state.apiCalls.push(`${request.method()} ${url.href}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('pageerror', error => state.runtimeErrors.push(error.message));
  page.on('dialog', dialog => {
    state.unexpectedDialogs.push(dialog.message());
    return dialog.dismiss();
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    // Only the explicitly aborted Google Fonts requests are outside this check.
    if (location && fontHosts.has(new URL(location).hostname)) return;
    state.runtimeErrors.push(message.text());
  });
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      state.missingAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(origin)) {
      state.missingAssets.push(`${request.failure()?.errorText} ${request.url()}`);
    }
  });
  return state;
}

function expectHealthy(state) {
  expect(state.runtimeErrors).toEqual([]);
  expect(state.missingAssets).toEqual([]);
  expect(state.apiCalls).toEqual([]);
  expect(state.unexpectedDialogs).toEqual([]);
}

test('legacy: all six preserved pages load local assets without runtime errors or historical API calls', async ({ page }) => {
  const state = await guardLegacyNetwork(page);
  for (const path of pages) {
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response.status(), path).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    if (path === 'index.html' || path === 'docs/index.html') {
      // Retain the legacy entry points that used to call missing functions.
      await page.evaluate(() => window.showRegistration());
      const modal = page.locator(path.startsWith('docs/') ? '.modal-overlay' : '#registration-modal');
      await expect(modal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(modal).not.toBeVisible();
    }
    expectHealthy(state);
  }
});

test('legacy: four registration handlers report unavailable, store nothing and reject forged local authentication', async ({ page }) => {
  const state = await guardLegacyNetwork(page);
  const forms = [...registrations, { path: 'quick-register.html', form: '#quickRegistrationForm' }];
  for (const { path, form } of forms) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    // Dispatch the actual submit event to exercise the guarded handler even
    // without supplying the large legacy form's required commercial fields.
    const submitCancelled = await page.locator(form).evaluate(element =>
      !element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(submitCancelled, `${path} must prevent native form submission`).toBe(true);
    await expect(page.locator('#legacy-status')).toContainText(/registration is unavailable/i);
    await expect(page.locator('#legacy-status')).toContainText(/nothing has been submitted or saved/i);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    expectHealthy(state);
  }
  for (const { role, path } of registrations) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.evaluate(value => {
      localStorage.setItem('cartelUser', JSON.stringify({ role: value, name: 'Forged test identity' }));
      localStorage.setItem('cartel_token', 'forged-test-token');
      localStorage.setItem('cartel_user', JSON.stringify({ role: value }));
    }, role);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#registration-form')).toBeVisible();
    await expect(page.locator(`#${role}-dashboard`)).not.toBeVisible();
    expect(await page.evaluate(() => window.CartelApp.checkAuth())).toBe(false);
    await page.evaluate(() => localStorage.clear());
    expectHealthy(state);
  }
});

test('legacy: three explicit dashboard previews retain sample banners and working tabs', async ({ page }) => {
  const state = await guardLegacyNetwork(page);
  for (const { role, path } of registrations) {
    await page.goto(`${path}?preview=1`, { waitUntil: 'networkidle' });
    const dashboard = page.locator(`#${role}-dashboard`);
    await expect(dashboard).toBeVisible();
    await expect(page.locator('#registration-form')).not.toBeVisible();
    const banner = dashboard.locator(':scope > .legacy-notice').filter({ hasText: 'PRESERVED DASHBOARD PREVIEW' });
    await expect(banner).toContainText(/sample data only/i);
    await expect(banner).toContainText(/authentication, business actions and downloads are unavailable/i);
    const tab = dashboard.locator('.tab-button').nth(1);
    const target = (await tab.getAttribute('onclick')).match(/showTab\('([^']+)'\)/)?.[1];
    expect(target).toBeTruthy();
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    await expect(dashboard.locator('.tab-content.active')).toHaveCount(1);
    await expect(dashboard.locator(`#${target}-tab`)).toBeVisible();
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expectHealthy(state);
  }
});
