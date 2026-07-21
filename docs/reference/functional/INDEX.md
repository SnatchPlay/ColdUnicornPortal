# Functional Reference · Index

This reference documents the PdcaFigmaTest portal (ColdUnicorn PDCA) end-to-end: every page, tab, chart, KPI, table, form, mutation, and metric formula. It is written against the live code at the time of the last schema refactor (commit `f40187b feat: Add new schema and relations for leads, campaigns, clients, and associated entities`) and the Manager/Settings UI refactor (`85a1949`).

> **Read [`BUSINESS_LOGIC.md`](../../BUSINESS_LOGIC.md) first.** It is the canonical product specification — what the product *is*, what each role *can do*, what is in scope and what is explicitly out of scope. The files below describe **how the current implementation works**.

## Target readers

- **New engineer** — [BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md) → [01-overview](./01-overview.md) → [02-roles-routes](./02-roles-routes.md) → [03-data-model](./03-data-model.md) → [11-integrations](./11-integrations.md).
- **Analyst / PM** — [BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md) → [02-roles-routes](./02-roles-routes.md) → [04-metrics-catalog](./04-metrics-catalog.md) → role portal file (5/6/7) → [13-out-of-scope](./13-out-of-scope.md).
- **Support / QA** — [12-hidden-rules](./12-hidden-rules.md) (auth error codes, naming traps) → [09-mutations-rls](./09-mutations-rls.md) → [10-nfr](./10-nfr.md).

## Files

| # | File | Scope |
|---|------|-------|
| 00 | [INDEX.md](./INDEX.md) | This file |
| 01 | [01-overview.md](./01-overview.md) | Product purpose, architecture, tech stack, folder map, ADR pointers |
| 02 | [02-roles-routes.md](./02-roles-routes.md) | Route tree, per-role navigation, auth & role gating, impersonation |
| 03 | [03-data-model.md](./03-data-model.md) | Every Supabase table, enum, view, RLS policy, helper function |
| 04 | [04-metrics-catalog.md](./04-metrics-catalog.md) | Every KPI/metric formula with source column, file:line, time window |
| 05 | [05-client-portal.md](./05-client-portal.md) | Client role: dashboard, leads, campaigns, statistics, settings |
| 06 | [06-manager-portal.md](./06-manager-portal.md) | Manager role: dashboard, clients (DoD/3-DoD/WoW/MoM), leads, campaigns, stats, domains, invoices, blacklist, settings |
| 07 | [07-admin-portal.md](./07-admin-portal.md) | Admin / super-admin: dashboard, user management, full CRUD, impersonation |
| 08 | [08-charts-catalog.md](./08-charts-catalog.md) | Every chart (recharts + custom SVG/HTML) with series, colors, hooks, interactions |
| 09 | [09-mutations-rls.md](./09-mutations-rls.md) | Every write path; role matrix; edge functions; optimistic updates; error taxonomy |
| 10 | [10-nfr.md](./10-nfr.md) | Non-functional: snapshot loading, auth flow, RLS performance, UI states, responsiveness, testing, deploy |
| 11 | [11-integrations.md](./11-integrations.md) | n8n / Smartlead / Bison topology; ingestion-only tables; notification + OOO routing |
| 12 | [12-hidden-rules.md](./12-hidden-rules.md) | Magic numbers, implicit branches, naming traps, mutation semantics, auth error codes |
| 13 | [13-out-of-scope.md](./13-out-of-scope.md) | Explicit legacy: features that will not be built. Mirror of BUSINESS_LOGIC §10. |
| 14 | [14-condition-rules.md](./14-condition-rules.md) | Dynamic condition rules engine, DSL, seeded CS PDCA rules, UI surfaces, and legacy quirks |

## Conventions

- Code references use `path:line` (e.g. [App.tsx:195](../../../src/app/App.tsx#L195)). If the anchor breaks after a refactor, search by the function name.
- Every metric entry follows the template: **Name · Formula · Source · File:line · Displayed in · Time window · Edge cases · Visible to**.
- Every chart entry follows: **ID · Page · Type · Data hook · Series + colors · Interactions · Empty state**.
- Relative links inside this folder use `./file.md#anchor`. Links into code climb three levels: `../../../src/...`.
- "Internal role" = `manager` ∪ `admin` ∪ `super_admin` ∪ `master_admin`. "Internal user" = anyone whose role is not `client`.

## Related documents (not superseded)

**Start here**

- **[`CLAUDE.md`](../../../CLAUDE.md)** — the working agreement. Rules + task routing.
- **[`docs/BUSINESS_LOGIC.md`](../../BUSINESS_LOGIC.md)** — canonical product specification ("should we build this?").
- **[`docs/ADR.md`](../../ADR.md)** — index of all 16 architecture decisions ("why is it like this?").
- **[`docs/reference/processes/`](../processes/README.md)** — business processes end to end (rule,
  lifecycle, invariants) across portal + database + automation.
- **[`docs/reference/n8n/`](../n8n/README.md)** — how n8n workflows are governed, imported and
  validated ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md)).
- **[`docs/reference/traceability.md`](../traceability.md)** — rule → table → RPC → gateway → portal
  → metric → workflow → test.

**Working docs**

- [`docs/reuse-catalog.md`](../../reuse-catalog.md) — search this **before** writing any component, hook, helper, or selector.
- [`docs/reference/design-system.md`](../design-system.md) — theme model (dark + contrast axes), colour/typography/radii tokens, primitive inventory, status-semantics CSS, state surfaces. Read before any UI change.
- [`docs/development-standards-and-operations.md`](../../development-standards-and-operations.md) — commands, quality gate, verification workflows, env, safety, observability.
- [`docs/reference/agent-tooling.md`](../agent-tooling.md) — Playwright MCP, Supabase MCP, shadcn MCP.
- [`docs/reference/production-release.md`](../production-release.md) — shipping checklist.
- [`docs/reference/supabase-production-rls.sql`](../supabase-production-rls.sql) — RLS script for production deploys. **Caution:** it lags the live schema; verify against `pg_policies` before trusting it.

**Cheat-sheets** (April stubs — the `functional/` files above are the long form and win on conflict)

- [`route-map.md`](../route-map.md), [`query-map.md`](../query-map.md), [`mutation-ownership-matrix.md`](../mutation-ownership-matrix.md), [`role-visibility-matrix.md`](../role-visibility-matrix.md), [`db-ui-mapping.md`](../db-ui-mapping.md), [`ui-states.md`](../ui-states.md)

**Archive** — [`docs/archive/`](../../archive/README.md). Historical, **not authoritative**: it predates the ORM gateway and the per-page cutover, so its data-flow descriptions are wrong. Do not answer questions from it.

## Update policy

When code changes, update:

1. **[BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md)** if scope, role capabilities, system boundaries, or workflows change. Add an entry to its decisions log.
2. The affected topic file(s) below.
3. `04-metrics-catalog.md` if a formula, source column, or time window changes.
4. `03-data-model.md` if a table/column/policy changes (verify against `supabase/drizzle/schema.ts` and `supabase/migrations/*`).
5. `09-mutations-rls.md` if a mutation is added/removed.
6. `12-hidden-rules.md` if a magic constant or implicit branch is added or changed.
7. `13-out-of-scope.md` (and BUSINESS_LOGIC §10/§11) if scope moves between *out of scope*, *backlog*, and *built*.

This index does not need updating unless a new file is added.

