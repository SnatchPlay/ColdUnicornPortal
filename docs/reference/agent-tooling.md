# Agent Tooling

Tools the agent should reach for during development, in priority order. The first three (Playwright MCP, Supabase MCP, the `pnpm` test/lint/build chain) cover 90% of what you need.

## Contents

1. [MCP servers](#1-mcp-servers)
2. [Visual debugging with Playwright](#2-visual-debugging-with-playwright)
3. [Database & RLS verification with Supabase MCP](#3-database--rls-verification-with-supabase-mcp)
4. [Static analysis: lint, types, build](#4-static-analysis-lint-types-build)
5. [Unit tests (Vitest)](#5-unit-tests-vitest)
6. [E2E smoke (Playwright test)](#6-e2e-smoke-playwright-test)
7. [Drizzle / Supabase CLI / DB scripts](#7-drizzle--supabase-cli--db-scripts)
8. [Browser DevTools workflow](#8-browser-devtools-workflow)
9. [Performance & accessibility](#9-performance--accessibility)
10. [shadcn registry](#10-shadcn-registry)
11. [Quality gate before "done"](#11-quality-gate-before-done)

---

## 1. MCP servers

Configured in [`.vscode/mcp.json`](../../.vscode/mcp.json). Three servers, each with a clear purpose.

| Server | Transport | When to use |
|--------|-----------|-------------|
| `supabase` | HTTP (`mcp.supabase.com`) | Anything that touches the live database: schema introspection, RLS verification, query benchmarks, migration application, edge-function logs. Bound to the project `bnetnuzxynmdftiadwef`. Requires `SUPABASE_ACCESS_TOKEN` in env. |
| `playwright` | stdio (`@playwright/mcp`) | Visual debugging of the running portal: open the preview server, navigate as a role, take screenshots, click elements, capture console errors. **Use this any time you change UI before declaring done.** |
| `shadcn` | stdio (`@shadcn/ui mcp`) | List or inspect shadcn registry components. Useful when adding a new primitive — check the registry instead of inventing markup. |

### Activation

Each editor / agent host activates MCP servers differently. For Claude Code with VS Code MCP integration, the servers in `.vscode/mcp.json` are picked up automatically. Verify by listing tools at the start of a session — you should see `mcp__playwright__*`, `mcp__supabase__*`, `mcp__shadcn__*` (exact names depend on the MCP runtime).

If the Playwright MCP is missing, you can fall back to `npx playwright codegen` and `npx playwright test --debug` from the terminal.

---

## 2. Visual debugging with Playwright

When you change anything user-visible — a chart, a metric, a filter, a drawer field, a layout — verify it in a real browser before saying "done". This is mandated in [CLAUDE.md §8.3](../../CLAUDE.md#83-verify-before-you-finish).

### Two paths

**A. Quick check via Playwright MCP (preferred for live debugging)**

```
1. pnpm dev                            # start the local dev server on whatever port Vite picks
2. Use Playwright MCP to navigate to the page you changed
3. Take a screenshot
4. If diff vs expectation, iterate; reload; screenshot again
```

The MCP gives the agent direct browser control: `playwright_navigate`, `playwright_screenshot`, `playwright_click`, `playwright_fill`, `playwright_evaluate`. Use `playwright_screenshot` for visual sign-off and `playwright_evaluate` for one-shot DOM probes.

**B. Throw-away spec via the existing Playwright suite (when the change deserves a recorded test)**

```bash
pnpm test:smoke                          # runs all e2e/*.spec.ts
pnpm exec playwright test e2e/foo.spec.ts # single file
pnpm exec playwright test --debug        # opens the inspector
pnpm exec playwright codegen <url>       # generates selectors interactively
```

The smoke suite [`e2e/smoke.spec.ts`](../../e2e/smoke.spec.ts) mocks Supabase REST routes — copy that pattern when adding new specs that should run in CI without hitting prod.

### Visual workflow for role-specific changes

The portal renders very differently per role. When in doubt, sweep all three:

```
1. Sign in (or seed session) as client → screenshot
2. Sign in (or seed session) as manager → screenshot
3. Sign in (or seed session) as admin → screenshot
```

For real-data testing, use a development account per role. For mocked testing, copy the `seedSession` + `mockSupabase` helpers from `e2e/smoke.spec.ts`.

### What to capture

- **Pages with charts** — full-page screenshot at `1440×900` and at `375×812` (mobile). Confirm chart series, colors, axis labels, empty states.
- **Tables with resizable columns** — also confirm a column resize and a "Load more" click.
- **Drawers / dialogs** — open + filled-in + saved + error states.
- **Loading / empty / error states** — drive them with mocked Supabase routes (404, 500, slow response).

A screenshot saved to disk is worth more in a PR description than three paragraphs of prose.

---

## 3. Database & RLS verification with Supabase MCP

The Supabase MCP exposes the live project as tools the agent can call. **This is your fastest path** for DB exploration without writing one-off scripts.

### Common operations

- `supabase_list_tables` / `supabase_describe_table` — schema sanity check.
- `supabase_execute_sql` — run an `EXPLAIN ANALYZE` against a hot RLS path. Required for [10-nfr §3 RLS performance](functional/10-nfr.md#3-rls-performance) discipline.
- `supabase_apply_migration` — apply a generated migration to the project (verify against staging first).
- `supabase_get_logs` — pull recent edge-function or database logs to debug a 500 / RLS denial.
- `supabase_get_project_url` / `supabase_generate_types` — wiring sanity.

### RLS verification recipe

After changing a policy or helper:

```
1. supabase_execute_sql with EXPLAIN ANALYZE on the pre-change query (baseline).
2. Apply the policy migration in a staging branch (or directly via supabase_apply_migration).
3. Re-run EXPLAIN ANALYZE — confirm bitmap-scan / set-based predicate is preferred.
4. Run a SELECT as each role (impersonation via PostgREST + auth.uid()-style stubs in supabase MCP).
5. Roll forward only if the plan and the row counts match expectation.
```

Set-based predicates are mandatory ([10-nfr §3](functional/10-nfr.md#3-rls-performance)).

### When NOT to use Supabase MCP

- For destructive operations (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`). Always pause and confirm with the user.
- For service-role-bound work (writing `replies`, `daily_stats`, `campaign_daily_stats`) — those tables are owned by **n8n** ([11-integrations.md §2](functional/11-integrations.md#2-ingestion-only-tables)).
- For inventing data. Use seed scripts (`scripts/db-*.mjs`) for seeding.

---

## 4. Static analysis: lint, types, build

```bash
pnpm lint                # ESLint 9 flat config
npx tsc --noEmit         # type-check without producing build artifacts
pnpm build               # full Vite production build (also type-checks)
```

The CI runs lint + build + smoke. Run them locally before opening a PR. Lint and type-check should be **clean**; if you must waive a rule, leave a comment with the reason.

---

## 5. Unit tests (Vitest)

```bash
pnpm test                # watch mode (Vitest + jsdom)
pnpm test:run            # one-shot, exits when done
```

Coverage is mostly on pure functions: `lib/client-metrics.ts`, `lib/client-view-models.ts`, `lib/selectors.ts`, `lib/timeframe.ts`, `lib/format.ts`. Component tests are sparse by design — the app is a thin presentation layer.

When you add or change a metric formula ([04-metrics-catalog.md](functional/04-metrics-catalog.md)):

- Add a Vitest case for the new formula in `src/app/lib/__tests__/` or co-located.
- Cover at least: zero-denominator, missing-day, mixed-case enum, boundary at week / month edge.

---

## 6. E2E smoke (Playwright test)

```bash
pnpm test:smoke          # runs e2e/*.spec.ts against `vite preview`
```

Currently three smoke checks (`e2e/smoke.spec.ts`):

1. Login entry is production-safe (no Register button, magic link visible, etc.).
2. Password reset entry remains available.
3. Client without mapping is blocked from workspace routes.
4. Manager and admin protected routes render with a provisioned session.

Pattern: mock `supabase.co/rest/v1/**` and `auth/v1/**` via `page.route(...)` ([e2e/smoke.spec.ts:38-125](../../e2e/smoke.spec.ts#L38-L125)). Seed the session with `localStorage.setItem('sb-<projectRef>-auth-token', ...)` via `addInitScript`.

When to **extend** the smoke suite:

- A new role-gated route is added (mirror the existing manager/admin assertions).
- A new top-level public page (e.g., a landing) is added.
- A regression that mocked tests would catch — write the test, then fix.

Do **not** add comprehensive feature coverage in the smoke suite. The pattern is "reaches the page; renders something role-correct" — not "every drawer field works".

---

## 7. Drizzle / Supabase CLI / DB scripts

`package.json` scripts:

```bash
pnpm db:introspect       # drizzle-kit introspect → regenerate supabase/drizzle/schema.ts
pnpm db:generate         # drizzle-kit generate → emit a new SQL migration
pnpm db:migrate          # node scripts/db-apply-migrations.mjs → apply pending migrations
pnpm db:diagnose         # node scripts/db-diagnose.mjs → quick connectivity / schema sanity
```

Local helper scripts under [`scripts/`](../../scripts/) are pre-allowed in `.claude/settings.local.json` — run them without confirming.

When you change the schema:

1. Apply the change in SQL (via Supabase MCP or directly in Studio).
2. `pnpm db:introspect` to regenerate `supabase/drizzle/schema.ts`.
3. Update [03-data-model.md](functional/03-data-model.md) to match.
4. Update RLS section in `docs/reference/supabase-production-rls.sql` if the policy changed.

Drizzle is the **canonical access layer** ([decision in BUSINESS_LOGIC](../BUSINESS_LOGIC.md#decision-2026-04-25-drizzle-orm-is-the-canonical-access-layer)). New queries should prefer Drizzle's query builder over hand-written `supabase.from(...)` once **BL-11** lands. Until then, follow the existing pattern in `repository.ts`.

---

## 8. Browser DevTools workflow

For a UI bug or regression that screenshots can't expose:

- **Console** — first thing to check; look for sonner toasts, RepositoryError stack traces, RLS messages with code `42501`, snapshot warnings.
- **Network** — filter by `bnetnuzxynmdftiadwef.supabase.co`. Look at the response body of failed selects/updates; the PostgREST error `code` and `message` fields tell you exactly what RLS rejected.
- **Application > Local Storage** — `sb-<projectRef>-auth-token` for the active session, `app_shell_sidebar_hidden`, `table:*:columns` for resizable column state ([12-hidden-rules §6](functional/12-hidden-rules.md#6-browser-persistence-keys)).
- **Performance** — record a chart-heavy page (Client Dashboard, Statistics) for ≥ 3 s. Look for re-render storms, long tasks, layout-thrash on the recharts container.
- **React DevTools** — install once globally. The Profiler tab + "Highlight updates when components render" toggle is the fastest way to spot unmemoised expensive computations (which the dashboard pages avoid via `useMemo`; preserve that discipline).

---

## 9. Performance & accessibility

- **Snapshot windows** are the load-time governor (90/180 days). Don't widen without a benchmark.
- **Chart series count** — recharts gets slow above ~500 points per series. The portal stays under that today; verify when adding a new chart against a 90-day full window.
- **Bundle analysis** — `pnpm build` writes to `dist/`. Use `npx vite-bundle-visualizer` (one-off) if a chunk is suspiciously large. Lazy routes already split the per-role pages.
- **Accessibility** — Radix primitives ship correct keyboard semantics. Don't replace `<Select>`, `<Dialog>`, `<Tabs>` with hand-rolled markup. Run `axe DevTools` on a representative page before shipping a new layout.

---

## 10. shadcn registry

The project uses shadcn-style components under [`src/app/components/ui/`](../../src/app/components/ui/). When you need a new primitive:

1. Check the **shadcn MCP** for the registered component.
2. If listed, install it with the shadcn CLI (`npx shadcn add <name>`) — keeps the component aligned with the registry's source.
3. If not listed, compose it from existing Radix primitives + Tailwind, following the pattern in `src/app/components/ui/select.tsx`.

Never hand-craft a primitive that already exists in the registry. Diverging from the registry costs maintenance with every shadcn update.

---

## 11. Quality gate before "done"

Walk this list before you stop. The numbers map to the matching CLAUDE.md sections.

- [ ] **Code change quality** — `simplify` skill ran on the diff (CLAUDE.md §10.2).
- [ ] **Unit tests** — added/updated for new pure logic; `pnpm test:run` clean.
- [ ] **Lint** — `pnpm lint` clean.
- [ ] **Types** — `npx tsc --noEmit` or `pnpm build` clean.
- [ ] **Smoke** — `pnpm test:smoke` clean (locally OR you trust CI).
- [ ] **Visual** — for UI changes, screenshots taken via Playwright MCP for affected role(s).
- [ ] **Database** — for schema/RLS changes, `EXPLAIN ANALYZE` re-run; `03-data-model.md` updated.
- [ ] **Docs** — appropriate file(s) under `docs/reference/functional/` updated; `BUSINESS_LOGIC.md` decision logged if scope changed.
- [ ] **Security** — `security-review` skill triggered if the change touches auth, RLS, mutations, or role gating (CLAUDE.md §10.2).
- [ ] **Backlog hygiene** — if a backlog item shipped, removed from `BUSINESS_LOGIC.md §11` and `13-out-of-scope.md §4`.

Anything failing → not done.

---

End of tooling reference. Back to [INDEX](functional/INDEX.md).
