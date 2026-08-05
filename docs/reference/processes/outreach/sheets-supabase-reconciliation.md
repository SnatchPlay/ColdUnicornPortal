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

## Per-cell reconciliation, 2026-07-27

The measurement above compared *counts of disagreeing cells*. The sheet's formulas and its raw
`🤖Daily stats` rows are now tracked — [`automation/sheets/`](../../../../automation/sheets/README.md) —
so the comparison is reproducible per (workspace, date, field):

```bash
pnpm sheets:extract "~/Downloads/GHEADS _ PDCA.xlsx" --snapshot 2026-07-27
pnpm sheets:compare --client UniTalk --from 2026-07-01 --to 2026-07-27
```

UniTalk, 27 overlapping days in July — **47 disagreements, and they sort by column semantics, not
by client**:

| Field | Days disagreeing | Kind of column |
|---|---|---|
| `emails_sent` | 1 / 27 | true per-day value |
| `response_count` | 3 / 27 | true per-day value |
| `prospects_total` | 1 / 27 | month-to-date cumulative |
| `human_replies_total` | 8 / 27 | **undated lifetime snapshot** |
| `automated_replies_total` | 9 / 27 | **undated lifetime snapshot** |
| `human_replies_count` | 12 / 27 | delta of a lifetime snapshot |
| `ooo_count` | 13 / 27 | delta of a lifetime snapshot |

**The per-day columns agree; the snapshot columns don't.** That is the finding. The two pollers hit
the same undated `replies?…&folder=inbox` endpoint at different moments, so they see different
lifetime totals and manufacture different "day" counts from them. On 2026-07-20 the sheet read
`2150 / 3322` and Supabase read `2171 / 3381`; on 07-21 Supabase read `2155` — **lower than the day
before**, because the endpoint counts an inbox, and an inbox shrinks when replies are archived. The
`max(delta, 0)` clamp in both writers discards the drop without resetting the baseline.

That one skew is the entire visible discrepancy. Reconstructing WoW week `-1` (20–26.07) from each
store, denominators identical at 3457 sends:

| | human | OOO | Human RR | Total resp |
|---|---|---|---|---|
| Sheet → CS PDCA | 60 | 114 | 1.7% | 5.0% |
| Supabase → portal | 92 | 183 | 2.7% | 8.0% |

Both reproduce their own UI exactly, and weeks `-2`/`-3` agree between the stores. **Neither number
is trustworthy** — they are two samples of a counter that was never a daily metric. Fixing this
means giving `human_replies_count` and `ooo_count` a real date filter, not reconciling the two
stores against each other.

## Per-lead reconciliation, 2026-08-03 — Bent Iron PL

The first row-by-row diff of a client's `Leads` tab against `leads`: 194 sheet rows, January–August
2026. Six rows disagree, and each disagreement has a named cause — none of them is the portal, which
reproduces `leads` exactly, per-sequencer split included.

| Kind | Rows | What it is |
|---|---|---|
| Duplicate in Supabase | 1 | ZPOW Dwikozy S.A. / Paweł Styczeń, 09.07 — the 2026-07-22 import re-inserted a lead the live Aimfox flow had already written. The `NOT EXISTS` guard matches on `(client_id, company_name, first_name)` when the sheet row has no email, and the live row's identity fields were still different at import time (it was edited on 29.07). Both rows are `MQL`, so July gained +1 Total and +1 SQL |
| Missing from Supabase | 1 | Mieszko S.A. / Juozas Daunys, 31.03, `MQL` — in the sheet, no `leads` row at all |
| `MQL` here, `preMQL` in the sheet | 4 | Coro-Tech (10.03), MARCOR (18.04), Zaklad Drobiarski w Stasinie (07.06), VisGrana (01.07). All four share one `updated_at` — `2026-07-23 19:16:07.155615` — and they are the only rows of this client that write touched, out of ~200. No migration in this repository writes `qualification` outside `promote_contact_to_lead`, so what produced it is not recorded anywhere |
| Date drift | 7 | Aimfox leads, 1–7 days late — the branch-S/branch-L split described below |

Reproduce the first three with a `Leads`-tab export and the `leads` table; the last one with
`pnpm sheets:backfill-aimfox-dates` (dry-run by default).

### Aimfox lead dates — one fact, two sources

`aimfox-premql-to-pdca` dated the sheet row from the prospect's own conversation message and dated
the Supabase reply from `body.event.timestamp` — when Aimfox delivered the webhook, i.e. when the
label was applied. `leads.created_at` is cut from `replies.received_at`, so the drift reached every
DoD / WoW / MoM bucket. Label events arrive in batches, which is why the wrong value is visibly
synthetic: five different contacts share `received_at = 2026-07-28 08:01`, three share `07-28 07:54`.

Scope, measured 2026-08-03: **52 Aimfox leads carry a reply, 26 of them sit in such a batch minute**,
across four clients — Kaizen rent (22 leads / 15 batched), Runmageddon (17 / 9), Bent Iron PL (12 / 2),
ColdUnicorn PL (1 / 0). Bison leads are not affected: `bison-lead-enrichment` puts
`last_reply.date_received` into both stores.

The workflow now takes the message date on both branches (deployed 2026-08-03). History is repaired
from the sheet — the decision was to converge on what the workbooks already hold rather than
re-derive dates from Aimfox. Two tools do the same job at different scales, with the same rules:
`leads.created_at` and `replies.received_at` move together, and a lead that cannot be matched to a
sheet row, or whose sheet row has no readable date, is reported and skipped rather than guessed.

| | Reads | Use when |
|---|---|---|
| [`sheets-lead-date-backfill`](../../../../automation/n8n/workflows/ops/sheets-lead-date-backfill/README.md) (n8n) | all 42 client workbooks over Google, via CS PDCA `col_4` | the real run — n8n holds the Sheets credentials |
| [`pnpm sheets:backfill-aimfox-dates`](../../../../scripts/sheets/backfill-aimfox-lead-dates.mjs) | workbook exports on disk | one client, or a check without n8n |

Both are dry-run by default and convergent: a second pass over unchanged data moves nothing.

**Applied 2026-08-03** (execution 61622): 18 leads and their replies re-dated across Bent Iron PL,
Runmageddon and Kaizen rent. After the write, 0 of 52 Aimfox leads disagree with their originating
reply. MoM buckets did not move — every correction stayed inside its month; WoW did, which was the
point. Four dry runs preceded it and two of them caught false positives that would otherwise have
been written: an undecidable two-row tab (EvidencePrime) and a tab where ISO rows outvoted slash
rows on the date format (TouchlessFreaks v2, 28 proposed day↔month swaps).

That second flaw still exists in [`sheets-lead-backfill`](../../../../automation/n8n/workflows/ops/sheets-lead-backfill/README.md)'s
`Build Rows`, which used the same detector on 2026-07-22. Any workbook mixing ISO and slash dates
may have been imported with day and month swapped — unchecked, and worth a pass of its own.

## Agency-wide per-lead reconciliation, 2026-08-05

The first sweep across **all 42 clients** in CS PDCA, not a sample. Read by a read-only n8n probe
that walks each client's own `Leads` tab and diffs it against `leads` using the windows
`orm-gateway`'s `loadClientsPage` uses, so the Supabase side of every bucket is the number the
portal renders. Every bucket delta reconciled to named rows — residual **0**.

Coverage is the first finding, and it is not full: **33 clients compared, 9 unread.**

`oLIVEmedia TTS` returns **Forbidden** and `Komandor` **not found** — both already recorded above on
2026-07-22 and still unfixed. Seven more tabs return no rows. For those nine, drift is *unmeasured*,
not zero.

#### Read the tab by position, never by header — corrected 2026-08-05

The first sweep excluded RevOpsi and Spiree, reporting that column `I` of their tabs "is not
`LEAD RECEIVED`, so the sheet's own numbers come from the wrong field". **That was wrong, and the
reasoning was backwards.**

Their DATA sits in the standard positions: column `I` holds real date serials, column `N` holds
`MQL` / `preMQL`. What is shifted is the **header row** — it is missing `Phone Number` and
`Phone Source`, so every label sits two columns left of the values it names. (Spiree's column `A` is
also headed `f` rather than `FULL NAME`.) `COUNTIFS` never reads a header, so CS PDCA was right all
along; the probe was reading by header name and taking `INDUSTRY` as the date and a free-text code
as the qualification.

That artefact accounted for **638 of the findings** first reported — 343 for RevOpsi and 295 for
Spiree. Read positionally, the real figures are **14** and **44**.

So the rule for anything comparing against these tabs: **read raw values by absolute column index**
(`I` = 8, `N` = 13), the way `COUNTIFS` does. For the other 31 tabs both readings agree, which is how
the mistake survived a full sweep. The header label is worth reporting as a diagnostic — a shifted
header is real disorder, and the two tabs should be repaired — but it must never gate whether a
client is measured.

One practical trap: n8n's Google Sheets node prepends a `row_number` key of its own, so indexing its
output positionally is off by one. Reading `spreadsheets.values` over HTTP with
`valueRenderOption=UNFORMATTED_VALUE` avoids both problems at once — no header keys, and a date cell
comes back as a serial instead of a display string that hides whether it is a date at all.

### Duplicates, and where they actually live

103 duplicate rows across 20 clients' sheets against **5** in Supabase. 99 of the 103 sit in
*adjacent* rows — same e-mail, same date, same status, one row apart. That is not a human entering a
lead twice; it is a write that fired twice. Duplicate protection on the sheet branch is a read-then-
write lookup, while Supabase has `uq_leads_origin_reply` and `uq_leads_source_sequencer_contact` —
an index, not a check. The asymmetry is the whole explanation.

Two guards earned their place when the list was built, and both must survive any re-run:
a placeholder name is not an identity (`x x` appears 14× for OmniOxy and 7× for IzoDom, a different
e-mail each time — grouping on it would have proposed deleting 19 live leads), and two different
e-mails are two contacts.

### `qualification` {#qualification-2026-08-05}

| Sheet → Supabase | Rows | Cause | Status |
|---|---|---|---|
| `preMQL` → `MQL` | 102 | the RPC was upgrade-only, the sheet rewrites in both directions — see below | **aligned to the sheet 2026-08-05** |
| `PreMQL` → *(empty)* | 92 | the enum accepts `preMQL`; the workbooks write a capital **P**. The 2026-07-22 import could not cast it, wrote NULL and said nothing | **filled 2026-08-05** |
| `MQL` → `preMQL` | 13 | 12 of them are the Aimfox `Create Record` hardcode; 1 predates branch S | **aligned to the sheet 2026-08-05** |
| `Referral` → *(empty)* | 11 | no such enum label | **open** — needs a mapping decision, not a backfill |

The `Referral` rows are all **June–July 2025**: ColdUnicorn PL ×7 (05.06, 12.06, 01.07, 07.07, 08.07,
09.07, 18.07), Konrad ×2 (27.06, 07.07), Runmageddon ×2 (25.07, 29.07). Every one of them is older
than the four months MoM reaches back, so none moves a metric the portal renders today — which is
why this is a naming decision to take calmly rather than a gap to plug.

A NULL `qualification` is not a harmless gap: the lead still counts in WoW and MoM Total (both are
`COUNT(*)`) but vanishes from 3-DoD Total, which requires `MQL` or `preMQL`, and can never be SQL.
**94 filled 2026-08-05** by [`backfill-lead-qualification`](../../../../scripts/sheets/backfill-lead-qualification.mjs)
— dry-run first, `NULL`-guarded per row so it is idempotent and cannot overwrite a value set since
the probe ran.

**The 102 are the important ones, and neither store was corrupt.** Both writers computed the label
from `data.tag_name` — the event that woke the run — while the tag *set* is the state. Fixed in
[`bison-lead-enrichment`](../../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md#qualification-comes-from-the-tag-set-not-the-event--2026-08-05)
and [`aimfox-leads-processing`](../../../../automation/n8n/workflows/outreach/aimfox-leads-processing/README.md),
with [20260805](../../../../supabase/migrations/20260805_promote_contact_lead_two_way_qualification.sql)
making the RPC sync both ways. **Order matters: callers first, migration second.**

**History was then converged on the sheet**, decided 2026-08-05. Re-deriving each lead's true stage
from Bison would need the per-client API keys the extract deliberately never emits; the workbooks
already hold the answer the team works from daily, and under [ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)
phase A they are the authoritative surface anyway. So `--align` writes the sheet's value over
Supabase for the 115 rows, guarded to `MQL ⇄ preMQL` — a lead that reached `meeting_scheduled`,
`offer_sent`, `won` or `rejected` is never demoted by a sheet value, the same guard the RPC now
carries. Nothing was held back: no disagreeing lead had advanced past those two stages.

After the run, `preMQL ⇄ MQL` disagreements across the 31 clients then in scope: **0**.

A second pass followed on the same day, once the positional read brought RevOpsi and Spiree into
scope for the first time: **48 more rows** aligned (RevOpsi 13, Spiree 35), same guards, 0 stale.
Across all **33** comparable clients, `preMQL ⇄ MQL` disagreements are now **0**.

What still disagrees is only what the enum has no label for — 11 `Referral`, 5 rows where Spiree's
QUALIFICATION column literally holds `false`, and TF v1's header row imported as a lead.

### What is left, by the action it needs

| | Rows | |
|---|---|---|
| Append the lead to the client's sheet | 26 | plain addition; the portal counts them, PDCA does not |
| Lead in the sheet, absent from Supabase | 14 | **blocked** — ADR-0015 has no path: a historical row has no reply to attach. Same decision that stopped the 192-row backfill above |
| Dates | 19 | all Aimfox, 1–3 days late. [`sheets-lead-date-backfill`](../../../../automation/n8n/workflows/ops/sheets-lead-date-backfill/README.md) matches only 2 of them: it compares `company_name` whole, and the Aimfox sheet row joins every employer with commas while the column holds the first. Needs a comma-trim in its `matched` CTE |

The remaining 12 date rows carry no readable `LEAD RECEIVED`, so `COUNTIFS` never counted them and
there is nothing in the sheet to converge on — the fix is a date in the sheet, not a write here.

## Related

[ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) ·
[ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) ·
[bison-ingestion](bison-ingestion.md) ·
[11-integrations](../../functional/11-integrations.md)
