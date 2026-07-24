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
  }

  if (JSON.stringify(local.connections) !== JSON.stringify(remote.connections)) {
    differences.push("connections changed");
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
