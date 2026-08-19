# ooo-detect-and-log

**Logical ID:** `ooo-detect-and-log` · **Domain:** `outreach` · **Criticality:** medium
**Remote (production):** `O4DqMEu1Z9LcxikE` — `[child-3] TAG_ATTACHED · OOO · Detect return date and log`
**Business process:** [OOO follow-ups](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Governing ADR:** [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)

> **This artifact documents the workflow AS IT RUNS TODAY, and today it contradicts ADR-0015.**
> It was imported to bring an unmanaged production workflow under repository control — step one of
> the migration, not the finished state. The gap is enumerated in `manifest.yaml:knownViolations`
> and in [§Migration](#migration) below. Do not treat this graph as the reference implementation.

## Business purpose

When a contact replies out-of-office, Bison attaches an `OOO` tag. The HUB dispatcher fans that
event out to this sub-workflow, which figures out *when the person is expected back* and records
the absence so a follow-up can be re-sent later.

## Inputs

Called by `[HUB] Bison Replies Dispatcher` via `executeWorkflowTrigger` (passthrough mode), so it
receives the HUB's normalized payload. Contract:
[`contracts/hub-child-input.schema.json`](contracts/hub-child-input.schema.json).

The fields this workflow actually reads:

| Path | Used for |
|---|---|
| `event.workspace_id` | look up the Bison API key in the CS PDCA sheet (`col_5` → `col_6`) |
| `data.taggable_id` | the Bison lead id — fetched, and used as the `leads.external_id` match key |

## Flow

```
When Called by HUB ─┬─▶ [325] Find workspace in CS PDCA (Sheets, retry 5×5s)
                    │        └─▶ [318] Bison GET /leads/{id}
                    │              └─▶ [322] Bison GET /leads/{id}/replies
                    │                    └─▶ [326] Set last_reply (newest by date_received)
                    │                          └─▶ [317] gpt-5-mini: extract return date
                    │                                ├─▶ [327] Append row to "OOO Leads" sheet
                    │                                └─▶ Update rows in a table (public.leads)
                    └─▶ Select rows from a table (public.client_sequencers)   ◀── DEAD END
```

## Outputs

1. **Google Sheet `OOO Leads`** (`1BGjr3EWsv…`) — one appended row: `LeadID`, `ReplyID`,
   `WorkspaceID`, `Expected Return Date`, `Formatted Expected Date`, `Gender`. **This sheet is the
   de-facto source of truth for OOO today**, and it is what the scheduled `Add OOO Leads` workflow
   reads to re-enrol contacts.
   Under [ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) this
   write is **kept** through the transition — it is the system the business currently reads, not debt
   to delete.
2. **`public.leads`** — `UPDATE … SET qualification='OOO', expected_return_date=… WHERE external_id=…`.
   Verified against production on 2026-07-21: **0 rows carry `qualification='OOO'` and 0 carry a
   non-null `expected_return_date`.** This write has never landed. Treat the Postgres branch as
   non-functional, not as a second source of truth.

   **Update 2026-07-22: branch S is no longer non-functional — it now writes `ooo_followups`.** 66
   rows exist as of this check, all through `record_ooo_followup`, not the direct write above (which
   remains dead and is still the cutover gate). The earlier "OOO episode gap" (`ooo_followups`
   apparently stuck at 0 despite `sequencer_contacts`/`replies` growing) had already closed by the time
   it was re-checked — the migration-backlog entry describing it as open was stale.

## Known defects

Each is registered in `manifest.yaml:knownViolations` (so `pnpm n8n:validate` reports it as accepted
debt with an expiry) except where noted.

| # | Defect | Consequence |
|---|---|---|
| 1 | Writes `leads.qualification='OOO'` + `leads.expected_return_date` directly | Contradicts ADR-0015; both are dropped by the deferred `20260722z` migration. **This node is the cutover gate.** |
| 2 | `Expected Return Date` falls back to `$now.plus({days:14})` when the LLM parses none | Stores a guess in a field read as a fact (ADR-0015 §2). Also inconsistent with the RPC fallback of *today + 2*. Still true when the LLM genuinely finds no date — accepted, expires 2026-10-31. Until 2026-07-22 this fired on **every** event regardless (see defect 9); that part is now fixed. |
| 3 | `Select rows from a table` (`client_sequencers`) is a **dead-end leaf** | The client is resolved and then discarded, so defect 4 has nothing to scope by. |
| 4 | `leads` is matched on `external_id` **alone** | Not scoped by client/workspace. Two workspaces sharing a Bison lead id would cross-write. ADR-0015's scoped identity `(client_sequencer_id, external_contact_id)` exists precisely for this. |
| 5 | **No idempotency.** The sheet append is unconditional | A redelivered `TAG_ATTACHED` writes a duplicate OOO row. **Decided 2026-07-22: won't-fix — do not re-raise.** Branch L only (branch S has real idempotency via `record_ooo_followup`'s partial unique indexes + `upsert_reply`'s `external_id` uniqueness). Branch L is the Google Sheets side that gets disconnected outright at phase C (ADR-0017); building append-or-update logic against a system on its way out, for a symptom that is an occasional duplicate row in a human-reviewed spreadsheet, is not worth it. Re-raise only with evidence the duplicates cause wrong re-enrolments, not just visual noise. |
| 6 | No error branch on the Bison calls, the LLM call or either write | A failure drops the OOO event silently — there is nowhere that records "this one failed". |
| 7 | The Bison API key travels from a Google Sheet cell into an `Authorization` header expression | Per-client API keys live in a spreadsheet rather than `client_sequencers.api_key`. Tracked in [security.md](../../../../../docs/reference/n8n/security.md), not in `knownViolations` (it is not a rule the offline validator can express). |
| 8 | ~~`[326]` sorted **ascending** and took the oldest reply~~ — **fixed 2026-07-22** | Branch L's `[326]` now sorts **descending** and takes the newest reply (renamed to "Set last_reply (**newest** by date_received)", comparator flipped to `new Date(b…) - new Date(a…)`), matching branch S's `[S] Pick newest OOO reply`, which was already correct. For a contact with several replies the newest is the current OOO auto-reply, so both branches now feed the LLM the right message. |
| 9 | ~~The two branches read `[317]`'s output with incompatible shapes~~ — **fixed 2026-07-22** | Both `[327] Add OOO Leads row` and `[S] record_ooo_followup` read a flat field (`$json.expected_return_date` / `$json.returnDate`) that never existed — the real langchain-openai response nests it at `output[0].content[0].text.{return_date\|returnDate}`. Neither consumer path could ever have worked. |
| 10 | ~~The extractor is never told what today's date is~~ — **fixed 2026-08-19** | `gpt-5-mini` reading "back on 15 August" had no reference date, so it invented the year: 36 of 974 parsed episodes carried an impossible `expected_return_date` (35 in the past, one at +366 days). 23 of them were later expired as `stale` — contacts who named a return date and were never followed up. Both prompts now carry the reply's `date_received`; the RPC rejects an implausible date as `date_source='parse_rejected'`. See [B1](../../../../../docs/reference/n8n/defect-backlog.md#b1). |

**Defect 9 resolved, not just described.** The open question this defect raised ("is the fallback
firing on every event, or only when the LLM genuinely finds nothing?") was checked against real
production data, not assumed: of the 66 `ooo_followups` rows written before the fix, **all 66** had
`date_source='fallback'` — including executions where `[317]`/`[S] Extract expected return date` had
demonstrably returned a real date (verified by pulling `GET /executions/{id}?includeData=true` and
reading the raw LLM output directly). The gpt-5-mini extraction was 100% decorative on both branches,
not "correctly falling back when the AI found nothing." Fixed on both consumers by reading the correct
nested path (`$json.output?.[0]?.content?.[0]?.text?.return_date`, with the equivalent `returnDate` key
for branch S) — a targeted accessor fix, not a change to branch L's design.

**Proven, not just patched.** Execution 51232 (2026-07-22 13:49 UTC, the first real event after the
fix) — the LLM returned `"2026-07-24"` on both branches, `[327]` wrote `2026-07-24` into the sheet
(not the `2026-08-05` today+14 fallback), and `[S] record_ooo_followup` produced
`ae1abbc8-351d-40f5-b481-8e0470a3f5b9` with `expected_return_date="2026-07-24"`,
`date_source='reply_parsed'` — the first `reply_parsed` row `ooo_followups` has ever had (69
`fallback` / 1 `reply_parsed` as of this write).


**Defect 10 and the two things it exposed.** The failure everyone could see was
`cannot convert to Luxon DateTime` in `[327]`, and it was recorded as a date-conversion bug for three
weeks. It was not. Two independent problems shared that symptom:

- **The model picked its own key.** `[317]`'s instruction said "Return only the structured JSON"
  without naming one, so production shows `return_date`, `returnDate` *and* `return_to_office` from
  the same node. Branch L reads only the first. Defect 9 above records the two branches reading
  *different* keys as a quirk of each branch — it is actually the model choosing freely, and branch S
  only escaped because its prompt happened to name the key.
- **The model picked its own year.** Which no amount of accessor fixing could have caught, because
  the value parses fine — it is simply wrong.

The branches also disagree *with each other*: on the same reply, S returned 08-18 where L returned
08-19, and S returned null where L returned "2027". Two paid LLM calls asking one question twice
cannot be reconciled — which is what ADR-0017 phase B would require. Worth remembering before the
next dual-write puts a model on both sides of it.

## Migration

Target contract — [11-integrations §6a](../../../../../docs/reference/functional/11-integrations.md#6a-ooo--nrr-write-path-adr-0015--the-current-contract):

Migration is by **dual-write** ([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md)),
not by replacement. The `OOO Leads` sheet is what the business runs on today; it keeps being written
until Supabase has been proven against it. This workflow is at **phase 0** — Sheets only.

| Step | Add (Supabase side) | Sheet side |
|---|---|---|
| resolve workspace → client | `client_sequencers` join on `external_workspace_id` (already fetched, currently discarded — defect 3) | unchanged |
| identify the contact | `upsert_sequencer_contact(client_sequencer_id, external_contact_id, …)` | — |
| store the reply | `upsert_reply(external_id, sequencer_contact_id, …, classification)` | — |
| record the absence | `record_ooo_followup(sequencer_contact_id, source_reply_id, expected_return_date, scheduled_for, date_source)` | — |
| append `OOO Leads` row | — | **kept**, but must become append-or-update on a stable key (defect 5) before dual-write, or the two stores diverge by construction |
| write `leads` directly | **removed** — this is not a second source, it is a violation of ADR-0015 §5 | — |

Ordering in phase A: **Sheets first, Supabase second, Supabase failure non-fatal** — the business
still runs on the sheet, so the new path must not be able to break the old one.

`expected_return_date` must be passed as `NULL` when the LLM returns none; the *today + 2* fallback
goes to `scheduled_for` with `date_source='fallback'`.

Sequenced backlog: [migration-backlog.md §1](../../../../../docs/reference/n8n/migration-backlog.md#1-ooo-cutover).

## Observability

None beyond n8n's own execution list. There is no `integration_sync_runs` row, no error workflow and
no alert. After the cutover, a failed episode is visible as `ooo_followups.status='failed'` with
`last_error` — which is the point of modelling it as a record.

## Manual verification

Read-only, safe against production:

```bash
pnpm n8n:validate                          # offline: structure, secrets, business rules
pnpm n8n:check-drift --id ooo-detect-and-log   # committed artifact vs live instance
```

To confirm defect 1 is still harmless (expect all zeros):

```sql
select count(*) filter (where qualification = 'OOO')          as ooo_leads,
       count(expected_return_date)                            as with_return_date,
       count(*) filter (where added_to_ooo_campaign)          as added_to_campaign
from public.leads;
```

**Do not** run `execute_workflow` against this: it appends to the live `OOO Leads` sheet and calls
the Bison API for a real contact.
