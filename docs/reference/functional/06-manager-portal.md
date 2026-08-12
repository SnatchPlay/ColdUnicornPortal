# 06 В· Manager Portal

Pages served under `/manager/*` for users with `identity.role === "manager"`. Data is scoped by `clients.manager_id = identity.id` (see `scopeClients` in [`selectors.ts`](../../../src/app/lib/selectors.ts)). RLS enforces the same boundary on the server via `private.can_access_client`.

All internal pages (manager + admin) use `Surface`, `PageHeader`, `MetricCard`, `Banner`, `LoadingState`, `EmptyState` from [`app-ui.tsx`](../../../src/app/components/app-ui.tsx) and the `TOOLTIP` chart style (darker, slate-tinted) rather than the portal-ui variants.

## Contents

1. [Dashboard](#1-dashboard--managerdashboardpage)
2. [Clients](#2-clients--clientspage)
3. [Leads](#3-leads--internalleadspage)
4. [Campaigns](#4-campaigns--internalcampaignspage)
5. [Analytics](#5-analytics--internalstatisticspage)
6. [Domains](#6-domains--domainspage)
7. [Invoices](#7-invoices--invoicespage)
8. [Blacklist](#8-blacklist--blacklistpage)
9. [Settings](#9-settings)

---

## 1. Dashboard вЂ” `ManagerDashboardPage`

File: [`src/app/pages/manager-dashboard-page.tsx`](../../../src/app/pages/manager-dashboard-page.tsx). Route: `/manager/dashboard`.

### 1.1 Purpose

Day-one view for the Customer Success manager. Surfaces the working lead queue first, campaign momentum trends, clients behind KPI, and stopped/low-reply campaigns. The whole payload is computed server-side in `loadManagerDashboardOverview` ([orm-gateway](../../../supabase/functions/orm-gateway/index.ts)); see [04-metrics §12](./04-metrics-catalog.md#12-manager-dashboard-aggregates).

### 1.1a Filters

A `Surface title="Filters"` at the top, above the metric cards (3 controls):

- **Client** Select — `All clients` (default) or one of the manager's clients (`filterClients` from the payload). Scopes the entire dashboard to that client.
- **Campaign status** Select — `Active` (default), `Launching`, `Stopped`, `Completed`, `Draft`, or `All statuses`. Restricts the campaign-based surfaces (campaigns metric, watchlist, momentum charts).
- **Date range** — `DateRangeButton` (same presets as Analytics: 7d/30d/90d/MTD/QTD/YTD/All + custom). Default `Last 30 Days`. Drives **all period-sensitive metrics**: MQL/preMQL counts (`leads.created_at` in range), momentum series and watchlist totals (`campaign_daily_stats.report_date` in range), and portfolio MQL/won counts. `Assigned clients` and the campaign count are structural (not date-scoped). The lead queue is limited to leads created in the range.

Changing any filter re-fetches the dashboard (`repository.loadManagerDashboardOverview(managerId, { clientId, campaignStatus, dateFrom, dateTo })`) with a `loadIdRef` stale guard ([CLAUDE.md §2.3](../../../CLAUDE.md)). The Filters subtitle shows the active period and a "Refreshing…" hint during in-flight reloads.

### 1.2 Metric cards (4)

`MetricCard` row. See [04-metrics §12](./04-metrics-catalog.md#12-manager-dashboard-aggregates).

| # | Label | Value | Data |
|---|-------|-------|------|
| 1 | Assigned clients | scoped client count | scoped `clients` |
| 2 | `<status>` campaigns | `count(scoped campaigns WHERE status = campaignStatus)` | `campaigns.status` (label reflects the status filter) |
| 3 | MQLs | leads whose `getLeadStage` = `MQL` | `pipelineGroups` (hint: count beyond MQL) |
| 4 | preMQLs | leads whose `getLeadStage` = `preMQL` | `pipelineGroups` (hint: not-yet-qualified count) |

**Unclassified replies** was removed (cards 3+4 replaced by the MQL/preMQL split). Reply classification is owned by n8n; there is no portal triage UI.

### 1.2a Layout & campaign momentum charts

Below the metric cards, a two-column grid (`xl:grid-cols-[1.6fr_1fr]`): **left** holds the three momentum `AreaChart`s; **right** holds the Lead queue (top), Campaign watchlist, and Assigned client portfolio.

The charts (Sent / Replies / Positive) mirror the Admin dashboard, fed by `campaignMomentum21d` — for the manager this is the daily series over the **selected timeframe** (falls back to 21 days only if no range is sent), scoped + status-filtered. See [08 §4](./08-charts-catalog.md#4-manager-dashboard-surfaces).

### 1.3 Campaign watchlist surface

`Surface title="Campaign watchlist"`. Displays campaigns in `stopped` / `launching` states, or active campaigns with low reply rate from the last 14 days.

Columns:

- Campaign name
- Reply rate (colored)
- Status
- 14-day sent total
- 14-day replies total

Data: aggregate `campaign_daily_stats` within last 14 days, grouping by `campaign_id`. Coloring threshold mirrors the client dashboard (`>= 5%` green).

### 1.4 Assigned client portfolio surface

`Surface title="Client portfolio"`. One row per client in scope.

Columns:

- Client name
- Status (badge)
- Campaigns count (`scopeCampaigns` filtered to this client)
- MQLs this month (from `scopeLeads` filtered to this client, `qualification='MQL'`, created this month вЂ” aligns with [В§11.2 MoM SQL](./04-metrics-catalog.md#112-mom-sql-leads))
- Won (this month)
- KPI progress bar: `min(mqls / client.kpi_leads, 1)` rendered as a horizontal bar

Clicking a client row navigates to `/manager/clients?selected=вЂ¦` or scrolls the `ClientsPage` focus (implementation detail: via `navigate` with state; the effect is that `ClientsPage` opens with the client drawer selected).

### 1.5 Lead queue surface

`Surface title="Lead queue"`, positioned at the **top of the right column** (beside the momentum charts) so it stays visible — previously it sat at the bottom and was easy to miss. Up to 10 leads created in the selected period, rendered as clickable cards (name, client · company, updated timestamp, pipeline-stage badge).

Data: server returns `leadQueue` as **full `LeadsListRow` records** (created within the date range, sorted `updated_at DESC`, limit 10) so a card click opens the editable lead drawer with no extra request.

**Lead drawer (editable):** clicking a card opens `ManagerLeadDrawer` — a right-side drawer reusing the shared [`LeadEditForm`](../../../src/app/components/lead-edit-form.tsx) + draft helpers ([`lead-draft.ts`](../../../src/app/lib/lead-draft.ts)) and the portal [`LeadConversation`](../../../src/app/components/portal-ui.tsx) / `LeadMetaSection`. Reply history is lazy-loaded via `useLeadDetail`. Editable fields and save semantics match the Leads page drawer ([§3.4](#34-lead-drawer-editable)); `Save changes` calls `repository.updateLead` then refreshes the dashboard. An "Open in Leads" link jumps to the full workspace. `Escape` closes.

### 1.6 Empty / loading / error

- `LoadingState` while data loads.
- `<Banner tone="warning">` with retry button on `useManagerDashboard().error` ([manager-dashboard-page.tsx:39](../../../src/app/pages/manager-dashboard-page.tsx#L39)); retry calls the hook's `refresh()`.
- Each surface renders `<EmptyState>` when its own filtered array is empty.

---

## 2. Clients вЂ” `ClientsPage`

File: [`src/app/pages/clients-page.tsx`](../../../src/app/pages/clients-page.tsx). Route: `/manager/clients` (and `/admin/clients`).

### 2.1 Purpose

Single dense PDCA grid covering DoD, 3-DoD, WoW, and MoM in **one horizontally-scrolled table** modelled after the team's working Google Sheets. Row click opens an editable detail drawer holding non-statistical client configuration (credentials, contacts, setup notes, issues timeline).

### 2.2 Mega-table layout

One mega-table per page — no tabs. Defined in [`src/app/pages/clients-page/mega-table.tsx`](../../../src/app/pages/clients-page/mega-table.tsx) (`MEGA_COLUMNS` constant). Two-level header bands: top-level **group band** + sub-level **sub band** + column-name header row. First 3 columns are CSS-sticky (left edge).

Lead-count and Aimfox split: see [04-metrics §18](./04-metrics-catalog.md#18-per-channel--aimfox-split-manager-mega-table).
In the `Both` view every blended column is the **Total** series and the `· EB` / `· AF` sub-bands sit
beside it as the EmailBison-only and Aimfox-only breakdown. Aimfox volume/capacity come from
`sequencer_daily_stats`; a client with no Aimfox `client_sequencers` row shows "—" in every Aimfox
column.

**Channel view switch** — a `ToggleGroup` in the filter bar (`Both` / `EmailBison` / `Aimfox`,
persisted per-user in `user_table_preferences.channelView`). It is a **projection**, not just a
filter, and no refetch: outside `Both` the page runs each metrics pack through
`projectMetricsToChannel` ([`client-metrics.ts`](../../../src/app/lib/client-metrics.ts)) before
building rows, so the neutral bands keep their ids, widths and early positions and render the
selected sequencer's numbers. A combined number is therefore only ever visible in `Both`, and the
EmailBison and Aimfox views are structurally identical.

Two column tags drive visibility ([`mega-table.tsx`](../../../src/app/pages/clients-page/mega-table.tsx)):

- `channel: "email" | "aimfox"` — **channel-native**: the data has no counterpart in the other
  channel (Bison reply rates; Aimfox acceptance + capacity). Hidden in the other channel's view.
- `splitOnly: true` — a **Both-only comparison column**: the `· EB` / `· AF` splits and the
  `(Aimfox)` mirror bands, which would duplicate the neutral band once it is projected.
- untagged — neutral: identity, Basic, Custom and every projected metric band.

The projection is applied at page level on purpose: `compareMega` sorts through
`col.sortValue(row)` on `row.metrics`, so sorting follows the visible numbers. A sort bound to a
column the switch hides is reset to the default Client sort (`isColumnInChannelView`).
Outside `Both` each metric band's header gains a `· EB` / `· AF` suffix, and the per-bucket
condition tint is dropped — see 04-metrics §18.5 and [12-hidden-rules](./12-hidden-rules.md).

Layout in the `Both` view (a single-channel view drops the `splitOnly` rows and the other channel's
native rows, and renders the rest projected):

| Group band | Sub band | Columns |
|-----------|----------|---------|
| **Customer Success** (sticky) | Customer Success | Client (name + status pill), Health (severity badge + score + rollup cause), Manager |
| **Basic** | Basic | Inboxes, Signed, Added, Min sent, KPI L, KPI M, Auto-OOO ✓, CRM ✓, Updated |
| **DoD Schedule** | Schedule | +2, +1, 0 — `ClientMetricsPack.dodRows[bucket].schedule` |
| **DoD Schedule (Aimfox)** | Schedule (Aimfox) | +2, +1, 0 — `dodRows[bucket].aimfoxSchedule` |
| **DoD Daily sent** | Daily sent | 0, -1, -2, -3, -4 — `ClientMetricsPack.dodRows[bucket].sent` |
| **DoD Daily sent (Aimfox)** | Daily sent (Aimfox) | 0, -1, -2, -3, -4 — `dodRows[bucket].aimfoxSent` |
| **Aimfox capacity** | Aimfox capacity | Rem DB, Inv left — `overview.aimfoxRemainingDb` / `aimfoxInviteLimitRemaining` (sheet R "Remaining database" / S "Invitations limit" = remaining today) |
| **3-Day rolling** | 3-DoD TOTAL leads · (Total / EB / AF) | 0, -1, -2, -3, -4 — `threeDodRows[bucket].totalLeads{,Eb,Af}` |
|  | 3-DoD SQL leads · (Total / EB / AF) | 0, -1, -2, -3, -4 — `threeDodRows[bucket].sqlLeads{,Eb,Af}` |
| **Week over Week** | WoW Total · (Total / EB / AF) | 0/-1/-2/-3/-4 — `wowRows[bucket].totalLeads{,Eb,Af}` |
|  | WoW SQL · (Total / EB / AF) | 0/-1/-2/-3/-4 — `wowRows[bucket].sqlLeads{,Eb,Af}` |
|  | WoW Resp / Human / Bnc / OOO | 0/-1/-2/-3/-4 per metric — rates from `wowRows[bucket]` |
|  | WoW Accept | 0/-1/-2/-3/-4 — `wowRows[bucket].acceptRate` (Aimfox invites accepted/sent) |
| **Month over Month** | MoM Total · (Total / EB / AF) | 0/-1/-2/-3/-4 — `momRows[bucket].totalLeads{,Eb,Af}` |
|  | MoM SQL · (Total / EB / AF) | 0/-1/-2/-3/-4 — `momRows[bucket].sqlLeads{,Eb,Af}` |
|  | MoM Mtg / Won | 0/-1/-2/-3/-4 per metric — `momRows[bucket]`; split per channel in the payload (`meetingsEb/Af`, `wonEb/Af`) but with no side-by-side columns |

156 built-in columns in `Both` (was 61 before the per-channel/Aimfox split); 81 in `EmailBison` and
68 in `Aimfox` — the 13-column difference is exactly the reply-rate bands (20) against `WoW Accept`
plus `Aimfox capacity` (7), i.e. the irreducible gap of 04-metrics §18.5. Column widths resizable per-cell via `useResizableColumns` (storage key `table:clients:mega-columns`). Sorting via column-header buttons (`Sort by <sub> <label>` aria-label). Default sort: `name asc`. (It was `health asc`, but no column ever had that id — `compareMega` returned 0, so the sort was a silent no-op; the health column is gone now anyway. Row triage lives in the satisfaction filter, §2.5.)

Cell highlighting is driven by the existing `condition_rules` engine: `getCellCondition(allResults, conditionKey)` for static columns, `dodCellKey(bucket, kind)` for DoD per-bucket. Each tinted cell is wrapped in a `Tooltip` exposing rule, value, threshold, message.

**Notes (Basic band)** is inline-editable directly in the grid: a plain text input, blur-to-save via the page's `updateClient(client.id, { notes })` callback ([clients-page.tsx:259](../../../src/app/pages/clients-page.tsx#L259)), which calls `repository.updateClient` directly (same optimistic-update/rollback path as the drawer, §2.3). Mirrors the existing inline-edit pattern already used for custom columns (`customFieldColumn` in `mega-table.tsx`). Editing the drawer's "Internal notes" field updates the same `clients.notes` column and vice versa.

### 2.3 Detail drawer (editable)

Opens on row click. Draft pattern: local `draft` state deviates from `selectedClient`; "Save" and "Cancel" buttons appear when `isDraftDirty`. `Escape` key closes the drawer discarding the draft. Defined in [`src/app/pages/clients-page/client-drawer.tsx`](../../../src/app/pages/clients-page/client-drawer.tsx).

Sections (top → bottom):

1. **Header** — name, status pill, manager, contract amount + due.
2. **Credentials & IDs** — per-sequencer connection settings from `client_sequencers` (ADR-0012): EmailBison workspace ID + API key, Aimfox API key; CRM status from `crm_config` (read-only badge).
3. **Client configuration** — editable form (includes the **Customer satisfaction** hearts, §2.7).
4. **Contacts** — `notification_emails` + `sms_phone_numbers` via `StringListEditor`.
5. **User access management** — invite + map client portal users.

> The former **Operational issues** and **Setup gaps** sections were removed when the automatic
> health rollup was replaced by the manual satisfaction rating (§2.7). The `condition_rules` engine
> still runs — it tints individual mega-table cells (each with a tooltip carrying the rule, value,
> threshold and message) — it just no longer summarises the row.

Editable fields — **Credentials & IDs** section:

| Field | Control | Source column | Who |
|-------|---------|---------------|-----|
| EmailBison workspace ID | text input | `client_sequencers.external_workspace_id` (emailbison row) | manager + admin |
| EmailBison API key | `SecretInput` (show/hide) | `client_sequencers.api_key` (emailbison row) | manager + admin |
| Aimfox API key | `SecretInput` (show/hide) | `client_sequencers.api_key` (aimfox row) | manager + admin |
| CRM status | read-only badge | `clients.crm_config` | — |

Editable fields — **Contract & KPIs** section (admin only, hidden for manager):

| Field | Control | Source column |
|-------|---------|---------------|
| KPI leads / month | number input | `clients.kpi_leads` |
| KPI meetings / month | number input | `clients.kpi_meetings` |
| Contracted amount | number input (step 0.01) | `clients.contracted_amount` |
| Contract due date | date input | `clients.contract_due_date` |

Editable fields — **Client configuration** section:

| Field | Control | Source column | Notes |
|-------|---------|---------------|-------|
| Name | text input | `clients.name` | manager + admin |
| Status | Select | `clients.status` | manager + admin |
| Customer satisfaction | 3 hearts (`SatisfactionHearts`) | `clients.satisfaction` | manager + admin |
| Manager | Select (users where `role='manager'`) | `clients.manager_id` | **admin only** |
| Min daily sent | number input | `clients.min_daily_sent` | manager + admin |
| Inboxes count | number input | `clients.inboxes_count` | manager + admin |
| Prospects signed | number input | `clients.prospects_signed` | manager + admin |
| Prospects added | number input | `clients.prospects_added` | manager + admin |
| Auto OOO enabled | checkbox | `clients.auto_ooo_enabled` | manager + admin |
| Lost reason | textarea | `clients.lost_reason` | Shown only when `status` ∈ `{Inactive, Offboarding, Subscription}` |
| Internal notes | textarea | `clients.notes` | Always visible; also inline-editable from the mega-table (§2.2) |
| Setup notes | textarea | `clients.setup_info` | manager + admin |

Save calls `repository.updateClient(clientId, patch)` directly from the page ([clients-page.tsx:267](../../../src/app/pages/clients-page.tsx#L267)). The row is patched optimistically in the page hook's local state; on error the hook re-fetches (`load()`) to roll back and shows a toast. See [09-mutations §2](./09-mutations-rls.md).

### 2.4 Create client Sheet

"New client" button in `PageHeader` actions. Opens a `<Sheet>` (Radix-based side panel). Required fields: `name`, `manager_id`, `status`. Optional: `kpi_leads`, `kpi_meetings`, `contracted_amount`, `contract_due_date`.

- **Manager role:** `manager_id` auto-set to `identity.userId`; field hidden.
- **Admin / super_admin:** `manager_id` shown as a Select of users with `role='manager'`.
- Calls `repository.createClient(input)` ([clients-page.tsx:245](../../../src/app/pages/clients-page.tsx#L245)). On success the returned row is prepended to the page hook's local `clients` array (no optimistic update). See [09-mutations §2.10](./09-mutations-rls.md).

### 2.5 Filtering

- Search box by client name (not persisted).
- Status filter chips (any subset of the `client_status` enum; empty = all). The chip order follows
  the `CLIENT_STATUSES` tuple in [`types/core.ts`](../../../src/app/types/core.ts): Onboarding,
  Active, On hold, Offboarding, Inactive, Subscription.
- Manager filter (admin only sees non-trivial values; for managers the dropdown is redundant).
- One segmented **satisfaction filter** (`ToggleGroup`) with live counts, based on
  `clients.satisfaction`:
  - `All`
  - `♥` / `♥♥` / `♥♥♥` (satisfaction = 1 / 2 / 3)
  - `Not rated` (`satisfaction IS NULL` — where every client starts)

Filters (except the search box) persist per-user in `user_table_preferences` under
`clients:mega`. A stored sort key that no longer names a real column (e.g. the old `"health"`) is
ignored on load.

### 2.6 Condition highlighting (cells only)

Rule results are loaded from `condition_rules` and evaluated at runtime per client. **There is no
longer a per-row severity rollup or `healthScore`** — the manual satisfaction rating (§2.7) replaced
it. What the engine still drives:

- Cell highlight: per-column condition result (`cell` rules), with reduced fill noise (problem-cell
  emphasis only).
- Distinct `critical_over` style (fuchsia/magenta family) separate from danger.
- Tooltip on highlighted values includes rule name, value, message, and source sheet/range — this is
  now the only place the "why" (e.g. "SQL below daily target") is surfaced.
- DoD table uses dynamic runtime keys (`dod:{bucket}:{schedule|sent}`) to evaluate one reusable rule
  across multiple cells.

### 2.7 Customer satisfaction (manual rating)

A manually-set 1–3 heart rating on `clients.satisfaction` (`smallint`, `CHECK 1..3`, NULL = not
rated). Component: [`SatisfactionHearts`](../../../src/app/components/satisfaction-hearts.tsx) —
read-only where no change handler is passed, an accessible radiogroup of buttons where one is.

- **Grid:** hearts sit under the client name in the sticky Client cell, inline-editable for any
  internal user (`identity.role !== "client"`), same gate as the inline Status cell. Clicking the
  already-selected level clears back to NULL.
- **Drawer:** the same control in the Client configuration section, saved through the draft's
  Save/Cancel like every other field.
- Both paths write via the `updateClient` gateway action (§09-mutations); the value is range-checked
  in the contract *and* by the DB CHECK.

### 2.8 Empty / loading / error

- `<EmptyState>` when scoped list is empty.
- `LoadingState` / `<Banner>` as above.

---

## 3. Leads вЂ” `InternalLeadsPage`

File: [`src/app/pages/leads-page.tsx`](../../../src/app/pages/leads-page.tsx) (renders `InternalLeadsPage` for non-client roles). Route: `/manager/leads`.

### 3.1 Purpose

Editable lead workspace. Change qualification, mark milestones (meeting booked/held, offer sent, won), write comments, view full reply history.

### 3.2 Filters

- `PortalSearch`-style search on name / email / company / title / country.
- Campaign filter (Select).
- Pipeline stage chips (same as client pipeline; click to filter).
- URL state contract: `q`, `campaign`, `stage`, `sort`, `dir`, `range`, `from`, `to`, `page`.

> The OOO qualification filter (`All leads` / `Non-OOO only` / `OOO only`) and its `replyScope`
> URL param were **removed** (2026-07-22) together with migration `20260722z`: OOO is no longer a
> lead state (ADR-0015), so there is nothing on a lead to scope by.

### 3.3 Lead table (dense report — Batch 4)

As of Batch 4 this is the shared dense **report table** (`LeadReportTable`) driven by [`buildLeadReportColumns`](../../../src/app/lib/lead-report-columns.tsx) — the same registry the client portal uses ([05 §2.3](05-client-portal.md)). Small font, narrow resizable columns (storage key `table:leads-report:columns:<admin|internal>:<n>`), sticky header, horizontal scroll, truncation.

Columns mirror the Google-Sheets report: Full name, **Client** (admin/master only), Job title, Email, Phone/source, Company, Industry, Headcount, Lead received, Campaign, Message title/#, Website, Qualification, Response time, **Status** (read-only badge from `getLeadStage`), Replies, Last reply, Mail-from-lead preview, **Client note**, **ColdUnicorn note** (internal-only), LinkedIn, then per-client **custom columns** (admin/master only, [ADR-0007](../../adr/0007-per-client-lead-custom-fields.md)). Server-side sort on base columns (`lead/client/company/campaign/step/status/replies/lastReply/created`).

**Row highlight (4E):** a trailing colour menu sets `leads.highlight` (`green/yellow/red/none`) with optimistic update; the row paints a semi-transparent background. **Notes** are edited in the lead drawer (Client note / ColdUnicorn note). **Custom columns:** values edited inline; definitions managed via the header **"Manage columns"** sheet (admin/master_admin only). **Export:** CSV / XLSX of all filtered/sorted rows.

Pagination: `PAGE_SIZE = 50` with numbered pagination, persisted in URL via `page`.

### 3.4 Lead drawer (editable)

Opens on row click. Editable fields (disabled for client role, enabled here):

| Field | Control | Column |
|-------|---------|--------|
| Qualification | Select | `leads.qualification` |
| Meeting booked | checkbox | `leads.meeting_booked` |
| Meeting held | checkbox | `leads.meeting_held` |
| Offer sent | checkbox | `leads.offer_sent` |
| Won | checkbox | `leads.won` |
| Client note | textarea | `leads.client_note` (renamed from `comments`; client-facing) |
| ColdUnicorn note | textarea | `leads.coldunicorn_note` (internal-only) |

Metadata (read-only): Email, job title, company, campaign name, step (`message_number` or latest reply's `sequence_step`), reply count, country, industry, headcount, website, LinkedIn URL, response time label.

Replies history: listed sorted by `received_at DESC`; each entry shows classification badge, language code, subject, body, received date.

Save: `repository.updateLead(lead.id, patch)` called directly from the page ([leads-page.tsx:510](../../../src/app/pages/leads-page.tsx#L510)), then `useLeadsList().refresh()` re-runs the `loadLeadsList` action so the row reflects the server state. Per ADR-0004, only the listed fields are actually sent. Escape closes drawer.

### 3.5 Create lead Sheet

"New lead" button in `PageHeader` actions. Opens a `<Sheet>`. Required field: `client_id`. Optional: `campaign_id` (filtered to selected client's campaigns), `first_name`, `last_name`, `email`, `company_name`, `job_title`. `source` is always `'manual'` (not shown).

Calls `repository.createLead(input)` ([leads-page.tsx:416](../../../src/app/pages/leads-page.tsx#L416)), then `useLeadsList().refresh()`. See [09-mutations §2.12](./09-mutations-rls.md).

### 3.6 Scope

- Manager: leads whose `client_id` belongs to one of their assigned clients (`clients.manager_id = auth.uid()`).
- Admin: all leads.

---

## 4. Campaigns вЂ” `InternalCampaignsPage`

File: [`src/app/pages/campaigns-page.tsx`](../../../src/app/pages/campaigns-page.tsx). Route: `/manager/campaigns`.

### 4.1 Filters

- Search (by `name` or `external_id`).
- Status Select.
- Client Select (only meaningful for admin; manager sees their assigned subset).
- Timeframe picker (DateRangeButton).

### 4.2 Table

Resizable columns, storage key `table:campaigns:columns`, defaults `[420, 210, 190, 200, 180]`, mins `[260, 150, 140, 140, 140]`.

| Column | Source |
|--------|--------|
| Name | `campaigns.name` + `external_id` subtitle |
| Type | `campaigns.type` (badge) |
| Status | `campaigns.status` (badge) |
| Positive | `campaigns.positive_responses` (editable lifetime counter) |
| Start date | `campaigns.start_date` |

Sorting: `name`, `type`, `status`, `positive`, `start`. PAGE_SIZE 50 with "Load more".

### 4.3 Drawer (editable)

Fields:

| Field | Control | Column |
|-------|---------|--------|
| Name | text | `campaigns.name` |
| Status | Select | `campaigns.status` |
| Database size | number | `campaigns.database_size` |
| Positive responses | number | `campaigns.positive_responses` |

Read-only metadata: `external_id`, `type`, `start_date`, `gender_target`, `client_id` (rendered as client name), counts summary.

Embedded chart: **Daily performance** LineChart for the selected campaign over the current timeframe (`sent`, `replies`, `opens`, `bounces` вЂ” same four series as Client Campaigns daily volume chart).

Save: `repository.updateCampaign(campaign.id, patch)` called directly from the page ([campaigns-page.tsx:500](../../../src/app/pages/campaigns-page.tsx#L500)), then `useCampaignsList().refresh()`. RLS: `campaigns_update_scoped` requires `can_manage_client`.

### 4.4 Create campaign Sheet

“New campaign” button in `PageHeader` actions (alongside the `DateRangeButton`). Required fields: `client_id`, `external_id` (Bison ID — unique, user-entered), `name`, `type`, `status`. Optional: `database_size`, `start_date`.

Calls `repository.createCampaign(input)` ([campaigns-page.tsx:480](../../../src/app/pages/campaigns-page.tsx#L480)), then `useCampaignsList().refresh()`. See [09-mutations §2.11](./09-mutations-rls.md).

---

## 5. Analytics вЂ” `InternalStatisticsPage`

File: [`src/app/pages/statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx). Route: `/manager/statistics`.

### 5.1 Filters

- Client search + dropdown (scoped). The option list is capped so large client portfolios stay usable.
- Campaign search + dropdown (cascades from client selection). The option list is capped and the campaign portfolio groups cards by client, renders 12 client groups at a time, and shows up to 12 campaigns per client group.
- `DateRangeButton`; presets are calculated against the latest visible analytics date in the snapshot.

Admin roles also get manager search + dropdown before the client filter; manager role does not see it because the route is already scoped to that manager.

### 5.2 Charts & widgets

- **Sent volume** LineChart: `sent` (cyan `#38bdf8`). With no campaign selected, data comes from `daily_stats.emails_sent` grouped by normalized `report_date`; when a campaign is selected, it falls back to `campaign_daily_stats.sent_count`.
- **Replies & bounces** LineChart (2 series): `replies` (green `#22c55e`), `bounces` (orange `#f97316`). Without a campaign filter, replies and bounces come from `daily_stats.response_count` / `daily_stats.bounce_count`.
- **Lead qualification mix** compact donut + numeric breakdown list. Data: count filtered leads grouped by `qualification`. Admin roles also get a manager lead split in the same panel, stacked below the donut/breakdown so the manager rows have enough width. Colors cycle through `["#38bdf8","#22c55e","#f59e0b","#f97316"]`.
- **Summary KPI cards**: sent, replies, bounces, leads, campaigns for the current filter scope; sent/replies/bounces use the same `daily_stats`-first rule as the charts.
- **By client** cards: sent, replies, leads, reply rate for each visible client with activity. Delivery totals use `daily_stats` unless a campaign filter is active. The card list has its own search, renders 40 clients at a time with "Load more", and the visible list is height-constrained with internal scrolling so it does not stretch the adjacent lead-mix panel.
- **By manager** cards: admin roles only, including `master_admin`; clients, campaigns, sent, replies, leads, reply rate per manager. Delivery totals use `daily_stats` unless a campaign filter is active. Managers missing from the users snapshot are still grouped by `clients.manager_id`.
- **Campaign portfolio** grouped by client (interactive). Click any campaign card to set `campaignFilterId`. Each client group shows group-level campaign count, sent total, and reply rate; campaign cards show `name`, `database_size`, `positive_responses`, `sent`, reply rate. The list is limited to campaigns with activity in the selected timeframe, is searchable, renders 12 client groups at a time, shows up to 12 campaign cards per group, and selected card shows an extended metadata panel (status, type, start_date, database, positive, external_id, gender_target, daily stats count).

### 5.3 Scope

Only displays campaigns / leads under `scopeClients` for the manager. Admin sees everything.

---

## 6. Domains вЂ” `DomainsPage`

File: [`src/app/pages/domains-page.tsx`](../../../src/app/pages/domains-page.tsx). Route: `/manager/domains`.

### 6.1 Filters

- Search (domain or setup email).
- Status Select (`active` / `warmup` / `blocked` / `retired`).

### 6.2 Table

| Column | Source |
|--------|--------|
| Domain | `domains.domain_name` + `setup_email` subtitle |
| Client | joined via `client_id` |
| Status | `domains.status` (local badge) |
| Winnr status | `domains.winnr_status` (read-only, from Winnr) |

Resizable columns as elsewhere. A per-domain **email-accounts panel** (mailboxes + warming health) shows in the detail view. The full mailbox list ([email-accounts-page](../../../src/app/pages/email-accounts-page.tsx)) is a **sub-page of Domains**, not a separate sidebar entry: route `…/domains/email-accounts`, reached via the in-page `Domains | Email accounts` tabs ([domains-tabs.tsx](../../../src/app/components/domains-tabs.tsx)). Same for admin.

### 6.3 Drawer (editable)

- `status` Select (local `domain_status` — the only editable field)

Read-only: `client`, `setup_email`, `purchase_date`, `winnr_status`, and the per-domain mailbox warming panel. Winnr sync fields are ingestion-only (n8n).

Save: `repository.updateDomain`. RLS: `domains_update_scoped` via `can_access_client`.

### 6.4 Create domain Sheet

"New domain" button in `PageHeader` actions. Required fields: `client_id`, `domain_name`, `setup_email`, `purchase_date`. Optional: `status`. (`exchange_date` / `exchange_cost` were dropped in `20260720f`.)

Calls `repository.createDomain(input)` ([domains-page.tsx:375](../../../src/app/pages/domains-page.tsx#L375)), then `useDomainsPage().refresh()`. See [09-mutations §2.13](./09-mutations-rls.md).

---

## 7. Invoices вЂ” `InvoicesPage`

File: [`src/app/pages/invoices-page.tsx`](../../../src/app/pages/invoices-page.tsx). Route: `/manager/invoices`.

### 7.1 Filters

- Search (by client name).
- Status Select (free-text; typical values `paid`, `pending`, `overdue`).

### 7.2 Table

| Column | Source |
|--------|--------|
| Client | joined via `client_id` |
| Issue date | `invoices.issue_date` |
| Amount | `invoices.amount` formatted as currency via `formatMoney` |
| Status | `invoices.status` |

### 7.3 Drawer (editable)

- `issue_date`, `amount`, `status` вЂ” editable.
- Save: `repository.updateInvoice`.
- RLS: `invoices_update_admin` policy name; the production SQL allows managers too per `mutation-ownership-matrix.md`.

---

## 8. Blacklist вЂ” `BlacklistPage`

File: [`src/app/pages/blacklist-page.tsx`](../../../src/app/pages/blacklist-page.tsx). Route: `/manager/blacklist`.

### 8.1 Mode вЂ” manager

**Read-only.** A `Banner` at the top reminds the user that only admins can modify the list. The form inputs are hidden.

### 8.2 Entries list

One row per entry:

- `domain`
- `created_at` (formatted)
- Remove button вЂ” **not rendered** for manager.

Data source: `email_exclude_list` table. `scopeDomains`-style filtering is not needed; the list is agency-wide.

Visible to internal users per `email_exclude_list_select_internal` RLS policy (`private.is_internal_user()`).

---

## 8.5 Planned ecosystem fields

The manager drawer on Clients page now covers all `clients` columns except `crm_config` (read-only badge). Remaining backlog:

- **BL-2** OOO routing rows (`client_ooo_routing`) — manager/admin UI to configure per-client follow-up campaigns. `auto_ooo_enabled` toggle exists; the per-gender routing table does not.
- **BL-4** Workshops / harmonogramy / cold-Ads ecosystem fields — schema columns + drawer UI both pending.

`prospects_signed`, `prospects_added`, `notes`, `lost_reason` are editable in the drawer (BL-3 shipped). Sequencer credentials (EmailBison workspace/key, Aimfox LinkedIn key) save via `upsertClientSequencer` to `client_sequencers` (ADR-0012), not to `clients` columns; saves are diffed separately from the client patch (`buildSequencerPatches`). `bi_setup_done` still exists on `clients` but is no longer surfaced or editable — the Bi column and its drawer checkbox were removed.

---

## 9. Settings

`SettingsPage` for manager, additionally showing:

- **Current Identity card** вЂ” displays `actorIdentity` (always) and `identity` (when impersonating), plus `isImpersonating` boolean and session email. Not visible to clients.
- **Request reset link** form вЂ” email input + "Send reset link" button. Calls `requestPasswordReset(email)` on the AuthProvider.

Other sections identical to the client view (see [05 В§5](./05-client-portal.md#5-settings)).

Next: [07 В· Admin portal](./07-admin-portal.md).


