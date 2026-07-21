// Thin JSON-RPC client for the OFFICIAL n8n instance MCP server (`/mcp-server/http`).
//
// Why a client here at all, when Claude Code talks to the same server over MCP directly?
// Because CI and `pnpm n8n:*` need deterministic, reviewable behaviour: fixed tool arguments,
// stable JSON formatting, and a hard refusal to call anything that writes. An agent session is
// the interactive path; this is the reproducible one. See docs/reference/n8n/workflow-lifecycle.md.
//
// The server replies with `text/event-stream` even for unary calls, so responses are parsed out
// of SSE `data:` frames rather than with `response.json()`.

import { loadEnv, requireEnv } from "./env.mjs";

/** Tools that mutate the n8n instance. Never callable through `callTool` — see callWriteTool. */
const WRITE_TOOLS = new Set([
  "create_workflow_from_code",
  "update_workflow",
  "archive_workflow",
  "publish_workflow",
  "unpublish_workflow",
  "execute_workflow",
]);

let nextId = 1;

function endpoint() {
  loadEnv();
  return {
    url: requireEnv("N8N_MCP_URL", "The official instance MCP endpoint, e.g. https://<host>/mcp-server/http."),
    key: requireEnv("N8N_MCP_API_KEY", "An n8n API key from Settings → n8n API."),
  };
}

/** The environment N8N_MCP_URL points at. Defaults to `production` — the safe assumption. */
export function currentEnvironment() {
  loadEnv();
  return (process.env.N8N_ENV?.trim() || "production").toLowerCase();
}

async function rpc(method, params) {
  const { url, key } = endpoint();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });

  if (!response.ok) {
    throw new Error(`n8n MCP ${method} → HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  // Unary call over SSE: take the first `data:` frame that parses as a JSON-RPC envelope.
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = JSON.parse(line.slice(5).trim());
    if (payload.error) {
      throw new Error(`n8n MCP ${method} → ${payload.error.message ?? JSON.stringify(payload.error)}`);
    }
    if (payload.result !== undefined) return payload.result;
  }
  throw new Error(`n8n MCP ${method} → no JSON-RPC result in response`);
}

/** Call a READ-ONLY tool. Throws on anything in WRITE_TOOLS. */
export async function callTool(name, args = {}) {
  if (WRITE_TOOLS.has(name)) {
    throw new Error(
      `${name} mutates the n8n instance and is not reachable through callTool(). ` +
        `Use callWriteTool(), which requires N8N_ENV=development.`,
    );
  }
  return unwrap(await rpc("tools/call", { name, arguments: args }));
}

/**
 * Call a mutating tool. Refuses unless N8N_ENV=development, so a production token cannot be used
 * as a sandbox (docs/reference/n8n/environments.md). Nothing in the tracked scripts calls this
 * yet — it exists so that when a development instance appears, the guard is already the default.
 */
export async function callWriteTool(name, args = {}) {
  const env = currentEnvironment();
  if (env === "development") return unwrap(await rpc("tools/call", { name, arguments: args }));

  // Escape hatch for an operation the user has explicitly approved on a non-development instance.
  //
  // Deliberately a SEPARATE variable rather than "just set N8N_ENV=development": mislabelling the
  // environment would silently re-open every other write path and corrupt the registry's
  // per-environment remote IDs. This says what is true — production, with approval — and has to be
  // passed per invocation, so it cannot linger in .env.local as an ambient permission.
  const approval = process.env.N8N_APPROVED_PRODUCTION_WRITE?.trim();
  if (approval) {
    console.warn(`[n8n] PRODUCTION WRITE: ${name} — approved as "${approval}"`);
    return unwrap(await rpc("tools/call", { name, arguments: args }));
  }

  throw new Error(
    `Refusing to call ${name}: N8N_ENV=${env}. Write operations are allowed only against a ` +
      `development instance. If the user has approved this specific operation, pass ` +
      `N8N_APPROVED_PRODUCTION_WRITE="<what was approved>" for that invocation only.`,
  );
}

/**
 * MCP wraps tool results in a content array; the n8n server puts JSON in the first text part.
 *
 * Tool-level failures come back as a normal `result` carrying `isError: true` — NOT as a JSON-RPC
 * `error` — so they must be raised explicitly here. Without this, a rejected argument surfaces as
 * an empty list and every caller silently reports "nothing found".
 */
function unwrap(result) {
  const text = result?.content?.find((part) => part.type === "text")?.text;
  if (result?.isError) {
    throw new Error(`n8n MCP tool error: ${text ?? JSON.stringify(result)}`);
  }
  if (text === undefined) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Server handshake — used by the smoke test to prove the connection without touching a workflow. */
export async function initialize() {
  return rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "coldunicorn-portal-scripts", version: "1.0.0" },
  });
}

export async function listTools() {
  const result = await rpc("tools/list", {});
  return result.tools ?? [];
}

/**
 * Every workflow the token can see. `search_workflows` returns previews, not full graphs.
 * The server caps `limit` at 200 and rejects anything larger.
 */
export async function listWorkflows(limit = 200) {
  const result = await callTool("search_workflows", { limit });
  return result.data ?? [];
}

/** Full graph (nodes + connections + settings) for one workflow. */
export async function getWorkflow(workflowId) {
  const result = await callTool("get_workflow_details", { workflowId });
  return result.workflow ?? result;
}
