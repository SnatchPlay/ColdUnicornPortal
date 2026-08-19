// Export a workflow FROM n8n INTO the repository as a canonical artifact.
//
//   pnpm n8n:export --remote-id <n8nWorkflowId> --domain <domain> --slug <slug>
//   pnpm n8n:export --id <logical-id>            # re-export something already in the registry
//   pnpm n8n:export ... --stdout                 # print, write nothing
//
// This is the ONLY sanctioned way to bring an existing workflow under repository control
// (docs/reference/n8n/workflow-lifecycle.md, "existing workflows not yet in Git").
//
// It refuses to write a file that trips the secret scanner: a sanitizer bug must fail loudly
// rather than commit a credential. Read-only against n8n.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentEnvironment, getWorkflow } from "./lib/mcp.mjs";
import { getWorkflow as getWorkflowViaRest } from "./lib/rest.mjs";
import { toCanonicalJson } from "./lib/sanitize.mjs";
import { scanWorkflow } from "./lib/scan.mjs";
import { WORKFLOWS_ROOT, loadRegistry } from "./lib/registry.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const environment = currentEnvironment();
  const logicalId = arg("id");
  let remoteId = arg("remote-id");
  let domain = arg("domain");
  let slug = arg("slug");

  if (logicalId) {
    const entry = (loadRegistry().workflows ?? []).find((item) => item.id === logicalId);
    if (!entry) throw new Error(`Logical id "${logicalId}" is not in registry.yaml.`);
    remoteId ??= entry.environments?.[environment]?.remoteWorkflowId;
    domain ??= entry.domain;
    slug ??= entry.path?.split("/").pop();
    if (!remoteId) throw new Error(`registry.yaml has no ${environment} remoteWorkflowId for "${logicalId}".`);
  }

  if (!remoteId) throw new Error("Pass --remote-id <n8nWorkflowId> or --id <logical-id>.");

  // MCP first, REST second. `availableInMCP: false` makes a workflow invisible to every MCP-backed
  // tool in this repository — inventory, check-drift and this script — which is the exact state that
  // keeps an orphan un-adoptable: it cannot be exported, so it cannot get an artifact, so `n8n:deploy`
  // cannot target it to flip the flag. REST has no such gate and already backs the deploy path, so
  // falling back to it breaks that circle instead of leaving the workflow permanently unreachable.
  let raw;
  try {
    raw = await getWorkflow(remoteId);
  } catch (error) {
    if (!/available in MCP/i.test(error.message)) throw error;
    console.log("transport   : MCP refused (availableInMCP is false) — falling back to the REST API");
    raw = await getWorkflowViaRest(remoteId);
  }
  const { json, removed } = toCanonicalJson(raw);
  const workflow = JSON.parse(json);

  const findings = scanWorkflow(workflow, `${domain ?? "?"}/${slug ?? remoteId}/workflow.json`);
  const errors = findings.filter((finding) => finding.severity === "error");

  console.log(`remote      : ${remoteId} (${environment})`);
  console.log(`name        : ${raw.name}`);
  console.log(`nodes       : ${workflow.nodes.length}`);
  console.log(
    `sanitized   : ${removed.credentials.length} credential ref(s)` +
      `${removed.pinData ? ", pinData REMOVED" : ""}` +
      `${removed.fields.length ? `, dropped ${removed.fields.join("/")}` : ""}`,
  );
  for (const credential of removed.credentials) {
    console.log(`              └ ${credential.node}: ${credential.type}${credential.name ? ` (${credential.name})` : ""}`);
  }
  for (const finding of findings) {
    console.log(`${finding.severity === "error" ? "ERROR  " : "warning"}     ${finding.rule} — ${finding.message}`);
  }

  if (process.argv.includes("--stdout")) {
    console.log("");
    console.log(json);
    return;
  }

  if (errors.length > 0) {
    console.error("");
    console.error("Refusing to write: the sanitized workflow still trips the secret scanner.");
    process.exit(1);
  }
  if (!domain || !slug) throw new Error("Pass --domain and --slug (or use --id once it is registered).");

  const dir = join(WORKFLOWS_ROOT, domain, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workflow.json"), json);
  console.log("");
  console.log(`written     : automation/n8n/workflows/${domain}/${slug}/workflow.json`);
  console.log("Next: manifest.yaml + README.md + contracts/ + fixtures/, then `pnpm n8n:validate`.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
