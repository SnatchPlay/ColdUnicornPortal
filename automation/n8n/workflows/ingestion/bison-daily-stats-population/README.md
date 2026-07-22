# bison-daily-stats-population

**Logical ID:** `bison-daily-stats-population` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `amJdB2eGXxUNyCPY` — `Bison daily stats population`
**Business process:** [Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md)
**Phase:** C — Supabase only. Imported 2026-07-22, in the same change that repaired it.

## Business purpose

Hourly fan-out: resolve every active client and call
[`bison-daily-stats-process`](../bison-daily-stats-process/README.md) once per client. It writes
nothing itself.

## Flow

```
Schedule (hourly) ┐
Backfill Webhook  ┴─ Set Report Date ─ Get Active Clients (client_sequencers, emailbison)
                                       └─ Split in Batches ─ Call Daily Stats Process (loop)
```

The webhook accepts `{"targetDate": "YYYY-MM-DD"}` and is the sanctioned way to backfill a missing
day — which matters, because a gap propagates forward (process invariant 2).

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the backfill webhook has **no authentication**, and returns 404 from outside | both at once: it cannot be used for its purpose, and if it becomes reachable anyone can drive it |
| 2 | a client whose sub-workflow call fails is skipped | no record of which client, or that anything was skipped |
| 3 | an active client with no `client_sequencers` row silently produces nothing | **EvidencePrime** is in exactly this state — 17 clients became 16 after the repair |

## History

**2026-07-22 — repaired.** `Get Active Clients1` selected `clients.external_workspace_id` and
`clients.external_api_key`, both dropped by
[`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql), so
**all 12 of the last 12 runs failed** and `daily_stats` had been stale since 2026-07-20. Repointed at
`client_sequencers`; verified by execution, 16 clients written for 2026-07-22.

2026-07-21 remains a hole — see the process doc.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-daily-stats-population
```

```sql
select report_date, count(*) from public.daily_stats
where report_date >= current_date - 7 group by 1 order by 1 desc;
```
