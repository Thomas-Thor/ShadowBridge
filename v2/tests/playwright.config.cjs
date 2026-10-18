const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Use the cloud machine's Chromium when available. Other machines can install
// Playwright's pinned browser with `npx playwright install chromium`.
const systemChromium = '/usr/bin/chromium';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (fs.existsSync(systemChromium) ? systemChromium : undefined);

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.cjs',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: path.resolve(__dirname, '../test-results'),
  use: {
    baseURL: 'http://127.0.0.1:8000/v2/',
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'off',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'python3 -m http.server 8000 --bind 127.0.0.1',
    cwd: path.resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:8000/v2/',
    reuseExistingServer: true,
    timeout: 15_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
