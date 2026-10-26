# OAuth discovery: separate normal writes from temporary import

Status: **PATCH TESTED IN ISOLATION; NOT DEPLOYED; OWNER APPROVAL REQUIRED**.
Base reviewed release: `80f4a0d333d31a6d57ada714b0df17bc0584a07b`.

## Incident and evidence

OWNER reported `OAUTH_REQUEST_REJECTED` with message
`Temporary import and normal write consent must remain separate.` and requestId
`afba6a56-eca1-4e3f-b288-8e06e59e7d75`.

That exact branch proves at least one recognized `.create` scope and at least
one recognized `.write` scope were present in the parsed authorization request.
It does **not** identify their exact names. This session has no authorized SSH or
production-log connector; no server log was read. The application responds with
a request ID but logs only HTTP 500 failures, without request parameters. This
HTTP 400 therefore has no application scope trace to retrieve by request ID.
Do not claim an exact historic scope list from this ID or log raw authorize URLs,
authorization headers, cookies, codes, PKCE material or tokens to find it.
If an existing approved host audit retained sanitized scope names, those names
alone can provide additional evidence; none was available here.

The deterministic source defect is confirmed: with both existing feature flags
true, the old discovery documents advertised both permission classes and the old
MCP tool list advertised both sets of tools/security schemes. An OAuth client
combining the advertised permissions was then rejected by the intentionally
strict authorization validator. Two regression tests fail on the old code for
precisely those discovery behaviors. Client scope aggregation is a supported
explanation of this incident, not a captured production request trace.

## Minimal runtime patch

Only two runtime files change:

- `server/owner-book-oauth.mjs`: discovery selects reads + normal writes when
  write is enabled; otherwise reads + temporary create when only create is
  enabled; otherwise existing reads. It never advertises both consent classes.
- `server/owner-book-mcp.mjs`: normal write mode lists the three existing read
  tools and `create_book_entry` / `update_book_entry`, excluding temporary import
  tools and their `.create` security schemes. Import-only mode still lists the
  five existing proposal tools and two reviewed import tools, with no `.write`.

No new feature flag, endpoint, server, database migration or OAuth bypass.
The existing flags are unchanged on disk. Explicit legacy import authorization
and existing separately consented import calls remain valid under their unchanged
SQL/MFA/preview/backup checks, even when omitted from normal discovery. For fresh
import-tool discovery the existing separate import mode is write=false,
create=true; do not switch production modes as part of this patch.

`authorizationParameters`, PKCE, exact callbacks, owner checks, separate unchecked
consents, scope pairing, CSRF, grant lifetime/revocation, write version checks,
operation UUIDs, audit, REST and Book data handling are unchanged. Mixed requests
are still rejected, never silently filtered or upgraded. A missing scope still
defaults to `note.read`, not automatic write consent.

The intended basic client request remains exactly:

```text
note.read note.write task.read task.write
```

Discovery lists supported capabilities, not a blanket grant: other existing
normal Book kinds remain supported, and read-activity keeps `journal.read`.
The patch removes the incompatible import class; it does not silently convert a
client's broader request into four scopes. Configure the existing client to
request the four scopes and inspect the actual consent page before approval.
If the host cannot select scopes and asks for more, report that limitation; do
not approve a broader grant while claiming a four-scope result.

## Isolated results (2026-10-26)

Before runtime changes: the new six-case regression file produced **4 PASS,
2 FAIL**. The failures identified mixed metadata and mixed tool declarations.

After the patch, **40 tests PASS, 0 FAIL, 0 skipped**, using:

```sh
node --test server/tests/owner-book-discovery-modes.test.mjs server/tests/owner-book-write.test.mjs server/tests/owner-book-oauth.test.mjs server/tests/owner-book-append.test.mjs server/tests/owner-book-mcp.test.mjs
```

Coverage: all discovery document paths and both flags, advertised-scope
authorization round-trip, normal tool/security-scheme list, separate import-only
discovery, preservation of separately authorized legacy import routing, exact
four-scope consent with unchanged OWNER/MFA/CSRF contract, unchanged read-only
default, continued mixed-scope rejection and invalid PKCE/callback denial.
Existing targeted tests also cover token handling, revoke/permission failures,
consent-ticket integrity, write versions, proposals/backup ordering and redaction.

Tests use actual Node loopback HTTP and injected SQL/auth fixtures. No real
PostgreSQL/GoTrue instance, real OWNER account, actual ChatGPT authorization or
production write was exercised in this patch run. No database was touched.
An initial combined run could not load the existing append suite because `pg`
was absent from this checkout. Reusing the existing verified pg 8.16.3 dependency
in `/tmp` resolved it without package installs; the subsequent full targeted run
is the 40-pass result above. The temporary local dependency link was removed.
No Docker build or repeated full-project suite was needed for discovery logic.

## Controlled deployment instruction — after separate OWNER approval

This is a reviewable **app-only update specification**, not a claim of a tested
one-command production updater from 80f4a0d. Do not launch the old `--book-write`
installer blindly: its initial runtime-base gate expects accepted 14cc879 and
ledger 20, whereas this hotfix follows accepted 80f4a0d and ledger 21. Do not edit
manifests/fingerprints or bypass those gates to force it through.

1. Confirm approval for the exact hotfix commit and actual production `/health`,
   accepted checkpoint, app image, original Compose project/config chain and
   migration ledger. Require actual 80f4a0d runtime, the unchanged 001–021 hashes,
   no pending migration and fresh existing OWNER MFA. Any drift means STOP.
2. Use the existing encrypted-backup functions and preservation checks, retaining
   accounts, sessions, MFA, Book, OAuth records, configuration and certificates.
   Authenticate the archives and checksum-verify the off-VPS copy; keep keys
   separate. Record the current immutable app image and actual Compose inputs
   privately for rollback. No old backup replaces the live database.
3. Build only the runtime target using the reviewed hotfix SHA and existing
   `deploy/staging/Dockerfile`; validate its release label. Prepare an app-only
   update plan based on the **actual accepted 80f4a0d** state, preserving flags,
   secrets, networks, mounts, ports and production manifest protection. Before
   execution the operator's guarded update path must support that predecessor
   and zero migration; the old first-write path is not a substitute.
4. Apply only the recorded app-image replacement through that reviewed plan.
   Do not run a migrator, full production deploy, uncontrolled Compose up,
   container/volume cleanup, DNS change or n8n restart. Keep the previous image.
5. Verify new release/health, REST/OWNER sign-in and MFA. Read both OAuth metadata
   documents: `.write` present and `.create` absent in normal mode. Using the
   host's secure connection, verify raw `tools/list` includes normal create/update
   and no import tools. No bearer/cookie/code should be pasted into chat.
6. Refresh the **same** ChatGPT integration's discovery and start new OAuth
   authorization for exactly the four scopes above. Do not reuse a cached mixed
   request. Confirm the separate write checkbox and exact scope list under OWNER
   + fresh MFA. A deliberately mixed request must still fail. A real ChatGPT
   create/read/edit/readback and post-revocation denial remain separate acceptance
   tests, never inferred from successful discovery.
7. On failure, restore only the previously recorded application image and its
   existing configuration using the app-only rollback plan. Retain the live DB,
   new rows, migration ledger, secrets, volumes, Caddy, n8n and certificates. The
   previous app may reproduce the discovery issue; rollback is not its fix.

No production action is authorized by this document. Before execution a guarded
app-only updater for the accepted 80f4a0d predecessor must be reviewed; this patch
does not introduce or test that new deployment path. Await OWNER approval.
