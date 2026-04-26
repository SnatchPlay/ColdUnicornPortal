# CLAUDE.md — Working Agreement for AI Agents in This Repository

This file is loaded automatically into every Claude Code session at the project root. **Read it first; act on every rule below.** The rules are not suggestions — they are the contract between you (the agent) and the codebase.

---

## 0. Before you do anything

1. **Read [`docs/BUSINESS_LOGIC.md`](docs/BUSINESS_LOGIC.md) FIRST.** It is the **canonical product specification** — what the product is, what each role can do, what is in scope, what is explicitly out of scope ("legacy"), and what is on the open backlog. When in doubt about whether to build something, this file decides. **Update it whenever scope changes.**
2. **Then read the functional reference** at [docs/reference/functional/INDEX.md](docs/reference/functional/INDEX.md). It describes how the current implementation works — every page, role, metric, mutation, hidden constant, and integration boundary.
3. **Skim the ADRs** at [docs/adr/](docs/adr/). Four short files explain four hard rules: live Supabase as source of truth, route-based role shells, client visibility, lead state boundaries. Never violate them silently.
4. **Look up the matrix you need** before guessing:
   - Product scope / roles / "is this feature in scope?" → [BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md)
   - Roles + routes (implementation) → [02-roles-routes.md](docs/reference/functional/02-roles-routes.md)
   - Schema + RLS → [03-data-model.md](docs/reference/functional/03-data-model.md)
   - Any KPI/metric formula → [04-metrics-catalog.md](docs/reference/functional/04-metrics-catalog.md)
   - Per-role pages → [05-client-portal.md](docs/reference/functional/05-client-portal.md), [06-manager-portal.md](docs/reference/functional/06-manager-portal.md), [07-admin-portal.md](docs/reference/functional/07-admin-portal.md)
   - Charts → [08-charts-catalog.md](docs/reference/functional/08-charts-catalog.md)
   - Writes + RLS + edge functions → [09-mutations-rls.md](docs/reference/functional/09-mutations-rls.md)
   - Auth, snapshot, perf, deploy → [10-nfr.md](docs/reference/functional/10-nfr.md)
   - **n8n / ingestion / external systems** → [11-integrations.md](docs/reference/functional/11-integrations.md)
   - Magic numbers / hidden branches / auth error codes → [12-hidden-rules.md](docs/reference/functional/12-hidden-rules.md)
   - "Is X intentionally not built?" → [13-out-of-scope.md](docs/reference/functional/13-out-of-scope.md)
5. **Trust but verify.** If a doc references `path:line`, open the file and confirm the symbol still lives there. If it has moved, update the doc as part of your change.

If a question can be answered from the docs, answer from the docs and cite the file. Do not re-derive things from the source unless you are about to change them.

---

## 1. Project at a glance

- **Product:** ColdUnicorn PDCA portal — agency operations for outbound email campaigns.
- **Roles:** `super_admin`, `admin`, `manager` (displayed as "CS Manager"), `client`.
- **Stack:** React 18 + TypeScript + Vite, Tailwind v4, Radix UI + shadcn-style primitives, MUI icons, recharts, react-router-dom 7, Supabase (publishable key only on client).
- **Data:** Bulk snapshot via `repository.loadSnapshot()` with 90/180-day windows; metrics computed client-side; RLS is the security boundary; no realtime.
- **Single source of truth:** Supabase project `bnetnuzxynmdftiadwef` (ADR-0001).
- **Three cooperating systems:** Smartlead/Bison send + receive emails; **n8n** ingests counters/replies and dispatches notifications + OOO routing; **the portal** is a thin read+config surface. The portal **never** writes to ingestion-only tables (`replies`, `campaign_daily_stats`, `daily_stats`) and **never** sends notifications itself. See [11-integrations.md](docs/reference/functional/11-integrations.md).

Full product spec: [docs/BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md). Implementation overview: [docs/reference/functional/01-overview.md](docs/reference/functional/01-overview.md).

---

## 2. Reuse over recreation

Before introducing **any** new component, helper, hook, type, or selector — search for an existing one. Almost everything you need already exists. The right answer is usually "extend" or "compose," not "create."

### 2.1 UI primitives — search here first

- **Internal pages (manager/admin):** [`src/app/components/app-ui.tsx`](src/app/components/app-ui.tsx) — `PageHeader`, `Surface`, `Banner`, `MetricCard`, `EmptyState`, `LoadingState`.
- **Client portal pages:** [`src/app/components/portal-ui.tsx`](src/app/components/portal-ui.tsx) — `PortalPageHeader`, `PortalSurface`, `KpiTile`, `ChartPanel`, `DateRangeButton`, `FilterChip`, `PortalSearch`, `LeadDrawer`, `PipelineBadge`, `EmptyPortalState`, `PortalLoadingState`, `PortalErrorState`, `PORTAL_CHART_TOOLTIP`.
- **Shadcn/Radix primitives:** [`src/app/components/ui/`](src/app/components/ui/) — `select`, `dialog`, `sheet`, `tabs`, `popover`, `chart`, etc. Use these instead of styling raw Radix.
- **Layout shell + navigation:** [`src/app/components/app-shell.tsx`](src/app/components/app-shell.tsx) — owns the sidebar, role nav (`NAV_BY_ROLE`), and impersonation controls.
- **Error boundary:** [`AppErrorBoundary`](src/app/components/app-error-boundary.tsx) wraps the routed surface; do not duplicate.

If you need something that "feels like" one of the above but with one tweak, **add a prop or variant** to the existing component rather than forking it.

### 2.2 Data + business logic

- **Data access:** [`src/app/data/repository.ts`](src/app/data/repository.ts) and the wrapper [`useCoreData()`](src/app/providers/core-data.tsx). Pages must never call `supabase.from(...)` directly.
- **Auth + identity + impersonation:** [`useAuth()`](src/app/providers/auth.tsx). Includes `actorIdentity`, `identity`, `isImpersonating`, `errorCode`.
- **Role scoping:** [`scopeClients`, `scopeCampaigns`, `scopeLeads`, `scopeReplies`, `scopeCampaignStats`, `scopeDailyStats`, `scopeDomains`, `scopeInvoices`, `getLeadStage`, `getRoleLabel`](src/app/lib/selectors.ts).
- **Client view models / KPIs:** [`getClientKpis`, `getDailySentSeries`, `getPipelineCounts`, `getPipelineActivitySeries`, `getCampaignPerformance`, `getConversionRates`, `getClientLeadRows`, `formatCompact`, `PIPELINE_STAGES`](src/app/lib/client-view-models.ts).
- **Heavy aggregations:** [`createClientMetrics` (DoD / 3-DoD / WoW / MoM)](src/app/lib/client-metrics.ts) and its helpers (`sumInRange`, `valueByDayOffset`, `toRate`, `startOfWeek`, `startOfMonth`).
- **Timeframe state:** [`TimeframeValue`, `createDefaultTimeframe`, `filterByTimeframe`, `resolveTimeframeBounds`, `makePreviousRange`, `TIMEFRAME_PRESETS`](src/app/lib/timeframe.ts).
- **Formatting:** [`formatNumber`, `formatDate`, `formatMoney`, `getFullName`](src/app/lib/format.ts).
- **Resizable tables:** [`useResizableColumns(defaults, mins, storageKey)`](src/app/lib/use-resizable-columns.ts).
- **Types:** [`src/app/types/core.ts`](src/app/types/core.ts) — `AppRole`, `Identity`, `LeadRecord`, all record types. Don't redeclare.

### 2.3 Forbidden duplications

- Do not introduce a second HTTP layer, second auth context, second snapshot loader, or second metric calculator.
- Do not import `supabase-js` directly outside `data/` and `lib/supabase.ts`.
- Do not write inline RLS-bypassing service-role code in the browser. The publishable key is the only key the frontend ever sees.
- Do not redefine date helpers, percentage helpers, or chart tooltip styles — they already exist.

---

## 3. Hard rules from ADRs

These are non-negotiable. If a task seems to require violating one of them, stop and surface the conflict in your reply.

| ADR | Rule | Implication |
|-----|------|-------------|
| [0001](docs/adr/0001-live-supabase-source-of-truth.md) | Live Supabase is the only data system. | No alternative backend, no local-first mode, no mock-mode runtime branch. |
| [0002](docs/adr/0002-route-based-role-shells.md) | Each role has its own URL prefix and nav menu. | Don't add a runtime role switcher. Use impersonation. |
| [0003](docs/adr/0003-client-campaign-visibility.md) | Clients see only `campaigns.type='outreach'`. | Enforce in BOTH RLS and `scopeCampaigns`. |
| [0004](docs/adr/0004-lead-state-boundaries.md) | Editable lead fields: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments`. Replies are read-only. | Don't expose other fields in the lead drawer. Don't write to `replies` from the portal. |

---

## 4. Code style & conventions

### 4.1 TypeScript

- Strict mode is on. **Never widen a type to `any`** to silence errors. Add a precise type or unknown + narrow.
- Prefer `interface` for object shapes, `type` for unions and aliases.
- Don't redeclare types from `types/core.ts`. Import them.
- `Identity` is the effective identity (post-impersonation). Use `actorIdentity` only when you need the real signed-in user (e.g., for the impersonation banner).

### 4.2 React

- Function components only. No class components except `AppErrorBoundary`.
- Lazy-load page-level components in [App.tsx](src/app/App.tsx) using `React.lazy` and the existing `import().then(m => ({ default: m.X }))` pattern.
- Keep components pure. Side effects belong in `useEffect`, network in providers/repository.
- Co-locate small helpers used by a single page. Promote to `lib/` only when reused.
- Memoize lists and derived data with `useMemo` when the page is wide (the dashboards already do this; follow the pattern).
- Custom hooks live next to a single consumer or in `lib/` if shared. Prefix `use*`.

### 4.3 Pages & dispatch

- A page that serves multiple roles (Dashboard, Leads, Campaigns, Statistics) must dispatch on `identity.role`. Do not split the route — split the component.
- Internal-only pages (Clients, Domains, Invoices, Blacklist, Admin user management) live in non-prefixed files.
- The router is a single tree in [App.tsx](src/app/App.tsx). New routes go behind `RequireRole` with the right `allowed` array.

### 4.4 Forms & drafts

- The drawer pattern is: local `draft` state seeded from `selectedRecord`; `isDraftDirty` controls Save/Cancel visibility; `Escape` closes the drawer; submission goes through `useCoreData().updateX`. Reuse it; don't invent another.
- Validate at the boundary (form submit). For internal trust boundaries (between modules, between repository and Supabase), trust the upstream type.
- Use `sonner` (`toast.success`, `toast.error`) for transient feedback. Use `<Banner>` for persistent context (e.g., impersonation, snapshot warnings).

### 4.5 Styles

- Tailwind utility classes only. No CSS modules, no styled-components, no `style={{ ... }}` for color/spacing.
- Dark theme is the default; follow the existing palette (`#0f0f0f` panels, `#242424` borders, emerald/sky/violet/amber accents). The full per-chart palette is documented in [08-charts-catalog.md](docs/reference/functional/08-charts-catalog.md).
- Responsive: desktop-first; the grid patterns `md:grid-cols-2 xl:grid-cols-4` and asymmetric `xl:grid-cols-[1.6fr_1fr]` are the house style.
- Use `cn(...)` from [`components/ui/utils.ts`](src/app/components/ui/utils.ts) (built on `clsx` + `tailwind-merge`) when conditionally combining classes.

### 4.6 Tables

- Use the CSS-grid table pattern with `useResizableColumns`. Storage keys live under `table:<page>:<view>:columns`.
- Sort with header buttons; never auto-sort hidden columns. Default to `updated_at DESC` or the most recently active column.
- Pagination: lazy "Load more" with `PAGE_SIZE = 50`. Reset on filter change.

### 4.7 Charts

- recharts only, with the documented tooltip styles (`PORTAL_CHART_TOOLTIP` for client portal, the inline `TOOLTIP` object for admin/manager).
- Reuse colors from the palette in [08-charts-catalog.md §Tooltip cheat sheet](docs/reference/functional/08-charts-catalog.md). When in doubt: sent = cyan/green, replies = green/blue, MQLs = blue, meetings = violet, won = green, bounces = orange, positive = amber.
- New chart? Add an entry to [08-charts-catalog.md](docs/reference/functional/08-charts-catalog.md) in the same change.

---

## 5. Data & metrics rules

### 5.1 Never call Supabase directly from a page

Pages access data through `useCoreData()`. Mutations go through `useCoreData().updateX(...)` which proxies to `repository.updateX`. The only exception is `useAuth()` for auth actions.

### 5.2 Always scope before rendering

When a page renders a list or computes a metric, run the data through the appropriate `scopeX(identity, …)` selector first. RLS on the server is the security gate; client-side scoping is for UI consistency (especially under impersonation).

### 5.3 Time windows are sacred

The snapshot caps `campaign_daily_stats` at **90 days** and `daily_stats` at **180 days** to stay under the authenticated-role `statement_timeout`. Don't widen these without a perf plan.

### 5.4 Metric formulas live in one place

Formulas are documented in [04-metrics-catalog.md](docs/reference/functional/04-metrics-catalog.md). When you change a formula or add a metric:

1. Update the implementation in `lib/client-view-models.ts`, `lib/client-metrics.ts`, or the page that owns it.
2. Update the metric entry (or add one) in `04-metrics-catalog.md` with the new formula, source columns, file:line, time window, edge cases, and visibility.
3. Update any role page (05/06/07) that surfaces it.

A change is incomplete if the docs were not touched.

### 5.5 RLS changes require benchmarks

If you touch a policy on `campaign_daily_stats`, `daily_stats`, `leads`, or `replies`, benchmark against realistic volumes. The set-based predicate pattern in `supabase/migrations/20260421_fix_rls_performance.sql` is the model: do not replace it with per-row helper calls.

---

## 6. Mandatory documentation discipline

When you change behavior, change the docs **in the same commit / change**. The docs are the contract; stale docs are worse than no docs.

| If you change… | Update… |
|----------------|---------|
| **Product scope, role capabilities, system boundaries, workflows, in-scope vs out-of-scope** | **[BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md)** + add a decision-log entry |
| A route, role guard, or nav item | [02-roles-routes.md](docs/reference/functional/02-roles-routes.md) |
| Schema, enum, RLS policy, or helper | [03-data-model.md](docs/reference/functional/03-data-model.md) |
| Any KPI/metric formula or new metric | [04-metrics-catalog.md](docs/reference/functional/04-metrics-catalog.md) |
| A page, tab, table column, drawer field, or filter | the relevant role file (05/06/07) |
| A chart's series/colors/data hook, or a new chart | [08-charts-catalog.md](docs/reference/functional/08-charts-catalog.md) |
| A mutation, edge function, or RLS write rule | [09-mutations-rls.md](docs/reference/functional/09-mutations-rls.md) |
| Snapshot windows, retry policy, auth flow, perf, deploy | [10-nfr.md](docs/reference/functional/10-nfr.md) |
| n8n / Smartlead / Bison boundary, ingestion-only tables, OOO routing, notifications | [11-integrations.md](docs/reference/functional/11-integrations.md) + BUSINESS_LOGIC §2 / §6 |
| A magic number, threshold, hidden branch, naming trap | [12-hidden-rules.md](docs/reference/functional/12-hidden-rules.md) |
| An item promoted from out-of-scope to backlog (or back) | [13-out-of-scope.md](docs/reference/functional/13-out-of-scope.md) + BUSINESS_LOGIC §10 / §11 |

When you make a non-trivial design decision (a new pattern, a divergence from existing ones, a workaround for a limitation), write it down:

- **Small decision** → a `**Why:** …` paragraph in the closest doc section.
- **Architecture-level decision** → a new ADR under [docs/adr/](docs/adr/) following the existing numbering and template (Context, Decision, Consequences). Reference it from the affected doc files.

The cheat-sheets in `docs/reference/*.md` (route-map, query-map, mutation-ownership-matrix, role-visibility-matrix, db-ui-mapping, ui-states) are the short index. The `functional/` folder is the long form. Keep both honest.

---

## 7. Decision-recording template

When a non-obvious choice is made (e.g., "we kept duplicate counters for positive responses on purpose"), add a short rationale block in the closest doc, formatted as:

```
**Why:** <the constraint or motivation that drove this>.
**Alternatives considered:** <one-liner per alternative>.
**Trade-off:** <what we accepted in exchange>.
```

For decisions that affect more than one page or live longer than a feature, promote them to an ADR.

---

## 8. Working with the agent

### 8.1 Tone & response shape

- Match the user's language. The repo prose is English; the user often writes in Ukrainian — answer in Ukrainian when they do, keep code identifiers and file paths in English.
- Be terse. Bullet points and tables beat paragraphs. State the result, then the why.
- Cite file paths with `path:line` (or markdown links inside docs). Make claims checkable.

### 8.2 Plan before you change

For any change spanning more than one file, propose a plan first (the user can approve or redirect). Use the existing plan-mode workflow if available. Do not start mutating code on speculation.

### 8.3 Verify before you finish

- For UI work: run the dev server and sanity-check the change in a browser. Type-check + tests are not enough — feature correctness must be observed.
- For data/metric work: re-derive the formula on a sample input and confirm the page renders the expected number.
- For RLS/migration work: load the affected page as each role (or via super-admin impersonation **plus** a real signin) and confirm scoping.
- Run `pnpm lint` and `pnpm test:run` before declaring done.

### 8.4 Don't ask for permission for safe local actions

Reading files, running tests, building, lint — proceed. Don't pause to ask.

### 8.5 Do ask before destructive or shared actions

Force-pushing, dropping tables, deleting branches, posting to GitHub/Slack, changing CI, modifying `supabase/migrations/*` after they've shipped — pause and confirm.

### 8.6 Never bypass safety

- No `--no-verify` on commits.
- No `git reset --hard` on tracked work without explicit user request.
- No service-role keys in the browser.
- No widening RLS to "fix a bug" — find the real cause.

---

## 9. Authoritative checklist for new features

Before you ship a feature, walk this list:

- [ ] Existing components reused; no near-duplicate component or helper introduced.
- [ ] Identity scoping (`scopeX`) applied where data crosses roles.
- [ ] RLS verified or extended; set-based predicates preferred for hot tables.
- [ ] Mutations go through `useCoreData()` → `repository`.
- [ ] If a metric was added/changed: formula recorded in [04-metrics-catalog.md](docs/reference/functional/04-metrics-catalog.md).
- [ ] If a chart was added/changed: entry in [08-charts-catalog.md](docs/reference/functional/08-charts-catalog.md).
- [ ] Role page docs (05/06/07) updated where the feature is surfaced.
- [ ] Loading / empty / error states handled; toasts wired for mutations.
- [ ] Optimistic update + rollback works when the mutation fails.
- [ ] `pnpm lint`, `pnpm test:run`, `pnpm build` all clean.
- [ ] Smoke-tested in the browser as the affected role(s).
- [ ] Decision rationale captured (`**Why:**` block or ADR) if non-obvious.

---

## 9b. Tools you have access to

Beyond the built-in Read/Edit/Bash, this project ships **MCP servers** for direct database and browser access. The full reference is [docs/reference/agent-tooling.md](docs/reference/agent-tooling.md). The short version:

### Configured MCP servers

Configured in [`.vscode/mcp.json`](.vscode/mcp.json):

- **`supabase`** — Supabase MCP, bound to project `bnetnuzxynmdftiadwef`. Use it for schema introspection, `EXPLAIN ANALYZE` on RLS queries, applying migrations, fetching edge-function logs. Requires `SUPABASE_ACCESS_TOKEN` in env. **Never** issue destructive SQL without confirming with the user first.
- **`playwright`** — Microsoft's official Playwright MCP. The agent can drive a real browser: navigate, click, fill forms, take screenshots, evaluate DOM. **Use this whenever you change UI** — verify each affected role visually before declaring done.
- **`shadcn`** — shadcn/ui registry MCP. Use it to look up registered components before hand-rolling a new primitive.

If a server's tools are not present in the session, the user has not activated it; fall back to terminal commands (`pnpm exec playwright`, raw SQL via `node scripts/db-diagnose.mjs`).

### Visual-verification workflow (UI changes)

The §8.3 "verify before you finish" rule operationalises like this:

```
1. pnpm dev
2. Use Playwright MCP → playwright_navigate to the affected page
3. For each affected role (client / manager / admin):
   a. seed session (or sign in) as that role
   b. playwright_screenshot full page
   c. playwright_click the new control / open the new drawer
   d. playwright_screenshot the after state
4. Eyeball the screenshots. If the UI did not change in the way you expected,
   stop — investigate before saying done.
```

For role-aware screenshots without a real account, copy the `seedSession` + `mockSupabase` helpers from [`e2e/smoke.spec.ts`](e2e/smoke.spec.ts) — there is also a starter at [`e2e/visual-debug.spec.ts.example`](e2e/visual-debug.spec.ts.example).

### RLS-verification workflow (DB changes)

When touching a policy / helper function / hot table:

```
1. supabase MCP → execute SQL: EXPLAIN ANALYZE <baseline query as the affected role>
2. Apply the change (supabase MCP apply_migration or Studio).
3. Re-run EXPLAIN ANALYZE — confirm a bitmap-scan / set-based predicate is preferred.
4. Re-run the same SELECT as each role to confirm row counts match expectation.
5. Update docs/reference/functional/03-data-model.md and 09-mutations-rls.md.
```

The `supabase-postgres-best-practices` skill (§10.1) is the methodological partner here.

### Database scripts (Bash)

Pre-allowed in [.claude/settings.local.json](.claude/settings.local.json):

- `node scripts/db-diagnose.mjs` (and `db-diagnose2..5.mjs`) — connectivity / schema sanity.
- `node scripts/db-apply-migrations.mjs` — apply pending Drizzle migrations (`pnpm db:migrate`).
- `node scripts/db-verify.mjs` / `db-verify-final.mjs` — post-migration verification.
- `npx drizzle-kit *` — generate / introspect.

### Test & build commands

```bash
pnpm dev            # local dev server (Vite, hot reload)
pnpm build          # production build (also type-checks)
pnpm lint           # ESLint
pnpm test:run       # Vitest one-shot
pnpm test:smoke     # Playwright smoke suite
```

Run lint + test:run + build before declaring done. CI does the same; failing locally fails CI.

---

## 10. Skills (use them, don't reinvent)

Claude Code ships specialized skills that already encode best practices for our stack. **Invoke them proactively** — they almost always produce better output than working from first principles.

### 10.1 Backend (Supabase, Postgres, RLS, Auth, Edge Functions)

#### `supabase`

**Trigger automatically when** the task touches:

- Any Supabase product (Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues).
- `@supabase/supabase-js` or `@supabase/ssr` integration code (we use `supabase-js` 2.57; check before assuming SSR is in play — this app is SPA-only today).
- Auth issues: login/logout, sessions, JWT, cookies, `getSession`, `getUser`, `getClaims`, RLS denial debugging.
- Supabase CLI usage, MCP tooling, schema changes, migrations, security audits, Postgres extensions (`pg_graphql`, `pg_cron`, `pg_vector`).

What it gives you: idiomatic Supabase patterns, correct auth handling, migration scaffolding, RLS policy templates, edge-function structure. Use it before writing your own `auth.getSession()` retry logic or RLS policy from scratch.

In this project specifically: see [09-mutations-rls.md](docs/reference/functional/09-mutations-rls.md) for the existing patterns (`RepositoryError`, set-based RLS, edge-function 401 retry). Match those — `supabase` skill output should refine, not contradict, the established conventions.

#### `supabase-postgres-best-practices`

**Trigger automatically when** the task involves:

- Writing, reviewing, or optimizing Postgres queries (especially in RLS policies or aggregates touching `campaign_daily_stats`, `daily_stats`, `leads`, `replies`).
- Schema design changes: new tables, new indexes, new constraints, choosing between enum vs text, choosing data types.
- Database performance work — slow queries, missing indexes, over-fetching, N+1 patterns disguised as JS loops.
- Database configuration questions (connection pooling, statement timeouts, work memory).

Why it matters here: the app's authenticated-role `statement_timeout` is the binding constraint behind the 90/180-day snapshot windows ([10-nfr §1.1](docs/reference/functional/10-nfr.md#11-bulk-snapshot)). The set-based RLS rewrite that took queries from 10.48 s → 0.30 s is the canonical example of what this skill enforces — apply the same lens to every new policy or aggregate.

### 10.2 Frontend & code-quality

#### `simplify`

**Run after any non-trivial code change** (more than a one-liner) and **before declaring "done"**. It scans the diff for:

- Code that duplicates existing helpers/components.
- Unnecessary abstractions or premature generalizations.
- Inefficiencies (over-rendering, redundant state, unmemoized expensive calcs).
- Dead branches and unused exports.

This skill operationalizes [§2 "Reuse over recreation"](#2-reuse-over-recreation) and [§4 Code style](#4-code-style--conventions). Treat its findings as blocking until resolved or explicitly waived.

#### `review`

**Trigger when** the user asks for a PR review, when you've finished a multi-file change and want a second pass, or when reviewing someone else's branch.

Use it after `simplify` has cleaned the diff — `review` looks at correctness and design at the change-set level, not at line-by-line cleanup.

#### `security-review`

**Trigger automatically when** the change touches:

- Auth flow ([`providers/auth.tsx`](src/app/providers/auth.tsx), edge functions, session handling).
- Any RLS policy or migration in `supabase/migrations/*`.
- Mutations in [`repository.ts`](src/app/data/repository.ts) — especially anything that could broaden access.
- Role gating: `RequireRole`, `scopeX` selectors, `private.*` helpers.
- Anything that handles or stores secrets, PII, or invitation tokens.

Manually trigger with `/security-review` for a full sweep on the current branch before merging anything that touches the trust boundary.

### 10.3 Operational helpers

#### `fewer-permission-prompts`

Run periodically (e.g., once per major feature) to scan transcripts and add safe read-only Bash/MCP commands to `.claude/settings.json` allowlist. Reduces friction without lowering safety.

#### `update-config`

Use when the user wants to change Claude Code harness behavior — automated hooks (e.g., "after every save run lint"), permissions, env vars, or anything that has to live in `settings.json` rather than in memory/preferences.

#### `init`, `keybindings-help`, `loop`, `schedule`, `claude-api`

Situational; invoke only when the user explicitly maps onto their description (initializing a new CLAUDE.md elsewhere, customizing keybindings, running recurring tasks, scheduling agents, or working on Claude API / Anthropic SDK code — none of which apply to this React+Supabase product directly).

### 10.4 Skill orchestration rules

1. **Never call a skill that isn't in the available-skills list of the current session.** If the system reminder shows it, it's available; otherwise it isn't.
2. **Don't double-invoke.** A skill already running in the conversation is loaded — follow its instructions instead of calling it again.
3. **Combine intentionally.** Typical pipeline for a backend change: `supabase-postgres-best-practices` (design) → implement → `simplify` (cleanup) → `security-review` (trust boundary) → `review` (final pass).
4. **Cite the skill in your response** when its output influenced a decision, so the user can trace why a pattern was chosen.

---

## 10b. Quality gate before "done"

Walk this list every time. Failing any item ⇒ not done.

- [ ] **`simplify`** skill ran on the diff (cleanup duplications, dead code).
- [ ] **Unit tests** added/updated for new pure logic (`pnpm test:run` clean).
- [ ] **Lint** clean (`pnpm lint`).
- [ ] **Types / build** clean (`pnpm build` or `npx tsc --noEmit`).
- [ ] **Smoke** clean (`pnpm test:smoke`).
- [ ] **Visual** screenshots taken via Playwright MCP for each affected role (client / manager / admin) on UI changes.
- [ ] **Database** — for schema/RLS changes, `EXPLAIN ANALYZE` re-run; row counts verified per role.
- [ ] **`security-review`** skill triggered if change touches auth, RLS, mutations, or role gating.
- [ ] **Docs updated** — `BUSINESS_LOGIC.md` decision logged if scope changed; relevant functional file updated.
- [ ] **Backlog hygiene** — if a backlog item shipped, removed from `BUSINESS_LOGIC.md §11` and `13-out-of-scope.md §4`.

---

## 11. "Don't build that" radar

A short list of common asks that look reasonable but are explicitly **out of scope** ([docs/reference/functional/13-out-of-scope.md](docs/reference/functional/13-out-of-scope.md)). If a request matches one of these, point the user at the out-of-scope file and confirm before doing any work:

- Health Assessments / biweekly client traffic-light forms.
- CSV / Excel **bulk import** UI in the portal (ingestion already does this via n8n).
- Cash-flow projections, ABS scoring, partnerships dashboards, lost-clients tracking.
- Issue tracking per client.
- Auto-generated weekly/monthly PDF/CSV reports.
- **Reply triage UI** — every reply is classified by n8n; the portal never classifies.
- **Sending email or SMS from the portal directly** — n8n does that; the portal stores destinations only.
- Calling Smartlead / Bison APIs from the portal — n8n owns those integrations.
- Pre-aggregated `daily_snapshots` tables — metrics are computed client-side from raw counters.

When in doubt: read [BUSINESS_LOGIC.md §10 Out of scope](docs/BUSINESS_LOGIC.md#10-out-of-scope-legacy) and [§11 Open backlog](docs/BUSINESS_LOGIC.md#11-open-backlog-planned-not-built).

---

## 12. Tooling reference

Full tooling guide: [docs/reference/agent-tooling.md](docs/reference/agent-tooling.md). Quick links:

- **MCP servers config:** [.vscode/mcp.json](.vscode/mcp.json) (supabase + playwright + shadcn).
- **Visual smoke template:** [e2e/visual-debug.spec.ts.example](e2e/visual-debug.spec.ts.example).
- **Pre-allowed Bash:** [.claude/settings.local.json](.claude/settings.local.json).
- **Quality gate:** [§10b above](#10b-quality-gate-before-done).
- **Visual verification workflow:** [§9b above](#9b-tools-you-have-access-to).

---

## 13. Quick links

- [Functional reference index](docs/reference/functional/INDEX.md) — start here every session.
- [ADRs](docs/adr/) — four non-negotiables.
- [Production release checklist](docs/reference/production-release.md).
- [Production RLS SQL](docs/reference/supabase-production-rls.sql).
- [Drizzle schema (live introspection)](supabase/drizzle/schema.ts).
- [Repository API](src/app/data/repository.ts).
- [Routes](src/app/App.tsx).

---

## 14. House motto

> Reuse first. Document the why. Prove it in the browser.

If a change does not satisfy these three, it is not done.
