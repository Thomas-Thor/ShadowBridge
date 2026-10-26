# APP-ONLY permission stop: read-only diagnosis first

Status: **SERVER DIAGNOSIS PENDING / NO DEPLOYMENT OR PERMISSION REPAIR**.

Reported operator commit: `53cc1ae500f55f2386d913731e3e73679b856069`.
Target application: `e871f2e09c25dc79f5222fa738ac446a103f1edc`.
Required accepted base: `80f4a0d333d31a6d57ada714b0df17bc0584a07b`.

## Confirmed code defect, not an invented server result

The existing generator `scripts/staging-prepare.mjs` deliberately writes the
**public** `certs/internal-ca.crt` as **0644** so the non-root app can read its
trusted CA. Its existing `checkStaging` validator requires exactly 0644. The
private CA key and other profile files retain 0600; private directories are 0700.

The 53cc1ae app-only coordinator incorrectly required 0600 for every file in its
source-configuration loop, including that CA. This is a defect in the newly
prepared installer. Changing a valid CA to 0600 would contradict the established
profile and may break app TLS. **Do not chmod that certificate to fit the bug.**

The exact reported server path, mode/owner, checkpoint phase and active image
are not yet known. This session has no authorized SSH connection or production
log reader. A generic error alone cannot establish which `privatePath` call
failed or whether a later attempt changed anything. No live-production result
has been inferred from local fixtures or Git fast-forward.

## Metadata-only reader

`scripts/book-oauth-app-only-diagnose.mjs --ssh` runs from Pop!_OS through the
existing verified SSH/sudo path. Its public diagnostic source is sent as a Node
argument, not a secret. No script/file is installed on Contabo; the repository,
checkpoint, permissions, locks, services and database are not modified.

It returns a sanitized JSON with:

- The original coordinator's known checked paths: actual type/mode, numeric
  UID/GID and owner/group names; expected mode from 53cc1ae and from the existing
  profile. A missing path and a symlink are reported without following it.
- Target/base checkpoint **allowlisted metadata only**, phase, release/operator
  SHA, whether image/config-hash/backup fields exist, and known artifact
  existence/size/mtime. No state dump, build-log contents, environment values,
  private keys or backup payloads are displayed.
- Current app image/release, immutable image revision, public HTTPS health
  release, and whether these match the accepted base checkpoint. Multiple
  candidates or failed reads remain explicitly unconfirmed.
- A READ ONLY transaction for migration count and hash agreement with the
  accepted Git tree, with no account rows or confidential data queried.
- Whether an already-built target image agrees with the saved app overlay.

The original installer did not enforce a numeric UID/GID. The reader reports
actual ownership without inventing a chown requirement. Checkpoints created via
sudo are ordinarily root-owned; source-profile ownership must be interpreted
against the established installation, not changed recursively.

Download the reader by the immutable diagnostic package SHA and verify its
SHA-256, then run only `node <verified-reader> --ssh`.
[The exact read-only command](OWNER-BOOK-OAUTH-PERMISSIONS-DIAG-COMMAND.md) pins
`b1a9e44c16a6996fcb86ee1fd0afd7074c99737c` and its diagnostic checksum.
SSH/sudo credentials remain in their normal terminal prompt, never in chat.
The reader does not invoke prepare/apply, fetch/checkout, chmod/chown, migrations
or any updater. `resumeAuthorized` is always false.

## Minimal patch prepared locally, not deployed

The coordinator now chooses 0644 **only** for the exact
`<accepted sourceDirectory>/certs/internal-ca.crt` path, at both collection and
revalidation. Other certificates, private keys and settings keep their original
0600 checks; protected operator scripts keep 0700. It does not accept arbitrary
0644 files or broaden the policy for `*.crt` generally. Symlink/type checks,
fingerprints, OWNER/MFA, encrypted/offsite backups and rollback gates are retained.

Future permission errors also include only path, type, expected/actual mode and
UID/GID. No file contents or secrets are added to diagnostic errors.

This patch is **not** a runnable recovery authorization. The original standalone
installer file/checksum is unchanged, but its pinned 53cc1ae coordinator still
contains the bug on Contabo. Do not rerun its old command, manually edit
`installerRelease` in state.json, delete the checkpoint or deploy another SHA to
force the existing state past its identity gate.

## Checkpoint interpretation and safe continuation after evidence

The original prepare flow writes `PLANNED` **before** building. It then builds
and writes app/rollback overlays, but persists the image/config-hash fields only
**after** its source-config permission loop. Consequently this specific CA bug
can leave a PLANNED checkpoint without `image`, with a completed image and two
overlays on disk. That is a supported explanation, not a server observation.

- If the report confirms this combination and running 80f4a0d: preserve the
  checkpoint, image and overlays. A separately reviewed recovery step must
  revalidate their identities and adopt the original operator receipt explicitly,
  then complete missing configuration/backup/offsite steps. Do not repeat the
  successful build or write a replacement checkpoint over the original. Current
  PLANNED is intentionally not an automatic-resume phase.
- If backups are already recorded: authenticate and reuse the actual archives
  and offsite receipt; do not create overlapping replacements blindly.
- If a swap/pending-acceptance state or running e871f2e is observed: determine
  actual image/checkpoint agreement before choosing verification or acceptance.
  Do not apply the app again just because a previous launcher failed.
- If a different path/type or genuinely unsafe mode is reported: identify the
  exact inode and expected ownership first. Any necessary single-path repair
  requires separate OWNER approval. No chmod/chown command is proposed without
  that evidence. No recursive or world-writable repair is acceptable.

No migrations, resets, production DB restore, lock/checkpoint deletion or
automatic Contabo action belongs to this diagnostic stage.

## Actual targeted tests

**23 PASS**: seven new permission/privacy/metadata regression cases plus sixteen
existing app-only cases. Tests generate a real existing-style profile locally,
reproduce the old 0600-vs-0644 rejection, accept the corrected exact CA path,
reject unsafe keys/modes/types/symlinks, distinguish a genuinely wrong checkpoint
mode from the CA-policy bug, preserve checkpoint bytes/mode/uid/gid/mtime and
redact private checkpoint/log/runtime-environment sentinels.

No Docker/application restart, real SSH, production database access or production
permission modification was performed. Prior native Docker/rollback evidence is
historical and has not been relabeled as a new production diagnosis.
