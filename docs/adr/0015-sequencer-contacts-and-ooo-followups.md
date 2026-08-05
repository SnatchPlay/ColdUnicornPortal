# ADR 0015: Sequencer contacts and OOO follow-ups as first-class entities

## Status
Accepted 2026-07-22

## Context

OOO ("out of office") and NRR ("not right role") lived **inside `leads`**. n8n created a `leads` row
for any contact that replied, and the temporary-absence state was stored as
`leads.qualification = 'OOO'`, `leads.expected_return_date` and `leads.added_to_ooo_campaign`.

That violated the product's core rule: **a CRM lead exists only after a positive reply.** The
consequences were concrete, not theoretical:

- OOO/NRR contacts inflated the CRM lead count and distorted preMQL→MQL conversion;
- OOO history was destroyed on every repeat — one date column cannot hold two episodes;
- an external contact had no identity of its own, so a reply that arrived before the lead mapping
  resolved had nowhere to attach;
- there was nowhere to record that a follow-up had failed, been skipped for missing configuration,
  or been cancelled — the lead columns had room for one state, not a lifecycle;
- `client_ooo_routing` used `gender = NULL` as an implicit "general" rule, so "no routing configured"
  and "routing for everyone" were the same value.

[ADR-0013](0013-lead-crm-view-and-status-taxonomy.md) already took the first step by splitting
`contact_disposition` out of `qualification` so an OOO event stopped overwriting the funnel stage.
That fixed the clobbering but kept OOO on the lead. This ADR finishes the separation.

## Decision

### 1. Two new entities: `sequencer_contacts` and `ooo_followups`

`sequencer_contacts` is the local identity of an external contact. Its natural key is **scoped** —
`(client_sequencer_id, external_contact_id)` — because an external contact id is meaningless without
the workspace it came from. It holds no CRM state: no stage, no qualification, no outcome.

`ooo_followups` is one OOO **episode**: a contact is temporarily away and should re-enter outreach on
a given date. It is an operational record, not a lead field, so repeat absences accumulate as history
instead of overwriting one another.

### 2. `expected_return_date` and `scheduled_for` are different columns

`expected_return_date` is the date actually determined from the reply, and stays **NULL** when none
could be determined. `scheduled_for` is when to re-enrol, and may come from a fallback rule
(today + 2 days). Collapsing them would mean writing a guess into a field that is read as a fact.
`date_source` records which of `reply_parsed | fallback | manual` produced them.

### 3. Two different unique invariants, both partial indexes

Conflating these is the subtle bug this model is designed to avoid:

- `uq_ooo_followups_active` — at most **one ACTIVE** episode per contact, where active is
  `pending | processing | failed`. `submitted`/`confirmed` are deliberately **not** active:
  `submitted` closes the current episode, so a new OOO reply months later may open the next one.
- `uq_ooo_followups_source_reply` — one episode per **source reply**. This is what stops a
  redelivered ingestion event from opening a duplicate once the previous episode is `submitted` and
  the active index no longer covers it.

The same split applies to `leads`:

- `uq_leads_origin_reply` — reprocessing one positive reply never creates two leads;
- `uq_leads_source_sequencer_contact` — **one contact yields at most one CRM lead**. A later positive
  reply from the same person attaches to the existing lead. If independent sales cycles per person
  are ever needed, that is a new `opportunities` entity, not a duplicated lead.

### 4. `submitted` means the API accepted the request — not that the contact is enrolled

The sequencer's batch endpoint can silently ignore a contact that is already in the campaign, so a
2xx proves only that the request was accepted. `submitted` therefore means "sent to sequencer", not
"added to campaign". `confirmed` means membership was verified by a separate reconciliation call, and
is **optional**: if the vendor API offers no such check, the transition is simply never used and
`submitted` is terminal success. Naming it "confirmed" regardless would record a certainty the system
does not have.

### 5. Invariants live in the database, reachable through RPCs — not in n8n

Every guarantee above is an invariant. If n8n writes raw SQL, those invariants live in a workflow
that can be edited without review. So ingestion goes through `SECURITY DEFINER` functions
(`upsert_sequencer_contact`, `upsert_reply`, `record_ooo_followup`, `promote_contact_to_lead`, the
worker transitions), all `service_role`-only, all `set search_path = ''` with fully qualified names.

`promote_contact_to_lead` takes a **strict whitelist** payload. `client_id`, `sequencer_id`,
`external_id` and every CRM flag are derived inside the function, never accepted from the caller, so
ingestion cannot create a lead in another client or pre-set `won`. A repeated webhook returns
`{lead_id, created: false}` rather than raising — retries are normal, not errors.

`qualification` is the one exception, and it is deliberate: it comes from the caller, validated
against `MQL | preMQL`, because only the sequencer knows which tag the lead now carries. Since
[20260805](../../supabase/migrations/20260805_promote_contact_lead_two_way_qualification.sql) a
repeat call syncs it **both ways** rather than promoting only. Upgrade-only left the client sheet —
which rewrites the column on every tag event, in both directions — permanently ahead of this table
on 102 leads across 15 clients. Two guards keep that safe: the caller must send the label derived
from the lead's whole tag set rather than from the event that fired, and the sync moves a lead only
between `MQL` and `preMQL`, so a stage that has advanced to `meeting_scheduled`, `won` or `rejected`
is never touched by an inbound tag.
→ [reconciliation](../reference/processes/outreach/sheets-supabase-reconciliation.md#qualification-2026-08-05)

### 6. The state machine has one definition and no portal door

Transitions are separate functions (`claim` / `mark_ooo_submitted` / `mark_ooo_confirmed` /
`mark_ooo_failed` / `skip` / `cancel` / `retry` / `reopen`), each an atomic conditional UPDATE whose
`WHERE status IN (…)` is the guard. A generic `mark(id, status)` was rejected: it puts
`pending → confirmed` one typo away.

All of them are `service_role` only. The portal has **no** action that reads or mutates a follow-up:
an operational view was built and then removed before release (see Consequences), because OOO is
driven end-to-end by n8n and no operator works the queue by hand. That keeps the privilege model
trivial — there is no `authenticated` path into the episode lifecycle to secure.

`ooo_followups` still carries SELECT and UPDATE policies, because
`recover_skipped_ooo_followups` runs as the **caller** when the routing editor saves a rule.

### 7. Routing is explicit, and each episode keeps a snapshot

`client_ooo_routing.routing_key` is `male | female | general` — `NULL` is never an implicit
"general". Resolution is specific key → `general` → **NULL**, and NULL surfaces as
`skipped / routing_missing` rather than a silent drop. A partial unique index allows at most one
**active** configuration per `(client, routing_key)`; superseded rows are deactivated, never deleted,
so a past episode stays explainable by the configuration that produced it.

Each follow-up stores its own `routing_key` + `target_campaign_id` + `routing_source`. Configuration
changes later must not rewrite history, so the snapshot is frozen once the episode leaves an active
status. While active, changing the routing category re-resolves the campaign
(`routing_source = 'automatic'`) and pinning a campaign sets `manual_override` — two operations, so
the pair can never contradict itself.

When configuration is fixed, `recover_skipped_ooo_followups` brings `routing_missing` and
`automation_disabled` episodes back to `pending`. `contact_ineligible` is a judgement about a person
and requires an explicit reopen.

### 8. OOO data is internal-only

Both tables use `private.can_manage_client` — including `sequencer_contacts`, which is stricter than
the read side of `leads`. An OOO/NRR contact is precisely someone who is **not** a CRM lead, so
exposing that population to the `client` role would reintroduce through the side door exactly what
this ADR removes from the leads table. The UPDATE policy carries both `using` and `with check`.

### 9. Outreach and CRM metrics never mix

`daily_stats.ooo_count` is kept, but is explicitly a **sequencer-reported daily event count** — not a
CRM figure, not derived from `leads.qualification`, and not the same quantity as "active follow-ups".
No portal metric mixes the two (spec §14). Everything about OOO remains recomputable by `GROUP BY`
over raw `replies` / `ooo_followups` rows, so §16 holds even though nothing renders it today.

## Alternatives considered

- **Keep OOO on `leads` and filter it out at read time.** Rejected: it cannot express repeat
  episodes, has nowhere to record attempts or failures, and leaves the lead count wrong at the source.
- **A second reply-classification enum matching the spec's domain names.** Rejected — the existing
  labels are the live n8n contract and the value on every historical row; a parallel taxonomy would be
  two sources of truth. The enum was extended (`negative`, `neutral`) and the mapping documented once.
- **A per-attempt `ooo_followup_attempts` table.** Deferred — §13 does not need it. `attempt_count` /
  `last_attempt_at` / `last_error` record the **last** attempt only, and the documentation says so
  rather than implying a full audit trail.
- **`leads.source_sequencer_contact_id` projected into `LeadRecord`.** Rejected — no portal surface
  reads it, and the OOO view resolves the linked lead from the contact side.

## Consequences

- **Declared exception: placeholder replies for historical sheet rows (2026-08-05).** "A lead is
  created by a positive reply" has no answer for a lead that already exists in a client's `Leads`
  tab and predates this ADR — there is no reply to attach, and the reconciliation left 10 such rows
  unresolved for weeks rather than invent one. The decision taken was to **synthesise a placeholder**
  `sequencer_contacts` + `replies` pair per row, create the lead through `promote_contact_to_lead`
  as normal, and pull the real message from the sequencer later.

  The invariant itself is unchanged: the lead still comes from a reply, through the RPC, one per
  contact. What is relaxed is the claim that the reply was *ingested*. That is why every synthetic
  record is marked rather than blended in — `sequencer_contacts.external_contact_id` and
  `replies.external_id` both carry a `sheet-import:` prefix, and the reply body says in plain words
  what it is, so a single predicate finds all of them:

  ```sql
  select * from public.replies where external_id like 'sheet-import:%';
  ```

  The prefix is deterministic (e-mail, or a slug of name and company), so the RPCs' upsert semantics
  make a re-run a no-op instead of a second lead. Written by
  [`import-sheet-only-leads`](../../scripts/sheets/import-sheet-only-leads.mjs); scope and the
  channel-inference caveat are in
  [the reconciliation](../reference/processes/outreach/sheets-supabase-reconciliation.md).
  **These rows are not evidence of anything until the real replies land** — no analysis of reply
  timing, classification or content may include them.

- **The spec's §13 operational view and §15 outreach dashboard were built, verified and then removed
  before release (2026-07-22).** OOO is driven end-to-end by n8n and the agency does not work the
  episode queue by hand, so the screens had no operator. The data model is unchanged and records
  everything §13 asked for, so a view can be added later without a migration — it is a UI decision,
  not a data one. Recorded as [OoS-16](../reference/functional/13-out-of-scope.md). The portal's only
  OOO surface is the per-client routing editor in the client drawer (BL-2).

- **`replies.external_id` gained the UNIQUE it was already documented to have.**
  [11-integrations.md §7](../reference/functional/11-integrations.md) claimed ingestion idempotency
  rested on it; the constraint did not exist (verified against a production dump). `upsert_reply`
  cannot be planned without it. `20260722c` adds it and **aborts** if duplicates exist — resolving
  them is a data decision, not something a migration should guess.
- **The destructive follow-up is not in `supabase/migrations/`.** The migration runner applies every
  unapplied `.sql` file with no opt-out, so a "⚠️ do not apply yet" header is documentation, not a
  guard (`20260704b` carried one and ran anyway). `20260722z` therefore lives in
  `supabase/migrations/deferred/`, which the runner cannot see. See that directory's README.
- **The backfill has two decisions a human must make before production** — placeholder
  `client_sequencers` rows, and leads that share a contact. Both are reported by the migration and by
  dry-run queries in its header. On the current production dump there were 0 placeholders and 29
  duplicate-contact leads.
- **n8n must cut over** to the RPCs before `20260722z` can run. Until then the legacy columns keep
  working and nothing breaks.
- Invariants are covered by [`supabase/tests/ooo-invariants.sql`](../../supabase/tests/ooo-invariants.sql)
  — a rollback-only suite asserting idempotency, the two unique invariants, every illegal transition,
  the promotion whitelist, RLS isolation, and the backfill classification rules.

## Related
- [ADR-0004](0004-lead-state-boundaries.md) — editable lead fields; `mapLeadPatch` whitelist.
- [ADR-0006](0006-set-based-rls-predicates.md) — the set-based predicate rule these policies follow.
- [ADR-0008](0008-orm-gateway-edge-function.md) — why RLS is the boundary and the gateway carries no
  second authorization layer.
- [ADR-0012](0012-multi-sequencer-model.md) — `client_sequencers`, the parent of the scoped identity.
- [ADR-0013](0013-lead-crm-view-and-status-taxonomy.md) — the split status model; §4 of that ADR is
  superseded in one respect: `contact_disposition` no longer belongs on `leads`.
- Source spec: "Бізнес-логіка роботи з Out of Office контактами" (2026-07-21), §§1–19.
