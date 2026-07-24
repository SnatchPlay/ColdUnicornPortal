# automation/n8n

Canonical artifacts for every n8n workflow this repository owns.

**The repository is the source of truth; the n8n instance is a deployment target**
([ADR-0016](../../docs/adr/0016-repository-as-automation-source-of-truth.md)).

- Governance, setup, security, lifecycle → [docs/reference/n8n/](../../docs/reference/n8n/README.md)
- Artifact layout and naming → [conventions.md](conventions.md)
- Index of all known workflows → [registry.yaml](registry.yaml)
- What is still unmanaged → [migration-backlog.md](../../docs/reference/n8n/migration-backlog.md)

```
workflows/<domain>/<slug>/
  workflow.json     canonical sanitized graph — never hand-edited
  manifest.yaml     contract: process, reads/writes, credentials, idempotency, knownViolations
  README.md         purpose, flow, outputs, defects, migration, verification
  contracts/        JSON Schema for inputs and RPC payloads
  fixtures/         synthetic examples, one per case
```

```bash
pnpm n8n:validate      # offline; runs in CI
pnpm n8n:inventory     # live instance, classified
pnpm n8n:check-drift   # artifact vs instance
```

Status: **1 managed, 32 orphan.** The pilot (`outreach/ooo-detect-and-log`) is committed **with its
defects intact and registered** — it documents what runs today, and is not a reference implementation.
