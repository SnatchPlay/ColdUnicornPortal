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
When Called by HUB ─┬─▶ [L] CS PDCA → Bison GET lead → find row in OOO Leads → DELETE row
                    └─▶ [S] cancel_active_ooo_followup
```

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

`[S]` is `onError: continueRegularOutput`, so a Postgres failure cannot break the sheet path the
business still relies on. Branch L has no error branch — a Google API failure loses the removal
silently, which is pre-existing behaviour, not something phase A introduces.

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
