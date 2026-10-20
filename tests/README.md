# Tests by development stage

Current functional MVP acceptance tests are documented in
[server/tests/README.md](../server/tests/README.md): real GoTrue/PostgreSQL API,
MFA, role isolation, desktop and mobile flows. `mvp-public.config.cjs` separately
checks the static public package and its inactive account forms.

`private-entry.spec.cjs` and `config.cjs` retain the earlier **static frontend**
checks from commit `2cc4de8`. Their old inactive-page copy/field expectations are
historical and are not the acceptance suite for functional account pages.
The configs use explicit test filenames so a static Python server cannot silently
substitute for the actual backend in current MVP tests.

## Isolated demo, upgrade and restart regression

`demo-lifecycle.mjs` is an operator-run real Docker/Auth/PostgreSQL test, not a
normal application startup command. Back up the existing local database, roles
and `.local/` first; pause its application and containers without removing their
volumes. The runner refuses a running `shadowbridge-private-local` project and
never stops or resets it itself. Loopback ports 8088/9999/54322/8025 must be free.
Node, Docker Compose, `ps` and the Linux `script` utility must already be present.

Prepare **two new source-only archives** with `git archive`: baseline `a4582db`
and the candidate commit. Extract them into separate, previously unused directories
whose resolved paths begin `/tmp/ShadowBridge-stage2-`. Do not copy an existing
`.local/`, accounts or database. Provide each archive with the existing `pg`
dependency (for example a `node_modules` symlink to the checked-out installation)
and a `.shadowbridge-stage2-fixture` file containing:

```json
{"kind":"shadowbridge-stage2-isolated-lifecycle"}
```

Use a new project name for each fresh run; existing test volumes are preserved:

```bash
node tests/demo-lifecycle.mjs --baseline=/tmp/ShadowBridge-stage2-RUN-baseline --candidate=/tmp/ShadowBridge-stage2-RUN-candidate --project=shadowbridge-stage2-RUN
node tests/demo-lifecycle.mjs --baseline=/tmp/ShadowBridge-stage2-RUN-baseline --candidate=/tmp/ShadowBridge-stage2-RUN-candidate --project=shadowbridge-stage2-RUN --safety-only
```

Replace `RUN` with the same lowercase alphanumeric identifier in both commands.
The first command checks fresh demo, restart, real baseline-to-candidate upgrade,
unchanged credentials/MFA/configuration/business records and retained sessions
(**7 scenarios**). It intentionally leaves the isolated candidate application
running for the second command and further regression. `--safety-only` checks
occupied-port refusal, successful interactive credential/MFA helpers without
logging their captured secrets, and refusal to reactivate suspended or rejected
fictional accounts (**4 scenarios**). It restores only its controlled fictional
fixture fields and leaves the candidate running. The PID remains private in its
`.local/stage2-demo.pid`; test data/volumes and a pre-upgrade dump are preserved.
Do not run concurrent browser/API suites while either lifecycle command is active.
Restoring the original local services is a separate operator action after tests.

# Historical static frontend checks — commit `2cc4de8`

At that earlier stage, these checks exercised application/sign-in page designs,
fictional workspaces, a Gmail draft link and the C.A.R.T.E.L. footer route.
That snapshot had no backend or authentication. The current branch has a real
backend and a persisted contact queue; these historical assertions must not be
used as acceptance tests for its functional account pages or contact form.

No package installation is required in this cloud environment:

```bash
cd /workspace/ShadowBridge-private-b2b
node /workspace/ShadowBridge/v2/node_modules/@playwright/test/cli.js test --config tests/config.cjs
```

The tests start an isolated loopback-only Python server on port `8024`, use the existing Chromium, and run at widths `1440`, `390` and `320`. No service is published. Browser results and failure traces are written under the system temporary directory.

`SHADOWBRIDGE_TEST_ROOT` can select a checkout of the historical snapshot. Set
`SHADOWBRIDGE_TEST_PORT` if `8024` is already occupied. On another machine,
point `SHADOWBRIDGE_TEST_MODULES` at an existing `node_modules` containing
`@playwright/test` and `@axe-core/playwright`;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium executable.
For the current curated public preview use `mvp-public.config.cjs` and
`SHADOWBRIDGE_PUBLIC_PREVIEW`, rather than the historical static suite.

Historical coverage: navigation, disabled fields, keyboard disclosures, fictional
template/filter/reset controls, absent mutations/storage, mobile overflow and
WCAG A/AA checks. These are UI-design checks. Current API/RLS confidentiality,
authentication and persisted forms use the functional suites described above.
