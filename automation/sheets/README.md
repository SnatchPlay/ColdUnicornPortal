# automation/sheets

Google Sheets artifacts, tracked for the same reason the n8n workflows are
([ADR-0016](../../docs/adr/0016-repository-as-automation-source-of-truth.md)): the agency still runs
on the sheets ([ADR-0017](../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md)), so a
question like "why does the portal disagree with PDCA?" is unanswerable unless the sheet's formulas
are reviewable next to the portal's.

```
pdca/
  apps-script/daily-stats-sync.gs   what actually writes 🤖Daily stats — verbatim
  FORMULAS.md                       column map, metric definitions, defect table
  extracts/<snapshot>/              generated, redacted; committed so a claim stays checkable
```

## The workbook is never committed

`GHEADS | PDCA` holds live credentials and personal data in the `CS PDCA` tab:

| Column | Contents |
|---|---|
| `F` | Bison workspace API key, per client |
| `CY` | CRM webhook URL with an embedded token |
| `DA` | Auto-LI invitations API key |
| `CV`, `CW`, `DM`, `DO` | contact phone numbers and e-mail addresses |
| `D` | client spreadsheet id |

`scripts/sheets/extract-pdca.mjs` therefore works from an **allowlist** — identity (`A`, `C`, `E`,
`G`) plus the metric block (`N`..`CU`) — and never a denylist. A denylist leaks whichever column
somebody adds next. The `.xlsx` stays in Downloads; only the extract is tracked.

## Commands

```bash
pnpm sheets:extract "~/Downloads/GHEADS _ PDCA.xlsx" [--snapshot YYYY-MM-DD]
pnpm sheets:compare [--snapshot …] [--client UniTalk] [--from …] [--to …] [--top N]
```

`sheets:compare` needs `SUPABASE_DB_URL` and only reads. It diffs the snapshot's `🤖Daily stats`
against `daily_stats` per (workspace, date, field).

## Reading a diff honestly

The sheet and the n8n worker poll the **same** Bison endpoints independently, at different moments.
Three of the columns are deltas of an undated lifetime total, so a disagreement there is a
statement about snapshot timing, not about correctness — both numbers can be wrong together.
`emails_sent` and `response_count` are true per-day values and *should* agree; when they don't,
that is a real gap. The distinction is the whole point of
[FORMULAS.md §4](pdca/FORMULAS.md#4-defect-table) — read it before filing a bug.

## Related

[sheets-supabase-reconciliation](../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md) ·
[bison-ingestion](../../docs/reference/processes/outreach/bison-ingestion.md) ·
[bison-daily-stats-process](../n8n/workflows/ingestion/bison-daily-stats-process/README.md) ·
[04-metrics-catalog](../../docs/reference/functional/04-metrics-catalog.md)
