const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTestDependency } = require('./dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'session.spec.cjs', fullyParallel: false,
  workers: 1, retries: 0, timeout: 90_000, expect: { timeout: 10_000 },
  reporter: [['list']], outputDir: path.join(os.tmpdir(), 'shadowbridge-real-session-results'),
  use: {
    baseURL: process.env.SHADOWBRIDGE_TEST_URL || 'http://127.0.0.1:8088',
    browserName: 'chromium', viewport: { width: 1440, height: 1000 },
    launchOptions: fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {},
    reducedMotion: 'reduce', trace: 'off', screenshot: 'off', video: 'off',
  },
  // The real local stack is started separately. No mocked routes or credentials
  // in Playwright artifacts; all accounts are random and fictional.
});
