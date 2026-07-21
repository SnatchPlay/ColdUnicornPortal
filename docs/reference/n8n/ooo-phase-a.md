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

## Configuration state in production (measured 2026-07-21)

Branch S needs configuration that branch L keeps in spreadsheets. Some of it already exists in
Postgres; the routing chain does not exist at all.

| What branch S needs | Production | Verdict |
|---|---|---|
| Bison API key per workspace | `client_sequencers`: **35 enabled**, all with a plausible key (50–51 chars) and a numeric `external_workspace_id` | ✅ **ready** |
| `clients.auto_ooo_enabled` | `false` on **all 53** clients | ⛔ blocker |
| `client_ooo_routing` rows | **0 rows** | ⛔ blocker |
| Campaigns to route to | all 48 ARM campaigns **exist** — but typed `outreach` (21) / `nurture` (27), **0 `ooo_followup`** | ⚠️ misclassified, not missing |

Two consequences worth stating plainly.

**The credential problem is already solved in the data.** All 35 enabled sequencer rows carry a real
API key and workspace id, so branch S can authenticate from Postgres today. The workflows simply do
not read it. [Security finding 1](security.md#1-per-client-bison-api-keys-live-in-a-google-sheet--high)
is therefore about deleting the sheet lookup, not about a migration — much smaller than it looked.

**The campaigns are misclassified, not missing.** All 48 ARM campaign ids resolve to real
`campaigns` rows — they were ingested all along, just never typed `ooo_followup`. So this is a
one-line reclassification, not an ingestion project.

**And that misclassification is a live defect.** Clients see exactly `campaigns.type='outreach'`
(RLS `campaigns_select_scoped` + `scopeCampaigns`, ADR-0003). **25** campaigns named
`OOO automation | male|female|general` are typed `outreach`, so **9 clients can currently see their
own OOO follow-up campaigns in the portal**, and those campaigns' `campaign_daily_stats` — 3645 rows,
2026-01-22 → 2026-07-19, 121 sent / 20 replies — are counted in client-facing campaign metrics.
ADR-0015 and [11-integrations §5](../functional/11-integrations.md#5-ooo-routing) both say these must
be `ooo_followup` and invisible to clients.

Fixed by [`20260722g_ooo_campaigns_and_routing_seed.sql`](../../../supabase/migrations/20260722g_ooo_campaigns_and_routing_seed.sql),
which also seeds the routing. Dry-run against production inside a rolled-back transaction:
**52 `ooo_followup` campaigns · 0 still client-visible · 42 active routing rules · 14 clients.**

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
4. **Read the Bison API key from `client_sequencers`, not from CS PDCA.** The data is already there
   (35/35). This is deleting a sheet lookup in branch S, not a credential migration.
5. **Build the routing chain.** Migration `20260722g` does the first two parts; the third is a
   deliberate separate decision:
   1. ✅ **Reclassify** the 52 OOO campaigns to `type='ooo_followup'` — also closes the
      client-visibility defect above.
   2. ✅ **Seed `client_ooo_routing`** from ARM: `(bison workspace id, gender)` →
      `(client_id, routing_key, campaign_id)`. The `routing_key` CHECK is exactly
      `male | female | general`, matching the sheet's values verbatim.
   3. ⛔ **Set `clients.auto_ooo_enabled`** — `false` on all 53 today, so every episode would be
      recorded `skipped/automation_disabled` regardless of routing. Deliberately **not** in the
      migration: this flag gates what `record_ooo_followup` records, so flipping it is part of the
      phase A cutover with its own decision, not a side effect of seeding. No workflow graph reads
      it today, so enabling it has no effect on branch L.

   **Six of the 48 ARM rows cannot be seeded**: workspaces `75` and `130` have no enabled
   `client_sequencers` row, so their client is unknown. The migration reports them rather than
   inventing a placeholder parent. Those two workspaces will silently have no OOO routing in branch S
   until someone maps them — worth resolving before reading any parity number.

Precondition 5 governs whether phase A can produce a **meaningful** comparison at all. Skip any part
of it and branch S enrols nobody: every episode lands as `skipped/routing_missing` or
`skipped/automation_disabled`. That is not a silent failure — ADR-0015 made those states visible on
purpose — but it does mean an A1 shadow run would compare a full branch L against an empty branch S
and tell you nothing about the mapping.

Step 5.1 is the real unit of work here and is currently owned by nobody: no workflow ingests
`ooo_followup` campaigns, and `11-integrations` §2 documents campaign ingestion as creating
`outreach` campaigns only.

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
