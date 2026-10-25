# Temporary OWNER additions through the existing MCP

Code preparation does not mean production deployment, ChatGPT connection or
completed import. Keep the existing read connection and REST. No new MCP server,
plugin, OWNER account or CRM database is introduced.

## Connection and actual permissions

Use the same Streamable HTTP endpoint:
`https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp` and existing OAuth.
No API key or secret belongs in chat, a plugin package or Git.

New operations: `create_note`, `create_idea`, `create_task`, `create_event`,
`create_decision`, `prepare_book_import`, `apply_book_import`. Each create operation
prepares a single-entry preview; it does **not** silently create a record. The
batch operation accepts 1–25 records and requires distinct stable `source_ref`
and a command UUID. Existing validators, fields and transactional importer are
reused. Updates, delete, arbitrary SQL, CRM and credentials are not MCP tools.

The global `OWNER_BOOK_MCP_CREATE_ENABLED` defaults to false. Old OAuth tokens
remain read-only. The first attempt without a create scope returns the standard
OAuth `insufficient_scope` challenge plus the MCP authentication hint. ChatGPT
must obtain a new explicit consent, not silently upgrade an old token.

Create scopes are `note.create`, `idea.create`, `task.create`, `event.create`,
`decision.create`, each paired with its corresponding `.read`. Ordinary read
scopes remain the default. The OWNER consent page has a separate unchecked
confirmation: **25 new entries maximum, within 60 minutes**, no edits/deletes.
Existing OWNER, verified email and fresh TOTP are required in API and SQL.
Refreshing OAuth does not extend the temporary permission.

## Exact data workflow

1. Read actual current Book records and compare the historical material. The
   confirmed document is “SHADOWBRIDGE — KOMPLETNA LISTA ZADAŃ”, 24 October 2026.
   Its preserved private draft has 25 candidates. It is historical context, not
   proof that 25 tasks are missing. Source/private payloads are not in GitHub.
2. Submit `prepare_book_import`. PostgreSQL compares actual own records,
   including archives, by stable source and normalized content. Matching completed
   entries remain unchanged. Changed sources, ambiguous matches and equal titles
   with different content require review, never deletion or overwrite.
3. OWNER opens the returned review URL under `/oauth/owner-book/imports/UUID`,
   reviews the exact entries and conflicts, confirms existing MFA and approves
   that exact payload/snapshot. MCP cannot approve its own proposal.
4. Operator authenticates a new encrypted backup made **after approval** using
   existing backup/verification routines. Runtime roles cannot insert backup
   receipts. A changed snapshot stops certification/application.
5. `apply_book_import` uses the exact review ID with `explicitCreate:true`.
   Under a table lock it rechecks the live snapshot, approval, scopes, backup and
   25-record budget, then calls the existing Book importer for missing items only.
   Replays return the same IDs. Stable source keys survive a changed command UUID
   or a new OAuth grant; they never replace an existing entry.
6. Read back all returned IDs/contents using the existing scoped read tools.
   Only after verified readback select **Withdraw additions; keep read access**
   at `/oauth/owner-book/connections`. Expiry also stops creation; reads remain.

## Deployment and backup operator

Use the checksum-pinned `r1-owner-deploy.mjs` block from the release report with
`--book-create`. It requires the **accepted 599fc33 OAuth installation**, ledger
001–019, exact images/fingerprints and no active release lock. It must STOP if the
earlier OAuth update is incomplete or actual production differs; do not run two
installers at once or repeat an earlier deployment blindly.

The existing encrypted DB/config/certificate and offsite-backup gates precede
additive migration 020. No existing data rows/account/MFA or old migration are
changed. Only app image/release and the explicit temporary-create flag change.
Rollback returns to the recorded 599fc33 image and leaves new data and 020 in
place. Disabling with `--book-create --disable` preserves read OAuth, MCP and REST.
The existing checkpoint resume logic remains in use; unknown phases/locks STOP.

After actual OWNER review approval, run on Pop!_OS using the existing SSH access:

```sh
ssh -t -o StrictHostKeyChecking=yes shadowadmin@169.58.232.69 \
  'cd /opt/shadowbridge && sudo node scripts/book-append-backup.mjs --review=APPROVED_REVIEW_UUID --release=APPROVED_FULL_SHA'
```

This is backup certification only, never a DB import, reset, migration, password
reset or MFA bypass. It shares the active release's lock, verifies the running
image/plan and ledger, checks space and safely reuses a saved matching backup.
Expect a short app/Auth pause for consistency. It verifies the encrypted archive
and pg_restore catalog, not a new full restoration on production. Keep the
backup/key privately and separately. A failed guard issues no import receipt.

## Contacts belong in the existing central CRM

The repository's concrete existing OWNER CRM importer is
`POST /api/owner/vault/contacts` → `owner_vault.owner_intake` → `save_intake`.
It uses source/profile/individual-email-plus-company identity keys and returns
an intake receipt. The new OWNER-session-only
`POST /api/owner/vault/contacts/preview` checks those same actual identity keys
without creating a company/contact. An unresolved identity is not a new or
verified contact. Replay keeps the same receipt; conflicting identities go to
review. Readback uses existing intakes/contacts endpoints.

Book OAuth receives **no CRM permission**. These endpoints keep normal OWNER +
fresh MFA/CSRF and PostgreSQL checks. Do not import contact lists into Book or
grant external agents a broad OWNER/DBA token. The confirmed historical document
contains project tasks and the formal brand email, not an identified structured
contact batch; no contacts were invented from it. The actual live destination,
records and access still require an authorized production check.

If the installed plugin has a read-only instruction, keep read-only as its default
and update that **existing** configuration to allow only the explicit temporary
flow above on OWNER request. Discover advertised tools; never guess tool names or
mark create tools read-only. Respect the ChatGPT host's action confirmations.
No second connector/server or disabled authentication is a workaround. This
repository cannot itself attach the connection to a conversation or prove the
live ChatGPT client's scope-upgrade behavior without an actual owner connection.
