# GHEADS | PDCA — column map and metric definitions

**Status:** measured against the `2026-07-27` snapshot · **Governing ADR:**
[ADR-0016](../../../docs/adr/0016-repository-as-automation-source-of-truth.md) (the repository is
the source of truth for automation) and
[ADR-0017](../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) (dual-write, phase A).

This is the sheet half of the data contract. The portal's half is
[04-metrics-catalog](../../../docs/reference/functional/04-metrics-catalog.md). Where they disagree
the disagreement is recorded here, not resolved silently.

> **The workbook itself is never committed.** `CS PDCA` carries a live Bison bearer token per
> client (`F`), a CRM webhook URL with an embedded token (`CY`), a LinkedIn API key (`DA`), and
> contact phone numbers and e-mail addresses (`CV`, `CW`, `DM`, `DO`). `pnpm sheets:extract` emits
> an **allowlist** of identity and metric columns only. See [../README.md](../README.md).

---

## 1. Two writers, one shape

`🤖Daily stats` is written by [`apps-script/daily-stats-sync.gs`](apps-script/daily-stats-sync.gs).
`daily_stats` in Supabase is written by
[`bison-daily-stats-process`](../../n8n/workflows/ingestion/bison-daily-stats-process/README.md).
They call the **same Bison endpoints independently** and neither reads the other. So a disagreement
between the two stores is evidence about *when each snapshot was taken* — not about which is right.

## 2. `🤖Daily stats` column map

| Col | Header | Written from | Supabase counterpart |
|---|---|---|---|
| A | Client | `CS PDCA!E` (Bison workspace id) | `client_sequencers.external_workspace_id` |
| B | E-DMS | `line-area-chart-stats` label `Sent`, **for that date** | `emails_sent` |
| F | Response Count | `line-area-chart-stats` label `Replied`, **for that date** | `response_count` |
| G | Bounce count | `workspaces/v1.1/stats` → `data.bounced` | `bounce_count` |
| I | Date | the run's target date | `report_date` |
| J | Inboxes | `sender-emails` → `meta.total` | `inboxes_count` |
| K | Prospects Count | `leads?created_at>=firstDayOfMonth` → `meta.total` — a **month-to-date cumulative**, not a count for the day | `prospects_total` |
| S | Sequencer | literal `"Bizon"` | `sequencers.key = 'emailbison'` |
| U | Out of Office Accumulated | `replies?status=automated_reply&folder=inbox` → `meta.total`, **lifetime, no date filter** | `automated_replies_total` / `ooo_count_total` |
| V | Human Replies | `W(today) − W(yesterday)`, clamped at 0 | `human_replies_count` |
| W | Human Replies Accumulated | `replies?status=not_automated_reply&folder=inbox` → `meta.total`, **lifetime, no date filter** | `human_replies_total` |
| X | Out of Office | `U(today) − U(yesterday)`, clamped at 0 | `ooo_count` |
| Y·Z·AA | Schedule volumes | `campaigns/sending-schedules?day=…` | `schedule_today` / `_tomorrow` / `_day_after` |

**The headers lie in two places, and the code is the truth:**

- **`X` is labelled "Out of Office" and holds an automated-replies delta.** Nothing in the script
  fetches OOO. `U` and `X` are the automated-reply total and its delta; the OOO label is inherited
  from an older meaning. Supabase copied the mislabel one-for-one into `ooo_count` —
  [reconciliation · Problem 2](../../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md#problem-2--ooo_count-is-a-mislabelled-copy).
  Real OOO episodes live in `ooo_followups` ([ADR-0015](../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)).
- **`V` ("Daily difference") is the *human* delta and `X` ("Out of Office") is the *automated*
  delta** — the two `COL` constants are crossed relative to their names in the script
  (`newRow[COL.V] = dailyWDifference`, `newRow[COL.X] = dailyUDifference`).

## 3. `CS PDCA` — the metric columns

Row 2 is the label, row 3 is the WoW/MoM bucket (`0`, `-1`, `-2`, `-3`). Client rows start at 4.
Full generated formula text: [`extracts/<snapshot>/formulas.md`](extracts/).

| Block | Cols | Definition |
|---|---|---|
| Prospects Signed | `O` | **hardcoded per client.** Supabase counterpart: `clients.prospects_signed`. |
| Prospects Added | `P` | `SUMIFS('🤖Daily stats'!K:K, A:A = <workspace>, I:I = TODAY())` — today's row of the **month-to-date cumulative** `K`. |
| Min Sent | `Q` | `O * 3 / 20` |
| WoW Bounce rate | `AM..AP` | `SUM(G) / SUM(B)` over the week |
| **WoW Total response rate** | `AQ..AT` | **`= AU + AY`** — human rate **plus** OOO rate. It is *not* built from `F` (Response Count) for a Bizon row. |
| **WoW Human response rate** | `AU..AX` | `SUM(IF(S="SmartLead", F, IF(S="Bizon", V, 0))) / SUM(B)` — for Bizon the numerator is `V`, the reply-total delta. |
| **WoW Out of office rate** | `AY..BB` | `SUM(X) / SUM(B)` |
| WoW TOTAL leads | `BG..BJ` | `COUNTIFS` over `IMPORTRANGE(<client sheet>, "Leads!I:I")` — the client's own **LEAD RECEIVED** date, not a CRM timestamp. |
| WoW SQL leads | `BK..BN` | the same, filtered `status = "MQL"` (`Leads!N`). |

**Week boundaries:** `TODAY() - WEEKDAY(TODAY(), 2) + 1` … `+ 7`, i.e. Monday-start ISO weeks —
identical to the portal's `date_trunc('week', …)`. Bucket differences are never boundary
differences.

## 4. Defect table

Ordered by blast radius. Each is reproducible from the committed extracts.

| # | Defect | Where | Consequence |
|---|---|---|---|
| 1 | `V`/`X` are deltas of an **undated lifetime total** taken at run time, while `B`/`F` are true per-day values | both stores | one row mixes two time semantics; `V + X` routinely exceeds `F` |
| 2 | the totals are read with `folder=inbox`, so **archiving a reply lowers them** | both stores | the series is non-monotonic; the `< 0 → 0` clamp discards the drop and the baseline never resets |
| 3 | two independent pollers, two different moments | sheet vs Supabase | the same day gets two different "counts" — the only reason PDCA and the portal disagree on replies at all |
| 4 | `X` is not OOO | both stores | OOO rate overstates ~3× vs `ooo_followups`. **Accepted 2026-07-27, review by 2026-10-31** — kept aligned with PDCA because the two surfaces are compared by eye daily; fix both or neither ([decision](../../n8n/workflows/ingestion/bison-daily-stats-process/README.md#accepted-deviation--ooo_count-decided-2026-07-27-review-by-2026-10-31)) |
| 5 | a failed `leads` fetch writes `K = 0` rather than erroring | both stores | a zero-baseline week (UniTalk, 01–07.06.2026) |
| 6 | Supabase derives `prospects_count = K − K(yesterday)`; the gateway then reports **`MAX(prospects_count)` over 180 days** | Supabase/portal only | defect 5's zero-baseline becomes a permanent one-day spike in the portal's "Added" column. The sheet is immune — it never derives a delta from `K`. |
| 7 | no retry on any Bison call, and no run-record | both stores | a partial fetch is stored as fact and is indistinguishable afterwards |

## 5. Verifying a claim about these numbers

```bash
pnpm sheets:extract "~/Downloads/GHEADS _ PDCA.xlsx" --snapshot 2026-07-27
pnpm sheets:compare --client UniTalk --from 2026-07-01 --to 2026-07-27
```

The comparison is per (workspace, date, field) against `daily_stats`. Read defect 3 before
concluding that a disagreement means one store is broken.
