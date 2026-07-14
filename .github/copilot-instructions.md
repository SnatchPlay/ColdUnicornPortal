# Copilot Project Instructions

This repository uses [`CLAUDE.md`](../CLAUDE.md) as the canonical working agreement for all agents.

Mandatory:

- Treat `CLAUDE.md` as the contract. Apply it by default for every task in this workspace.
- If any guidance here conflicts with `CLAUDE.md`, follow `CLAUDE.md`.
- Rules are not restated here — a rule kept in two places drifts. This file is a pointer only.

The one thing to get right: the frontend never calls `supabase.from(...)`. All data goes through the
`orm-gateway` edge function, and each page loads its own data (no global snapshot, no `useCoreData()`
— both deleted). See [ADR-0008](../docs/adr/0008-orm-gateway-edge-function.md) and
[ADR-0009](../docs/adr/0009-per-page-data-contracts.md).

Start here:

- Contract: [`CLAUDE.md`](../CLAUDE.md)
- Reuse index: [`docs/reuse-catalog.md`](../docs/reuse-catalog.md)
- Design system: [`docs/reference/design-system.md`](../docs/reference/design-system.md)
- Architecture decisions: [`docs/ADR.md`](../docs/ADR.md)
