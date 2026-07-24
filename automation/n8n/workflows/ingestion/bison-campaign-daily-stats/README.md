# bison-campaign-daily-stats

**Logical ID:** `bison-campaign-daily-stats` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `AEgpCGoSpiZ7PA90` — `Bison campaign daily stats`
**Business process:** [Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md)
**Phase:** C — Supabase only. Imported 2026-07-22, in the same change that repaired it.

## Business purpose

Every 30 minutes, pull today's per-campaign counters — sent, replied, bounced, unique opens,
interested, active inboxes — and UPSERT them into `campaign_daily_stats`, which the portal reads
over a 90-day window.

## Flow

```
Schedule (30m) ─ Set Report Date ─ Get Active Campaigns (client_sequencers, emailbison)
                 └─ per campaign: GET /campaigns/{id}/line-area-chart-stats
                                  GET /campaigns/{id}/sender-emails?limit=1
                    └─ Transform → UPSERT on (campaign_id, report_date)
```

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | both Bison calls are `onError: continueRegularOutput` | a failed fetch yields **0**, stored indistinguishably from a real zero. A campaign that sent 400 emails can be recorded as having sent none |
| 2 | the day's row is matched by an exact `reportDate` string against the API's `dates` array | a timezone or format change on Bison's side silently produces zeroes rather than an error |
| 3 | no `integration_sync_runs` row | failures are invisible |

Defect 1 is the one that matters: it violates invariant 3 of the process doc — a silent zero is a lie.
Any future change here should record the failure and leave the row alone.

## History

**2026-07-22 — repaired.** `Get Active Campaigns` joined `clients` for `external_api_key`, dropped by
[`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql).
Repointed at `client_sequencers`, result column names preserved. 416 campaigns resolve.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-campaign-daily-stats
```

```sql
select report_date, count(*) from public.campaign_daily_stats
where report_date >= current_date - 7 group by 1 order by 1 desc;
```
