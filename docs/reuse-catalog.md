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
| [`lead-crm-table.tsx`](../src/app/components/lead-crm-table.tsx) | `LeadCrmTable` — the banded CRM grid ([ADR-0013](adr/0013-lead-crm-view-and-status-taxonomy.md)). `showStageStrip` / `showHealth` off = the calm combined view |
| [`lead-view-mode-switcher.tsx`](../src/app/components/lead-view-mode-switcher.tsx) | `LeadViewModeSwitcher` — the PDCA / CRM / Combined switch. **One control for both leads surfaces** (internal `leads-page.tsx` and client `client-leads-page.tsx`) |
| [`lead-custom-columns-manager.tsx`](../src/app/components/lead-custom-columns-manager.tsx) | `LeadCustomColumnsManager` |
| [`crm-integration-card.tsx`](../src/app/components/crm-integration-card.tsx) | `CrmIntegrationCard` (legacy CRM — [ADR-0010](adr/0010-legacy-crm-integration.md)) |
| [`archive-controls.tsx`](../src/app/components/archive-controls.tsx) | **`ArchiveButton` / `ShowArchivedToggle` / `ArchivedBadge`** — the portal's delete UI for clients, campaigns, leads, domains, invoices and mailboxes. One component for all six surfaces: confirmation wording, the toast and the error path must not drift. Do **not** hand-roll a delete control; do not add a hard-delete for these entities ([09 §2.19](reference/functional/09-mutations-rls.md#219-setentityarchivedentity-id-archived--the-portals-delete-migration-20260813_entity_archival)) |
| [`app-shell.tsx`](../src/app/components/app-shell.tsx) | `AppShell` — sidebar, `NAV_BY_ROLE`, impersonation controls, gradient canvas, contrast toggle |
| [`app-error-boundary.tsx`](../src/app/components/app-error-boundary.tsx) | `AppErrorBoundary` — already wraps the routed surface; do not duplicate |
| [`pages/clients-page/mega-table.tsx`](../src/app/pages/clients-page/mega-table.tsx) | The clients mega-table (its own subsystem) |
| [`pages/clients-page/workspace-picker.tsx`](../src/app/pages/clients-page/workspace-picker.tsx) | `WorkspacePicker` — loads a vendor's unclaimed workspaces on demand (`requestWorkspaceSetup` with `clientId: null`) and lets the operator pick one. Used by the New client sheet **and** by the drawer's workspace field. Also owns `SEQUENCER_TITLES` and the `SequencerKey` / `WorkspaceChoice` types |
| [`pages/clients-page/sequencer-connections.tsx`](../src/app/pages/clients-page/sequencer-connections.tsx) | `SequencerConnections` — the whole **Credentials & IDs** drawer section: per-sequencer keys, the provisioning verdict and the Check / Set up buttons behind a per-card disclosure ([ADR-0018](adr/0018-gateway-outbound-automation-trigger.md)). Owns `SecretInput`, `MaskedField` and `WorkspaceIdField` (the workspace id, from the list or typed). Reads `client_sequencers.setup_state`, never writes it |

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

**Per-client CRM connections are not reachable from the portal at all.**
`public.client_crm_connections` is RLS-enabled with **no policies and no grants** for `anon` /
`authenticated` — `service_role` (n8n) only. There
is no repository method and there must not be one; the table holds clients' CRM API keys and OAuth
refresh tokens. n8n reaches it through `resolve_crm_connection` / `upsert_client_crm_connection` /
`resolve_client_for_crm_intake` / `store_crm_oauth_tokens`
([ADR-0019](adr/0019-crm-connections-in-postgres.md),
[20260828b](../supabase/migrations/20260828b_client_crm_connections.sql)). If a CRM **status** badge
is ever needed, add a view that omits `credentials` — never a SELECT policy on the table.

**The gateway makes exactly one kind of outbound call**: `requestWorkspaceSetup` triggers an n8n
provisioning workflow, to a URL from a closed server-side list, with a shared secret
([ADR-0018](adr/0018-gateway-outbound-automation-trigger.md)). It never calls a vendor — n8n holds
those credentials. Any *other* outbound need is a new ADR, not a new parameter on this one. Reading
provisioning status is not an outbound call: `setup_state` rides on `loadClientsOverview`.

### Per-page hooks — [`lib/`](../src/app/lib/)

`use-leads`, `use-campaigns`, `use-domains`, `use-email-accounts`, `use-invoices`, `use-blacklist`,
`use-settings`, `use-analytics`, `use-lead-custom-columns` — plus co-located ones (`useClientsOverview`
in `clients-page.tsx`, `useAdminDashboard`, `useManagerDashboard`).

All follow the same shape: `useState` + `useEffect` + a **`loadIdRef` stale guard**. Copy
[`use-campaigns.ts`](../src/app/lib/use-campaigns.ts) — do not invent a variant.
([`use-leads.ts`](../src/app/lib/use-leads.ts) uses an older `cancelled`-flag guard; don't propagate
it.)

---

## Business logic

| Thing | Where |
|---|---|
| Role scoping | [`lib/selectors.ts`](../src/app/lib/selectors.ts) — `scopeClients`, `scopeCampaigns`, `scopeLeads`, `scopeReplies`, `scopeCampaignStats`, `scopeDailyStats`, `scopeDomains`, `scopeEmailAccounts` (mailboxes via `domain → client`), `scopeInvoices`, `getLeadStage`, `getRoleLabel`, `isInternalAdmin` |
| Client KPIs / view models | [`lib/client-view-models.ts`](../src/app/lib/client-view-models.ts) — `getClientKpis`, `getDailySentSeries`, `getPipelineCounts`, `getCampaignPerformance`, `getConversionRates`, `getClientLeadRows`, `formatCompact`, `PIPELINE_STAGES` |
| Heavy aggregations (DoD / 3-DoD / WoW / MoM) | [`lib/client-metrics.ts`](../src/app/lib/client-metrics.ts) — `createClientMetrics`, `createClientMetricsFromSummary`, `projectMetricsToChannel` (narrow a pack to EmailBison / Aimfox for the clients-grid channel switch — its condition-side twin is `withChannelLeadBands` in [`pages/clients-page.tsx`](../src/app/pages/clients-page.tsx), which narrows only the 3-DoD / WoW / MoM rows so a cell rule grades the number on screen), `sumInRange`, `valueByDayOffset`, `toRate`, `startOfWeek`, `startOfMonth` |
| OOO routing health | [`lib/ooo-health.ts`](../src/app/lib/ooo-health.ts) — `OOO_LIVE_STATUSES`, `OOO_ROUTABLE_STATUSES`, `isOooLive`, `isOooRoutable`, `oooStatusNote`, `oooHealthRank`, `oooHealthWord`. **Never re-derive "is this OOO rule working"**: the Clients grid reads a server aggregate and the client drawer reads loaded campaigns, and the two disagreed the moment they were written separately. `live` (sending now) and `routable` (`active\|launching\|draft`, what provisioning may fill a rule from) are different questions — keep them apart. The SQL twin is the `oooRoutingHealth` aggregate in `loadClientsOverview`; the n8n twin is `ROUTABLE` in `bison-workspace-setup`. `unrecoverable` splits the dead rules by WHO fixes them — an archived campaign needs a human (Bison has no unarchive endpoint), a paused one is switched back on by `bison-ooo-campaign-revive` overnight |
| Dashboard momentum + trend lines | [`lib/dashboard-momentum.ts`](../src/app/lib/dashboard-momentum.ts) — `linearRegression`, `DASHBOARD_CHART_TOOLTIP` |
| Timeframes | [`lib/timeframe.ts`](../src/app/lib/timeframe.ts) — `TimeframeValue`, `TIMEFRAME_PRESETS`, `DEFAULT_TIMEFRAME_PRESET`, `createDefaultTimeframe`, `filterByTimeframe`, `resolveTimeframeBounds`, `getTimeframeLabel`, `normalizeTimeframePreset` (degrade a retired or bookmarked preset to the default — **never** switch on `timeframe.preset` yourself) |
| Previous-period comparison range | [`pages/client-dashboard-page.tsx`](../src/app/pages/client-dashboard-page.tsx) — `makePreviousRange` (lives on the page, not in `lib/timeframe.ts`) |
| Gradients | [`styles/theme.css`](../src/styles/theme.css) — `--rainbow-sweep` + `.rainbow-active`, the house rainbow for a selected state ([design-system §2.3a](reference/design-system.md)). The only gradient token; do not author a second. |
| Conditions engine | [`lib/conditions/`](../src/app/lib/conditions/) — `evaluator`, `metric-catalog`, `validation`, `mapper`, `types` ([ADR-0011](adr/0011-conditions-rules-engine.md)) |
| Leads report + export | [`lib/lead-report-columns.tsx`](../src/app/lib/lead-report-columns.tsx), [`lib/lead-report-export.ts`](../src/app/lib/lead-report-export.ts), [`lib/lead-draft.ts`](../src/app/lib/lead-draft.ts), [`lib/custom-field-sort.ts`](../src/app/lib/custom-field-sort.ts) |
| Lead view modes | [`lib/crm/lead-view-mode.ts`](../src/app/lib/crm/lead-view-mode.ts) — `LeadViewMode`, `isCrmViewMode`. The taxonomy lives in `lib/`, not in the switcher component, so the loader and the column builder key on it without importing UI. **Don't re-declare the union on a page** |
| Leads CRM view columns | [`lib/lead-crm-columns.tsx`](../src/app/lib/lead-crm-columns.tsx) — `buildLeadColumnsForViewMode({ viewMode, reportColumns, … })` owns the whole mode→columns rule (PDCA builds none, CRM is the banded set, Combined is the union); `buildLeadCrmColumns` is the role-aware CRM set underneath it (internal-only columns are dropped for `client`). The canonical registry is [`lib/crm/lead-crm-registry.ts`](../src/app/lib/crm/lead-crm-registry.ts); health + status live in [`lib/crm/`](../src/app/lib/crm/) |
| Leads CRM read-model | [`lib/use-lead-crm.ts`](../src/app/lib/use-lead-crm.ts) — `useLeadViewModeList(params, viewMode)` is the loader **both** leads pages use: it owns the mode→action rule (PDCA → `loadLeadsList`, CRM/Combined → `loadLeadCrmList`, only the active one fetches) and the memo-stable `healthContext`. A switched-off loader keeps its response only while the params still match (instant switch back, no stale rows otherwise) and exposes **`isDataCurrent`** — anything that BUFFERS rows across pages must gate on it, because effects run after the render that changed the params. `useLeadCrmList(params, { enabled })` is the raw `loadLeadCrmList` hook underneath |
| Formatting | [`lib/format.ts`](../src/app/lib/format.ts) — `formatNumber`, `formatDate`, `formatMoney`, `getFullName`, `getInitials` |
| Resizable tables | [`lib/use-resizable-columns.ts`](../src/app/lib/use-resizable-columns.ts) — `useResizableColumns({ storageKey, defaultWidths })` (options object, **not** positional args) |
| Avatars (Storage) | [`lib/avatar-storage.ts`](../src/app/lib/avatar-storage.ts) |
| Legacy CRM (read-only) | [`lib/crm-integration.ts`](../src/app/lib/crm-integration.ts) — the one sanctioned second Supabase client |
| Env / runtime config | [`lib/env.ts`](../src/app/lib/env.ts) — `runtimeConfig` |
| Perf instrumentation | [`lib/perf-mark.ts`](../src/app/lib/perf-mark.ts), [`lib/react-profiler-dev.tsx`](../src/app/lib/react-profiler-dev.tsx) |
| Types | [`types/core.ts`](../src/app/types/core.ts) — `AppRole`, `Identity`, `LeadRecord`, all record types. **Don't redeclare.** |

---

## Automation (n8n) — [`scripts/n8n/`](../scripts/n8n/), [`automation/n8n/`](../automation/n8n/)

Search here before writing any n8n tooling, contract or process document
([ADR-0016](adr/0016-repository-as-automation-source-of-truth.md)).

| Thing | Where |
|---|---|
| n8n MCP client (read-only by default) | [`scripts/n8n/lib/mcp.mjs`](../scripts/n8n/lib/mcp.mjs) — `callTool`, `callWriteTool` (dev-only guard), `listWorkflows`, `getWorkflow`, `currentEnvironment`. **Don't hand-roll `fetch` against the MCP**: it replies over SSE and reports tool failures as `isError` results, not JSON-RPC errors. |
| Sanitize / normalize a workflow | [`scripts/n8n/lib/sanitize.mjs`](../scripts/n8n/lib/sanitize.mjs) — `sanitize`, `normalize`, `toCanonicalJson` |
| Secret + leakage scanning | [`scripts/n8n/lib/scan.mjs`](../scripts/n8n/lib/scan.mjs) — `scanWorkflow` (also used on fixtures) |
| Business-rule enforcement | [`scripts/n8n/lib/business-rules.mjs`](../scripts/n8n/lib/business-rules.mjs) — `validateBusinessRules`, `RPC_OWNED_TABLES` |
| Registry / manifest loading | [`scripts/n8n/lib/registry.mjs`](../scripts/n8n/lib/registry.mjs) — `loadRegistry`, `loadManifest`, `discoverWorkflowDirs`, `validateManifest` |
| Minimal JSON-Schema check | [`scripts/n8n/lib/json-schema.mjs`](../scripts/n8n/lib/json-schema.mjs) — `validateAgainstSchema` (subset; reports unsupported keywords rather than ignoring them) |
| `.env.local` loading in scripts | [`scripts/n8n/lib/env.mjs`](../scripts/n8n/lib/env.mjs) — `loadEnv`, `requireEnv`, `REPO_ROOT` |
| Workflow index | [`automation/n8n/registry.yaml`](../automation/n8n/registry.yaml) — logical ID is the primary key |
| Artifact layout rules | [`automation/n8n/conventions.md`](../automation/n8n/conventions.md) |
| Business processes | [`docs/reference/processes/`](reference/processes/README.md) |
| Rule → table → RPC → portal → metric → workflow → test | [`docs/reference/traceability.md`](reference/traceability.md) |

---

## Forbidden duplications

- A second HTTP layer, a second auth context, a second global data store, a second metric
  calculator.
- Importing `@supabase/supabase-js` outside `data/`, `lib/supabase.ts`, `lib/avatar-storage.ts`,
  `providers/auth.tsx` — and the one documented exception, `lib/crm-integration.ts`
  ([ADR-0010](adr/0010-legacy-crm-integration.md)).
- Re-declaring date helpers, percentage helpers, or chart tooltip styles. They exist.
- A second answer to "is this OOO routing rule working". Use [`lib/ooo-health.ts`](../src/app/lib/ooo-health.ts);
  the grid and the drawer already drifted apart once when each computed it inline.
- A second lead drawer. Compose `LeadConversation` / `LeadMetaSection` / `LeadEditForm`.
- A hard `DELETE` (or a second delete control) for clients, campaigns, leads, domains, invoices or
  mailboxes. The portal's delete is `setEntityArchived` + `archive-controls.tsx`
  ([09 §2.19](reference/functional/09-mutations-rls.md#219-setentityarchivedentity-id-archived--the-portals-delete-migration-20260813_entity_archival)).
- Service-role keys or `DATABASE_URL` anywhere the browser can reach them.
- A SELECT policy on `client_crm_connections`, or any gateway action that returns its `credentials`.
  The table is deliberately unreadable by `authenticated` ([ADR-0019](adr/0019-crm-connections-in-postgres.md)).
- A second store for a client's CRM configuration. The Google Sheet tab `Client CRM Details` and the
  n8n Data Table `OAuth2 Tokens` are being retired, not joined by a third.
- A second n8n client, sanitizer or secret scanner — extend `scripts/n8n/lib/`.
- Credentials, `pinData` or real personal data in a committed workflow artifact or fixture.
- A database invariant reimplemented inside an n8n workflow. Where an ingestion RPC exists
  (`leads`, `replies`, `ooo_followups`, `sequencer_contacts`), call it
  ([ADR-0015](adr/0015-sequencer-contacts-and-ooo-followups.md) §5).
