# ooo-remove-on-tag-removed

**Logical ID:** `ooo-remove-on-tag-removed` · **Domain:** `outreach` · **Criticality:** medium
**Remote (production):** `ZZ0ughB302WdDJOf` — `[child-7] TAG_REMOVED · OOO · Remove from OOO Leads`
**Business process:** [OOO follow-ups](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Phase:** A · dual-write, live since 2026-07-21 ([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md))

## Business purpose

The OOO tag is removed in Bison — the contact is back, or the tag was applied by mistake. The
pending follow-up must not fire.

## Input

Called by `[HUB] Bison Replies Dispatcher` (`xPzdtWQiY3lGtqI1`) on `TAG_REMOVED` + `OOO`.
Reads `event.workspace_id` and `data.taggable_id`.

## Flow

```
When Called by HUB ───▶ [S] cancel_active_ooo_followup

                    ✂  [L] CS PDCA → Bison GET lead → find row in OOO Leads → DELETE row
                       (four nodes, still enabled, no longer reachable from the trigger)
```

> **Branch L is unplugged on live — found 2026-08-26, date of the change unknown.** The trigger edge
> `When Called by HUB → [86] Find workspace in CS PDCA` exists in no live graph; the four branch-L
> nodes sit in the canvas with `disabled: false` and nothing entering them. The artifact still
> carried that edge until 2026-08-26, so this ran as **undeclared drift** for an unknown period. It
> is the coherent follow-through of the sibling decision — `ooo-detect-and-log` branch L was disabled
> 2026-08-19 by the owner, so nothing writes `OOO Leads` any more and deleting from it is pointless —
> but that reasoning was never written down here, and unplugging is not how the sibling recorded it
> (there the six nodes are `disabled: true`).
>
> **Evidence:** not one of the 40 most recent executions sampled (2026-08-23 → 2026-08-26) reached
> `[86]`. The instance's execution retention is shorter than the change, and the n8n public API
> exposes no workflow version history, so the date cannot be recovered from here.
>
> **This leaves the manifest saying something untrue** — `phase: A`, `authoritativeSource: sheets`,
> while nothing writes the sheet. That is registered as a `knownViolations` entry rather than quietly
> corrected: choosing between *"this was a deliberate phase move, record its go-live evidence"* and
> *"the edge came out by accident, put it back"* is the owner's call, not a documentation edit.

## The two branches do different things on purpose

| | Branch L (Sheets) | Branch S (Supabase) |
|---|---|---|
| Effect | **deletes** the `OOO Leads` row | **cancels** the episode, row stays |
| History | gone | preserved — a past absence stays explainable |
| Repeat | no trace | `cancelled` episode remains, a later absence opens a new one |

This is a **semantic gap, not a mapping detail**. [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)
chose cancellation-with-history deliberately. Reconciliation must therefore compare **active** rows
only — otherwise every cancellation reads as a divergence.

## Why branch S makes no Bison call

Branch L needs `GET /leads/{taggable_id}` to find the sheet row. Branch S resolves the contact
directly from `client_sequencers` + `sequencer_contacts`, so the call would be pure cost. Branches
are independent, not ceremonially identical.

## Idempotency

`cancel_active_ooo_followup` returns `NULL` when nothing is active, so a redelivered `TAG_REMOVED`
is a no-op. Branch L is also effectively idempotent — deleting an absent row does nothing.

`skip_reason` is not used here: this is a cancellation (`ooo_tag_removed`), not a skip.

## Failure handling

`[S]` is `onError: continueRegularOutput`, so a Postgres failure cannot break the sheet path — which,
since branch L was unplugged, no longer exists downstream of it. The guard is now inert but harmless;
it becomes meaningful again the moment branch L is reconnected.

`[329] Delete row from OOO Leads` is `onError: continueRegularOutput` for the mirror reason, recorded
here because the annotation that carried it lived in the graph and did not survive the 2026-08-26
re-export: *"Branch-L terminal. onError so a Sheets failure cannot fail the run behind an
already-committed Supabase cancellation (E5 / Wave 3)."*

If the contact does not exist in `sequencer_contacts`, branch S returns **zero rows** and does
nothing. That is the correct outcome — there was no episode to cancel — but it is also
indistinguishable from a resolution bug, so check `sequencer_contacts` before concluding the
workflow is broken.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id ooo-remove-on-tag-removed
```

```sql
-- after an OOO tag removal, the episode should be cancelled, not gone
select status, count(*) from public.ooo_followups group by 1 order by 2 desc;
```

Do **not** `execute_workflow` against this on production: branch L deletes a live sheet row.
