# Pop!_OS: pinned PLANNED recovery command

**Prepared, not deployed. Run only after separate OWNER approval.** This command
will perform production recovery after its interactive confirmations; it is not
the earlier read-only diagnostic.

Package commit: `d71ca2eaf6179b0f089a02ff32c83a80d9e38310`.
New standalone installer: `scripts/book-oauth-app-only-resume-install.mjs`.
SHA-256: `fdddd7c6a1c2f4dd5d45fa1280fc2560131aab51a2a48757d1c1d2cc4d6b9071`.

Application target remains e871f2e; original operator remains recorded as 53cc1ae
in the untouched original checkpoint. The new operator uses a separate recovery
state and immutable origin receipt. No build, migration or chmod is requested.

On **OWNER Pop!_OS**, use the normal Linux account and an interactive terminal.
Existing Node, curl, SSH/sudo and the already verified Contabo known_hosts entry
are required. In the existing OWNER Book confirm the current TOTP with
**Reconfirm MFA**. Do not send credentials or codes in chat.

```bash
(
  set -eu
  umask 077
  SB_RECOVERY_SHA='d71ca2eaf6179b0f089a02ff32c83a80d9e38310'
  SB_RECOVERY_HASH='fdddd7c6a1c2f4dd5d45fa1280fc2560131aab51a2a48757d1c1d2cc4d6b9071'
  SB_RECOVERY_FILE="$(mktemp /tmp/shadowbridge-oauth-recovery.XXXXXX.mjs)"
  curl --fail --silent --show-error --location --max-redirs 3 \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/${SB_RECOVERY_SHA}/scripts/book-oauth-app-only-resume-install.mjs" \
    --output "$SB_RECOVERY_FILE"
  printf '%s  %s\n' "$SB_RECOVERY_HASH" "$SB_RECOVERY_FILE" | sha256sum --check
  node "$SB_RECOVERY_FILE" --installer-release="$SB_RECOVERY_SHA"
)
```

Expected sequence: checksum OK → existing SSH/sudo → fresh actual preflight →
reuse/hash existing image and overlays → preserve original checkpoint → complete
and authenticate three encrypted backups → checksum-verify their copy on Pop!_OS
→ explicit `TAK` → app-only replacement → automatic HTTPS/service/config checks
→ browser OWNER + MFA and `ODBIOR` or `ROLLBACK`.

No source certificate permissions are changed. If required state/image/config,
ledger, fresh MFA, backup/offsite checks, free space or locks disagree, STOP.
Unknown or partial artifacts are preserved for review, not deleted or overwritten.

The authoritative new result is:

```text
/opt/shadowbridge/.local/r1-owner-release-e871f2e09c25dc79f5222fa738ac446a103f1edc/recovery-state.json
```

Original `state.json` intentionally stays PLANNED. Do not edit its operator SHA
or delete it. The historical 53cc1ae updater and old incident-specific diagnostic
are not the recovery phase selector. Rerun this **same pinned block** after an
interruption: it resumes only the actual missing recovery phase, without rebuilding,
migrating or repeating a completed app swap.

To deliberately roll back after acceptance, append `--rollback` to this block's
last node line after reconfirming OWNER MFA. It restores only the previous app
image, retaining the live DB/new records. `--verify` instead checks accepted
recovery only. Neither option activates another integration.

Successful app acceptance reports `APP-ONLY RECOVERY ACCEPTED; REAL CHATGPT WRITE
NOT VERIFIED`. Real ChatGPT OAuth write/read/edit/revocation remains a separate
test. Registration, SMTP, Apollo, Clay and n8n workflows are not activated.

[Full gates, test evidence, backup format and rollback](OWNER-BOOK-OAUTH-RECOVERY.md).
