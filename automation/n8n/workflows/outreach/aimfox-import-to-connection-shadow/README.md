# aimfox-import-to-connection-shadow

**Logical ID:** `aimfox-import-to-connection-shadow` · **Domain:** `outreach` · **Criticality:** low
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **C — Supabase only**, since 2026-08-10. This replaced
[`aimfox-import-to-connection`](../aimfox-import-to-connection/README.md), which was deactivated the
same day. It ran as a send-nothing shadow for one day first.

> One node queues real LinkedIn connection requests. Only the **Schedule** trigger can reach it: a
> webhook call is forced to a dry run no matter what its body says, and `Plan Imports` returns an
> empty array on a dry run, so the HTTP node has no items and n8n does not execute it. Not sending
> is a property of the graph, not a flag.

## Why it ran as a shadow first

Branch L's own manifest asked for this: *"build the request, log it, measure agreement, only then
send"*. Its stated reason was that a second branch would send a second set of invites to a real
person. **That reason no longer holds** — branch L was measured on 2026-08-09 importing leads for
**0 of 9** clients, because its filter requires a campaign named `AutoConnect` and no workspace had
one. There is nothing to double.

The reason that survives is different and better: nobody has ever seen how many invites this
selection produces. Every row in the plan is a LinkedIn connection request to a person, and the
backlog behind the day window is at least ~670 people — measured 2026-08-09 on the local mirror, which is stale to 2026-07-23 and knows only 3 of the 9 Aimfox clients, so production is more.

## Flow

```
Schedule 19:00 ┐
Webhook        ┼─ Input (window: yesterday UTC; only the schedule sets dry_run=false)
Start          ┘
        └─ Read Clients        current clients with an enabled aimfox connector AND a stored key
           └─ GET /campaigns   once per client, with THAT client's key
              └─ Resolve Campaigns   AutoConnect, ACTIVE, matched across the whole list → one item
                 └─ Read Leads       yesterday's leads with a LinkedIn URL, not yet invited
                    └─ Build Plan       report (recorded) + queue (carries the key, never recorded)
                       └─ Has Imports? ─ yes → Plan Imports → Add To Audience → Collect Imports ─┐
                                        └ no ──────────────────────────────────────────────────┴→ Merge Outcome
                                           └─ Mark Invited   public.mark_linkedin_invited(uuid[])
                                              └─ Record Run  integration_sync_runs
                                                 └─ Final Result
```

`leads` is RPC-owned (ADR-0015) and `pnpm n8n:validate` refuses a raw `UPDATE` on it. The first
draft did exactly that and was caught; `mark_linkedin_invited` (migration `20260810`) is the RPC
that was missing, and it is idempotent — an already-stamped lead keeps its first timestamp.

## Measured on production before the cutover

Through the read-only webhook, 2026-08-10: 7 clients hold an Aimfox key, **2 resolve**, 5 are
blocked with `no AutoConnect campaign`. Volume on the same predicate — **0** for the previous day,
**5** over 7 days, **36** over 30, **178** over 120 (ColdUnicorn PL and Audytel). Small enough that
switching over could not produce a burst, which is the thing a shadow is for.

## What it fixes, and what it cannot

Four of branch L's seven documented defects are gone by construction:

| branch L defect | here |
|---|---|
| 3 — yesterday matched as the **string** `M/d/yyyy` against a sheet cell | a real `timestamptz` range, computed once in `Input` and used by every query and the audit row |
| 5 — no local dedup; every run re-POSTs the batch | `linkedin_invitation_sent_at is null` in the predicate. The column exists and **nothing writes it today**, so branch S can own it when the send limb lands |
| 6 — no retry, no error branch, nothing recorded | one `integration_sync_runs` row per run, always. A nightly job that imported for nobody for months went unnoticed precisely because nothing was recorded |
| 7 — the Aimfox token comes from a spreadsheet cell | `client_sequencers.api_key`, the same row provisioning maintains |

Defect 1 — reading `campaigns[0]` instead of searching the list — is fixed here too, and is **still
open on branch L**.

Defects 2 and 4 are branch L's sheet-reading quirks and simply do not exist in a SQL predicate.

## The window is deliberately narrow

`Input` defaults to yesterday, UTC — the same intent as branch L's `$now.minus({days:1})`. Widening
it to "every lead with a LinkedIn URL not yet invited" is a **business decision, not a port**: on
that set is at least ~670 people — measured 2026-08-09 on the local mirror, which is stale to 2026-07-23 and knows only 3 of the 9 Aimfox clients, so production is more, and the flow
would send all of them at once. Whether to catch
up on the cohort branch L never sent, and at what rate, is open.

What 670 is **not** is a day's worth. On the same mirror it spreads across eight months —
17 / 143 / 90 / 89 / 135 / 53 / 59 / 84 from 2025-12 to 2026-07 — over three clients (Runmageddon
306, ColdUnicorn PL 238, Bent Iron PL 126). That is roughly three leads a day, accumulating since
December because nothing ever sent them. A day window selects the three; removing it selects the
eight months.

`Read Leads` accepts `since`/`until` overrides so a specific day can be measured without editing the
workflow.

## The key never reaches the audit row

`Read Clients` returns `api_key` because the vendor call needs it. `Build Plan` constructs the
recorded object explicitly — window, counts, blocked clients, a sample of at most 20 planned
profiles — and never spreads the client rows into it. Same rule as the provisioning workflows'
invariant 7.

## Reading the result

```sql
select started_at, status, metadata->>'would_send' as would_send,
       metadata->'per_client' as per_client, metadata->'blocked' as blocked
  from integration_sync_runs
 where sync_type = 'autoconnect_import_shadow'
 order by started_at desc;
```

`blocked` is the interesting column: a client with a key and leads but no ACTIVE `AutoConnect`
appears there with the reason, which is the same gap
[`aimfox-workspace-setup`](../../ops/aimfox-workspace-setup/README.md) now closes with its
`campaigns` step.

## Before the send limb is added

1. Read `would_send` across a few days and agree it is the right population.
2. Decide the backlog question above.
3. Then add: `Plan Imports` (empty array on a dry run, so the POST node cannot execute),
   `Add To Audience`, `Collect`, and `Mark Invited` writing `linkedin_invitation_sent_at`. The write
   limb needs a branch, not a straight line — a node with zero input items does not execute, and
   putting the POST inline would strand the run before `Record Run` on every quiet day.
