// Execution health of every workflow on the instance, from real execution history.
//
//   pnpm n8n:health                 last 7 days, human-readable
//   pnpm n8n:health --days 16       widen the window (the instance keeps ~16 days)
//   pnpm n8n:health --json          machine-readable
//   pnpm n8n:health --fail-over 25  exit 1 if any ACTIVE workflow fails more than 25% of its runs
//
// Why this exists: nothing in this repository could see execution history. The instance's MCP build
// has no `search_executions` tool, so `inventory`/`check-drift`/`validate` all answer "what is the
// shape of the estate" and none of them answers "is it working". The 2026-08-15 audit found a
// workflow failing 63% of its runs and another failing 100% of them, both for weeks, both silent —
// see docs/reference/n8n/defect-backlog.md.
//
// Two questions, because they fail differently:
//   1. which workflows FAIL           — a ratio over runs
//   2. which ACTIVE workflows never RAN — a ratio has nothing to divide, so it hides them entirely
//
// Read-only.

import { listExecutions, listWorkflows } from "./lib/rest.mjs";
import { currentEnvironment } from "./lib/mcp.mjs";

const FAILED = new Set(["error", "crashed"]);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const asJson = process.argv.includes("--json");
  const days = Number(arg("days", "7"));
  const failOver = Number(arg("fail-over", "NaN"));
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number.");

  const environment = currentEnvironment();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [workflows, executions] = await Promise.all([listWorkflows(), listExecutions(since)]);
  const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const inWindow = executions.filter((execution) => execution.startedAt >= since);

  const stats = new Map();
  for (const execution of inWindow) {
    const row = stats.get(execution.workflowId) ?? { total: 0, failed: 0, last: null, lastFailure: null };
    row.total += 1;
    if (execution.startedAt > (row.last ?? "")) row.last = execution.startedAt;
    if (FAILED.has(execution.status)) {
      row.failed += 1;
      if (execution.startedAt > (row.lastFailure ?? "")) row.lastFailure = execution.startedAt;
    }
    stats.set(execution.workflowId, row);
  }

  const ran = [...stats.entries()]
    .map(([id, row]) => ({
      id,
      name: byId.get(id)?.name ?? "(deleted or not visible)",
      active: byId.get(id)?.active ?? null,
      ...row,
      failureRate: row.total ? row.failed / row.total : 0,
    }))
    .sort((a, b) => b.failureRate - a.failureRate || b.failed - a.failed || b.total - a.total);

  // An ACTIVE workflow with no executions is the failure mode a ratio cannot express: 0/0 is not a
  // healthy 0%. It is how a dead trigger and a renamed upstream tag both look.
  const silent = workflows
    .filter((workflow) => workflow.active && !workflow.isArchived && !stats.has(workflow.id))
    .map((workflow) => ({ id: workflow.id, name: workflow.name }));

  // The window is a request, not a promise: the instance prunes history, so say what was really read.
  const oldest = executions.at(-1)?.startedAt ?? null;
  const truncated = oldest !== null && oldest > since;

  const breached = Number.isFinite(failOver)
    ? ran.filter((row) => row.active && row.total > 0 && row.failureRate * 100 > failOver)
    : [];

  if (asJson) {
    console.log(JSON.stringify({ environment, since, oldest, truncated, workflows: ran, silent, breached }, null, 2));
  } else {
    console.log(`environment : ${environment}`);
    console.log(`window      : last ${days}d (since ${since.slice(0, 16)})`);
    console.log(`executions  : ${inWindow.length} in window, oldest retained ${oldest?.slice(0, 16) ?? "—"}`);
    if (truncated) {
      console.log(`              NOTE: history is pruned before the requested window — the oldest`);
      console.log(`              rows in it were never available, not merely absent.`);
    }
    console.log("");
    console.log("  fail%   fail/total  last run          state     workflow");
    for (const row of ran) {
      const rate = `${Math.round(row.failureRate * 100)}%`.padStart(5);
      const ratio = `${row.failed}/${row.total}`.padEnd(10);
      console.log(
        `  ${rate}   ${ratio}  ${row.last.slice(0, 16)}  ${row.active ? "ACTIVE  " : "inactive"}  ${row.name}  [${row.id}]`,
      );
    }
    console.log("");
    console.log(`ACTIVE with ZERO executions in the window (${silent.length}):`);
    for (const workflow of silent) console.log(`  ${workflow.id}  ${workflow.name}`);
    if (!silent.length) console.log("  (none)");
  }

  if (breached.length) {
    console.error("");
    console.error(`FAIL: ${breached.length} active workflow(s) over the ${failOver}% failure threshold:`);
    for (const row of breached) {
      console.error(`  ${Math.round(row.failureRate * 100)}%  ${row.name}  [${row.id}]`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
