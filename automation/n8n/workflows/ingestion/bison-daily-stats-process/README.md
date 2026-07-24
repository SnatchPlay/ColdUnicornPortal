# bison-daily-stats-process

**Logical ID:** `bison-daily-stats-process` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `BQbFKHUaIcEKPc01` — `Daily Stats Process`
**Business process:** [Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md)
**Phase:** C — Supabase only. Imported 2026-07-22.

## Business purpose

The per-client worker behind
[`bison-daily-stats-population`](../bison-daily-stats-population/README.md): nine Bison calls, one
row in `daily_stats`.

## Flow

```
Start (called per client) ─┬─ workspace line-area-chart-stats   (sent / replied / bounced / opens)
                           ├─ workspace stats                   (bounce detail)
                           ├─ sender-emails                     (inboxes)
                           ├─ leads?created_at >= firstDayOfMonth
                           ├─ replies (human) + replies (automated)
                           ├─ sending-schedules today / tomorrow / day after
                           └─ Get Yesterday Totals (daily_stats)
                              └─ Transform → UPSERT on (client_id, report_date)
```

## The dependency that makes gaps expensive

It reads **yesterday's `daily_stats` row** to derive month-to-date deltas. A missing day therefore
does not stay a hole — it feeds the next day's numbers (process invariant 2). Backfill gaps oldest
first.

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | none of the nine Bison calls retries | a partial fetch produces a row with zeroes in the missing fields, stored as fact |
| 2 | no `integration_sync_runs` row | a bad row is indistinguishable from a good one after the fact |
| 3 | the API key still arrives as a field named `external_api_key` | harmless, but it is the last echo of the pre-ADR-0012 shape; kept deliberately so the repair changed one node and nothing else |

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-daily-stats-process
```

Do **not** `execute_workflow` against this directly without an input — it expects a client item from
its parent.
