const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadTestDependency } = require('./dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'member-access.spec.cjs', fullyParallel: false,
  workers: 1, retries: 0, timeout: 30_000, expect: { timeout: 5000 }, reporter: [['list']],
  outputDir: path.join(os.tmpdir(), 'shadowbridge-member-access-results'),
  use: { baseURL: 'http://127.0.0.1:8044', browserName: 'chromium', reducedMotion: 'reduce',
    trace: 'off', video: 'off', screenshot: 'off',
    launchOptions: fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {} },
  webServer: { command: 'node tests/member-access-server.cjs', cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:8044/', reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore' },
});
