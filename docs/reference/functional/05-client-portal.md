# 05 · Client Portal

Documents everything a user with `identity.role === "client"` sees. All four data-bearing pages additionally require `identity.clientId`; otherwise `ClientAccessBlocker` shows ([see 02-roles-routes §6](./02-roles-routes.md#6-blockers--error-screens)).

All client pages use the `PortalSurface`, `PortalPageHeader`, `PortalSurface`, `KpiTile`, `ChartPanel`, `DateRangeButton`, `FilterChip`, `LeadDrawer`, `PipelineBadge`, `EmptyPortalState`, `PortalLoadingState`, `PortalErrorState` helpers from [`portal-ui.tsx`](../../../src/app/components/portal-ui.tsx). The chart tooltip config is `PORTAL_CHART_TOOLTIP` (dark panel, lighter text).

## Contents

1. [Dashboard](#1-dashboard--clientdashboardpage)
2. [My Pipeline (Leads)](#2-my-pipeline--clientleadspage)
3. [Campaigns](#3-campaigns--clientcampaignspage)
4. [Analytics (Statistics)](#4-analytics--clientstatisticspage)
5. [Settings](#5-settings)

---

## 1. Dashboard — `ClientDashboardPage`

File: [`src/app/pages/client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx). Route: `/client/dashboard`.

### 1.1 Purpose

High-density single-surface dashboard for the client, showing contract-relevant KPIs (MQLs, Meetings, Won), send volume over multiple windows, and the conversion funnel. No tabs.

### 1.2 Header controls

- Page title (client's workspace name) via `PortalPageHeader`.
- `DateRangeButton` — controls the `timeframe` state. Presets: Last 7 / 14 / 30 / 90 days, Year-to-date, All time, plus Custom range. Default = 30 days ([`timeframe.ts`](../../../src/app/lib/timeframe.ts)).

### 1.3 Data inputs

From `useCoreData()` → `scopeClients`, `scopeCampaigns`, `scopeLeads`, `scopeCampaignStats`, `scopeDailyStats` (as `selectors.ts`). Then timeframe-filtered with `filterByTimeframe` from `timeframe.ts`.

### 1.4 KPI cards (5 tiles) — [see 04-metrics §2 & §7](./04-metrics-catalog.md#2-client-kpis)

Rendered via `DashboardKpiCard` (defined inline, lines ~131-171 in the page). Each tile:

- Icon + label + big number + trend arrow + sparkline.
- `toPercentChange(current, previous)` computes the arrow. Previous period via `makePreviousRange(timeframe)`.

| # | Label | Value | Trend basis | Sparkline | Color |
|---|-------|-------|-------------|-----------|-------|
| 1 | MQLs Delivered | `kpis.mqls` | MQLs previous timeframe | last 6 ISO weeks of MQL count | green |
| 2 | Meetings Booked | `kpis.meetings` | meetings previous timeframe | last 6 weeks of meeting count | violet |
| 3 | Deals Won | `kpis.won` | won previous timeframe | last 6 weeks of won count | amber |
| 4 | Emails Sent | `formatCompact(kpis.emailsSent)` | sent previous timeframe | last 7 days of sent | blue |
| 5 | Prospects | `formatCompact(latestProspects)` | latest vs previous | last 7 months of prospects | indigo |

### 1.5 Charts

All use `recharts`; see [08-charts-catalog](./08-charts-catalog.md) for per-chart config (series, axes, tooltips).

| # | Title | Type | Data source | Metric ref |
|---|-------|------|------------|------------|
| 1 | Daily sent (last 30 days) | BarChart | `getDailySentSeries(timeframeStats)` | [§6.1](./04-metrics-catalog.md#61-daily-sent-series) |
| 2 | Leads Count per week | BarChart | inline: group timeframe leads by ISO week, count `qualification='MQL'` | [§6.3](./04-metrics-catalog.md#63-weekly-leads-count-mql--client-dashboard) |
| 3 | Leads Count per month | BarChart | inline: group `daily_stats.mql_count` by month | [§6.4](./04-metrics-catalog.md#64-monthly-leads-count--client-dashboard) |
| 4 | Prospects added (10 days) | BarChart | inline: consecutive-day delta of `daily_stats.prospects_count` | [§6.5](./04-metrics-catalog.md#65-prospects-added-daily--client-dashboard) |
| 5 | Sent count for last three months | BarChart | inline: monthly sum of `campaign_daily_stats.sent_count` | [§6.6](./04-metrics-catalog.md#66-sent-last-3-months--client-dashboard) |
| 6 | Prospects added by Month | BarChart | inline: monthly sum of `daily_stats.prospects_count`, delta | [§6.7](./04-metrics-catalog.md#67-prospects-added-by-month--client-dashboard) |
| 7 | Velocity | ComposedChart (Bar + Line, dual-axis) | inline: per-week `emailsDelta` + weekly MQL count | [§6.8](./04-metrics-catalog.md#68-velocity--client-dashboard) |
| 8 | Conversion Funnel + Campaign reply rates | Custom HTML bars | `getConversionRates(timeframeLeads, latestProspects)`, `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0,6)` | [§3](./04-metrics-catalog.md#3-conversion-funnel), [§5.1](./04-metrics-catalog.md#51-campaign-reply-rate) |

Empty states: each chart renders `<EmptyPortalState title="…" description="…">` when its series is empty; titles are "No sent data", "No weekly lead data", etc.

### 1.6 Interactions

- Date-range picker at the top re-filters all charts and KPI tiles.
- KPI cards are non-interactive (no drill-down).
- Campaign reply list (bottom) is read-only; no row click handlers.

### 1.7 Error / loading

- `PortalLoadingState` while `useCoreData().loading`.
- `PortalErrorState` with a retry button when `useCoreData().error` is set.

---

## 2. My Pipeline — `ClientLeadsPage`

File: [`src/app/pages/client-leads-page.tsx`](../../../src/app/pages/client-leads-page.tsx). Route: `/client/leads`. Sidebar label: **My Pipeline**.

### 2.1 Purpose

Client's lead workspace. Read-only (ADR-0004 + UI also disables edits). Full reply history per lead. CSV export.

### 2.2 Header controls

- `PortalPageHeader` with title and subtitle.
- `PortalSearch` — full-text search across `first_name + last_name`, `email`, `company_name`, `job_title`.
- Campaign filter: `Select` listing scoped campaigns.
- Reply scope filter: `Select` with options "All (OOO + Active)" | "Active only" | "OOO only". Filters leads by `lead.qualification === 'OOO'` (not by reply classification — the label is misleading; rename to "Lead OOO scope" tracked as **BL-7**).
- Pipeline stage chips (`FilterChip`): "All" + one chip per `PIPELINE_STAGES` entry (see [04-metrics §4](./04-metrics-catalog.md#4-lead-stage-lifecycle)) with counts.
- CSV export button (top-right): serialises current filtered rows via `toCsvCell()` inline helper.

### 2.3 Lead table

Custom CSS-grid table (not `<table>`). Resizable columns via `useResizableColumns()` with localStorage key `table:client-leads:columns`.

| Column | Key | Sort |
|--------|-----|------|
| Lead (name + initials avatar) | `lead` | by `fullName` |
| Email | `email` | — (display) |
| Company | `company` | by `company_name` |
| Job title | `title` | — |
| Campaign | `campaign` | by `campaign.name` |
| Step | `step` | by `message_number` / latest reply's `sequence_step` |
| Replies | `replies` | by reply count |
| Last reply | `lastReply` | by `received_at` |
| Added | `added` | by `created_at` |

Row data from `getClientLeadRows(leads, campaigns, replies)` at [client-view-models.ts:145-181](../../../src/app/lib/client-view-models.ts#L145-L181). Each row attaches its `replies` array sorted by received date descending.

Pagination: lazy "Load more" button; `visibleRowsCount` increments by `PAGE_SIZE` (50) on click. Resets when filters/search change.

### 2.4 Lead drawer

Opened by clicking a row. Component: `LeadDrawer` (portal-ui.tsx).

- **Read-only** for client role — no qualification select, no checkboxes.
- Shows metadata: name, job title, company, email, LinkedIn, country, industry, headcount range, website.
- Response metadata: `response_time_label`, `message_number`, `message_title`.
- `PipelineBadge` with colored dot + label = stage from `getLeadStage`.
- Replies history: list grouped visually by date, each item shows `message_subject`, `classification` badge, `language_detected`, `received_at`, and the full `message_text`. Order is newest first.
- Inline `reply_text` field (denormalised on the lead) shown when present.

### 2.5 Empty / loading / error

- Empty list of leads in scope: `<EmptyPortalState title="No leads yet" …>`.
- Empty filtered result: `<EmptyPortalState title="No leads match your filters" …>`.
- Loading and error as above.

### 2.6 Role scoping

- `scopeLeads` filters to the client's own `client_id`.
- `scopeCampaigns` further reduces to `type='outreach'` for filter dropdown options (ADR-0003).
- Backed by `leads_select_scoped` RLS.

---

## 3. Campaigns — `ClientCampaignsPage`

File: [`src/app/pages/client-campaigns-page.tsx`](../../../src/app/pages/client-campaigns-page.tsx). Route: `/client/campaigns`.

### 3.1 Purpose

Read-only overview of outreach campaigns: portfolio cards + per-campaign performance when a card is selected.

### 3.2 Header controls

- `PortalPageHeader`.
- `DateRangeButton` — filters `timeframeStats`.

### 3.3 Portfolio grid

Each campaign rendered as a clickable card (interactive list, not a table). Card body:

- Campaign name (truncated).
- Status + `start_date`.
- Reply rate % (right-aligned, green).
- Metrics grid: `database_size`, `sent`, `positive_responses`.

Selection updates `selectedCampaignId` state. Active card gets `border-emerald-500/30 bg-emerald-500/10`.

### 3.4 Detail view (when a card is selected)

- Metadata: `name`, `type`, `status`, `start_date`, `database_size`, `positive_responses`, `external_id`, `gender_target`, count of `campaign_daily_stats` rows in the window.
- Chart 1: **Daily campaign volume** LineChart with 4 series — `sent` (green), `replies` (blue), `opens` (violet), `bounces` (orange). Data: filter `timeframeStats` to `campaign_id == selectedCampaign.id`. See [08 #cc-daily-volume](./08-charts-catalog.md).
- Chart 2: **Campaign sent count** BarChart for top-10 sorted by `sent`. Data: `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 10)`.

### 3.5 Interactions

- Click card to select. Click again (or another card) to switch.
- No form/edit inputs for client role (Campaign mutation is RLS-blocked for clients anyway; see [09-mutations](./09-mutations-rls.md)).

### 3.6 Scoping

`scopeCampaigns` with ADR-0003 filter: clients only see `type='outreach'`. OOO / nurture / ooo_followup campaigns are invisible to the client portal both at the RLS and UI layers.

---

## 4. Analytics — `ClientStatisticsPage`

File: [`src/app/pages/client-statistics-page.tsx`](../../../src/app/pages/client-statistics-page.tsx). Route: `/client/statistics`. Sidebar label: **Analytics**.

### 4.1 Purpose

Focused analytics view complementing the dashboard: 4 KPI tiles + four charts.

### 4.2 Header controls

- `PortalPageHeader`.
- `DateRangeButton` (default = 30 days).

### 4.3 KPI tiles (4) — via `KpiTile`

| # | Label | Value | Hint | Tone |
|---|-------|-------|------|------|
| 1 | MQLs Delivered | `formatNumber(kpis.mqls)` | `${((mqls/prospects)*100).toFixed(1)}% prospect→MQL` | blue |
| 2 | Meetings Booked | `formatNumber(kpis.meetings)` | `${((meetings/mqls)*100).toFixed(1)}% MQL→meeting` | purple |
| 3 | Deals Won | `formatNumber(kpis.won)` | `${((won/meetings)*100).toFixed(1)}% meeting→won` | green |
| 4 | Prospects Base | `formatCompact(kpis.prospects)` | "current visible outreach base" | indigo |

Data: `getClientKpis(scopedClients, scopedCampaigns, timeframeLeads, timeframeStats)`. Zero-denominator hints fall back to "0%".

### 4.4 Charts

| # | Title | Type | Data | Metric ref |
|---|-------|------|------|------------|
| 1 | Pipeline Activity | LineChart (3 series: `mqls`, `meetings`, `won`) | `getPipelineActivitySeries(timeframeLeads)` | [§6.2](./04-metrics-catalog.md#62-pipeline-activity-series) |
| 2 | Daily sent | AreaChart (single series) | `getDailySentSeries(timeframeStats)` | [§6.1](./04-metrics-catalog.md#61-daily-sent-series) |
| 3 | Campaign reply rates | BarChart (top 8) | `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 8)` | [§5.1](./04-metrics-catalog.md#51-campaign-reply-rate) |
| 4 | Conversion Funnel | Custom HTML bar | `getConversionRates(timeframeLeads, kpis.prospects)` | [§3](./04-metrics-catalog.md#3-conversion-funnel) |

### 4.5 Empty / loading / error

Same portal patterns as above.

---

## 5. Settings

File: [`src/app/pages/settings-page.tsx`](../../../src/app/pages/settings-page.tsx). Route: `/client/settings`. Accessible without `clientId`.

### 5.1 Sections shown to client

| Section | Fields | Action | Handler (AuthProvider) |
|---------|--------|--------|------------------------|
| Profile name | `displayName` text input | "Update name" | `updateProfileName(normalizedName)` |
| Change password | `password`, `confirmPassword` | "Update password" | `updatePassword(password)` |
| Sign out | _(button)_ | "Sign out" | `signOut()` |
| **CRM integration** | provider select + dynamic credentials form | "Connect with OAuth" / "Submit credentials" / "Disconnect" | `useCoreData().updateClient(clientId, { crm_config })` (status only) — credentials forwarded to legacy CRM Supabase project edge functions ([see 11 · Integrations §CRM Integration](./11-integrations.md#crm-integration)) |

### 5.2 Sections hidden from client

- **Current Identity card** (shows `actorIdentity` vs `identity`, impersonation flag) — hidden.
- **Request reset link** form — hidden (clients trigger resets from the login page instead).

### 5.3 Validation

- **displayName:** trimmed; collapses runs of whitespace; minimum 2 characters. The "Update name" button is disabled if the name is blank or identical to the current value (`isNameDirty` check).
- **Password:** at least 8 characters; `password === confirmPassword`. Error shown in a `Banner` (warning tone) when the validation fails.

### 5.4 Feedback

All three actions set a local `message: { tone: "info"|"warning"|"danger"; text: string }` which renders as a `Banner` above the form. On success the relevant input is cleared (passwords) or left as-is (name).

### 5.5 CRM integration card

Component: [`CrmIntegrationCard`](../../../src/app/components/crm-integration-card.tsx). Visible only when `identity.role === "client"`. Hidden completely when `VITE_LEGACY_CRM_SUPABASE_URL` / `VITE_LEGACY_CRM_PUBLISHABLE_KEY` are blank (shows an inline notice instead).

**Architecture.** The CRM provider catalog and OAuth/credential exchange edge functions live on a **separate Supabase project** (legacy CRM project, env vars `VITE_LEGACY_CRM_SUPABASE_URL` / `VITE_LEGACY_CRM_PUBLISHABLE_KEY`). The portal:

1. Fetches `crm_providers` + `crm_provider_fields` from the legacy project (read-only).
2. Forwards user-entered credentials / triggers OAuth via the legacy edge functions:
   - `submit-crm-credentials` (API-key providers)
   - `salesforce-oauth/init` + `/callback` (Salesforce server-side PKCE flow)
   - `zoho-token-exchange` (Zoho user-redirect flow)
3. Mirrors connection status into our project's `clients.crm_config` (JSON) via `updateClient` so the portal can render badge + last-connected timestamp without re-querying the legacy project.

**`clients.crm_config` shape** (mirrors `CrmIntegrationConfig` from [`types/core.ts`](../../../src/app/types/core.ts)):

```jsonc
{
  "provider": "salesforce",
  "display_name": "Salesforce",
  "auth_type": "oauth2",
  "status": "connected",        // pending | connected | failed | disconnected
  "connected_at": "2026-05-03T18:22:04Z",
  "updated_at": "2026-05-03T18:22:04Z",
  "last_error": null,
  "metadata": { "env": "production" }
}
```

**Disconnect** clears `crm_config` to `null`. Secrets/tokens never reach our project — they live only in the legacy `client_crm_credentials` / `salesforce_integrations` tables and the n8n/Make webhook downstream.

### 5.6 Planned: client self-service notification preferences

Backlog item **BL-1** ([decision](../../BUSINESS_LOGIC.md#decision-2026-04-25-notifications-and-ooo-routing-are-split-between-portal-and-n8n) and [BUSINESS_LOGIC §8](../../BUSINESS_LOGIC.md#8-settings--ecosystem-configuration)): expose `clients.notification_emails` and `clients.sms_phone_numbers` (the destinations n8n uses for alert dispatch) on `/client/settings` so the client can edit them without going through the manager. Schema is unchanged; only UI work. Manager retains override on `/manager/clients`.

Next: [06 · Manager portal](./06-manager-portal.md).
