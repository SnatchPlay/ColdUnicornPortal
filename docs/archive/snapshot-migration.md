# Snapshot → per-page data contracts: migration tracker

Working artifact for retiring the universal `CoreSnapshot` / `loadSnapshot` in favour of a tiny
shell payload plus per-page loaders. Plan: `~/.claude/plans/goofy-riding-rabbit.md`. Hard rule:
**no `useLegacySnapshot()` fallback** — controlled hard cut. Server computes facts (aggregates +
projections); frontend keeps all KPI formulas.

Cutover ratchet test: [src/app/data/__tests__/snapshot-cutover-guard.test.ts](../../src/app/data/__tests__/snapshot-cutover-guard.test.ts)
(allowlist must be empty at Phase 8).

## Deployment isolation (don't break prod while migrating)

Each phase adds a gateway action to `supabase/functions/orm-gateway`. To keep work-in-progress off
the production function until reviewed:

- The frontend targets a configurable function name via `VITE_ORM_GATEWAY_FUNCTION`
  ([env.ts](../../src/app/lib/env.ts) → `runtimeConfig.ormGatewayFunction`,
  used in [repository.ts](../../src/app/data/repository.ts)). **Default is the prod `orm-gateway`.**
- [`supabase/functions/orm-gateway-next/`](../../supabase/functions/orm-gateway-next/index.ts) is a
  thin shim that `import "../orm-gateway/index.ts"` — identical code, no duplication. It exists only
  so WIP can be deployed under a separate name.

**Dev/test flow:** `supabase functions deploy orm-gateway-next` → set
`VITE_ORM_GATEWAY_FUNCTION=orm-gateway-next` in dev `.env`. Production keeps using the already-deployed
`orm-gateway` (do **not** redeploy it) until the migration is validated.

**Cutover (Phase 8):** deploy the reviewed code to `orm-gateway`, remove the env override, delete the
`orm-gateway-next` directory.

> Note: the Phase-1 `loadShellData` change is purely additive (new action branch only; no existing
> handler/dispatch/`loadSnapshot` path touched), so deploying it to prod is backward-compatible. The
> isolation matters most for Phases 4–8, which touch shared code and eventually remove `loadSnapshot`.

## Route → data map

`useCoreData()` consumers and their replacement loader. ✅ = migrated off the snapshot.

| Component / route | Snapshot fields read | Mutations used | Replacement loader / hook | Phase | Done |
|---|---|---|---|---|---|
| `AppShell` (components/app-shell.tsx) | `users`, `clients` | — (impersonation only) | `loadShellData` / `useShellData` | 1 | ✅ |
| `AdminDashboardPage` | `users`, `clients`, `campaigns`, `leads`, `campaignDailyStats`, `dailyStats` | — | `loadAdminDashboardOverview` / co-located `useAdminDashboard` | 2 | ✅ |
| `ManagerDashboardPage` | `clients`, `campaigns`, `leads`, `replies`, `campaignDailyStats` | — | `loadManagerDashboardOverview` / co-located `useManagerDashboard` | 2 | ✅ |
| `ClientDashboardPage` | `clients`, `campaigns`, `leads`, `campaignDailyStats`, `dailyStats` | — | `loadClientDashboard` / co-located `useClientDashboard` | 2 | ✅ |
| `ClientsPage` | `clients`, `users`, `clientUsers`, `metricsByClientId`, `conditionRules`, `columnOverrides`, `clientCustomFields`, `clientCustomFieldValues` | `upsertClientCustomFieldValue`, `createClient`, `updateClient`, `sendInvite`, `upsertClientUserMapping`, `deleteClientUserMapping` | `loadClientsOverview` / `useClientsOverview` | 3 | ✅ |
| `InternalLeadsPage` (leads-page.tsx) | `clients`, `leads`, `replies`, `campaigns` | `createLead`, `updateLead` | `loadLeadsList` + `loadLeadDetail` / `useLeadsList` | 4 | ✅ |
| `ClientLeadsPage` | `clients`, `leads`, `replies`, `campaigns` | — | `loadLeadsList` + `loadLeadDetail` | 4 | ✅ |
| `InternalCampaignsPage` (campaigns-page.tsx) | `clients`, `campaigns`, `campaignDailyStats` | `createCampaign`, `updateCampaign` | `loadCampaignsList` + `loadCampaignStats` | 5 | ✅ |
| `ClientCampaignsPage` | `clients`, `campaigns`, `campaignDailyStats` | — | `loadCampaignsList` + `useAllCampaignStats` | 5 | ✅ |
| `InternalStatisticsPage` (statistics-page.tsx) | `users`, `clients`, `campaigns`, `leads`, `campaignDailyStats`, `dailyStats` | — | `loadAnalyticsOverview` / `useAnalyticsOverview` | 6 | ✅ |
| `ClientStatisticsPage` | `clients`, `campaigns`, `leads`, `campaignDailyStats` | — | `loadClientDashboard` / `useClientAnalytics` | 6 | ✅ |
| `DomainsPage` | `clients`, `domains` | `createDomain`, `updateDomain` | `loadDomains` / `useDomainsPage` | 7 | ☐ |
| `InvoicesPage` | `clients`, `invoices` | `updateInvoice` | `loadInvoices` / `useInvoicesPage` | 7 | ☐ |
| `BlacklistPage` | `emailExcludeList` | `upsertEmailExcludeDomain`, `deleteEmailExcludeDomain` | `loadEmailBlacklist` / `useBlacklistPage` | 7 | ☐ |
| `SettingsPage` | `clients`, `users`, `conditionRules`, `columnOverrides`, `clientCustomFields` | `createConditionRule`, `updateConditionRule`, `deleteConditionRule`, `upsertColumnOverride`, `setColumnOrder`, `createClientCustomField`, `updateClientCustomField`, `deleteClientCustomField` | `loadAdminSettings` / `loadClientSettings` | 7 | ☐ |
| `AdminUserManagementPage` | `clients` | `sendInvite`, `listInvites`, `resendInvite`, `revokeInvite` | `loadUserManagementData` (clientsLite + lazy invites) | 7 | ☐ |
| `crm-integration-card.tsx` | — | `updateClient` (shell-level; stays) | shell provider mutation | n/a | n/a |

## Provider topology (Phase 2A)

`CoreDataProvider` is no longer mounted globally. It is injected per-route via `LegacySnapshotOutlet`
in `App.tsx` — only non-dashboard routes receive it. Dashboard routes (`/*/dashboard`) have no
`CoreDataProvider` ancestor and cannot call `useCoreData()`. This is the primary boot-payload win:
visiting `/dashboard` fires `loadShellData` + one of the three dashboard-specific actions only.

`getLeadStage` widened to accept `LeadStageFields` (view-contracts.ts-compatible minimal type) so
`pipelineGroups` items from the admin dashboard response can be passed directly.

`getClientKpis`, `getConversionRates`, `getCampaignPerformance` widened to accept projection arrays
so `ClientDashboardPayload` data passes without casting.

## Provider topology (Phase 3)

`ClientsPage` (`/*/clients`) is now outside `LegacySnapshotOutlet` for both admin and manager roles.
It calls `repository.loadClientsOverview()` which returns full `ClientRecord[]` + `LeadMetricProjection[]`
(not full lead rows) + scoped 180-day `dailyStats`. The `useClientsOverview` hook computes
`metricsByClientId` locally from the projection data — no longer from the global snapshot.

Key changes in Phase 3:
- `createClientMetrics` widened: accepts `LeadMetricInput` (structural subset) instead of `LeadRecord`.
  All existing callers (`LeadRecord[]`) satisfy the interface structurally.
- `CreateClientSheet` extracted as a memoized component: its draft state lives inside the sheet,
  so typing in the form does NOT re-render `ClientsMegaTable`.
- `LegacySnapshotOutlet` now logs `[LEGACY_SNAPSHOT_OUTLET] mounted pathname=<path>` on mount
  and has a dev assertion that fires if it ever mounts on a `/dashboard` route.
- `[PERF][dashboard]` frontend logs now cover all per-page loaders: `loadShellData`,
  `loadAdminDashboardOverview`, `loadManagerDashboardOverview`, `loadClientDashboard`,
  `loadClientsOverview`.

## Provider topology (Phase 4 + 4B)

`InternalLeadsPage` and `ClientLeadsPage` are outside `LegacySnapshotOutlet` for all three internal roles (admin, manager) and the client role. Each page uses `useLeadsList(params)` (server-side filtered/sorted/paginated) and `useLeadsFilterOptions()` (loaded once on mount, cached for session).

Phase 4B performance investigation identified that RLS SELECT policies on `leads`, `campaigns`, and `replies` were using per-row helper calls (`private.can_access_client(client_id)`), costing ~400ms per query. A set-based rewrite via migration `20260601b` reduced handler time from 1340ms to 200ms (6.7×). The pattern is now documented in ADR-0006 and CLAUDE.md §5.5 and is mandatory for all future gateway actions on tables >1k rows.

Key changes in Phase 4 + 4B:
- `loadLeadsList(params)` + `loadLeadDetail(leadId)` replace global leads list.
- `loadLeadsFilterOptions()` is a separate cached action (not re-fetched on paginate/filter).
- `executeAsCaller` combines set_config + SET LOCAL ROLE into a single round-trip.
- `_serverMs: { total, setup, handler }` is included in every gateway response for latency diagnosis.
- `idle_timeout` on the postgres.js pool raised from 20s to 60s.
- Search debounced 400ms in both leads pages (LIKE scan has no pg_trgm index).
- RLS migration: `leads`, `campaigns`, `replies` SELECT policies rewritten to set-based form.

## Notes

- `crm-integration-card` only consumes the `updateClient` mutation — a shell/client-level write — so
  it stays on the shell provider; no list data is read.
- Tests under `src/app/pages/__tests__/*` mock `useCoreData`; each is updated alongside its page's phase.
- `metricsByClientId` (currently a memo in `core-data.tsx`) moves into `useClientsOverview` and runs
  over `LeadMetricProjection[]` (see [view-contracts.ts](../../src/app/types/view-contracts.ts)).
- Guard log `[SNAPSHOT_FORBIDDEN_AFTER_CUTOVER]` fires from `repository.loadSnapshot` to surface any
  lingering caller during migration.
