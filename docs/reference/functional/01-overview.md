# 01 · Overview

## Purpose

PdcaFigmaTest is the frontend for the **ColdUnicorn PDCA portal** — an agency operations platform for running outbound email campaigns on behalf of clients. Three primary roles use the system:

- **Client** — the end-customer whose outreach is being run. Sees their own pipeline, campaign results, and contract KPI progress.
- **Manager** (displayed as *"CS Manager"*) — the success/ops person assigned to a portfolio of clients. Operates leads, campaigns, domains, invoices, and the blacklist for those assigned clients.
- **Admin / Super-admin** — agency staff with global visibility. Manages all clients, invites users, edits the email blacklist. Super-admin can additionally impersonate any role.

The product embodies the **PDCA loop** (Plan-Do-Check-Act): managers plan outreach (campaigns + domains), run it (`sent`/`reply`/`bounce` daily counters flow in), check performance (DoD / 3-DoD / WoW / MoM dashboards), and act on qualified leads (pipeline stage transitions).

> **For the canonical product specification (what the portal *is*, role-by-role, in-scope vs out-of-scope), read [`docs/BUSINESS_LOGIC.md`](../../BUSINESS_LOGIC.md). This file describes the implementation that supports it.**

## Architecture (high level)

```
  Browser (React SPA)                    Supabase
  ─────────────────                      ────────
  react-router        ─── routes ─┐
  AuthProvider        ─── auth ───┼───▶  auth.users (Supabase Auth)
  CoreDataProvider    ─── read ───┼───▶  Edge Function: orm-gateway
     loadSnapshot()               │         leads, replies, daily_stats,
                                  │         campaign_daily_stats, domains,
                                  │         invoices, email_exclude_list)
  repository          ─── write ──┤
     update*                      │
                                  └───▶  Postgres via Drizzle ORM + RLS passthrough
  repository          ─── fn  ────────▶ Edge Functions:
     data actions                          - orm-gateway
     sendInvite                            - send-invite
     listInvites / resend / revoke         - manage-invites
```

Key properties:

- **Three cooperating systems.** Smartlead/Bison send and receive emails; **n8n** ingests counters/replies and dispatches notifications + OOO routing; **the portal** is a thin read+config surface on top of Supabase. The portal never sends notifications, never classifies replies, never calls Smartlead/Bison APIs. See [11-integrations.md](./11-integrations.md) for the full topology.
- **Single source of truth is Supabase** (ADR-0001). No alternative local-data path; the app refuses to boot if `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are missing.
- **RLS is the primary access-control layer.** Client-side scope functions (`lib/selectors.ts`) exist as defence in depth and for consistent UI filtering — they do not enforce security.
- **Bulk snapshot loading**, no realtime. `CoreDataProvider` calls `repository.loadSnapshot()` once on mount; repository dispatches to `orm-gateway` which executes Drizzle queries with the same 90/180-day windows on the fact tables. UI refreshes after mutations by patching the in-memory snapshot and falling back to `refresh()` for reconciliation.
- **Metrics are computed client-side.** Granular rows ship to the browser so that timeframe pickers and drill-downs work without re-fetching.
- **Role-based route shells** (ADR-0002). Each role has its own URL prefix (`/client/*`, `/manager/*`, `/admin/*`) and its own navigation menu defined in [`app-shell.tsx`](../../../src/app/components/app-shell.tsx).
- **Client sees outreach campaigns only** (ADR-0003). Enforced at both RLS (`campaign_daily_stats_select_scoped`) and client-side (`scopeCampaigns`).
- **Lead state boundaries** (ADR-0004). Editable by internal roles only: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments`. Replies are read-only history.

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
| State | React context (`AuthProvider`, `CoreDataProvider`) | no Redux / Zustand |
| Database client | `@supabase/supabase-js` 2.57 | publishable key only on client |
| Schema modelling | `drizzle-orm` + `drizzle-kit` | `db:introspect`, `db:generate`, `db:migrate` scripts |
| Tests | `vitest` + `@testing-library/react` + Playwright smoke | `pnpm test:run`, `pnpm test:smoke` |
| Linter | ESLint 9 flat config | `pnpm lint` |

`package.json` is the authoritative dependency list — see [`package.json`](../../../package.json).

## Top-level folder map

```
src/
  main.tsx                     — ReactDOM entry
  app/
    App.tsx                    — router, RequireAuth, RequireRole, blockers
    providers/
      index.tsx                — AppProviders = Auth + CoreData
      auth.tsx                 — AuthProvider, useAuth, impersonation
      core-data.tsx            — CoreDataProvider, useCoreData, mutation wrappers
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
      repository.ts            — runtime data boundary (orm-gateway + invite edge functions)
    lib/
      env.ts                   — runtimeConfig (publishable key, flags)
      supabase.ts              — createClient
      selectors.ts             — role scoping + getLeadStage + getRoleLabel
      client-view-models.ts    — getClientKpis, getDailySentSeries, getPipelineCounts,
                                 getPipelineActivitySeries, getCampaignPerformance,
                                 getConversionRates, getClientLeadRows, formatCompact,
                                 PIPELINE_STAGES
      client-metrics.ts        — createClientMetrics (DoD/3-DoD/WoW/MoM)
      timeframe.ts             — TimeframeValue, presets, bounds
      format.ts                — formatNumber, formatDate, formatMoney, getFullName
      use-resizable-columns.ts — persistable column widths via localStorage
    types/
      core.ts                  — AppRole, Identity, record types, invite types
    imports/                   — static assets (logo)
    styles/                    — Tailwind base
    test/                      — vitest setup
supabase/
  functions/orm-gateway/       — Drizzle runtime data gateway (RLS passthrough)
  drizzle/schema.ts            — the authoritative Drizzle schema reflecting the live project
  migrations/                  — SQL migrations (RLS performance fix, admin dashboard view)
docs/
  adr/                         — 4 decision records
  reference/                   — short cheat-sheets + this functional/ folder
  archive/                     — historical specs
```

## Architecture Decision Records (quick pointers)

| ADR | Title | Essence |
|-----|-------|---------|
| [0001](../adr/0001-live-supabase-source-of-truth.md) | Live Supabase source of truth | Supabase project `bnetnuzxynmdftiadwef` is the only data system; no alternative backend. |
| [0002](../adr/0002-route-based-role-shells.md) | Route-based role shells | Each role has its own URL prefix and nav; no runtime role switcher. Super-admin impersonation navigates into the target shell. |
| [0003](../adr/0003-client-campaign-visibility.md) | Client campaign visibility | Clients only see `campaigns.type = 'outreach'`; OOO / nurture / ooo_followup are internal. |
| [0004](../adr/0004-lead-state-boundaries.md) | Lead state boundaries | Replies are read-only. Editable lead fields are `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments`. `won` implies the pipeline terminus. |

## Runtime configuration

Loaded from Vite env at startup (see [`env.ts`](../../../src/app/lib/env.ts)). Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_BASE_URL` — used for password-reset redirects

Optional:

- `VITE_APP_ENV` — label only
- `VITE_AUTH_ALLOW_SELF_SIGNUP` (default `false` for production)
- `VITE_AUTH_ALLOW_MAGIC_LINK` (default `true`)
- `VITE_ALLOW_INTERNAL_IMPERSONATION` — gates super-admin impersonation UI

If any required variable is missing, `runtimeConfig.isConfigured` is `false` and `App` renders `RuntimeConfigScreen` instead of bootstrapping ([App.tsx:259](../../../src/app/App.tsx#L259)).

## Non-goals

- **No self-service signup** for production (ADR-0001 derivative). Users are provisioned via invites from Admin.
- **No offline / local-first mode.** The app requires a working Supabase connection.
- **No server-side metric rollups** (other than the `admin_dashboard_daily` view). All analytics are computed on the client from raw rows.
- **No realtime subscriptions** today. Data refresh is explicit.

Next: [02 · Roles & Routes](./02-roles-routes.md).
