# OWNER Book write rollout — review before approval

**READY FOR PREFLIGHT. No 021 production change has been performed.**
OWNER supplied the accepted checkpoint and HTTPS health release, both
`14cc8796cf718cc15e1ca1cc63154ed078685c6d`, purpose `book-create`,
phase `DEPLOYED_AND_VERIFIED`, ownerInteractiveAcceptance=true, health HTTP 200.
This establishes the reported update base; it does not replace fresh preflight
or prove a ChatGPT write. No more reruns of the 14cc879 installer are needed.

## Concrete change to approve

Run the **existing** Linux OWNER launcher in the new explicit `--book-write`
mode, from a reviewed full SHA of `feature/owner-book-mcp-scoped-write`.
The installer must run on Pop!_OS using existing SSH and known host verification.
It fetches only this branch and checks the exact release; no main/force/reset.

1. Verify the accepted 14cc879 checkpoint, actual app image and 72 pinned runtime
   files, 20 exact migration hashes, active roles/MFA, current fingerprints,
   local Docker networks/ports, Auth TLS, public HTTPS/n8n and disk reserve.
   Any drift or another active release lock means STOP before changes.
2. Require fresh existing OWNER MFA. On Book expand **Confirm OWNER MFA for
   sensitive actions**, select **Reconfirm MFA**, enter the existing TOTP and
   confirm. Opening an already logged-in page is not a fresh MFA event.
3. Build matching runtime/migrator images. Pause only the existing app/Auth for
   consistent backup; briefly pause Caddy for certificate storage backup.
   Preserve the previous image and every existing database/volume/config.
4. Verify encrypted DB/config/certificate copies, transfer and checksum-verify
   the copy outside VPS on the OWNER computer. Retain private keys separately
   from archives. Do not paste keys, archives or raw configuration into chat.
5. Apply **only missing 021**, compare protected rows before/after, start the
   new app image with explicit `OWNER_BOOK_MCP_WRITE_ENABLED=true`. Preserve
   REST, read OAuth and existing bounded temporary-create functionality.
   No SMTP, registration, n8n workflow, CRM importer, AI model, DNS or main change.
6. Verify real HTTPS release/metadata/anonymous denial and protected service
   identities; OWNER reconfirms MFA after the update and accepts in the browser.

Expected terminal status: **WRITE_CONFIGURED_CHATGPT_NOT_VERIFIED**. This is
configuration/HTTP acceptance, never a claim that ChatGPT created anything.
The persisted receipt is `.local/r1-owner-release-<SHA>/state.json`.

The launcher is `scripts/r1-owner-deploy.mjs`. Reviewed SHA-256:
`fd60655b710aac3bf89e8d86f92124fdf0498cb448f27c5721c5429174fd2021`.
The operator download must pin the approved full Git SHA and verify this digest
before executing `node <verified-file> --release=<approved-full-SHA> --book-write`.
Do not execute until OWNER approves this exact update/window. A temporary
interruption is expected during consistent backup, transfer and migration.

## Resume, disable and rollback

Rerunning this **same new release/mode** first reads its saved phase. Accepted
release → verify only; pending acceptance → accept only; completed migration or
interrupted start → verify backups/ledger/preservation and resume app start,
never rerun migrations. Unknown phases/locks stop. No deletion of stale artifacts.

Before migration, a preparation failure resumes existing services where the
existing coordinator can safely confirm that no migration started. After a
failed migration/start/verification, the existing guarded application-only
rollback preserves PostgreSQL and the applied ledger. It never restores an old
DB onto live data or removes new rows. A still-running migrator prevents rollback.

The rollback image is the one actually recorded for accepted 14cc879. Its app
environment disables `.write`, preserving prior REST/OAuth/create. Migration 021
and any new records remain. A separate `--book-write --disable` action disables
only normal MCP writes; it preserves reads and existing REST/create controls.
No down -v, prune, database reset, full uncontrolled Compose up or credential reset.

## Isolated evidence

Operator/runtime source tested: `4ade2361789420f7c7305ec9d447e70ce8718f0d`.
Later report/test-file additions do not change app/migration/installer bytes.

- **22 rollout tests PASS**, including actual Compose config, encrypted companion
  backup authentication, complete accepted-plan chain, disable/rollback overlays,
  mode/SHA/20-ledger checks, preservation gates and STOP cases.
- Both native Docker targets built: runtime
  `sha256:ae2883842051d927a637d6f49481664e9d1993d13ba336e751e45707f5395bf9`,
  migrator `sha256:4b000619905ba5053d5c2e2c6e84567bdeb72ef20b22a4e2c82544d5d9311ec7`.
- **6 native runtime groups PASS**: authenticated encrypted restore to an empty
  clone; additive 021 with old-row preservation and validated full ledger;
  writes disabled while REST/read work; actual app create/read/edit/readback;
  withdrawal surviving HTTP refresh and restart; previous runtime compatibility
  retaining new data, credentials, sessions and MFA.
- Native app used restricted API/session roles and PostgreSQL verify-full TLS.
  SQL migration used the known fixture executor-role substitution; native
  migrator image was built, not used for that first SQL application. The
  subsequent source/ledger check had zero pending migrations. No actual VPS test.
- The compatibility image was built from 0beaf2f; all 72 runtime files match the
  immutable 14cc879 tree. This is not a copy of the actual Contabo rollback image.
- Consent in the lab used explicit fictional SQL OWNER/MFA claims. Interactive
  GoTrue, real OWNER login and ChatGPT scope upgrade remain separate real tests.

Previously recorded: 32 scoped-write unit/HTTP tests and 9 real-PostgreSQL groups
PASS. These historical results were reused, not relabeled as new production tests.

## Final ChatGPT acceptance after separately approved deployment

Use the **existing** connector and URL, initially only note/task read+write.
OWNER must approve the separate write consent under existing login/MFA; old
READ ONLY tokens are not upgraded. If the installed plugin's instructions are
read-only, amend that existing configuration through its authorized editor.
No second plugin/server, no Bearer pasted into chat, no administrative/CRM scope.

From actual ChatGPT: create a fictional task and note, read IDs, update with
versions, read back persisted values, withdraw write rights, prove the next write
is denied and reads continue. Verify full revoke as well. Then archive test
records only under OWNER instruction. This session cannot perform that host
acceptance because its tool catalog does not expose the real connector.
