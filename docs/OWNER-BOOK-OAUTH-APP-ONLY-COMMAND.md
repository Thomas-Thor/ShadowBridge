# Pop!_OS operator command — run only after separate OWNER approval

Installer/operator commit:
`53cc1ae500f55f2386d913731e3e73679b856069`

Standalone installer SHA-256:
`7daf78fb3093b948553a62b8b01dafe7cbbd64e12d7ec71400ed9de79ebf2acd`

Application stays separately pinned to
`e871f2e09c25dc79f5222fa738ac446a103f1edc`, updating accepted
`80f4a0d333d31a6d57ada714b0df17bc0584a07b`. No migrations.

**LOCAL COMPUTER POP!_OS**, OWNER's normal Linux account, interactive terminal.
Existing Node, SSH, sudo access on Contabo and a verified known_hosts entry are
required. Nothing is run by Codex on Contabo. This command is an executable
deployment after approval, not a read-only diagnostic.

First reconfirm the existing OWNER MFA in the browser. Then:

```bash
(
  set -eu
  umask 077
  SB_OPERATOR_SHA='53cc1ae500f55f2386d913731e3e73679b856069'
  SB_INSTALLER_HASH='7daf78fb3093b948553a62b8b01dafe7cbbd64e12d7ec71400ed9de79ebf2acd'
  SB_INSTALLER_FILE="$(mktemp /tmp/shadowbridge-oauth-app-only.XXXXXX.mjs)"
  curl --fail --silent --show-error --location --max-redirs 3 \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/${SB_OPERATOR_SHA}/scripts/book-oauth-app-only-install.mjs" \
    --output "$SB_INSTALLER_FILE"
  printf '%s  %s\n' "$SB_INSTALLER_HASH" "$SB_INSTALLER_FILE" | sha256sum --check
  node "$SB_INSTALLER_FILE" --installer-release="$SB_OPERATOR_SHA"
)
```

Expected: checksum `OK`, interactive verified SSH/sudo (never in chat), preflight,
encrypted backups and verified transfer to Pop!_OS, explicit `TAK`, app-only swap,
HTTP checks, then browser OWNER + MFA acceptance. Enter `ODBIOR` or `ROLLBACK`.
Success is app acceptance with `chatgptWriteVerified:false`, not a completed
ChatGPT write test. n8n and other services remain untouched.

Safe interruption before replacement leaves the old app running. Rerun this
same block to read its checkpoint and select only the missing step. It does not
rerun successful swaps or migrations. Unknown/PLANNED/rolled-back/locked states
stop for review; never delete state or operation locks to force continuation.

For a deliberate rollback after acceptance, use the same verified command with
`--rollback` appended to its final `node` line, after fresh existing OWNER MFA.
This rolls back only the app image to the recorded 80f4a0d, keeping the live DB
and all post-backup records. `--verify` instead performs only accepted-release
verification. Do not use the old `--book-write` installer or production deploy.

Full gates, backup formats, resume behavior and test limitations:
[OWNER-BOOK-OAUTH-APP-ONLY.md](OWNER-BOOK-OAUTH-APP-ONLY.md).
