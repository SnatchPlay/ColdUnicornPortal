# Process · Sheets ↔ Supabase reconciliation (leads and daily stats)

**Domain:** outreach · **Owner:** automation · **Status:** measured **and back-filled** 2026-07-22
**Governing ADR:** [ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) —
a dual-write must declare its phase, its authoritative source and **its reconciliation**. This
document is that reconciliation, for the two stores that were never compared.

> **Level 1 document.** Numbers below were measured against production on 2026-07-22 by a read-only
> probe. They are evidence, not estimates. Re-measure before acting on them.

---

## Why this exists

"Sync stats and leads from the sheets into Supabase" looks like one task. Measuring it first showed
that it is **three different problems with three different answers**, and that the largest one —
the outcome metrics — cannot be solved by syncing anything, because the source is empty too.

## How it was measured

A throwaway workflow `[PROBE] Read sheets shape` read the master workbook's `🤖Daily stats` and
`CS PDCA` tabs and then, one client at a time, each client's own `Leads` tab. **Aggregation happened
inside n8n**: the probe emits counts, date ranges and qualification histograms, never a contact row,
so no personal data left the instance. It is deactivated; delete it once this is acted on.

Two things worth keeping from building it:

- **A dynamic `documentId` on a Google Sheets node does not re-evaluate per item.** The first version
  of the probe read the *first* client's spreadsheet 42 times and reported 42 identical results — all
  5586 rows carried distinct `pairedItem` values, so the output looked plausible. Verified by hashing
  each group's content: 42 groups, **one** distinct signature. Reading N documents needs an explicit
  `splitInBatches` loop. Any workflow that reads per-client spreadsheets in a fan-out is suspect.
- Sheet-derived numbers must be normalised before use — see [data quality](#data-quality-in-the-sheets).

---

## Problem 1 — the outcome metrics have no source at all

`daily_stats` carries five columns that are effectively empty:

| Column | Rows ≠ 0 of 5353 | Last non-zero |
|---|---|---|
| `mql_count` | 75 | 2025-07-30 |
| `me_count` | **0** | never |
| `won_count` | **0** | never |
| `negative_count` | 1 | 2026-03-23 |
| `prospects_in_base` | **0** | never |

The obvious explanation is a missing sheet→Supabase sync. **It is wrong.** The `🤖Daily stats` sheet
is just as empty: across its 6734 rows, `MQL` is non-zero in 98, `ME` in 4, `Negative` in 1, `PB-E`
in 1, and `WON` in **none**. There is nothing to copy.

The real cause is that nothing computes them on either side. The Bison worker
([`Transform Metrics1`](../../../../automation/n8n/workflows/ingestion/bison-daily-stats-process/workflow.json))
derives only volume — sends, replies, bounces, inboxes, schedules — because Bison is the only input
and Bison does not know what an MQL is.

**These are properties of leads, not of a sequencer.** Supabase already holds them per lead
(`qualification`, `meeting_booked`, `meeting_held`, `won`), so the honest fix is to *derive* the daily
counts from `leads` rather than to sync a column that nobody fills. That makes `leads` the single
source for outcomes and removes a sync instead of adding one — but it also means these five columns
stop being ingestion-owned, which is a data-contract change and needs a decision, not a patch.

## Problem 2 — `ooo_count` is a mislabelled copy

```js
const oooCount = Math.max(automatedRepliesTotal - prevOooTotal, 0);
```

The workflow has nine HTTP nodes and **none of them fetches OOO**. `ooo_count` is computed from the
*automated replies* total against the OOO baseline, so it is not OOO data. In production the two
columns are identical on every row inspected — 98/98, 125/125, 783/783, 174/174.

Anything reading `daily_stats.ooo_count` today is reading automated replies. The real OOO count is
already available from `ooo_followups` ([ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md)).

## Problem 3 — coverage gaps, in both stores

### Leads — 192 rows, concentrated

Sheet totals **4979** across 42 client workbooks; Supabase holds **4787**. The difference is not spread
evenly:

| Client | Sheet | Supabase | Missing | Status |
|---|---|---|---|---|
| Kaizen rent | 120 | 31 | **89** | Active |
| Runmageddon | 621 | 593 | 28 | Active |
| BV Grupa | 16 | 0 | 16 | Active |
| Fortum | 15 | 3 | 12 | Active |
| FitMech | 41 | 30 | 11 | Offboarding |
| *others (1–6 each)* | | | ~36 | |

The pattern is onboarding order: a client seeded into `client_sequencers` late has no history behind
it, because nothing ever back-filled. This is the same root cause that hid EvidencePrime from the
Bison ingestion ([bison-ingestion · Incident](bison-ingestion.md#incident-2026-07-22)).

**Two clients have *more* leads in Supabase than in the sheet** — Audytel −4, Antal REX HR −3. Those
are almost certainly rows deleted from the sheet by
[`[child-6] TAG_REMOVED · MQL`](../../n8n/migration-backlog.md), which deletes from the sheet and has
no Supabase counterpart. A backfill must not "repair" these by re-adding them.

### Daily stats — 1583 rows for clients that no longer exist

Of the sheet's 6362 Bison rows, **1583 belong to 30 workspaces with no `client_sequencers` row at
all** — churned clients, mostly ending between 2025-09 and 2026-03. Their history exists only in the
sheet. Whether it is worth importing is a business question: it is dead weight for operations and
real history for year-over-year reporting.

A further ~145 (workspace, date) pairs are missing for *mapped* clients in the 2026-06-01…2026-07-21
window alone, again concentrated in the late-seeded ones.

### The two stores disagree where they overlap

On 981 overlapping (workspace, date) pairs in that window:

| Column | Cells that disagree |
|---|---|
| `Inboxes` | **0** |
| `E-DMS` / `emails_sent` | 36 |
| `Response Count` / `response_count` | 61 |
| `Prospects Count` / `prospects_count` | **368** |

`Inboxes` agreeing perfectly while `Prospects Count` disagrees on 37% of rows points at a
*definitional* difference, not corruption: Supabase stores a month-to-date delta
(`prospectsTotal − prevProspectsTotal`), the sheet stores something else. **Do not reconcile these
two columns until the definitions are written down.** Copying one into the other would destroy the
only signal that they mean different things.

## Data quality in the sheets

Anything reading these tabs must normalise, not trust:

- **`QUALIFICATION` is free text.** Observed values include `MQL`, `preMQL`, `PreMQL`, `Referral`,
  `(blank)`, and — in RevOpsi and Spiree — `1`, `2`, `3`, `@`, `@1`, `@2`, `@3`.
- **`LEAD RECEIVED` dates are inconsistent**, including day/month swaps: `2026-30-06`, `2026-21-07`.
- Two client workbooks are unreachable: `OliveMedia TTS` (`Forbidden`) and `Komandor` (`not found`).

## What was back-filled, 2026-07-22

Two one-off migrations, each dry-run first and each validated against production inside
`begin … rollback` before it wrote anything.

| | Workflow | Result |
|---|---|---|
| Leads | [`sheets-lead-backfill`](../../../../automation/n8n/workflows/ops/sheets-lead-backfill/README.md) | **184 inserted** (30 Aimfox), `leads` 4787 → 4971 |
| Aimfox metrics | [`sheets-aimfox-metrics-backfill`](../../../../automation/n8n/workflows/ops/sheets-aimfox-metrics-backfill/README.md) | **117 client-days**, the first rows `sequencer_daily_stats` has ever held |

Both workflows are deactivated. Both READMEs record what was deliberately *not* invented — 13 leads
with no date, 45 with no campaign, the unmappable churned workspaces, and `invites_accepted` left
NULL rather than zeroed.

The dry-run earned its place: it caught two defects that would have imported silently.
Client workbooks disagree on date locale, so `04/27/2026` was being read as D/M/Y — and while
`2026-27-04` errored loudly, `05/03/2026` would have imported as the wrong month without a sound.
And a `splitInBatches` loop ended at client 15 of 42 while reporting success, because a node that
matched nothing returned nothing; it confidently said "28 leads".

**Neither is a sync, and neither may become one** — see below.

## What this means for a sync

**A permanent sheet→Supabase lead sync should not be built.** Branch S of
[`bison-lead-enrichment`](../../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md)
has written new leads through `promote_contact_to_lead` since 2026-07-22. A second writer would
race it, and would re-create rows the RPC deliberately owns.

What is needed instead is a **one-off backfill** of the 192 historical leads — and that runs straight
into [ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md): a lead is created *by a
positive reply*, through the RPC, at most one per contact. Historical sheet rows have no reply to
attach. Either the backfill synthesises a `sequencer_contacts` + `replies` pair per row, or the ADR
gains an explicit exception for imported history. **That is a decision, not an implementation
detail** — it is why nothing was written.

## Related

[ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) ·
[ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) ·
[bison-ingestion](bison-ingestion.md) ·
[11-integrations](../../functional/11-integrations.md)
