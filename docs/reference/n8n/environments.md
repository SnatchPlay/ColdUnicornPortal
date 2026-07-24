# n8n environments

## Current state — read this before touching anything

| Environment | Exists? | Reachable via MCP? | Writable? |
|---|---|---|---|
| development | **no** | — | — |
| staging | no | — | — |
| production | yes | yes | **no, by policy** |

There is **one** n8n instance and it is production. The token in `.env.local` carries the full scope
set — `workflow:create`, `workflow:update`, `workflow:delete`, `workflow:publish`,
`workflow:execute`. Nothing on the n8n side restricts it.

**Therefore: all tooling is read-only, and every write is a human decision.**

## The rule

> When the only reachable instance is production, work read-only until the user explicitly authorises
> a specific write operation on a specific workflow.

Explicitly forbidden without a per-operation instruction from the user:

- creating, updating or archiving a production workflow
- publishing / unpublishing (activating / deactivating)
- deleting anything
- changing credentials
- **executing a workflow** — these have real side effects: `ooo-detect-and-log` appends to a live
  Google Sheet and calls the Bison API for a real contact
- re-running a historical execution
- changing a production webhook URL

## How this is enforced

`scripts/n8n/lib/mcp.mjs` splits the MCP tool surface in two:

- `callTool()` **throws** if asked for any of the six write tools.
- `callWriteTool()` **refuses** unless `N8N_ENV=development`.

No tracked script calls `callWriteTool()` today. The guard exists so that when a development
instance appears, the safe default is already in place rather than being retrofitted.

**One write path exists: `pnpm n8n:deploy`** (`scripts/n8n/deploy.mjs`, over the REST API in
`scripts/n8n/lib/rest.mjs`, using `N8N_REST_API_KEY`). It applies a surgical, artifact-sourced change
to a managed workflow — see [workflow-lifecycle.md](workflow-lifecycle.md). It is dry-run by default
and its `--apply` refuses unless `N8N_APPROVED_PRODUCTION_WRITE` is set for that one invocation, so a
production write is still an explicit per-operation human decision, never ambient.

`pnpm n8n:smoke` prints a warning whenever a write-capable token is aimed at a non-development
instance. Expected today; do not silence it.

**This is a policy guard, not a security boundary.** The token is unrestricted, so anyone — or any
agent — can bypass the scripts by calling the MCP directly. The real control is the rule above.

## Getting a development instance

The single highest-value change to this setup. Until it exists, no workflow can be built or tested
without touching production, which means the lifecycle in
[workflow-lifecycle.md](workflow-lifecycle.md) cannot be run end to end.

Once one exists:

1. Point `N8N_MCP_URL` at it and set `N8N_ENV=development` in `.env.local`.
2. Set `environments.development.available: true` in
   [`registry.yaml`](../../../automation/n8n/registry.yaml).
3. Record each workflow's development `remoteWorkflowId` as it is created.
4. Issue a **separate, scope-reduced** API key for production — ideally read-only — so the
   destructive scopes are not sitting in a developer's `.env.local` at all.

## Per-environment identity

A workflow's identity is its **logical ID**. Remote IDs are per-environment and live in the registry:

```yaml
environments:
  development:
    remoteWorkflowId: null
  production:
    remoteWorkflowId: O4DqMEu1Z9LcxikE
```

`pnpm n8n:inventory` and `pnpm n8n:check-drift` resolve against `N8N_ENV`, so pointing the token at a
different instance changes which side is compared — without editing any artifact.
