# n8n security

## Never commit

- MCP tokens, n8n API keys, `Authorization` headers, session credentials
- production webhook secrets or unauthenticated webhook paths
- credential IDs or credential values
- `pinData` — pinned execution data routinely contains real contacts and reply bodies
- execution payloads, fixtures derived from real executions, or any personal data

Ignored in [`.gitignore`](../../../.gitignore): `.env*` (except the examples), `.mcp.local.json`,
`.n8n.local.json`, `automation/n8n/environments.local.*`, `automation/n8n/.exports/`.

Committed instead: setup docs, placeholder config, required variable **names**, verification commands.

## Defence in depth

| Layer | Where | What it does |
|---|---|---|
| 1 | n8n MCP | returns node `credentials` already empty — nothing to leak |
| 2 | `sanitize()` | drops `credentials`, `pinData`, `staticData`, `webhookId`, version/instance fields |
| 3 | `scan.mjs` | regex sweep for JWTs, `sb_*`, `sk-*`, `xox*`, `AIza*`, `AKIA*`, private keys, Postgres URLs with inline passwords; plus hardcoded auth headers and unauthenticated webhooks |
| 4 | `n8n:export` | **refuses to write** a file that still trips layer 3 |
| 5 | `n8n:validate` in CI | re-runs layer 3 on every committed artifact and fixture, on every PR |

Layer 4 matters most: a sanitizer bug fails loudly instead of committing a credential.

The credential **contract** — which alias a node needs and of what type — lives in `manifest.yaml`,
not in the graph. An alias in `workflow.json` that no instance can resolve would be a lie in the
artifact.

## Fixtures

Synthetic only. Never produced by copying a production execution. Each fixture carries a `_fixture`
note stating the case and that it is invented; `n8n:validate` warns when that note is missing and
runs the secret scanner over fixtures too.

## Open findings

Found during the 2026-07-21 inventory unless dated otherwise. Everything is recorded so it is not
rediscovered — including the two that are now closed, which keep their history rather than vanishing.

### 1. Per-client vendor API keys live in a Google Sheet — **high, partially closed 2026-07-22**

**Closed for `bison-lead-enrichment`.** All eight of its Bison calls now take the bearer token from
`client_sequencers` via `[S0] Resolve Bison credentials`, and the literal token in `[69]` is gone.
A guarded fallback to `col_6` remains for the 7 onboarding workspaces with no row yet; delete it once
[`sheets-bison-credential-sync`](../../../automation/n8n/workflows/ops/sheets-bison-credential-sync/README.md)
has run and the three missing clients exist. **Every other workflow below is unchanged.**


`ooo-detect-and-log` (and its siblings) read the CS PDCA sheet, take the Bison API key from `col_6`,
and interpolate it into an `Authorization: Bearer` header expression. The Aimfox workflows do the
same with **`col_105`** (`aimfox-daily-metrics`, `aimfox-import-to-connection`) — so both channels'
per-client credentials sit in one spreadsheet.

Consequences: the keys sit in a spreadsheet with Google-Docs sharing as their only access control;
they are outside n8n's credential store, so they are not encrypted at rest by n8n, not rotatable from
one place, and visible to anyone with sheet access. [11-integrations §3](../functional/11-integrations.md)
documents `client_sequencers.api_key` as the source of these keys — the workflows do not use it.

Not caught by `scan.mjs`: the JSON contains an expression, not a literal. This is a real limit of the
scanner, not an oversight.

### 2. The production MCP token carries destructive scopes — **high**

One token, full scope, production only. See [environments.md](environments.md). Mitigation today is
policy plus the `callWriteTool` guard. Fix: a separate read-only key for day-to-day work.

### 3. The HUB webhook is the entry point for all reply processing — **medium**

`[HUB] Bison Replies Dispatcher` (`xPzdtWQiY3lGtqI1`) is triggered by an `n8n-nodes-base.webhook`
node. If it has no authentication configured, its URL path is effectively a bearer secret: anyone
holding it can inject synthetic tag events and drive lead creation, blacklisting and CRM sync.

`scan.mjs` raises `unauthenticated-webhook` for exactly this shape. **Status: unverified** — the HUB
is not yet imported, so nothing has scanned it. Verify when it is imported
([migration-backlog §2](migration-backlog.md#2-hub-dispatcher)).

**Two Aimfox webhooks are confirmed unauthenticated** (scanned 2026-07-21): `aimfox-classifier`
(`JnvRBXtRNar7ejeM`) and `preMQL-Aimfox` (`s0GqDtCzyLAvVnm1`). Holding either path is enough to
drive lead creation, Lusha enrichment spend, outbound notifications and workspace blacklisting.
Blacklisting is the worst of these: it permanently removes a company or contact from a client's
reach ([process invariant 7](../processes/outreach/linkedin-aimfox.md#business-invariants)).

### 4. OOO state lives in a Google Sheet outside RLS — **medium**

The `OOO Leads` sheet holds contact identifiers and absence dates for every client, in one document,
with no per-client isolation. [ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) §8
deliberately makes this data internal-only and client-scoped via `private.can_manage_client`; the
sheet has no equivalent. Closed by the OOO cutover
([migration-backlog §1](migration-backlog.md#1-ooo-cutover)).

### 5. No workflow writes through `service_role` RPCs yet — **partially closed 2026-07-21/22**

Every ADR-0015 invariant is `SECURITY DEFINER`, `search_path = ''`, `service_role`-only, and correct.
The OOO family now reaches it: all four workflows call `upsert_sequencer_contact`, `upsert_reply`,
`record_ooo_followup` and `cancel_active_ooo_followup` in phase A.

Still unreached for **leads**: `promote_contact_to_lead` has no caller. The Supabase branch inside
`[child-1]` writes `leads` directly and is not wired to its trigger, so the RPC contract is bypassed
in design even though nothing runs — see [migration-backlog §2](migration-backlog.md#2-hub-dispatcher).

### 6. n8n connects to Postgres as a superuser — **high**

Measured 2026-07-21 from an n8n Postgres node (credential `Postgres account`, the one the OOO
workflows use):

```
current_user = postgres   session_user = postgres
```

That is the database **superuser**, not `service_role`. Consequences:

- **RLS does not apply.** Every policy in the database — the set-based predicates of ADR-0006, the
  `private.can_manage_client` gating that ADR-0015 §8 relies on to keep OOO data internal-only — is
  bypassed for this connection.
- **The `service_role`-only grants on the ingestion RPCs protect nothing here.** A superuser executes
  them regardless, so the "invariants live behind `service_role` RPCs" argument holds only as long as
  workflows *choose* to call the RPCs. Nothing stops a Postgres node writing `leads` directly — which
  is exactly what `ooo-detect-and-log` does today.
- The blast radius of a mistaken or malicious workflow edit is the entire database, including
  `DROP`/`TRUNCATE`.

`service_role` would be sufficient for every documented ingestion path: it also bypasses RLS, but it
is not a superuser and its grants are enumerable. Switching the credential is a small change with a
large reduction in blast radius, and it makes `pnpm n8n:validate`'s business rules enforceable at the
database level rather than only by review.

Not fixed here — changing a credential is outside what an agent should do unattended.

### 7. ~~An Aimfox organisation token written literally into three workflow graphs~~ — **resolved 2026-07-22**

Found 2026-07-21 while importing the Aimfox family. The node `Get Workspace Api Key` — present in
`aimfox-classification` (`JnvRBXtRNar7ejeM`), `aimfox-leads-processing` (`4OjNRWLaG2IWK6kd`) and
`aimfox-premql-to-pdca` (`s0GqDtCzyLAvVnm1`) — carries a **literal** `Authorization: Bearer <token>`
value in its parameters and calls `GET /api/v2/workspaces/{id}/tokens`.

That endpoint *mints* per-workspace tokens. The literal is therefore not one client's key: it is the
key that issues keys, for every client's LinkedIn workspace. It is the same value in all three
graphs, so rotating it means editing three workflows.

Unlike finding 1, this **is** caught by `scan.mjs` (`hardcoded-auth-header`), which is why those three
workflows are not in this repository: `pnpm n8n:export` refuses to write them (layer 4). They stay
uncommitted and undiffable until the value moves into an n8n credential.

**Resolved 2026-07-22.** The token now lives in the `Aimfox Master` credential (`httpBearerAuth`);
all three `Get Workspace Api Key` nodes authenticate through it, and all three workflows are
committed. Rotation in Aimfox itself is the owner's call — the old value was exposed for as long as
it sat in workflow JSON.

### 8. ~~An OpenAI API key written literally into `aimfox-classification`~~ — **resolved 2026-07-22**

Same import, same workflow file. Both `OpenAI - Classify Email` and
`OpenAI - Search for the company name` carry a literal `sk-…` in an `Authorization` header, calling
`https://api.openai.com/v1/responses`. Caught by `scan.mjs` (`secret/openai-key`); the workflow is
blocked from import for this reason as well as finding 7.

**Resolved 2026-07-22.** Both nodes now use the `OpenAi account` credential via
`predefinedCredentialType`; the request bodies are unchanged, so the strict `json_schema` structured
output is intact. A leaked OpenAI key stays billable until it is rotated in OpenAI — that step is the
owner's.

### 9. `update_workflow` silently unbinds credentials on HTTP Request nodes — **medium**

Found by causing it, on 2026-07-22. Re-authoring a workflow through the MCP SDK path returns an
`autoAssignedCredentials` list that covers typed nodes (Google Sheets, Postgres, OpenAI) but **skips
`httpRequest` nodes** — its own result note says so. Four nodes in `aimfox-premql-to-pdca` (`Create
Record`, `Get Table ID`, `Lusha Enrichment`, the UniTalk call) lost their credentials and would have
401'd on the next preMQL event.

Repaired within the session by a targeted REST `PUT`, and every credential-declaring node on the
instance was then audited — only the throwaway copies were affected. The rule and the audit are in
[workflow-lifecycle · the SDK authoring contract](workflow-lifecycle.md): **prefer a REST `PUT` for a
targeted node change**; re-author through the SDK only when the graph itself changes, and always pass
credentials explicitly.

### 10. The credential-sync webhook is unauthenticated — **high, open**

Found 2026-07-29 while finishing
[`sheets-credential-sync-on-edit`](../../../automation/n8n/workflows/ops/sheets-credential-sync-on-edit/README.md).

`POST https://n8n.coldunicorn.com/webhook/credential-sync` has no authentication. It is worse than
findings 3's shape: those webhooks drive lead creation and blacklisting, this one **writes
`client_sequencers.api_key`**. Anyone holding the path can point a client's Bison or Aimfox
credential at a key they control, or simply break every Bison call for that client. The path is the
whole secret, and it travels in a Google Apps Script that anyone with edit access to `GHEADS | PDCA`
can read.

Accepted deliberately for now (owner's call, 2026-07-29) rather than overlooked. The fix is two
steps, neither of which an agent can do: an `httpHeaderAuth` credential on the webhook node (the MCP
exposes no credential tools — same constraint as the `Aimfox Master` credential in finding 7), and
the same header added to `PDCA_CONFIG` in the Apps Script.

Two related facts about the same workflow, both from the same session:

- **Its `pinData` held a live Bison API key and a live Aimfox token** (workspace 11 / Runmageddon),
  pinned from a real webhook delivery while the workflow was being built. Removed as part of this
  change; treat both values as exposed for as long as anyone outside the owner had n8n access.
- **Every execution stores raw API keys in n8n's execution data**, because the keys arrive in the
  request body. That is inherent to a sheet-edit trigger and is not fixable in the graph — trim
  execution retention instead.

`pnpm n8n:validate` raises `unauthenticated-webhook` as a warning on the artifact. That warning is
the reminder; do not silence it.

## Reviewing a workflow

- [ ] `pnpm n8n:validate` passes
- [ ] no literal secret in any parameter; auth values are expressions or credentials
- [ ] no `pinData`, no `credentials` block
- [ ] webhook triggers authenticate
- [ ] writes to RPC-owned tables go through the RPC
- [ ] fixtures are synthetic
- [ ] a new `knownViolations` entry has a reason, a tracking link and an expiry
