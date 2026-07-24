# n8n MCP setup

Connects Claude Code (and `pnpm n8n:*`) to the n8n instance.

## Which MCP

The **official instance-level n8n MCP server**, served by n8n itself at `/mcp-server/http`.
Verified 2026-07-21: `n8n MCP Server 1.1.0`, protocol `2024-11-05`, 13 tools.

**Do not install a community or npm-wrapper n8n MCP package.** If the official server is unavailable
on a given instance (it needs a recent n8n), record that as a blocker — do not substitute a
third-party server without an explicit decision.

## Credentials

Two variables, both in **`.env.local`** (gitignored). Never in `.mcp.json`, never in `.env.example`,
never in a commit.

```bash
N8N_MCP_URL=https://<your-n8n-host>/mcp-server/http
N8N_MCP_API_KEY=<n8n API key>          # Settings → n8n API → Create an API key
N8N_ENV=production                      # development | staging | production
```

`N8N_ENV` describes what `N8N_MCP_URL` points at. It gates every write path in `scripts/n8n/`
(see [environments.md](environments.md)), so setting it wrongly is a safety problem, not a cosmetic one.

## Registering the server with Claude Code

Use **`--scope local`**. The server is then available in this project only, for this user, and the
credential is stored outside the repository.

- ❌ `--scope user` — leaks n8n tools into every other repository.
- ❌ `--scope project` — writes a shared `.mcp.json`, which is committed. Live credentials must never
  go there. (That file is why the checked-in `supabase` server uses `${SUPABASE_ACCESS_TOKEN}`
  interpolation rather than a literal.)

```bash
# Values come from .env.local; nothing secret is typed on the command line or stored in the repo.
set -a && . ./.env.local && set +a
claude mcp add --scope local --transport http n8n \
  "$N8N_MCP_URL" \
  --header "Authorization: Bearer $N8N_MCP_API_KEY"
```

Confirm the flag names against `claude mcp add --help` for your Claude Code version before running —
the transport/header syntax has changed between releases.

## Verification

```bash
claude mcp list                    # expect: n8n  ✔ Connected
claude mcp get n8n                 # scope must read "local"
pnpm n8n:smoke                     # read-only handshake + tool list + workflow count
```

`pnpm n8n:smoke` is the authoritative check because it exercises the same code path the scripts use.
Expected shape of a healthy run:

```
server      : n8n MCP Server 1.1.0
protocol    : 2024-11-05
N8N_ENV     : production
tools       : 13 (6 write-capable)
workflows   : 33 visible, 27 active
```

It prints a warning whenever a write-capable token is pointed at a non-development instance. That
warning is expected today and must not be silenced.

## Tools the server exposes

Read-only: `search_workflows`, `get_workflow_details`, `get_execution`, `search_nodes`,
`get_node_types`, `get_suggested_nodes`, `get_sdk_reference`, `validate_workflow`.

Write: `create_workflow_from_code`, `update_workflow`, `archive_workflow`, `publish_workflow`,
`unpublish_workflow`, `execute_workflow`. **All six are closed today** — see
[environments.md](environments.md).

Two properties worth knowing before designing anything around this server:

- **Workflows are authored from SDK code, not JSON.** `create_workflow_from_code` / `update_workflow`
  take TypeScript-ish SDK source; `validate_workflow` compiles it and returns the resulting JSON.
- **There is no decompiler.** Nothing turns an existing workflow back into SDK code. `get_workflow_details`
  returns the raw graph, which is why `workflow.json` — not SDK code — is the canonical artifact for
  imported workflows ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md), Alternatives).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Failed to connect` in `claude mcp list` | Env var not exported into the MCP process. The checked-in `supabase` server has this exact failure — `.mcp.json` interpolates `${SUPABASE_ACCESS_TOKEN}`, which is not in the shell. |
| `MCP error -32602 … too_big` on `search_workflows` | `limit` caps at **200**. |
| A tool "returns nothing" | The n8n server reports tool failures as a result with `isError: true`, **not** as a JSON-RPC error. `lib/mcp.mjs` raises on it; hand-rolled callers silently see an empty list. |
| `401` | The API key belongs to a user; check it has not been revoked and that the instance URL is right. |
