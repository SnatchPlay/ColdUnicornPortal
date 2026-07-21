# OOO · phase A design

Implementation plan for the first process through the
[dual-write transition](../../adr/0017-sheets-to-supabase-dual-write-transition.md).
Target contract: [ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md).
Process rule: [OOO follow-ups](../processes/outreach/ooo-followups.md).

**Current state: phase 0** — Sheets only. `ooo_followups` has 0 rows in production.

## Shape

Every workflow in the family gets two independent branches off its trigger. Branch **L** is exactly
what runs today, untouched. Branch **S** is a parallel re-implementation reading Postgres and mapping
its own fields. Phase C disconnects L.

```
trigger ─┬─▶ [L]  Sheets → map from sheet columns   → Bison API
         └─▶ [S]  RPC/SQL → map from Postgres columns → Bison API   (suppressed in A1)
```

## The four workflows

| Logical ID | Branch L (today) | Branch S (to add) |
|---|---|---|
| `ooo-detect-and-log` | CS PDCA → Bison GET → LLM → append `OOO Leads` | `upsert_sequencer_contact` → `upsert_reply` → `record_ooo_followup` |
| `ooo-enrol-followups` | read due rows → ARM routing → `attach-leads` | `claim_ooo_followup` → routing snapshot → `attach-leads` → `mark_ooo_submitted`/`failed` |
| `ooo-remove-on-tag-removed` | delete the `OOO Leads` row | `cancel_active_ooo_followup` |
| `nrr-daily-stats` | increment a Sheets counter | `upsert_reply` with `NRR` |

Only `ooo-enrol-followups` calls a **write** API, so it is the only one where A1 shadow matters. The
other three have no external side effect and can go straight to A2.

## Parity anchors

The two routing sources are structurally the same, which is what makes the comparison meaningful:

| | Sheets | Postgres |
|---|---|---|
| client | `WorkspaceID` / `bison workspace id` | `client_sequencers.external_workspace_id` |
| category | `gender` ∈ `male\|female\|general` | `client_ooo_routing.routing_key`, same three values |
| campaign | ARM `bison ooo campaign id` | `client_ooo_routing.campaign_id` → `campaigns.external_id` |
| due rule | `Formatted Expected Date == today − 2d` | `scheduled_for <= today` where `scheduled_for = expected_return_date + 2` |

The reconciliation compares the **resolved target**: `(bison lead id, bison campaign id)` per run.

## Two divergences found in branch L — do not copy them

### 1. The due-date filter is `==`, not `<=`

`ooo-enrol-followups` reads the sheet with an **exact equality** match:

```
Formatted Expected Date == Math.floor($now.minus(2,'days').startOf('day').toSeconds())
```

The schedule runs once a day at 09:00. So if a run is missed — n8n down, a Google API error, a
deploy — **that day's cohort is never enrolled again.** The rows stay in the sheet and no later run
will match them, because the target timestamp has moved on. There is no catch-up and no trace.

Postgres does not have this failure: `status='pending' AND scheduled_for <= today` re-selects anything
missed on the next run.

**This means branch S will legitimately enrol contacts branch L never did.** That is branch S being
correct, and it must not be "fixed" to match. The reconciliation has to classify it as an expected
difference rather than a defect, or the parity check will block on the new system being better than
the old one.

Equality on a spreadsheet-formatted epoch value is also fragile in its own right — timezone and cell
formatting both move it.

### 2. Cancellation is a delete, not a cancel

`ooo-remove-on-tag-removed` **deletes** the sheet row. `cancel_active_ooo_followup` **cancels and
keeps the episode**. These are not the same operation, and the difference is deliberate — ADR-0015
keeps history so a past absence stays explainable.

Consequence for reconciliation: a cancelled episode exists in Postgres and has no sheet counterpart.
Compare on **active** rows only, or every cancellation reads as a divergence.

## Preconditions for phase A

1. **Make the sheet append idempotent** (`ooo-detect-and-log`). It is unconditional today, so a
   redelivered event writes a duplicate row while Postgres deduplicates. Two stores with different
   duplicate behaviour diverge by construction. Append-or-update on `LeadID` + `ReplyID`.
2. **Resolve defect 9** — the two output branches of `ooo-detect-and-log` read the LLM node with
   incompatible shapes, so the extracted date may never have reached the sheet at all and every
   contact may have been scheduled at `now + 14d`. Check the sheet's `Expected Return Date` column
   for clustering before porting extraction logic into branch S.
3. **Remove the direct `leads` write.** Not part of dual-write — a second store does not license
   bypassing the RPC contract. It has never landed a row, so removal is free.
4. **Move per-client Bison API keys** from CS PDCA to `client_sequencers.api_key`. Branch S needs a
   key that does not come from a spreadsheet; this is also
   [security finding 1](security.md#1-per-client-bison-api-keys-live-in-a-google-sheet--high).
5. **Seed `client_ooo_routing`** from the ARM sheet, and confirm the campaigns exist in `campaigns`
   with the right `external_id`. Without this every episode resolves to `skipped/routing_missing` and
   branch S enrols nobody — which would look like agreement.

Precondition 5 is the one most likely to produce a **false pass**: two branches that both do nothing
agree perfectly.

## Exit criteria

**A1 → A2:** over a defined window, every run's `(lead id, campaign id)` set from branch S equals
branch L's, except differences explained by divergence 1. Recorded in
`manifest.transition.parityEvidence`.

**A2 → B:** branch S has driven the process for a full cycle with no episode stuck in `failed`, and
`ooo_followups` status counts reconcile against sheet rows. Authority flips to Supabase.

**B → C:** the sheet has no readers left — including dashboards and reports outside this repository.
Then disconnect branch L.

## Blocked on

Building this needs `create_workflow_from_code` / `update_workflow`, and the only reachable n8n
instance is **production** ([environments.md](environments.md)). Either a development instance, or an
explicit per-workflow approval to modify production. The repository-side artifacts can be authored
and validated (`validate_workflow` is read-only) before either exists.
