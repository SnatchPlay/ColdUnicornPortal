# sheets-aimfox-metrics-backfill

**Logical ID:** `sheets-aimfox-metrics-backfill` · **Domain:** `ops` · **Criticality:** medium
**Remote (production):** `YLfQZBprSRIT6hLm` — `[BACKFILL] Sheets → Supabase · Aimfox daily metrics`
**Ran:** once, 2026-07-22 (execution 50205). **Deactivated afterwards.**
**Process:** [Sheets ↔ Supabase reconciliation](../../../../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md)

## What it did

Wrote the **first rows `sequencer_daily_stats` has ever held**. The table was created by
[ADR-0012](../../../../../docs/adr/0012-multi-sequencer-model.md) for Aimfox LinkedIn PDCA metrics
and had stood empty since — a fact [11-integrations](../../../../../docs/reference/functional/11-integrations.md)
had wrongly described as a live write until it was corrected on 2026-07-21.

| | |
|---|---|
| Candidate client-days in the sheet | 118 |
| **Written** | **117** over 5 clients, 2026-06-18…2026-07-22 |
| Invitations recorded | 1617 |
| `invites_accepted` | **NULL on every row** — see below |

Dropped: **UniTalk** (Bison workspace 36, one row) has no `aimfox` row in `client_sequencers`, so the
join excludes it rather than inventing an attribution. That is the whole 118 → 117 difference.

## Where the Aimfox numbers actually live

Not in rows of their own. `Get Metrics from Aimfox` writes them into the **existing Bison-sequencer
row** for that client and day, as four extra columns: `Invitations sent` and three
`Schedule volume … (Aimfox)` columns. The `🤖Daily stats` sheet contains **no row with
`Sequencer = 'Aimfox'`** at all.

So the mapping is indirect, and the workflow does it in SQL:

```
sheet 'Client' (bison workspace id) → client_sequencers[emailbison] → client_id
                                    → client_sequencers[aimfox]     → sequencer_id
```

## Two schema decisions, both deliberate

**`invites_accepted` is NULL, not 0.** The sheet carries invitations *sent* and schedule volume; it
does not carry acceptances. Writing `0` would store an unmeasured value indistinguishably from a real
zero — precisely the defect recorded as invariant 3 of
[bison-ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md#business-invariants)
("a silent zero is a lie"). Migration
[`20260722h`](../../../../../supabase/migrations/20260722h_sequencer_daily_stats_unmeasured.sql)
drops the `NOT NULL` so the honest value can be stored, and the column comment says what NULL means.

The `ON CONFLICT DO UPDATE` clause **omits `invites_accepted`**, so re-running this backfill can never
overwrite a real acceptance figure with NULL.

**`profile_id = '__workspace_total__'`.** The table's grain is *profile*-day; the sheet's is
*workspace*-day. Rather than fabricate a profile id, the aggregate rows carry an explicit sentinel,
documented in the column comment.

> **Any future per-profile Aimfox ingestion MUST exclude `'__workspace_total__'`** or it will
> double-count every one of these days.

## Verification

```sql
select c.name, count(*) days, min(d.report_date), max(d.report_date),
       sum(d.invites_sent) invites, count(d.invites_accepted) accepted_measured
from public.sequencer_daily_stats d
join public.clients c on c.id = d.client_id
group by 1 order by 2 desc;
-- 5 clients, 117 rows, accepted_measured = 0 everywhere
```

The SQL was executed against production inside `begin … rollback` first, on a two-row payload
covering both the mapped and the unmappable case: `mapped_rows=1, written=1` of 2 candidates.

## Never

Do not schedule this. It is a historical import; ongoing Aimfox metrics belong to
[`aimfox-daily-metrics`](../../ingestion/aimfox-daily-metrics/README.md), which is still phase 0 and
writes only to the sheet.
