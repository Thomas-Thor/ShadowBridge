# Existing central CRM: Clay backup synchronization

This package repairs the earlier single-tab canary for the existing multi-tab
Google Sheets CRM. It updates the same workflow identified by the OWNER's private
checkpoint. It does not create another CRM, credentials or n8n installation.

## Behavior

- Reads `KONTRAHENCI`, `KONTAKTY`, and `AGENT_RUNS` by exact title and validates
  the existing Polish headers. Other tabs and columns remain intact.
- Reads existing Clay CSV backups through the OWNER's existing GitHub CLI login,
  or a hidden existing token if that login is unavailable. CSV blob IDs, file
  counts, and the source commit come from a private local manifest. No backup
  contents or metadata are published to GitHub by this launcher.
- Reuses the Google OAuth and intake credential referenced by the old private
  checkpoint. It never reads/export credentials or repeats known metadata denials.
- Backs up the original workflow before deactivation and PUT. It accepts only
  the known legacy graph; human edits stop migration instead of being overwritten.
- Saves a private CRM snapshot before the first write. Files and directories
  are owner-only (0600 / 0700). The original canary checkpoint is not changed.
- Processes at most five source profiles per webhook request. Companies match by
  a unique domain plus normalized company name. People match by canonical
  LinkedIn, stable imported ID, or are held for review when name/employer overlap.
  Unknown or conflicting matches are skipped, never merged automatically.
- Appends only new rows. One Google Sheets `spreadsheets.batchUpdate` contains
  the company, contact and audit additions atomically. All values are literal
  strings, including formula-like names. Email and phone columns stay empty.
- Reads back contact IDs, company IDs, profiles, fields, and the audit receipt.
  Replays the first committed batch and requires zero additional writes before
  continuing. An uncertain write is reconciled by read-only verification; it is
  never automatically sent again. Recovery retains the original audit counts.
- Starts new batches no faster than once every eight seconds to limit Google
  read traffic; completed checkpoint batches are reused immediately. Large
  backups can take several minutes. Progress contains counts only.
- Saves skipped source rows and reasons to a private review report. It does not
  attempt new searches, enrichment, email discovery, or message sending.

## Concurrency and limits

The local operation lock and the Contabo OS `flock` serialize launchers using
this package. A second CRM read immediately before commit rejects intervening
changes. This is not a cross-application lock on Google Sheets: use one writer
during synchronization, including other agents and manual edits. Arbitrary
writers outside this protocol can still race between the read and append.

The receiver is an authenticated webhook, not a source scheduler. It rejects the
old append protocol. Saving execution contents is disabled, including manual and
failed executions. No external error workflow is accepted. Failures report a
bounded reason and the failing stage without exporting error bodies or tokens.

## Run and recovery

Use Node 22+ on the OWNER computer and the existing SSH host key/authentication.
The reviewed command pins the public launcher SHA-256, all eight module hashes,
the private manifest blob hash, and the immutable CSV blobs. A Git blob hash for
the local manifest is an integrity check; the manifest is not uploaded anywhere.
The existing n8n API key is entered through hidden local input only.

Do not rerun the older `launch-clay-canary.mjs` after migration. Repeating the new
command uses the saved checkpoint and receipts. A `BLOCKED` result means stop and
inspect the reported stage; do not delete checkpoints/locks to force another write.
Keep the private source files and all workflow/CRM backups.

For an explicit workflow rollback, add `--restore-workflow` to the same pinned
launcher command. It verifies the retained backup and current graph, restores the
old workflow **inactive**, and never deletes or rolls back CRM rows. A graph edited
outside the package or an unresolved update outcome stops rollback for review.

## Verification

Run:

```sh
node --test --test-isolation=none \
  automation/nightly-global/central-crm-sync.test.mjs \
  automation/nightly-global/central-crm-sync-transport.test.mjs \
  automation/nightly-global/launch-central-crm-sync.test.mjs
```

The tests cover the real header layout using fictional records: exact tab
selection, append/readback, replay, conflicting identities, international names,
CSV and blob validation, concurrent-change rejection, interrupted writes,
workflow migration/rollback, RPC authorization, and package tamper detection.
The OS flock was also checked separately. These are local tests and simulations,
not a claim of native execution on the production n8n instance. Production
read/write validation happens through the OWNER launcher using existing access.
