# APP-ONLY recovery of the original PLANNED checkpoint

**PREPARED / TESTED IN ISOLATION / NOT DEPLOYED. Separate OWNER approval required.**

Package: `d71ca2eaf6179b0f089a02ff32c83a80d9e38310`.
[Exact checksum-pinned Pop!_OS command](OWNER-BOOK-OAUTH-RECOVERY-COMMAND.md).

This package resumes only the diagnosed original operator
`53cc1ae500f55f2386d913731e3e73679b856069`, accepted runtime
`80f4a0d333d31a6d57ada714b0df17bc0584a07b` and already-built target
`e871f2e09c25dc79f5222fa738ac446a103f1edc`. It includes the exact-public-CA policy
fix from `b1a9e44c16a6996fcb86ee1fd0afd7074c99737c`.

No building, pulling a replacement image, migrations, account/role/MFA changes,
permission repairs, SMTP, registration, DNS, n8n or sourcing activation is part
of the new recovery mode. The old normal preparation mode remains for historical
compatibility but cannot be entered through the dedicated recovery launcher.

## Immutable original and separate progress

Original, preserved byte-for-byte, under
`/opt/shadowbridge/.local/r1-owner-release-e871f2e09c25dc79f5222fa738ac446a103f1edc/`:

- `state.json` — stays PLANNED with original operator identity;
- `application.json`, `rollback.json` — never regenerated or overwritten;
- the existing runtime image, rollback image/tag and build log.

New files in that same protected checkpoint directory:

- `recovery-state.json` — the authoritative recovery phase and new operator SHA;
- `recovery/origin.json` — write-once link to original checkpoint bytes, overlay
  checksums, accepted base receipt and immutable image IDs;
- `recovery/` encrypted backup archives, separate keys and partial-step journals.

The original checkpoint, root ownership, SHA-256 and overlay bytes are checked
on continuation. The original operator field is not manually edited. A different
operator/phase, progressed original checkpoint or changed preflight snapshot is
rejected, not silently adopted. Original PLANNED remaining visible after a
successful recovery is intentional: inspect **recovery-state.json** for its result.

## Actual order and gates

1. The checksum-pinned Pop!_OS launcher uses existing SSH/known_hosts/sudo. On the
   server it fast-forwards only the existing operator R1 checkout to the approved
   package SHA. A dirty checkout or active operation lock stops it; no reset.
2. Revalidate real accepted 80f4a0d checkpoint/image, app source/configuration,
   private ports, internal TLS, HTTPS/n8n, roles/fresh OWNER MFA, disk/inodes,
   fingerprints and exactly unchanged migrations 001–021. Compare the actual
   preflight snapshot against the snapshot stored by 53cc1ae; do not replace
   evidence of drift with a new baseline.
3. Require exact existing overlays and rollback tag. Check the already-built
   image's revision/user/default command/environment and byte fingerprints
   against immutable e871f2e Git files. This uses a newly created **stopped**
   technical container, network none, read-only, capabilities dropped, no new
   privileges and resource limits. Its entrypoint is sha256sum, not the app.
   Files are copied out for hashing; it is never started. Only that newly
   identified technical container and its own temporary public-code archive
   are removed. Existing containers and volumes are never removed.
4. Write/verify the immutable origin receipt and separate recovery state. The
   normal build function is never called, and the existing overlays are reused.
   Public `certs/internal-ca.crt` remains 0644; private keys/settings remain 0600.
5. Produce the missing online consistent PostgreSQL dump, encrypted configuration
   and stable online Caddy certificate snapshot using the existing GCM/archive
   checks. No existing service is stopped for those backups. Each pair's intent
   and completion is checkpointed. An already complete pair is authenticated and
   reused; an interrupted complete-but-not-yet-recorded pair is verified before
   adoption. Unknown, partial, corrupt or substituted files stop without overwrite.
6. Transfer all three archives and separate keys to Pop!_OS, verify sizes and
   SHA-256 there, and validate the server's matching offsite receipt. Only then,
   after another explicit `TAK`, recreate **app only**, using the immutable
   existing target image and `--no-deps --no-build --pull never`.
7. Check real source/image/configuration, HTTPS/public routes, OAuth discovery,
   anonymous MCP denial, unchanged services and ledger. OWNER signs in with the
   existing account, reconfirms TOTP and enters `ODBIOR` or `ROLLBACK`.

The new launcher is `scripts/book-oauth-app-only-resume-install.mjs`.
Do not reuse `book-oauth-app-only-install.mjs` or the old first-write installer.
No SSH credential, TOTP, API key, OAuth token or backup key belongs in chat.

## Backup locations and restart

New server transfer folder:
`/home/shadowadmin/.shadowbridge-oauth-recovery-e871f2e09c25dc79f5222fa738ac446a103f1edc/`.

On OWNER Pop!_OS:

```text
~/.local/state/shadowbridge-oauth-recovery/e871f2e09c25dc79f5222fa738ac446a103f1edc/archives/
~/.local/state/shadowbridge-oauth-recovery/e871f2e09c25dc79f5222fa738ac446a103f1edc/recovery-keys/
```

Archives/keys are 0600 in separate 0700 folders; existing copies are validated,
not overwritten on checksum mismatch. Keep keys apart from archives and retain
an independent/offline recovery copy as appropriate. The dump is the dedicated
online pg_dump format, paired with separate configuration/certificate archives,
not the older packed staging recovery envelope. Never restore it onto the live DB
as part of app rollback.

Rerun the **same pinned recovery command** after interruption:

- no sidecar yet: validate/adopt the exact original PLANNED artifacts;
- RECOVERY_VALIDATED/BACKUPS_IN_PROGRESS: resume missing backup stages;
- BACKUPS_VERIFIED_WAITING_OFFSITE: verify/copy the existing offsite bundle;
- SWAPPING_APP: inspect actual old/new image and continue without repeating a
  completed replacement;
- DEPLOYED_PENDING_OWNER_ACCEPTANCE: ask for acceptance or rollback only;
- DEPLOYED_AND_VERIFIED: verify only;
- unknown/rolled-back/corrupt/incompatible state: STOP and preserve evidence.

Partial plaintext/keys or incomplete copies can require operator review; the
package deliberately does not delete such evidence to force a retry. No global
prune/cleanup, lock deletion, recursive chmod/chown or checkpoint replacement.

## Rollback

Failed app replacement or health verification invokes the existing controlled
app-only rollback, provided recorded configuration/image identities still match.
It restores the actual previous image; the **live DB and every new record remain**.
An unknown image, changed protected service/configuration or unverified rollback
means STOP with retained checkpoint, not a guessed restore.

At the browser acceptance prompt enter `ROLLBACK`. For a deliberate rollback
after acceptance, use the same pinned command with `--rollback` appended to the
last node line, after fresh existing OWNER MFA. `--verify` performs only accepted
recovery verification. Neither path resets users/MFA or restores old DB data.

## Actual tests (2026-10-26)

32 targeted tests PASS: original-state/preflight agreement, exact overlays,
consent/MFA gates, sidecar flow, missing proof, backup journaling/reuse, partial
and corrupt artifacts, prohibited build/prepare route, source CA policy,
configuration continuity, app-only swap/rollback and safe bundle handling.

7 groups PASS with the **existing real images**, Compose and PostgreSQL:

- clone only fictional ledger-21 data, without a migration;
- preserve original checkpoint/overlay bytes, hash the stopped target image,
  adopt once, interrupt after verified DB backup, resume all three encrypted
  backup pairs without a second DB dump, restore into a separate empty test DB;
- actual app-only replacement and authenticated MCP discovery;
- persist a fictional post-backup entry and retain it after old-image rollback;
- automatic old-image rollback after deliberately failed new-image verification;
- interrupted swap resumes without another replacement; acceptance/verify work;
- reject corrupt GCM and preserve original users, sessions, factors and ledger.

No image was built for these recovery tests. A first lab attempt could not start
a fingerprint helper with resource limits because nested Docker's cgroups are
restricted. The final implementation hashes a stopped container instead; limits
and isolation were retained. The final real-image recovery run passed.

Production hostname/root/path guards were never bypassed. Native tests use the
shared real flow and actual components through isolated adapters, with fictional
SQL OWNER/MFA claims and the existing executor-role fixture alias. They do not
prove real OWNER interactive GoTrue/TOTP, actual offsite SSH transfer or a ChatGPT
write. Those remain production/operator acceptance. No Contabo action occurred.

The terminal result separates app acceptance from integration acceptance:
`APP-ONLY RECOVERY ACCEPTED; REAL CHATGPT WRITE NOT VERIFIED`.
After deployment, refresh the same ChatGPT connection and request exactly
`note.read note.write task.read task.write`; complete the real write/read/edit/
revocation test separately. No SMTP, registration or sourcing stage starts here.
