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

Deep client operations view. Five tabs showing the same client roster with different metric projections. Row click opens an editable detail drawer.

### 2.2 Tabs (Overview, DoD, 3-DoD, WoW, MoM)

Tabs are a role-filter like toggle; the row set is the same (scoped clients), only the projected columns change. Selected tab is stored in component state (not URL).

#### Overview tab вЂ” columns

Resizable via `useResizableColumns` with storage key `table:clients:overview:columns`.

| Column | Source | Metric |
|--------|--------|--------|
| Client | `clients.name` | — |
| Manager | `users.first_name + last_name` (joined by `manager_id`) | — |
| Sent (today) | `ClientMetricsOverview.sentToday` | [DoD §8.2](./04-metrics-catalog.md#82-emails-sent-dod-bucket-0--1--2--3--4) bucket 0 |
| Prospects signed | `clients.prospects_signed` | Condition baseline |
| Prospects added | `clients.prospects_added` | Condition baseline |
| Min sent | `clients.min_daily_sent` | Condition baseline |
| Inboxes | `clients.inboxes_count` | Capacity baseline |
| Schedule (today / +1 / +2) | `ClientMetricsOverview.scheduleToday/scheduleTomorrow/scheduleDayAfter` | DoD schedule context |
| Sent (0/-1/-2) | `ClientMetricsOverview.sentToday/sentYesterday/sentTwoDaysAgo` | DoD sent context |
| 3-DoD Total | `ClientMetricsOverview.threeDodTotal` | [§9.1](./04-metrics-catalog.md#91-3-dod-total-leads) |
| 3-DoD SQL | `ClientMetricsOverview.threeDodSql` | [§9.2](./04-metrics-catalog.md#92-3-dod-sql-leads) |
| WoW Response | `wowResponseRate` | [§10.3](./04-metrics-catalog.md#103-wow-response-rate) |
| WoW Human | `wowHumanRate` | [§10.4](./04-metrics-catalog.md#104-wow-human-reply-rate) |
| WoW Bounce | `wowBounceRate` | [§10.5](./04-metrics-catalog.md#105-wow-bounce-rate) |
| WoW OOO | `wowOooRate` | [§10.6](./04-metrics-catalog.md#106-wow-ooo-rate) |
| WoW SQL | `wowSql` | MQLs in current week |
| MoM SQL | `momSql` | [§11.2](./04-metrics-catalog.md#112-mom-sql-leads) |
| Updated | `clients.updated_at` | — |

Sorting via column-header buttons. `null` rate values sort last.

#### DoD tab вЂ” columns

One row per client; columns are the 7 buckets from `createClientMetrics().dodRows`:

| Bucket | Schedule | Sent |
|--------|----------|------|
| +2 | `schedule_day_after` | вЂ” |
| +1 | `schedule_tomorrow` | вЂ” |
| 0  | `schedule_today`     | emails_sent today |
| -1 | вЂ”                    | emails_sent yesterday |
| -2 | вЂ”                    | emails_sent -2 |
| -3 | вЂ”                    | emails_sent -3 |
| -4 | вЂ”                    | emails_sent -4 |

#### 3-DoD tab вЂ” columns

Per client, one row per bucket in `threeDodRows`:

| Bucket | Total | SQL |
|--------|-------|-----|
| 0 / -1 / -2 / -3 / -4 | 3-DoD Total Leads | 3-DoD SQL Leads |

#### WoW tab вЂ” columns

Per client, one row per bucket in `wowRows`:

| Bucket | Total | SQL | Response | Human | Bounce | OOO | Negative |
|--------|-------|-----|----------|-------|--------|-----|----------|
| 0 / -1 / -2 / -3 | as `totalLeads`, `sqlLeads`, `responseRate`, `humanRate`, `bounceRate`, `oooRate`, `negativeRate` |

#### MoM tab вЂ” columns

Per client, one row per bucket in `momRows`:

| Bucket | Total | SQL | Meetings | Won |
|--------|-------|-----|----------|-----|
| 0 / -1 / -2 / -3 | `totalLeads`, `sqlLeads`, `meetings`, `won` |

### 2.3 Detail drawer (editable)

Opens on row click. Draft pattern: local `draft` state deviates from `selectedClient`; "Save" and "Cancel" buttons appear when `isDraftDirty`. `Escape` key closes the drawer discarding the draft.

Editable fields:

| Field | Control | Source column |
|-------|---------|---------------|
| Name | text input | `clients.name` |
| Status | Select | `clients.status` |
| Manager | Select (users where `role='manager'`) | `clients.manager_id` |
| Min daily sent | number input | `clients.min_daily_sent` |
| Inboxes count | number | `clients.inboxes_count` |
| Notification emails | CSV textarea (parsed with `parseCsv` + email regex validation) | `clients.notification_emails` (text[]) |
| SMS phone numbers | CSV textarea | `clients.sms_phone_numbers` (text[]) |
| Auto OOO enabled | checkbox | `clients.auto_ooo_enabled` |
| Setup info | textarea | `clients.setup_info` |
| KPI leads (month target) | number | `clients.kpi_leads` |
| KPI meetings (month target) | number | `clients.kpi_meetings` |
| Contract info | read-only display | `contracted_amount`, `contract_due_date` |

Save calls `useCoreData().updateClient(client.id, patch)` which proxies to `repository.updateClient`. Optimistic update; revert on error. See [09-mutations В§2](./09-mutations-rls.md).

### 2.4 Filtering, health filters, and badge visibility

- Search box by client name.
- Status filter dropdown (one of `client_status` enum, or "All").
- Manager filter (admin only sees non-trivial values; for managers the dropdown is redundant).
- Health filter by highest severity across all client surfaces:
  - `All clients`
  - `With warnings`
  - `With danger`
  - `With critical`
  - `Healthy only`
- Badge-severity visibility toggles allow showing/hiding `good`, `info`, `warning`, `danger`, `critical_over` badges.

### 2.5 Condition highlighting and explainability

Rule results are loaded from `condition_rules` and evaluated at runtime per client.

- Row tint: highest non-good severity.
- Cell highlight: per-column condition result (`cell` rules).
- Distinct `critical_over` style (fuchsia/magenta family) separate from danger.
- Tooltip on highlighted values includes rule name, value, message, and source sheet/range.
- DoD table uses dynamic runtime keys (`dod:{bucket}:{schedule|sent}`) to evaluate one reusable rule across multiple cells.

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
- Reply scope filter (All / Active / OOO). **Note:** despite the name, this filters **leads by `qualification`** (`OOO` vs not-`OOO`), not replies by classification. Rename to "Lead OOO scope" tracked as **BL-7** ([decision](../../BUSINESS_LOGIC.md#decision-2026-04-25-rename-reply-scope-filter)).
- Pipeline stage chips (same as client pipeline; click to filter).

### 3.3 Lead table

Resizable columns, storage key `table:leads:columns`, defaults `[380, 300, 220, 200]`.

| Column | Source |
|--------|--------|
| Lead (name + avatar) | `leads.first_name + last_name` |
| Company | `leads.company_name` |
| Status | `getLeadStage(lead)` with `PipelineBadge` |
| Updated | `leads.updated_at` |

Sorting keys: `lead`, `company`, `status` (by stage position in `PIPELINE_STAGES`), `updated`. Default: `updated` DESC.

Pagination: `PAGE_SIZE = 50` with "Load more".

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

### 3.5 Scope

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

---

## 5. Analytics вЂ” `InternalStatisticsPage`

File: [`src/app/pages/statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx). Route: `/manager/statistics`.

### 5.1 Filters

- Client dropdown (scoped).
- Campaign dropdown (cascades from client selection).
- `DateRangeButton`.

### 5.2 Charts & widgets

- **Trend lines** LineChart (4 series): `sent` (cyan `#38bdf8`), `replies` (green `#22c55e`), `opens` (violet `#a78bfa`), `bounces` (orange `#f97316`). Data: aggregate `campaign_daily_stats` in timeframe by `report_date`.
- **Lead qualification mix** PieChart (donut). Data: count filtered leads grouped by `qualification`. Colors cycle through `["#38bdf8","#22c55e","#f59e0b","#f97316"]`.
- **Campaign portfolio** cards (interactive). Click to set `campaignFilterId`. Card shows `name`, `database_size`, `positive_responses`, `sent`, reply rate. Selected card shows an extended metadata panel (status, type, start_date, database, positive, external_id, gender_target, daily stats count).

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

Today the manager drawer on Clients page covers `notification_emails`, `sms_phone_numbers`, `auto_ooo_enabled`, and `setup_info`. Several ecosystem fields are on the backlog ([BUSINESS_LOGIC В§11](../../BUSINESS_LOGIC.md#11-open-backlog-planned-not-built)):

- **BL-2** OOO routing rows (`client_ooo_routing`) вЂ” manager/admin UI to configure per-client follow-up campaigns. Today only the boolean toggle exists.
- **BL-3** LinkedIn API key (`linkedin_api_key`) вЂ” schema field exists, drawer UI does not surface it yet.
- **BL-4** Workshops / harmonogramy / cold-Ads ecosystem fields вЂ” schema columns + drawer UI both pending.

Until these ship, the corresponding configuration is managed in SQL or in n8n flows directly.

---

## 9. Settings

`SettingsPage` for manager, additionally showing:

- **Current Identity card** вЂ” displays `actorIdentity` (always) and `identity` (when impersonating), plus `isImpersonating` boolean and session email. Not visible to clients.
- **Request reset link** form вЂ” email input + "Send reset link" button. Calls `requestPasswordReset(email)` on the AuthProvider.

Other sections identical to the client view (see [05 В§5](./05-client-portal.md#5-settings)).

Next: [07 В· Admin portal](./07-admin-portal.md).


