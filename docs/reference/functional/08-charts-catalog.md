# 08 В· Charts Catalog

Single-page flat list of every visualisation in the portal, grouped by type, with series colors, data hooks, and interactions. Visualisations that are not part of `recharts` (custom SVG sparklines, HTML-bar conversion funnel) are included at the end.

Shared configuration:

- **Portal tooltip** (`PORTAL_CHART_TOOLTIP`) вЂ” used by client-portal charts. Background `#080808`, border `#242424`, border-radius 12px, text white. Label color `#a3a3a3`.
- **Internal tooltip** (`TOOLTIP` object in admin/manager pages) вЂ” background `rgba(2,6,23,0.98)`, border `rgba(148,163,184,0.2)`, border-radius 16px, `cursor: false`.
- **Grid:** `CartesianGrid strokeDasharray="3 3" stroke="#141414"` (portal) or `rgba(148,163,184,0.12)` (internal), with `vertical={false}`.
- **Axes:** ticks `fontSize: 11`, light slate fill, `axisLine={false} tickLine={false}`.

## Contents

1. [Client Dashboard charts](#1-client-dashboard-charts)
2. [Client Statistics charts](#2-client-statistics-charts)
3. [Client Campaigns charts](#3-client-campaigns-charts)
4. [Manager Dashboard charts](#4-manager-dashboard-surfaces)
5. [Internal Statistics charts](#5-internal-statistics-charts)
6. [Internal Campaigns drawer chart](#6-internal-campaigns-drawer-chart)
7. [Admin Dashboard charts](#7-admin-dashboard-charts)
8. [Non-recharts visualisations](#8-non-recharts-visualisations)

---

## 1. Client Dashboard charts

Page: [`client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx). All use `PORTAL_CHART_TOOLTIP`.

### 1.1 Daily sent (last 30 days)

- **Type:** `BarChart`
- **Data:** `getDailySentSeries(timeframeStats)` в†’ `Array<{ date, label, sent }>`
- **Series:** `<Bar dataKey="sent" fill="#22c55e" />`
- **X:** `dataKey="label"`. **Y:** linear.
- **Interactions:** driven by the page's `DateRangeButton`.
- **Empty state:** "No sent data".

### 1.2 Leads Count per week (MQL)

- **Type:** `BarChart`
- **Data:** inline вЂ” group timeframe leads by ISO-week start, count MQLs.
- **Series:** `<Bar dataKey="count" fill="#22c55e" />`
- **Empty state:** "No weekly lead data".

### 1.3 Leads Count per month

- **Type:** `BarChart`
- **Data:** inline вЂ” group sorted scoped `daily_stats` by month, sum `mql_count`.
- **Series:** `<Bar dataKey="leadsCount" fill="#22c55e" />`
- **Empty state:** "No monthly lead data".

### 1.4 Prospects added (last 10 days)

- **Type:** `BarChart`
- **Data:** inline вЂ” consecutive-day delta of `daily_stats.prospects_count`, last 10 days.
- **Series:** `<Bar dataKey="prospectsAdded" fill="#22c55e" />`
- **Empty state:** "No prospects delta".

### 1.5 Sent count for last three months

- **Type:** `BarChart`
- **Data:** inline вЂ” monthly sums of `campaign_daily_stats.sent_count`, last 3 calendar months.
- **Series:** `<Bar dataKey="sent" fill="#22c55e" />`
- **Empty state:** "No monthly sent data".

### 1.6 Prospects added by Month

- **Type:** `BarChart`
- **Data:** monthly aggregation of `daily_stats.prospects_count` в†’ month-over-month delta, last 12 months.
- **Series:** `<Bar dataKey="prospectsAdded" fill="#22c55e" />`
- **Empty state:** "No monthly prospect deltas".

### 1.7 Velocity Chart

- **Type:** `ComposedChart` (bar + line, dual-axis)
- **Data:** inline per-week last 8 weeks вЂ” `{ week, label, emailsDelta, mqls }`.
- **Series:**
  - `<Bar yAxisId="left" dataKey="emailsDelta">` with conditional `<Cell fill="#3b82f6">` for `emailsDelta >= 0`, `#1d4ed8` otherwise.
  - `<Line yAxisId="right" dataKey="mqls" stroke="#22c55e" dot={{ r: 3 }} />`.
- **Axes:** `yAxisId="left"` (default) and `yAxisId="right" orientation="right"`.
- **Empty state:** "No velocity data".

---

## 2. Client Statistics charts

Page: [`client-statistics-page.tsx`](../../../src/app/pages/client-statistics-page.tsx). `PORTAL_CHART_TOOLTIP`.

### 2.1 Pipeline Activity

- **Type:** `LineChart` (3 lines)
- **Data:** `getPipelineActivitySeries(timeframeLeads)` в†’ `Array<{ label, mqls, meetings, won }>`
- **Series:**
  - `<Line dataKey="mqls"     stroke="#3b82f6" strokeWidth={2.5} />`
  - `<Line dataKey="meetings" stroke="#8b5cf6" strokeWidth={2.5} />`
  - `<Line dataKey="won"      stroke="#22c55e" strokeWidth={2.5} />`
- **Empty state:** "No pipeline activity".

### 2.2 Daily sent (AreaChart)

- **Type:** `AreaChart` (single area)
- **Data:** `getDailySentSeries(timeframeStats)`
- **Series:** `<Area type="monotone" dataKey="sent" stroke="#22c55e" fill="#22c55e22" strokeWidth={2.5} />`
- **Empty state:** "No send volume".

### 2.3 Campaign reply rates

- **Type:** `BarChart`
- **Data:** `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 8)`
- **Series:** `<Bar dataKey="replyRate" fill="#22c55e" />`
- **X:** campaign names.
- **Empty state:** "No campaign stats".

### 2.4 Conversion Funnel

See [В§8.2](#82-conversion-funnel-html-bars).

---

## 3. Client Campaigns charts

Page: [`client-campaigns-page.tsx`](../../../src/app/pages/client-campaigns-page.tsx).

### 3.1 Daily campaign volume (id: `cc-daily-volume`)

- **Type:** `LineChart` (4 lines)
- **Data:** filter `timeframeStats` to `campaign_id === selectedCampaign.id`, normalised via a `formatDate` wrapper.
- **Series:**
  - `<Line dataKey="sent"     stroke="#22c55e" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="replies"  stroke="#3b82f6" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="opens"    stroke="#8b5cf6" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="bounces"  stroke="#f97316" strokeWidth={2.5} dot={false} />`
- **Empty state:** "No daily metrics yet".

### 3.2 Campaign sent count (top 10)

- **Type:** `BarChart`
- **Data:** `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 10)`
- **Series:** `<Bar dataKey="sent" fill="#22c55e" />`
- **Empty state:** "No campaign ranking".

---

## 4. Manager Dashboard surfaces

Page: [`manager-dashboard-page.tsx`](../../../src/app/pages/manager-dashboard-page.tsx).

The manager dashboard contains **no recharts graphs** (it optimises for tabular situational awareness). The surfaces are:

- Campaign watchlist вЂ” tabular.
- Assigned client portfolio вЂ” tabular with inline KPI progress bars (HTML `<div>` widths, not recharts).
- Lead queue вЂ” tabular.

No charts to catalogue here beyond the HTML progress bars already described in [06 В§1.4](./06-manager-portal.md#14-assigned-client-portfolio-surface).

---

## 5. Internal Statistics charts

Page: [`statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx). Uses the internal `TOOLTIP` style.

### 5.1 Trend lines

- **Type:** `LineChart` (4 lines)
- **Data:** inline aggregation of `filteredStats` by `report_date` в†’ `{ label, sent, replies, opens, bounces }`.
- **Series:**
  - `<Line dataKey="sent"    stroke="#38bdf8" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="replies" stroke="#22c55e" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="opens"   stroke="#a78bfa" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} />`
- **Empty state:** "No trend data yet".

### 5.2 Lead qualification mix

- **Type:** `PieChart` (donut; `innerRadius={64}`, `outerRadius={110}`)
- **Data:** inline вЂ” group `filteredLeads` by `qualification`, `{name, value}`.
- **Colors:** cycle through `PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"]`.
- **Empty state:** "No leads available".

### 5.3 Campaign portfolio grid

Interactive grid of clickable cards. Not a chart; listed here because it drives the other two panels (selecting a card sets `campaignFilterId`).

---

## 6. Internal Campaigns drawer chart

Page: [`campaigns-page.tsx`](../../../src/app/pages/campaigns-page.tsx).

### 6.1 Campaign performance drawer chart

- **Type:** `LineChart` (4 series: `sent`, `replies`, `opens`, `bounces`) вЂ” identical configuration to Client Campaigns daily volume chart [В§3.1](#31-daily-campaign-volume-id-cc-daily-volume).
- **Data:** `campaign_daily_stats` for the selected campaign over the page's timeframe, mapped to `{ label, sent, replies, opens, bounces }`.
- **Empty state:** "No daily performance yet".

---

## 7. Admin Dashboard charts

Page: [`admin-dashboard-page.tsx`](../../../src/app/pages/admin-dashboard-page.tsx). Uses internal `TOOLTIP` style.

### 7.1 Campaign momentum: Sent

- **Type:** `AreaChart` (single series)
- **Data:** inline — `scopedCampaignStats` within 21 days -> group by `report_date` -> `{ date, label, sent, replies, positive }`.
- **Series:** `<Area type="monotone" dataKey="sent" stroke="#38bdf8" fill="#38bdf822" strokeWidth={2} />`
- **Hard-coded 21-day window.**

### 7.2 Campaign momentum: Replies

- **Type:** `AreaChart` (single series)
- **Data:** same grouped 21-day dataset.
- **Series:** `<Area type="monotone" dataKey="replies" stroke="#22c55e" fill="#22c55e22" strokeWidth={2} />`

### 7.3 Campaign momentum: Positive

- **Type:** `AreaChart` (single series)
- **Data:** same grouped 21-day dataset.
- **Series:** `<Area type="monotone" dataKey="positive" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={2} />`

### 7.4 Manager capacity

Tabular surface; no charts.

## 8. Non-recharts visualisations

### 8.1 KPI sparklines (Client Dashboard)

Custom inline SVG component `Sparkline({ values, color })` in [`client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx) (~lines 110-129).

- Takes `values: number[]` and a color.
- Renders a 100x100 viewBox polyline over interpolated points.
- No axes, no tooltip. Visual only.
- Data per card: see [04-metrics В§7](./04-metrics-catalog.md#7-client-dashboard-sparklines).

### 8.2 Conversion Funnel (HTML bars)

Rendered by `ClientDashboardPage` and `ClientStatisticsPage`. No recharts involvement. Each stage from `getConversionRates(вЂ¦)` becomes a row:

- Label
- Value (formatted count)
- Rate label ("в†ђ X% prospectв†’MQL", etc.)
- Horizontal bar whose width encodes `value / from` with the stage color.

Colors per stage: Prospects `#3b82f6`, MQLs `#8b5cf6`, Meetings `#a855f7`, Won `#22c55e` ([04-metrics В§3](./04-metrics-catalog.md#3-conversion-funnel)).

On the Client Dashboard, a short list of top-6 campaigns by reply rate renders below the funnel. Row accent color: `>= 5%` green `#22c55e`, else yellow `#facc15`.

### 8.3 KPI progress bars (Manager Dashboard)

Client portfolio rows include a small HTML progress indicator.

- Width = `min(mqls / kpi_leads, 1) * 100%`.
- Green fill when в‰Ґ 100%, amber when 50вЂ“99%, red when below 50% (threshold constants inline in the page).

### 8.4 Pipeline badges & filter chips

Rendered by `PipelineBadge` and `FilterChip` in [`portal-ui.tsx`](../../../src/app/components/portal-ui.tsx). Visual only вЂ” dot color per `PIPELINE_STAGES` entry, count on chip.

---

## Tooltip cheat sheet

| Context | Background | Border | Extra |
|---------|-----------|--------|-------|
| Portal (client pages) | `#080808` | `#242424` | вЂ” |
| Internal (admin/manager pages) | `rgba(2,6,23,0.98)` | `rgba(148,163,184,0.2)` | `cursor: false` |

Used by every recharts component above via the `contentStyle`, `labelStyle`, `itemStyle` props on `<Tooltip>`.

Next: [09 В· Mutations & RLS](./09-mutations-rls.md).

