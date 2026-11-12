// Browser check for the homepage banner and hero globe. Needs Node, Playwright and Chromium.
// Run from the repository root: node tests/homepage-graphics-browser.cjs
// Optional: CHROMIUM_PATH, HOMEPAGE_TEST_PORT, HOMEPAGE_SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.HOMEPAGE_TEST_PORT || 8766);
const origin = `http://127.0.0.1:${port}`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const viewports = [['desktop', 1440, 900, 'sb-banner-2000.webp', 2000 / 414], ['tablet', 820, 1180, 'sb-banner-1000.webp', 2000 / 414],
  ['mobile', 390, 844, 'sb-banner-mobile-760.webp', 1130 / 414], ['small', 320, 640, 'sb-banner-mobile-760.webp', 1130 / 414]];

(async () => {
  let browser;
  try {
    for (let i = 0; ; i++) {
      try { assert.equal((await fetch(origin)).status, 200); break; } catch (error) { if (i === 50) throw error; await delay(100); }
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const [name, width, height, banner, ratio] of viewports) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
      const problems = [];
      page.on('pageerror', e => problems.push(e.message));
      page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
      page.on('requestfailed', r => problems.push(`failed ${r.url()}`));
      await page.goto(origin + '/', { waitUntil: 'networkidle' });
      const m = await page.evaluate(() => {
        const a = document.querySelector('.site-banner img'), g = document.querySelector('.global-bridge');
        const ra = a.getBoundingClientRect(), rg = g.getBoundingClientRect(), h = document.querySelector('.site-header').getBoundingClientRect();
        const r = document.createRange(); r.selectNodeContents(document.querySelector('#hero-title'));
        return { banner: a.currentSrc.split('/').pop(), aRatio: ra.width / ra.height, aTop: ra.top, headerBottom: h.bottom, gRatio: rg.width / rg.height,
          gLoaded: g.complete && g.naturalWidth > 0, aLoaded: a.complete && a.naturalWidth > 0, hscroll: document.documentElement.scrollWidth > innerWidth,
          heroTop: document.querySelector('#home').getBoundingClientRect().top, bannerBottom: ra.bottom };
      });
      assert.equal(m.banner, banner, name);
      assert.ok(Math.abs(m.aRatio - ratio) < 0.02, `${name} banner not distorted`);
      assert.ok(Math.abs(m.gRatio - 953 / 685) < 0.02, `${name} globe not distorted`);
      assert.ok(m.aLoaded && m.gLoaded, `${name} images loaded`);
      assert.ok(Math.abs(m.aTop - m.headerBottom) <= 1, `${name} banner directly under the header`);
      assert.ok(m.heroTop >= m.bannerBottom, `${name} banner above the hero`);
      assert.equal(m.hscroll, false, `${name} no horizontal scroll`);
      assert.deepEqual(problems, [], name);
      if (process.env.HOMEPAGE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.HOMEPAGE_SCREENSHOT_DIR, `homepage-${name}.png`) });
      await page.close();
      console.log(`PASS ${name}`);
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
