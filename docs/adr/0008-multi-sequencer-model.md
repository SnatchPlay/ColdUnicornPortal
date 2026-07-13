# ADR 0008: Multi-Sequencer Model (Catalog + Per-Client Credentials)

## Status
Accepted 2026-07-04

## Context

The agency runs outbound through several external sending tools ("sequencers"): Smartlead and EmailBison for cold email, and Aimfox for LinkedIn invitations (replacing the never-shipped look4lead concept from the archived spec). The live schema had no sequencer model — the linkage was implicit and single-tool:

- `campaigns.external_id` — an opaque "Smartlead/Bison ID" string, no record of which tool it belongs to.
- `clients.external_workspace_id` / `clients.external_api_key` — EmailBison-shaped credentials as bare columns.
- `clients.linkedin_api_key` — a dangling field for a LinkedIn tool that was never wired (backlog BL-3).
- `leads.source` — a free `varchar(30)` channel label (`'cold_email'` default), not a tool reference.

Upcoming Aimfox PDCA statistics (remaining database size, invitation limit ≈195, invites sent/accepted per week/month, acceptance rates, 3DoD/WoW/MoM lead metrics per LinkedIn profile) require first-class attribution of campaigns, leads, and daily stats to a specific sequencer, and per-client credentials for more than one tool at a time.

## Decision

Migration `20260704_sequencers_catalog.sql` (additive) + `20260704b_drop_client_sequencer_credentials.sql` (destructive, applied after code deploy + n8n cutover):

1. **`sequencers`** — global catalog (`key`, `name`, `channel in ('email','linkedin')`, `enabled`). Seeded with **fixed literal UUIDs** that are load-bearing (they are the column DEFAULTs below and the constants n8n uses; never change them):
   - smartlead `00000000-0000-4000-a000-000000000001`
   - emailbison `00000000-0000-4000-a000-000000000002`
   - aimfox `00000000-0000-4000-a000-000000000003`
   `key` is `text + unique + check`, not an enum — adding a fourth sequencer is an INSERT, not an `ALTER TYPE`.
2. **`client_sequencers`** — per-client connection settings: `api_key`, `external_workspace_id` (**text**, platform-agnostic), `settings jsonb`, `enabled`, `UNIQUE(client_id, sequencer_id)`. Replaces the three `clients` columns, which are dropped by the companion migration. Portal-owned config; n8n reads it (config-vs-execution boundary, OoS-12).
3. **`campaigns.sequencer_id` / `leads.sequencer_id`** — `uuid NOT NULL DEFAULT <emailbison> REFERENCES sequencers ON DELETE RESTRICT`. The default both backfills all existing rows (per 2026-07-04 decision: everything historical is EmailBison) and keeps unmodified n8n email inserts working. Aimfox/LinkedIn flows **must** set `sequencer_id` explicitly.
4. **`sequencer_daily_stats`** — ingestion-only daily stats: `UNIQUE(client_id, sequencer_id, profile_id, report_date)`, counters `invites_sent`, `invites_accepted`; snapshots `remaining_database_size`, `invite_limit` (weekly cap = Σ accounts' `limit.connect`), `invite_limit_remaining` (left today), and `schedule_today/tomorrow/day_after` planned volumes (added by `20260705_sequencer_daily_stats_schedule.sql` after analyzing the real "Get Metrics from Aimfox" n8n workflow). `profile_id` is the Aimfox LinkedIn profile/seat id; `''` (empty string, not NULL) means account-level rollup so the unique key stays honest. Grain is `client_id + sequencer_id` directly (not a `client_sequencers` FK) so RLS stays set-based on `client_id` and stats survive a connection row being deleted/recreated.

### Ownership and mutation boundaries

- `sequencers`: SELECT for all authenticated; writes master_admin only.
- `client_sequencers`: SELECT/INSERT/UPDATE/DELETE gated `private.can_manage_client` — **never visible to the client role** (API keys). Portal edits via `upsertClientSequencer` gateway action.
- `sequencer_daily_stats`: no write policies (n8n service role bypasses RLS); SELECT set-based per ADR-0006; clients see their own rows (no secrets, PDCA stats are client-facing).
- `campaigns.sequencer_id`: settable at creation via `mapCampaignInsert`; **not** in `mapCampaignPatch` (immutable via portal after creation; n8n service role can rewrite).
- `leads.sequencer_id`: **not** in `mapLeadPatch` (ADR-0004) — the lead↔sequencer link is n8n/ingestion-owned.

### `leads.source` ≠ `sequencer_id`

`leads.source` stays what it is: free-text channel provenance (`'cold_email'`, gateway fallback `"smartlead"`). It is orthogonal to `sequencer_id` and intentionally untouched; do not "unify" them.

## Consequences

- The portal can filter/aggregate campaigns, leads, and daily stats per sequencer — the foundation for Aimfox PDCA metrics and the phase-2 sequencer management UI.
- n8n must switch credential reads from `clients.*` to `client_sequencers` (join `sequencers` on `key`) before the destructive migration is applied; `external_workspace_id` is now text.
- The condition-rules context keeps the `auto_li_api_key` metric path working, populated from the aimfox `client_sequencers` row's key presence instead of `clients.linkedin_api_key` (live rule `auto_li_api_key_present` depends on it).
- `supabase/drizzle/schema.ts` was hand-edited (clients columns removed, `campaigns.sequencerId` added); the new tables are accessed via the gateway's raw-select pattern and deliberately not added to the drizzle schema. A full `db:introspect` refresh is a scheduled follow-up.
- Portal still never calls sequencer APIs (Smartlead/Bison/Aimfox) — config in portal, execution in n8n (13-out-of-scope OoS-12).
