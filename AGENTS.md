# AGENTS.md - Codex Working Agreement

This repository uses [`CLAUDE.md`](./CLAUDE.md) as the canonical project prompt and behavioral contract for coding agents, including Codex.

## Mandatory

- Read and follow [`CLAUDE.md`](./CLAUDE.md) first for every task.
- Treat all rules in `CLAUDE.md` as binding for Codex work in this repository.
- If any local instruction conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

## Skills

Use the same skills policy defined in `CLAUDE.md` (section "Skills (use them, don't reinvent)").

Required defaults:

- Trigger `supabase` for any Supabase/Auth/RLS/Edge Function/schema/migration task.
- Trigger `supabase-postgres-best-practices` for SQL/query/performance/schema design work.
- Run `simplify` after non-trivial changes.
- Run `security-review` for auth/RLS/mutation/role-gating changes.
- Run `review` for multi-file changes or when user asks for review.

## Tools

Use the same toolchain and verification workflows documented in `CLAUDE.md`:

- MCP servers and usage rules from `CLAUDE.md` section "Tools you have access to" and `docs/reference/agent-tooling.md`.
- Visual verification workflow (Playwright) for UI changes.
- RLS verification workflow (EXPLAIN ANALYZE + role row checks) for DB/RLS changes.
- Quality gate from `CLAUDE.md` section "Quality gate before \"done\"".

## Quick links

- Canonical prompt: [`CLAUDE.md`](./CLAUDE.md)
- Functional reference: [`docs/reference/functional/INDEX.md`](./docs/reference/functional/INDEX.md)
- Tooling: [`docs/reference/agent-tooling.md`](./docs/reference/agent-tooling.md)
- Copilot alignment: [`.github/copilot-instructions.md`](./.github/copilot-instructions.md)
