// Browser verification for generated artifacts. Run after both build scripts:
// node v2/tests/check-exports.cjs [production-directory] [review-directory] [preview-directory]
// SHADOWBRIDGE_EXPORT_SCREENSHOTS=/tmp/path optionally saves review PNGs.
const { chromium, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const repository = path.resolve(__dirname, '../..');
const production = path.resolve(process.argv[2] || '/workspace/exports/shadowbridge-v2-production');
const review = path.resolve(process.argv[3] || path.join(repository, 'review'));
const preview = path.resolve(process.argv[4] || '/workspace/exports/shadowbridge-v2-preview');
const recipient = 'shadowbridge.trade@gmail.com';
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

async function serve(directory) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let filename = path.resolve(directory, `.${pathname}`);
      if (filename !== directory && !filename.startsWith(`${directory}${path.sep}`)) throw new Error('Outside output');
      if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      const content = await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function checkArtifact(browser, artifact, viewport) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: 'reduce',
    acceptDownloads: true,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
  });
  const page = await context.newPage();
  const problems = [];
  const outgoing = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => problems.push(`${request.failure()?.errorText} ${request.url()}`));
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) || ['fetch', 'xhr'].includes(request.resourceType())) outgoing.push(request.url());
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(artifact.home).origin) outgoing.push(request.url());
  });
  try {
    await page.goto(artifact.home);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#hero-title')).toBeVisible();
    await assertNoOverflow(page);
    await expect(page.locator('#business-contact a')).toHaveAttribute('href', `mailto:${recipient}`);
    if (artifact.name === 'production') {
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://shadow-bridge.eu/');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index,\s*follow/i);
      expect(await page.locator('body').innerText()).not.toMatch(/DESIGN PREVIEW|UNPUBLISHED PREVIEW/);
    } else {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
      if (artifact.name === 'preview') await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    }
    if (process.env.SHADOWBRIDGE_EXPORT_SCREENSHOTS && artifact.name === 'review') {
      await fs.mkdir(process.env.SHADOWBRIDGE_EXPORT_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SHADOWBRIDGE_EXPORT_SCREENSHOTS,
        viewport.width > 500 ? 'desktop.png' : 'mobile.png'), fullPage: true });
    }

    const toggle = page.locator('#nav-toggle');
    if (await toggle.isVisible()) await toggle.click();
    await page.locator('#primary-nav a[href="#industries"]').click();
    await expect(page).toHaveURL(/#industries$/);
    await page.locator('[data-industry="water"]').click();
    await page.locator('#industry-enquiry').click();
    await page.locator('[data-enquiry-role="supplier"]').click();
    await expect(page.locator('#enquiry-role')).toHaveValue('supplier');
    for (const [name, value] of Object.entries({
      name: 'Łucja Export', email: 'lucja@example.com', company: 'Export & Co.',
      message: 'Dzień dobry,\nComplete export review enquiry: 100% of details & terms.',
    })) await page.locator(`#enquiry-form [name="${name}"]`).fill(value);
    await page.evaluate(() => {
      window.__exportDrafts = [];
      document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a[href]');
        if (!anchor || !anchor.getAttribute('href').startsWith('mailto:')) return;
        event.preventDefault();
        window.__exportDrafts.push(anchor.getAttribute('href'));
      }, true);
    });
    await page.locator('#prepare-email').click();
    const drafts = await page.evaluate(() => window.__exportDrafts);
    expect(drafts).toHaveLength(1);
    const draft = new URL(drafts[0]);
    expect(decodeURIComponent(draft.pathname)).toBe(recipient);
    expect([...draft.searchParams.keys()].sort()).toEqual(['body', 'subject']);
    const body = draft.searchParams.get('body');
    for (const expected of ['Łucja Export', 'lucja@example.com', 'Export & Co.', 'Supplier / manufacturer',
      'Water & beverages', 'Dzień dobry,\nComplete export review enquiry: 100% of details & terms.']) expect(body).toContain(expected);
    await expect(page.locator('#enquiry-status')).toContainText('not been sent');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-brief').click();
    const download = await downloadPromise;
    const downloaded = await fs.readFile(await download.path(), 'utf8');
    expect(downloaded).toBe(body);

    await page.getByRole('link', { name: 'C.A.R.T.E.L. Division', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('C.A.R.T.E.L.');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
    await expect(page.locator('form, input, [id$="-dashboard"]')).toHaveCount(0);
    await assertNoOverflow(page);
    if (artifact.name === 'production') {
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://shadow-bridge.eu/cartel/');
      expect(await page.locator('body').innerText()).not.toMatch(/DESIGN PREVIEW|UNPUBLISHED PREVIEW/);
    }
    if (process.env.SHADOWBRIDGE_EXPORT_SCREENSHOTS && artifact.name === 'review') {
      await page.screenshot({ path: path.join(process.env.SHADOWBRIDGE_EXPORT_SCREENSHOTS,
        viewport.width > 500 ? 'cartel-desktop.png' : 'cartel-mobile.png'), fullPage: true });
    }
    const initialInformation = await page.locator('main').innerText();
    const restrictedUrl = new URL(page.url());
    restrictedUrl.search = '?access=cartel&preview=1';
    await page.goto(restrictedUrl.href);
    expect(await page.locator('main').innerText()).toBe(initialInformation);
    await page.getByRole('link', { name: 'Return to ShadowBridge', exact: true }).click();
    await expect(page.locator('#hero-title')).toBeVisible();
    expect(page.url().split('#')[0]).toBe(artifact.home);
    expect(problems).toEqual([]);
    expect(outgoing).toEqual([]);
    console.log(`PASS ${artifact.name} ${viewport.width}px: assets, layout, navigation, mailto, full brief, restricted page and return`);
  } finally {
    await context.close();
  }
}

(async () => {
  const { server, origin } = await serve(production);
  // Use loopback for the offline export too: managed cloud Chromium blocks
  // file:// navigation by policy. Never disable that browser policy.
  const { server: reviewServer, origin: reviewOrigin } = await serve(review);
  const { server: previewServer, origin: previewOrigin } = await serve(preview);
  const hasSystemChromium = await fs.access('/usr/bin/chromium').then(() => true, () => false);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (hasSystemChromium ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    expect(await fs.readFile(path.join(preview, 'robots.txt'), 'utf8')).toMatch(/Disallow:\s*\//);
    expect(await fs.stat(path.join(preview, 'sitemap.xml')).then(() => true, () => false)).toBe(false);
    for (const artifact of [
      { name: 'production', home: `${origin}/` },
      { name: 'review', home: `${reviewOrigin}/ShadowBridge-V2.html` },
      { name: 'preview', home: `${previewOrigin}/` },
    ]) {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await checkArtifact(browser, artifact, viewport);
      }
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => reviewServer.close(resolve));
    await new Promise(resolve => previewServer.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
