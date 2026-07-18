# Archive — historical, NOT authoritative

Nothing in this folder describes the current system. It is kept for diffing and provenance only.

**Do not use these files to answer a question about how the portal works today.** They predate the
ORM-gateway ([ADR-0008](../adr/0008-orm-gateway-edge-function.md)) and the per-page data-contract
cutover ([ADR-0009](../adr/0009-per-page-data-contracts.md)), so their data-flow and loading
descriptions are actively wrong.

Current sources of truth:

- Product scope → [BUSINESS_LOGIC.md](../BUSINESS_LOGIC.md)
- Implementation → [reference/functional/INDEX.md](../reference/functional/INDEX.md)
- Why → [ADR.md](../ADR.md)
- Design → [reference/design-system.md](../reference/design-system.md)

| File | Was | Superseded by |
|---|---|---|
| `MASTER_FUNCTIONAL_SPECIFICATION.md` | Pre-refactor mega-spec | `reference/functional/*` |
| `PROJECT_SPEC.md` | Original project spec | `BUSINESS_LOGIC.md` |
| `METRICS_AND_FILTERS_GUIDE.md` | Metrics/filters guide (orphaned, never linked) | [04-metrics-catalog.md](../reference/functional/04-metrics-catalog.md) |
| `client-metrics-coverage.md` | Metric coverage matrix | [04-metrics-catalog.md](../reference/functional/04-metrics-catalog.md) |
| `conditions-rules-for-admins.md` | Plain-language conditions guide (near-duplicate) | [conditions-rules-guide.md](../conditions-rules-guide.md), [ADR-0011](../adr/0011-conditions-rules-engine.md) |
| `snapshot-migration.md` | Working tracker for the snapshot → per-page cutover. **The migration is complete**; the tracker's "not done" checkboxes are all shipped and would misdirect you | [ADR-0009](../adr/0009-per-page-data-contracts.md) |
| `reports-2026-04-26/` | One-off Playwright functional + visual audits, pinned to commit `8c52143` | — (point-in-time reports; their 23 MB of screenshots were removed from git) |
