// Detect divergence between the committed artifact and the live n8n instance.
//
//   pnpm n8n:check-drift            all managed workflows
//   pnpm n8n:check-drift --id <logical-id>
//
// Drift is REPORTED, never resolved. Whether the repository or the instance is right is a business
// judgement (docs/reference/n8n/workflow-lifecycle.md §"Direction of synchronisation") — a script
// that auto-overwrote either side would silently pick a winner.
//
// Read-only. Exits 1 when drift exists so a scheduled job can alert on it.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT } from "./lib/env.mjs";
import { currentEnvironment, getWorkflow } from "./lib/mcp.mjs";
import { discoverWorkflowDirs, loadManifest, loadRegistry } from "./lib/registry.mjs";
import { toCanonicalJson } from "./lib/sanitize.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

// Workflow-level settings live outside `nodes`, so without this block a UI edit that unbinds the
// failure recorder or flips the timezone reads as "no drift" — the same class of blind spot as the
// node-level one below, one level up. Measured 2026-08-15: SEVEN of the
// 25 managed artifacts were already stale this way. The instance had `errorWorkflow` bound and the
// repository did not know, which is exactly the state E1 is trying to establish and keep.
//
// A closed list, like every other allowlist here, so a future n8n release adding a settings key does
// not light up every workflow at once. Each entry earns its place by what its silent change costs.
//
// `availableInMCP` is deliberately NOT here, and the reason is worth stating because it looks like an
// omission. sanitize() strips it from the canonical form as an instance concern, so no artifact can
// ever carry it — comparing it would report drift on every workflow that had it set, forever. It is
// held true by other means: deploy.mjs forces `availableInMCP: true` into every PUT, and when it is
// false the MCP tools refuse outright ("Workflow is not available in MCP"), which is a louder signal
// than a drift line. n8n:export falls back to REST for exactly that case.
const WATCHED_SETTINGS = [
  "errorWorkflow", // where failures are reported — unset means nobody hears them (E1)
  "executionOrder", // "v1" is what makes fan-out run top-to-bottom by Y; branch order depends on it
  "timezone", // every cron and every date expression in the workflow
  "callerPolicy", // who is allowed to call a sub-workflow
  "executionTimeout",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "saveExecutionProgress",
  "saveManualExecutions",
];

/** `""` and "key absent" both mean "not set" in the n8n UI; don't report that pair as a change. */
function normalizeSetting(value) {
  return value === "" || value === undefined ? null : value;
}

/** Compare two canonical workflows and describe the difference in reviewable terms. */
function describeDrift(local, remote) {
  const differences = [];

  if (local.name !== remote.name) differences.push(`name: "${local.name}" → "${remote.name}"`);

  const localNodes = new Map((local.nodes ?? []).map((node) => [node.name, node]));
  const remoteNodes = new Map((remote.nodes ?? []).map((node) => [node.name, node]));

  for (const name of remoteNodes.keys()) {
    if (!localNodes.has(name)) differences.push(`node added remotely: "${name}"`);
  }
  for (const name of localNodes.keys()) {
    if (!remoteNodes.has(name)) differences.push(`node removed remotely: "${name}"`);
  }
  for (const [name, localNode] of localNodes) {
    const remoteNode = remoteNodes.get(name);
    if (!remoteNode) continue;
    if (JSON.stringify(localNode.parameters) !== JSON.stringify(remoteNode.parameters)) {
      differences.push(`node parameters changed: "${name}"`);
    }
    if (localNode.type !== remoteNode.type || localNode.typeVersion !== remoteNode.typeVersion) {
      differences.push(`node type/version changed: "${name}"`);
    }
    // Failure posture is not part of `parameters`, so without this a UI edit removing
    // `onError: continueRegularOutput` from a node reads as "no drift" — while changing whether a
    // Sheets error costs one row or aborts the Supabase branch behind it. `pnpm n8n:deploy
    // --node-settings` can move these, so CI has to be able to see them move.
    // `disabled` belongs here for a reason found the hard way on 2026-08-18: a Slack alert blamed a
    // node the artifact recorded as disabled, and proving the instance agreed needed a hand-written
    // REST call, because this loop did not compare the one key that decides whether a node runs at
    // all. `--node-settings` can move it, so CI has to be able to see it move.
    for (const key of ["disabled", "onError", "retryOnFail", "maxTries", "waitBetweenTries", "alwaysOutputData", "executeOnce"]) {
      if (JSON.stringify(localNode[key] ?? null) === JSON.stringify(remoteNode[key] ?? null)) continue;
      const show = (value) => (value === undefined ? "(unset)" : JSON.stringify(value));
      differences.push(`node ${key} changed: "${name}" ${show(localNode[key])} → ${show(remoteNode[key])}`);
    }
  }

  if (JSON.stringify(local.connections) !== JSON.stringify(remote.connections)) {
    differences.push("connections changed");
  }

  for (const key of WATCHED_SETTINGS) {
    const localValue = normalizeSetting((local.settings ?? {})[key]);
    const remoteValue = normalizeSetting((remote.settings ?? {})[key]);
    if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) continue;
    const show = (value) => (value === null ? "(unset)" : JSON.stringify(value));
    differences.push(`settings.${key} changed: ${show(localValue)} → ${show(remoteValue)}`);
  }
  return differences;
}

async function main() {
  const environment = currentEnvironment();
  const only = arg("id");
  const registry = loadRegistry();
  const byId = new Map((registry.workflows ?? []).map((entry) => [entry.id, entry]));

  let drifted = 0;
  let checked = 0;

  for (const { dir } of discoverWorkflowDirs()) {
    const manifest = loadManifest(dir);
    if (!manifest?.id) continue;
    if (only && manifest.id !== only) continue;

    const label = relative(REPO_ROOT, dir);
    const entry = byId.get(manifest.id);
    const remoteId = entry?.environments?.[environment]?.remoteWorkflowId;

    if (!remoteId) {
      console.log(`SKIP    ${manifest.id} — no ${environment} remoteWorkflowId in registry.yaml`);
      continue;
    }
    const workflowPath = join(dir, "workflow.json");
    if (!existsSync(workflowPath)) {
      console.log(`SKIP    ${manifest.id} — no workflow.json (lifecycle: ${manifest.lifecycle})`);
      continue;
    }

    checked += 1;
    const local = JSON.parse(readFileSync(workflowPath, "utf8"));
    const remote = JSON.parse(toCanonicalJson(await getWorkflow(remoteId)).json);
    const differences = describeDrift(local, remote);

    if (differences.length === 0) {
      console.log(`OK      ${manifest.id}`);
      continue;
    }

    drifted += 1;
    console.log(`DRIFT   ${manifest.id}  (${label})`);
    for (const difference of differences) console.log(`        └ ${difference}`);
  }

  console.log("");
  console.log(`${checked} checked, ${drifted} drifted (environment: ${environment}).`);
  if (drifted > 0) {
    console.log("");
    console.log("Drift is not auto-resolved. Decide which side matches the business process:");
    console.log("  repo is right   → re-apply the artifact to n8n (development only)");
    console.log("  remote is right → `pnpm n8n:export --id <id>`, review the diff, commit");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
