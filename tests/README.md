# Targeted frontend checks

These checks exercise only the new application/sign-in pages and fictional workspace designs, plus two short regression checks for the preserved Gmail draft and C.A.R.T.E.L. footer route. They do not test authentication or a backend: neither exists in this phase.

No package installation is required in this cloud environment:

```bash
cd /workspace/ShadowBridge-private-b2b
node /workspace/ShadowBridge/v2/node_modules/@playwright/test/cli.js test --config tests/config.cjs
```

The tests start an isolated loopback-only Python server on port `8024`, use the existing Chromium, and run at widths `1440`, `390` and `320`. No service is published. Browser results and failure traces are written under the system temporary directory.

To check a curated preview export rather than the source checkout, set `SHADOWBRIDGE_TEST_ROOT` to its absolute directory. Set `SHADOWBRIDGE_TEST_PORT` if `8024` is already occupied. On another machine, point `SHADOWBRIDGE_TEST_MODULES` at an existing `node_modules` containing `@playwright/test` and `@axe-core/playwright`; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium executable.

Coverage: real navigation between the new pages; notices and disabled fields; no enabled file upload or form submission; keyboard disclosures; demo-only template/filter/reset controls; no mutation/fetch/XHR requests or browser storage during those interactions; mobile overflow; WCAG A/AA checks on the new pages. Anonymous demo identifiers and absent direct contact links are checked in the fictional designs. Actual counterparty confidentiality must still be enforced and tested in the separately approved backend.
