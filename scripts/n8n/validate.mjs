// Offline validation of everything under automation/n8n/.
//
//   pnpm n8n:validate
//
// NO NETWORK and NO CREDENTIAL — this is the check that runs on every pull request. It cannot say
// whether a workflow is valid for a particular n8n version (only the instance knows that; use the
// MCP `validate_workflow` tool for structural checks against the live node catalogue). What it
// CAN do is enforce every rule the repository owns:
//
//   structural  — the graph is internally consistent (connections resolve, ids are unique)
//   repository  — registered, manifest well-formed, business process exists, JSON normalized
//   security    — no secrets, no pinData, no credential references
//   business    — per-process rules, e.g. the ADR-0015 OOO/NRR contract
//
// Exit code 1 on any error; warnings do not fail the build.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { validateAgainstSchema } from "./lib/json-schema.mjs";
import { REPO_ROOT } from "./lib/env.mjs";
import {
  AUTOMATION_ROOT,
  discoverWorkflowDirs,
  loadManifest,
  loadRegistry,
  validateManifest,
} from "./lib/registry.mjs";
import { normalize } from "./lib/sanitize.mjs";
import { scanWorkflow } from "./lib/scan.mjs";
import { validateBusinessRules } from "./lib/business-rules.mjs";

const findings = [];
const push = (severity, rule, where, message) => findings.push({ severity, rule, where, message });

/**
 * Apply a manifest's `knownViolations` to this workflow's findings.
 *
 * A workflow imported from a live instance usually DOES contradict the current contract — that is
 * why it is being brought under control. Deleting the rule to make CI green would destroy the
 * signal; leaving it red makes the gate meaningless. So a violation may be explicitly accepted,
 * with a reason, an owner-facing tracking link and an expiry date. On expiry it becomes an error
 * again, so accepted debt cannot quietly become permanent.
 */
function applyKnownViolations(workflowFindings, manifest, label, today) {
  const accepted = manifest?.knownViolations ?? [];
  const used = new Set();

  const out = workflowFindings.map((finding) => {
    const index = accepted.findIndex(
      (entry, i) =>
        !used.has(i) &&
        entry.rule === finding.rule &&
        (!entry.node || finding.message.includes(`"${entry.node}"`)),
    );
    if (index === -1) return finding;

    const entry = accepted[index];
    used.add(index);

    // js-yaml resolves an unquoted `2026-10-31` to a Date, so compare on a normalized ISO string
    // rather than on whatever `String(...)` happens to produce for the host locale.
    const expires =
      entry.expires instanceof Date ? entry.expires.toISOString().slice(0, 10) : String(entry.expires ?? "");

    if (!expires || !entry.reason || !entry.trackedIn) {
      return {
        severity: "error",
        rule: "manifest/known-violation-incomplete",
        where: label,
        message: `knownViolations entry for "${entry.rule}" needs reason, trackedIn and expires.`,
      };
    }
    if (expires < today) {
      return {
        ...finding,
        severity: "error",
        message: `${finding.message} [ACCEPTANCE EXPIRED ${expires} — ${entry.trackedIn}]`,
      };
    }
    return {
      ...finding,
      severity: "warning",
      message: `${finding.message} [accepted until ${expires} — ${entry.trackedIn}]`,
    };
  });

  for (const [i, entry] of accepted.entries()) {
    if (!used.has(i)) {
      out.push({
        severity: "error",
        rule: "manifest/stale-known-violation",
        where: label,
        message: `knownViolations lists "${entry.rule}"${entry.node ? ` on "${entry.node}"` : ""} but nothing reports it. Remove it.`,
      });
    }
  }
  return out;
}

/** Graph-level checks that do not need the n8n node catalogue. */
function validateStructure(workflow, label) {
  const names = new Set();
  const ids = new Set();

  for (const node of workflow.nodes ?? []) {
    if (!node.name) push("error", "structure/node-name", label, "A node has no name.");
    if (names.has(node.name)) push("error", "structure/duplicate-name", label, `Duplicate node name "${node.name}".`);
    names.add(node.name);

    if (!node.id) push("error", "structure/node-id", label, `Node "${node.name}" has no id.`);
    else if (ids.has(node.id)) push("error", "structure/duplicate-id", label, `Duplicate node id "${node.id}".`);
    ids.add(node.id);

    if (!node.type) push("error", "structure/node-type", label, `Node "${node.name}" has no type.`);
  }

  // Connections are keyed by node NAME on both sides; a dangling reference is a broken graph.
  for (const [source, outputs] of Object.entries(workflow.connections ?? {})) {
    if (!names.has(source)) {
      push("error", "structure/dangling-connection", label, `Connection from unknown node "${source}".`);
    }
    for (const branches of Object.values(outputs ?? {})) {
      for (const branch of branches ?? []) {
        for (const link of branch ?? []) {
          if (!names.has(link.node)) {
            push("error", "structure/dangling-connection", label, `"${source}" connects to unknown node "${link.node}".`);
          }
        }
      }
    }
  }

  const TRIGGERS = /(\.webhook|Trigger$|\.executeWorkflowTrigger|\.scheduleTrigger|\.cron|\.emailReadImap|\.formTrigger)/;
  if (!(workflow.nodes ?? []).some((node) => TRIGGERS.test(node.type ?? ""))) {
    push("warning", "structure/no-trigger", label, "No trigger node — this workflow cannot start on its own.");
  }
}

/**
 * Fixtures must parse, must be free of secrets, and — when an input schema is present — must
 * conform to it. A fixture that has drifted from the contract is worse than no fixture: it is a
 * documented example of a payload the workflow will never receive.
 */
function validateFixtures(dir, label) {
  const fixturesDir = join(dir, "fixtures");
  if (!existsSync(fixturesDir)) return;

  const inputSchemaPath = join(dir, "contracts", "hub-child-input.schema.json");
  const schema = existsSync(inputSchemaPath) ? JSON.parse(readFileSync(inputSchemaPath, "utf8")) : null;

  for (const file of readdirSync(fixturesDir).filter((name) => name.endsWith(".json"))) {
    const where = `${label}/fixtures/${file}`;
    let payload;
    try {
      payload = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    } catch (error) {
      push("error", "fixture/json", where, `Does not parse: ${error.message}`);
      continue;
    }

    for (const finding of scanWorkflow(payload, where)) {
      push(finding.severity, `fixture/${finding.rule}`, where, finding.message);
    }
    if (!payload._fixture) {
      push("warning", "fixture/provenance", where, 'No "_fixture" note saying what case this is and that it is synthetic.');
    }
    if (schema) {
      for (const problem of validateAgainstSchema(payload, schema)) {
        push("error", "fixture/schema", where, problem);
      }
    }
  }
}

/** ISO date used to expire accepted violations. Overridable so a test can pin it. */
const TODAY = (process.env.N8N_VALIDATE_TODAY ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

function main() {
  const registry = loadRegistry();
  const entries = registry.workflows ?? [];
  const dirs = discoverWorkflowDirs();

  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      push("error", "registry/duplicate-id", "registry.yaml", `Duplicate logical id "${entry.id}".`);
    }
    byId.set(entry.id, entry);
  }

  // Every registry entry that claims a path must have that directory.
  for (const entry of entries) {
    if (entry.path && !existsSync(join(REPO_ROOT, entry.path))) {
      push("error", "registry/missing-path", "registry.yaml", `"${entry.id}" points at missing path ${entry.path}.`);
    }
  }

  for (const { domain, slug, dir } of dirs) {
    const label = relative(REPO_ROOT, dir);
    const manifest = loadManifest(dir);

    findings.push(...validateManifest(manifest, label));

    if (manifest?.id && !byId.has(manifest.id)) {
      push("error", "registry/unregistered", label, `Manifest id "${manifest.id}" is not in registry.yaml.`);
    }
    if (manifest?.domain && manifest.domain !== domain) {
      push("error", "manifest/domain-mismatch", label, `manifest.domain="${manifest.domain}" but directory is "${domain}".`);
    }

    if (!existsSync(join(dir, "README.md"))) {
      const severity = manifest?.lifecycle === "imported" ? "warning" : "error";
      push(severity, "artifact/readme", label, "README.md is required (purpose, inputs, outputs, failure modes).");
    }

    const workflowPath = join(dir, "workflow.json");
    if (!existsSync(workflowPath)) {
      // `lifecycle: observed` means "known and documented, not yet owned" — legitimate mid-migration.
      const severity = manifest?.lifecycle === "observed" ? "warning" : "error";
      push(severity, "artifact/workflow-json", label, "workflow.json is absent.");
      continue;
    }

    const source = readFileSync(workflowPath, "utf8");
    let workflow;
    try {
      workflow = JSON.parse(source);
    } catch (error) {
      push("error", "artifact/json", label, `workflow.json does not parse: ${error.message}`);
      continue;
    }

    if (`${JSON.stringify(normalize(workflow), null, 2)}\n` !== source) {
      push("error", "artifact/not-normalized", label, "workflow.json is not normalized. Re-run `pnpm n8n:export`.");
    }

    // Structure/security/business findings for THIS workflow are collected separately so the
    // manifest's accepted-violation list can only ever affect its own workflow.
    const own = [];
    const collect = (list) => own.push(...list);
    const before = findings.length;
    validateStructure(workflow, `${label}/workflow.json`);
    collect(findings.splice(before));
    collect(scanWorkflow(workflow, `${label}/workflow.json`));
    collect(validateBusinessRules(workflow, manifest, `${label}/workflow.json`));

    findings.push(...applyKnownViolations(own, manifest, label, TODAY));
    validateFixtures(dir, label);
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");

  for (const finding of [...errors, ...warnings]) {
    console.log(`${finding.severity === "error" ? "ERROR  " : "warning"}  ${finding.rule}`);
    console.log(`         ${finding.where}`);
    console.log(`         ${finding.message}`);
  }

  console.log("");
  console.log(
    `${dirs.length} workflow artifact(s), ${entries.length} registry entr(ies) — ` +
      `${errors.length} error(s), ${warnings.length} warning(s).`,
  );
  if (!existsSync(AUTOMATION_ROOT)) console.log("(automation/n8n does not exist yet)");
  if (errors.length > 0) process.exit(1);
}

main();
