# Reuse Catalog

## Purpose

The fast index of what already exists. **Search here before writing any new component, hook,
helper, type, or selector.** Almost everything you need is already here — the right answer is
usually "extend" or "compose", not "create".

If you add a reusable building block, add it to this file in the same change.

## Reuse-first workflow

1. Classify the change: UI primitive → page/feature → data access → business logic.
2. Search the matching layer below.
3. Extend the closest existing unit when the semantics match. Add a prop or a variant.
4. Create a new unit only when the *ownership* is genuinely different.
5. If you fork something because the existing one "almost" fits — say so in your summary. A silent
   near-duplicate is a defect.

---

## UI primitives

### Internal pages (manager / admin) — [`components/app-ui.tsx`](../src/app/components/app-ui.tsx)

| Export | Use for |
|---|---|
| `PageHeader` | Page title + subtitle + actions (carries the gradient-canvas text-shadow) |
| `Surface` | The standard panel (`#050505`, `border-#242424`, `rounded-2xl`) |
| `Banner` | Persistent context — impersonation, blockers, warnings. Tones: `info \| warning \| danger` |
| `MetricCard` | KPI tile with tinted accent surface |
| `EmptyState` | Dashed-border empty card |
| `LoadingState` | Centred loading pill |
| `InlineLinkButton` | Text-style action inside prose/table cells |
| `ChartTextSummary` | `sr-only` accessible summary for a chart — **required** on new charts |

### Client portal — [`components/portal-ui.tsx`](../src/app/components/portal-ui.tsx)

| Export | Use for |
|---|---|
| `PortalPageHeader`, `PortalSurface` | Portal equivalents of PageHeader / Surface |
| `KpiTile`, `ChartPanel` | Portal KPI + chart container |
| `ResponsiveChart` | Recharts `ResponsiveContainer` wrapper |
| `ChartTooltip`, `PORTAL_CHART_TOOLTIP` | Pre-wired portal tooltip — **do not hand-roll a `contentStyle`** |
| `DateRangeButton`, `FilterChip`, `PortalSearch` | Portal filter controls |
| `PipelineBadge` | Pipeline-stage pill (colour is data-driven — a sanctioned inline style) |
| `LeadDrawer` + `LeadDrawerData` | The lead drawer shell |
| `LeadDetailSections`, `LeadConversation`, `LeadMetaSection` | **The composition seam for lead drawers.** Reused by internal pages too — compose these instead of building a second drawer |
| `EmptyPortalState`, `PortalLoadingState`, `PortalErrorState` | Portal states (`PortalErrorState` is the only one with `onRetry`) |

### Shared components — [`components/`](../src/app/components/)

| File | Exports |
|---|---|
| [`lead-edit-form.tsx`](../src/app/components/lead-edit-form.tsx) | `LeadEditForm`, plus **`EditLabel` / `EditInput`** — the de-facto form primitives (shadcn `form`/`label`/`input` are effectively unused) |
| [`lead-report-table.tsx`](../src/app/components/lead-report-table.tsx) | `LeadReportTable`, `LeadReportSort` — the shared leads grid |
| [`lead-custom-columns-manager.tsx`](../src/app/components/lead-custom-columns-manager.tsx) | `LeadCustomColumnsManager` |
| [`crm-integration-card.tsx`](../src/app/components/crm-integration-card.tsx) | `CrmIntegrationCard` (legacy CRM — [ADR-0010](adr/0010-legacy-crm-integration.md)) |
| [`app-shell.tsx`](../src/app/components/app-shell.tsx) | `AppShell` — sidebar, `NAV_BY_ROLE`, impersonation controls, gradient canvas, contrast toggle |
| [`app-error-boundary.tsx`](../src/app/components/app-error-boundary.tsx) | `AppErrorBoundary` — already wraps the routed surface; do not duplicate |
| [`pages/clients-page/mega-table.tsx`](../src/app/pages/clients-page/mega-table.tsx) | The clients mega-table (its own subsystem) |

### shadcn / Radix — [`components/ui/`](../src/app/components/ui/)

**Only 16 files remain** — 33 unused primitives were deleted 2026-07-14. Reachable:
`badge`, `breadcrumb`, `checkbox`, `input`, `lightweight-sheet`, `pagination`, `popover`, `select`,
`tabs`, `toggle-group`, `tooltip`, `user-avatar`, `utils` (+ `avatar`, `button`, `toggle` which
exist **only** as internal deps — do not import them directly).

Two are custom, not stock shadcn:

- **`lightweight-sheet`** replaces `sheet` (which was deleted).
- **`user-avatar`** replaces `avatar` (which is now an internal dep only).

Most buttons in this codebase are raw `<button>` with Tailwind classes. Match the page you are
editing rather than reintroducing a deleted primitive. Need something genuinely new? Check the
shadcn MCP registry first, then add it deliberately.

`cn(...)` from [`ui/utils.ts`](../src/app/components/ui/utils.ts) is the class combiner
(`clsx` + `tailwind-merge`).

---

## Data access

| Thing | Where |
|---|---|
| **All reads + writes** | [`data/repository.ts`](../src/app/data/repository.ts) → the `orm-gateway` edge function. Pages call `repository.*` **directly** ([ADR-0008](adr/0008-orm-gateway-edge-function.md), [ADR-0009](adr/0009-per-page-data-contracts.md)) |
| Gateway request/response contract | [`data/orm-gateway-contract.ts`](../src/app/data/orm-gateway-contract.ts) + [`types/view-contracts.ts`](../src/app/types/view-contracts.ts) |
| Global shell lookups (the *only* global data) | `useShellData()` — [`providers/shell-data.tsx`](../src/app/providers/shell-data.tsx) |
| Auth, identity, impersonation | `useAuth()` — [`providers/auth.tsx`](../src/app/providers/auth.tsx). Gives `identity` (effective), `actorIdentity` (real), `isImpersonating`, `errorCode` |
| Contrast theme axis | `useColorTheme()` — [`providers/color-theme.tsx`](../src/app/providers/color-theme.tsx) |

There is **no** `useCoreData()` and no global snapshot. Both were deleted.

### Per-page hooks — [`lib/`](../src/app/lib/)

`use-leads`, `use-campaigns`, `use-domains`, `use-invoices`, `use-blacklist`, `use-settings`,
`use-analytics`, `use-lead-custom-columns` — plus co-located ones (`useClientsOverview` in
`clients-page.tsx`, `useAdminDashboard`, `useManagerDashboard`).

All follow the same shape: `useState` + `useEffect` + a **`loadIdRef` stale guard**. Copy
[`use-campaigns.ts`](../src/app/lib/use-campaigns.ts) — do not invent a variant.
([`use-leads.ts`](../src/app/lib/use-leads.ts) uses an older `cancelled`-flag guard; don't propagate
it.)

---

## Business logic

| Thing | Where |
|---|---|
| Role scoping | [`lib/selectors.ts`](../src/app/lib/selectors.ts) — `scopeClients`, `scopeCampaigns`, `scopeLeads`, `scopeReplies`, `scopeCampaignStats`, `scopeDailyStats`, `scopeDomains`, `scopeInvoices`, `getLeadStage`, `getRoleLabel`, `isInternalAdmin` |
| Client KPIs / view models | [`lib/client-view-models.ts`](../src/app/lib/client-view-models.ts) — `getClientKpis`, `getDailySentSeries`, `getPipelineCounts`, `getCampaignPerformance`, `getConversionRates`, `getClientLeadRows`, `formatCompact`, `PIPELINE_STAGES` |
| Heavy aggregations (DoD / 3-DoD / WoW / MoM) | [`lib/client-metrics.ts`](../src/app/lib/client-metrics.ts) — `createClientMetrics`, `sumInRange`, `valueByDayOffset`, `toRate`, `startOfWeek`, `startOfMonth` |
| Dashboard momentum + trend lines | [`lib/dashboard-momentum.ts`](../src/app/lib/dashboard-momentum.ts) — `linearRegression`, `DASHBOARD_CHART_TOOLTIP` |
| Timeframes | [`lib/timeframe.ts`](../src/app/lib/timeframe.ts) — `TimeframeValue`, `createDefaultTimeframe`, `filterByTimeframe`, `resolveTimeframeBounds`, `makePreviousRange`, `TIMEFRAME_PRESETS` |
| Conditions engine | [`lib/conditions/`](../src/app/lib/conditions/) — `evaluator`, `metric-catalog`, `validation`, `mapper`, `types` ([ADR-0011](adr/0011-conditions-rules-engine.md)) |
| Leads report + export | [`lib/lead-report-columns.tsx`](../src/app/lib/lead-report-columns.tsx), [`lib/lead-report-export.ts`](../src/app/lib/lead-report-export.ts), [`lib/lead-draft.ts`](../src/app/lib/lead-draft.ts), [`lib/custom-field-sort.ts`](../src/app/lib/custom-field-sort.ts) |
| Formatting | [`lib/format.ts`](../src/app/lib/format.ts) — `formatNumber`, `formatDate`, `formatMoney`, `getFullName`, `getInitials` |
| Resizable tables | [`lib/use-resizable-columns.ts`](../src/app/lib/use-resizable-columns.ts) — `useResizableColumns({ storageKey, defaultWidths })` (options object, **not** positional args) |
| Avatars (Storage) | [`lib/avatar-storage.ts`](../src/app/lib/avatar-storage.ts) |
| Legacy CRM (read-only) | [`lib/crm-integration.ts`](../src/app/lib/crm-integration.ts) — the one sanctioned second Supabase client |
| Env / runtime config | [`lib/env.ts`](../src/app/lib/env.ts) — `runtimeConfig` |
| Perf instrumentation | [`lib/perf-mark.ts`](../src/app/lib/perf-mark.ts), [`lib/react-profiler-dev.tsx`](../src/app/lib/react-profiler-dev.tsx) |
| Types | [`types/core.ts`](../src/app/types/core.ts) — `AppRole`, `Identity`, `LeadRecord`, all record types. **Don't redeclare.** |

---

## Forbidden duplications

- A second HTTP layer, a second auth context, a second global data store, a second metric
  calculator.
- Importing `@supabase/supabase-js` outside `data/`, `lib/supabase.ts`, `lib/avatar-storage.ts`,
  `providers/auth.tsx` — and the one documented exception, `lib/crm-integration.ts`
  ([ADR-0010](adr/0010-legacy-crm-integration.md)).
- Re-declaring date helpers, percentage helpers, or chart tooltip styles. They exist.
- A second lead drawer. Compose `LeadConversation` / `LeadMetaSection` / `LeadEditForm`.
- Service-role keys or `DATABASE_URL` anywhere the browser can reach them.
