const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadTestDependency } = require('../../tests/dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'ui.spec.cjs', workers:1, retries:0,
  timeout:120000, expect:{timeout:7000}, reporter:[['list']],
  outputDir:path.join(os.tmpdir(),'shadowbridge-market-m1-ui','results'),
  use:{baseURL:'http://127.0.0.1:4175',viewport:{width:1440,height:1000},reducedMotion:'reduce',trace:'off',video:'off',screenshot:'only-on-failure',launchOptions:fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}},
  webServer:{command:'node scripts/preview.mjs',cwd:path.resolve(__dirname,'..'),url:'http://127.0.0.1:4175',reuseExistingServer:false,stdout:'ignore',stderr:'pipe'},
});
