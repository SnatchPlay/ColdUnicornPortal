# 08 В· Charts Catalog

Single-page flat list of every visualisation in the portal, grouped by type, with series colors, data hooks, and interactions. Visualisations that are not part of `recharts` (custom SVG sparklines, HTML-bar conversion funnel) are included at the end.

Shared configuration:

- **Portal tooltip** (`PORTAL_CHART_TOOLTIP`, [`portal-ui.tsx:16-25`](../../../src/app/components/portal-ui.tsx#L16)) — used by client-portal charts. Background `#080808`, border `#242424`, border-radius 12px, text white. Label color `#a3a3a3`.
- **Internal/dashboard tooltip** (`DASHBOARD_CHART_TOOLTIP`, [`dashboard-momentum.ts:25-35`](../../../src/app/lib/dashboard-momentum.ts#L25)) — background `rgba(2,6,23,0.98)`, border `rgba(148,163,184,0.2)`, border-radius 16px, `cursor: false`. Used by the Admin + Manager dashboards.
- **Grid:** `CartesianGrid strokeDasharray="3 3" stroke="#141414"` (portal) or `rgba(148,163,184,0.12)` (internal), with `vertical={false}`.
- **Axes:** ticks `fontSize: 11`, light slate fill, `axisLine={false} tickLine={false}`.
- **Trend-line overlay:** most time-series charts render a second `<Line>` with a least-squares regression of the same series, produced by `linearRegression()` ([`dashboard-momentum.ts:6-16`](../../../src/app/lib/dashboard-momentum.ts#L6)). Standard style: `strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false}` (`legendType="none"` where a legend exists), stroke = the parent series color. See [§9 Trend-line overlays](#9-trend-line-overlays).
- **Contrast palette:** chart series colors are **not** affected by `ColorThemeProvider` (`data-color-theme="contrast"`). That axis only recolors status/severity badges and condition cells — see [design-system §1.2 / §6](../design-system.md#12-axis-b--colorthemeprovider-default-vs-contrast-real-user-facing).
- **Gradient canvas:** charts render inside opaque `Surface` / `PortalSurface` panels (`bg-[#050505]`), which sit on the fixed gradient background introduced in `bd3d959` ([`app-shell.tsx:519-524`](../../../src/app/components/app-shell.tsx#L519)). Chart panels therefore need **no** text drop-shadows; only canvas-level text (page headers, KPI tiles) does. See [design-system §4.3](../design-system.md#43-gradient-canvas-commit-bd3d959--and-the-text-shadow-rule-it-forced).
- **⚠️ Known violation:** four raw inline `contentStyle` literals duplicate `DASHBOARD_CHART_TOOLTIP` byte-for-byte — [`statistics-page.tsx:848`](../../../src/app/pages/statistics-page.tsx#L848), [`:876`](../../../src/app/pages/statistics-page.tsx#L876), [`:912`](../../../src/app/pages/statistics-page.tsx#L912) and [`campaigns-page.tsx:887`](../../../src/app/pages/campaigns-page.tsx#L887). Replace them with the import when next touching those files. Do not add a fourth tooltip config.

## Contents

1. [Client Dashboard charts](#1-client-dashboard-charts)
2. [Client Statistics charts](#2-client-statistics-charts)
3. [Client Campaigns charts](#3-client-campaigns-charts)
4. [Manager Dashboard charts](#4-manager-dashboard-surfaces)
5. [Internal Statistics charts](#5-internal-statistics-charts)
6. [Internal Campaigns drawer chart](#6-internal-campaigns-drawer-chart)
7. [Admin Dashboard charts](#7-admin-dashboard-charts)
8. [Non-recharts visualisations](#8-non-recharts-visualisations)
9. [Trend-line overlays](#9-trend-line-overlays)

---

## 1. Client Dashboard charts

Page: [`client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx). All use `PORTAL_CHART_TOOLTIP`.

### 1.1 Daily sent

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
- **Data:** inline вЂ” group sorted timeframe-scoped `daily_stats` by month, sum `mql_count`.
- **Series:** `<Bar dataKey="leadsCount" fill="#22c55e" />`
- **Empty state:** "No monthly lead data".

### 1.4 Prospects added (last 10 days)

- **Type:** `BarChart`
- **Data:** inline вЂ” consecutive-day delta of `daily_stats.prospects_count`, last 10 days.
- **Series:** `<Bar dataKey="prospectsAdded" fill="#22c55e" />`
- **Empty state:** "No prospects delta".

### 1.5 Sent count by month

- **Type:** `BarChart`
- **Data:** inline вЂ” monthly sums of timeframe-scoped `campaign_daily_stats.sent_count`.
- **Series:** `<Bar dataKey="sent" fill="#22c55e" />`
- **Empty state:** "No monthly sent data".

### 1.6 Prospects added by Month

- **Type:** `BarChart`
- **Data:** consecutive `daily_stats.prospects_count` deltas, filtered to the selected timeframe, then grouped by month.
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

Page: [`client-statistics-page.tsx`](../../../src/app/pages/client-statistics-page.tsx). `PORTAL_CHART_TOOLTIP` (via `<ChartTooltip />`). All three charts carry regression trend overlays ([§9](#9-trend-line-overlays)); trend series are computed inline at [`client-statistics-page.tsx:68-80`](../../../src/app/pages/client-statistics-page.tsx#L68).

### 2.1 Pipeline Activity

- **Type:** `LineChart` (3 lines + 3 trend lines)
- **Data:** `getPipelineActivitySeries(timeframeLeads)` → `Array<{ label, mqls, meetings, won, *_trend }>`
- **Series:**
  - `<Line dataKey="mqls"     stroke="#3b82f6" strokeWidth={2.5} />` + `mqls_trend`
  - `<Line dataKey="meetings" stroke="#8b5cf6" strokeWidth={2.5} />` + `meetings_trend`
  - `<Line dataKey="won"      stroke="#22c55e" strokeWidth={2.5} />` + `won_trend`
- **Empty state:** "No pipeline activity".

### 2.2 Daily sent (AreaChart)

- **Type:** `ComposedChart` (area + trend line)
- **Data:** `getDailySentSeries(timeframeStats)`
- **Series:** `<Area type="monotone" dataKey="sent" stroke="#22c55e" fill="#22c55e22" strokeWidth={2.5} />` + `sent_trend`
- **Empty state:** "No send volume".

### 2.3 Campaign reply rates

- **Type:** `ComposedChart` (bars + trend line)
- **Data:** `getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 8)`
- **Series:** `<Bar dataKey="replyRate" fill="#22c55e" radius={[4,4,0,0]} />` + `replyRate_trend`
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

The manager dashboard mirrors the Admin dashboard's three **campaign momentum charts** plus its tabular surfaces. Each is a **`ComposedChart`** = `Area` (raw series) + `Line` (regression trend), rendered from the shared `MOMENTUM_CHARTS` + `DASHBOARD_CHART_TOOLTIP` config in [`dashboard-momentum.ts`](../../../src/app/lib/dashboard-momentum.ts) ([`manager-dashboard-page.tsx:352-372`](../../../src/app/pages/manager-dashboard-page.tsx#L352)). Layout: charts in the **left** column, tabular surfaces (Lead queue, watchlist, portfolio) in the **right** column. The momentum series covers the **selected timeframe** (default 30 days), not a fixed window.

- **Campaign momentum: Sent** — `Area dataKey="sent"`, stroke `#38bdf8`, fill `#38bdf822`.
- **Campaign momentum: Replies** — `Area dataKey="replies"`, stroke `#22c55e`, fill `#22c55e22`.
- **Campaign momentum: Positive** — `Area dataKey="positive"`, stroke `#f59e0b`, fill `#f59e0b22`.
  - **Trend overlay:** `<Line dataKey={`${chart.key}_trend`} stroke={chart.stroke} strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false} />` ([`manager-dashboard-page.tsx:367`](../../../src/app/pages/manager-dashboard-page.tsx#L367)). The `*_trend` keys are appended by `formatMomentumSeries()` ([`dashboard-momentum.ts:89-101`](../../../src/app/lib/dashboard-momentum.ts#L89)). See [§9](#9-trend-line-overlays).
  - **Data:** server `campaignMomentum21d` (daily series from `campaign_daily_stats` joined to scoped + status-filtered campaigns). Same shape as [§7 Admin momentum](#7-admin-dashboard-charts). Each maps to `{ date, label, sent, replies, positive, *_trend }`; empty → `EmptyState`.

Tabular surfaces (no recharts):

- Lead queue — clickable cards opening the editable lead drawer (shared `LeadEditForm` + `LeadConversation` + `LeadMetaSection`).
- Campaign watchlist — tabular.
- Assigned client portfolio — tabular with inline KPI progress (HTML, not recharts), see [06 §1.4](./06-manager-portal.md#14-assigned-client-portfolio-surface).

Both chart sets and the watchlist/portfolio/momentum respond to the dashboard's **client** and **campaign-status** filters.

---

## 5. Internal Statistics charts

Page: [`statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx). Uses **inline copies** of the `DASHBOARD_CHART_TOOLTIP` style rather than the import — see the shared-config warning above. Trend series computed at [`statistics-page.tsx:402-404`](../../../src/app/pages/statistics-page.tsx#L402).

### 5.1 Sent volume

- **Type:** `ComposedChart` (1 line + trend line)
- **Data:** inline aggregation by normalized `report_date` (`YYYY-MM-DD`) -> `{ date, label, sent, replies, bounces }`. With no campaign selected, `sent`/`replies`/`bounces` come from client-level `daily_stats` (`emails_sent`, `response_count`, `bounce_count`) so the aggregate charts use the wider 180-day daily-stat coverage. When a campaign is selected, the chart falls back to campaign-level `campaign_daily_stats` for all series.
- **Coverage note:** preset/custom ranges are rendered as calendar-day series with zero-filled days when no source row exists, so the chart axis reflects the selected timeframe. The previous coverage banner is no longer rendered.
- **Series:**
  - `<Line dataKey="sent"    stroke="#38bdf8" strokeWidth={2.5} dot={false} />`
  - `<Line dataKey="sent_trend" stroke="#38bdf8" … />` ([`statistics-page.tsx:853`](../../../src/app/pages/statistics-page.tsx#L853))
- **Empty state:** "No send data yet".

### 5.2 Replies & bounces

- **Type:** `ComposedChart` (2 lines + 2 trend lines)
- **Data:** same zero-filled daily aggregate as [§5.1](#51-sent-volume).
- **Series:**
  - `<Line dataKey="replies" stroke="#22c55e" strokeWidth={2.5} dot={false} />` + `replies_trend`
  - `<Line dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} />` + `bounces_trend`
- **Empty state:** "No signal data yet".

### 5.3 Lead qualification mix

- **Type:** `PieChart` (compact donut; `innerRadius={54}`, `outerRadius={88}`) with a numeric breakdown list beside it. Admin roles also see a manager lead breakdown list inside the same panel.
- **Data:** inline — group `filteredLeads` by `qualification`, `{name, value}`. Manager breakdown groups the same `filteredLeads` by `clients.manager_id` and shows total leads, MQL, preMQL, and unqualified counts.
- **Colors:** cycle through `PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"]`.
- **Empty state:** "No leads available".

### 5.4 Manager breakdown

Admin-only tabular/card surface grouped by manager, including `master_admin`. Not a recharts graph; listed here because it is an analytics visualization. Rows show clients, campaigns, sent, replies, leads, and reply rate in the current filter scope. Delivery totals use `daily_stats` when no campaign is selected, and `campaign_daily_stats` when a campaign filter is active.

### 5.5 Campaign portfolio grid

Interactive grouped grid of clickable cards. Not a chart; listed here because it drives the campaign filter and selected campaign details. The grid is filtered to campaigns with activity in the selected timeframe, is searchable, grouped by client, renders 12 client groups at a time, and shows up to 12 campaign cards per client group before asking the user to narrow with search.

---

## 6. Internal Campaigns drawer chart

Page: [`campaigns-page.tsx`](../../../src/app/pages/campaigns-page.tsx).

### 6.1 Campaign performance drawer chart

- **Type:** `LineChart` (4 series: `sent`, `replies`, `opens`, `bounces`) вЂ” identical configuration to Client Campaigns daily volume chart [В§3.1](#31-daily-campaign-volume-id-cc-daily-volume).
- **Data:** `campaign_daily_stats` for the selected campaign over the page's timeframe, mapped to `{ label, sent, replies, opens, bounces }`.
- **Empty state:** "No daily performance yet".

---

## 7. Admin Dashboard charts

Page: [`admin-dashboard-page.tsx`](../../../src/app/pages/admin-dashboard-page.tsx). Uses the imported `DASHBOARD_CHART_TOOLTIP` + `MOMENTUM_CHARTS`. Every chart here is a `ComposedChart`/`LineChart` with a regression trend overlay ([§9](#9-trend-line-overlays)).

### 7.1 Campaign momentum: Sent

- **Type:** `ComposedChart` (area + trend line) — [`admin-dashboard-page.tsx:136-143`](../../../src/app/pages/admin-dashboard-page.tsx#L136)
- **Data:** server `campaignMomentum21d` → `formatMomentumSeries()` → `{ date, label, sent, replies, positive, *_trend }`.
- **Series:** `<Area type="monotone" dataKey="sent" stroke="#38bdf8" fill="#38bdf822" strokeWidth={2} />` + `sent_trend`
- **Hard-coded 21-day window.**

### 7.2 Campaign momentum: Replies

- **Type:** `ComposedChart` (area + trend line)
- **Data:** same grouped 21-day dataset.
- **Series:** `<Area type="monotone" dataKey="replies" stroke="#22c55e" fill="#22c55e22" strokeWidth={2} />` + `replies_trend`

### 7.3 Campaign momentum: Positive

- **Type:** `ComposedChart` (area + trend line)
- **Data:** same grouped 21-day dataset.
- **Series:** `<Area type="monotone" dataKey="positive" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={2} />` + `positive_trend`

### 7.4 Daily count of clients with ≥ 1 new lead

- **Type:** `LineChart` (1 line + trend line) — [`admin-dashboard-page.tsx:157-167`](../../../src/app/pages/admin-dashboard-page.tsx#L157)
- **Data:** `formatCountSeries()` over the 21-day clients-with-leads series → `{ date, label, count, count_trend }`.
- **Series:** `<Line dataKey="count" stroke="#22c55e" strokeWidth={2} dot={false} />` + `count_trend`
- **Y:** `allowDecimals={false}`.
- **Empty state:** "No lead data".

### 7.5 Daily count of Active-status clients with ≥ 1 email sent

- **Type:** `LineChart` (1 line + trend line) — [`admin-dashboard-page.tsx:179-189`](../../../src/app/pages/admin-dashboard-page.tsx#L179)
- **Data:** `formatCountSeries()` over the 21-day active-clients-sending series.
- **Series:** `<Line dataKey="count" stroke="#38bdf8" strokeWidth={2} dot={false} />` + `count_trend`
- **Empty state:** "No send data".

### 7.6 Manager capacity

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

## 9. Trend-line overlays

Every time-series chart on the Admin dashboard, Manager dashboard, Internal Statistics, and Client Statistics renders a **least-squares linear-regression trend line** on top of its raw series.

- **Math:** `linearRegression(values: number[]): number[]` — [`dashboard-momentum.ts:6-16`](../../../src/app/lib/dashboard-momentum.ts#L6). Ordinary least squares over the point index; results clamped to `≥ 0`. Series shorter than 2 points are returned unchanged.
- **Series builders:**
  - `formatMomentumSeries()` — appends `sent_trend` / `replies_trend` / `positive_trend` ([`dashboard-momentum.ts:89-101`](../../../src/app/lib/dashboard-momentum.ts#L89)).
  - `formatCountSeries()` — appends `count_trend` ([`dashboard-momentum.ts:109-117`](../../../src/app/lib/dashboard-momentum.ts#L109)).
  - Client Statistics computes its own inline ([`client-statistics-page.tsx:68-80`](../../../src/app/pages/client-statistics-page.tsx#L68)); Internal Statistics likewise ([`statistics-page.tsx:402-404`](../../../src/app/pages/statistics-page.tsx#L402)) — both call the shared `linearRegression`.
- **Canonical render props:**
  ```tsx
  <Line type="monotone" dataKey={`${chart.key}_trend`} stroke={chart.stroke}
        strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5}
        dot={false} activeDot={false} />          // + legendType="none" where a legend exists
  ```
- **Consequence:** adding a trend line turns an `AreaChart`/`BarChart` into a `ComposedChart`. That is why the momentum charts are `ComposedChart`s despite being described as "area" charts.

| Chart | Trend keys | Site |
|---|---|---|
| Admin momentum ×3 | `sent_trend`, `replies_trend`, `positive_trend` | [`admin-dashboard-page.tsx:142`](../../../src/app/pages/admin-dashboard-page.tsx#L142) |
| Admin clients-with-leads | `count_trend` | [`admin-dashboard-page.tsx:165`](../../../src/app/pages/admin-dashboard-page.tsx#L165) |
| Admin active-clients-sending | `count_trend` | [`admin-dashboard-page.tsx:187`](../../../src/app/pages/admin-dashboard-page.tsx#L187) |
| Manager momentum ×3 | `${chart.key}_trend` | [`manager-dashboard-page.tsx:367`](../../../src/app/pages/manager-dashboard-page.tsx#L367) |
| Internal Statistics — sent | `sent_trend` | [`statistics-page.tsx:853`](../../../src/app/pages/statistics-page.tsx#L853) |
| Internal Statistics — replies / bounces | `replies_trend`, `bounces_trend` | [`statistics-page.tsx:881,883`](../../../src/app/pages/statistics-page.tsx#L881) |
| Client Statistics — pipeline activity | `mqls_trend`, `meetings_trend`, `won_trend` | [`client-statistics-page.tsx:133-137`](../../../src/app/pages/client-statistics-page.tsx#L133) |
| Client Statistics — daily sent | `sent_trend` | [`client-statistics-page.tsx:158`](../../../src/app/pages/client-statistics-page.tsx#L158) |
| Client Statistics — campaign reply rates | `replyRate_trend` | [`client-statistics-page.tsx:183`](../../../src/app/pages/client-statistics-page.tsx#L183) |

Charts **without** trend overlays: all Client Dashboard charts (§1), Client Campaigns (§3), the internal Campaigns drawer chart (§6), and the qualification donut (§5.3).

---

## Tooltip cheat sheet

Three configs exist. Two are exported; the third is a duplication defect.

| Context | Config | Background | Border | Radius | Extra |
|---------|--------|-----------|--------|--------|-------|
| Client portal | `PORTAL_CHART_TOOLTIP` — [`portal-ui.tsx:16`](../../../src/app/components/portal-ui.tsx#L16) | `#080808` | `#242424` | 12px | label `#a3a3a3`, item `#f5f5f5`; `cursor={false}` applied by the `<ChartTooltip />` wrapper |
| Admin + Manager dashboards | `DASHBOARD_CHART_TOOLTIP` — [`dashboard-momentum.ts:25`](../../../src/app/lib/dashboard-momentum.ts#L25) | `rgba(2,6,23,0.98)` | `rgba(148,163,184,0.2)` | 16px | `cursor: false`, label `rgba(226,232,240,0.92)`, item `#f8fafc` |
| ⚠️ Internal Statistics + Campaigns drawer | **inline `contentStyle` literals** — [`statistics-page.tsx:848`](../../../src/app/pages/statistics-page.tsx#L848), [`:876`](../../../src/app/pages/statistics-page.tsx#L876), [`:912`](../../../src/app/pages/statistics-page.tsx#L912), [`campaigns-page.tsx:887`](../../../src/app/pages/campaigns-page.tsx#L887) | same as above | same | same | **Duplicates `DASHBOARD_CHART_TOOLTIP` verbatim. Consolidate to the import; do not add a fourth config.** |

Applied via the `contentStyle`, `labelStyle`, `itemStyle` props on `<Tooltip>`.

Chart colors are **not** affected by the `data-color-theme="contrast"` axis — see [design-system §1.2](../design-system.md#12-axis-b--colorthemeprovider-default-vs-contrast-real-user-facing). Full palette and token reference: [design-system §8](../design-system.md#8-charts).

Next: [09 · Mutations & RLS](./09-mutations-rls.md).

