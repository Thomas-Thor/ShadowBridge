const path = require('node:path');
const os = require('node:os');
const { loadTestDependency } = require('./dependencies.cjs');
const { defineConfig } = loadTestDependency('@playwright/test');
if (!process.env.SHADOWBRIDGE_PUBLIC_PREVIEW) throw new Error('Set SHADOWBRIDGE_PUBLIC_PREVIEW to the curated static preview output.');
module.exports = defineConfig({
 testDir: __dirname, testMatch: 'mvp-public.spec.cjs', fullyParallel: true, workers: 2, retries: 0,
 outputDir:path.join(os.tmpdir(),'shadowbridge-mvp-public-results'),
 use:{baseURL:'http://127.0.0.1:8031',browserName:'chromium',launchOptions:{executablePath:'/usr/bin/chromium'},reducedMotion:'reduce',trace:'off'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile-390',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},{name:'mobile-320',use:{viewport:{width:320,height:740},isMobile:true,hasTouch:true}}],
 webServer:{command:'python3 -m http.server 8031 --bind 127.0.0.1',cwd:process.env.SHADOWBRIDGE_PUBLIC_PREVIEW,url:'http://127.0.0.1:8031',reuseExistingServer:false,stdout:'ignore',stderr:'ignore'},
});
