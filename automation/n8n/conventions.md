# Artifact conventions

## Identity

The **logical ID** is the primary key: lowercase kebab-case, stable forever.

- A workflow **name** is edited in the n8n UI — not an identity.
- A **remote ID** is per-environment — not an identity.

Name it after what the workflow *does in the business*, not after its trigger or its position in a
chain: `ooo-detect-and-log`, not `child-3` or `tag-attached-handler`.

The directory slug matches the logical ID; the domain directory matches `manifest.domain`
(`pnpm n8n:validate` enforces both).

## Directory

```
workflows/<domain>/<slug>/
  workflow.json      required for lifecycle: managed
  manifest.yaml      required
  README.md          required
  contracts/*.json   JSON Schema — inputs, RPC payloads, external responses
  fixtures/*.json    synthetic examples + fixtures/README.md
```

Domains follow the business, not the vendor: `outreach`, `crm`, `ingestion`, `ops`.

## `workflow.json`

**Generated. Never hand-edit.** Produced only by `pnpm n8n:export`, which sanitizes and normalizes.

Removed on export: `credentials`, `pinData`, `staticData`, `webhookId`, `versionId`,
`activeVersionId`, `active`, `activeVersion`, `canExecute`, `parentFolderId`, `triggerCount`,
`scopes`, `shared`, `tags`, `meta`, `createdAt`, `updatedAt`, `settings.availableInMCP`.

Normalized: nodes sorted by name (n8n addresses connections *by name*, so this is semantically inert
and kills diff noise), object keys sorted recursively, 2-space JSON, trailing newline.

**Node IDs are preserved.** Regenerating them destroys review history and breaks `update_workflow`
patching.

## `manifest.yaml`

Required: `schemaVersion: 1`, `id`, `name`, `domain`, `owner`, `lifecycle`, `status`, `criticality`,
`businessProcess` (≥1 existing file).

Recommended: `architectureDecisions`, `triggers`, `reads`, `writes`, `targetContract`,
`portalSurfaces`, `metrics`, `credentials` (alias + type, **never a value**), `idempotency`,
`retryPolicy`, `cancellation`, `environments`.

`lifecycle`: `managed` (artifact committed) · `observed` (documented, not yet imported) · `orphan`.
`status`: `active` · `paused` · `deprecated` · `planned` · `unmanaged`.

### `knownViolations`

An imported workflow usually *does* contradict the current contract — that is why it is being brought
under control. Deleting the rule to make CI green destroys the signal; leaving CI red makes the gate
meaningless. So a violation may be accepted explicitly:

```yaml
knownViolations:
  - rule: business/direct-table-write     # the rule id from `pnpm n8n:validate`
    node: "Update rows in a table"        # optional, disambiguates
    reason: >-
      Why it exists and what evidence bounds the risk.
    trackedIn: docs/reference/n8n/migration-backlog.md#1-ooo-cutover
    expires: 2026-10-31
```

`reason`, `trackedIn` and `expires` are all required. Past `expires` the finding becomes an **error**
again, so accepted debt cannot quietly become permanent. An entry matching nothing is itself an error
— stale acceptances are removed, not left lying around.

## `README.md`

Purpose · inputs · flow · outputs · **known defects** · migration · observability · manual
verification. Be concrete about defects: an imported workflow's README is the honest record of what
is wrong with it.

## `contracts/`

JSON Schema (draft 2020-12) for webhook input, sub-workflow input, RPC request/response, external API
response, workflow output. Say in `description` whether the contract is **enforced** or merely
**reverse-engineered** — the difference matters to the next reader.

## `fixtures/`

Synthetic only. One file per case; the useful set is roughly: `valid-input`, a no-data variant,
`duplicate-event`, a missing-configuration case, a disabled case, and whatever terminal transitions
the process has.

Every fixture carries a `_fixture` note stating the case and that it is invented. Never derive one
from a production execution.

## Validation rules

`pnpm n8n:validate`, offline, on every PR:

- **structure** — unique node names/ids, connections resolve, a trigger exists
- **repository** — registered, manifest valid, business process exists, README present, JSON normalized
- **security** — no secrets, no `pinData`, no credential refs, no hardcoded auth headers, webhook auth
- **business** — no direct writes to RPC-owned tables (`leads`, `replies`, `ooo_followups`,
  `sequencer_contacts`); no `qualification IN ('OOO','NRR')`; no fallback date written into an
  expected-return field; retrying writers must declare an idempotency key
- **fixtures** — parse, conform to the input schema, carry provenance, contain no secrets
