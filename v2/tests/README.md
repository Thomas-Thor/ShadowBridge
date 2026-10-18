# V2 local browser checks

These checks exercise the isolated `/v2/` public prototype and the preserved
legacy pages' compatibility safeguards. They do not enable registration, connect
a backend, change hosting or deploy anything.

From the repository root:

```sh
npm --prefix v2 ci --ignore-scripts
npm --prefix v2 test
```

Node.js 22.12 or newer and Python 3 are required. The test runner starts Python's
static HTTP server from the repository root on port 8000. It reuses an existing
server on that port when one is already serving the preview. Stop an unrelated
server on that port first.

The cloud machine already supplies `/usr/bin/chromium`. On another machine,
install Playwright's pinned Chromium with `cd v2 && npx playwright install chromium`,
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed compatible browser.

The suite checks desktop (1440 px), tablet (768 px), and mobile (390 px and
320 px) layouts, public links and assets, browser errors, horizontal overflow,
keyboard navigation, native skip-link focus, useful navigation without JavaScript,
industry tabs, role selection, native form validation, the actual clipboard, and
the actual downloaded enquiry brief. The download flow must not submit an enquiry
to a server or present a false transmission confirmation.

Automated axe checks cover the applicable WCAG 2.2 A/AA rules, including inherited
WCAG 2.0 and 2.1 rules. This is an automated accessibility check, not a full
accessibility conformance certification; keyboard and layout behavior are tested
separately.

The legacy regression spec also checks all six existing pages' local assets and
runtime errors, the four guarded registration handlers, rejection of forged
browser-storage authentication, and the three explicitly labelled dashboard
previews with their working tabs. Google Fonts requests are deliberately blocked
in this legacy suite to isolate local functionality from external font access.
Any attempted historical backend call is recorded as a failure and blocked before
it can reach an external service. The legacy dashboards are not represented as
authenticated accounts or assessed against the new public site's accessibility
standard.

There are 44 public V2 scenarios and 12 legacy regression scenarios across the
four viewport projects. To run only legacy checks:

```sh
npm --prefix v2 test -- legacy-compat.spec.cjs
```

`npm --prefix v2 run test:accessibility` runs the accessibility subset.
`npm --prefix v2 run test:list` lists every discovered test without launching a
browser. Generated dependencies, reports and failure traces are ignored by Git.
