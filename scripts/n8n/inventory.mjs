// Inventory of every workflow on the n8n instance, classified against the repository registry.
//
//   pnpm n8n:inventory            human-readable table
//   pnpm n8n:inventory --json     machine-readable, for pasting into a report
//
// Classification (docs/reference/n8n/workflow-lifecycle.md):
//   managed    — in registry.yaml AND present on the instance
//   observed   — on the instance, in the registry, but not yet owned (no workflow.json)
//   orphan     — on the instance, absent from the registry
//   missing    — in the registry, absent from the instance (deleted remotely, or wrong environment)
//
// Read-only.

import { currentEnvironment, listWorkflows } from "./lib/mcp.mjs";
import { discoverWorkflowDirs, loadManifest, loadRegistry } from "./lib/registry.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const asJson = process.argv.includes("--json");
  const environment = currentEnvironment();

  const remote = await listWorkflows();
  const registry = loadRegistry();
  const dirs = discoverWorkflowDirs();

  // remoteId -> registry entry, for the environment we are pointed at.
  const byRemoteId = new Map();
  for (const entry of registry.workflows ?? []) {
    const remoteId = entry.environments?.[environment]?.remoteWorkflowId;
    if (remoteId) byRemoteId.set(remoteId, entry);
  }

  const hasArtifact = new Map(
    dirs.map(({ dir }) => [loadManifest(dir)?.id, existsSync(join(dir, "workflow.json"))]),
  );

  const rows = remote.map((workflow) => {
    const entry = byRemoteId.get(workflow.id);
    const classification = !entry ? "orphan" : hasArtifact.get(entry.id) ? "managed" : "observed";
    return {
      remoteId: workflow.id,
      name: workflow.name,
      active: Boolean(workflow.active),
      logicalId: entry?.id ?? null,
      classification,
    };
  });

  const seen = new Set(remote.map((workflow) => workflow.id));
  for (const entry of registry.workflows ?? []) {
    const remoteId = entry.environments?.[environment]?.remoteWorkflowId;
    if (remoteId && !seen.has(remoteId)) {
      rows.push({
        remoteId,
        name: entry.name,
        active: false,
        logicalId: entry.id,
        classification: "missing",
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ environment, total: rows.length, workflows: rows }, null, 2));
    return;
  }

  const counts = rows.reduce((acc, row) => ({ ...acc, [row.classification]: (acc[row.classification] ?? 0) + 1 }), {});
  console.log(`environment : ${environment}`);
  console.log(`total       : ${rows.length}`);
  console.log(
    `breakdown   : ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join("  ")}`,
  );
  console.log("");

  const order = { managed: 0, observed: 1, orphan: 2, missing: 3 };
  for (const row of rows.sort((a, b) => order[a.classification] - order[b.classification] || a.name.localeCompare(b.name))) {
    const state = row.active ? "ACTIVE  " : "inactive";
    console.log(
      `${row.classification.padEnd(9)} ${state} ${row.remoteId.padEnd(18)} ${row.logicalId ? `${row.logicalId}  ` : ""}${row.name}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
