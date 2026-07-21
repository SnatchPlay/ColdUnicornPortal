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
                    │                    └─▶ [326] Set last_reply
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

## Known defects

Each is registered in `manifest.yaml:knownViolations` (so `pnpm n8n:validate` reports it as accepted
debt with an expiry) except where noted.

| # | Defect | Consequence |
|---|---|---|
| 1 | Writes `leads.qualification='OOO'` + `leads.expected_return_date` directly | Contradicts ADR-0015; both are dropped by the deferred `20260722z` migration. **This node is the cutover gate.** |
| 2 | `Expected Return Date` falls back to `$now.plus({days:14})` when the LLM parses none | Stores a guess in a field read as a fact (ADR-0015 §2). Also inconsistent with the RPC fallback of *today + 2*. |
| 3 | `Select rows from a table` (`client_sequencers`) is a **dead-end leaf** | The client is resolved and then discarded, so defect 4 has nothing to scope by. |
| 4 | `leads` is matched on `external_id` **alone** | Not scoped by client/workspace. Two workspaces sharing a Bison lead id would cross-write. ADR-0015's scoped identity `(client_sequencer_id, external_contact_id)` exists precisely for this. |
| 5 | **No idempotency.** The sheet append is unconditional | A redelivered `TAG_ATTACHED` writes a duplicate OOO row. |
| 6 | No error branch on the Bison calls, the LLM call or either write | A failure drops the OOO event silently — there is nowhere that records "this one failed". |
| 7 | The Bison API key travels from a Google Sheet cell into an `Authorization` header expression | Per-client API keys live in a spreadsheet rather than `client_sequencers.api_key`. Tracked in [security.md](../../../../../docs/reference/n8n/security.md), not in `knownViolations` (it is not a rule the offline validator can express). |
| 8 | `[326]` is named "Set last_reply (**oldest** by date_received)" and does sort **ascending** | Takes the *oldest* reply, not the newest. For a contact with several replies the LLM is fed the wrong message. Name and behaviour agree; both look wrong. Not yet accepted — needs a product decision, see the process doc. |
| 9 | The two branches read `[317]`'s output with **incompatible shapes** | Sheet: `$json.expected_return_date`. Postgres: `$json.output[0].content[0].text.returnDate`. Both consume the same node, so at most one can be correct — and the production evidence (0 rows written) says the Postgres one is not. |

**Open question raised by defect 9.** If `$json.expected_return_date` is *also* undefined, then the
`|| $now.plus({days:14})` fallback fires on every event and the gpt-5-mini extraction is decorative —
every OOO contact would be scheduled exactly 14 days out. This is checkable and not yet checked:
read the `Expected Return Date` column of the `OOO Leads` sheet and see whether the values cluster on
`created + 14d`. Resolve it before porting any extraction logic to the RPC path, or the cutover will
faithfully reproduce a broken behaviour. Tracked in
[migration-backlog.md §1](../../../../../docs/reference/n8n/migration-backlog.md#1-ooo-cutover).

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
