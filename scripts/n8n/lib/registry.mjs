// Loading + shape-checking of automation/n8n/registry.yaml and the per-workflow manifest.yaml.
//
// The registry is the index; a manifest is the per-workflow contract. Logical ID is the primary
// key everywhere — a workflow NAME is not stable (it is edited in the n8n UI) and a remote ID is
// per-environment, so neither can be the identity. See automation/n8n/conventions.md.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { REPO_ROOT } from "./env.mjs";

export const AUTOMATION_ROOT = join(REPO_ROOT, "automation/n8n");
export const WORKFLOWS_ROOT = join(AUTOMATION_ROOT, "workflows");
export const REGISTRY_PATH = join(AUTOMATION_ROOT, "registry.yaml");

const LOGICAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUSES = new Set(["active", "paused", "deprecated", "planned", "unmanaged"]);
const CRITICALITY = new Set(["low", "medium", "high"]);
const LIFECYCLES = new Set(["managed", "observed", "orphan"]);

export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) throw new Error(`Missing ${REGISTRY_PATH}`);
  const parsed = yaml.load(readFileSync(REGISTRY_PATH, "utf8"));
  return parsed ?? { workflows: [] };
}

export function loadManifest(dir) {
  const path = join(dir, "manifest.yaml");
  if (!existsSync(path)) return null;
  return yaml.load(readFileSync(path, "utf8"));
}

/** Every workflow directory on disk: those containing a manifest.yaml. */
export function discoverWorkflowDirs() {
  if (!existsSync(WORKFLOWS_ROOT)) return [];
  const out = [];
  for (const domain of readdirSync(WORKFLOWS_ROOT)) {
    const domainDir = join(WORKFLOWS_ROOT, domain);
    if (!statSync(domainDir).isDirectory()) continue;
    for (const slug of readdirSync(domainDir)) {
      const dir = join(domainDir, slug);
      if (statSync(dir).isDirectory() && existsSync(join(dir, "manifest.yaml"))) {
        out.push({ domain, slug, dir });
      }
    }
  }
  return out;
}

/**
 * Structural validation of a manifest. Returns findings rather than throwing so `n8n:validate`
 * can report everything wrong at once instead of one error per run.
 */
export function validateManifest(manifest, label) {
  const findings = [];
  const err = (rule, message) => findings.push({ severity: "error", rule, where: label, message });
  const warn = (rule, message) => findings.push({ severity: "warning", rule, where: label, message });

  if (manifest?.schemaVersion !== 1) err("manifest/schema-version", "schemaVersion must be 1.");
  if (!LOGICAL_ID.test(manifest?.id ?? "")) {
    err("manifest/id", `id must be kebab-case ([a-z0-9-]), got ${JSON.stringify(manifest?.id)}.`);
  }
  for (const field of ["name", "domain", "owner"]) {
    if (!manifest?.[field]) err(`manifest/${field}`, `${field} is required.`);
  }
  if (!STATUSES.has(manifest?.status)) {
    err("manifest/status", `status must be one of ${[...STATUSES].join(" | ")}.`);
  }
  if (!CRITICALITY.has(manifest?.criticality)) {
    err("manifest/criticality", `criticality must be one of ${[...CRITICALITY].join(" | ")}.`);
  }
  if (!LIFECYCLES.has(manifest?.lifecycle)) {
    err("manifest/lifecycle", `lifecycle must be one of ${[...LIFECYCLES].join(" | ")}.`);
  }

  const processes = manifest?.businessProcess ?? [];
  if (!Array.isArray(processes) || processes.length === 0) {
    err("manifest/business-process", "businessProcess must list at least one process document.");
  } else {
    for (const relative of processes) {
      if (!existsSync(join(REPO_ROOT, relative))) {
        err("manifest/business-process", `businessProcess points at a missing file: ${relative}`);
      }
    }
  }

  // A workflow that writes must say HOW it writes. ADR-0015: ingestion goes through RPCs, so a
  // manifest that declares raw table writes for a process that has an RPC contract is a red flag
  // the reviewer must see — validate-business.mjs turns this into a hard rule per process.
  const writes = manifest?.writes ?? {};
  if ((writes.tables?.length ?? 0) > 0 && (writes.rpcs?.length ?? 0) === 0) {
    warn(
      "manifest/direct-table-writes",
      `declares direct table writes (${writes.tables.join(", ")}) and no RPC. ` +
        "Confirm no ingestion RPC contract exists for this process (CLAUDE.md §4, ADR-0015).",
    );
  }

  if (!manifest?.idempotency?.key) {
    warn("manifest/idempotency", "idempotency.key is not documented.");
  }

  return findings;
}

export { LOGICAL_ID };
