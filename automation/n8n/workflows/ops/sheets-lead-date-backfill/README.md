# sheets-lead-date-backfill

**Logical ID:** `sheets-lead-date-backfill` · **Domain:** `ops` · **Criticality:** medium
**Remote (production):** not deployed yet — `registry.yaml` carries `remoteWorkflowId: null`
**Business process:** [Sheets ↔ Supabase reconciliation](../../../../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md)
**Phase:** **A — the sheet is authoritative for lead dates.**

## Business purpose

Reads every client's own `Leads` tab and brings `leads.created_at` into line with that tab's
`LEAD RECEIVED`, moving the originating reply's `received_at` with it.

It exists because a write path can be fixed forward but history cannot fix itself.
`aimfox-premql-to-pdca` dated the sheet row from the prospect's conversation message and dated the
Supabase reply from `body.event.timestamp` — the moment Aimfox delivered the webhook. Label events
arrive in batches, so the stored value is visibly synthetic: five unrelated contacts share
`received_at = 2026-07-28 08:01`. Since [20260727](../../../../../supabase/migrations/20260727_promote_contact_lead_cast_and_date.sql)
`leads.created_at` is cut from `replies.received_at`, so every DoD / WoW / MoM bucket inherited the
drift. The workflow was corrected on 2026-08-03; this is the repair arm.

`upsert_reply`'s `on conflict` deliberately does **not** touch `received_at` — replays must not move
history — so re-running the ingestion flow cannot repair these rows. That is why this exists as a
separate, declared path rather than a re-run.

## Flow

```
Run Manually → Config (apply=false)
  └─ Read CS PDCA → Pick Clients → Loop Over Items (batch 1)
       ├─ done → Summarise                        ← one row for the whole run
       └─ loop → Resolve Client (workspace → client_id)
                  └─ Read Client Leads (the client's own workbook)
                       └─ Build Date Rows (identity + LEAD RECEIVED, locale-detected)
                            └─ Re-date Leads (plan, and write only when apply=true)
                                 └─ back to Loop Over Items
```

## The one thing to get right: `Config.apply`

`apply=false` is a **dry run**. The SQL builds the whole plan and writes nothing; the run still
reports exactly which leads it would move, per client. That is the default in the artifact, and the
committed state.

For the real run, flip `Config.apply` to `true` in the n8n UI, execute, then **flip it back and run
`pnpm n8n:check-drift --id sheets-lead-date-backfill`** — a `true` left behind is a workflow that
rewrites history on the next click.

## What it will not do

| Case | Behaviour |
|---|---|
| Sheet row has no readable `LEAD RECEIVED` | skipped, counted as `sheet_rows_no_date`. No date is invented — the failure mode this repository has already paid for once |
| A sheet row matches several leads, or a lead matches several sheet rows | skipped, counted as `ambiguous_leads`. Never resolved by picking one |
| Lead is not in the sheet at all | untouched. Inserting it is [`sheets-lead-backfill`](../sheets-lead-backfill/README.md)'s job, not this one |
| Dates already agree | no write. A run over already-correct data reports `to_move=0` |
| A client fails to resolve or its workbook cannot be read | the loop continues; `Summarise` reports `clients_failed` |

Matching is `(client_id, lower(email))`, or normalised full name **and** company when the e-mail is
missing on either side — Aimfox leads frequently have no e-mail in Supabase while the sheet has one
from Lusha, so the name tier is always tried, not only as a fallback. Adding the company condition
is not cosmetic: one client workbook holds 21 placeholder rows named `x x`, which without it matched
21 leads each — 441 pairs from one client. They are all correctly discarded as ambiguous either way,
but the guard keeps the join honest.

Date locale is detected **per tab**, not per row (a value above 12 in either position settles it).
The client workbooks disagree on format, and assuming D/M/Y is what silently turns `05/03/2026` into
5 March — it hit 9 of 42 workbooks during the 2026-07-22 import.

**Only slash values vote on the slash format.** An ISO value is self-describing and has no opinion
about whether `06/03` is June or March. Letting it vote is not harmless: TouchlessFreaks v2 mixes
126 ISO rows — 70 of them with a day above 12 — with 78 M/D/Y slash rows, of which 42 are decisive.
The ISO majority outvoted the real evidence 70:42, the tab was read as D/M/Y, and dry run 61605
proposed swapping day and month on **28 leads that were already correct** (`2026-06-03 → 2026-03-06`
and so on). Fixed 2026-08-03; the same flaw is still present in
[`sheets-lead-backfill`](../sheets-lead-backfill/README.md)'s `Build Rows`, which means the
2026-07-22 import may have mis-dated rows in any workbook that mixes both formats — worth a
separate check, and the reason this workflow is convergent rather than one-shot.

**A tab that cannot settle its own format is skipped, not guessed.** The first full dry run
(execution 61572, 2026-08-03) proved why: EvidencePrime's tab holds two dated rows, `07/02/2026` and
`2026-08-02`. Neither carries a value above 12 in a disambiguating position, the detector fell back
to D/M/Y, and the plan proposed moving Jana Vítková from **2 July to 7 February** — five months, on
a row that was never wrong. Every other slash-formatted workbook in the instance is M/D/Y, and the
Aimfox and Bison writers format `mm/dd/yyyy` explicitly, so D/M/Y was the wrong guess as well as a
guess. `detectOrder` now returns `ambiguous` when no evidence exists and the tab uses slashes;
slash values then resolve to `null` and are counted as `sheet_rows_no_date`. ISO values in the same
tab stay readable — they need no order. `Summarise` reports `date_order` per client, so an
`ambiguous` tab is visible in the run rather than silently absent.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id sheets-lead-date-backfill
```

The SQL was exercised against **production inside `begin … rollback`** on 2026-08-03, using the one
client workbook available locally (Bent Iron PL):

| | |
|---|---|
| `matched_leads` | 184 of 185 leads |
| `ambiguous_leads` | 9 (the `x x` placeholder rows) |
| `to_move` | **7**, all Aimfox, all with an originating reply |
| after `apply=true` | `leads_moved=7`, `replies_moved=7` |
| re-run in the same transaction | `to_move=0` — convergent |
| `created_at` vs `received_at` disagreement afterwards | 0 |

The same 7 rows had been found independently by a local xlsx diff
([`sheets:backfill-aimfox-dates`](../../../../../scripts/sheets/backfill-aimfox-lead-dates.mjs)),
which is the small-scale counterpart of this workflow: same rules, but it reads workbook exports
from disk instead of Google, so it can be run without the n8n credentials.

### First full dry run — execution 61572, 2026-08-03

42 clients read, **0 failed**, 78 seconds, nothing written.

| | |
|---|---|
| Sheet rows read | 4066 |
| Rows with no readable `LEAD RECEIVED` | 352 — 185 RevOpsi + 158 Spiree, whose `LEAD RECEIVED` column holds industry names, so their tabs are simply not readable by column name |
| Leads matched | 3615 |
| Ambiguous, skipped | 185 |
| **To move** | **19** → 18 after the `ambiguous` guard removed EvidencePrime's false positive |

All 18 are Aimfox, all with an originating reply, in three clients: Bent Iron PL 7, Runmageddon 7,
Kaizen rent 4. The shape is the batch-event signature — mostly one-day moves clustered on
2026-07-28/29, plus longer ones where a label was applied days after the reply (Runmageddon's
`irena p.`, 28.07 → 16.07).

### Applied — execution 61622, 2026-08-03

`leads_moved=18`, `replies_moved=18`, three clients. Verified against the database rather than taken
from the run's own report:

| Check | Result |
|---|---|
| `leads` rows written in the run's window (10:12:32–10:12:40Z) | **18**, across 3 clients — the whole write is separable by that `updated_at` range |
| Aimfox leads whose `created_at` disagrees with their reply's `received_at` | **0** of 52 |
| Bent Iron PL MoM | unchanged (Jul 30/15, Jun 11/4, May 18/8) — every move stayed inside its month |
| Bent Iron PL WoW | 20–26.07 gained 3, 27.07–02.08 lost 3 — the intended correction |

Four dry runs preceded it, and each caught a different class of false positive before it could be
written: 61572 found EvidencePrime's undecidable tab, 61605 found TouchlessFreaks v2's ISO-vs-slash
vote, 61620 confirmed the plan at 18, 61622 applied it. That is what the dry run is for.

**Not fully closed.** `clients_empty` was 11 on the applied run: nine workbooks have no readable
Leads tab at all (oLIVEmedia TTS is `Forbidden`, Komandor `not found`), and two — UniTalk webinar,
Fluentbe — read fine in 61572 with nothing to move, so their absence changes no number. But an
intermittently empty read is a coverage hole, not noise: `Read Client Leads` has no `retryOnFail`,
so a Google quota blip is indistinguishable from an empty sheet apart from this counter. Add the
retry before the next campaign of re-dating.

## Known violations

`Re-date Leads` writes `public.leads` and `public.replies` with raw SQL, which
[`business/direct-table-write`](../../../../../scripts/n8n/lib/business-rules.mjs) reports as an
error. Both are declared in `manifest.yaml` with a reason and an expiry: no RPC can express a
repair — `promote_contact_to_lead` only creates, and `upsert_reply` deliberately refuses to move
`received_at`. The two updates run in one statement per client, so a lead and its reply can never
end up on different days.
