// Inventory of every workflow on the n8n instance, classified against the repository registry.
//
//   pnpm n8n:inventory            human-readable table
//   pnpm n8n:inventory --json     machine-readable, for pasting into a report
//
// Classification (docs/reference/n8n/workflow-lifecycle.md):
//   managed    — in registry.yaml AND present on the instance
//   observed   — on the instance, in the registry, but not yet owned (no workflow.json)
//   orphan     — on the instance, absent from the registry
//   archived   — soft-deleted on the instance and unclaimed; retired, not a backlog item
//   missing    — in the registry, absent from the instance (deleted remotely, or wrong environment)
//
// An archived workflow that IS in the registry keeps its normal classification and is flagged
// instead — a managed workflow archived out from under the repository is a finding, not a filing.
//
// Read-only.

import { currentEnvironment } from "./lib/mcp.mjs";
// REST, not the MCP `search_workflows` tool: that tool filters archived workflows out, so this
// inventory reported 51 where the instance held 71 (measured 2026-08-15) — twenty workflows invisible
// to every repository tool. An inventory that cannot see part of the estate is not an inventory.
import { listWorkflows } from "./lib/rest.mjs";
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
    const claimed = hasArtifact.get(entry?.id) ? "managed" : "observed";
    const classification = entry ? claimed : workflow.isArchived ? "archived" : "orphan";
    return {
      remoteId: workflow.id,
      name: workflow.name,
      active: Boolean(workflow.active),
      archived: Boolean(workflow.isArchived),
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
        archived: false,
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

  const order = { managed: 0, observed: 1, orphan: 2, archived: 3, missing: 4 };
  for (const row of rows.sort((a, b) => order[a.classification] - order[b.classification] || a.name.localeCompare(b.name))) {
    // "inactive" and "archived" are different facts: the first can be switched back on, the second
    // was retired. Only say "archived" where it is not already the classification.
    const state = row.active ? "ACTIVE  " : row.archived && row.classification !== "archived" ? "ARCHIVED" : "inactive";
    console.log(
      `${row.classification.padEnd(9)} ${state} ${row.remoteId.padEnd(18)} ${row.logicalId ? `${row.logicalId}  ` : ""}${row.name}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
