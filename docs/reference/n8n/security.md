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

Found during the 2026-07-21 inventory. None are fixed; all are recorded so they are not rediscovered.

### 1. Per-client Bison API keys live in a Google Sheet — **high**

`ooo-detect-and-log` (and its siblings) read the CS PDCA sheet, take the API key from `col_6`, and
interpolate it into an `Authorization: Bearer` header expression.

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

### 4. OOO state lives in a Google Sheet outside RLS — **medium**

The `OOO Leads` sheet holds contact identifiers and absence dates for every client, in one document,
with no per-client isolation. [ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) §8
deliberately makes this data internal-only and client-scoped via `private.can_manage_client`; the
sheet has no equivalent. Closed by the OOO cutover
([migration-backlog §1](migration-backlog.md#1-ooo-cutover)).

### 5. No workflow writes through `service_role` RPCs yet — **medium**

Every ADR-0015 invariant is `SECURITY DEFINER`, `search_path = ''`, `service_role`-only, and correct.
None of it is reached, because automation still writes a spreadsheet. The security model is sound and
unused; that gap is the migration.

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

## Reviewing a workflow

- [ ] `pnpm n8n:validate` passes
- [ ] no literal secret in any parameter; auth values are expressions or credentials
- [ ] no `pinData`, no `credentials` block
- [ ] webhook triggers authenticate
- [ ] writes to RPC-owned tables go through the RPC
- [ ] fixtures are synthetic
- [ ] a new `knownViolations` entry has a reason, a tracking link and an expiry
