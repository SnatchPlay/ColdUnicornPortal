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
| 4 | `inboxes_active` reads `meta.total` from `campaigns/{id}/sender-emails`, which Bison serves only when `page` is passed explicitly | defect 1 turned this into a silent estate-wide zero on 2026-08-25 — see below |

### 2026-08-25 — defect 1 firing for real, and the hole it left

Bison made cursor pagination the default at ~`2026-08-25T21:00Z`, so `meta.total` disappeared from
`campaigns/{id}/sender-emails` (full contract:
[bison-daily-stats-process](../bison-daily-stats-process/README.md#the-pagination-contract-learned-the-hard-way-2026-08-26)).
The 21:30 run reported **success** and wrote `inboxes_active = 0` on **501 rows of 501** — the
baseline is ~198 genuine zeros. Nothing alerted, because nothing failed.

`HTTP Campaign Inboxes` now sends `&page=1` (verified: `total: 75` on campaign 1068).

**The 2026-08-25 rows are not repairable.** This workflow has no backfill input — `Set Report Date`
always uses today (UTC) — and `sender-emails` reports current state, not history, so nobody can know
what that day's count was. Carrying 2026-08-24 forward would be invented data. The day stays zero and
is a visible dip in `admin_dashboard_daily` until it rolls out of the view's 21-day window
(~2026-09-15).

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
