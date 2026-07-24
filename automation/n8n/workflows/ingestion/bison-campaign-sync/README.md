# bison-campaign-sync

**Logical ID:** `bison-campaign-sync` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `UXpSOrgsN2TxjXUu` — `Bison campaign sync`
**Business process:** [Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md)
**Phase:** C — Supabase only. Imported 2026-07-22, in the same change that repaired it.

## Business purpose

Hourly, mirror every client's Bison campaigns into `campaigns` — the table most of the portal joins
against.

## Flow

```
Schedule (hourly) ─ Get Active Clients (client_sequencers, emailbison)
                    └─ per client: GET /campaigns (paginated)
                       └─ Transform → one INSERT … ON CONFLICT (external_id) DO UPDATE
```

## The rule that must not be "fixed"

`ON CONFLICT DO UPDATE` sets `name`, `status`, `database_size`, `positive_responses` — and
deliberately **not `type`**. Campaign classification is ours, not Bison's: adding `type` to the
UPDATE would overwrite the 52 campaigns
[`20260722g`](../../../../../supabase/migrations/20260722g_ooo_campaigns_and_routing_seed.sql)
reclassified as `ooo_followup`, putting OOO follow-up campaigns back into client-visible metrics
([ADR-0003](../../../../../docs/adr/0003-client-campaign-visibility.md)).

Verified on the 2026-07-22 run: 390 campaigns upserted, all 52 classifications intact.

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the upsert SQL is **built by string concatenation** in a Code node | escaping is one hand-rolled `replace(/'/g, "''")`; a parameterised query would remove the class of risk entirely |
| 2 | the Bison fetch continues on error | one client's failure is skipped silently; nothing records which |
| 3 | no `integration_sync_runs` row | this workflow failed **every run for days** and nothing noticed — see the incident in the process doc |

## History

**2026-07-22 — repaired.** `Get Active Clients` still selected `clients.external_api_key`, a column
[`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql)
had dropped, so all 12 of the last 12 runs failed. Repointed at `client_sequencers` with the result
column names preserved, so nothing downstream changed. Verified by execution: 16 clients, 390
campaigns.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-campaign-sync
```

```sql
select count(*), max(updated_at) from public.campaigns;
```
