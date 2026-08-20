# Process · OOO follow-ups (and NRR)

**Domain:** outreach · **Owner:** automation · **Status:** contract accepted, cutover pending
**Governing ADR:** [ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md)
**Implementation pair:** [11-integrations §5/§6a](../../functional/11-integrations.md#5-ooo-routing)

> **Level 1 document.** This describes what the business rule *is*. Where it disagrees with a
> running n8n workflow, the workflow is wrong ([ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md)).

---

## Business purpose

An outbound contact who replies "I'm away until the 14th" is not uninterested — they are unavailable.
Discarding them wastes an acquisition, and treating them as a CRM lead corrupts the funnel. The
process keeps the contact in outreach, remembers when to come back, and re-enrols them then.

NRR ("not right role") is handled in the same place because it shares the same rule: **it is an
outreach outcome, not a CRM stage, and it creates no lead.**

## Definitions

| Term | Meaning |
|---|---|
| **Sequencer contact** | Local identity of an external contact. Natural key is *scoped*: `(client_sequencer_id, external_contact_id)`. Holds no CRM state. |
| **OOO episode** | One absence. A row in `ooo_followups`. Repeat absences are separate rows, never an overwrite. |
| **CRM lead** | A `leads` row. Exists **only** after a positive reply. |
| **`expected_return_date`** | The date actually determined from the reply. `NULL` when none could be determined. |
| **`scheduled_for`** | When to re-enrol. May come from a fallback rule (today + 2). |
| **`routing_key`** | Explicit `male \| female \| general`. `NULL` is never an implicit "general". |

**`expected_return_date` and `scheduled_for` are different fields.** Collapsing them writes a guess
into a column read as a fact. This is the single most-violated rule in this process.

## Triggering events

| Event | Source | Effect |
|---|---|---|
| Reply classified `OOO` | n8n reply classification | open or refresh the one active episode |
| Reply classified `NRR` | n8n | record the reply; **no lead, no episode, no `final_outcome`**. ⚠️ **LinkedIn only.** On the email channel nothing is recorded: the Bison classifier suppresses the NRR tag before attaching it, so no child runs and no `replies` row is written. Owner decided 2026-08-15 not to revive that path — [C1](../../n8n/defect-backlog.md#c1) |
| Reply classified `Interested` | n8n | create/return the CRM lead **and** cancel the active episode |
| OOO tag removed / correction | Bison `TAG_REMOVED` | cancel the active episode — never delete |
| Routing configured in the portal | manager saves a routing rule | `recover_skipped_ooo_followups` pulls parked episodes back to `pending` |

## Preconditions

- The contact belongs to a `client_sequencers` row (client + sequencer + workspace).
- For an episode to become actionable, the client needs `auto_ooo_enabled = true` **and** a matching
  active `client_ooo_routing` row.
- Neither precondition failing is an error: both produce a **visible** `skipped` episode.

## Main flow

```
OOO reply
  └─ upsert_sequencer_contact(client_sequencer_id, external_contact_id, …)   → contact identity
      └─ upsert_reply(external_id, sequencer_contact_id, …, 'OOO')           → idempotent on external_id
          └─ record_ooo_followup(contact, source_reply, expected_return_date,
                                 scheduled_for, date_source)
              ├─ routing resolved      → pending      → worker re-enrols on scheduled_for
              ├─ no routing            → skipped/routing_missing
              └─ auto_ooo_enabled=false→ skipped/automation_disabled
```

Worker transitions, each an atomic conditional UPDATE guarded by `WHERE status IN (…)`:
`claim` → `mark_ooo_submitted` → (optional) `mark_ooo_confirmed`, or `mark_ooo_failed` / `skip` /
`cancel` / `retry` / `reopen`.

`submitted` means **the sequencer API accepted the request**, not that the contact is enrolled — the
batch endpoint can silently ignore a contact already in the campaign. `confirmed` requires a separate
verification call and is optional; where the vendor offers none, `submitted` is terminal success.

## Alternative flows

- **Repeat absence.** A later OOO reply after the previous episode reached `submitted` opens a **new**
  episode — `submitted` is deliberately not "active".
- **Dateless refresh.** A repeat OOO reply passing `NULL` dates leaves stored values alone; an earlier
  reply may have determined them.
- **Positive reply mid-absence.** `promote_contact_to_lead` creates the lead (at most one per contact;
  a repeat call returns `{lead_id, created: false}`) and cancels the active episode.
- **Config fixed later.** `recover_skipped_ooo_followups` recovers `routing_missing` and
  `automation_disabled`. `contact_ineligible` is a judgement about a person and needs an explicit reopen.

## Cancellation and terminal states

`pending` · `processing` · `failed` are **active**. `submitted` · `confirmed` · `skipped` ·
`cancelled` are not. Cancellation never deletes: the history stays explainable.

## Business invariants

1. A CRM lead is created **only** by a positive reply.
2. One contact yields **at most one** CRM lead (`uq_leads_source_sequencer_contact`).
3. Reprocessing one positive reply never creates two leads (`uq_leads_origin_reply`).
4. At most **one active** episode per contact (`uq_ooo_followups_active`).
5. One episode per **source reply** (`uq_ooo_followups_source_reply`) — this is what stops a
   redelivered event duplicating once the previous episode is `submitted`.
6. `expected_return_date` is `NULL` unless actually parsed from the reply.
7. OOO/NRR are never values of `leads.qualification`.
8. Missing routing is **visible** (`skipped`), never a silent drop.
9. At most one active `client_ooo_routing` row per `(client, routing_key)`; superseded rows are
   deactivated, never deleted.
10. An episode's routing snapshot freezes once it leaves an active status.

## Data ownership

| Data | Owner | Written by |
|---|---|---|
| `sequencer_contacts`, `ooo_followups`, `replies` | database invariants | n8n, via `service_role` RPCs only |
| `client_ooo_routing`, `clients.auto_ooo_enabled` | portal (manager) | portal, through RLS |
| `leads` | database | `promote_contact_to_lead` (creation); portal for the ADR-0004 whitelist |

## Database entities

`sequencer_contacts` · `ooo_followups` · `client_ooo_routing` · `replies` · `leads` ·
`client_sequencers` · `campaigns` (`type='ooo_followup'`).
Schema: [03-data-model](../../functional/03-data-model.md). Migrations: `20260722`–`20260722f`.

## RPC contracts

`resolve_ooo_routing` · `upsert_sequencer_contact` · `upsert_reply` · `record_ooo_followup` ·
`claim_ooo_followup` · `mark_ooo_submitted` · `mark_ooo_confirmed` · `mark_ooo_failed` ·
`skip_ooo_followup` · `cancel_ooo_followup` · `cancel_active_ooo_followup` · `retry_ooo_followup` ·
`reopen_ooo_followup` · `recover_skipped_ooo_followups` · `promote_contact_to_lead`.

All `SECURITY DEFINER`, `set search_path = ''`, `service_role` only.
Source: [`20260722e_ooo_rpcs.sql`](../../../../supabase/migrations/20260722e_ooo_rpcs.sql).
Payload contract for the one n8n must call first:
[`record-ooo-followup.rpc.json`](../../../../automation/n8n/workflows/outreach/ooo-detect-and-log/contracts/record-ooo-followup.rpc.json).

## Portal surfaces

**Only one:** the per-client OOO routing editor in the client drawer (`/manager/clients`,
`/admin/clients`). There is deliberately **no** episode list or editor — the operational view was
built and removed before release ([OoS-16](../../functional/13-out-of-scope.md)); n8n owns the
lifecycle end to end.

## Dashboard metrics

`daily_stats.ooo_count` is a **sequencer-reported daily event count** — not a CRM figure, not derived
from `leads.qualification`, and *not* the same quantity as "active follow-ups". No portal metric mixes
outreach and CRM ([04-metrics-catalog](../../functional/04-metrics-catalog.md), ADR-0015 §9).

## Related n8n workflows

| Logical ID | Remote | Role | State |
|---|---|---|---|
| `ooo-detect-and-log` | `O4DqMEu1Z9LcxikE` | OOO tag attached → detect return date, record | **phase C since 2026-08-19** — branch L disabled, Supabase only |
| `ooo-remove-on-tag-removed` | `ZZ0ughB302WdDJOf` | OOO tag removed → cancel the episode | managed; `[S] cancel_active_ooo_followup` runs first, sheet limb below it |
| `ooo-enrol-followups` | `zaPkpSAuvjibUUDU` | `pending` → `claim` → attach → `submit` worker | managed; rewired to Supabase in Wave 1, 2026-08-15 |
| `nrr-daily-stats` | `1hHbU2hYYcsktLUP` | NRR → increment a Sheets counter | **managed but never executed; `deprecated` 2026-08-15.** Unreachable by design — the classifier suppresses the NRR tag, so the HUB gate cannot fire. Not being revived ([C1](../../n8n/defect-backlog.md#c1)) |
| `bison-ooo-campaign-revive` | — | daily: switch a paused OOO campaign back on | **built 2026-08-20, never run** — see below |
| — | `xPzdtWQiY3lGtqI1` | HUB dispatcher | orphan |

### When the follow-up campaign itself stops sending

The episode machinery can be perfect and still deliver nothing, because the campaign at the far
end quietly stops. Measured 2026-08-20: **22 of the 42 active routing rules, across 13 clients,
pointed at a campaign that was not sending.**

Contacts are not lost while that lasts. Bison **accepts** leads into a paused campaign — 355
episodes were queued inside dead campaigns that day and exactly one had ever been rejected. The
cost is delay, and delay becomes loss only when nobody notices for longer than the follow-up stays
sensible (`[S] Expire stale`, 14 days).

So the campaign's own state is now watched, and half of it is repaired automatically:

- **`paused` → resumed**, daily, by `bison-ooo-campaign-revive`. 3 of the 22.
- **`archived` → cannot be repaired at all.** Bison exposes `/resume`, `/pause`, `/archive` and
  `/duplicate`, but **no `/unarchive` and no `/restore`** (both 404, probed 2026-08-20), and
  `PATCH` is not allowed on the campaign itself. 19 of the 22. A human re-creates them.

Sixteen of those nineteen held **zero leads** — they were archived while empty, not exhausted by
sending. Whatever archives them is upstream of all of this and is not yet identified.

The portal is what carries the half that cannot be automated: once the daily job runs, an `OOO`
cell that is still not green means *the automation tried and could not*.

One deliberate trade, recorded in that workflow's manifest: resuming releases **everyone queued
inside the campaign at once** (150 contacts in UniTalk's `male` campaign that day). It runs
unattended by owner decision, on the evidence that the queue is fresh — oldest 18 days, and only
35 of 355 past the 14-day rule.

### Where the implementation actually is (as of 2026-08-19)

**This document is no longer describing a target.** It describes what runs.

The [Sheets → Supabase transition](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) for
this process is at **phase C**: `ooo_followups` is the only store, and the `OOO Leads` sheet is no
longer written. Production, 2026-08-19:

| status | episodes |
|---|---|
| `submitted` | 1000 |
| `skipped` | 729 |
| `pending` | 289 |
| `cancelled` | 14 |
| `failed` | 1 |

How it got here, because the order matters and none of it was a single cutover:

1. **2026-07-21/22 — phase A.** Branch S added, then its accessor bug fixed; `record_ooo_followup`
   starts landing rows. The direct `leads.qualification='OOO'` write named as a defect below was
   deleted, not kept.
2. **2026-08-15 — Wave 1.** The enrolment worker moved to Supabase. This is the moment the sheet
   stopped being authoritative: until then the sheet was the only thing that enrolled anyone and
   branch S was a read-only shadow; afterwards the sheet was a write-only record nothing acted on.
3. **2026-08-19 — phase C.** Branch L disabled. The six nodes stay in the graph as the rollback path.

**Phase B was skipped, deliberately.** Content parity was not merely unmeasured, it was
*unmeasurable*: each branch made its own gpt-5-mini call for the return date, and on the same reply
they disagreed. Reconciling them would have measured two models against each other, not two stores.
COVERAGE was used as the gate instead, and met — see `transition.cutover` in the workflow's
[manifest](../../../../automation/n8n/workflows/outreach/ooo-detect-and-log/manifest.yaml).

The standing check is therefore coverage, not parity: `ooo_followups` rows created must keep tracking
`[child-3]`'s successful executions. A widening gap means episodes are being lost, and that is the
only failure this cutover can produce.

Consequences that were listed here as open and are now resolved:

- ~~Invariants 4, 5, 6 and 8 are enforced nowhere~~ — they are enforced by the table and the RPCs; the
  sheet never had a unique index, a status or a skip reason, and it is no longer in the path.
- ~~`20260722z` cannot be applied~~ — applied; the legacy OOO lead columns are gone.
- ~~The sheet append is not idempotent~~ — moot: the sheet is not written. `record_ooo_followup`'s
  partial unique indexes carry the guarantee ([README defect 5](../../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects)
  records the won't-fix decision this supersedes).
- `daily_stats.ooo_count` and the episode table can still disagree, and that is expected, not a
  defect: `ooo_count` is a sequencer-reported daily counter written by `bison-daily-stats-process`,
  not derived from episodes (ADR-0015 §9).

Sequenced plan: [migration-backlog §1](../../n8n/migration-backlog.md#1-ooo-cutover).

## Failure handling

Target: a failure is a **record**, not a lost event — `failed` with `attempt_count`,
`last_attempt_at`, `last_error`, recoverable by `retry_ooo_followup`. (`attempt_count` and friends
record the **last** attempt only; there is no per-attempt audit table — deliberately, see ADR-0015.)

Today: no error branch anywhere in the OOO workflows, so a Bison/LLM/Sheets failure drops the event
with no trace beyond the n8n execution list.

## Security considerations

- OOO data is **internal-only**. Both tables use `private.can_manage_client` — stricter than the read
  side of `leads`, because an OOO contact is precisely someone who is *not* a CRM lead; exposing that
  population to the `client` role would reintroduce what ADR-0015 removed.
- Every RPC is `service_role`; no `authenticated` path into the episode lifecycle exists.
- `ooo_followups` still carries SELECT/UPDATE policies because `recover_skipped_ooo_followups` runs as
  the **caller** when the routing editor saves.
- Open issue: per-client Bison API keys are read from a Google Sheet cell rather than
  `client_sequencers.api_key`. See [security.md](../../n8n/security.md).

## Acceptance criteria

- [ ] An OOO reply with a parseable date → one `pending` episode, `date_source='reply_parsed'`.
- [ ] An OOO reply with no date → `expected_return_date IS NULL`, `scheduled_for = today + 2`, `date_source='fallback'`.
- [ ] A redelivered event → no second episode.
- [ ] A second absence after `submitted` → a second episode; the first is untouched.
- [ ] No routing → `skipped/routing_missing`; configuring routing then recovers it to `pending`.
- [ ] `auto_ooo_enabled=false` → `skipped/automation_disabled`.
- [ ] A positive reply → exactly one lead, and the active episode becomes `cancelled`.
- [ ] An NRR reply → no lead, no episode, `final_outcome` untouched.
- [ ] No path writes `leads.qualification IN ('OOO','NRR')`.
- [ ] `pnpm n8n:validate` passes with **no** `knownViolations` remaining for `ooo-detect-and-log`.

Invariant tests: [`supabase/tests/ooo-invariants.sql`](../../../../supabase/tests/ooo-invariants.sql).

## Related ADRs

[0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) (the model) ·
[0016](../../../adr/0016-repository-as-automation-source-of-truth.md) (why the workflow is the thing that is wrong) ·
[0013](../../../adr/0013-lead-crm-view-and-status-taxonomy.md) (the split status model this finished) ·
[0012](../../../adr/0012-multi-sequencer-model.md) (`client_sequencers`) ·
[0004](../../../adr/0004-lead-state-boundaries.md) (editable lead fields) ·
[0003](../../../adr/0003-client-campaign-visibility.md) (`ooo_followup` campaigns hidden from clients).
