const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadTestDependency } = require('./dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'dashboard.spec.cjs', fullyParallel: false,
  workers: 1, retries: 0, timeout: 45_000, expect: { timeout: 7000 }, reporter: [['list']],
  outputDir: path.join(os.tmpdir(), 'shadowbridge-dashboard-ui-results'),
  use: { baseURL: 'http://127.0.0.1:8042', browserName: 'chromium', viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce', trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {} },
  webServer: { command: 'node tests/dashboard-server.cjs', cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:8042/portal/', reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore' },
});
