# Temporary MCP additions — checkpoint, 25 October 2026

**PREPARED AND LOCALLY VERIFIED. Not deployed, connected or imported.**

Runtime/migration source tested: `0beaf2fa74cfb3683e8c12d0229c8ca19468fc7d`.
The final checkpoint changes only test readback assertions and this public report;
application, migration and installer bytes remain identical to that source.

## Actual evidence

- 42 targeted tests passed: validation, existing MCP/OAuth/CRM regressions,
  historical-data reconciliation, consent and backup/deployment guards.
- 7 existing MCP/OAuth rollout regression tests passed, including real Compose
  configuration and encrypted backup/rollback plan checks.
- 10 real PostgreSQL test groups passed: additive migration 020, RLS, permission
  denial, review ownership, immutable previews, backup gating, deduplication,
  concurrent imports, expiry/revocation and the existing CRM import contract.
- Both native Docker targets built from the tested source. Runtime image:
  `sha256:3ea879c691f6df4794f46c25f43849dd16132dcddb3af9707a313e65be268345`;
  migrator: `sha256:169ceb6f06e6bf20dce745c37ad48eb313af4738c020e3e0b2a27f969ab63c32`.
- 8 native runtime test groups passed against isolated TLS PostgreSQL. An
  authenticated encrypted backup was restored to a separate database. Only the
  missing migration ran; a second pass had zero pending migrations. Existing
  rows, credentials, MFA, sessions and OAuth grants were preserved.
- Native HTTP tests exercised OAuth registration, PKCE, token refresh, read-only
  denial of additions, separately consented temporary scope, actual comparison,
  approval, post-approval encrypted backup, creation of five fictional entry
  kinds, idempotent replay and field-by-field readback. Withdrawal stopped new
  additions while the same grant retained reads and the existing REST worked.
- The previous OAuth application image was run against the migrated clone:
  application-only rollback kept the new entries, reads and existing credentials.
  Its runtime bytes matched the pinned `599fc33` release. No database downgrade.

Tests used fictional records and SQL OWNER/MFA claims in an isolated fixture,
with its existing executor-role name substituted. They do **not** prove a real
GoTrue interactive login, ChatGPT consent/scope upgrade, or production operation.
Native test application containers were stopped; isolated databases/backups
were retained. Existing owner-local services and production were not changed.

## Historical material and actual import status

The OWNER confirmed that “Pasted text(6).txt” means “SHADOWBRIDGE — KOMPLETNA LISTA
ZADAŃ”, dated 24 October 2026. It is historical evidence, not an unfinished-task
list. The private 25-entry draft is preserved, not published. Current Book has
not been read through an authorized connection in this session; missing,
duplicate and conflicting counts therefore remain **unknown**. Imported: **0**.
The historical material did not yield an identified structured contact batch;
the formal brand email was not converted into a person/company record.

## Handoff and next gate

First establish the saved outcome/SHA of the existing OAuth update on Contabo.
Do not rerun it blindly. This package accepts only an **accepted `599fc33` OAuth
checkpoint**, checks fingerprints and ledger 001–019, and stops on active locks
or an unexpected production state. No SSH access or actual production check was
available to this session.

After this precondition is confirmed, the existing checksum-pinned Pop!_OS
launcher supports `--book-create`, with verified encrypted/offsite backups,
missing-only migration 020, application-only update and recorded rollback.
Installer `scripts/r1-owner-deploy.mjs` SHA-256:
`eaba6ba532c8be419fd57eed468dd4ded9082ac235bd645ea80a43d4d296e204`.
Pin its Git download to the full approved release SHA, never a mutable branch.

Then use the **existing** MCP connection and separate OWNER consent; compare
actual Book, review exact missing entries, obtain approval, certify backup,
apply once, read back and withdraw additions. No secret belongs in chat. CRM
contacts continue through the existing OWNER CRM importer, not Book MCP.
See [the operator flow](OWNER-BOOK-TEMPORARY-APPEND.md).

Unverified: production migration/update, actual OWNER/MFA login, ChatGPT host
write-scope upgrade and connection, live comparison, OWNER approval, production
backup receipt, Book/CRM import and withdrawal after that import. These remain
explicit gates, not completed work.
