// Deploy a SURGICAL change from a committed artifact back to a managed n8n workflow, over the public
// REST API. Dry-run by default.
//
//   pnpm n8n:deploy --id <logical-id> --nodes "Node A,Node B"            # dry-run: show the diff
//   N8N_APPROVED_PRODUCTION_WRITE="<what+why>" \
//     pnpm n8n:deploy --id <logical-id> --nodes "Node A" --apply          # write
//
// Four allowlists, each naming its own blast radius:
//   --nodes             update the `parameters`/`typeVersion` of existing nodes
//   --add               append nodes that exist in the artifact but not on live
//   --rewire            replace the outgoing connections of existing nodes
//   --credentials-from  give an --added node the credential block of a named LIVE node
//   --create            POST a brand-new workflow from the artifact (no live counterpart yet)
//   --settings          also push the artifact's `settings` (otherwise settings are never touched)
//   --activate          switch the workflow ON  (its schedule fires, its webhook answers)
//   --deactivate        switch the workflow OFF (nothing it is wired to will run again)
//
// What it does, and deliberately does NOT do:
//   * It copies ONLY the `parameters` (and typeVersion) of the named nodes from the artifact onto
//     the LIVE graph fetched over REST. Everything else on those nodes — credentials, webhookId,
//     node id, position — and every other node, connection and setting is taken verbatim from live.
//   * It NEVER PUTs the committed artifact wholesale: the artifact is credential-sanitised
//     (scripts/n8n/lib/sanitize.mjs), so pushing it as-is would strip auth from every node.
//   * The node allowlist is mandatory — there is no "sync everything". The blast radius is the nodes
//     you name, and the printed diff shows exactly what changes before anything is written.
//   * A STRUCTURAL change (--add / --rewire) to an ACTIVE workflow needs --allow-active on top of
//     everything else. Re-parameterising a live node is routine; re-shaping the graph a webhook is
//     currently delivering into is not, and it must not be possible to do it in passing.
//
// This is a production write (docs/reference/n8n/environments.md: the only instance IS production),
// so the actual PUT is gated on BOTH --apply AND N8N_APPROVED_PRODUCTION_WRITE, mirroring
// scripts/n8n/lib/mcp.mjs. A dry-run needs neither and touches nothing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry, WORKFLOWS_ROOT } from "./lib/registry.mjs";
import { currentEnvironment } from "./lib/mcp.mjs";
import {
  getWorkflow,
  updateWorkflow,
  createWorkflow,
  activateWorkflow,
  deactivateWorkflow,
  filterSettings,
} from "./lib/rest.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Deterministic JSON: sort object keys so two equal shapes stringify identically. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function nodeByName(workflow, name) {
  return (workflow.nodes ?? []).find((n) => n.name === name);
}

/**
 * Create a workflow that does not exist yet, from its committed artifact.
 *
 * Separate from the surgical path because the guarantee is different. That path proves nothing
 * outside the named nodes moved; here there is nothing to move — the whole graph is new. What has
 * to be guaranteed instead is that it lands INACTIVE (a schedule or webhook must be switched on by
 * a person who knows it is on) and that the registry gets the id it hands back, or the next run
 * would create a second copy.
 *
 * The artifact is credential-sanitised, so a created workflow's nodes come up unauthenticated.
 * Anything needing a credential has to be attached in the UI, or by a later --credentials-from
 * deploy, and the caller is told so rather than discovering it in a 401 at runtime.
 */
async function createFromArtifact(logicalId, environment, apply, credentialsArg) {
  const entry = (loadRegistry().workflows ?? []).find((w) => w.id === logicalId);
  if (!entry) throw new Error(`Logical id "${logicalId}" is not in registry.yaml.`);
  const existing = entry.environments?.[environment]?.remoteWorkflowId;
  if (existing) {
    throw new Error(
      `registry.yaml already has a ${environment} remoteWorkflowId for "${logicalId}" (${existing}).\n` +
        `--create would make a second copy; use --nodes/--add/--rewire instead.`,
    );
  }

  const artifactPath = join(WORKFLOWS_ROOT, entry.path.replace(/^automation\/n8n\/workflows\//, ""), "workflow.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

  // "Target Node=<logical-id>:Donor Node". The donor lives in ANOTHER workflow, because a
  // brand-new one has no authenticated node to copy from and the artifact is credential-sanitised.
  // Without this every created workflow would be born unable to run, and the gap would surface as a
  // 401 at execution time rather than here.
  for (const pair of (credentialsArg ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [target, donorSpec] = pair.split("=").map((x) => x?.trim());
    const [donorWorkflow, donorNode] = (donorSpec ?? "").split(":").map((x) => x?.trim());
    if (!target || !donorWorkflow || !donorNode) {
      throw new Error(`--create --credentials-from expects "Node=<logical-id>:Donor Node", got "${pair}".`);
    }
    const donorEntry = (loadRegistry().workflows ?? []).find((w) => w.id === donorWorkflow);
    const donorRemote = donorEntry?.environments?.[environment]?.remoteWorkflowId;
    if (!donorRemote) throw new Error(`No ${environment} remoteWorkflowId for donor workflow "${donorWorkflow}".`);
    const donorLive = await getWorkflow(donorRemote);
    const from = nodeByName(donorLive, donorNode);
    if (!from?.credentials || !Object.keys(from.credentials).length) {
      throw new Error(`Donor "${donorWorkflow}:${donorNode}" has no credentials to copy.`);
    }
    const to = (artifact.nodes ?? []).find((n) => n.name === target);
    if (!to) throw new Error(`--credentials-from target "${target}" is not in the artifact.`);
    if (to.type !== from.type) {
      throw new Error(`"${target}" is ${to.type} but donor "${donorNode}" is ${from.type}.`);
    }
    to.credentials = JSON.parse(JSON.stringify(from.credentials));
    // Aliases only. The id is data we pass through, never something to print.
    console.log(`  ${target} ← credentials of ${donorWorkflow}:${donorNode} ` +
      `(${Object.entries(to.credentials).map(([t, r]) => `${t}:${r?.name}`).join(", ")})`);
  }

  const credentialled = (artifact.nodes ?? []).filter((n) => n.credentials && Object.keys(n.credentials).length);
  // `.kept` — filterSettings returns { kept, dropped }, and handing the whole thing to n8n makes it
  // fall back to defaults for everything, silently. That is how the first created workflow came up
  // without `executionOrder` or `errorWorkflow`.
  // `availableInMCP` is not optional for a managed workflow: without it `pnpm n8n:check-drift`
  // cannot read the graph and the artifact stops being verifiable against the instance (ADR-0016).
  const { kept, dropped } = filterSettings({ availableInMCP: true, ...(artifact.settings ?? {}) });
  const payload = {
    name: artifact.name,
    nodes: artifact.nodes,
    connections: artifact.connections,
    settings: kept,
  };
  if (Object.keys(dropped).length) {
    console.log(`settings    : the API rejects ${Object.keys(dropped).join(", ")} — they fall back to instance defaults`);
  }

  console.log(`create      : ${logicalId} (${environment})`);
  console.log(`name        : ${artifact.name}`);
  console.log(`nodes       : ${artifact.nodes?.length}`);
  console.log(`active      : false (always — activate deliberately, never as a side effect)`);
  const needsCreds = (artifact.nodes ?? []).filter(
    (n) => n.type === "n8n-nodes-base.postgres" && !(n.credentials && Object.keys(n.credentials).length),
  );
  console.log(`credentials : ${credentialled.length} node(s) carry one`);
  if (needsCreds.length) {
    console.log(`WARNING: ${needsCreds.map((n) => n.name).join(", ")} will be created UNAUTHENTICATED.`);
    console.log(`         Pass --credentials-from "Node=<logical-id>:Donor Node".`);
  }
  console.log("");

  if (!apply) {
    console.log("DRY RUN — nothing created. Re-run with --apply (and N8N_APPROVED_PRODUCTION_WRITE set).");
    return;
  }
  const approval = process.env.N8N_APPROVED_PRODUCTION_WRITE?.trim();
  if (!approval) {
    throw new Error(
      `Refusing to POST to ${environment}: set N8N_APPROVED_PRODUCTION_WRITE="<what was approved>".`,
    );
  }
  console.log(`[n8n] PRODUCTION WRITE: POST new workflow — approved as "${approval}"`);
  const created = await createWorkflow(payload);
  if (created.active) {
    throw new Error(`Created ${created.id} but it came up ACTIVE — deactivate it now and investigate.`);
  }
  console.log("");
  console.log(`Created ${created.id}, active=${created.active}, ${created.nodes?.length} node(s).`);
  console.log(`Next: put this id in registry.yaml under ${environment}.remoteWorkflowId, then`);
  console.log(`\`pnpm n8n:export --id ${logicalId}\` to canonicalise.`);
}

async function main() {
  const logicalId = arg("id");
  const nodesArg = arg("nodes");
  const apply = process.argv.includes("--apply");
  const environment = currentEnvironment();

  const addArg = arg("add");
  const rewireArg = arg("rewire");
  const credentialsArg = arg("credentials-from");
  const create = process.argv.includes("--create");
  if (!logicalId) throw new Error("Pass --id <logical-id>.");
  const toggling = process.argv.includes("--activate") || process.argv.includes("--deactivate");
  if (!create && !toggling && !nodesArg && !addArg && !rewireArg) {
    throw new Error(
      'Pass --nodes "Node A" (update existing), --add "Node B" (add new nodes), ' +
        '--rewire "Node C" (replace outgoing connections) or --create (POST a brand-new workflow).',
    );
  }
  if (create && (nodesArg || addArg || rewireArg)) {
    throw new Error("--create posts the whole artifact; it does not combine with --nodes/--add/--rewire.");
  }

  // Flipping a workflow on or off is not a deploy: nothing about the graph changes, and no diff
  // would show it. It is the single most consequential thing this tool can do — a schedule starts
  // firing, or stops — so it is its own path, gated the same way, and it prints what it saw before
  // and after rather than trusting the call's return.
  if (process.argv.includes("--activate") || process.argv.includes("--deactivate")) {
    const on = process.argv.includes("--activate");
    const e = (loadRegistry().workflows ?? []).find((w) => w.id === logicalId);
    const rid = e?.environments?.[environment]?.remoteWorkflowId;
    if (!rid) throw new Error(`registry.yaml has no ${environment} remoteWorkflowId for "${logicalId}".`);
    const before = await getWorkflow(rid);
    console.log(`workflow    : ${logicalId} → ${rid} (${environment})`);
    console.log(`live name   : ${before.name}`);
    console.log(`active      : ${before.active} → ${on}`);
    if (before.active === on) {
      console.log(`Already ${on ? "active" : "inactive"} — nothing to do.`);
      return;
    }
    if (!apply) {
      console.log(`DRY RUN — nothing changed. Re-run with --apply (and N8N_APPROVED_PRODUCTION_WRITE set).`);
      return;
    }
    const approval = process.env.N8N_APPROVED_PRODUCTION_WRITE?.trim();
    if (!approval) throw new Error(`Refusing to ${on ? "activate" : "deactivate"}: set N8N_APPROVED_PRODUCTION_WRITE.`);
    console.log(`[n8n] PRODUCTION ${on ? "ACTIVATE" : "DEACTIVATE"}: ${rid} — approved as "${approval}"`);
    await (on ? activateWorkflow(rid) : deactivateWorkflow(rid));
    // Read it back. The call returning 200 is not the same as the instance having changed.
    const after = await getWorkflow(rid);
    if (after.active !== on) throw new Error(`FAILED: still active=${after.active} after the call.`);
    console.log(`Done. active=${after.active}.`);
    return;
  }

  // A brand-new workflow has no live counterpart to diff against, so the surgical path below —
  // which exists to prove that nothing outside the named nodes moved — has nothing to protect.
  // It gets its own short path instead of a pile of `if (create)` branches through that one.
  if (create) {
    await createFromArtifact(logicalId, environment, apply, credentialsArg);
    return;
  }
  const nodeNames = (nodesArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const addNames = (addArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rewireNames = (rewireArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // "New Node=Live Node" pairs. The donor is read from LIVE, never from the artifact — the artifact
  // is credential-sanitised, so this is the only way an added node can end up authenticated, and no
  // credential id or value ever has to be written down in the repository.
  const credentialPairs = (credentialsArg ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [target, donor] = pair.split("=").map((s) => s?.trim());
      if (!target || !donor) throw new Error(`--credentials-from expects "New Node=Live Node", got "${pair}".`);
      return { target, donor };
    });

  const entry = (loadRegistry().workflows ?? []).find((w) => w.id === logicalId);
  if (!entry) throw new Error(`Logical id "${logicalId}" is not in registry.yaml.`);
  const remoteId = entry.environments?.[environment]?.remoteWorkflowId;
  if (!remoteId) throw new Error(`registry.yaml has no ${environment} remoteWorkflowId for "${logicalId}".`);

  const artifactPath = join(WORKFLOWS_ROOT, entry.path.replace(/^automation\/n8n\/workflows\//, ""), "workflow.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const live = await getWorkflow(remoteId);

  console.log(`workflow    : ${logicalId} → ${remoteId} (${environment})`);
  console.log(`live name   : ${live.name}`);
  console.log(`live active : ${live.active}`);
  console.log(`nodes       : live ${live.nodes?.length}, artifact ${artifact.nodes?.length}`);
  if (nodeNames.length) console.log(`update      : ${nodeNames.join(", ")}`);
  if (addNames.length) console.log(`add         : ${addNames.join(", ")}`);
  if (rewireNames.length) console.log(`rewire      : ${rewireNames.join(", ")}`);
  console.log("");

  // A structural change to a workflow that is currently serving traffic is a different act from
  // re-parameterising one, and it must be asked for out loud.
  if (live.active && (addNames.length || rewireNames.length) && !process.argv.includes("--allow-active")) {
    throw new Error(
      `"${logicalId}" is ACTIVE on ${environment}. --add/--rewire re-shape the graph while it is\n` +
        `serving traffic; re-run with --allow-active if that is genuinely intended, or deactivate first.`,
    );
  }

  // Snapshot the pre-write live parameters of EVERY node, plus the connection graph, so post-write
  // verification can prove that untargeted nodes and existing edges are untouched.
  const liveBefore = new Map((live.nodes ?? []).map((n) => [n.name, stable(n.parameters)]));
  const connBefore = stable(live.connections ?? {});
  const addedSources = [];
  const rewiredSources = [];

  let changed = 0;

  // Settings are otherwise never managed by this tool, so drift in them is invisible: a workflow
  // created through the API came up without `executionOrder` or `errorWorkflow` and nothing said so.
  // Opt-in, because a PUT replaces settings wholesale and the API silently drops some keys.
  if (process.argv.includes("--settings")) {
    const { kept, dropped } = filterSettings({ availableInMCP: true, ...(artifact.settings ?? {}) });
    const before = stable(live.settings ?? {});
    const merged = { ...(live.settings ?? {}), ...kept };
    if (stable(merged) !== before) {
      console.log(`~ settings:`);
      console.log(`    LIVE     ${JSON.stringify(live.settings ?? {})}`);
      console.log(`    ARTIFACT ${JSON.stringify(merged)}`);
      live.settings = merged;
      changed += 1;
    }
    if (Object.keys(dropped).length) {
      console.log(`  (API rejects ${Object.keys(dropped).join(", ")} — instance defaults apply)`);
    }
  }

  for (const name of nodeNames) {
    const liveNode = nodeByName(live, name);
    const artNode = nodeByName(artifact, name);
    if (!liveNode) throw new Error(`Node "${name}" not found on the LIVE workflow.`);
    if (!artNode) throw new Error(`Node "${name}" not found in the artifact.`);
    if (liveNode.type !== artNode.type) {
      throw new Error(`Node "${name}" type drift: live ${liveNode.type} vs artifact ${artNode.type}. Reconcile first.`);
    }

    const before = stable(liveNode.parameters);
    const after = stable(artNode.parameters);
    if (before === after && liveNode.typeVersion === artNode.typeVersion) {
      console.log(`= ${name}: already matches artifact, nothing to do.`);
      continue;
    }
    console.log(`~ ${name}:`);
    if (liveNode.typeVersion !== artNode.typeVersion) {
      console.log(`    typeVersion: ${liveNode.typeVersion} → ${artNode.typeVersion}`);
    }
    console.log(`    LIVE     parameters: ${before}`);
    console.log(`    ARTIFACT parameters: ${after}`);
    console.log("");

    // Apply onto the live node in place — preserving credentials, webhookId, id, position.
    liveNode.parameters = artNode.parameters;
    liveNode.typeVersion = artNode.typeVersion;
    changed += 1;
  }

  // --add: append brand-new nodes (and their outgoing edges) that exist in the artifact but not on
  // live. New nodes carry no credentials, so they can be copied verbatim; existing nodes and edges
  // are never touched. Refuse anything that would collide with or rewire the live graph.
  for (const name of addNames) {
    const artNode = nodeByName(artifact, name);
    if (!artNode) throw new Error(`--add node "${name}" not found in the artifact.`);
    if (nodeByName(live, name)) throw new Error(`--add node "${name}" already exists on live — use --nodes to update it.`);

    const artConn = (artifact.connections ?? {})[name];
    for (const port of artConn?.main ?? []) {
      for (const edge of port ?? []) {
        const targetExists = nodeByName(live, edge.node) || addNames.includes(edge.node);
        if (!targetExists) throw new Error(`--add node "${name}" wires to "${edge.node}", which is not on live nor being added.`);
      }
    }
    if (live.connections?.[name]) throw new Error(`live already has connections from "${name}" — refusing to overwrite.`);

    console.log(`+ ${name} (${artNode.type})${artConn ? ` → ${(artConn.main?.[0] ?? []).map((e) => e.node).join(", ")}` : ""}`);
    live.nodes.push({ ...artNode });
    if (artConn) {
      live.connections = live.connections ?? {};
      live.connections[name] = artConn;
      addedSources.push(name);
    }
    changed += 1;
  }

  // --credentials-from: an --added node arrives credential-less, because the artifact is sanitised.
  // Rather than reintroduce a credential id into the repository, copy the block off a LIVE node that
  // already uses the same one. Only aliases are printed; the id is data we pass through, never show.
  for (const { target, donor } of credentialPairs) {
    // Granting a credential to a node that has none is allowed; swapping one that exists is not.
    // A node created by --create comes up unauthenticated because the artifact is sanitised, and
    // refusing to fix that would mean the only route is the UI — outside the repository, which is
    // the source of truth for automation (ADR-0016).
    const targetLive = nodeByName(live, target);
    const targetHasCreds = Boolean(targetLive?.credentials && Object.keys(targetLive.credentials).length);
    if (!addNames.includes(target) && targetHasCreds) {
      throw new Error(
        `--credentials-from target "${target}" already has a credential; this tool never swaps one. ` +
          `Detach it in n8n first if that is really the intent.`,
      );
    }
    if (!addNames.includes(target) && !targetLive) {
      throw new Error(`--credentials-from target "${target}" is neither in --add nor on the LIVE workflow.`);
    }
    // "logical-id:Node" reads the donor from another workflow; a bare name reads it from this one.
    const [donorWorkflow, donorName] = donor.includes(":")
      ? donor.split(":").map((x) => x.trim())
      : [null, donor];
    let donorGraph = live;
    if (donorWorkflow) {
      const de = (loadRegistry().workflows ?? []).find((w) => w.id === donorWorkflow);
      const dr = de?.environments?.[environment]?.remoteWorkflowId;
      if (!dr) throw new Error(`No ${environment} remoteWorkflowId for donor workflow "${donorWorkflow}".`);
      donorGraph = await getWorkflow(dr);
    }
    const donorNode = nodeByName(donorGraph, donorName);
    if (!donorNode) throw new Error(`--credentials-from donor "${donor}" is not on the donor workflow.`);
    if (!donorNode.credentials || !Object.keys(donorNode.credentials).length) {
      throw new Error(`--credentials-from donor "${donor}" has no credentials to copy.`);
    }
    const targetNode = nodeByName(live, target);
    if (targetNode.type !== donorNode.type) {
      throw new Error(`"${target}" is ${targetNode.type} but donor "${donor}" is ${donorNode.type}.`);
    }
    targetNode.credentials = JSON.parse(JSON.stringify(donorNode.credentials));
    const aliases = Object.entries(targetNode.credentials).map(([type, ref]) => `${type}:${ref?.name}`);
    console.log(`  ${target} ← credentials of "${donor}" (${aliases.join(", ")})`);
    // Granting a credential IS a change. Without this the run exits at "nothing to deploy" whenever
    // the parameters happen to match, and the node stays unauthenticated while the log says it was
    // wired — the same shape of lie as a 200 on a PATCH that changed nothing.
    changed += 1;
  }

  // --rewire: replace the outgoing connections of nodes that ALREADY exist on live. --add cannot do
  // this (it refuses a node that exists), and --nodes only touches parameters — so without this a
  // structural change has to be made by hand in the UI, which is how a graph stops matching its
  // artifact. Every target must end up existing, or the write would strand an edge.
  for (const name of rewireNames) {
    if (!nodeByName(live, name)) throw new Error(`--rewire node "${name}" is not on the LIVE workflow.`);
    if (!nodeByName(artifact, name)) throw new Error(`--rewire node "${name}" is not in the artifact.`);
    if (addNames.includes(name)) throw new Error(`"${name}" is in both --add and --rewire; --add already carries its edges.`);

    const artConn = (artifact.connections ?? {})[name];
    for (const port of artConn?.main ?? []) {
      for (const edge of port ?? []) {
        if (!nodeByName(live, edge.node)) {
          throw new Error(`--rewire "${name}" wires to "${edge.node}", which is not on live nor being added.`);
        }
      }
    }

    const before = stable((live.connections ?? {})[name] ?? null);
    const after = stable(artConn ?? null);
    if (before === after) {
      console.log(`= ${name}: connections already match artifact.`);
      continue;
    }
    const targets = (conn) => (conn?.main ?? []).map((port) => (port ?? []).map((e) => e.node).join(" + ") || "∅").join(" | ") || "∅";
    console.log(`⇄ ${name}: ${targets((live.connections ?? {})[name])} → ${targets(artConn)}`);

    live.connections = live.connections ?? {};
    if (artConn) live.connections[name] = artConn;
    else delete live.connections[name];
    rewiredSources.push(name);
    changed += 1;
  }

  if (changed === 0) {
    console.log("Nothing to deploy — live already matches the artifact for the named nodes.");
    return;
  }
  if (addNames.length || rewireNames.length) console.log("");

  // PUT replaces settings wholesale, and the API rejects some UI-set keys — surface any that the
  // write will drop, so a settings reset is never silent (shown on dry-run too).
  const droppedSettings = Object.keys(filterSettings(live.settings).dropped);
  if (droppedSettings.length) {
    console.log(`NOTE: the public API rejects these settings keys; PUT resets them to their default:`);
    console.log(`      ${droppedSettings.join(", ")}`);
    console.log("");
  }
  // availableInMCP=true is what lets the repo's MCP tooling (inventory/check-drift/export) READ this
  // workflow; its default is false. It is normally in ALLOWED_SETTINGS so it is preserved — but if a
  // future instance rejects it, it would land in `dropped` and the PUT would silently disable MCP
  // access with no public-API way to restore it. Refuse in that case unless explicitly acknowledged.
  if (droppedSettings.includes("availableInMCP") && !process.argv.includes("--allow-mcp-reset")) {
    throw new Error(
      "This instance rejects availableInMCP on PUT, so the write would reset it to false and disable\n" +
        "MCP tooling access (inventory/check-drift/export), restorable only in the n8n UI. Re-run\n" +
        "with --allow-mcp-reset to accept that, and restore the toggle in the UI afterwards.",
    );
  }

  if (!apply) {
    console.log(`DRY RUN — ${changed} node(s) would change. Re-run with --apply (and`);
    console.log(`N8N_APPROVED_PRODUCTION_WRITE set) to write.`);
    return;
  }

  const approval = process.env.N8N_APPROVED_PRODUCTION_WRITE?.trim();
  if (environment !== "development" && !approval) {
    throw new Error(
      `Refusing to PUT to ${environment}: set N8N_APPROVED_PRODUCTION_WRITE="<what was approved>" ` +
        `for this invocation only (see docs/reference/n8n/environments.md).`,
    );
  }
  console.warn(`[n8n] PRODUCTION WRITE: PUT ${remoteId} — approved as "${approval}"`);

  await updateWorkflow(remoteId, live);

  // Verify: re-fetch and prove the targeted/added nodes match the artifact and nothing else moved.
  const after = await getWorkflow(remoteId);
  const touched = new Set([...nodeNames, ...addNames]);
  const problems = [];
  for (const name of touched) {
    const artNode = nodeByName(artifact, name);
    const liveNode = nodeByName(after, name);
    if (!liveNode || stable(liveNode.parameters) !== stable(artNode.parameters)) {
      problems.push(`"${name}" did not land as expected`);
    }
  }
  for (const node of after.nodes ?? []) {
    if (touched.has(node.name)) continue;
    if (liveBefore.get(node.name) !== stable(node.parameters)) {
      problems.push(`untargeted node "${node.name}" changed`);
    }
  }
  // Credentials on added nodes must have survived the round trip, or the node is authenticated
  // nowhere and only fails at runtime, inside a client's system.
  for (const { target, donor } of credentialPairs) {
    const landed = nodeByName(after, target)?.credentials;
    if (!landed || !Object.keys(landed).length) {
      problems.push(`"${target}" landed WITHOUT the credentials of "${donor}"`);
    }
  }
  // Every pre-existing connection source must be byte-identical; only added and explicitly rewired
  // sources may differ. Checked in both directions so a vanished source is caught too.
  const afterConn = after.connections ?? {};
  const beforeConn = JSON.parse(connBefore);
  const allowedConnChange = new Set([...addedSources, ...rewiredSources]);
  for (const src of new Set([...Object.keys(afterConn), ...Object.keys(beforeConn)])) {
    if (allowedConnChange.has(src)) continue;
    if (stable(beforeConn[src]) !== stable(afterConn[src])) {
      problems.push(`connections from "${src}" changed`);
    }
  }
  for (const src of rewiredSources) {
    if (stable(afterConn[src]) !== stable((artifact.connections ?? {})[src] ?? null)) {
      problems.push(`rewired connections from "${src}" did not land as expected`);
    }
  }
  if (problems.length) throw new Error(`Post-write verification FAILED:\n  - ${problems.join("\n  - ")}`);

  const summary = [
    nodeNames.length && `${nodeNames.length} updated`,
    addNames.length && `${addNames.length} added`,
    rewiredSources.length && `${rewiredSources.length} rewired`,
  ]
    .filter(Boolean)
    .join(", ");
  console.log("");
  console.log(`Deployed. ${summary}; all untouched nodes and edges unchanged. active=${after.active}.`);
  console.log("Next: re-run `pnpm n8n:check-drift --id " + logicalId + "` and `pnpm n8n:export` to re-canonicalise.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
