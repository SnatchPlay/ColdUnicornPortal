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
| 6 | the four count endpoints depend on `meta.total`, which Bison serves **only when `page` is passed explicitly** | see the pagination contract below — it cost every client a day of stats on 2026-08-26 |
| 7 | `ooo_count` is `NOT NULL` while every sibling counter (`human_replies_count`, `automated_replies_*`, `prospects_*`, `inboxes_count`, `ooo_count_total`) is nullable | a partial Bison fetch does not degrade the row, it **kills the whole upsert** — defect 1's "row with zeroes" is optimistic, the real outcome is no row at all |

### The pagination contract (learned the hard way, 2026-08-26)

Bison serves two pagination modes on the same endpoints, and **the default changed under us** at
roughly `2026-08-25T21:00Z`:

| Request | `meta` |
|---|---|
| `/replies?status=automated_reply&folder=inbox` | `per_page`, `next_cursor`, `prev_cursor` — **no `total`** |
| `/replies?status=automated_reply&folder=inbox&page=1` | `current_page`, `last_page`, `to`, **`total`** |

Cursor pagination became the default; length-aware pagination survives behind an explicit `page`
parameter. `per_page` is ignored in both modes (always 15), so `page=1` costs nothing extra.

`Transform Metrics1` reads `meta.total` on four nodes — `HTTP Automated Replies1`,
`HTTP Human Replies1`, `HTTP Leads1`, `HTTP Sender Emails1`. All four kept returning HTTP 200 and
`executionStatus: success`; only the field vanished. Six counters went `null`, and because
`ooo_count` is the one `NOT NULL` column among them (defect 7), Postgres rejected the whole INSERT:

```
null value in column "ooo_count" of relation "daily_stats" violates not-null constraint
```

**102 failed runs** (17 clients × 6 schedules), zero rows for `2026-08-26` until the fix. The four
URLs now carry `&page=1`; measured against UniTalk, the restored totals match the last good row
byte-for-byte (3820 / 2401 / 4891 / 125).

**Treat `page=1` as a reprieve, not a contract.** Bison chose cursor as its default; the compatibility
parameter can disappear next. The durable answer is defect 4 — stop deriving per-day counters from
undated lifetime totals.

Not affected, and verified so: `workspaces/v1.1/line-area-chart-stats` and `workspaces/v1.1/stats`
are not paginated; `campaigns/sending-schedules` is still length-aware by default; `/campaigns` went
to cursor but `bison-campaign-sync` walks `links.next`, which cursor mode still provides (47 Bison
campaigns, 47 rows refreshed).

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
