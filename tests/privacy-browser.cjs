// See docs/privacy-review.md for prerequisites and the command to run this check.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PRIVACY_TEST_PORT || 8765);
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let browser;
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error('Local test server failed to start');
      try {
        const response = await fetch(origin);
        assert.equal(response.status, 200);
        break;
      } catch (error) {
        if (i === 50) throw error;
        await delay(100);
      }
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const failures = [];
    const screenshots = process.env.PRIVACY_SCREENSHOT_DIR;
    if (screenshots) await fs.mkdir(screenshots, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const remoteRequests = [];
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) {
          remoteRequests.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(error.message));
      // Integrated release: without the secure backend the homepage probes GET /api/config once and
      // locks its enquiry queue. Only that same-origin 404 is tolerated; everything else still fails.
      const probe = url => { const u = new URL(url); return u.origin === origin && u.pathname === '/api/config' && !u.search; };
      page.on('console', message => { if (message.type() === 'error' && !(probe(message.location()?.url || origin + '/x') && /status of 404/.test(message.text()))) failures.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400 && !(response.status() === 404 && response.request().method() === 'GET' && probe(response.url()))) failures.push(`${response.status()} ${response.url()}`); });
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.locator('footer a', { hasText: 'Privacy Policy' }).click();
      assert.equal(new URL(page.url()).pathname, '/privacy/');
      await page.locator('h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.title(), 'Global Privacy Policy | ShadowBridge');
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 18, 17)');
      assert(await page.locator('h1').evaluate(el => getComputedStyle(el).fontFamily.includes('Instrument Serif')));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Policy overflow at ${width}px`);
      assert(await page.getByText('Draft — owner confirmation required.', { exact: true }).isVisible());
      assert.equal(await page.evaluate(() => document.cookie), '');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      for (const href of await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
        assert.equal(await page.locator(href).count(), 1, `Missing anchor ${href}`);
      }
      await page.getByRole('navigation', { name: 'Privacy policy contents' }).getByRole('link', { name: 'Google & n8n' }).click();
      const sectionTop = await page.locator('#google-data').evaluate(el => el.getBoundingClientRect().top);
      const headerBottom = await page.locator('header').evaluate(el => el.getBoundingClientRect().bottom);
      assert(sectionTop >= headerBottom, 'Contents target is covered by sticky header');
      await page.getByRole('link', { name: 'Back to home', exact: true }).click();
      assert.equal(new URL(page.url()).pathname, '/');
      if (width === 1440) {
        // The release replaced the browser-only brief/mailto generator with the private enquiry queue.
        // Without the backend it must stay locked and offer no mailto draft.
        const status = page.locator('#enquiry-status');
        await status.filter({ hasText: 'Nothing can be submitted.' }).waitFor();
        for (const field of await page.locator('#enquiry-form').locator('input, select, textarea, button').all()) assert(await field.isDisabled(), 'Enquiry control unexpectedly enabled');
        assert.equal(await page.locator('#enquiry-form a[href^="mailto:"]').count(), 0);
      }
      if (screenshots) {
        await page.goto(`${origin}/privacy/`, { waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(screenshots, `privacy-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(screenshots, `privacy-top-${width}.png`) });
      }
      assert.deepEqual(remoteRequests, [], 'Page loading or the form unexpectedly contacted an external service');
      await context.close();
      console.log(`PASS: ${width}px navigation, layout, assets and browser privacy checks`);
    }
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await noJs.newPage();
    await page.goto(`${origin}/privacy/`, { waitUntil: 'networkidle' });
    assert(await page.locator('h1').isVisible());
    assert(await page.locator('#rights').isVisible());
    await page.getByRole('link', { name: 'Back to home', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, '/');
    await noJs.close();
    assert.deepEqual(failures, [], 'Browser errors or failed asset requests');
    console.log('PASS: policy remains readable and navigable without JavaScript; no browser errors');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
