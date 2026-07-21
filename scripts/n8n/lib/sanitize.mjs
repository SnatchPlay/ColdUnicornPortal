// Turn a workflow as returned by the n8n MCP into the canonical artifact we are willing to commit.
//
// Two separate jobs, deliberately not merged:
//   sanitize()  — REMOVE things that must never enter Git (credentials, pinned production data,
//                 execution/version identifiers). Lossy on purpose.
//   normalize() — reorder and re-key so that two semantically identical workflows produce
//                 byte-identical JSON. Lossless.
//
// Both are pure functions over a plain object so `n8n:validate` can run them in CI with no network.

/** Volatile or instance-scoped fields. Keeping them guarantees a diff on every export. */
const DROPPED_TOP_LEVEL = new Set([
  "versionId",
  "activeVersionId",
  "createdAt",
  "updatedAt",
  "triggerCount",
  "scopes",
  "shared",
  "homeProject",
  "sharedWithProjects",
  "usedCredentials",
  "isArchived",
  "active", // lifecycle state belongs to the environment, and to manifest.yaml — not to the graph
  "activeVersion",
  "canExecute", // a property of the TOKEN that fetched this, not of the workflow
  "parentFolderId", // folder placement is per-instance organisation
  "pinData", // production payloads; see docs/reference/n8n/security.md
  "staticData",
  "meta",
  "tags",
]);

const DROPPED_NODE_FIELDS = new Set(["credentials", "issues", "webhookId"]);

/** Order that makes a node readable top-to-bottom in review. Unlisted keys follow, sorted. */
const NODE_KEY_ORDER = [
  "id",
  "name",
  "type",
  "typeVersion",
  "position",
  "disabled",
  "notes",
  "notesInFlow",
  "alwaysOutputData",
  "executeOnce",
  "retryOnFail",
  "maxTries",
  "waitBetweenTries",
  "onError",
  "continueOnFail",
  "parameters",
];

/**
 * Strip everything that must not be committed.
 *
 * Credentials are removed rather than rewritten to an alias: the n8n MCP already returns them
 * empty, and an alias that is not actually resolvable on import would be a lie in the artifact.
 * The credential CONTRACT (which alias a node needs, and of what type) is declared in manifest.yaml
 * instead, where a human maintains it and CI can check it.
 *
 * Returns { workflow, removed } so the caller can report what was dropped rather than silently
 * shrinking the file.
 */
export function sanitize(input) {
  const removed = { credentials: [], pinData: false, fields: [] };
  const workflow = {};

  for (const [key, value] of Object.entries(input)) {
    if (DROPPED_TOP_LEVEL.has(key)) {
      if (key === "pinData" && value && Object.keys(value).length > 0) removed.pinData = true;
      else if (value !== undefined && value !== null) removed.fields.push(key);
      continue;
    }
    workflow[key] = value;
  }

  workflow.nodes = (input.nodes ?? []).map((node) => {
    const clean = {};
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED_NODE_FIELDS.has(key)) {
        if (key === "credentials" && value && Object.keys(value).length > 0) {
          for (const [type, ref] of Object.entries(value)) {
            removed.credentials.push({ node: node.name, type, name: ref?.name ?? null });
          }
        }
        continue;
      }
      clean[key] = value;
    }
    return clean;
  });

  // `settings.availableInMCP` and callerPolicy are instance/runtime concerns, not workflow logic.
  if (workflow.settings) {
    const { availableInMCP, ...settings } = workflow.settings;
    workflow.settings = settings;
  }

  return { workflow, removed };
}

/** Recursively sort object keys so JSON.stringify is deterministic. Arrays keep their order. */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep(value[key])]),
    );
  }
  return value;
}

function orderNode(node) {
  const out = {};
  for (const key of NODE_KEY_ORDER) {
    if (node[key] !== undefined) out[key] = key === "parameters" ? sortDeep(node[key]) : node[key];
  }
  for (const key of Object.keys(node).sort()) {
    if (!(key in out)) out[key] = sortDeep(node[key]);
  }
  return out;
}

/**
 * Deterministic ordering. Nodes are sorted by name because n8n addresses connections BY NAME, not
 * by array index — so reordering the array is semantically inert but kills diff noise when a node
 * is added in the editor. Node `id`s are preserved untouched: regenerating them would destroy
 * review history and break `update_workflow` patching.
 */
export function normalize(workflow) {
  const nodes = [...(workflow.nodes ?? [])]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(orderNode);

  const ordered = {
    name: workflow.name,
    ...(workflow.description ? { description: workflow.description } : {}),
    nodes,
    connections: sortDeep(workflow.connections ?? {}),
    settings: sortDeep(workflow.settings ?? {}),
  };

  for (const key of Object.keys(workflow).sort()) {
    if (!(key in ordered) && key !== "id") ordered[key] = sortDeep(workflow[key]);
  }
  return ordered;
}

/** Canonical on-disk form: sanitized, normalized, 2-space JSON with a trailing newline. */
export function toCanonicalJson(rawWorkflow) {
  const { workflow, removed } = sanitize(rawWorkflow);
  return { json: `${JSON.stringify(normalize(workflow), null, 2)}\n`, removed };
}
