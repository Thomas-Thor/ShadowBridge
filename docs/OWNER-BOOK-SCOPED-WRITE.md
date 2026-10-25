# Existing MCP: scoped writes checkpoint

**Implemented and tested locally. Not deployed or verified through ChatGPT.**

The endpoint remains `/api/integrations/owner-book/v1/mcp`, Streamable HTTP,
with existing OAuth/PKCE and OWNER + fresh MFA consent. No new plugin, server,
OWNER account, key panel or Book API is introduced.

## Exact extension

- `create_book_entry`: one note, task, idea, event or decision.
- `update_book_entry`: ID, kind, current version, requested fields only.
- Both require `explicitWrite:true` and a stable operation UUID. The existing
  Book validator and `owner_book.operate/save_entry` enforce actual saves,
  dependencies, history and optimistic concurrency. Unrequested fields survive.
- Individual `note.write`, `task.write`, `idea.write`, `event.write`,
  `decision.write`, each paired with its `.read`. A missing scope prompts OAuth
  step-up for the actual kind, not all five write permissions at once.
- Separate unchecked OWNER consent. Old READ ONLY and temporary-create grants
  are never upgraded. Normal write consent and the temporary 25-entry import
  cannot be combined in one grant. No deletion, bulk import, key management,
  journal edits, CRM, OWNER VAULT or administrative scope.
- Access/refresh lifetimes stay with the existing OAuth implementation: access
  up to 10 minutes, grant up to seven days, refresh never extends the grant.
- Existing OWNER role, verified account and enrolled MFA are rechecked on every
  operation. Consent/revocation requires fresh OWNER MFA and normal CSRF.
- Full connection revoke stops read and write immediately. **Withdraw writes;
  keep read access** stops writes only. SQL checks revocation before command replay.
- Existing limits: 60 requests/minute, at most 10 writes/minute per OAuth grant.
  Stable command UUIDs deduplicate across reconnects/new grants of the same OWNER;
  reusing a UUID with different content is a conflict.

The existing MCP handshake still requires note.read; additional kinds require
explicit paired scopes.

API keys retain their existing separate authorization/revocation. OAuth uses the
same per-kind scope vocabulary; it does not secretly consume or embed an API key.
Revoking a Book API key does not revoke an independent OAuth connection. Use the
existing `/oauth/owner-book/connections` for ChatGPT OAuth revocation.

## Database and rollout boundary

Only new migration **021** is proposed; 001–020 remain byte-for-byte unchanged.
It extends the grant CHECK catalog and adds two FORCE-RLS extension tables for
write withdrawal and immutable operation receipts. Existing rows are preserved.
Runtime API/session roles cannot directly select or mutate the new tables, or
execute the previous internal consent wrapper. Saves use the existing Book engine.

`OWNER_BOOK_MCP_WRITE_ENABLED` defaults to **false**. Existing read operation and
the separately approved temporary import remain intact. The coordinator now has
an explicit **`--book-write`** mode requiring accepted 14cc879. Its old
`--book-create` mode still rejects a 21-migration checkout. Do not confuse modes.

Before a later approved rollout: read the actual accepted 14cc879 checkpoint and
running image, prepare the next explicitly pinned update base, verify encrypted
DB/config/certificate backups and offsite copy, apply missing 021 once, deploy
the matching image and enable the separate flag only with OWNER approval.
Rollback is application-only; leave 021 and new Book records in place. The new
flag can be disabled without deleting data. Native image build, rollout packaging
and previous-runtime compatibility have now passed in isolation; real Contabo
preflight/deployment and ChatGPT acceptance remain pending. See
[the exact approval/rollout plan](OWNER-BOOK-WRITE-DEPLOYMENT.md).

## Actual tests

- 32 targeted unit/local HTTP cases PASS, including old MCP/OAuth/append flows,
  pairing of scopes, explicit consent, cancellation, CSRF, digest-only SQL calls,
  patch validation, disabled-by-default writes and scope-upgrade challenge.
- 9 groups PASS with **real PostgreSQL and a real loopback HTTP MCP server**:
  additive migration; actual OWNER/MFA SQL permission checks; create/read/edit/
  readback of all five kinds; stable/cross-grant retries; stale version rejection;
  task dependencies; real due-reminder selection; withdrawal/full revocation;
  foreign-owner isolation; raw-table ACL; expiration and request limits; real concurrent
  connections saving the same command exactly once.
- The HTTP test pool executes real SQL through the isolated Docker PostgreSQL
  client. It is not a native app-image/GoTrue/ChatGPT test. Consent identity uses
  explicit fictional SQL OWNER/MFA claims and the fixture executor-role name.
  No production database, real credentials or real counterparties were used.
- Original fixture accounts/password/MFA/session hashes remain unchanged.
  Test clones are retained privately; no private Book data is in GitHub.

Reminders are existing in-app reminders: future entries were absent from the due
list, then appeared after setting a past reminder time. No push/email delivery
or background reminder service is claimed.

## Required real acceptance — NOT completed

1. Confirm 14cc879 `state.json` and live `/health`, read-only. The final JSON was
   printed in the updater terminal; `state.json` is the persisted receipt.
   A profile manifest with `deploymentApproved:false` is not that receipt.
2. Separately approve and deploy a tested 021-compatible update. No automatic
   production change is authorized by this checkpoint.
3. Update permissions of the **existing** ChatGPT connector, preserving default
   read-only behavior. No new connector or secrets in chat. This session has no
   callable connector/Plugin Creator tools and cannot modify its installation.
4. OWNER approves only note/task read+write initially with existing MFA.
5. From actual ChatGPT: create a clearly fictional test task and note, read IDs,
   edit using current versions, read back DB-persisted values; withdraw writes;
   verify denial of the next write and continued read. Test full revoke as well.

Until that sequence passes, integration status remains **NOT LIVE VERIFIED**.
Nightly n8n workflows were not changed, imported or activated.

The updater line `APPEND CONFIGURED; REAL OWNER CONSENT/IMPORT NOT VERIFIED`
appears after its acceptance command returns successfully. It still does not
prove the currently running SHA or a real ChatGPT save. Read the persisted file
`/opt/shadowbridge/.local/r1-owner-release-14cc8796cf718cc15e1ca1cc63154ed078685c6d/state.json`
and current HTTPS `/health` without rerunning the installer. The acceptance fields
are `phase`, `release`, `purpose`, `ownerInteractiveAcceptance`. The original final
status JSON was terminal output, not a separate automatically saved final.json.
