# One read-only command on OWNER Pop!_OS

Diagnostic/fix source commit: `b1a9e44c16a6996fcb86ee1fd0afd7074c99737c`.
Diagnostic SHA-256: `9a07a6072830e79f789146c664abeb51c5736f18f279fc274406af15507c9529`.

This command downloads a public reader to a private temporary file on Pop!_OS,
verifies its checksum and uses existing SSH/sudo to read metadata on Contabo.
It does not install the code fix there, change Git, run the updater, alter
permissions, create locks/checkpoints, migrate or restart any service. No secret
is supplied as an argument. Enter SSH/sudo credentials only in their normal prompt.

```bash
(
  set -eu
  umask 077
  SB_DIAG_SHA='b1a9e44c16a6996fcb86ee1fd0afd7074c99737c'
  SB_DIAG_HASH='9a07a6072830e79f789146c664abeb51c5736f18f279fc274406af15507c9529'
  SB_DIAG_FILE="$(mktemp /tmp/shadowbridge-read-only-diag.XXXXXX.mjs)"
  curl --fail --silent --show-error --location --max-redirs 3 \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://raw.githubusercontent.com/Thomas-Thor/ShadowBridge/${SB_DIAG_SHA}/scripts/book-oauth-app-only-diagnose.mjs" \
    --output "$SB_DIAG_FILE"
  printf '%s  %s\n' "$SB_DIAG_HASH" "$SB_DIAG_FILE" | sha256sum --check
  node "$SB_DIAG_FILE" --ssh
)
```

Return only its sanitized JSON, not raw state files, build logs or environment.
Read `firstObservedMismatch`, `publicCaExpectationConflict`, `checkpoint`,
`artifacts`, `targetImageMatchesOverlay`, `runtime` and `health` together.
`resumeAuthorized:false` is intentional: this diagnostic does not authorize or
attempt recovery. Closing SSH after the JSON is normal.

The original installer's SHA-256 remains
`7daf78fb3093b948553a62b8b01dafe7cbbd64e12d7ec71400ed9de79ebf2acd`;
that is not a new approved recovery package. The minimal exact-public-CA policy
fix is committed but not deployed. A PLANNED checkpoint pinned to 53cc1ae cannot
be silently adopted by another operator SHA. Preserve it and any built image.

[Cause, tests and conditional recovery method](OWNER-BOOK-OAUTH-PERMISSIONS-DIAG.md).
