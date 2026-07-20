# 01 · Overview

## Purpose

PdcaFigmaTest is the frontend for the **ColdUnicorn PDCrmA portal** — an agency operations platform for running outbound email campaigns on behalf of clients. Three primary roles use the system:

- **Client** — the end-customer whose outreach is being run. Sees their own pipeline, campaign results, and contract KPI progress.
- **Manager** (displayed as *"CS Manager"*) — the success/ops person assigned to a portfolio of clients. Operates leads, campaigns, domains, invoices, and the blacklist for those assigned clients.
- **Admin / Super-admin** — agency staff with global visibility. Manages all clients, invites users, edits the email blacklist. Super-admin can additionally impersonate any role.

The product embodies the **PDCA loop** (Plan-Do-Check-Act): managers plan outreach (campaigns + domains), run it (`sent`/`reply`/`bounce` daily counters flow in), check performance (DoD / 3-DoD / WoW / MoM dashboards), and act on qualified leads (pipeline stage transitions).

> **For the canonical product specification (what the portal *is*, role-by-role, in-scope vs out-of-scope), read [`docs/BUSINESS_LOGIC.md`](../../BUSINESS_LOGIC.md). This file describes the implementation that supports it.**

## Architecture (high level)

Every runtime read and write goes through **one edge function** — the `orm-gateway`. The browser holds no direct data client: `supabase-js` is used only for Auth, five SECURITY DEFINER RPCs, Storage (avatars) and a second, read-only client pointed at the legacy CRM project.

```
  Browser (React SPA)                            Supabase
  ───────────────────                            ────────
  AuthProvider  ── supabase.auth ───────────────▶ auth.users (Supabase Auth)
                                                  │
  ShellDataProvider ─ loadShellData ─┐            │
  per-page hooks (use-*.ts)  ────────┤            │
     loadLeadsList, loadCampaignsList,│           │
     loadClientDashboard, …           │  POST     ▼
  page-level mutations       ────────┼─────▶ Edge Function: orm-gateway
     repository.updateLead(…)        │        (Drizzle ORM + postgres.js,
     repository.createClient(…)      │         transaction-local JWT claims
                                     │         + SET ROLE → RLS applies)
                                     │              │
  repository.sendInvite / listInvites├─────▶ send-invite, manage-invites
  repository.listManagedUsers …      ├─────▶ SECURITY DEFINER RPCs (supabase.rpc)
  avatar upload (avatar-storage.ts)  ├─────▶ Storage bucket `user-avatars`
  crm-integration.ts                 └─────▶ (2nd Supabase project — legacy CRM)
                                                    │
                                                    ▼
                                              Postgres + RLS
```

- **Transport:** `POST ${VITE_SUPABASE_URL}/functions/v1/${runtimeConfig.ormGatewayFunction}` ([repository.ts:323-339](../../../src/app/data/repository.ts#L323-L339)). Production uses the single canonical `orm-gateway` (the default); `VITE_ORM_GATEWAY_FUNCTION` overrides it only for a dev build targeting a temporary WIP function ([env.ts:29](../../../src/app/lib/env.ts#L29)).
- **Contract:** a discriminated union of ~46 actions in [`data/orm-gateway-contract.ts`](../../../src/app/data/orm-gateway-contract.ts) (shared verbatim by the frontend and the Deno function), with page-level response shapes in [`types/view-contracts.ts`](../../../src/app/types/view-contracts.ts).
- **Envelope:** `{ ok, data, _serverMs: { total, setup, handler, … }, _requestId }` ([orm-gateway/index.ts:2810-2820](../../../supabase/functions/orm-gateway/index.ts#L2810-L2820)).

Key properties:

- **Three cooperating systems.** Smartlead/Bison send and receive emails; **n8n** ingests counters/replies and dispatches notifications + OOO routing; **the portal** is a thin read+config surface on top of Supabase. The portal never sends notifications, never classifies replies, never calls Smartlead/Bison APIs. See [11-integrations.md](./11-integrations.md) for the full topology.
- **Single source of truth is Supabase** (ADR-0001). No alternative local-data path; the app refuses to boot if `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are missing. The one sanctioned exception is the read-only legacy-CRM project used by the CRM integration card (ADR-0010, [`lib/crm-integration.ts`](../../../src/app/lib/crm-integration.ts)).
- **RLS stays authoritative through the gateway.** `executeAsCaller` opens a transaction and replays the caller's JWT claims + role into transaction-local settings in a single round-trip ([orm-gateway/index.ts:694-728](../../../supabase/functions/orm-gateway/index.ts#L694-L728)), so every Drizzle query is executed *as* the signed-in user. Client-side scope functions (`lib/selectors.ts`) are defence in depth and UI consistency — not security.
- **Per-page loading, no global snapshot** (ADR-0009). `ShellDataProvider` fetches only lite users/clients/mappings ([`providers/shell-data.tsx`](../../../src/app/providers/shell-data.tsx)); every page then loads exactly one gateway action through its own hook (`lib/use-*.ts`, or co-located like `useClientsOverview` in [clients-page.tsx:158](../../../src/app/pages/clients-page.tsx#L158)). There is no global data provider and no bulk-snapshot loader.
- **Server computes facts, client computes interpretation.** The gateway performs the heavy aggregation (dashboard rollups, per-client metric summaries, filter/sort/paginate for leads); KPI/health/stage *formulas* stay in `client-metrics.ts` / `client-view-models.ts` / `selectors.ts`. The rule is stated at [view-contracts.ts:3-6](../../../src/app/types/view-contracts.ts#L3-L6).
- **No realtime.** Refresh is explicit: each page hook exposes `refresh()`, and mutations call it (or patch local state) themselves.
- **Role-based route shells** (ADR-0002). Each role has its own URL prefix (`/client/*`, `/manager/*`, `/admin/*`) and its own navigation menu defined in [`app-shell.tsx`](../../../src/app/components/app-shell.tsx).
- **Client sees outreach campaigns only** (ADR-0003). Enforced at both RLS (`campaigns_select_scoped`, `campaign_daily_stats_select_scoped`) and client-side (`scopeCampaigns`).
- **Lead state boundaries** (ADR-0004). Editable by internal roles only; the whitelist is enforced server-side in `mapLeadPatch` ([orm-gateway/index.ts:392-427](../../../supabase/functions/orm-gateway/index.ts#L392-L427)). Replies are read-only history.

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Language | TypeScript | strict mode |
| UI framework | React 18.3 | function components, `lazy` route chunks |
| Build | Vite 6 | `pnpm dev`, `pnpm build` |
| Router | `react-router-dom` 7.13 | nested routes, `Outlet`, `Navigate` |
| Styling | Tailwind CSS v4 + `tw-animate-css` | dark theme (`.dark` on root div), mostly hand-styled panels |
| Components | Radix UI primitives + shadcn/ui patterns + MUI (icons) | see `src/app/components/ui/*` |
| Charts | `recharts` 2.15 | plus custom SVG sparklines and HTML bar funnel |
| Forms | Hand-rolled + `react-hook-form` (present, used sparingly) | drafts with "Save/Cancel" pattern |
| Notifications | `sonner` | top-right toasts |
| State | React context (`ColorThemeProvider`, `AuthProvider`, `ShellDataProvider`) + per-page hooks | no Redux / Zustand, no global data store |
| Data transport | `orm-gateway` edge function (Deno) | Drizzle ORM + `postgres.js` against the transaction pooler |
| Database client | `@supabase/supabase-js` 2.57 | publishable key only; auth + 5 RPCs + Storage only |
| Schema modelling | `drizzle-orm` + `drizzle-kit` | `db:introspect`, `db:generate`, `db:migrate` scripts; schema shared with the edge function |
| Tests | `vitest` + `@testing-library/react` + Playwright smoke | `pnpm test:run`, `pnpm test:smoke` |
| Linter | ESLint 9 flat config | `pnpm lint` |

`package.json` is the authoritative dependency list — see [`package.json`](../../../package.json).

## Top-level folder map

```
src/
  main.tsx                     — ReactDOM entry
  app/
    App.tsx                    — router, RequireRole, blockers, RuntimeConfigScreen
    providers/
      index.tsx                — AppProviders = ColorTheme > Auth > ShellData
      auth.tsx                 — AuthProvider, useAuth, impersonation, deactivation gate
      shell-data.tsx           — ShellDataProvider/useShellData (usersLite, clientsLite, clientUsers)
      color-theme.tsx          — default vs "contrast" palette, persisted in localStorage
    components/
      app-shell.tsx            — sidebar, nav, impersonation controls
      app-error-boundary.tsx
      app-ui.tsx               — PageHeader, Banner, Surface, MetricCard, EmptyState, LoadingState
      portal-ui.tsx            — client-portal variants (PortalSurface, KpiTile, ChartPanel,
                                 DateRangeButton, FilterChip, LeadDrawer, PipelineBadge, etc.)
      ui/                      — shadcn-style primitives (select, dialog, sheet, tabs, …)
    pages/
      dashboard-page.tsx       — dispatches to Client/Manager/Admin dashboard by role
      client-dashboard-page.tsx
      manager-dashboard-page.tsx
      admin-dashboard-page.tsx
      leads-page.tsx           — internal (manager/admin) leads workspace; dispatches to ClientLeadsPage for client role
      client-leads-page.tsx
      campaigns-page.tsx       — same split; renders ClientCampaignsPage for client role
      client-campaigns-page.tsx
      statistics-page.tsx      — same split
      client-statistics-page.tsx
      clients-page.tsx         — manager/admin
      domains-page.tsx         — manager/admin
      invoices-page.tsx        — manager/admin
      blacklist-page.tsx       — manager read-only, admin write
      admin-user-management-page.tsx
      settings-page.tsx        — all roles, with role-conditional sections
      login-page.tsx           — multi-mode (signin / reset / magic link)
      reset-password-page.tsx
    data/
      repository.ts            — the ONLY data boundary (gateway actions, invite fns, admin RPCs)
      orm-gateway-contract.ts  — request/response union shared with the edge function
    lib/
      env.ts                   — runtimeConfig (URLs, gateway function name, flags)
      supabase.ts              — createClient (publishable key)
      crm-integration.ts       — 2nd Supabase client → legacy CRM project (ADR-0010)
      avatar-storage.ts        — user-avatars bucket upload/delete/public-url
      use-leads.ts / use-campaigns.ts / use-analytics.ts / use-domains.ts /
      use-invoices.ts / use-blacklist.ts / use-settings.ts /
      use-lead-custom-columns.ts — per-page gateway hooks (ADR-0009)
      selectors.ts             — role scoping + getLeadStage + getRoleLabel
      client-view-models.ts    — getClientKpis, getDailySentSeries, getPipelineCounts,
                                 getPipelineActivitySeries, getCampaignPerformance,
                                 getConversionRates, getClientLeadRows, formatCompact,
                                 PIPELINE_STAGES
      client-metrics.ts        — createClientMetrics (DoD/3-DoD/WoW/MoM)
      dashboard-momentum.ts    — momentum/trend series for the dashboards
      conditions/              — condition-rules DSL: types, evaluator, mapper,
                                 metric-catalog, validation, client-condition-context (ADR-0011)
      lead-report-columns.tsx  — leads report column defs (incl. custom columns)
      lead-report-export.ts    — CSV export (re-pages loadLeadsList)
      timeframe.ts             — TimeframeValue, presets, bounds
      format.ts                — formatNumber, formatDate, formatMoney, getFullName
      use-resizable-columns.ts — persistable column widths via localStorage
      perf-mark.ts             — dev-only shell/content paint marks
      react-profiler-dev.tsx   — dev-only React.Profiler wrappers
    types/
      core.ts                  — AppRole, Identity, record types, invite types
      view-contracts.ts        — per-page payload shapes returned by gateway actions
    imports/                   — static assets (logo)
    styles/                    — Tailwind base
    test/                      — vitest setup
supabase/
  functions/orm-gateway/       — Drizzle runtime data gateway (RLS passthrough) + rls-context.ts
  functions/send-invite/       — invite creation (service role)
  functions/manage-invites/    — list / resend / revoke (service role)
  drizzle/schema.ts            — authoritative Drizzle schema; imported by the gateway
  migrations/                  — SQL migrations (RLS perf, master_admin, user mgmt, custom fields…)
docs/
  adr/                         — 11 decision records
  reference/                   — short cheat-sheets + this functional/ folder
  archive/                     — historical specs
```

## Architecture Decision Records (quick pointers)

| ADR | Title | Essence |
|-----|-------|---------|
| [0001](../../adr/0001-live-supabase-source-of-truth.md) | Live Supabase source of truth | Supabase project `bnetnuzxynmdftiadwef` is the only data system; no alternative backend. |
| [0002](../../adr/0002-route-based-role-shells.md) | Route-based role shells | Each role has its own URL prefix and nav; no runtime role switcher. Super-admin impersonation navigates into the target shell. |
| [0003](../../adr/0003-client-campaign-visibility.md) | Client campaign visibility | Clients only see `campaigns.type = 'outreach'`; OOO / nurture / ooo_followup are internal. |
| [0004](../../adr/0004-lead-state-boundaries.md) | Lead state boundaries | Replies are read-only. Editable lead fields are `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, notes. `won` implies the pipeline terminus. |
| [0005](../../adr/0005-master-admin-role.md) | `master_admin` role | Fifth `user_role` value; admin-tier in every `private.*` helper, seeded manually. |
| [0006](../../adr/0006-set-based-rls-predicates.md) | Set-based RLS predicates | SELECT policies on >1k-row tables must use `client_id IN (SELECT …)`, never a per-row helper call. |
| [0007](../../adr/0007-per-client-lead-custom-fields.md) | Per-client custom lead columns | `lead_custom_fields` + `_values`; definitions admin-only, values gated by `editable_by`. |
| [0008](../../adr/0008-orm-gateway-edge-function.md) | ORM gateway | All runtime data flows through one edge function running Drizzle with transaction-local JWT/role passthrough. |
| [0009](../../adr/0009-per-page-data-contracts.md) | Per-page data loading | The global snapshot is gone; each page owns one gateway action behind a `loadIdRef`-guarded hook. |
| [0010](../../adr/0010-legacy-crm-integration.md) | Legacy CRM exception | A second, read-only Supabase client for the legacy CRM project is the only sanctioned deviation from ADR-0001. |
| [0011](../../adr/0011-conditions-rules-engine.md) | Conditions engine | Client-health rules are data (`condition_rules` JSON DSL), evaluated in `lib/conditions/*`. |

## Runtime configuration

Loaded from Vite env at startup (see [`env.ts`](../../../src/app/lib/env.ts)). Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_BASE_URL` — **required only when `VITE_APP_ENV=production`**; used for password-reset redirects. Outside production it falls back to `window.location.origin` ([env.ts:22-23](../../../src/app/lib/env.ts#L22-L23)).

Optional:

| Variable | Default | Effect |
|---|---|---|
| `VITE_APP_ENV` | `production` in prod builds | Sets `isProduction`, which also **disables impersonation** (`allowInternalImpersonation = !isProduction`, [env.ts:34](../../../src/app/lib/env.ts#L34)). There is no separate impersonation flag. |
| `VITE_ORM_GATEWAY_FUNCTION` | `orm-gateway` | Which deployed edge function the gateway calls. Production uses the canonical `orm-gateway`; override only for a dev build targeting a temporary WIP function. |
| `VITE_AUTH_INVITE_ONLY` | `true` | When true, forces self-signup off. |
| `VITE_AUTH_ALLOW_SELF_SIGNUP` | `false` | Ignored while `VITE_AUTH_INVITE_ONLY` is true. |
| `VITE_AUTH_ALLOW_MAGIC_LINK` | `true` | Shows the magic-link mode on the login page. |
| `VITE_LEGACY_CRM_SUPABASE_URL` / `VITE_LEGACY_CRM_PUBLISHABLE_KEY` | — | Enables the CRM integration card (ADR-0010). `legacyCrmConfigured` is false when either is absent, and the card hides itself. |

If any required variable is missing, `runtimeConfig.isConfigured` is `false` and `App` renders `RuntimeConfigScreen` instead of bootstrapping ([App.tsx:288-291](../../../src/app/App.tsx#L288-L291)).

## Non-goals

- **No self-service signup** for production (ADR-0001 derivative). Users are provisioned via invites from Admin.
- **No offline / local-first mode.** The app requires a working Supabase connection.
- **No global data store.** No Redux/Zustand, no snapshot context; page state is local to the page.
- **No metric formulas on the server.** The gateway aggregates *facts* (counts, sums, GROUP BY, top-N, pagination); rates, stages, health and KPI progress stay in the frontend libs ([view-contracts.ts:3-6](../../../src/app/types/view-contracts.ts#L3-L6)).
- **No realtime subscriptions.** Data refresh is explicit (`refresh()` per page hook).

Next: [02 · Roles & Routes](./02-roles-routes.md).
