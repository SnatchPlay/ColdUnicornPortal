# Development Standards & Operations

The operational half of the working agreement. [CLAUDE.md](../CLAUDE.md) says *what the rules are*;
this file says *how to run, verify, and ship*.

## 1. Commands

```bash
pnpm dev            # full local stack: supabase start + migrations + functions serve + vite (see reference/local-supabase.md)
pnpm dev:web        # just the Vite dev server (hot reload), against an already-running stack
pnpm build          # production build
pnpm lint           # ESLint
pnpm test:run       # Vitest, one-shot
pnpm test           # Vitest, watch
pnpm test:smoke     # Playwright smoke suite
pnpm db:migrate       # apply pending migrations — needs SUPABASE_DB_URL (no hardcoded creds)
pnpm db:migrate:local # same, pre-pointed at the local stack (127.0.0.1:54322)
pnpm db:introspect    # drizzle-kit introspect → supabase/drizzle/schema.ts
pnpm db:diagnose      # connectivity / schema sanity (needs SUPABASE_DB_URL)
```

**Local Supabase + auto-deploy:** develop against a full local stack (Postgres + Auth + Edge
Functions) and let a push to `main` deploy migrations + functions to the cloud. Setup and the
one-time bootstrap (Docker, GitHub secrets, prod-dump restore, password rotation) live in
[reference/local-supabase.md](reference/local-supabase.md).

**Known gaps — do not be surprised by these:**

- **`pnpm build` does not type-check.** It is `vite build`, and there is no `tsc --noEmit` script or
  root `tsconfig` wired for it. **Type errors surface in `pnpm test:run`, not the build.** Always
  run the tests.
- **Edge functions deploy via the Supabase CLI**, wired into CI (`deploy-functions` job, gated by
  the `ENABLE_FUNCTION_DEPLOY` repo variable) or run by hand
  (`supabase functions deploy <name> --project-ref bnetnuzxynmdftiadwef`). The Supabase MCP
  (`deploy_edge_function`) and the dashboard still work for one-offs. See
  [reference/local-supabase.md](reference/local-supabase.md).
- `pnpm test:smoke` needs a rebuilt `dist/` and the env loader; a stale `dist` gives confusing
  failures.

## 2. Quality gate — walk this before saying "done"

- [ ] **Reuse checked** — searched [reuse-catalog.md](reuse-catalog.md); no near-duplicate introduced
- [ ] **`pnpm lint`** clean (0 errors; there are ~20 pre-existing warnings)
- [ ] **`pnpm test:run`** clean — this is also your type-check
- [ ] **`pnpm build`** clean
- [ ] **Unit tests** added for new pure logic (metrics, selectors, evaluators)
- [ ] **Visual** — screenshots per affected role (`visual-verify` skill) for any UI change
- [ ] **Database** — `EXPLAIN ANALYZE` re-run as `authenticated`, row counts per role
      (`rls-migration` skill) for any schema/RLS change
- [ ] **`security-review`** run if the change touches auth, RLS, mutations, or role gating
- [ ] **Docs updated in the same change** (§4 below)
- [ ] **Decision recorded** — a `**Why:**` block, or an ADR if it is architecture-level

## 3. Verification workflows

### UI changes

Type-checks do not prove a feature works. Use the `visual-verify` skill: dev server → Playwright
MCP → screenshot each affected role, before and after, and **look at the results**. Cover the
loading/empty/error states and the contrast theme axis (which defaults to **on**). Details:
[design-system.md](reference/design-system.md).

### Database / RLS changes

Use the `rls-migration` skill. **Apply and test the migration on the local Supabase stack first**
(`pnpm db:migrate:local`) — never test a schema/RLS change by applying it straight to production.
The non-negotiable part: **`EXPLAIN (ANALYZE, BUFFERS)` as the `authenticated` role, not superuser**
— superuser bypasses RLS and gives a false baseline.

```bash
node scripts/db-diagnose-rls-explain.mjs   # EXPLAIN under a real JWT context
node scripts/db-diagnose-leads.mjs         # EXPLAIN for leads query shapes
node scripts/db-apply-migrations.mjs       # apply
node scripts/db-verify.mjs                 # verify
```

Look for `Filter: private.*` inside a Seq/Index Scan — that is a per-row function call and a
performance defect. Rewrite to the set-based subquery form
([ADR-0006](adr/0006-set-based-rls-predicates.md)) and record before/after timings in the migration
comment.

### Gateway changes

Use the `gateway-action` skill. **Test the function on the local Supabase stack**
(`supabase functions serve` against `supabase start`) before deploying — never verify a function by
deploying it to production. Remember the edge function deploys **separately** from the frontend:
until it is deployed, a new action type-checks locally but 400s in production.

## 4. Documentation discipline

A change is incomplete if the docs were not touched. Update **in the same change**:

| If you change… | Update… |
|---|---|
| Product scope, role capabilities, system boundaries | [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) + a decision-log entry |
| A route, role guard, or nav item | [02-roles-routes.md](reference/functional/02-roles-routes.md) |
| Schema, enum, RLS policy, helper | [03-data-model.md](reference/functional/03-data-model.md) |
| A KPI/metric formula | [04-metrics-catalog.md](reference/functional/04-metrics-catalog.md) |
| A page, tab, column, drawer field, filter | the role file — [05](reference/functional/05-client-portal.md) / [06](reference/functional/06-manager-portal.md) / [07](reference/functional/07-admin-portal.md) |
| A chart | [08-charts-catalog.md](reference/functional/08-charts-catalog.md) |
| A mutation, gateway action, edge function | [09-mutations-rls.md](reference/functional/09-mutations-rls.md) |
| Snapshot/auth/perf/deploy behaviour | [10-nfr.md](reference/functional/10-nfr.md) |
| n8n / Bison boundary | [11-integrations.md](reference/functional/11-integrations.md) |
| A magic number, threshold, hidden branch | [12-hidden-rules.md](reference/functional/12-hidden-rules.md) |
| Colours, tokens, primitives, states | [design-system.md](reference/design-system.md) |
| A reusable component/hook/helper | [reuse-catalog.md](reuse-catalog.md) |
| An architecture-level decision | a new ADR + the [ADR index](ADR.md) |

### Recording a decision

Small → a block in the closest doc:

```
**Why:** <the constraint that drove this>.
**Alternatives considered:** <one line each>.
**Trade-off:** <what we accepted in exchange>.
```

Architecture-level, or outliving the feature → an ADR ([policy](ADR.md)).

## 5. Safety

**Proceed without asking:** reading files, running tests, lint, build, dev server, read-only SQL
and diagnostics.

**Ask first:** force-pushing; dropping/renaming tables or columns; deleting branches; posting to
GitHub/Slack; changing CI; editing a migration that has already shipped; deploying an edge function.

**Never:**

- `--no-verify` on commits
- `git reset --hard` on tracked work that was not explicitly requested
- a service-role key or `DATABASE_URL` in anything the browser loads
- widening an RLS policy to make a bug go away — find the real cause

## 6. Environment

Frontend gets the **publishable** key only. Runtime config is read in
[`lib/env.ts`](../src/app/lib/env.ts):

| Var | Purpose |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Primary project (`bnetnuzxynmdftiadwef`) |
| `VITE_ORM_GATEWAY_FUNCTION` | Which gateway function to call. Defaults to the canonical `orm-gateway`; override only for a dev build targeting a temporary WIP function |
| `VITE_APP_ENV` | Gates impersonation (non-production only) and makes `VITE_APP_BASE_URL` required |
| `VITE_APP_BASE_URL` | Auth redirect base |
| `VITE_AUTH_INVITE_ONLY` | Invite-only sign-up |
| `VITE_LEGACY_CRM_SUPABASE_URL`, `VITE_LEGACY_CRM_PUBLISHABLE_KEY` | Legacy CRM read path ([ADR-0010](adr/0010-legacy-crm-integration.md)); absent ⇒ the CRM card degrades to empty |

Secrets held **only** by edge functions: `DATABASE_URL` (the `orm-gateway` pooler connection — as
sensitive as a service key) and the service role used by `send-invite` / `manage-invites`.

Test credentials live in the gitignored `.env.test.local`.

## 7. Observability

The gateway returns `_serverMs { total, setup, handler }` and `_requestId` on every response.
The client logs:

- `[PERF][gateway]` — per-action fetch vs server time
- `[PERF][shell]` — shell-data boot
- `[GATEWAY_OVERHEAD]` — when `fetchMs - _serverMs.total > 1500 ms`. This is a **cold-start / pooler
  stall**, expected on a cold instance. Do **not** add page-level workarounds for it.

Benchmarks: `scripts/perf-benchmark.mjs`, `scripts/perf-measure.mjs`,
`scripts/perf-snapshot-trace.mjs`.
