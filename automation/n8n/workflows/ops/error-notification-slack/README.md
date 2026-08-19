# `error-notification-slack` — Error Notification

Remote: `4jIUZMYNgKtb9fmi` (production). Adopted 2026-08-18.

Two nodes: an `Error Trigger` and a Slack message to **#coldunicorn-errors**.

## Why it is separate from the recorder

There are two error workflows in this estate and they do different jobs:

| | `automation-failure-recorder` (`Pmz0JjRRuJNdNpSE`) | this one (`4jIUZMYNgKtb9fmi`) |
|---|---|---|
| what it does | writes the failure into `integration_sync_runs` | posts it to Slack |
| survives | forever, and is queryable in SQL | until someone scrolls past it |
| answers | "how often has this been failing?" | "something is broken right now" |

**n8n allows exactly one `errorWorkflow` per workflow** — `settings.errorWorkflow` is a single id, not
a list. So a workflow cannot both record and notify by binding both, and the choice is not "which is
better" but "which single one".

Resolution: the **recorder stays bound** on all 21 workflows that have a binding, and the Slack step
moves into it. Nothing gets rebound, the durable record is kept, and the alerting starts for every
bound workflow at once. This workflow remains as the standalone notifier — useful on its own, and the
shape to fall back to if the merged version ever needs unpicking.

## What it sends

Read from the Error Trigger payload
(`{ workflow: {id,name}, execution: {id,url,lastNodeExecuted,error{message,stack}} }`):

```
🔴 *<workflow name>* failed
*Node:* <last node executed>
*Error:* <error message, truncated to 800 chars>
*Execution:* <execution url>
```

`includeLinkToWorkflow` is off on purpose: n8n's own link points at the *workflow*, while the
execution URL in the body points at the *failed run*, which is what anyone reading the alert wants.

## What it was before

A stub. `messageType: "block"` with no blocks configured and the literal text **`Test`** — so had it
ever been bound to anything, the alert would have said nothing useful. Fixed on adoption.

## MCP access

`availableInMCP` was **false**, which is worth recording because it is a trap rather than a setting:
it hides a workflow from every MCP-backed script in this repository — `n8n:inventory`,
`n8n:check-drift`, `n8n:export` — so the workflow could not be exported, therefore had no artifact,
therefore `n8n:deploy` could not target it to turn the flag on.

`n8n:export` now falls back to the REST API when MCP refuses (REST has no such gate and already backs
the deploy path). Turned on in the same change; `filterSettings` also forces `availableInMCP: true`
on every PUT, so it cannot be lost by a later deploy.

## Failure modes

- **Slack down or channel renamed** — the alert is lost with no trace beyond this workflow's own
  execution list. The durable record is `integration_sync_runs`, written by the recorder, not here.
- **This workflow itself fails** — nothing catches it. Binding it to itself would loop; the recorder
  has the same property. If alerting goes quiet, that silence is indistinguishable from "nothing is
  failing", which is exactly the failure mode the recorder's row count answers and Slack does not.

## Manual verification

1. `pnpm n8n:check-drift --id error-notification-slack` — 0 drifted.
2. Cause a deliberate failure in a bound workflow and confirm one message lands in
   `#coldunicorn-errors` naming that workflow and its failing node.
3. `select count(*) from integration_sync_runs where sync_type = 'workflow_failure'` — the row still
   appears, i.e. the merge did not trade recording for alerting.
