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

### 1.1 Shell boot + per-page loads (ADR-0009)

There is **no global snapshot**. Boot loads a small shell payload; every page then owns exactly one gateway action.

| Stage | Who | What |
|---|---|---|
| Auth | `AuthProvider` | `supabase.auth.getSession()` → `repository.loadIdentity` (+ `current_account_active`) |
| Shell | `ShellDataProvider` | `loadShellData` → `usersLite`, `clientsLite`, `clientUsers` only ([shell-data.tsx:48-81](../../../src/app/providers/shell-data.tsx#L48-L81)) |
| Page | per-page hook (`lib/use-*.ts` or co-located) | one select action, guarded by a `loadIdRef` counter |

The action → page map and the stale-guard rule are in [09 §8](./09-mutations-rls.md#8-read-strategy-after-the-snapshot-cutover).

### 1.2 Server-side aggregation

The gateway computes **facts** — counts, sums, `GROUP BY` rollups, top-N rows, and full filter/sort/pagination for the leads list. The frontend computes **interpretation** — rates, stages, health and KPI progress ([view-contracts.ts:3-6](../../../src/app/types/view-contracts.ts#L3-L6)).

| Action | Server-side work | Handler |
|---|---|---|
| `loadAdminDashboardOverview` | client/campaign counts, pipeline groups, 21-day momentum, manager capacity | [index.ts:946](../../../supabase/functions/orm-gateway/index.ts#L946) |
| `loadManagerDashboardOverview` | same, scoped to `manager_id`, with client/status/date filters | [index.ts:1047](../../../supabase/functions/orm-gateway/index.ts#L1047) |
| `loadClientDashboard` | single-client stats + campaign series | [index.ts:1261](../../../supabase/functions/orm-gateway/index.ts#L1261) |
| `loadClientsMetricsSummary` | per-client DoD/WoW/MoM input summaries | [index.ts:1491](../../../supabase/functions/orm-gateway/index.ts#L1491) |
| `loadLeadsList` | WHERE filters + ORDER BY + LIMIT/OFFSET + custom-field values | [index.ts:1675](../../../supabase/functions/orm-gateway/index.ts#L1675) |
| `loadCampaignStats` / `loadAnalyticsOverview` | windowed stat series + lead groups | [index.ts:2068](../../../supabase/functions/orm-gateway/index.ts#L2068) / [2115](../../../supabase/functions/orm-gateway/index.ts#L2115) |

`loadClientsOverview` / `loadClientsStats` are deliberately **split**: the ~85 KB shell paints the table, the ~1.4 MB stats payload is deferred ([view-contracts.ts:237-248](../../../src/app/types/view-contracts.ts#L237-L248)).

### 1.3 Time windows

The window constants live in the **edge function**, not the frontend ([index.ts:19-22](../../../supabase/functions/orm-gateway/index.ts#L19-L22)):

```ts
const CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90;    // line 19
const DAILY_STATS_WINDOW_DAYS           = 180;  // line 20
const REPLIES_WINDOW_DAYS               = 180;  // line 21
const REPLIES_LIMIT                     = 5_000;// line 22
```

They cap the fact tables so queries stay well inside the authenticated-role `statement_timeout` (dashboards render 21 days; 90/180 is drill-down headroom). Widening any of them requires a perf plan (§3). Dashboards additionally hard-code a 21-day window (`isoDaysAgo(21)`, [index.ts:948](../../../supabase/functions/orm-gateway/index.ts#L948) and [1055](../../../supabase/functions/orm-gateway/index.ts#L1055)).

### 1.4 Retry policy

- `select` actions with `kind ∈ {network, timeout}` retry up to twice (`SNAPSHOT_RETRY_DELAYS_MS = [250, 600]`, [repository.ts:57](../../../src/app/data/repository.ts#L57)).
- **Any** gateway/invite call retries once on HTTP 401 after `refreshSession()`.
- Mutations are never auto-retried — see [09 §7.2](./09-mutations-rls.md#72-retry-behaviour).

### 1.5 Connection handling in the gateway

The function keeps a small `postgres.js` pool against the transaction pooler (`max: 3`, `prepare: false`, `idle_timeout: 60`, [index.ts:23-32](../../../supabase/functions/orm-gateway/index.ts#L23-L32)). Cold starts and pooler reconnects cost ~1 s; that shows up as `[GATEWAY_OVERHEAD]` in the browser console (§9.4) and is **not** something to work around in page code.

### 1.6 No realtime

The app does **not** subscribe to Supabase Realtime channels. Trade-offs:

- ✅ Simpler mental model, predictable network usage, no connection churn.
- ❌ Concurrent edits by two managers silently overwrite each other; fresh ingestion rows don't appear until the next `refresh()` or reload.

Re-fetching is explicit: per-page `refresh()`, error-state retry buttons, or browser reload.

### 1.7 Three-system topology

The portal is one of three cooperating systems. Bison sends and receives; **n8n** ingests counters/replies and dispatches notifications + OOO routing; the portal is a thin read+config surface. The portal **never**:

- writes to `replies`, `campaign_daily_stats`, or `daily_stats` (those are n8n's),
- sends emails or SMS (n8n does, using `clients.notification_emails` + `sms_phone_numbers`),
- calls Bison APIs directly,
- classifies replies (n8n does).

Full topology and table ownership: [11-integrations.md](./11-integrations.md). Product-level statement of the boundaries: [BUSINESS_LOGIC.md §2](../../BUSINESS_LOGIC.md#2-system-boundaries).

---

## 2. Auth flow

Implemented in [`providers/auth.tsx`](../../../src/app/providers/auth.tsx).

### 2.1 Bootstrap sequence

1. `AuthProvider` calls `supabase.auth.getSession()` on mount and subscribes to `onAuthStateChange` ([auth.tsx:220-245](../../../src/app/providers/auth.tsx#L220-L245)).
2. If a session exists, `loadIdentity()` fires **two calls in parallel** ([auth.tsx:96-99](../../../src/app/providers/auth.tsx#L96-L99)): `repository.loadIdentity(session.user.id)` (gateway action, [index.ts:2659](../../../supabase/functions/orm-gateway/index.ts#L2659)) and `repository.isCurrentAccountActive()` (`current_account_active` RPC).
3. In the gateway, Drizzle reads `public.users` and (for `client` role) `client_users` under RLS passthrough to resolve `clientId`.
4. A deactivated-but-still-authenticated user is rejected with `errorCode: "account_deactivated"` ([auth.tsx:100-106](../../../src/app/providers/auth.tsx#L100-L106)).
5. Compose `Identity`, set it on context; `ShellDataProvider` then loads the shell.

A session-signature ref (`${user.id}:${access_token}`) de-duplicates concurrent identity loads triggered by `getSession()` and `onAuthStateChange` firing together ([auth.tsx:147-205](../../../src/app/providers/auth.tsx#L147-L205)). A failure rolls the signature back so the load can be retried.

Result state exposed by `useAuth()` ([auth.tsx:27-45](../../../src/app/providers/auth.tsx#L27-L45)):

- `session`, `loading`, `error`, `errorCode`
- `actorIdentity` (real user) vs `identity` (effective user under impersonation), `isImpersonating`
- actions: `refreshIdentity`, `signInWithPassword`, `signInWithOtp`, `requestPasswordReset`, `updatePassword`, `updateProfileName`, `updateProfileAvatar`, `impersonate`, `stopImpersonation`, `signOut`

### 2.2 Error codes

`AuthErrorCode` — [auth.tsx:17-25](../../../src/app/providers/auth.tsx#L17-L25):

| Code | Trigger |
|------|---------|
| `runtime_config` | Supabase client could not be constructed (missing env). |
| `profile_missing` | Session valid but no `public.users` row — typically first signin after invite before backend sync. |
| `client_mapping_missing` | `client` role without a `client_users` row. |
| `account_deactivated` | `users.is_active = false`; the account keeps a valid JWT but is denied the workspace. |
| `permission` | RLS denied the identity query. |
| `session_invalid` | Supabase reports the session token is no longer usable. |
| `network` | Connection failure during bootstrap. |
| `unknown` | Anything else. |

Each code maps to a message in [`App.tsx:41-61`](../../../src/app/App.tsx#L41-L61), rendered by `SessionAccessBlocker` ([App.tsx:63](../../../src/app/App.tsx#L63)).

### 2.3 Auth actions

- `signInWithPassword(email, password)` — standard Supabase password login.
- `signInWithOtp(email)` — magic link; only when `VITE_AUTH_ALLOW_MAGIC_LINK`.
- `requestPasswordReset(email)` — uses `appBaseUrl + "/reset-password"` as `redirectTo`.
- `updatePassword(password)` — post-signin change.
- `updateProfileName(fullName)` / `updateProfileAvatar(path)` — write `public.users` through `orm-gateway` under `users_update_self` ([auth.tsx:322-390](../../../src/app/providers/auth.tsx#L322-L390)).
- `signOut()` — clears the session and resets context.
- `refreshIdentity()` — re-runs the identity load (bound to the "Retry" buttons in blockers).
- `impersonate(identity)` / `stopImpersonation()` — super-admin only, **and only outside production** (`allowInternalImpersonation = !isProduction`, [env.ts:34](../../../src/app/lib/env.ts#L34); gate at [auth.tsx:137-141](../../../src/app/providers/auth.tsx#L137-L141)).

### 2.4 Session hygiene

Before every edge-function call, `getSessionAccessToken()` compares `session.expires_at * 1000` to `Date.now() + 60_000` and refreshes if within a minute of expiry — preempting 401s ([repository.ts:297-308](../../../src/app/data/repository.ts#L297-L308)). A failed refresh raises `RepositoryError({ kind: "permission" })` with "Your session expired and could not be refreshed." A 401 that slips through still triggers one refresh-and-retry.

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

`supabase/migrations/20260601b_leads_campaigns_replies_rls_set_based.sql` extended the same rewrite to `leads`, `campaigns` and `replies` (leads: 446 ms → 22 ms). The rule is now ADR-0006 and applies to **every** new policy on a >1 k-row table — see [09 §5](./09-mutations-rls.md#5-rls-performance-rules-adr-0006).

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
- Route-level: `<Suspense fallback={<LoadingState />}>` wrapping lazy chunks ([App.tsx:173](../../../src/app/App.tsx#L173)).
- Per-page: every hook returns `{ data, loading, error, refresh }`; pages render the loading state until the first gateway response lands (no data is available from a snapshot any more).

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
| `app_shell_sidebar_mode` | [app-shell.tsx:98](../../../src/app/components/app-shell.tsx#L98) | `expanded` / `collapsed` desktop sidebar. `app_shell_sidebar_hidden` is the legacy boolean key, still read for migration ([app-shell.tsx:97](../../../src/app/components/app-shell.tsx#L97)). |
| `pdca-color-theme` | [color-theme.tsx:17](../../../src/app/providers/color-theme.tsx#L17) | `contrast` (default) vs `default` palette; sets `data-color-theme` on the root element. |
| `crm_oauth_data` | [crm-integration-card.tsx:26](../../../src/app/components/crm-integration-card.tsx#L26) | In-flight Zoho OAuth handshake state (cleared on completion). |
| `table:campaigns:columns` | [campaigns-page.tsx:387](../../../src/app/pages/campaigns-page.tsx#L387) | Column widths |
| `table:domains:columns` | [domains-page.tsx:302](../../../src/app/pages/domains-page.tsx#L302) | Column widths |
| `table:invoices:columns` | [invoices-page.tsx:88](../../../src/app/pages/invoices-page.tsx#L88) | Column widths |
| `table:leads-report:columns:{admin\|internal}:{n}` | [leads-page.tsx:344](../../../src/app/pages/leads-page.tsx#L344) | Column widths, keyed by variant **and column count** so adding a custom column doesn't restore a stale width array. |
| `table:client-leads-report:columns:{n}` | [client-leads-page.tsx:132](../../../src/app/pages/client-leads-page.tsx#L132) | Same, client portal. |
| `table:clients:mega-columns:{n}` | [clients-page/mega-table.tsx:995,1068](../../../src/app/pages/clients-page/mega-table.tsx#L995) | Clients mega-table column widths. |

`useResizableColumns({ defaults, mins, storageKey })` at [`use-resizable-columns.ts`](../../../src/app/lib/use-resizable-columns.ts) loads from `localStorage` on mount, clamps to mins, and writes back on resize.

---

## 7. Defence in depth

Three overlapping layers:

1. **RLS** — primary, enforced by Postgres. The `orm-gateway` connects with a pooler credential but immediately switches the transaction to the caller's JWT role, so its statements are subject to the same policies as a PostgREST call. Only `send-invite` / `manage-invites` use the service role, and they run server-side.
2. **Server-side field whitelists** — the gateway's `map*Patch` functions drop any column not on the allow-list (ADR-0004 for leads), so a crafted request cannot write `client_id`, `external_id`, reply fields, etc.
3. **Client-side scope functions** (`scopeClients`, `scopeCampaigns`, …) — reapplied by pages before rendering, for UI consistency under impersonation. Not a security boundary.

UI disables inputs by role for ergonomics (e.g. client sees a read-only drawer). RLS then blocks the mutation if the user somehow dispatches one.

---

## 8. Testing

### 8.1 Unit — Vitest + Testing Library

```
pnpm test       # watch mode
pnpm test:run   # single-pass (used in CI)
```

Configuration in `vite.config.ts` under `test: { environment: "jsdom" }`. Test setup files under `src/app/test/`.

Focus: pure functions (`client-metrics`, `client-view-models`, `selectors`, `timeframe`, `format`, `conditions/*`), the gateway contract ([`data/__tests__/repository-orm-gateway.test.ts`](../../../src/app/data/__tests__/repository-orm-gateway.test.ts)), and a few page-level tests that mock `repository`. One **architecture guard** test enforces the cutover: [`snapshot-cutover-guard.test.ts`](../../../src/app/data/__tests__/snapshot-cutover-guard.test.ts) fails if any runtime file reintroduces the deleted bulk-snapshot loader.

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
- Set `VITE_APP_ENV=production` — this also **disables impersonation** (§2.3).
- **Leave `VITE_ORM_GATEWAY_FUNCTION` unset** so the app talks to the stable `orm-gateway`, and deploy the reviewed gateway code to that function.
- Keep `VITE_AUTH_INVITE_ONLY=true` (self-signup off).
- Decide on `VITE_AUTH_ALLOW_MAGIC_LINK`.
- Ensure RLS policies match `docs/reference/supabase-production-rls.sql`.
- Host the static bundle with **SPA rewrites** to `index.html` so client-side routes resolve.
- Serve over HTTPS. Never ship the service_role key or `DATABASE_URL` to the browser.
- Run `pnpm build` and `pnpm test:smoke` against the production URL before cutover.

### 9.3 Secrets hygiene

| Secret | Lives in | Never in |
|---|---|---|
| Publishable (anon) key | browser bundle | — (safe by design) |
| `DATABASE_URL` (transaction pooler) | `orm-gateway` function env ([index.ts:23](../../../supabase/functions/orm-gateway/index.ts#L23)) | browser, repo |
| Service role | `send-invite`, `manage-invites` function env | browser, repo |
| Legacy-CRM publishable key | browser bundle (`VITE_LEGACY_CRM_PUBLISHABLE_KEY`) | — (publishable, read-only project) |

The gateway's pooler credential is the most sensitive value in the system: it is a direct Postgres connection. It is only safe because `executeAsCaller` downgrades the transaction to the caller's role before running any handler — never add a code path that queries `db` outside that transaction.

### 9.4 Observability

Instrumentation exists and is deliberate:

| Signal | Where | What |
|---|---|---|
| `_serverMs` / `_requestId` | every gateway response ([index.ts:2810-2820](../../../supabase/functions/orm-gateway/index.ts#L2810-L2820)) | `total` / `setup` / `handler` + per-query timings; `_requestId` correlates browser ↔ function logs. |
| `[PERF][gateway]` | [repository.ts:426-450](../../../src/app/data/repository.ts#L426-L450) | Per-action fetch time, body size, server breakdown (all 14 tracked select actions). |
| `[GATEWAY_OVERHEAD]` | [repository.ts:444-449](../../../src/app/data/repository.ts#L444-L449) | Warns when `fetchMs - serverMs.total > 1500 ms` — cold start or pooler stall. |
| `[PERF][orm-gateway]` / `[TEMP PERF]` | function logs ([index.ts:756-763](../../../supabase/functions/orm-gateway/index.ts#L756-L763), [2805-2809](../../../supabase/functions/orm-gateway/index.ts#L2805-L2809)) | Per-action and per-query server timings; retrievable via Supabase function logs. |
| Payload breakdowns | `repository.loadClientsOverview` / `loadClientsStats` / `loadClientsMetricsSummary` / `loadAnalyticsOverview` (DEV only) | Per-section KB and row counts, so payload regressions are visible immediately. |
| `perf-mark.ts` / `react-profiler-dev.tsx` | DEV only | Drawer shell-vs-content paint marks; React commit timings with interaction labels. |

All of the above are no-ops or console-only; nothing is shipped to a third-party APM. Supabase's own logs still cover auth and RLS denials. A non-fatal identity error surfaces as a warning banner with the current role ([App.tsx:168-172](../../../src/app/App.tsx#L168-L172)).

---

End of reference. To navigate back: [INDEX.md](./INDEX.md).
