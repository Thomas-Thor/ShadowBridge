# OAuth MCP write attempts: READ ONLY closeout

OWNER paused further MCP write deployment attempts on 2026-10-26. Existing
OWNER Book READ remains in service. Do not retry the recovery installer.
Issue #4's latest OWNER comment confirms this priority change: email/onboarding
comes next, following reconciliation of the abandoned attempt.

## Evidence and boundaries

The reported d71ca2e result is BLOCKED / PRIVATE_OPERATOR_FAILURE. It does not
identify the failure phase, prove a swap, or prove rollback. The earlier accepted
80f4a0d runtime and original e871f2e PLANNED checkpoint are historical evidence,
not a current production observation. No production access or authenticated Book
tool is available in this Codex session. Public HTTPS probes from this environment
also failed to connect; that is not evidence of a server outage.

The standalone `scripts/book-oauth-closeout-audit.mjs --ssh` runs through OWNER's
existing SSH/known_hosts and sudo, without uploading files, updating Git or invoking
an installer. Download its immutable, checksum-pinned version using the command in
the delivery report. Requires existing Node.js on Pop!_OS and Contabo. It refuses a
noninteractive terminal, unexpected hostname/repository, or remote Docker context.

It outputs JSON only from allowlisted metadata: current image/release, Docker
services/mounts/Compose path references, checkpoint phases, backup artifact sizes,
lock PID evidence, SQL aggregate counts in a READ ONLY transaction, resources and
verified-TLS health GETs. No raw ENV, process arguments, tokens, private logs,
checkpoint bodies, backup contents or account identities are emitted. Keep the
returned inventory private; do not post it to public GitHub issues.

OWNER login/TOTP and authenticated Book READ are **not** exercised by this audit.
Configured OWNER+TOTP counts are distinct from interactive login success. No
sessions are created and no credentials are requested in chat. Offsite backup
integrity and restore viability are not newly tested; metadata is not proof of a
valid backup. The audit does not decrypt, copy, build, restart, stop, delete, change
permissions, migrate, roll back or clear a lock. Routine read/health activity can
appear in existing service logs; this does not change application configuration.

## KEEP / ARCHIVE / DELETE rules

The JSON `table` contains actual IDs, paths, byte counts, dependencies, risk and
reason **after the operator runs the read**. Before that, current exact sizes and
active references are unknown. Every row has `actionNow: NONE`; cleanup requires
separate OWNER approval.

| Class | Objects | Requirement / risk |
| --- | --- | --- |
| KEEP | Running images/containers; accepted rollback images; all volumes | Protect PostgreSQL, auth, n8n, Caddy, certificates and current data. |
| KEEP | Installation profiles, manifests, secrets, CA keys, checkpoints, origin receipts, backup/key pairs | Preserve the recovery chain; do not relocate an entire source directory. |
| KEEP | Attempt directory referenced by a running Compose overlay or bind | Even an accepted old image may use the failed attempt's `rollback.json`. Moving that directory breaks later administration. |
| KEEP | Any existing/unreadable lock, unresolved dependencies or swap state | Missing PID alone is not authorization to delete a lock. PID reuse/start time and checkpoint phase need review. |
| ARCHIVE candidate | Unreferenced abandoned attempt directory, transfer copies, build log and unused attempt image | Verify an encrypted offsite archive, immutable image provenance and path dependencies first. No deletion now. |
| DELETE candidate | Never-started, stopped technical image-reader container with the exact operator label and zero mounts | Requires explicit approval and complete inventory. All other stopped containers remain KEEP. |

Incomplete Docker/checkpoint dependency inventory changes all ARCHIVE/DELETE
proposals to KEEP. Unknown or unrelated images are KEEP, never globally pruned.

Disk-allocated file bytes are separate from apparent bytes. The target attempt
root and its transfer copies are summed once; nested file rows are not added
again. Docker image sizes are virtual and share layers. Cache/image totals cannot
be added to promise reclaimed space. No guaranteed reclaim estimate is asserted.

## Minimal cleanup proposal, NOT EXECUTED

1. Obtain the read-only JSON. Reconcile actual image, original and recovery phases,
   live Compose paths, lock process identity, backups and disk capacity. A healthy
   accepted production image needs no rollback merely to close the attempt.
2. Keep the complete accepted runtime/recovery chain and existing encrypted backup
   keys. Before any movement, independently verify the archive, offsite copies and
   ability to use the retained rollback image. Do not put private inventory in Git.
3. Only after OWNER approval, isolate confirmed abandoned history outside the
   `.local/r1-owner-release-<sha>` namespace, which existing release gates scan for
   locks. A possible future location is `.local/deployment-history/`; it has NOT
   been created. Moving a folder can break absolute paths, hashes and receipts:
   prepare a verified path/reference plan, preserve original bytes and do not
   rewrite fingerprints or bypass a live lock to make a gate pass.
4. Remove only exact approved temporary object IDs after dependencies are resolved.
   No global prune, volumes removal, broad chmod/chown, reset or cleanup command is
   included in this package. Re-measure actual free space after approved actions.

MCP write remains paused. Email confirmation, password recovery, registration and
later sourcing do not depend on finishing MCP write. No email, registration,
analytics, API write or acquisition workflow is activated by this audit.

## Local validation

`node --test tests/book-oauth-closeout-audit.test.mjs`: **12 passed** on 2026-10-26.
Tests cover retention/dependency rules, fail-closed incomplete inventory,
non-disclosure and lock/file preservation with fictional fixtures under `/tmp`.
No Docker lab, full backend regression or production operation was run. Current
server status and the final concrete cleanup table remain awaiting OWNER's read.
