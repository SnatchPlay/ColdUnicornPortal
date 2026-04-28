# 10 · Non-functional Requirements

Cross-cutting concerns: data loading, auth, RLS performance, UI states, responsiveness, persistence, testing, and deployment. Complements [01-overview](./01-overview.md) with operational detail.

## Contents

1. [Data loading strategy](#1-data-loading-strategy)
2. [Auth flow](#2-auth-flow)
3. [RLS performance](#3-rls-performance)
4. [UI state patterns](#4-ui-state-patterns)
5. [Responsiveness](#5-responsiveness)
6. [Persistence via localStorage](#6-persistence-via-localstorage)
7. [Defence in depth](#7-defence-in-depth)
8. [Testing](#8-testing)
9. [Build & deploy](#9-build--deploy)

---

## 1. Data loading strategy

### 1.1 Bulk snapshot

On `CoreDataProvider` mount and after a session change, the app loads snapshot data via `repository.loadSnapshot()` ([09 §7](./09-mutations-rls.md#7-snapshot-reload-strategy)). Repository dispatches an action to `orm-gateway`, where Drizzle executes the snapshot query set under RLS passthrough.

Constants in [repository.ts](../../../src/app/data/repository.ts):

```ts
const CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90;   // line 29
const DAILY_STATS_WINDOW_DAYS           = 180; // line 30
```

Rationale (comments in source): "the dashboard only renders the last 21 days, so we cap at 90 to leave headroom for drill-down views. Shipping the full history on every mount blows past the authenticated-role statement_timeout once seed volumes cross ~10k rows."

`daily_stats` is fetched only for non-client roles (`includeDailyStats: identity?.role !== "client"`) to save bandwidth — clients compute their visible metrics from `campaign_daily_stats` and `leads` alone.

### 1.2 Retry policy

Repository retries `orm-gateway` `select` actions with `kind ∈ {network, timeout}` up to twice (delays `250 ms` and `600 ms`). Mutations are **not** retried — see [09 §6.2](./09-mutations-rls.md#62-retry-behaviour).

### 1.3 No realtime

The app does **not** subscribe to Supabase Realtime channels. A `grep` for `supabase.channel(` / `.on(` in the source confirms no live subscriptions. Trade-offs:

- ✅ Simpler mental model, predictable network usage, no connection churn.
- ❌ Concurrent edits by two managers silently overwrite each other; fresh ingestion rows don't appear until the next `refresh()` or reload.

Re-fetching is explicit: retry banners, invite list post-mutation, or browser refresh.

### 1.4 Three-system topology

The portal is one of three cooperating systems. Smartlead/Bison send and receive; **n8n** ingests counters/replies and dispatches notifications + OOO routing; the portal is a thin read+config surface. The portal **never**:

- writes to `replies`, `campaign_daily_stats`, or `daily_stats` (those are n8n's),
- sends emails or SMS (n8n does, using `clients.notification_emails` + `sms_phone_numbers`),
- calls Smartlead/Bison APIs directly,
- classifies replies (n8n does).

Full topology and table ownership: [11-integrations.md](./11-integrations.md). Product-level statement of the boundaries: [BUSINESS_LOGIC.md §2](../../BUSINESS_LOGIC.md#2-system-boundaries).

### 1.4 Leads limit (optional)

`loadSnapshot({ leadsLimit })` can cap the initial leads set. Not currently exercised by the UI (no page passes the option), but the repository supports it for future pagination.

---

## 2. Auth flow

Implemented in [`providers/auth.tsx`](../../../src/app/providers/auth.tsx).

### 2.1 Bootstrap sequence

1. AuthProvider calls `supabase.auth.getSession()` on mount.
2. If a session exists, call `repository.loadIdentity(session.user.id)`, which invokes `orm-gateway`.
3. In `orm-gateway`, Drizzle reads `public.users` and (for `client` role) `client_users` under RLS passthrough to resolve `clientId`.
4. Compose `Identity` and set it on context.

Result state exposed by `useAuth()`:

- `session: Session | null`
- `actorIdentity: Identity | null` (real user)
- `identity: Identity | null` (effective user; differs from actor when impersonating)
- `loading: boolean`
- `error: string | null`
- `errorCode`: one of the codes in [02 §6](./02-roles-routes.md#6-blockers--error-screens)
- `isImpersonating: boolean`

### 2.2 Error codes

| Code | Trigger |
|------|---------|
| `profile_missing` | Session valid but no `public.users` row — typically first signin after invite before backend sync. |
| `client_mapping_missing` | `client` role without a `client_users` row. |
| `permission` | RLS denied the initial query. |
| `session_invalid` | Supabase reports the session token is no longer usable. |
| `network` | Connection failure during bootstrap. |

Each code maps to a message in [`App.tsx:40-56`](../../../src/app/App.tsx#L40-L56), rendered by `SessionAccessBlocker`.

### 2.3 Auth actions

- `signInWithPassword(email, password)` — standard Supabase password login.
- `signInWithOtp(email)` — magic link; only when `VITE_AUTH_ALLOW_MAGIC_LINK`.
- `requestPasswordReset(email)` — uses `VITE_APP_BASE_URL + "/reset-password"` as `redirectTo`.
- `updatePassword(password)` — post-signin change.
- `updateProfileName(fullName)` — updates `public.users.first_name/last_name` through `orm-gateway` (RLS-scoped to current user).
- `signOut()` — clears the session and resets context.
- `refreshIdentity()` — re-runs the identity load (binds to the "Retry" buttons in blockers).
- `impersonate(identity)` / `stopImpersonation()` — super-admin only.

### 2.4 Session hygiene

Before every edge-function call, the repository compares `session.expires_at * 1000` to `Date.now() + 60_000` and refreshes if within a minute of expiry — preempting 401s. A failed refresh raises `RepositoryError({ kind: "permission" })` with the message "Your session expired and could not be refreshed."

---

## 3. RLS performance

Heavy tables (`campaign_daily_stats`, `daily_stats`) initially used per-row helper predicates like `private.can_access_campaign(campaign_id)`. Profiling showed Postgres could not hoist the function call past the index scan; on 24k rows, the select took ~10.48 seconds.

Migration `supabase/migrations/20260421_fix_rls_performance.sql` rewrote the policies to **set-based** subqueries:

```sql
USING (
  campaign_id IN (
    SELECT c.id FROM campaigns c
    WHERE private.can_access_client(c.client_id)
      AND (private.current_app_role() <> 'client' OR c.type = 'outreach')
  )
)
```

Postgres can now evaluate the subquery once and apply it as a bitmap filter. Measured improvement: **10.48 s → 0.30 s** for the same workload.

Lessons:

- Prefer set-based predicates over function-per-row checks.
- Keep helpers small and `STABLE`.
- Benchmark with realistic data volumes before shipping RLS changes.

Additionally, `admin_dashboard_daily` is a materialised-style view with `security_invoker=on` so future aggregate queries can go through it without bypassing RLS.

---

## 4. UI state patterns

Shared component patterns across the app:

### 4.1 Loading

- Internal pages: `<LoadingState />` from [`app-ui.tsx`](../../../src/app/components/app-ui.tsx) — compact spinner + label.
- Client portal pages: `<PortalLoadingState />` from [`portal-ui.tsx`](../../../src/app/components/portal-ui.tsx) — larger block "Loading workspace data".
- Route-level: `<Suspense fallback={<LoadingState />}>` wrapping lazy chunks ([App.tsx:169](../../../src/app/App.tsx#L169)).

### 4.2 Empty

- Internal: `<EmptyState title subtitle />`.
- Portal: `<EmptyPortalState title description />`.
- Dashboards have per-widget empty states (e.g. "No sent data") rather than a single full-page empty state.

### 4.3 Error

- Top-level: `<Banner tone="danger|warning">` with inline retry action.
- Portal: `<PortalErrorState onRetry />`.
- Drawer save errors: `sonner` toasts (rich, closable).
- Fatal render errors: `AppErrorBoundary` catches and shows a recovery screen.

### 4.4 Draft / unsaved

Drawers (campaign, lead, client, domain, invoice):

- Local `draft` state seeded from `selectedRecord`.
- `isDraftDirty = !equalShallow(draft, selectedRecord)`.
- Save / Cancel buttons appear when dirty.
- `Escape` key closes the drawer and discards the draft (wired via `useEffect` with `keydown` listener in each page).

### 4.5 Async form feedback

- Input disabled while `submitting`.
- Button label flips ("Sign in" → "Signing in...").
- Success message cleared on next user edit.
- Failed submissions retain user input.

---

## 5. Responsiveness

Tailwind breakpoints. The sidebar is hidden below `lg` (1024 px) and accessed via a hamburger + `Sheet`. Main-area padding scales with breakpoints (`px-3 sm:px-4 lg:px-10`).

Grid patterns used across the app:

- `md:grid-cols-2 xl:grid-cols-4` — KPI rows.
- `xl:grid-cols-[0.9fr_1.4fr]`, `xl:grid-cols-[1.6fr_1fr]` — asymmetric page splits (list vs detail).
- Tables use CSS Grid with custom properties driven by `useResizableColumns` (see §6).

No dedicated mobile layouts; the app targets desktop-first with mobile as a graceful fallback.

---

## 6. Persistence via localStorage

Non-secret UI preferences persist per-browser:

| Key | Source | Purpose |
|-----|--------|---------|
| `app_shell_sidebar_hidden` | `app-shell.tsx:78` | Hide/show sidebar on desktop |
| `table:campaigns:columns` | `campaigns-page.tsx` | Column widths |
| `table:leads:columns` | `leads-page.tsx` | Column widths |
| `table:clients:overview:columns` | `clients-page.tsx` | Overview tab column widths (other tabs have their own keys where applicable) |
| `table:client-leads:columns` | `client-leads-page.tsx` | Column widths |

`useResizableColumns(defaults, mins, storageKey)` at [`use-resizable-columns.ts`](../../../src/app/lib/use-resizable-columns.ts) loads from `localStorage` on mount, clamps to mins, and writes back on resize.

---

## 7. Defence in depth

Two overlapping access-control layers:

1. **RLS** — primary, enforced by Postgres. Bypass requires the service role (only used by edge functions, never in the browser).
2. **Client-side scope functions** (`scopeClients`, `scopeCampaigns`, …) — reapplied by pages before rendering. These filter the snapshot to "what this identity can see".

Why both?

- RLS rows out anything the user can't read, guaranteeing no leakage through the browser.
- Client-side scope provides consistent filtering when the snapshot contains rows that *are* readable but logically belong to another scope (e.g. during super-admin impersonation when the actor's RLS returns more than the impersonated role should see).

Similarly, UI disables inputs by role for ergonomics (e.g. client sees a read-only drawer). RLS then blocks the mutation if the user somehow dispatches one.

---

## 8. Testing

### 8.1 Unit — Vitest + Testing Library

```
pnpm test       # watch mode
pnpm test:run   # single-pass (used in CI)
```

Configuration in `vite.config.ts` under `test: { environment: "jsdom" }`. Test setup files under `src/app/test/`.

Focus: pure functions (`client-metrics`, `client-view-models`, `selectors`, `timeframe`, `format`). Component tests are sparse — the app is mostly a thin presentation layer over the snapshot.

### 8.2 E2E / smoke — Playwright

```
pnpm test:smoke
```

Config in `playwright.config.ts`; tests under `e2e/`. Covers the critical signed-in paths (dashboard renders, leads drawer opens, campaign edit saves). Run against a local dev server.

### 8.3 Lint

```
pnpm lint
```

ESLint 9 flat config with the TypeScript and React hooks plugins.

### 8.4 Type check

Implicit via `pnpm build`. A standalone `tsc --noEmit` is not scripted but is the right pre-commit check.

---

## 9. Build & deploy

### 9.1 Scripts

```
pnpm dev             # Vite dev server
pnpm build           # production bundle
pnpm preview         # preview the built bundle locally
pnpm db:introspect   # pull live schema into supabase/drizzle/schema.ts
pnpm db:generate     # drizzle-kit generate (migration)
pnpm db:migrate      # scripts/db-apply-migrations.mjs
pnpm db:diagnose     # scripts/db-diagnose.mjs
```

### 9.2 Production release checklist

From [`docs/reference/production-release.md`](../production-release.md) (summarised):

- Point `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_BASE_URL` to production.
- Set `VITE_APP_ENV=production` (affects labels only).
- Keep `VITE_AUTH_ALLOW_SELF_SIGNUP=false`.
- Decide on `VITE_AUTH_ALLOW_MAGIC_LINK`.
- Ensure RLS policies match `docs/reference/supabase-production-rls.sql`.
- Host the static bundle with **SPA rewrites** to `index.html` so client-side routes resolve.
- Serve over HTTPS. Never ship the service_role key to the browser.
- Run `pnpm build` and `pnpm test:smoke` against the production URL before cutover.

### 9.3 Secrets hygiene

The browser only ever holds the **publishable** (anon) Supabase key. The edge functions (`send-invite`, `manage-invites`) hold the service role inside Supabase infrastructure. No secrets live in the git repository (the committed `.env` is the developer template; real values go in Vite env at build time).

### 9.4 Observability

No dedicated instrumentation is built in. Supabase's own logs cover auth and RLS denials; browser DevTools and `sonner` toasts cover the frontend. Non-fatal snapshot errors surface as a warning banner with the current role and a retry button ([App.tsx:164-168](../../../src/app/App.tsx#L164-L168)).

---

End of reference. To navigate back: [INDEX.md](./INDEX.md).
