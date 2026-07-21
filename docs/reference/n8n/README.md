# n8n

How automation is governed in this repository. **Read [ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md) first** — it is the decision these documents implement.

The one-line version: **the repository is canonical, the n8n instance is a deployment target, and a
workflow that contradicts a business rule is a defect in the workflow.**

## Files

| File | Answers |
|---|---|
| [mcp-setup.md](mcp-setup.md) | How do I connect Claude Code / the scripts to n8n? |
| [environments.md](environments.md) | What am I allowed to change, and where? |
| [security.md](security.md) | What must never be committed; open security findings |
| [workflow-lifecycle.md](workflow-lifecycle.md) | How do I add, change or import a workflow? |
| [migration-backlog.md](migration-backlog.md) | Which of the 33 live workflows are handled, and in what order? |
| [../../../automation/n8n/conventions.md](../../../automation/n8n/conventions.md) | What does an artifact directory look like? |

## Where things live

```
automation/n8n/
  registry.yaml                     index of every known workflow, keyed by logical ID
  conventions.md
  workflows/<domain>/<slug>/
    workflow.json                   canonical sanitized graph
    manifest.yaml                   contract: process, reads/writes, credentials, idempotency
    README.md                       purpose, flow, defects, migration
    contracts/                      JSON Schema for inputs / RPC payloads
    fixtures/                       synthetic examples, one per case

scripts/n8n/                        deterministic tooling (export, validate, drift)
docs/reference/processes/           the business rules workflows must obey
docs/reference/traceability.md      rule → table → RPC → portal → metric → workflow → test
```

## Commands

```bash
pnpm n8n:smoke          # read-only: prove the MCP connection works
pnpm n8n:inventory      # every live workflow, classified managed/observed/orphan/missing
pnpm n8n:validate       # OFFLINE: structure, secrets, business rules, fixtures  ← runs in CI
pnpm n8n:check-drift    # committed artifact vs live instance
pnpm n8n:export --remote-id <id> --domain <d> --slug <s>    # bring a workflow under control
```

Only `n8n:validate` runs in CI: it needs no network and no credential. Everything else needs the
token from `.env.local`.

## Rules that bite

1. **Never commit a credential.** `sanitize()` strips them, `scan.mjs` catches what it misses, and
   `n8n:export` refuses to write a file that still trips the scanner.
2. **Never use production as a sandbox.** There is no development instance today, so the write path
   is closed — see [environments.md](environments.md).
3. **Never activate a workflow automatically.**
4. **Where an ingestion RPC exists, call it.** Do not write `leads`, `replies`, `ooo_followups` or
   `sequencer_contacts` from a Postgres node ([ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) §5).
5. **A contradiction is registered, not hidden.** Use `knownViolations` with a reason, a tracking
   link and an expiry date.
6. **A remote change must end in a committed artifact.** Otherwise it is drift.

## Skills

The 14 official n8n skills (`n8n-io/skills`, tracked in `skills-lock.json`) are installed and cover
node configuration, expressions, error handling, sub-workflows and the workflow lifecycle. They
advise on *how to build n8n workflows well*. Like the design skills, **they never override
[CLAUDE.md](../../../CLAUDE.md) or the ADRs** — where n8n's generic advice and this repository's
business contract disagree, the contract wins.
