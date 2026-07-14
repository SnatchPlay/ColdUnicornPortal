# AGENTS.md — Codex / non-Claude Agents

This repository uses [`CLAUDE.md`](./CLAUDE.md) as the **canonical** project prompt and behavioural
contract for every coding agent, including Codex.

## Mandatory

- Read [`CLAUDE.md`](./CLAUDE.md) first, for every task. Treat its rules as binding.
- If any local instruction conflicts with `CLAUDE.md`, `CLAUDE.md` wins.
- Do not duplicate rules into this file. It is a pointer, not a second copy — a rule stated in two
  places drifts.

## The one thing to get right

The frontend never calls `supabase.from(...)`. All data flows through the **`orm-gateway` edge
function**; each page loads its own data via one gateway action and a per-page hook with a
`loadIdRef` stale guard. There is **no global snapshot** and **no `useCoreData()`** — both were
deleted. See [ADR-0008](./docs/adr/0008-orm-gateway-edge-function.md) and
[ADR-0009](./docs/adr/0009-per-page-data-contracts.md).

## Skills

Project skills are plain markdown — read the file directly if your agent cannot invoke skills:

| Skill | Read for |
|---|---|
| [`portal-page`](./.claude/skills/portal-page/SKILL.md) | New page / route / tab |
| [`gateway-action`](./.claude/skills/gateway-action/SKILL.md) | New data read/write |
| [`rls-migration`](./.claude/skills/rls-migration/SKILL.md) | Schema, RLS, migration |
| [`visual-verify`](./.claude/skills/visual-verify/SKILL.md) | Verifying a UI change |

They are mirrored at `.agents/skills/` (symlinks to the same files).

## Quick links

- Canonical prompt: [`CLAUDE.md`](./CLAUDE.md)
- Reuse index (search before you build): [`docs/reuse-catalog.md`](./docs/reuse-catalog.md)
- Design system: [`docs/reference/design-system.md`](./docs/reference/design-system.md)
- Commands, quality gate, safety: [`docs/development-standards-and-operations.md`](./docs/development-standards-and-operations.md)
- Architecture decisions: [`docs/ADR.md`](./docs/ADR.md)
- Functional reference: [`docs/reference/functional/INDEX.md`](./docs/reference/functional/INDEX.md)
