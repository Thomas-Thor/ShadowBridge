# OWNER Book: identify the active connector before reconnecting

## Evidence and limits

OWNER reports that release `80f4a0d333d31a6d57ada714b0df17bc0584a07b`
was accepted, but ChatGPT still shows only `read_notes`, `read_book_entries`
and `read_activity` after Refresh tools. OWNER also reports an old private
`shadowbridge-owner-book` 0.1.0 package (READ ONLY / API key Bearer) and a
separate app configuration. Their coexistence does not identify which one is
selected in that ChatGPT conversation.

This Codex session exposes no callable Book or Plugin Creator tools and cannot
inspect the user's installed package, app selection, secure credentials or
authenticated production `tools/list`. Public HTTPS reads were attempted normally
and with elevated execution: both stopped at the environment proxy with
`CONNECT tunnel failed, response 403`. No production HTTP response or metadata
was received. This is not evidence of a ShadowBridge HTTP 403 or OAuth failure.

The MCP and OAuth source files in the working tree are byte-identical to
`80f4a0d`. Source inspection establishes these distinctions:

| Layer | Actual behavior in 80f4a0d | Live result here |
| --- | --- | --- |
| Public OAuth metadata | Both discovery documents include `note.write`, `task.write` when `OWNER_BOOK_MCP_WRITE_ENABLED=true` | Not observed: proxy blocks access |
| Authenticated MCP `tools/list` | Publishes `create_book_entry`, `update_book_entry` whenever OAuth and write feature flags are enabled; no `.write` token scope is required just to list them | Not observed: no connected credential/tool |
| Write execution | Requires OAuth, actual OWNER + MFA, paired resource `.read`/`.write` and explicit separate consent | No real ChatGPT write attempted |
| Old token/refresh | Refresh does not upgrade consent to write | New authorization required for writes |
| Host action permission | Separate from OAuth scopes; a read-only tool policy may filter/block write actions | Host filtering not established |
| Static plugin declarations | A packaged read-only list/instructions cannot update themselves merely because server code changed | Old package reported by OWNER; actual selection unverified |

Do not infer write capability from the MCP `serverInfo.name` alone: in this
release it remains `shadowbridge-owner-book-readonly`, version `1.0.0`, even with
write enabled. Likewise `tools.listChanged=false` means there is no automatic
list-change notification, not that Refresh tools must use a stale list. Use the
actual authenticated `tools/list` result. OAuth access tokens also use HTTP Bearer;
a Bearer header alone does not distinguish API-key auth from OAuth.

## One ordered recovery procedure, without deployment

1. In the existing Plugin Creator/editor inspect **both existing configurations**
   before editing. Identify the one actually selected for the affected ChatGPT
   conversation, its non-secret package/app identity and version, MCP URL,
   authentication type, packaged tool names and read-only instructions. Keep
   the old package out of this conversation if the separate OAuth app is the
   intended connection; do not delete either configuration or create another.
   A skill being present is not proof of a bound MCP connection. If the editor
   cannot determine conversation selection, OWNER must select the intended
   existing OAuth app explicitly in ChatGPT and inspect its connection details.

2. From an environment able to reach the domain, read these public URLs (no
   credentials needed):
   - `https://shadow-bridge.eu/health`
   - `https://shadow-bridge.eu/.well-known/oauth-authorization-server`
   - `https://shadow-bridge.eu/.well-known/oauth-protected-resource/api/integrations/owner-book/v1/mcp`
   Confirm the expected release and that **both** metadata documents advertise
   `note.write` and `task.write`. Missing scopes mean an actual runtime/flag/route
   discrepancy; stop reconnect attempts and inspect the running configuration
   read-only. Do not rerun migration 021 or the deployment as a diagnostic.

3. Through the **existing secure connection**, obtain a fresh authenticated MCP
   `tools/list`, not the host's displayed/cached tool inventory. Transport is
   Streamable HTTP POST at
   `https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp`.
   Send `Accept: application/json, text/event-stream` and JSON-RPC
   `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`
   using credentials supplied by the host's secure connection mechanism.
   Never extract/paste the bearer, cookies, OAuth codes or refresh tokens into
   chat or a browser console. The endpoint intentionally rejects cookies/Origin;
   OWNER's browser login is not a machine-connection credential.
   If the host/editor cannot make this authenticated inspection, report that
   limitation rather than presenting its UI inventory as the server response.
   Report only HTTP status and advertised tool names/annotations.

   - Raw list has write tools but ChatGPT does not: fix the selected package,
     packaged allowlist, cached schema or host tool policy, not the database.
   - Raw list has no write tools: compare the exact endpoint/routing and live
     flags with release 80f4a0d. More OAuth scopes cannot fix a missing tool list.
   - HTTP 401: repair/re-authorize the existing connection; no listing conclusion.
   - Writes appear but return `insufficient_scope`: perform the next step.

4. Update the **selected existing integration**, keeping its identity and URL.
   Use OAuth authorization_code + PKCE S256 and discovery, not the old API-key
   descriptor. Remove a fixed three-tool-only allowlist and obsolete blanket
   no-write instruction; keep read-only default, explicit OWNER commands and
   per-action confirmation for writes. Import actual server schemas rather
   than hand-writing replacement tools. `docs/owner-book.mcp.connection.json`
   is a description, explicitly **not** an installable plugin manifest.
   Where the host exposes action policy, allow write tools with confirmation
   instead of `Allow read-only tools`; this is independent of server OAuth.
   If the host cannot update the existing package or permit those tools, record
   the exact limitation; no unauthenticated fallback or second MCP server.

5. Request **new authorization** for the same app with exactly:
   `note.read note.write task.read task.write`.
   Use the host's reconnect/re-authorize facility if provided. If it offers only
   disconnect/connect, reconnect the same existing app; do not reinstall the
   server. A token refresh or Refresh tools alone cannot add scopes. If needed,
   revoke only the identified old grant at
   `https://shadow-bridge.eu/oauth/owner-book/connections` under fresh OWNER MFA,
   then reconnect that app. Never revoke unrelated grants or change OWNER MFA.
   The consent page must say **Create and edit Book entries**, display the exact
   four scopes, and require the unchecked separate write-consent checkbox plus
   **Allow the listed Book writes**. If it says **Read-only access**, the client
   has not requested write scopes: stop, do not approve and claim success.
   A write-specific `insufficient_scope` challenge is also implemented, but host
   support for automatic scope escalation must not be assumed.

   Discovery/auth endpoints:
   - authorize: `https://shadow-bridge.eu/oauth/owner-book/authorize`
   - token: `https://shadow-bridge.eu/oauth/owner-book/token`
   - dynamic registration: `https://shadow-bridge.eu/oauth/owner-book/register`
   - MCP resource: `https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp`

   Existing callback allowlist is exact:
   `https://chatgpt.com/connector_platform_oauth_redirect` or
   `https://platform.openai.com/apps-manage/oauth`.
   A different actual callback requires review, not a wildcard. Client-generated
   state, PKCE verifier and authorization code must not be constructed in chat.

6. Refresh the selected app's actual tools and attach that connection to the
   test conversation. Test one fictional note and task: create, read current
   ID/version, edit with stable operation UUIDs, then read persisted results.
   OWNER withdraws writes via the existing connections page. Verify subsequent
   write rejection and continued read access. No imports, deletion, CRM access,
   migrations, redeploy, n8n changes or production data cleanup in this procedure.

## Small request for the existing Plugin Creator

```text
Inspect, then update my EXISTING ShadowBridge OWNER Book integration; do not
create a plugin/server. There is an old shadowbridge-owner-book 0.1.0 API-key
read-only package and a separate app. Identify which is selected in my affected
conversation; do not infer this from their names. Report only non-secret identity,
URL, auth type, declared tool names and read-only restrictions.
Through the host's secure existing connection obtain actual tools/list from
https://shadow-bridge.eu/api/integrations/owner-book/v1/mcp and compare it with
the host inventory. Inspect public OAuth discovery for note.write/task.write.
If raw tools include create_book_entry/update_book_entry, update the selected
existing integration's stale declarations/instructions and discover real schemas.
Use OAuth PKCE S256 and new explicit OWNER+MFA consent for
note.read note.write task.read task.write. No API key in chat, no account changes.
Expose writes only for explicit OWNER instructions with action confirmation.
Report any unsupported host step precisely. Do not execute test writes here,
rerun deployment or migration 021, or create another connection/server.
```

Status: **CODE PATH CONFIRMED / LIVE METADATA AND RAW LIST UNVERIFIED /
ACTIVE CHATGPT CONFIGURATION NOT IDENTIFIED FROM THIS SESSION**.
