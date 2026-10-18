const path = require('node:path');

// Reuse the existing cloud test tools. No dependency installation is performed.
// On another machine use NODE_PATH or SHADOWBRIDGE_TEST_MODULES to point at an
// existing installation of @playwright/test and @axe-core/playwright.
function loadTestDependency(name) {
  const roots = [
    process.env.SHADOWBRIDGE_TEST_MODULES,
    ...((process.env.NODE_PATH || '').split(path.delimiter)),
    '/workspace/ShadowBridge/v2/node_modules',
  ].filter(Boolean);
  try { return require(name); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    for (const root of roots) {
      try { return require(path.join(root, name)); } catch (candidateError) {
        if (candidateError.code !== 'MODULE_NOT_FOUND') throw candidateError;
      }
    }
    throw new Error(`Missing existing test tool ${name}. Set SHADOWBRIDGE_TEST_MODULES; no packages were installed.`);
  }
}

module.exports = { loadTestDependency };
