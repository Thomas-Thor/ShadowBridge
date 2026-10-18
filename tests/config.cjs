const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTestDependency } = require('./dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');

const previewRoot = path.resolve(process.env.SHADOWBRIDGE_TEST_ROOT || path.join(__dirname, '..'));
const port = Number(process.env.SHADOWBRIDGE_TEST_PORT || 8024);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid SHADOWBRIDGE_TEST_PORT');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'private-entry.spec.cjs',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: path.join(os.tmpdir(), 'shadowbridge-private-b2b-test-results'),
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    cwd: previewRoot,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 15_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
