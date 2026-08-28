# ADR 0019: Client CRM connections live in our Postgres

## Status
Accepted 2026-08-28. **Partially supersedes [ADR-0010](0010-legacy-crm-integration.md)** — specifically
its invariant "the portal **never** receives access tokens … tokens and secrets never reach our
project". Tokens now reach our project; they still never reach a browser.

## Context

A positive reply is supposed to land in the client's own CRM. The path that does it —
`[HUB] CRMs Add/Update Lead Dispatcher` plus five per-provider children — resolved each client's CRM
by reading **two** stores and stitching them together in an 80-line Code node:

- **Google Sheet `17cdj8ex…`** (the "CS PDCA" book), tab `Client CRM Details` — `CRM Platform`,
  `API Key`, `API Secret`, `Subdomain`, `Salt`, `Login URL`. Eight rows.
- **n8n Data Table `OAuth2 Tokens`** (`gV9hy9WDXZf3PMaa`) — `access_token`, `refresh_token`,
  `client_id`, `client_secret`, `domain`, keyed by `workspace_id`. Two rows.

Credentials arrive from the client-facing card on `/client/settings`, which posts them to the legacy
CRM Supabase project (ADR-0010); that project stores them and forwards them to a **Make.com** webhook
(verified 2026-08-28: all five `crm_providers.webhook_url` values point at `hook.eu2.make.com`).

Four things were wrong with this, and they compound:

1. **The runtime store is a spreadsheet.** Every client's live CRM API key sits in plain text in a
   book the whole team can open. Access to the sheet is access to the clients' CRMs.
2. **Identity is split from every other per-client credential.** `client_sequencers` has held
   per-client vendor keys since [ADR-0012](0012-multi-sequencer-model.md), keyed by
   `external_workspace_id` — the *same* workspace id the dispatcher looks up. All nine workspace ids
   in the sheet and the Data Table resolve against it, so the join already existed and was unused.
3. **A missing row is silent.** The Sheets lookup runs first, and a workspace with no sheet row
   produces zero items, so the branch ends before the Data Table is read. TouchlessFreaks
   (workspace 77) has a complete Salesforce OAuth set from 2026-05-22 and no sheet row: its
   integration has never fired and nothing anywhere said so. `Route by CRM type` has no fallback
   output either, so an unknown provider disappears the same way.
4. **`clients.crm_config` was never the status mirror it was documented as.** In 46 of 63 rows it
   held PDCA/Sheets bookkeeping (`spreadsheet_id`, `report_link`, `growth_head`, …). The badge that
   read it therefore never rendered, and the card that wrote it did a whole-object replace — so the
   first successful CRM connection would have destroyed that client's spreadsheet metadata.

ADR-0010's "tokens never reach our project" was a **cost decision**, not a security principle: it was
cheaper to call across projects than to migrate Salesforce callback URLs and redo a security review.
The cost of honouring it turned out to be a spreadsheet full of live API keys.

## Decision

### 1. One table, in our Postgres

`public.client_crm_connections` — one row per `(client_id, provider)`, carrying `auth_mode`,
`credentials jsonb`, `status`, `enabled`, `connected_at`, `last_error`. It replaces the sheet tab and
the Data Table. Clients are reached through `client_sequencers.external_workspace_id`, the identity
that already exists.

### 2. RLS enabled with no policies, **and the grants revoked**

`service_role` (n8n) bypasses RLS. `authenticated` and `anon` hold no privilege on the table at all.

Both halves are needed, and the second was not obvious. Supabase's default privileges in `public`
hand `anon` and `authenticated` the full `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` set on every new
table — and **`TRUNCATE` is a privilege check that RLS does not filter**. A table with RLS on and no
policies is still truncatable with the anon key. Measured on a local restore of the production schema
on 2026-08-28, then fixed with an explicit
`revoke all … from public, anon, authenticated` plus a grant to `service_role` only.

This deliberately differs from `client_sequencers`, which uses `private.can_manage_client` and whose
`api_key` the gateway ships to a manager's browser. That was an acceptable trade for the agency's own
vendor keys. A client's CRM credentials are the client's, and no portal screen needs them. **A status
badge, if one is ever wanted, gets a view that omits `credentials` — never a policy on this table.**

### 3. The portal does not write CRM state

The card on `/client/settings` stays the connect UI and keeps forwarding credentials to the legacy
project. It no longer mirrors anything into our database, and `clients.crm_config` is dropped.

Credentials enter Postgres **only** through the connect webhook: the legacy project posts to an n8n
workflow, which resolves the client and calls `upsert_client_crm_connection`. Make.com leaves the
CRM path.

### 4. Reads and writes go through RPCs, not raw table access

| Function | Caller | Guarantee it holds |
|---|---|---|
| `resolve_crm_connection(sequencer_key, workspace_id)` | dispatcher | Returns the `crm` payload key-for-key as the Code node built it. `NULL` for unknown workspace, no connection, or `enabled = false`. |
| `upsert_client_crm_connection(...)` | connect webhook | Idempotent per `(client_id, provider)`. Credentials **merge** and blanks are dropped, so a partial payload never erases a stored secret. `p_enabled = NULL` keeps the current value, so a parked connection cannot silently revive. |
| `resolve_client_for_crm_intake(client_name)` | connect webhook | Raises on 0 or >1 match. The webhook carries only a client **name**, and `SalesBook` and `Testing` each match two non-archived clients (2026-08-28), so an ambiguous name is never resolved by guessing. |
| `store_crm_oauth_tokens(...)` | Zoho/Salesforce children | Lets a child persist a refreshed token instead of re-exchanging the refresh_token on every run. |

### 5. NULL is an outcome, not a fall-through

A dispatcher that resolves nothing must record `no_connection` / `disabled` / `unknown_provider` and
say so. `Route by CRM type` gains a fallback output. Defect 3 above is not fixed by moving the data —
only by making the miss visible.

## Consequences

**What this costs.** Our project now holds third-party OAuth refresh tokens and API keys. That raises
the value of the database and of the `service_role` key, and it makes this table the thing to audit
first. It is mitigated by the no-policy RLS, by the RPC-only access, and by the fact that the
alternative was a Google Sheet.

**What it does not change.** The legacy CRM project still owns the provider catalog and the OAuth
consent flows (ADR-0010's read path stands). No secret reaches a browser. The portal still never
calls a CRM — n8n owns that boundary.

**Migration.** Per [ADR-0017](0017-sheets-to-supabase-dual-write-transition.md) this is a *credential*
move, which the migration backlog carves out of the Sheets transition as something that moves sooner
and independently — the same treatment `sheets-credential-sync-on-edit` got for Bison/Aimfox keys.
Cutover is verified by a field-by-field diff of `resolve_crm_connection` against the current
Sheets+DataTable output across all nine workspace ids, not by waiting for traffic: the dispatcher only
fires on a positive reply, so a dual-read window would take months to prove anything. The Sheets
branch stays as a fallback for one release, then goes; only then are the sheet secrets erased and the
keys rotated.

**Open.** New OAuth connections still need the legacy project's consent flow. Retiring that project
entirely is a separate decision.
