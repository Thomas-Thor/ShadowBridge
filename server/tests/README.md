# Focused security verification

Run only against the disposable, documented loopback development stack. Tests
register clearly fictional accounts in **real GoTrue**, confirm the e-mails in
**local Mailpit**, use **real TOTP MFA**, then exercise the HTTP BFF and
**actual PostgreSQL RLS**. Nothing intercepts or mocks an authentication/API call.
No external mail is sent. No production service is contacted.

From the repository root, after starting the local backend:

```sh
node --test server/tests/config.security.test.mjs
npm run test:api
npm run test:contact
/workspace/ShadowBridge/v2/node_modules/.bin/playwright test -c tests/mvp-config.cjs
/workspace/ShadowBridge/v2/node_modules/.bin/playwright test -c tests/mvp-desktop.config.cjs
/workspace/ShadowBridge/v2/node_modules/.bin/playwright test -c tests/contact.config.cjs
```

The browser dependency path above reuses tools already installed in this cloud
environment. On another machine point `SHADOWBRIDGE_TEST_MODULES` at an existing
Playwright installation; see `tests/dependencies.cjs`. No dependency install is
performed by these tests. The default BFF URL is `http://127.0.0.1:8088` and the
Mailpit URL is `http://127.0.0.1:8025`; optional overrides are
`SHADOWBRIDGE_TEST_URL` and `SHADOWBRIDGE_MAILPIT_URL`.

Tests generate unique fake company/email namespaces and random passwords only in
memory. They never create committed credentials or reset/truncate the database.
The one DBA-only fixture action is granting a newly created fictional test owner
management access; subsequent approvals use real Auth, TOTP and management API.
Direct RLS attempts run as the actual restricted `shadowbridge_api` role inside
rolled-back transactions. Fictional accounts and audit evidence remain in the
disposable local database to inspect after testing.

Coverage: e-mail verification; duplicate-signup profile integrity; pending and
approved states; no self-promotion; AAL1 management denial; owner MFA; own-company
offer/RFQ/proposal drafts and review; sanitized anonymous cards; explicit recipient
assignment; cross-company IDOR; anonymous DTO field/marker leakage; mediated
messages; partner projects and individual commission agreements; CSRF/origin;
HttpOnly/SameSite cookies and production Secure configuration; no-store;
restricted database grants and forced RLS; local recovery; immediate suspension;
durable management activity logs. Mobile browser scenarios at 390 and 320 px
exercise real registration, confirmation, pending sign-in, manual approval and
RFQ persistence without browser token storage. Two additional desktop scenarios
exercise supplier creation/edit/submission, actual management UI review,
anonymous-card preparation and individual assignment, plus partner profile,
proposal, assigned project and individually negotiated commission rendering.
Management browser fixtures use a real opaque AAL2 BFF session issued after
real TOTP, never a fabricated identity/token.

These checks are release evidence for a local MVP, not a claim of independent
penetration testing, a legal review or production-readiness certification.

Contact integration covers actual committed queue persistence, CSRF/Origin, strict
input validation, RLS, staff MFA, immutable intake, status audit and atomic
PostgreSQL throttling. Rate tests use a separate real loopback source address;
they do not clear existing buckets. Browser checks cover private queue rendering
without HTML injection, application links, WhatsApp and the C.A.R.T.E.L. footer.
