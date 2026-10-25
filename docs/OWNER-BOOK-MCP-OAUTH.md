# OWNER Book MCP: OAuth connection

This replaces the unconfirmed API-key form path. One existing Node app and MCP
adapter, existing OWNER/GoTrue/TOTP and PostgreSQL; no new identity provider,
account, secret in a plugin, server, domain or service subscription.

## ChatGPT form

| Field | Value |
|---|---|
| Name | ShadowBridge OWNER Book |
| MCP URL | `https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth (not mixed/no authentication) |
| Client ID / secret | Leave optional fields empty; discovery uses Dynamic Client Registration |
| Initial scope, if selectable | `note.read` |

Discovery is `https://shadow-bridge.eu/.well-known/oauth-authorization-server`.
Protected-resource discovery is `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp`.
Authorization/token/registration/revocation endpoints are respectively
`/oauth/owner-book/authorize`, `/token`, `/register`, `/revoke` under the same
prefix. Discovery publishes their full URLs. No OIDC ID token or password grant.

The exact callback allowlist is:

- `https://chatgpt.com/connector_platform_oauth_redirect`
- `https://platform.openai.com/apps-manage/oauth`

Unknown callbacks fail closed. If the actual ChatGPT client demands a client
secret or uses a different callback, stop and record only the non-secret callback
and error. Do not select no authentication, add wildcard redirects or paste a
token in chat. DCR supports public PKCE clients and confidential clients using
client_secret_post/basic when the client itself requests these. Secrets are
returned once over HTTPS to that client and only SHA-256 hashes are stored.

## Authorization and limits

Click Connect. ShadowBridge opens its own consent page. Sign in in the provided
new tab with the existing OWNER account; open Command Center and verify existing
TOTP. Return to the consent tab, choose Check access, review the exact read scopes
and choose Allow read-only access. The browser returns to ChatGPT. OAuth does not
create an OWNER or change a password, role, factor, CRM record or Book entry.

Fresh MFA is enforced by the existing `sb.require_fresh_owner_mfa()`, both for
consent and connection management. Consent is session-CSRF protected, bound to an
HttpOnly browser nonce, signed with the existing server key and expires in five
minutes. Codes expire in two minutes, are one-use and require S256 PKCE, exact
registered redirect and the MCP `resource`. An attempt to redeem a used code
with the same client and proof revokes that delegation.

Access tokens expire in ten minutes; refresh tokens rotate, expire with the
seven-day grant, and reuse revokes the entire grant. Every read checks that the
real OWNER remains active, email-confirmed and has verified TOTP. OAuth tokens
are audience-bound to MCP and cannot authenticate to REST. Existing REST/API keys
remain unchanged. No writes, import, export, CRM, passwords, roles or key
administration are delegated. Optional task/idea/event/decision/journal read
scopes use the existing access checks and CRM-redacted journal.

Revoke a connection at `https://shadow-bridge.eu/oauth/owner-book/connections`
using the existing OWNER session and fresh MFA. Disconnect in ChatGPT as well.
There is no background cleanup job in this version. Expired records remain
private for audit; a reviewed retention policy is required before broader use.
Limits: five registrations per client-address bucket/minute, 256 unexpired
clients, ten active grants per OWNER, twenty unexpired consent codes per OWNER,
60 token/read requests per client bucket/minute and 60 reads/grant/minute.

## Controlled update from 35c41f7

Use only the checksum-pinned Pop!_OS block supplied with the final release SHA.
It runs `scripts/r1-owner-deploy.mjs --release=FULL_SHA --book-oauth` through the
existing SSH connection, never asks for a key in chat, and verifies known hosts.
It refuses an unknown/dirty server checkout, mismatched runtime, active lock,
unaccepted base, missing fingerprints, newer ledger or insufficient disk.

The accepted 35c41f7 checkpoint must show `book-mcp`,
`DEPLOYED_AND_VERIFIED`, OWNER acceptance and the exact running image; REST and
MCP must already be enabled, OAuth disabled, and migrations 001–018 unchanged.
The update builds the pinned app/migrator, pauses app/Auth for a consistent
snapshot, briefly pauses gateway to copy its certificate state, encrypts and
authenticates DB/config/certificate backups, transfers all six archive/key files
to the OWNER computer, verifies SHA/size and requires the offsite receipt.
Only then is additive migration 019 applied by the existing ledger migrator.
It adds five RLS tables and two narrowly granted RPCs. No existing migration,
account, password, session, role, MFA or CRM row is edited. Runtime stays non-DBA.
Only the app image/release and explicit OAuth flag change. Gateway/n8n/Auth/
database container identities, env, networks and volumes are checked unchanged.

After interruption rerun the same pinned block. It reads the checkpoint first:

| Saved phase | Action |
|---|---|
| No checkpoint | Full preflight and initial preparation |
| BACKUPS_VERIFIED_WAITING_OFFSITE | Verify/reuse the same backups; transfer missing local files; apply once |
| MIGRATING | Resume only if migrator exited 0, all 19 hashes match and preserved-data checks pass; never rerun SQL |
| SCHEMA_VERIFIED / APP_STARTING | Finish the recorded app step, verify, then OWNER acceptance |
| DEPLOYED_PENDING_OWNER_ACCEPTANCE | Only existing OWNER + new TOTP acceptance |
| DEPLOYED_AND_VERIFIED | Verify only; no rebuild, backup, migration or deployment |
| Other phase or stale lock | STOP for inspection; never delete state/locks or force restart |

Build/preparation failures without a complete safe checkpoint stop for inspection.
The updater never interprets a failed sudo password as evidence of production
state. Enter the Linux sudo password on Contabo, not a portal password or TOTP.

On failed app verification use the existing automatic application-only rollback
to the preserved 35c41f7 image/override. Additive 019 remains; never restore an old
database on production or drop new OAuth data. Manual rollback after acceptance:
`sudo node scripts/r1-production-release.mjs rollback --release=FULL_SHA --book-oauth`
on Contabo in `/opt/shadowbridge`. Emergency OAuth-only disable uses the same
coordinator with `off`; it preserves REST and the MCP adapter. No `down -v`, prune,
database reset, forced Git switch or manifest regeneration is part of this flow.

## Acceptance and evidence

Deployment success is only `OAUTH_ENABLED_CHATGPT_NOT_CONNECTED` until an actual
ChatGPT `read_notes` returns an existing authorized Book entry. First request one
page or one agreed title, verify against OWNER UI, then revoke the connection and
confirm the old token is denied. Do not publish note contents, tokens or secrets
as test artifacts. No write test is part of this release.

References checked 25 October 2026:

- [Official OpenAI authenticated MCP example](https://github.com/openai/openai-apps-sdk-examples/blob/main/authenticated_server_python/README.md): OAuth discovery and authentication challenges.
- [Official MCP authorization specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx): protected-resource metadata, PKCE, audience/resource binding and registration options.
- [OpenAI auth guide](https://developers.openai.com/apps-sdk/build/auth): HTTP 403 from this environment's proxy, including the escalated attempt; full live UI/client compatibility remains to be confirmed, not inferred from local tests.

No SSH credentials/agent or callable ChatGPT connector were available in Codex.
No production deployment or actual ChatGPT read is claimed by this document.

Local verification: [machine-readable results](OWNER-BOOK-MCP-OAUTH-RESULTS.json).
There are 51 distinct targeted cases, six real PostgreSQL security groups and
seven built-image/restore/rollback groups. Later focused reruns are not added to
that total. Real PostgreSQL/native tests substitute only the retained fixture's
executor role name and use explicit fictional SQL OWNER/MFA claims; they are not
an interactive GoTrue/TOTP test or a ChatGPT connection. Migration hashes and
all pre-existing data are checked. The old native image's 68 pinned runtime files
were byte-compared with the required 35c41f7 base before rollback compatibility
was accepted. Its image revision label remains 9192b868; it is not falsely labeled
as a production image.

The Codex Docker DNS issue was resolved only for isolated builds by mapping the
already configured proxy name to its actual host-resolved address, with the
existing build CA supplied as a secret. No production Dockerfile, DNS setting,
proxy credential, TLS policy or dependency was changed. Both original Dockerfile
targets built successfully. Tests and backups stay on the separate temporary
filesystem; no shared cache, existing data or volume was removed.
