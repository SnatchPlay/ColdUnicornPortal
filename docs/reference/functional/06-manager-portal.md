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

Day-one view for the Customer Success manager. Surfaces anomalies that need action: stopped campaigns, clients behind KPI, unclassified replies, most recent lead state changes.

### 1.2 Metric cards (4)

`MetricCard` row at the top. See [04-metrics В§12](./04-metrics-catalog.md#12-manager-dashboard-aggregates).

| # | Label | Value | Data |
|---|-------|-------|------|
| 1 | Assigned clients | `scopedClients.length` | `scopeClients` by `manager_id` |
| 2 | Active campaigns | `count(scopedCampaigns WHERE status='active')` | `scopeCampaigns` |
| 3 | Leads in progress | `count(scopedLeads WHERE stage в€‰ ('won','rejected'))` (approx; actual uses recency filter) | `scopeLeads` |
| 4 | Unclassified replies | `count(scopedReplies WHERE classification IS NULL)` | `scopeReplies` |

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

`Surface title="Lead queue"`. 10 most recently updated leads in scope.

Columns:

- Lead name + avatar initials
- Pipeline stage (colored badge)
- Client name
- Updated timestamp

Data: `scopedLeads` sorted by `updated_at DESC` then sliced to 10.

### 1.6 Empty / loading / error

- `LoadingState` while data loads.
- `<Banner tone="warning">` with retry button on `useCoreData().error`.
- Each surface renders `<EmptyState>` when its own filtered array is empty.

---

## 2. Clients вЂ” `ClientsPage`

File: [`src/app/pages/clients-page.tsx`](../../../src/app/pages/clients-page.tsx). Route: `/manager/clients` (and `/admin/clients`).

### 2.1 Purpose

Single dense PDCA grid covering DoD, 3-DoD, WoW, and MoM in **one horizontally-scrolled table** modelled after the team's working Google Sheets. Row click opens an editable detail drawer holding non-statistical client configuration (credentials, contacts, setup notes, issues timeline).

### 2.2 Mega-table layout

One mega-table per page — no tabs. Defined in [`src/app/pages/clients-page/mega-table.tsx`](../../../src/app/pages/clients-page/mega-table.tsx) (`MEGA_COLUMNS` constant). Two-level header bands: top-level **group band** + sub-level **sub band** + column-name header row. First 3 columns are CSS-sticky (left edge).

| Group band | Sub band | Columns |
|-----------|----------|---------|
| **Customer Success** (sticky) | Customer Success | Client (name + status pill), Health (severity badge + score + rollup cause), Manager |
| **Basic** | Basic | Inboxes, Signed, Added, Min sent, KPI L, KPI M, Bi-setup ✓, Auto-OOO ✓, CRM ✓, Updated |
| **DoD Schedule** | Schedule | +2, +1, 0 — `ClientMetricsPack.dodRows[bucket].schedule` |
| **DoD Daily sent** | Daily sent | 0, -1, -2, -3, -4 — `ClientMetricsPack.dodRows[bucket].sent` |
| **3-Day rolling** | 3-DoD TOTAL leads | 0, -1, -2, -3, -4 — `threeDodRows[bucket].totalLeads` |
|  | 3-DoD SQL leads | 0, -1, -2 — `threeDodRows[bucket].sqlLeads` |
| **Week over Week** | WoW Resp / Human / Bnc / OOO | 0/-1/-2/-3 per metric — rates from `wowRows[bucket]` |
|  | WoW SQL | 0/-1/-2/-3 — `wowRows[bucket].sqlLeads` |
| **Month over Month** | MoM SQL / Mtg / Won | 0/-1/-2/-3 per metric — `momRows[bucket]` |

Total ≈ 61 columns. Column widths resizable per-cell via `useResizableColumns` (storage key `table:clients:mega-columns`). Sorting via column-header buttons (`Sort by <sub> <label>` aria-label). Default sort: `health asc` (worst first).

Cell highlighting is driven by the existing `condition_rules` engine: `getCellCondition(allResults, conditionKey)` for static columns, `dodCellKey(bucket, kind)` for DoD per-bucket. Each tinted cell is wrapped in a `Tooltip` exposing rule, value, threshold, message.

### 2.3 Detail drawer (editable)

Opens on row click. Draft pattern: local `draft` state deviates from `selectedClient`; "Save" and "Cancel" buttons appear when `isDraftDirty`. `Escape` key closes the drawer discarding the draft. Defined in [`src/app/pages/clients-page/client-drawer.tsx`](../../../src/app/pages/clients-page/client-drawer.tsx).

Sections (top → bottom):

1. **Header** — name, status pill, manager, contract amount + due.
2. **Operational issues** — timeline of warning/danger/critical condition results (deduped by `ruleKey`).
3. **Setup gaps** — condition results from the `setup` surface that aren't `good`.
4. **Credentials & IDs** (read-only, masked + copy) — `external_workspace_id`, `external_api_key`, `linkedin_api_key`, CRM status from `crm_config`.
5. **Client configuration** — editable form.
6. **Contacts** — `notification_emails` + `sms_phone_numbers` via `StringListEditor`.
7. **User access management** — invite + map client portal users.

Editable fields — **Credentials & IDs** section:

| Field | Control | Source column | Who |
|-------|---------|---------------|-----|
| Workspace ID | number input | `clients.external_workspace_id` | manager + admin |
| Workspace API key | `SecretInput` (show/hide) | `clients.external_api_key` | manager + admin |
| LinkedIn API key | `SecretInput` (show/hide) | `clients.linkedin_api_key` | manager + admin |
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
| Manager | Select (users where `role='manager'`) | `clients.manager_id` | **admin only** |
| Min daily sent | number input | `clients.min_daily_sent` | manager + admin |
| Inboxes count | number input | `clients.inboxes_count` | manager + admin |
| Prospects signed | number input | `clients.prospects_signed` | manager + admin |
| Prospects added | number input | `clients.prospects_added` | manager + admin |
| Auto OOO enabled | checkbox | `clients.auto_ooo_enabled` | manager + admin |
| BI setup done | checkbox | `clients.bi_setup_done` | manager + admin |
| Lost reason | textarea | `clients.lost_reason` | Shown only when `status` ∈ `{Inactive, Offboarding, Abo}` |
| Internal notes | textarea | `clients.notes` | Always visible |
| Setup notes | textarea | `clients.setup_info` | manager + admin |

Save calls `useCoreData().updateClient(client.id, patch)` which proxies to `repository.updateClient`. Optimistic update; revert on error. See [09-mutations §2](./09-mutations-rls.md).

### 2.4 Create client Sheet

"New client" button in `PageHeader` actions. Opens a `<Sheet>` (Radix-based side panel). Required fields: `name`, `manager_id`, `status`. Optional: `kpi_leads`, `kpi_meetings`, `contracted_amount`, `contract_due_date`.

- **Manager role:** `manager_id` auto-set to `identity.userId`; field hidden.
- **Admin / super_admin:** `manager_id` shown as a Select of users with `role='manager'`.
- Calls `useCoreData().createClient(input)`. On success the new client is prepended to the snapshot (no optimistic update). See [09-mutations §2.10](./09-mutations-rls.md).

### 2.5 Filtering and health segmentation

- Search box by client name.
- Status filter dropdown (one of `client_status` enum, or "All").
- Manager filter (admin only sees non-trivial values; for managers the dropdown is redundant).
- One segmented health filter with live counts, based on row highest severity:
  - `All`
  - `Warning`
  - `Danger`
  - `Critical`
  - `Healthy`

`Healthy` includes rows with no matched severity or only `good/info` outcomes.

### 2.5 Condition highlighting, rollup, and explainability

Rule results are loaded from `condition_rules` and evaluated at runtime per client.

- Row rollup model:
  - one severity badge per row (highest severity only)
  - per-row `healthScore` (0..100, lower = worse) with default sort `worst first`
  - lifecycle and health split into separate overview columns
- Row tint: highest non-good severity.
- Cell highlight: per-column condition result (`cell` rules), with reduced fill noise (problem-cell emphasis only).
- Distinct `critical_over` style (fuchsia/magenta family) separate from danger.
- Tooltip on highlighted values includes rule name, value, message, and source sheet/range.
- DoD table uses dynamic runtime keys (`dod:{bucket}:{schedule|sent}`) to evaluate one reusable rule across multiple cells.
- Drawer issue model (post-redesign):
  - `Operational issues`: warning/danger/critical items rendered as a timeline
  - `Setup gaps`: setup/info-like gaps from the `setup` surface
  - DoD/3-DoD/WoW/MoM per-bucket condition badges are no longer in the drawer — they live directly in the mega-table cells.

### 2.6 Empty / loading / error

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
- OOO qualification filter (`All leads` / `Non-OOO only` / `OOO only`). This filters leads by `qualification`, not replies.
- Pipeline stage chips (same as client pipeline; click to filter).
- URL state contract: `q`, `campaign`, `stage`, `replyScope`, `sort`, `dir`, `range`, `from`, `to`, `page`.

### 3.3 Lead table

Resizable columns, storage key `table:leads:columns`, defaults `[380, 300, 220, 200]`.

| Column | Source |
|--------|--------|
| Lead (name + avatar) | `leads.first_name + last_name` |
| Company | `leads.company_name` |
| Status | `getLeadStage(lead)` with `PipelineBadge` |
| Updated | `leads.updated_at` |

Sorting keys: `lead`, `company`, `status` (by stage position in `PIPELINE_STAGES`), `updated`. Default: `updated` DESC.

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
| Comments | textarea | `leads.comments` |

Metadata (read-only): Email, job title, company, campaign name, step (`message_number` or latest reply's `sequence_step`), reply count, country, industry, headcount, website, LinkedIn URL, response time label.

Replies history: listed sorted by `received_at DESC`; each entry shows classification badge, language code, subject, body, received date.

Save: `useCoreData().updateLead(lead.id, patch)` в†’ `repository.updateLead`. Optimistic; revert on error. Per ADR-0004, only the listed fields are actually sent. Escape closes drawer.

### 3.5 Create lead Sheet

"New lead" button in `PageHeader` actions. Opens a `<Sheet>`. Required field: `client_id`. Optional: `campaign_id` (filtered to selected client's campaigns), `first_name`, `last_name`, `email`, `company_name`, `job_title`. `source` is always `'manual'` (not shown).

Calls `useCoreData().createLead(input)`. See [09-mutations §2.12](./09-mutations-rls.md).

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

Save: `useCoreData().updateCampaign(campaign.id, patch)` в†’ `repository.updateCampaign`. RLS: `campaigns_update_scoped` requires `can_manage_client`.

### 4.4 Create campaign Sheet

“New campaign” button in `PageHeader` actions (alongside the `DateRangeButton`). Required fields: `client_id`, `external_id` (Smartlead/Bison ID — unique, user-entered), `name`, `type`, `status`. Optional: `database_size`, `start_date`.

Calls `useCoreData().createCampaign(input)`. See [09-mutations §2.11](./09-mutations-rls.md).

---

## 5. Analytics вЂ” `InternalStatisticsPage`

File: [`src/app/pages/statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx). Route: `/manager/statistics`.

### 5.1 Filters

- Client search + dropdown (scoped). The option list is capped so large client portfolios stay usable.
- Campaign search + dropdown (cascades from client selection). The option list is capped and the campaign portfolio groups cards by client, renders 12 client groups at a time, and shows up to 12 campaigns per client group.
- `DateRangeButton`; presets are calculated against the latest visible analytics date in the snapshot.

Admin roles also get manager search + dropdown before the client filter; manager role does not see it because the route is already scoped to that manager.

### 5.2 Charts & widgets

- **Coverage banner**: states how many calendar days are in the selected range, how many active days have `campaign_daily_stats`, and the actual activity date range. Days without stat rows render as 0, which explains cases where 7-day and 30-day totals match.
- **Sent volume** LineChart: `sent` (cyan `#38bdf8`). Data: aggregate `campaign_daily_stats` in timeframe by normalized `report_date`; all campaign rows for the same date are summed into one chart point, then missing calendar days in the selected range are zero-filled.
- **Replies, opens & bounces** LineChart (3 series): `replies` (green `#22c55e`), `opens` (violet `#a78bfa`), `bounces` (orange `#f97316`). Uses the same zero-filled daily aggregate as Sent volume.
- **Lead qualification mix** compact donut + numeric breakdown list. Data: count filtered leads grouped by `qualification`. Admin roles also get a manager lead split in the same panel, stacked below the donut/breakdown so the manager rows have enough width. Colors cycle through `["#38bdf8","#22c55e","#f59e0b","#f97316"]`.
- **Summary KPI cards**: sent, replies, opens, bounces, leads, campaigns for the current filter scope.
- **By client** cards: sent, replies, leads, reply rate for each visible client with activity. The card list has its own search, renders 40 clients at a time with "Load more", and the visible list is height-constrained with internal scrolling so it does not stretch the adjacent lead-mix panel.
- **By manager** cards: admin roles only, including `master_admin`; clients, campaigns, sent, replies, leads, reply rate per manager. Managers missing from the users snapshot are still grouped by `clients.manager_id`.
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
| Status | `domains.status` (badge) |
| Reputation | `domains.reputation` |

Resizable columns as elsewhere.

### 6.3 Drawer (editable)

- `status` Select
- `reputation` text input
- `exchange_cost` number
- `campaign_verified_at` date input
- `warmup_verified_at` date input

Read-only: `purchase_date`, `exchange_date`.

Save: `repository.updateDomain`. RLS: `domains_update_scoped` via `can_access_client`.

### 6.4 Create domain Sheet

"New domain" button in `PageHeader` actions. Required fields: `client_id`, `domain_name`, `setup_email`, `purchase_date`, `exchange_date`. Optional: `exchange_cost`, `status`.

Calls `useCoreData().createDomain(input)`. See [09-mutations §2.13](./09-mutations-rls.md).

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

`linkedin_api_key`, `external_workspace_id`, `external_api_key`, `bi_setup_done`, `prospects_signed`, `prospects_added`, `notes`, `lost_reason` are now editable in the drawer (BL-3 shipped).

---

## 9. Settings

`SettingsPage` for manager, additionally showing:

- **Current Identity card** вЂ” displays `actorIdentity` (always) and `identity` (when impersonating), plus `isImpersonating` boolean and session email. Not visible to clients.
- **Request reset link** form вЂ” email input + "Send reset link" button. Calls `requestPasswordReset(email)` on the AuthProvider.

Other sections identical to the client view (see [05 В§5](./05-client-portal.md#5-settings)).

Next: [07 В· Admin portal](./07-admin-portal.md).


