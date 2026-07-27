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
| 4 | `human_replies_count` / `ooo_count` are deltas of an **undated** lifetime total (`replies?…&folder=inbox`), while `emails_sent` / `response_count` are true per-day values | one row mixes two time semantics. `human + ooo` routinely exceeds `response_count`; the total is non-monotonic (archiving a reply lowers it) and the `max(…,0)` clamp discards the drop without resetting the baseline |
| 5 | `ooo_count` is not OOO — it is the automated-replies delta, byte-identical to `automated_replies_count` | see the accepted deviation below |

### Accepted deviation — `ooo_count` (decided 2026-07-27, review by 2026-10-31)

`ooo_count` holds automated replies, not OOO, in **both** stores: the CS PDCA sheet's column `X` is
mislabelled the same way ([PDCA FORMULAS §2](../../../../sheets/pdca/FORMULAS.md#2-daily-stats-column-map)),
and n8n reproduced it faithfully. Measured on UniTalk, week of 2026-07-20: `ooo_count` = 183 against
63 real episodes in `ooo_followups` — ~3× overstated.

**Kept as-is on purpose.** The portal's WoW OOO and Total-response rates are read side by side with
CS PDCA every day; correcting only our side would make the two disagree on a metric the team
compares by eye, while the sheet stayed wrong. Wrong-but-identical beats wrong-and-divergent while
the sheet is still the operational surface. Until then `ooo_count` means *automated replies* — do
not build a new metric on it, and read real OOO from `ooo_followups`
([ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)).

**Exit plan (decided 2026-07-27): correct it on a branch, switch when the team moves onto the
portal.** What that branch can and cannot recover was measured, not assumed:

| | Recoverable? | How |
|---|---|---|
| per-day `human_replies` / `automated_replies` | **yes, ~10 months back** | `GET /api/replies` is paginated and each item carries `date_received` + `automated_reply`. The *date filter* is what does not exist (`filters[created_at]`, `filters[received_at]`, `start_date` are all silently ignored — `>= 2099-01-01` still returns the full set), so the fix is to page newest-first until the cutoff and bucket client-side. `per_page` is ignored too: 15 per page, ~60 pages per client for a 30-day window. Inbox reaches back to 2025-09-22. |
| true OOO | **no — only from 2026-07-15** | OOO is a *classification*, and Bison's `automated_reply` flag is not it. Classification is produced by our own n8n and lands in `public.replies`, which starts 2026-07-15. Re-classifying older bodies through the LLM is possible and deliberately rejected: tens of thousands of calls to reconstruct a metric nobody read. |

Validate any reconstruction against `line-area-chart-stats` `Replied`, which *is* a true per-day
figure — that also measures the one real risk, `folder=inbox` meaning "what is in the inbox now", so
replies archived since will be missing from older days.

Note for that branch: `public.replies.is_automated_reply` is `false` on all 429 rows while 301 of
them are classified `OOO`. The column is unpopulated, not merely wrong — key any derivation on
`classification`, never on that flag.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-daily-stats-process
```

Do **not** `execute_workflow` against this directly without an input — it expects a client item from
its parent.
