# Workflow lifecycle

Every path starts by reading the business rule, never by opening the n8n editor.

## Before any n8n change

1. Read the **business process** ([processes/](../processes/)).
2. Read the governing **ADRs** and the **data contracts** (`03-data-model`, the RPC migration).
3. Read the **manifest** of the workflow you are about to touch.
4. Decide whether the change also needs an ADR, a migration, an RPC change, a portal change or a
   metric change. If it does, that comes first — the workflow is level 5.

**Do not assume the current workflow is correct.** It is evidence of what runs, not of what should
run ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md)).

---

## A · Importing a workflow that is not yet in Git

The one-time migration path. This is what was done for the pilot.

```bash
pnpm n8n:inventory                       # find it, note the remote id
pnpm n8n:export --remote-id <id> --domain <domain> --slug <slug>
```

Then, by hand:

1. `manifest.yaml` — describe what it **does today**, plus `targetContract` for what it must become.
2. `README.md` — purpose, flow, outputs, **defects**, migration, manual verification.
3. `contracts/` — the input payload, and the RPC contract it should be calling.
4. `fixtures/` — synthetic, one per case, each with a `_fixture` note.
5. Register it in `registry.yaml` (logical ID + remote ID per environment).
6. Link it from the process document and add rows to [traceability.md](../traceability.md).
7. Record every contradiction in `knownViolations` with a reason, tracking link and expiry.
8. `pnpm n8n:validate` → must pass.

**Do not rewrite the workflow while importing it.** Import records reality; changing behaviour is a
separate, reviewable change. An import diff that also alters logic cannot be reviewed as either.

---

## B · Changing an existing managed workflow

1. Find it by **logical ID** in `registry.yaml`.
2. Re-read the process document and the manifest.
3. `pnpm n8n:check-drift --id <logical-id>` — reconcile before you change anything. Editing on top of
   unreconciled drift silently discards someone's change.
4. Make the change in the repository artifact.
5. Apply it to the **development** instance and re-export.
6. `pnpm n8n:validate`, then re-run drift.
7. **Do not publish.** Activation is a separate, explicit decision.
8. Update the manifest, the process doc and the traceability matrix in the same change.

> Blocked today: there is no development instance, so steps 5–7 cannot be performed without touching
> production. See [environments.md](environments.md).

---

## C · Building a new workflow

1. Business process document first — if one does not exist, write it.
2. Check the registry and the live instance for something reusable (there are already `[HUB]` and
   `[CRM child]` sub-workflow patterns; extend rather than fork).
3. `manifest.yaml` + `README.md` + `contracts/` + `fixtures/` **before** the graph.
4. Build with the official n8n MCP: `search_nodes` → `get_node_types` → SDK code →
   `validate_workflow`.
5. `create_workflow_from_code` against **development**.
6. **Do not activate.**
7. Fetch it back, sanitize, normalize, commit as `workflow.json`.
8. Compare remote against repository; run `pnpm n8n:validate`.
9. Test-execute against a **sanitized fixture only** — never live data.
10. Record the verification result in the manifest.

---

## The SDK authoring contract

`update_workflow` and `create_workflow_from_code` take **SDK code**, not workflow JSON, and there is
no decompiler. Every change therefore means re-authoring the whole graph, so the exact shape matters:
a wrong one is accepted, reports the right `nodeCount`, and produces a **different workflow**.

Measured against the production instance on 2026-07-22 by creating throwaway workflows and reading
them back. Each rule below is a shape that validated cleanly and was still wrong.

**Node shape.** `version` at the top level, parameters nested under `config.parameters`:

```js
const node = {
  name: "[S] record_ooo_followup",
  type: "n8n-nodes-base.postgres",
  version: 2.6,
  config: {
    parameters: { operation: "executeQuery", query: "…", options: {} },
    onError: "continueRegularOutput",
  },
};
workflow({ name: "…" }).add(trigger).to(node)
```

| Shape | Result |
|---|---|
| `{name, type, version, config: {parameters}}` | **correct** |
| `{name, type, typeVersion, parameters}` (raw n8n JSON) | `nodeCount` is right, `typeVersion` resets to 1 and **every parameter is silently dropped** |
| `{name, type, version, config: {…params directly…}}` | `typeVersion` survives, parameters are still dropped |
| `{type, version, config}` with no top-level `name` | node is skipped entirely; `nodeCount` 0 |

**The oracle for "did the parameters land" is `publish_workflow`.** A parameterless graph fails to
activate with `Cannot read properties of undefined (reading 'map'/'length')`. `get_workflow_details`
returns node parameters only for a workflow that has an **active version**, so a draft always reads
back as a bare summary — do not mistake that for data loss, and do not use it as proof of success.

**Connections.** `.add(x).to(y)` chains. Two different meanings that are easy to confuse:

```js
.add(t).to(a).add(t).to(b)   // main:[[a, b]]  — one output port, parallel fan-out ← branch L / branch S
.add(t).to([a, b])           // main:[[a],[b]] — output 0 → a, output 1 → b     ← if/filter branches
```

Using `.to([a, b])` on a single-output node wires the second target to an output port that does not
exist. It validates. Reserve the array form for `if` / `filter` / `switch`.

**What is preserved and what is not.**

- **Credentials are re-attached automatically.** New nodes come back with an
  `autoAssignedCredentials` list in the tool result — n8n matches by credential type. Verify it names
  the node you added; an empty list on a node that needs auth means it will fail at runtime.
- **`webhookId` is regenerated.** The production URL survives only because it is derived from
  `parameters.path`. Re-authoring a webhook workflow **without** an explicit `path` changes its URL
  and silently stops delivery.
- **Positions are normalized.** Cosmetic drift in the artifact; re-export after every change.

**Prove fidelity before touching the live workflow.** `create_workflow_from_code` a throwaway copy
first, read it back, and diff every untouched node (type, typeVersion, parameters) plus every edge
against the committed artifact. Then archive the copy. The instance count must return to what it was.

---

## Direction of synchronisation

After import, **the repository is canonical**. The failure mode this prevents:

```
someone edits in the n8n UI
  → the change never reaches Git
    → the portal, the docs and the tests still describe the old behaviour
      → the next person "fixes" the discrepancy in the wrong direction
```

**Rule: every managed workflow change ends in a committed artifact.**

When drift is detected:

1. Report it — `pnpm n8n:check-drift` exits non-zero.
2. Fetch the remote version and show the diff.
3. **Do not auto-overwrite either side.**
4. Decide which version matches the business process — that is a judgement, not a merge.
5. Bring both to the same state, and commit.

There is no two-way automatic sync, and there will not be one without an explicit conflict policy.

---

## Classification

`pnpm n8n:inventory` labels every live workflow:

| Label | Meaning |
|---|---|
| **managed** | in the registry, `workflow.json` committed — the repository owns it |
| **observed** | in the registry and documented, artifact not yet imported (legitimate mid-migration) |
| **orphan** | live on the instance, not in the registry — nobody has claimed it |
| **missing** | in the registry, absent from the instance (deleted remotely, or wrong environment) |

`observed` lets a workflow be documented before it is imported, so the backlog can be described
honestly without a rushed import.
