// Read-only connection check for the n8n instance MCP.
//
//   pnpm n8n:smoke
//
// Proves the credential works and prints what the token can reach. Touches no workflow: it only
// runs `initialize` + `tools/list` + one `search_workflows`. Nothing here can mutate n8n.

import { currentEnvironment, initialize, listTools, listWorkflows } from "./lib/mcp.mjs";

const WRITE_TOOLS = new Set([
  "create_workflow_from_code",
  "update_workflow",
  "archive_workflow",
  "publish_workflow",
  "unpublish_workflow",
  "execute_workflow",
]);

async function main() {
  const environment = currentEnvironment();

  const info = await initialize();
  console.log(`server      : ${info.serverInfo?.name} ${info.serverInfo?.version}`);
  console.log(`protocol    : ${info.protocolVersion}`);
  console.log(`N8N_ENV     : ${environment}`);

  const tools = await listTools();
  const write = tools.filter((tool) => WRITE_TOOLS.has(tool.name)).map((tool) => tool.name);
  console.log(`tools       : ${tools.length} (${write.length} write-capable)`);

  const workflows = await listWorkflows();
  const active = workflows.filter((workflow) => workflow.active).length;
  console.log(`workflows   : ${workflows.length} visible, ${active} active`);

  if (environment !== "development" && write.length > 0) {
    console.log("");
    console.log(`WARNING: this token exposes write tools (${write.join(", ")})`);
    console.log(`         against a NON-development instance (N8N_ENV=${environment}).`);
    console.log("         Scripts refuse to write; an agent session must not either.");
    console.log("         See docs/reference/n8n/environments.md.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
