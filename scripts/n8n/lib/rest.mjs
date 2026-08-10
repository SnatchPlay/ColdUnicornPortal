// Thin client for the n8n PUBLIC REST API (`/api/v1`), used for deploying a surgical change back to
// a managed workflow.
//
// Why this exists alongside lib/mcp.mjs: the MCP write tools (`update_workflow`,
// `create_workflow_from_code`) take **SDK code**, not workflow JSON, and there is no decompiler
// (docs/reference/n8n/workflow-lifecycle.md — "The SDK authoring contract"). Re-authoring a whole
// high-criticality graph in the DSL to change two expression fields is exactly the error-prone path
// that doc warns against. The REST API's `PUT /workflows/{id}` takes raw workflow JSON, so a change
// can be applied node-by-node onto the exact live graph.
//
// This is a WRITE path against production (the only instance — docs/reference/n8n/environments.md),
// so the deploy script that uses it must be dry-run by default and gated on an explicit --apply.

import { loadEnv, requireEnv } from "./env.mjs";

/** Derive the REST base (`https://host/api/v1`) from the MCP URL, which points at the same host. */
function restBase() {
  loadEnv();
  const mcpUrl = requireEnv("N8N_MCP_URL", "The n8n instance URL, e.g. https://<host>/mcp-server/http.");
  const { origin } = new URL(mcpUrl);
  return `${origin}/api/v1`;
}

function apiKey() {
  loadEnv();
  return requireEnv("N8N_REST_API_KEY", "An n8n API key from Settings → n8n API (public REST scope).");
}

async function rest(method, path, body) {
  const response = await fetch(`${restBase()}${path}`, {
    method,
    headers: {
      "X-N8N-API-KEY": apiKey(),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`n8n REST ${method} ${path} → HTTP ${response.status} ${response.statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Full workflow (nodes + connections + settings + credentials + active flag), as the instance holds it. */
export function getWorkflow(id) {
  return rest("GET", `/workflows/${id}`);
}

// The public API's workflow-settings schema is STRICTER than what GET returns: it is
// `additionalProperties: false` over this set. Measured empirically against this instance
// (2026-07-23): `availableInMCP` IS accepted and MUST be kept — it is what lets the MCP tooling read
// the workflow, and its default (false) silently disables inventory/check-drift/export. `binaryMode`
// and `callerPolicy` are rejected, but both default back to the values this instance already uses
// (`separate` / `workflowsFromSameOwner`), so dropping them is a no-op.
const ALLOWED_SETTINGS = new Set([
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "executionOrder",
  "availableInMCP",
]);

/**
 * Split a live `settings` object into the API-accepted subset and the keys the PUT schema forbids.
 * The caller reports `dropped` so a settings reset is never silent (PUT replaces settings wholesale).
 */
export function filterSettings(settings = {}) {
  const kept = {};
  const dropped = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (ALLOWED_SETTINGS.has(key)) kept[key] = value;
    else dropped[key] = value;
  }
  return { kept, dropped };
}

/**
 * Update a workflow. n8n's PUT accepts ONLY name/nodes/connections/settings/staticData and rejects
 * any other top-level property ("must NOT have additional properties"), so the caller must hand us a
 * full graph and we forward exactly those fields — never `id`, `active`, `tags`, timestamps — with
 * `settings` filtered to the accepted subset.
 */
export function updateWorkflow(id, workflow) {
  const body = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: filterSettings(workflow.settings).kept,
  };
  if (workflow.staticData !== undefined && workflow.staticData !== null) {
    body.staticData = workflow.staticData;
  }
  return rest("PUT", `/workflows/${id}`, body);
}

/**
 * Create a workflow. POST accepts the same narrow body as PUT — anything else ("id", "active",
 * "tags", timestamps) is rejected outright.
 *
 * **A new workflow is always created inactive**, which is what workflow-lifecycle.md §C step 6 asks
 * for ("Do not activate"): a fresh graph is reviewed and test-run before anything can reach it.
 * POST cannot set `active` — but `POST /workflows/{id}/activate` DOES exist and works (verified
 * 2026-08-10), so activation is a separate, deliberate call rather than something the API forbids.
 *
 * Note this is the ONE production write that cannot damage anything that already exists — nothing
 * references a workflow that does not yet exist. The caller is still expected to gate it, the same
 * way scripts/n8n/deploy.mjs gates PUT.
 */
export function createWorkflow(workflow) {
  const body = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: filterSettings(workflow.settings).kept,
  };
  return rest("POST", "/workflows", body);
}

export { restBase };

/**
 * Activate / deactivate. These are the two most consequential verbs the public API exposes: they
 * decide whether a schedule fires and whether a webhook path answers. Neither takes a body, and
 * neither is reversible by re-running a deploy, so callers gate them the same way they gate a PUT.
 */
export function activateWorkflow(id) {
  return rest("POST", `/workflows/${id}/activate`, undefined);
}

export function deactivateWorkflow(id) {
  return rest("POST", `/workflows/${id}/deactivate`, undefined);
}
