# automation-failure-recorder

**Logical ID:** `automation-failure-recorder` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** `Pmz0JjRRuJNdNpSE` — `[ERR] Automation failure recorder`
**Built:** 2026-07-22

> The cheapest workflow in this repository, and the one that would have caught the two worst things
> found on the day it was written.

## Why it exists

On 2026-07-22 two separate classes of silent failure surfaced within an hour of each other:

- three Bison ingestion workflows had been **failing every run for days** — `daily_stats` was stale
  since 2026-07-20, `campaign_daily_stats` since 2026-07-19, and nothing said so
  ([process · Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md));
- a 31-node Supabase branch in `[child-1]` had **never been wired to its trigger**, so it had never
  run once.

Neither produced any signal outside the n8n execution list, which nobody reads until something looks
wrong. A failing workflow should become a row.

## Flow

```
Error Trigger ─ Normalize Failure ─┬─ Record Failed Run   (UPSERT integration_sync_runs,
                (derive provider    │                      keyed on n8n_execution_id)
                 from workflow name)│
                                    └─ Notify Slack       (#coldunicorn-errors)
```

**Both limbs hang off `Normalize Failure`, not off each other**, and both carry
`onError: continueRegularOutput`. That is deliberate and it is the whole design:

- the alert must not depend on the database write succeeding;
- the row must not depend on Slack being up.

Under `executionOrder: v1` the lower Y runs first, so `Record Failed Run` goes before `Notify Slack`:
the durable record is the thing that cannot be recreated later, so it goes first.

The trade, stated plainly: with `onError` on both, **this workflow's own failures now report success**.
A broken Postgres credential here would stop rows appearing and nothing would say so. The signal to
watch is therefore the row count, not the execution list —
`select count(*) from integration_sync_runs where sync_type = 'workflow_failure'` should keep pace
with `pnpm n8n:health`.

## Why the Slack step lives here and not in `error-notification-slack`

There is a second error workflow, [`error-notification-slack`](../error-notification-slack/README.md)
(`4jIUZMYNgKtb9fmi`), whose whole job is the Slack message. It is not bound to anything.

**n8n allows exactly one `errorWorkflow` per workflow** — `settings.errorWorkflow` is a single id, not
a list. Binding the notifier would have meant unbinding the recorder on all 21 workflows that point
here, trading a durable, queryable record for a message that scrolls away. Moving the Slack node in
instead cost one deploy, changed no binding, and turned alerting on for every bound workflow at once.

`error-notification-slack` stays as the standalone notifier and the rollback shape.

## What it records

| Column | Value |
|---|---|
| `provider` | derived from the workflow name — `aimfox` / `winnr` / `bison` / `n8n` |
| `sync_type` | `workflow_failure` |
| `n8n_execution_id` | the failed execution, and the UNIQUE key |
| `status` | `failed` |
| `error_message` | truncated to 4000 chars |
| `metadata` | `workflow_id`, `workflow_name`, `last_node`, `error_stack` |

`provider` is derived rather than hardcoded on purpose. The pre-existing `Winnr Sync - Error Handler`
(`oF6fP3ea2zglhAop`) writes `provider='winnr'`, `sync_type='daily'` literally, so binding *that* one
everywhere would have mislabelled every failure in the instance.

## Bound to

Every managed workflow, via `settings.errorWorkflow` (13 as of 2026-07-22): the four Bison ingestion
workflows, all five Aimfox workflows, and the four OOO/NRR workflows.

```bash
# what is bound
node -e "…"   # or check settings.errorWorkflow in the n8n UI
```

## Verification

Proved end to end rather than asserted: a throwaway workflow was made to throw, and the handler
recorded the failure with the workflow name, the failing node and the message. The synthetic row was
deleted afterwards.

```sql
select started_at, provider, n8n_execution_id,
       metadata->>'workflow_name' as workflow,
       metadata->>'last_node'     as node,
       error_message
from public.integration_sync_runs
where sync_type = 'workflow_failure'
order by started_at desc;
```

**Watch this query.** An empty result means either everything is healthy or nothing is bound — those
look identical, which is the one weakness of this design.

## Known limits

| # | Limit | Consequence |
|---|---|---|
| 1 | it fires on **workflow** failure, not node failure | a node with `onError: continueRegularOutput` — which most of the ingestion HTTP nodes use — fails silently and this never sees it |
| 2 | no alert, only a row | somebody still has to look. A digest query on a schedule would close that |
| 3 | a branch that is never *reached* produces no error | exactly the child-1 case. Absence of failures is not evidence of success |

Limit 1 is the important one: it makes this a floor, not a ceiling. The silent-zero defect in
`bison-campaign-daily-stats` still needs fixing at the node.

## Never

Do not `execute_workflow` this directly — it expects an error-trigger payload and would write a
meaningless row.
