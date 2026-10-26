# OWNER Book OAuth discovery: dedicated app-only update

**PREPARED AND TESTED IN ISOLATION. NOT DEPLOYED. Separate OWNER approval required.**

- Required accepted production base: `80f4a0d333d31a6d57ada714b0df17bc0584a07b`.
- Application target: `e871f2e09c25dc79f5222fa738ac446a103f1edc`.
- Installer/operator Git SHA is separate from the application SHA. The verified
  launcher and its exact download command are in the adjacent operator command
  document once the package commit has been recorded.
- Existing branch: `feature/owner-book-mcp-scoped-write`. Main is not changed.

## What executes

On Pop!_OS: `scripts/book-oauth-app-only-install.mjs`, standalone Node built-ins.
It uses existing SSH to `shadowadmin@169.58.232.69` and strict known-host checking.
Passwords remain in the SSH/sudo terminal. MFA stays in the existing OWNER browser.
Never send passwords, TOTP, tokens, private keys or backup keys in chat.

On Contabo: `scripts/book-oauth-app-only.mjs`, via sudo by shadowadmin, only on
`vmi3682957` in `/opt/shadowbridge`. No production-host guard can be disabled for
testing. The coordinator reuses existing profile/manifest checks, app-only Compose
assertion, encryption, archive verification, offsite receipt and HTTP checks.
It does **not** execute the old release state machine or any migration function.

The source checkout fast-forwards only the existing R1 operator branch to the
pinned installer commit, then verifies all image payload/build inputs against
the immutable e871f2e tree. The only app differences from 80f4a0d must be the two
reviewed MCP/OAuth modules. The runtime image label and `RELEASE_SHA` are e871f2e,
not the operator package commit. Scripts/tests/backup files are not in that image.

The app-only overlay changes **image + RELEASE_SHA**. All five Book flags remain
true, including the separate temporary import mechanism. No secrets, permissions,
MFA, account, SMTP/signup setting, gateway, n8n, network, volume or DNS is changed.
Only the existing app service is recreated, with `--no-deps --no-build --pull never`.
An app interruption is expected at replacement; other services are not stopped.

## Gates and STOP conditions

Before replacement the coordinator requires:

- Clean R1 operator checkout with the exact requested installer SHA and e871f2e
  ancestry, pinned runtime/build bytes and unchanged migration sources 001–021.
- Existing 80f4a0d checkpoint: `book-write`, `DEPLOYED_AND_VERIFIED`, interactive
  OWNER acceptance, actual immutable image matching that receipt and prior plan.
- Actual old image release label, runtime file hashes, current private app flags,
  accepted Compose/configuration fingerprint chain and non-root read-only app
  with dropped capabilities, no new privileges and no public app/DB/Auth ports.
- Same protected services as the accepted checkpoint. Existing n8n is running,
  loopback-only, attached with Caddy to the internal shadowbridge-edge network,
  with the correct N8N_WEBHOOK_URL. Public HTTPS application and n8n endpoints
  are checked read-only; `/signin` uses `Accept: text/html`.
- Ledger exactly 21 migrations, all names/checksums valid and identical to the
  accepted sources. Missing, added, modified or out-of-order entries mean STOP.
- Actual active OWNER role, verified email/TOTP and recent MFA audit event; no
  account is identified or modified based on a person's name. MFA is needed
  before preparation/apply and again after replacement for final acceptance.
- At least max(8 GiB, 8 × DB bytes + 4 GiB) and 100,000 free inodes on the
  configuration and Docker filesystems. Pop!_OS also needs room for the entire
  offsite bundle plus 512 MiB.
- No other R1 operation lock, unknown app image, modified plan/receipt or changed
  configuration between preflight and apply. A wrong SSH host key or failed
  sudo stops the launcher. No reset, manifest regeneration or lock deletion.
- Complete authenticated encrypted backups and a matching off-VPS checksum
  receipt **before** any app replacement.

If a gate fails, the output is BLOCKED and the private checkpoint is retained.
Do not bypass it or substitute the old `--book-write`/production deploy commands.

## Backup and rollback

Three independent AES-256-GCM archives use the existing authenticated encryption:

1. Online PostgreSQL custom-format `pg_dump` (a consistent transaction snapshot),
   including users, password hashes, sessions, factors, roles stored in app tables,
   Book/CRM and migration ledger. It is decrypted/authenticated and its actual
   `pg_restore --list` catalog is checked, without restoring onto production.
2. Private installation/production configuration, TLS secrets and the verified
   full prior app/gateway plan chain plus the new app/rollback overlays.
3. Caddy `/data` and `/config`, from a read-only copy while Caddy stays running.
   Original hashes before/after must equal copied file hashes. Concurrent ACME
   changes or symlinks/nonregular files cause STOP before the app is replaced.

The standalone pg_dump archive is a dedicated format paired with the separate
configuration/certificate archives; it is **not** the old packed staging recovery
envelope. Do not feed it to the old restore installer. Role/schema preparation
would be reviewed separately for a full disaster restore. Production rollback
never needs a DB restore.

Six files (three archives and their separate key files) are copied over verified
SSH to Pop!_OS, checksummed, mode 0600, in mode-0700 directories:

```text
~/.local/state/shadowbridge-oauth-app-only/e871f2e09c25dc79f5222fa738ac446a103f1edc/archives/
~/.local/state/shadowbridge-oauth-app-only/e871f2e09c25dc79f5222fa738ac446a103f1edc/recovery-keys/
```

Keys are separate from archives. Keep an additional independent/offline recovery
copy as appropriate; copying to Pop!_OS does not protect against loss of that
computer and VPS together. The server verifies the uploaded receipt against its
root-owned recorded manifest. No cloud storage/subscription is introduced.

The previous app image is retained by immutable ID and a dedicated rollback tag.
Failed replacement/new HTTP verification triggers app-only rollback if the
recorded configuration and image identity remain valid. Unknown drift blocks
rollback rather than overwriting an unrelated deployment. The live DB, including
records created after backup, is retained. A deliberate operator rollback also
requires fresh MFA. Neither path runs migrations, restores an old database,
changes another service or deletes containers/volumes/backups.

## One operator sequence after approval

1. On Pop!_OS ensure existing SSH/sudo and known_hosts work. In the existing OWNER
   Book reconfirm current TOTP using **Reconfirm MFA**. Do not create a new OWNER.
2. Run the checksum-pinned command in the operator command document. It prompts
   `TAK` for the update window, performs preflight/build/online backups, verifies
   the offsite copy, then prompts `TAK` before replacing app. If transfer took
   over 30 minutes, reconfirm existing MFA in the browser before continuing.
3. After automatic checks, sign in as the existing OWNER, reconfirm MFA, verify
   Book read and existing functions. Enter `ODBIOR` to record acceptance or
   `ROLLBACK` to restore only the previous app image.
4. Refresh the same ChatGPT integration, start fresh OAuth for exactly
   `note.read note.write task.read task.write`, review the actual scope list and
   separate write checkbox. A real ChatGPT save/read/edit/revoke test is still
   required; the installer does not claim it or generate connection credentials.

Checkpoint:

```text
/opt/shadowbridge/.local/r1-owner-release-e871f2e09c25dc79f5222fa738ac446a103f1edc/state.json
```

Rerunning the **same checksum-pinned command/installer SHA** reads this checkpoint:
waiting for offsite → verify/copy existing bundle then apply;
SWAPPING_APP → inspect current old/new image and resume, without repeating a
successful replacement; pending acceptance → accept only; accepted → verify only.
PLANNED, rolled-back, incompatible or locked state → STOP for review. No automatic
backup overwrite, old installer rerun, reset or migration is offered.

## Actual isolated tests and remaining limits

- 16 dedicated tests PASS: receipt/ledger gates, configuration drift during
  transfer, secret-free state hashes, mount-order normalization, backup/offsite/MFA
  ordering, interrupted resume, rollback failures, exact app-only command vector,
  unique safe bundle filenames and refusal to run the real coordinator here.
- 3 existing focused rollout/Compose tests PASS, including real config merging,
  encrypted configuration verification and the complete previous plan chain.
- Both exact runtime images built in the isolated Docker daemon under `/tmp`.
- 7 native groups PASS: clone fictional ledger-21 fixture without migration;
  online GCM pg_dump and restore to a new DB; real Compose app-only replacement;
  authenticated MCP discovery; actual fictional MCP save after backup retained
  after rollback; forced-health automatic rollback; interrupted resume without
  another replacement; GCM corruption denial and unchanged users/sessions/MFA
  and migration hashes. These assertions are grouped into seven report cases.
- Online Caddy certificate copy + configuration archive PASS, authenticated
  decrypted contents and mismatch denial, with no gateway restart. The fixture's
  copied scratch ownership is adapted by the isolated Docker wrapper to the test
  runner; source volumes/keys are not changed by that ownership adaptation.

The first native attempt exposed nondeterministic Docker mount-list ordering;
comparison was fixed to normalize order while retaining every mount property.
Initial failed isolated attempts/data are retained for evidence, not reset.

Native tests exercise the shared real state-machine flow and real Docker/Compose,
PostgreSQL TLS/API roles, backups and previous/new images through isolated
adapters. The production-only hostname/root/path gates are never bypassed, so the
full Contabo preflight/SSH/interactive-sudo path has **not** run here. Offsite
checksums were tested with a local copy; actual transfer to another computer
occurs only on the OWNER machine. Native grants use explicit fictional SQL
OWNER/MFA claims, not real interactive GoTrue/ChatGPT consent. No actual OWNER
account, Contabo secret, production DB or external workflow was accessed.

The server must still prove its real current state at execution. Certificate
renewal races, infrastructure drift, disk pressure, SSH/sudo or a different
production image can legitimately stop this package. Rollback returns the old
mixed-discovery behavior; it preserves service availability, not the OAuth fix.

Historical e871f2e source regression: 40 PASS (not rerun for this operator-only
package). No public registration/mail, imports, financial/Umami/AI features or
acquisition workflows are activated.
