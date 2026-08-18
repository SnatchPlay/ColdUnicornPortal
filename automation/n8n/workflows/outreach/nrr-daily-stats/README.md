# nrr-daily-stats

**Logical ID:** `nrr-daily-stats` · **Domain:** `outreach` · **Criticality:** low
**Remote (production):** `1hHbU2hYYcsktLUP` — `[child-2] TAG_ATTACHED · NRR · Daily stats`
**Business process:** [OOO follow-ups (and NRR)](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Phase:** A · **unreachable** — see the banner below ([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md))

> ## ⚠️ This workflow has never run, and by decision it never will
>
> **Status `deprecated` since 2026-08-15.** It is not broken — it is unreachable. `Bison Replies
> Classification` (`XdTMd1KJX0cRmF9u`) contains an IF node `Category Is Not NRR?` whose false branch
> goes to `Respond - Skipped`, so an NRR classification never reaches the tag-attach call. With no
> `TAG_ATTACHED` + `NRR` webhook, the HUB's `fire_child_2` gate can never be true.
>
> Proven twice: 0 executions in 16 days, and the 900 most recent HUB executions carry only
> `OOO` / `Interested` / `preMQL` tags. The header below said "dual-write, live since 2026-07-21";
> that was never true, and a workflow with zero executions has no dual-write to speak of.
>
> **The owner decided on 2026-08-15 not to revive the email NRR path.** The suppression stays. This
> directory is kept as the record of what the NRR contract was — reviving it later is a one-node
> change in the classifier — but nothing should count on it running. For the email channel, NRR is
> recorded in no store at all; all 103 `classification='NRR'` replies in Supabase are **Aimfox**,
> written by `aimfox-classification`, which does not route through the Bison HUB.
>
> Everything below this banner describes the design as built. Read it as history.
> Defect [C1](../../../../../docs/reference/n8n/defect-backlog.md#c1).

## Business purpose

A contact replies "I'm not the right person". NRR is an **outreach outcome**, not a CRM stage: it
creates no lead, no follow-up episode, and never sets `final_outcome` — a lost outcome is an explicit
human decision about a lead that already exists ([ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)).

## Input

Called by `[HUB] Bison Replies Dispatcher` (`xPzdtWQiY3lGtqI1`) on `TAG_ATTACHED` + `NRR`.
Reads `event.workspace_id` and `data.taggable_id`.

## Flow

```
When Called by HUB ─┬─▶ [L] find today's Daily Stats row ─▶ if exists → increment NRR
                    │                                     └ else    → insert today's row
                    └─▶ [S] client_sequencers → Bison GET lead → GET replies → pick newest
                          → upsert_sequencer_contact → upsert_reply (classification NRR)
```

## What each branch records

| | Branch L (Sheets) | Branch S (Supabase) |
|---|---|---|
| Records | a **count** — NRR + 1 for today | the **reply itself**, against a contact identity |
| Recomputable | no — only the running total survives | yes — `group by` over `replies` |
| Creates a lead | no | no |

Branch S needs its own Bison calls because branch L never fetches the reply — it only counts. There
is nothing to share.

## Idempotency — and why the branches will disagree

Branch L is **not** idempotent: the counter is incremented unconditionally, so a redelivered
`TAG_ATTACHED` double-counts. Branch S **is**, via `upsert_reply`'s UNIQUE on `replies.external_id`.

So the two disagree **exactly** when an event is redelivered. That is a useful divergence signal, not
noise: a gap between the sheet counter and `count(*) from replies where classification='NRR'` is
evidence of redelivery, and branch S holds the correct number.

Do not "fix" branch S to match branch L.

## Metrics boundary

`daily_stats.ooo_count` and the sheet's NRR counter are **sequencer-reported event counts**. They are
not derived from `replies`, not CRM figures, and must never be mixed with lead counts
([04-metrics-catalog](../../../../../docs/reference/functional/04-metrics-catalog.md), ADR-0015 §9).

## Failure handling

Every `[S]` node is `onError: continueRegularOutput`, so a Bison, Postgres or resolution failure
cannot stop the counter branch. Branch L has no error branch — pre-existing.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id nrr-daily-stats
```

```sql
-- branch S output; compare against the sheet's NRR counter for the same day
select date_trunc('day', received_at)::date as day, count(*)
from public.replies
where classification = 'NRR'
group by 1 order by 1 desc limit 14;
```

Do **not** `execute_workflow` against this on production: branch L mutates the live Daily Stats sheet.
