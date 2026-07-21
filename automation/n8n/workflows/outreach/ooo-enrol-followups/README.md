# ooo-enrol-followups

**Logical ID:** `ooo-enrol-followups` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `zaPkpSAuvjibUUDU` — `Add OOO Leads`
**Business process:** [OOO follow-ups](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Phase:** **A1 · shadow**, live since 2026-07-21 ([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md))

> The only OOO workflow that calls a **write** endpoint on Bison. Everything below follows from that.

## Business purpose

Daily at 09:00, re-enrol contacts whose absence is over into their client's OOO follow-up campaign.

## Flow

```
Schedule (09:00) ─┬─▶ [L] OOO Leads (due) → group → ARM routing → CS PDCA key
                  │       → build requests → POST /campaigns/{id}/leads/attach-leads
                  └─▶ [S] SHADOW · select due episodes → record intent (sends nothing)
```

## Why branch S is a shadow and not a second writer

Duplicating a write to our own store is cheap. Duplicating a **call to Bison acts on a real person.**

- Both branches resolving the **same** campaign is safe: `attach-leads` silently ignores a lead
  already in the campaign — the same property [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md) §4
  relies on for `submitted`.
- Both branches resolving **different** campaigns enrols one contact into **two** follow-up sequences
  and emails them twice.

The routing sources are different objects (`ARM` sheet vs `client_ooo_routing`) that merely *ought*
to agree. So agreement is **measured** before the POST is switched on. That is phase A1 → A2.

## What branch S does — and deliberately does not

Does: selects `ooo_followups` where `status='pending' and scheduled_for <= current_date`, resolves
each to `(workspace_id, bison_campaign_id, bison_lead_id, routing_key)`, and writes the whole
intended payload into `integration_sync_runs` (`provider='bison'`, `sync_type='ooo_enrol_shadow'`).

Does **not**:
- call Bison — there is exactly **one** `httpRequest` node in this workflow, and it belongs to branch L;
- call `claim_ooo_followup` — claiming moves `pending → processing`, and with no submit the episodes
  would be stranded in `processing` with nothing to move them on. **A1 is read-only by design**;
- call `mark_ooo_submitted` / `mark_ooo_failed` — those belong to A2, once the POST is real.

## Reconciliation (the A1 → A2 gate)

```sql
select started_at,
       metadata->>'due_count'      as due,
       metadata->>'unrouted_count' as unrouted,
       metadata->'intended_attach' as intent
from public.integration_sync_runs
where provider = 'bison' and sync_type = 'ooo_enrol_shadow'
order by started_at desc;
```

Compare the `(bison_lead_id, bison_campaign_id)` set against branch L's actual attach calls for the
same run. **Two expected differences that are not defects:**

1. **Workspaces `75` and `130`** have no `client_sequencers` row, so branch S has no routing for them
   and they surface as `unrouted_count`. Knowingly deferred — exclude them.
2. **Branch S will have rows branch L never enrolled.** Branch L's due filter is an exact equality on
   `today − 2d` against a once-daily schedule, so a missed run drops that cohort permanently. Branch S
   re-selects on `scheduled_for <= current_date` and catches up. That is branch S being **correct**.

Anything else is a real divergence and blocks A2.

`due_count` will read `0` until episodes accumulate — `ooo_followups` was empty when branch S in
`ooo-detect-and-log` went live, so the first non-zero shadow run needs a real OOO reply first.

## Known defects in branch L (not copied into S)

| # | Defect | Consequence |
|---|---|---|
| 1 | due filter is `==`, not `<=` | a missed run drops that day's cohort forever, with no trace |
| 2 | no retry, no error branch on `attach-leads` | a failed enrolment is lost; nothing records it |
| 3 | Bison API key comes from a spreadsheet cell | [security finding 1](../../../../../docs/reference/n8n/security.md) |
| 4 | no local dedup | re-running with a *different* resolved campaign double-enrols |

## What A2 will add

Replace the shadow node with the real worker: `claim_ooo_followup` → `attach-leads` (branch S's own
call, own key from `client_sequencers`) → `mark_ooo_submitted` / `mark_ooo_failed`. Then a failed
enrolment becomes a `failed` episode with `last_error` instead of vanishing — which is the point of
modelling it as a record.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id ooo-enrol-followups
```

**Never** `execute_workflow` against this on production: branch L attaches real contacts to real
campaigns, which sends email.
