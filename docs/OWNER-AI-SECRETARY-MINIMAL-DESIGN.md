# OWNER AI Secretary — minimal next-stage design

**Architecture only. Start after real MCP write acceptance. No model, container,
workflow, synchronization or paid service has been activated.**

## Reuse existing infrastructure

Use the existing OWNER login/MFA, Book, its API and PostgreSQL. Add one OWNER-only
chat view inside Command Center and one small private worker/container on the
existing Contabo. No public worker port, new platform or second CRM. The browser
uses the existing backend; model/provider credentials never reach the browser,
Book entries, prompt context, repository or logs.

The worker gets a dedicated named service principal/credential restricted to
approved Book kinds and redacted reports, with independent revocation, rate and
spending limits. It must not receive the OWNER browser session, administrator
MFA secret, OWNER role, raw PostgreSQL credentials or the n8n administrator key.
The present Book API keys belong to OWNER; a truly separate unattended service
binding still needs explicit implementation and tests, not a renamed OWNER login.

Flow: OWNER command → bounded context read → model proposes structured actions →
server validates scope/fields/version/operation UUID → approved action executes
through existing Book API → DB readback → result and operation journal. Book is
durable memory; chat history is not the source of truth. Reuse task dependencies,
calendar, history, archive and existing in-app reminders.

Ordinary organization may run within explicit OWNER delegation. Destructive
changes, paid calls beyond the approved model budget, contact with external
parties, imports and infrastructure actions need a separate OWNER confirmation.
No raw SQL/shell/browser-administration tool. Treat notes/documents as untrusted
data, not instructions to expand permissions. New business decisions are recorded
as drafts unless the OWNER explicitly authorizes recording the decision.

## One-time reconciliation first

Use the **actual existing Google Sheets central CRM**, Apollo/Clay exports and
Book. First identify the real sheet/workspace, access rights and source exports;
do not assume the private OWNER VAULT or an example file is the target CRM.
Current tools do not provide this access; no source has been imported here.

Read current data including archive/completed tasks, preserve stable IDs and
source/date, and produce a bounded comparison. Match companies by strong source
ID or normalized domain+country, people by source ID or work email plus company;
name similarity alone requires review. Compare tasks/ideas by source and content,
not title alone. Preserve prior manual edits and completed status.

OWNER approves exact missing-record preview after an encrypted backup with a
verified copy outside VPS. Write contacts to existing CRM, tasks/ideas to Book,
as separate batches with stable command IDs/receipts. Google Sheets imports must
use literal/RAW values to avoid executing source text as formulas. Read back
IDs/counts/contents, then close temporary import rights. No automatic deletion or
overwrite; ambiguous identities and conflicting changes stay for human review.

## Morning reporting without changing current workflows

Reuse existing n8n after separate authorization. The planned 08:00 Europe/Oslo
report combines actual execution receipts, new companies/usable contacts,
duplicates, errors, provider credit measurements, upcoming Book deadlines and
decisions awaiting OWNER. A new contact requires a documented usable channel;
company-only leads are a separate count. Handle DST through the existing Oslo
schedule and a persistent date/window key, never duplicate a reporting window.

Expose only a narrowly scoped aggregate-report contract to the secretary, not
CRM records or OWNER VAULT. `journal.read` currently redacts CRM details and does
not prove agent execution/cost data are connected. Missing sources/balances are
NO DATA, not zero. Credit Ledger notes are not a live structured billing feed.
No nightly sourcing or email delivery is activated by this design. Sending the
report by mail needs approved SMTP and a successful delivery test first.

## Model and cost

Default proposal: external API with bounded retrieval and small contexts; choose
the provider/model only after approval of processing, retention and current price.
The public price page was blocked by the environment proxy (403), also on the
permitted retry. **The following is a calculation scenario, not a verified quote.**

Example workload: 20 commands/day × 30 days, 4,000 input and 600 output tokens per
command including context/tools = 2.4M input + 0.36M output tokens/month.
At assumed rates USD 0.40/1M input and USD 1.60/1M output, that is **USD 1.54/month**.
At 100 commands/day under the same assumptions: **USD 7.68/month**. Extra model
turns, retries, reasoning tokens, long histories and tool payloads increase cost.
Formula: `inputMillions × verifiedInputRate + outputMillions × verifiedOutputRate`.

Propose a hard **USD 5/month** pilot ceiling with a smaller daily limit, atomic
reservation before each call, conservative maximum response size and STOP when
cost is unknown or the ceiling would be exceeded. This budget is **not approved**;
the separate Apollo canary consent does not approve model costs. Extra VPS
subscription cost proposed: USD 0, using the existing machine. Prices exclude
tax and currency conversion; do not combine NOK/USD without a documented rate.
Current official pricing must be verified at <https://openai.com/api/pricing/>
or the chosen provider before activation. No API model request was made here.

## Local model: assess, do not assume capacity

Known machine: 6 vCPU, 12 GB RAM, no confirmed GPU. Current resident service load
and CPU inference speed have not been measured. Rough planning ranges only:
3B Q4 weights around 2 GB, plus runtime/context commonly another 1–3 GB;
7–8B Q4 weights around 4–6 GB plus several GB runtime/context. Actual model,
context, concurrency and implementation determine the real footprint.

PostgreSQL/GoTrue/Node/Caddy/n8n need their own reserve. A 7–8B model may compete
with production; no performance claim or local installation is justified yet.
Before considering it: isolated benchmark, measured RSS/CPU/tokens per second,
bounded context and one concurrent request, cgroup CPU/RAM limits, no production
OOM/swap pressure, timeout/kill and quality checks in Polish/English. Accept it
only if it preserves production headroom. Local inference avoids per-token fees,
not CPU/RAM costs or the need for reliable authorization and readback.

## Minimal changes, later acceptance

1. Finish existing MCP write acceptance in real ChatGPT.
2. Authorized read-only source reconciliation, then separately approved import.
3. OWNER-only chat UI and bounded server action controller.
4. Dedicated service identity, private model secret, spend reservations and
   immutable action receipts; no broad OWNER/admin credential.
5. Read-only aggregate reporting integration and real in-app reminder checks.
6. Fictional test: scoped save/read/update, stale version, prompt injection,
   revoked credentials, unavailable API, budget STOP and recovery/retry.
7. Verified encrypted backup/isolated restore and application rollback; existing
   data remain. Production activation requires a separate OWNER decision.

## Public Market Europa assistant — separate future architecture only

Use a distinct service principal, storage, network boundary and credentials.
Read only explicitly published, sanitized public content and approved anonymous
offers through a dedicated public contract. No OWNER Book, private CRM, Private
Deals, OWNER VAULT, internal identifiers or infrastructure secrets in retrieval,
prompts, tools or logs. Server-side filtering/authorization, not UI hiding.
No internal proxy that accepts arbitrary resource URLs or role parameters.
Start with public help/read-only discovery; any authenticated Market action needs
its own user authorization. No deployment or Market feature work in this stage.
