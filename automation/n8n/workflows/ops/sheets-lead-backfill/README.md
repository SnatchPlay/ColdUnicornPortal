# sheets-lead-backfill

**Logical ID:** `sheets-lead-backfill` · **Domain:** `ops` · **Criticality:** medium
**Remote (production):** `KoLN4bU7qe7RwnGT` — `[BACKFILL] Sheets → Supabase · leads`
**Ran:** once, 2026-07-22 (execution 50204). **Deactivated afterwards.**
**Process:** [Sheets ↔ Supabase reconciliation](../../../../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md)

> A one-off migration, kept in the repository because it is the only record of *how* 184 rows got
> into `leads` and of the two bugs that made the first attempt lie.

## What it did

Completed the import of 2026-05-27, which had left 184 client Leads rows behind — mostly clients
seeded into `client_sequencers` after that date, so nothing ever back-filled their history.

| | |
|---|---|
| Sheet rows read | 4979 across 42 client workbooks |
| After in-sheet dedupe | 4881 |
| **Inserted** | **184** |
| **Attributed to Aimfox** | **30** — the first Aimfox leads in the system |
| Result | `leads` 4787 → 4971 |

Biggest gaps: Kaizen rent 87, BV Grupa 16, Runmageddon 17, FitMech 13, Fortum 11.

## Flow

```
Run Manually ─ Read CS PDCA ─ Pick Clients ─ Loop Over Items (batch 1)
                                                 └─ Resolve Client (ws → client_id)
                                                    └─ Read Client Leads
                                                       └─ Build Rows (normalise)
                                                          └─ Backfill Leads (INSERT … NOT EXISTS)
```

## Why it is safe to re-run

Every row is guarded by `NOT EXISTS` against `public.leads`, matched on `(client_id, lower(email))`
— or on `(client_id, company_name, first_name)` when the sheet row has no email. `DISTINCT ON`
collapses duplicates *inside* a sheet before that. A second run inserts nothing.

Undo: all 184 rows share one `updated_at`. Before the run the table's maximum was
`2026-07-21 17:56:50`, so the import is separable by a single predicate.

## Verified before it wrote anything

1. A **dry-run variant** of the same SQL — identical CTEs, `select count(*)` instead of `insert` —
   ran over all 42 clients and predicted `would_insert=184, aimfox=30`.
2. The real `INSERT` was executed against production inside `begin … rollback` on two synthetic
   rows, returning `inserted=2, aimfox=1`, and the table was then queried to confirm nothing leaked.
3. The live run produced **exactly** the dry-run's numbers.

The dry-run was not ceremony. It caught both of the following.

## Two bugs the dry-run caught

**Date locale.** Client workbooks do not agree on date format. `04/27/2026` was being parsed as
D/M/Y, producing `2026-27-04`, which Postgres rejected — 9 clients, ~480 rows. The dangerous half is
what would *not* have errored: `05/03/2026` would have silently imported as 5 March instead of
3 May. The fix detects the order **per tab** — a value above 12 in either position settles it — and
falls back to D/M/Y only when the whole tab is ambiguous.

**The loop ended early.** When `Resolve Client` matched no client, its branch emitted nothing, so
nothing returned to `splitInBatches` and the loop stopped — at client 15 of 42, with the execution
reported as **successful**. It confidently said "28 leads to insert". The real answer was 184. Both
`Resolve Client` and `Build Rows` now carry `alwaysOutputData`.

## What was deliberately not invented

| Case | Count | Decision |
|---|---|---|
| Sheet row with no `LEAD RECEIVED` | 13 | `created_at` = import time, and `coldunicorn_note` says so in words. Findable and fixable, rather than a plausible-looking wrong date. |
| No matching campaign | 45 | `campaign_id` left NULL. 30 are Aimfox — **no Aimfox campaign exists in `campaigns` at all** — and 15 are Bison ids absent from the table. |
| `QUALIFICATION` not MQL/preMQL | — | NULL. The sheet contains `Referral`, `1`, `2`, `@1`, `@3`, `@` and blanks; `lead_qualification` has no honest home for them, and 110 existing rows are already NULL. |
| 30 churned Bison workspaces (1583 `daily_stats` rows) | — | **Not imported.** Their CS PDCA rows are gone, `Client Name` in the sheet is empty, and none of the workbook's 21 tabs maps a workspace id to a client. Attribution would have been guessing. |

## The ADR-0015 tension, stated plainly

`promote_contact_to_lead` creates a lead **from a positive reply**, one per `sequencer_contacts` row.
Historical sheet rows have neither. Satisfying the RPC would have meant fabricating a contact and a
reply per row — inventing evidence in two ingestion-owned tables — which is worse than a direct
insert that is declared, expiring and one-off.

The manifest records this as a `knownViolations` entry expiring **2026-10-31**. The live path is
unaffected: branch S of
[`bison-lead-enrichment`](../../outreach/bison-lead-enrichment/README.md) goes through the RPC.

## Never

Do not schedule this. A recurring sheet→Supabase lead sync would race branch S and re-create rows
the RPC owns.
