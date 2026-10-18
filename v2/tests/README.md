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
the actual downloaded enquiry brief. Every header, footer and homepage CTA is
clicked, including the static confirmed business email and C.A.R.T.E.L. Division
link. The enquiry draft checks cover every sector and role, Unicode, line breaks,
reserved URL characters and fixed email recipients. A capturing click listener in
the tests prevents `mailto:` anchors from opening an email application; it records
the actual generated draft URL without replacing application code. No test sends
email or submits an enquiry. Both the draft and download flows must avoid false
transmission confirmations and browser-storage writes.

Long enquiries must fall back to a complete downloadable brief rather than a
truncated email URL. Editing a field, role or sector must invalidate any old
prepared draft before it can be opened again.

The confirmed email must also appear in the HTML served without JavaScript.
Source-preview metadata must remain `noindex`. The responsive C.A.R.T.E.L.
information page must have no login, registration or dashboard interface; legacy
access query parameters must leave its visible content unchanged. Its homepage
return link and local assets are exercised too.

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

There are 76 public V2 scenarios and 12 legacy regression scenarios across the
four viewport projects. To run only legacy checks:

```sh
npm --prefix v2 test -- legacy-compat.spec.cjs
```

`npm --prefix v2 run test:accessibility` runs the accessibility subset.
`npm --prefix v2 run test:list` lists every discovered test without launching a
browser. Generated dependencies, reports and failure traces are ignored by Git.

After generating the production candidate and review export, check the actual
artifacts independently from the source preview:

```sh
npm --prefix v2 run build:production
npm --prefix v2 run build:preview
npm --prefix v2 run export:review
node v2/tests/check-exports.cjs
```

The standalone artifact check starts temporary HTTP servers bound to loopback
on available ports. It exercises production, unpublished preview and self-contained review pages at
1440 and 390 px: assets, layout, navigation, confirmed email draft, the complete
downloaded brief, C.A.R.T.E.L. information page, query parameters and return to
the homepage. It also verifies the differing canonical/robots settings. Servers
and browser contexts stop when the check finishes. Optional positional arguments
override the production, review and preview directories, in that order. The
preview must remain `noindex`, have `Disallow: /` and omit canonical and sitemap.

Managed cloud Chromium blocks `file://` navigation by administrator policy, so
the automated check serves the review files over loopback without changing that
policy. Opening the review HTML by double-click on a user's own computer has not
been verified in that managed browser. A local Python HTTP server is the
documented fallback. No check sends an email, activates registration or deploys
the generated production candidate.

To deliberately refresh review screenshots while checking generated exports:

```sh
SHADOWBRIDGE_EXPORT_SCREENSHOTS="$PWD/review" node v2/tests/check-exports.cjs
```
