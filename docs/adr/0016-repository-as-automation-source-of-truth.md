# ADR 0016: The repository is the source of truth for automation

## Status
Accepted 2026-07-21

## Context

Until now n8n was a separate world. 33 workflows ran in production; **none** of them existed in this
repository, in any form. There was no export, no registry, no per-workflow documentation, and no way
for a reviewer — human or agent — to answer "what does the automation actually do?" without opening
the n8n editor.

The cost of that separation is not hypothetical. The 2026-07-21 inventory found:

- **`[child-3] TAG_ATTACHED · OOO`** writes `leads.qualification = 'OOO'` and
  `leads.expected_return_date` directly, which [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md)
  removed from the model. The deferred migration `20260722z` drops both. Nothing in the repository
  knew a live workflow depended on them.
- The de-facto source of truth for OOO state is a **Google Sheet**, not Supabase — a fact recorded
  nowhere in the functional reference, which described the Supabase write-path as if it were live.
- The same workflow writes a fallback date (`$now + 14d`) into a field named "Expected Return Date",
  the precise defect ADR-0015 §2 exists to prevent.
- Per-client Bison API keys are read out of a spreadsheet cell and injected into an `Authorization`
  header, while [11-integrations §3](../reference/functional/11-integrations.md) documents
  `client_sequencers.api_key` as the source.

Every one of those is a contradiction between a documented decision and a running workflow, and every
one survived because the workflow was not reviewable. A workflow that can be edited in a browser, by
one person, with no diff and no approval, is not a place to keep a business invariant.

## Decision

### 1. A five-level hierarchy, and workflows are the bottom level

| Level | What | Where |
|---|---|---|
| 1 | Business rules, lifecycles, invariants | [BUSINESS_LOGIC.md](../BUSINESS_LOGIC.md), [reference/processes/](../reference/processes/) |
| 2 | Architecture decisions, ownership, security model | [docs/adr/](.) |
| 3 | Data contracts — schema, RLS, RPC signatures, gateway payloads | [migrations](../../supabase/migrations/), [03-data-model](../reference/functional/03-data-model.md), [orm-gateway-contract.ts](../../src/app/data/orm-gateway-contract.ts) |
| 4 | Application — portal UI, permissions, metrics | `src/`, [04-metrics-catalog](../reference/functional/04-metrics-catalog.md) |
| 5 | **Automation — n8n workflows** | [automation/n8n/](../../automation/n8n/) |

**A conflict is resolved downward.** If a workflow contradicts levels 1–4, the workflow is wrong. It
is never a reason to amend a business rule, and never a reason to change a database contract for the
convenience of an automation.

### 2. The repository is canonical; the n8n instance is a deployment target

After a workflow is imported, `automation/n8n/workflows/<domain>/<slug>/` is the reference copy.
A change made only in the n8n UI is **drift** — a defect to be reconciled, not a new baseline.
`pnpm n8n:check-drift` reports it and deliberately refuses to auto-resolve it: which side is right is
a business judgement, and a script that picked a winner would make that judgement silently.

### 3. Identity is a logical ID, never a name or a remote ID

Workflow names are edited in the UI; remote IDs are per-environment. Neither can be an identity, so
every managed workflow gets a stable kebab-case logical ID recorded in
[`registry.yaml`](../../automation/n8n/registry.yaml).

### 4. Invariants belong in the database, reachable through RPCs

This restates [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md) §5 as a general rule: where an
ingestion RPC contract exists, automation calls it instead of writing tables. `pnpm n8n:validate`
enforces this for `leads`, `replies`, `ooo_followups` and `sequencer_contacts`.

### 5. Contradictions are registered and expire — never hidden

Importing a live workflow means importing its defects. Deleting a rule to make CI green destroys the
signal; leaving CI permanently red makes the gate meaningless. So a manifest may carry
`knownViolations`, each requiring a reason, a tracking link and an **expiry date**. Past the date the
finding becomes an error again, so accepted debt cannot quietly become permanent.

### 6. Write access is closed by default

The only n8n credential available is an instance token that points at **production** and carries
`workflow:delete` and `workflow:publish`. There is no development instance. Therefore all tracked
tooling is read-only: `callWriteTool()` refuses unless `N8N_ENV=development`. This is a policy
guard, not a security boundary — the token itself is unrestricted, so the real control is that
nobody, human or agent, calls a write tool against production without an explicit decision.

## Alternatives considered

- **Keep n8n as the source of truth and generate docs from it.** Rejected: it inverts the hierarchy.
  The OOO workflow would then have been evidence that `leads.qualification='OOO'` is correct, when it
  is the thing ADR-0015 removed.
- **Two-way automatic sync.** Rejected: without a conflict policy it silently picks a winner, and the
  losing side is sometimes the reviewed one.
- **Store the n8n SDK code instead of `workflow.json`.** Tempting — the official MCP builds workflows
  from SDK code (`create_workflow_from_code`), so code is the natural authoring format. Rejected *for
  imports*: there is no tool that decompiles an existing workflow back to SDK code, so an imported
  artifact would have to be hand-rewritten before it could be committed, and the committed copy would
  no longer be the thing that runs. `workflow.json` is what the instance actually returns and is
  therefore diffable against it. When a workflow is authored **new**, SDK code may be committed
  alongside `workflow.json`; the JSON stays the artifact drift is measured on.
- **Regenerate node IDs on export for stability.** Rejected: node IDs are how `update_workflow`
  patches an existing workflow, and rewriting them destroys review history.

## Consequences

- A new dependency, `js-yaml`, is declared explicitly (it was already present transitively).
- `pnpm n8n:validate` runs on every pull request with no network and no credential. The MCP-based
  checks (`n8n:inventory`, `n8n:check-drift`) need a token and stay manual or secured-CI only.
- The 32 workflows not yet imported are `orphan` until inventoried. They are listed, not rewritten —
  see [migration-backlog.md](../reference/n8n/migration-backlog.md). Rewriting them all at once would
  produce a large diff nobody can review, against workflows whose behaviour is not yet documented.
- The pilot import (`ooo-detect-and-log`) is committed **with its defects intact and registered**.
  It documents reality; it is not a reference implementation.

## Related
- [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md) — the OOO/NRR model and the RPC contract this rule protects.
- [ADR-0008](0008-orm-gateway-edge-function.md) — the portal's equivalent rule: one gateway, RLS as the boundary.
- [ADR-0001](0001-live-supabase-source-of-truth.md) — Supabase is the only data system; a Google Sheet holding OOO state contradicts it, and that contradiction is now tracked.
- [11-integrations](../reference/functional/11-integrations.md) — the n8n ↔ portal boundary.
