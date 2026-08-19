# 04 В· Metrics Catalog

Every metric shown anywhere in the portal, with its formula, source columns, file:line of the computation, time window, edge-case handling, and which roles see it. When a metric is derived from `leads`, remember that lead rows never arrive as one global list: the Leads workspaces read them through the `loadLeadsList` gateway action, which **filters, sorts and paginates server-side** ([repository.ts:730](../../../src/app/data/repository.ts#L730), [orm-gateway/index.ts:1675](../../../supabase/functions/orm-gateway/index.ts#L1675)), while the dashboards receive slim lead projections inside their own page payload (ADR-0009). Timeframe filters are then applied client-side on top of the rows the page actually received.

## Contents

1. [Entry template](#1-entry-template)
2. [Client KPIs](#2-client-kpis)
3. [Conversion funnel](#3-conversion-funnel)
4. [Lead stage lifecycle](#4-lead-stage-lifecycle)
5. [Campaign performance](#5-campaign-performance)
6. [Client-dashboard time series](#6-client-dashboard-time-series)
7. [Client-dashboard sparklines](#7-client-dashboard-sparklines)
8. [DoD вЂ” Day of Day](#8-dod--day-of-day)
9. [3-DoD вЂ” three-day observation](#9-3-dod--three-day-observation)
10. [WoW вЂ” Week on Week](#10-wow--week-on-week)
11. [MoM вЂ” Month on Month](#11-mom--month-on-month)
12. [Manager-dashboard aggregates](#12-manager-dashboard-aggregates)
13. [Admin campaign momentum](#13-admin-campaign-momentum)
14. [Supporting helpers](#14-supporting-helpers)
15. [Condition-rule context metrics](#15-condition-rule-context-metrics)
16. [Public marketing counters](#16-public-marketing-counters)
17. [OOO counters](#17-ooo-counters--what-exists-and-what-does-not-adr-0015)
18. [Per-channel & Aimfox split (manager mega-table)](#18-per-channel--aimfox-split-manager-mega-table)

---

## 1. Entry template

Each metric uses:

- **Where:** UI surface(s) on which the metric appears.
- **Formula:** the math as either SQL-flavour pseudocode or inline JS.
- **Source:** table(s) and column(s) consumed.
- **File:line:** computation location.
- **Time window:** sliding / fixed / calendar / ISO-week / per-bucket.
- **Edge cases:** null, zero-denominator, rounding, precedence.
- **Visible to:** which roles can see it.

All client-side metric code lives in [`lib/client-view-models.ts`](../../../src/app/lib/client-view-models.ts) and [`lib/client-metrics.ts`](../../../src/app/lib/client-metrics.ts). Pages feed these functions with the payload their **own** hook loaded from the `orm-gateway` edge function ([ADR-0008](../../adr/0008-orm-gateway-edge-function.md), [ADR-0009](../../adr/0009-per-page-data-contracts.md)) — e.g. `useClientDashboard()` ([client-dashboard-page.tsx:193](../../../src/app/pages/client-dashboard-page.tsx#L193)), `useLeadsList()` ([`lib/use-leads.ts`](../../../src/app/lib/use-leads.ts)), `useClientsOverview()` ([clients-page.tsx:158](../../../src/app/pages/clients-page.tsx#L158)). Gateway payloads are already RLS-scoped to the caller; internal pages that mix clients (Clients, Domains, Invoices) additionally pass rows through the `scopeX` helpers in [`lib/selectors.ts`](../../../src/app/lib/selectors.ts) for UI consistency under impersonation.

---

## 2. Client KPIs

Single function `getClientKpis(clients, campaigns, leads, stats)` at [`client-view-models.ts:28-43`](../../../src/app/lib/client-view-models.ts#L28-L43):

```ts
export function getClientKpis(clients, campaigns, leads, stats) {
  const prospectsFromCampaigns = sum(campaigns.map(c => c.database_size));
  const prospectsFromClients   = sum(clients.map(c => c.prospects_added));
  return {
    mqls:       leads.filter(l => l.qualification === "MQL").length,
    meetings:   leads.filter(l => l.meeting_booked).length,
    won:        leads.filter(l => l.won).length,
    emailsSent: sum(stats.map(s => s.sent_count)),
    prospects:  prospectsFromCampaigns || prospectsFromClients,
  };
}
```

### 2.1 MQLs Delivered

- **Where:** Client Dashboard KPI tile 1 with sparkline, Client Statistics KPI tile 1. Conversion funnel stage 2.
- **Formula:** `count(leads WHERE qualification = 'MQL')`.
- **Source:** `leads.qualification`.
- **File:line:** [client-view-models.ts:37](../../../src/app/lib/client-view-models.ts#L37).
- **Time window:** the current timeframe filter on leads. Leads list itself is pre-scoped by `scopeLeads` and then filtered by the chosen timeframe (`createDefaultTimeframe()` = last 30 days, or custom range).
- **Edge cases:** a lead whose flags roll forward (e.g. `won=true` with `qualification='MQL'`) **still counts** as MQL here вЂ” `getClientKpis` reads `qualification` directly, it does not call `getLeadStage()`. Contrast with [В§4 Lead stage lifecycle](#4-lead-stage-lifecycle).
- **Visible to:** Client, Manager (manager views the same data through `scopeLeads`), Admin.

### 2.2 Meetings Booked

- **Where:** Client Dashboard KPI tile 2, Client Statistics KPI tile 2. Conversion funnel stage 3. Manager "Client portfolio" progress.
- **Formula:** `count(leads WHERE meeting_booked = true)`.
- **Source:** `leads.meeting_booked`.
- **File:line:** [client-view-models.ts:38](../../../src/app/lib/client-view-models.ts#L38).
- **Time window:** timeframe-scoped leads.
- **Edge cases:** `meeting_held=true` implies `meeting_booked=true` (business rule). The boolean is set by the manager via the lead drawer.
- **Visible to:** all roles.

### 2.3 Deals Won

- **Where:** Client Dashboard KPI tile 3, Client Statistics KPI tile 3. Conversion funnel stage 4. Manager dashboard per-client progress.
- **Formula:** `count(leads WHERE won = true)`.
- **Source:** `leads.won` (boolean).
- **File:line:** [client-view-models.ts:39](../../../src/app/lib/client-view-models.ts#L39).
- **Time window:** timeframe-scoped leads.
- **Edge cases:** `won` is set independently of `qualification`. Treated as terminal by `getLeadStage`.
- **Visible to:** all roles.

### 2.4 Emails Sent

- **Where:** Client Dashboard KPI tile 4 (compact number), Client Dashboard "Daily sent" chart, Statistics page trend lines, ClientsPage Overview "Sent" column (today).
- **Formula:** `sum(campaign_daily_stats.sent_count)` across timeframe-scoped stats.
- **Source:** `campaign_daily_stats.sent_count`.
- **File:line:** [client-view-models.ts:40](../../../src/app/lib/client-view-models.ts#L40).
- **Time window:** timeframe selector; outer bound = 90 days via `CAMPAIGN_DAILY_STATS_WINDOW_DAYS` in the snapshot loader ([repository.ts:29](../../../src/app/data/repository.ts#L29)).
- **Edge cases:** `sent_count` is `smallint` with default 0; nulls treated as 0 by `sum()` helper ([client-view-models.ts:24-26](../../../src/app/lib/client-view-models.ts#L24-L26)).
- **Visible to:** all roles (internal users see all their scoped clients, clients see their own outreach campaigns only).

### 2.5 Prospects Base

- **Where:** Client Dashboard KPI tile 5 (compact number), Client Statistics KPI tile 4.
- **Formula:** `sum(campaigns.database_size) OR sum(clients.prospects_added)` вЂ” the second term is a fallback when the first is zero/falsy (short-circuit `||` on a JS number).
- **Source:** `campaigns.database_size` preferred, `clients.prospects_added` fallback.
- **File:line:** [client-view-models.ts:34-41](../../../src/app/lib/client-view-models.ts#L34-L41).
- **Time window:** these are "base" counters вЂ” not timeframe-filtered.
- **Edge cases:** if both are zero, KPI reads `0` and all conversion-rate denominators using `prospects` collapse to `0%` labels (see В§3).
- **Visible to:** Client, Manager, Admin.

---

## 3. Conversion funnel

Function `getConversionRates(leads, prospects)` at [`client-view-models.ts:109-143`](../../../src/app/lib/client-view-models.ts#L109-L143). Returns an ordered array of four funnel stages, each with `{ label, value, from, rateLabel, color }`.

| Stage | `value` | `from` | `rateLabel` (if denominator > 0) | Color |
|-------|---------|--------|----------------------------------|-------|
| Prospects | `prospects` | `prospects` | _(empty)_ | `#3b82f6` |
| MQLs | `count(qualification='MQL')` | `prospects` | `((mqls/prospects)*100).toFixed(1) + '%'` | `#8b5cf6` |
| Meetings | `count(meeting_booked)` | `mqls` | `((meetings/mqls)*100).toFixed(1) + '%'` | `#a855f7` |
| Won | `count(won)` | `meetings` | `((won/meetings)*100).toFixed(1) + '%'` | `#22c55e` |

- **Where:** Client Dashboard "Conversion Funnel" section, Client Statistics "Conversion Funnel" section. (Rendered as HTML bar widget, not recharts.)
- **Formula:** see table.
- **Source:** `leads.qualification`, `leads.meeting_booked`, `leads.won`; `prospects` comes from В§2.5.
- **File:line:** [client-view-models.ts:109-143](../../../src/app/lib/client-view-models.ts#L109-L143).
- **Time window:** leads timeframe-scoped; `prospects` is lifetime (see В§2.5).
- **Edge cases:** when any denominator is 0, `rateLabel = "0%"` (falsy guard `prospects ?`, `mqls ?`, `meetings ?`). Values themselves remain non-negative integers.
- **Visible to:** Client; Manager/Admin see the same layout on their views that invoke this helper.

---

## 4. Lead stage lifecycle

Function `getLeadStage(lead)` at [`selectors.ts:70-77`](../../../src/app/lib/selectors.ts#L70-L77):

```ts
export function getLeadStage(lead) {
  if (lead.won)              return "won";
  if (lead.offer_sent)       return "offer_sent";
  if (lead.meeting_held)     return "meeting_held";
  if (lead.meeting_booked)   return "meeting_scheduled";
  if (!lead.qualification)   return "unqualified";
  return lead.qualification;   // "preMQL" | "MQL" | "rejected" | "OOO" | "NRR"
}
```

Precedence top-down. Produces a `PipelineStage` in the union `LeadQualification | "unqualified"`.

`PIPELINE_STAGES` (rendered list in UI) in [`client-view-models.ts:14-22`](../../../src/app/lib/client-view-models.ts#L14-L22):

| key | label | color |
|-----|-------|-------|
| preMQL | Pre-MQL | `#facc15` |
| MQL | MQL | `#3b82f6` |
| meeting_scheduled | Meeting Scheduled | `#c084fc` |
| meeting_held | Meeting Held | `#818cf8` |
| offer_sent | Offer Sent | `#f97316` |
| won | Won | `#22c55e` |
| rejected | Rejected | `#fb7185` |

Note: the list **does not include** `unqualified`, `OOO`, or `NRR`, so `getPipelineCounts` rows for those keys are dropped from the rendered pipeline visualisation. `OOO` / `NRR` qualified leads still pass through `getLeadStage` (they retain their qualification), but they are not surfaced as first-class pipeline stages in the UI.

### 4.1 Pipeline counts

`getPipelineCounts(leads)` at [`client-view-models.ts:45-56`](../../../src/app/lib/client-view-models.ts#L45-L56).

```ts
const counts = new Map();
for (const stage of PIPELINE_STAGES) counts.set(stage.key, 0);
for (const lead of leads) counts.set(getLeadStage(lead), (counts.get(getLeadStage(lead)) ?? 0) + 1);
return PIPELINE_STAGES.map(stage => ({ ...stage, count: counts.get(stage.key) ?? 0 }));
```

- **Where:** Client Dashboard pipeline visualisation, Internal Leads filter chips (with counts).
- **Time window:** timeframe-scoped leads (filter chips show counts of the *currently filtered* dataset).
- **Edge cases:** stages outside `PIPELINE_STAGES` (unqualified/OOO/NRR) are counted but their counts are not surfaced вЂ” they land in the `Map` but don't appear in the returned array.
- **Visible to:** all roles.

---

## 5. Campaign performance

`getCampaignPerformance(campaigns, stats)` at [`client-view-models.ts:90-107`](../../../src/app/lib/client-view-models.ts#L90-L107):

```ts
return campaigns.map(campaign => {
  const campaignStats = stats.filter(s => s.campaign_id === campaign.id);
  const sent    = sum(campaignStats.map(s => s.sent_count));
  const replies = sum(campaignStats.map(s => s.reply_count));
  const replyRate = sent > 0 ? (replies / sent) * 100 : 0;
  return { id, name, status, sent, replies, replyRate };
}).sort((a, b) => b.replyRate - a.replyRate);
```

### 5.1 Campaign Reply Rate

- **Where:** Client Statistics "Campaign reply rates" bar chart (top 8), Client Dashboard campaign list below conversion funnel (top 6 with threshold coloring), Client Campaigns portfolio cards, Campaigns table aggregate columns.
- **Formula:** `(replies / sent) * 100` when `sent > 0`, else `0`.
- **Source:** `campaign_daily_stats.sent_count`, `.reply_count`.
- **File:line:** [client-view-models.ts:96](../../../src/app/lib/client-view-models.ts#L96).
- **Time window:** the scoped/timeframed stats the page passes in; typically current timeframe.
- **Edge cases:** on Client Dashboard the coloring is: `>= 5%` в†’ green `#22c55e`, otherwise yellow `#facc15` ([client-dashboard-page.tsx](../../../src/app/pages/client-dashboard-page.tsx)).
- **Visible to:** all roles.

### 5.2 Campaign Sent (total)

- **Where:** Client Campaigns "Campaign sent count" bar chart (top 10), Campaign portfolio cards.
- **Formula:** `sum(campaign_daily_stats.sent_count)` per campaign.
- **Source/file:** as above, `.sent`.

### 5.3 Campaign Replies (total)

- **Formula:** `sum(campaign_daily_stats.reply_count)` per campaign. `.replies`.

### 5.4 Campaign "positive responses" (editable)

- **Where:** Internal Campaigns table column; Client Campaigns card metric. Feeds Admin momentum `positive` series ([В§13](#13-admin-campaign-momentum)) via `campaign_daily_stats.positive_replies_count`.
- **Formula:** `campaigns.positive_responses` as the editable lifetime counter; separately, `sum(campaign_daily_stats.positive_replies_count)` for the daily momentum chart.
- **Source:** `campaigns.positive_responses` (integer, user-editable); `campaign_daily_stats.positive_replies_count` (populated by ingestion).
- **Edge cases:** two distinct sources for "positive" вЂ” the table column shows the manually curated number; the chart shows the daily ingestion counter. They can diverge; this is intentional.

---

## 6. Client-dashboard time series

### 6.1 Daily sent series

`getDailySentSeries(stats)` at [`client-view-models.ts:58-70`](../../../src/app/lib/client-view-models.ts#L58-L70).

```ts
const byDate = new Map();
for (const stat of stats) byDate.set(stat.report_date, (byDate.get(stat.report_date) ?? 0) + (stat.sent_count ?? 0));
return Array.from(byDate.entries())
  .sort(([a],[b]) => a.localeCompare(b))
  .map(([date, sent]) => ({ date, label: formatDate(date, {day:"numeric", month:"short"}), sent }));
```

- **Where:** Client Dashboard "Daily sent" bar chart; Client Statistics "Daily sent" area chart.
- **Time window:** filter-timeframe-scoped `campaign_daily_stats`.
- **Edge cases:** `report_date` is treated as an opaque ISO-date string вЂ” sorting is lexicographic, which matches date order for YYYY-MM-DD.

### 6.2 Pipeline Activity series

`getPipelineActivitySeries(leads)` at [`client-view-models.ts:72-88`](../../../src/app/lib/client-view-models.ts#L72-L88):

```ts
// group by updated_at date (falls back to created_at)
for (const lead of leads) {
  const date = lead.updated_at?.slice(0,10) || lead.created_at.slice(0,10);
  const current = byDate.get(date) ?? { date, mqls:0, meetings:0, won:0 };
  if (lead.qualification === "MQL") current.mqls += 1;
  if (lead.meeting_booked)           current.meetings += 1;
  if (lead.won)                      current.won += 1;
}
```

- **Where:** Client Statistics "Pipeline Activity" line chart (3 series: `mqls`/`meetings`/`won`).
- **Edge cases:** `mqls` counts only leads currently at `qualification='MQL'`, not leads that have since progressed. Compare with В§4.1 which uses `getLeadStage`.
- **Visible to:** Client; manager/admin see comparable data via `scopeLeads`.

### 6.3 Weekly leads count (MQL) вЂ” Client Dashboard

- **Where:** Client Dashboard "Leads Count per week".
- **Formula:** group timeframe-scoped leads by ISO-week start (Monday); count `qualification === 'MQL'`.
- **File:line:** inline in [`client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx) (around lines 256-274 in the recent UI refactor).
- **Edge cases:** weeks with zero MQLs do not appear as zero bars вЂ” the mapping only writes entries for weeks that had at least one lead update.

### 6.4 Monthly leads count вЂ” Client Dashboard

- **Where:** Client Dashboard "Leads Count per month".
- **Formula:** `sum(daily_stats.mql_count)` aggregated by calendar month.
- **Source:** `daily_stats.mql_count`.
- **Note:** driven by the pre-aggregated table; **not** by the leads list. Every role that can reach this chart receives `daily_stats` in its page payload — `loadClientDashboard` returns `dailyStats` to clients too — scoped by RLS to the rows that role may see. An empty chart means no rows in the window, not a withheld table.

### 6.5 Prospects added daily вЂ” Client Dashboard

- **Where:** Client Dashboard "Prospects added" (last 10 days).
- **Formula:** delta between consecutive `daily_stats.prospects_count` entries sorted by `report_date`.
- **Source:** `daily_stats.prospects_count`.
- **Edge cases:** first day has no previous в†’ delta = 0 (skipped).

### 6.6 Sent by month вЂ” Client Dashboard

- **Where:** "Sent count by month" bar.
- **Formula:** `sum(campaign_daily_stats.sent_count)` grouped by calendar month inside the selected dashboard timeframe.

### 6.7 Prospects added by month вЂ” Client Dashboard

- **Where:** "Prospects added by Month" bar.
- **Formula:** positive consecutive-row delta of `daily_stats.prospects_count`, grouped by calendar month inside the selected dashboard timeframe. The previous row can sit outside the selected timeframe so the first visible bucket is a true delta, not the current snapshot baseline.

### 6.8 Velocity вЂ” Client Dashboard

- **Where:** "Velocity Chart" ComposedChart (Bar + Line, dual-axis).
- **Formula per week:**
  - `emailsDelta` = `sum(sent_count this week) - sum(sent_count previous week)`; color green (`#3b82f6`) if в‰Ґ 0, dark blue (`#1d4ed8`) if negative.
  - `mqls` = `count(leads with qualification='MQL' in that week)` (plotted as line on the right axis).
- **Time window:** last 8 weeks from today (ISO-week boundaries).

---

## 7. Client-dashboard sparklines

Inline SVG sparklines rendered by the `Sparkline` component in [`client-dashboard-page.tsx`](../../../src/app/pages/client-dashboard-page.tsx) (~lines 110-129). For each KPI card:

| Card | Sparkline values | Window | Color |
|------|------------------|--------|-------|
| MQLs Delivered | `[mqls per week for last 6 weeks]` | 6 ISO weeks | green `#22c55e` |
| Meetings Booked | `[meetings per week for last 6 weeks]` | 6 ISO weeks | violet `#8b5cf6` |
| Deals Won | `[won per week for last 6 weeks]` | 6 ISO weeks | amber `#f59e0b` |
| Emails Sent | `[sent_count per day for last 7 days]` | 7 days | blue `#38bdf8` |
| Prospects | `[prospects_count per month for last 7 months]` | 7 months | indigo `#818cf8` |

Trend arrow below the card uses `toPercentChange(current, previous)` (inline helper ~lines 73-79). Displays `в†‘ X%` / `в†“ X%`; `null` when no previous period is available, in which case the arrow hides. `previous` is computed via `makePreviousRange(timeframe)` from [`timeframe.ts`](../../../src/app/lib/timeframe.ts).

---

## 8. DoD вЂ” Day of Day

Aggregations live in `createClientMetrics()` at [`client-metrics.ts:248-339`](../../../src/app/lib/client-metrics.ts#L248-L339). Input: `DailyStatRecord[]`, `LeadRecord[]`. The input is already timeframe-scoped by the caller; DoD uses absolute today-offsets instead of the timeframe window.

`today` is normalised to noon (`setHours(12, 0, 0, 0)`) to dodge DST issues around midnight. All day keys are derived via `toDateKey(date)` = `YYYY-MM-DD` local.

### DoD rows вЂ” [client-metrics.ts:258-266](../../../src/app/lib/client-metrics.ts#L258-L266)

```ts
const dodRows: DodRow[] = [
  { bucket: "+2", schedule: todayDaily.scheduleDayAfter, sent: null },
  { bucket: "+1", schedule: todayDaily.scheduleTomorrow, sent: null },
  { bucket:  "0", schedule: todayDaily.scheduleToday,    sent: valueByDayOffset(..., 0, i => i.emailsSent) },
  { bucket: "-1", schedule: null,                         sent: valueByDayOffset(..., 1, вЂ¦) },
  { bucket: "-2", schedule: null,                         sent: valueByDayOffset(..., 2, вЂ¦) },
  { bucket: "-3", schedule: null,                         sent: valueByDayOffset(..., 3, вЂ¦) },
  { bucket: "-4", schedule: null,                         sent: valueByDayOffset(..., 4, вЂ¦) },
];
```

### 8.1 Schedule +2 / +1 / 0

- **Where:** Manager/Admin ClientsPage "DoD" tab, `ClientMetricsOverview.scheduleDayAfter/scheduleTomorrow/scheduleToday`.
- **Formula:** `sum(daily_stats.schedule_day_after / schedule_tomorrow / schedule_today)` for today's row.
- **Source:** columns same-named.
- **Time window:** today's `daily_stats` row only.
- **Edge cases:** if no row for today, `todayDaily = createDailyAggregate()` with all zeros.
- **Visible to:** manager, admin.

### 8.2 Emails sent DoD (bucket 0 / -1 / -2 / -3 / -4)

- **Formula:** `sum(daily_stats.emails_sent)` for the specific day calendar-offset from today.
- **Source:** `daily_stats.emails_sent`.
- **Helper:** `valueByDayOffset(entriesByDate, today, offset, getter)` at [client-metrics.ts:235-246](../../../src/app/lib/client-metrics.ts#L235-L246).
- **Time window:** single-day buckets.
- **Edge cases:** missing day в†’ 0 (not null); bucket "0" = today, "-1" = yesterday, etc.
- **Visible to:** manager, admin. `sentToday/sentYesterday/sentTwoDaysAgo` surfaced on `ClientMetricsOverview`.

---

## 9. 3-DoD вЂ” three-day observation

Rows at [client-metrics.ts:268-272](../../../src/app/lib/client-metrics.ts#L268-L272):

```ts
const threeDodRows = [0,1,2,3,4].map(offset => ({
  bucket: offset === 0 ? "0" : `-${offset}`,
  totalLeads: valueByDayOffset(leadByDate, today, offset, i => i.threeDodTotal),
  sqlLeads:   valueByDayOffset(leadByDate, today, offset, i => i.sql),
}));
```

Leads per day are aggregated at [client-metrics.ts:178-214](../../../src/app/lib/client-metrics.ts#L178-L214):

```ts
const qualification = lead.qualification?.toLowerCase();
if (qualification === "mql")    { target.sql += 1; target.threeDodTotal += 1; }
if (qualification === "premql") { target.threeDodTotal += 1; }
if (lead.meeting_booked)         target.meetings += 1;
if (lead.won)                    target.won += 1;
```

### 9.1 3-DoD Total Leads

- **Where:** ClientsPage "3-DoD" tab, and `ClientMetricsOverview.threeDodTotal` (sum of buckets 0/-1/-2 only, lines 312-313).
- **Formula per bucket:** `count(leads created that day WHERE qualification IN ('preMQL','MQL'))`.
- **Source:** `leads.created_at`, `leads.qualification`.
- **Time window:** single calendar days; the overview aggregate sums the last 3 buckets (today + yesterday + day before).
- **Edge cases:** qualification comparison is **case-insensitive** (`toLowerCase()` then equality with `"mql"` / `"premql"`). The stored values `MQL` / `preMQL` therefore match.

### 9.2 3-DoD SQL Leads

- **Where:** ClientsPage "3-DoD" tab, `ClientMetricsOverview.threeDodSql`.
- **Formula per bucket:** `count(leads created that day WHERE qualification = 'MQL')`.
- **Note:** "SQL" here means Sales Qualified Lead, equivalent to MQL in this product's naming.

---

## 10. WoW вЂ” Week on Week

Rows at [client-metrics.ts:274-296](../../../src/app/lib/client-metrics.ts#L274-L296). Week boundaries via `startOfWeek()` (Monday-start ISO week) at [client-metrics.ts:104-110](../../../src/app/lib/client-metrics.ts#L104-L110).

For each of 4 buckets (`"0", "-1", "-2", "-3"`):

```ts
const start = addDays(currentWeekStart, -7 * offset);
const end   = addDays(start, 6);

const sent     = sumInRange(dailyByDate.values(), start, end, i => i.emailsSent);
const human    = sumInRange(dailyByDate.values(), start, end, i => i.humanRepliesCount);
const bounce   = sumInRange(dailyByDate.values(), start, end, i => i.bounceCount);
const ooo      = sumInRange(dailyByDate.values(), start, end, i => i.oooCount);
const negative = sumInRange(dailyByDate.values(), start, end, i => i.negativeCount);

return {
  bucket,
  totalLeads:   sumInRange(leadByDate.values(), start, end, i => i.all),
  sqlLeads:     sumInRange(leadByDate.values(), start, end, i => i.sql),
  responseRate: toRate(human + ooo, sent),
  humanRate:    toRate(human,       sent),
  bounceRate:   toRate(bounce,   sent),
  oooRate:      toRate(ooo,      sent),
  negativeRate: toRate(negative, sent),
};
```

`toRate(numerator, denominator)` at [client-metrics.ts:230-233](../../../src/app/lib/client-metrics.ts#L230-L233) returns `null` when `denominator <= 0`.

> **The block above is the raw path, which nothing renders.** `ClientsPage` loads a pre-bucketed
> server summary and builds its rows in `createClientMetricsFromSummary()`
> ([client-metrics.ts:436-462](../../../src/app/lib/client-metrics.ts#L436-L462)); the condition
> context reads that same pack. `createClientMetrics()` has no production caller and survives for
> tests. Both paths compute `responseRate` the same way — `response_count` is read by neither.

### 10.1 WoW Total Leads

- **Formula:** `count(leads created in week)`.
- **Source:** `leads.created_at`, `leads.qualification` (LeadAggregate.all counts every lead regardless of qualification).
- **What `created_at` means:** since
  [20260727](../../../supabase/migrations/20260727_promote_contact_lead_cast_and_date.sql) it is the
  originating **reply's `received_at`** — the day the prospect answered. Before that it defaulted to
  `now()`, i.e. the moment n8n happened to run, so a delayed or replayed run moved leads between
  weeks. Rows created before that migration keep the old semantics and are not comparable
  bucket-for-bucket with CS PDCA, which counts by the client sheet's LEAD RECEIVED date.

### 10.2 WoW SQL Leads

- **Formula:** `count(leads created in week WHERE qualification='MQL')`.

### 10.3 WoW Response Rate

- **Formula:** `(sum(human_replies_count) + sum(ooo_count)) / sum(emails_sent)`, or null when zero sends.
- **Source:** `daily_stats.human_replies_count`, `daily_stats.ooo_count`, `daily_stats.emails_sent`.
- **Why not `response_count`:** this matches the CS PDCA sheet, where `AQ = AU + AY` — the human
  rate plus the OOO rate. Sheet column `F` (`Response Count`, the true per-day replied figure) is
  only the numerator for a **SmartLead** row. → [PDCA FORMULAS §3](../../../automation/sheets/pdca/FORMULAS.md#3-cs-pdca--the-metric-columns)
- **Edge case, and it is not small:** the numerator is a pair of run-time deltas of an *undated*
  lifetime total while the denominator is a true per-day value. `human + ooo` therefore routinely
  **exceeds** `response_count` — on UniTalk, every day since 2026-06-01.
  → [PDCA FORMULAS §4](../../../automation/sheets/pdca/FORMULAS.md#4-defect-table)

### 10.4 WoW Human Reply Rate

- **Formula:** `sum(human_replies_count) / sum(emails_sent)`.
- **Source:** `daily_stats.human_replies_count`.
- **Use:** excludes automated/OOO/bounce replies вЂ” the "quality" signal.
- **Caveat:** `human_replies_count` is `max(lifetimeInboxTotal - yesterday's stored total, 0)`, not
  a count of replies received that day. Archiving a reply lowers the lifetime total and the clamp
  silently discards the drop.

### 10.5 WoW Bounce Rate

- **Formula:** `sum(bounce_count) / sum(emails_sent)`.

### 10.6 WoW OOO Rate

- **Formula:** `sum(ooo_count) / sum(emails_sent)`.
- **`ooo_count` is not OOO.** It is an automated-replies delta, in Supabase *and* in the sheet
  (column `X`, mislabelled "Out of Office"). Measured on UniTalk it overstates real OOO episodes
  from `ooo_followups` by ~3×.
  → [reconciliation · Problem 2](../processes/outreach/sheets-supabase-reconciliation.md#problem-2--ooo_count-is-a-mislabelled-copy)
- **Accepted deviation, decided 2026-07-27 (review by 2026-10-31):** kept aligned with CS PDCA
  rather than corrected, because the two surfaces are compared by eye daily and fixing one side
  alone would make them disagree — wrong-but-identical beats wrong-and-divergent while the sheet is
  still the operational surface. The correction is scheduled for a branch and lands when the team
  moves onto the portal. Real OOO comes from `replies.classification` (or `ooo_followups`), never
  from `replies.is_automated_reply`, which is unpopulated. Nothing new may be built on `ooo_count`.
  → [bison-daily-stats-process · Accepted deviation](../../../automation/n8n/workflows/ingestion/bison-daily-stats-process/README.md#accepted-deviation--ooo_count-decided-2026-07-27-review-by-2026-10-31)

### 10.7 WoW Negative Rate

- **Formula:** `sum(negative_count) / sum(emails_sent)`.

Visible to manager and admin in ClientsPage "WoW" tab. The current week bucket ("0") is also surfaced on `ClientMetricsOverview.wowResponseRate/wowHumanRate/wowBounceRate/wowOooRate/wowSql`.

---

## 11. MoM вЂ” Month on Month

Rows at [client-metrics.ts:298-310](../../../src/app/lib/client-metrics.ts#L298-L310). Calendar-month boundaries via `shiftMonthStart` / `endOfMonth` ([lines 119-125](../../../src/app/lib/client-metrics.ts#L119-L125)).

```ts
const momRows = [0,1,2,3].map(offset => {
  const start = shiftMonthStart(currentMonthStart, -offset);
  const end   = endOfMonth(start);
  return {
    bucket: offset === 0 ? "0" : `-${offset}`,
    totalLeads: sumInRange(leadByDate.values(), start, end, i => i.all),
    sqlLeads:   sumInRange(leadByDate.values(), start, end, i => i.sql),
    meetings:   sumInRange(leadByDate.values(), start, end, i => i.meetings),
    won:        sumInRange(leadByDate.values(), start, end, i => i.won),
  };
});
```

### 11.1 MoM Total Leads

- **Formula:** `count(leads created in calendar month)`.

### 11.2 MoM SQL Leads

- **Formula:** `count(leads WHERE qualification='MQL', created in month)`. Also surfaced as `ClientMetricsOverview.momSql` for bucket "0".

### 11.3 MoM Meetings

- **Formula:** `count(leads WHERE meeting_booked=true, created in month)`.
- **Note:** "created in month" вЂ” not the month the meeting was booked. For practical purposes leads whose meetings are booked shortly after they are created are counted in the creation month.

### 11.4 MoM Won

- **Formula:** `count(leads WHERE won=true, created in month)`.

Visible to manager and admin in ClientsPage "MoM" tab.

---

## 12. Manager-dashboard aggregates

Computed **server-side** in the `loadManagerDashboardOverview` handler of [`orm-gateway/index.ts`](../../../supabase/functions/orm-gateway/index.ts); the page ([`manager-dashboard-page.tsx`](../../../src/app/pages/manager-dashboard-page.tsx)) only derives the MQL / preMQL split and KPI-progress ratios from the returned facts.

**Filters (all optional, passed to the gateway):** `clientId` scopes the whole dashboard to one client; `campaignStatus` (default `active`, `all` disables) restricts the campaign-based surfaces (campaigns metric, watchlist, momentum); `dateFrom`/`dateTo` (ISO `YYYY-MM-DD`, default = last 30 days) scope all period-sensitive facts — leads by `created_at` (pipeline split, portfolio MQL/won, lead queue) and `campaign_daily_stats` by `report_date` (momentum, watchlist). `Assigned clients` and the campaign count stay structural. The page re-fetches on any filter change with a `loadIdRef` stale guard. `filterClients` (all manager clients, unfiltered) populates the client dropdown.

> **Why date bounds live inside `COUNT(CASE …)` for the portfolio query:** the portfolio LEFT JOINs leads; a `WHERE l.created_at …` would drop clients with zero in-range leads. Putting the bound inside the CASE (and in the watchlist's JOIN `ON`) keeps every scoped client/campaign while counting only in-range activity.

### 12.1 Assigned clients

- **Formula:** `COUNT(*)` over the scoped clients subquery (`manager_id = managerId`, optionally `AND id = clientId`).
- **Source:** `clients.manager_id`.

### 12.2 Campaigns (status-filtered)

- **Formula:** `COUNT(campaigns WHERE client_id IN scopedClients [AND status = campaignStatus])`.
- **Source:** `campaigns.status`. Card label reflects the active status filter (e.g. "Active campaigns", "Stopped campaigns").

### 12.3 MQLs / preMQLs split <a id="123-mqls-premqls-split"></a>

- **Source:** server returns `pipelineGroups` (raw `qualification`/`meeting_booked`/`meeting_held`/`offer_sent`/`won` combinations + count) for the scoped leads. The page applies `getLeadStage` to each group (same as the Admin dashboard) and accumulates:
  - **MQLs** = leads whose resolved stage is `MQL`. Hint shows `beyondMql` (leads moved past MQL).
  - **preMQLs** = leads whose resolved stage is `preMQL`. Hint shows `unqualified` (leads with no qualification yet).
- **Why:** replaces the former single "Leads in progress" card. The split mirrors the Admin dashboard and surfaces qualification health at a glance. **Unclassified replies** (former card 4) was removed — reply classification is owned by n8n and there is no portal triage UI ([decision](../../BUSINESS_LOGIC.md#decision-2026-04-25-no-reply-triage-ui)).

### 12.4 Per-client KPI progress

For each scoped client (server `clientPortfolio` rows):

- `campaignsCount` = `count(campaigns WHERE client_id = client.id)`.
- `mqls` = `count(leads WHERE client_id = client.id AND qualification='MQL')`.
- `won`  = `count(leads WHERE client_id = client.id AND won=true)`.
- Progress ratio (page-derived): `mqls / client.kpi_leads` (target from `clients.kpi_leads`).

### 12.5 Campaign watchlist

Server returns scoped campaigns (status-filtered) with total `sent`/`reply` from `campaign_daily_stats`. The page keeps campaigns that are non-`active` **or** have reply rate `< 1%`, sorts by reply rate ascending, slices to 8.

### 12.6 Campaign momentum (Sent / Replies / Positive)

Daily series over the **selected timeframe** (the picker defaults to the current month; the server falls back to 21 days only if no range is sent at all) from `campaign_daily_stats` joined to scoped + status-filtered campaigns, grouped by `report_date`: `sent = SUM(sent_count)`, `replies = SUM(reply_count)`, `positive = SUM(positive_replies_count)`. Same payload shape as the Admin dashboard `campaignMomentum21d` (which stays fixed at 21 days). See [08 §4](./08-charts-catalog.md#4-manager-dashboard-surfaces).

### 12.7 Internal Statistics summary and manager breakdown

Inline in [`statistics-page.tsx`](../../../src/app/pages/statistics-page.tsx).

- **Where:** Manager/Admin Analytics (`/manager/statistics`, `/admin/statistics`).
- **Formula:** after role scoping, timeframe filtering, and optional manager/client/campaign filters:
  - `Sent` = `sum(daily_stats.emails_sent)` when no campaign is selected; `sum(campaign_daily_stats.sent_count)` when a campaign filter is active or no `daily_stats` rows are visible.
  - `Replies` = `sum(daily_stats.response_count)` when no campaign is selected; `sum(campaign_daily_stats.reply_count)` when a campaign filter is active or no `daily_stats` rows are visible.
  - `Bounces` = `sum(daily_stats.bounce_count)` when no campaign is selected; `sum(campaign_daily_stats.bounce_count)` when a campaign filter is active or no `daily_stats` rows are visible.
  - `Reply rate` = `Replies / Sent * 100`, or `0` when sent is zero.
  - `Bounce rate` = `Bounces / Sent * 100`, or `0` when sent is zero.
  - `Leads` = count of filtered `leads`.
  - `Campaigns` = count of filtered visible campaigns.
- **Manager breakdown:** admin/super-admin/master-admin only, grouped by `clients.manager_id`; the standalone manager surface shows assigned clients, campaigns, sent, replies, leads, and reply rate in the current filter scope. Delivery totals use the same `daily_stats`-first rule as the KPI cards. The Lead qualification panel also shows a compact manager lead list with total leads plus MQL/preMQL/unqualified counts.
- **Time window:** selected `DateRangeButton` timeframe; presets are anchored to the latest visible analytics date in the current snapshot instead of the browser clock, so stale or backfilled datasets still make "Last 7/30/90 Days" meaningful. `daily_stats` is capped by the 180-day snapshot window; `campaign_daily_stats` is capped by the 90-day snapshot window.
- **Edge cases:** chart buckets normalize `report_date` to `YYYY-MM-DD`. For bounded presets/custom ranges, missing calendar days are rendered as zero-value points. This prevents repeated X-axis labels and avoids aggregate charts collapsing to a few days when `campaign_daily_stats` is sparse but `daily_stats` has full daily coverage. The UI no longer renders a coverage banner. The campaign count/list only includes campaigns with stat activity inside the selected timeframe unless a specific campaign is selected.
- **Visible to:** manager sees own scoped summary; admin roles see global summary plus manager breakdown/filter.

---

## 13. Admin campaign momentum

Charts are driven inline in [`admin-dashboard-page.tsx`](../../../src/app/pages/admin-dashboard-page.tsx) (`campaignSeries`), using one grouped 21-day dataset.

```ts
// Aggregate scoped campaign_daily_stats across the LAST 21 DAYS, grouping by report_date
for (const stat of scopedCampaignStats) {
  byDate.get(stat.report_date) += sent / reply / positive_replies counts;
}
```

Output: `Array<{ date, label, sent, replies, positive }>`.

### 13.1 Campaign momentum: Sent

- **Where:** Admin Dashboard `Campaign momentum: Sent` area chart.
- **Formula per day:** `sum(campaign_daily_stats.sent_count)` over all admin-visible campaigns that day.
- **Source:** `campaign_daily_stats.sent_count`.
- **Time window:** fixed **21 days**.
- **Visible to:** admin, super_admin.

### 13.2 Campaign momentum: Replies

- **Where:** Admin Dashboard `Campaign momentum: Replies` area chart.
- **Formula per day:** `sum(campaign_daily_stats.reply_count)`.
- **Source:** `campaign_daily_stats.reply_count`.
- **Time window:** fixed 21 days.

### 13.3 Campaign momentum: Positive

- **Where:** Admin Dashboard `Campaign momentum: Positive` area chart.
- **Formula per day:** `sum(campaign_daily_stats.positive_replies_count)`.
- **Source:** `campaign_daily_stats.positive_replies_count`.
- **Time window:** fixed 21 days.

### 13.4 Manager capacity

- **Formula:** group scoped entities by `manager_id` -> `{ clientsCount, activeCampaignsCount, leadsCount }` per manager.
- **Source:** `users.role='manager'`, `clients.manager_id`, `campaigns`, `leads`.
- **Where:** Admin Dashboard `Manager capacity` surface.

## 14. Supporting helpers

### `sum(values)` вЂ” [client-view-models.ts:24-26](../../../src/app/lib/client-view-models.ts#L24-L26)

Sums numbers treating `null`/`undefined` as 0.

### `formatCompact(value)` вЂ” [client-view-models.ts:183-187](../../../src/app/lib/client-view-models.ts#L183-L187)

`null` / 0 в†’ `"0"`; в‰Ґ 10,000 в†’ `"XK"` (no decimals); в‰Ґ 1,000 в†’ `"X.YK"` (one decimal); otherwise delegated to `formatNumber`.

### `formatNumber`, `formatDate`, `formatMoney`, `getFullName` вЂ” [`format.ts`](../../../src/app/lib/format.ts)

`formatDate(iso, opts)` uses `Intl.DateTimeFormat`. `getFullName(first, last)` handles nulls gracefully (returns `"No name"` if both missing).

### `sumInRange`, `valueByDayOffset`, `toRate`, `parseDate`, `toDateKey`, `addDays`, `startOfWeek`, `startOfMonth`, `shiftMonthStart`, `endOfMonth`

All defined in [`client-metrics.ts`](../../../src/app/lib/client-metrics.ts). They share the convention of setting hours to 12:00 for stability across DST.

### Scope functions вЂ” [`selectors.ts`](../../../src/app/lib/selectors.ts)

- `scopeClients(identity, clients)` вЂ” role-aware client filter.
- `scopeCampaigns(identity, clients, campaigns)` вЂ” scope to visible clients, then apply `type='outreach'` for clients.
- `scopeLeads`, `scopeReplies`, `scopeCampaignStats`, `scopeDailyStats`, `scopeDomains`, `scopeInvoices` вЂ” analogous.

These are **post-RLS** client-side filters. They guarantee UI consistency when a snapshot contains rows a role shouldn't see (e.g. during impersonation); they are not a security boundary.
---

## 15. Condition-rule context metrics

Runtime mapping for dynamic condition rules is built in `buildClientConditionContext(...)` (`src/app/lib/conditions/client-condition-context.ts`) and consumed by the `ClientsPage` condition engine.

### 15.1 Primary context keys

| Context key | Source |
|------------|--------|
| `prospects_added` | `latestProspectsCount \|\| clients.prospects_added` ([client-condition-context.ts:170](../../../src/app/lib/conditions/client-condition-context.ts#L170)) — see the warning below |
| `prospects_signed` | `clients.prospects_signed` |
| `inboxes` | `clients.inboxes_count` |
| `min_sent` | `clients.min_daily_sent` |
| `sent_today`, `sent_yesterday`, `sent_two_days_ago` | `createClientMetrics().overview` |
| `schedule_today`, `schedule_tomorrow`, `schedule_day_after` | `createClientMetrics().overview` |
| `three_dod_total`, `three_dod_sql` | `createClientMetrics().overview` |
| `wow_response_rate`, `wow_human_response_rate`, `wow_bounce_rate`, `wow_ooo_rate`, `wow_sql` | current WoW bucket (`0`) from `createClientMetrics()` |
| `wow_negative_rate` | current WoW bucket (`0`) negative rate |
| `mom_sql`, `mom_meetings`, `mom_won` | current MoM bucket (`0`) |
| `monthly_sql_kpi` | `clients.kpi_leads` |
| `monthly_meeting_kpi` | `clients.kpi_meetings` |
| `monthly_won_kpi` | `null` in current build (dependent rule seeded disabled) |
| `auto_li_api_key` | aimfox `client_sequencers.api_key` (via `ClientsOverviewPayload.clientSequencers`; was `clients.linkedin_api_key` — ADR-0012) |
| `bi_setup` | `clients.bi_setup_done` (context key only — the Bi column was removed from the grid and the drawer) |
| `cell.total_leads`, `cell.sql_leads`, `cell.bucket` | the 3-DoD row of the bucket being coloured (per-cell evaluation only) |

> **`latestProspectsCount` = `prospects_total` on the most recent day** — Bison's month-to-date lead
> count, the same fact CS PDCA shows as "Prospects Added"
> ([orm-gateway/index.ts:1655](../../../supabase/functions/orm-gateway/index.ts#L1655)).
>
> Until 2026-07-27 it was `MAX(prospects_count) FILTER (prospects_count > 0)` over 180 days. Because
> `prospects_count` is a *derived day-delta* of that cumulative, a single failed Bison fetch — which
> writes 0 instead of erroring — made the next day's delta equal a whole month, and `MAX()` pinned
> the spike for 180 days: UniTalk rendered **5388** (a 2026-06-08 artifact) against a true **3195**,
> ColdUnicorn PL **8905** vs **1331**, Audytel **4722** vs **1041**. The sheet was never affected —
> it reads the cumulative directly and derives no delta from it.
>
> The raw JS path still carries its own older definition
> ([client-metrics.ts:373](../../../src/app/lib/client-metrics.ts#L373)), newest non-zero
> `prospects_count` by `report_date`. It has no production caller, and `DailyStatRecord` does not
> carry `prospects_total`, so aligning it means widening the wire format for a test-only path — left
> alone deliberately, and noted here so the next reader does not mistake it for the live rule.
> → [PDCA FORMULAS §4, defects 5–6](../../../automation/sheets/pdca/FORMULAS.md#4-defect-table)

### 15.2 DoD dynamic bucket evaluation

DoD condition checks do not hardcode per-column comparisons. Each DoD schedule/sent cell injects a runtime `value` and evaluates the shared rule key (`dod_sent_or_schedule_vs_min_sent`) with dynamic column keys (`dod:{bucket}:{schedule|sent}`).

### 15.3 Legacy-rate parity keys

For parity with CS PDCA sheet behavior, the WoW response/human/OOO rules preserve green branches for very low rates (`<0.10%`) and record this in seeded `notes`. See [14 · Condition rules](./14-condition-rules.md#10-known-legacy-quirks).

---

## 16. Public marketing counters

The only metric in this catalogue that is **not** computed in TypeScript and **not** scoped to a
signed-in user. Computed entirely in Postgres by `public.public_lead_stats()`
([migration `20260721_public_lead_stats_rpc.sql`](../../../supabase/migrations/20260721_public_lead_stats_rpc.sql),
[ADR-0014](../../adr/0014-public-marketing-stats-rpc.md)) and served to the agency's Webflow site as
a PostgREST RPC.

### 16.1 Leads received (yesterday / 7d / 30d / 90d / all time)

- **Where:** the public marketing website. Not rendered anywhere in the portal.
- **Formula:** `count(leads)` per window, excluding only `rejected`:

  ```sql
  qualification IS DISTINCT FROM 'rejected'
  ```

  > Simplified by `20260722z` (2026-07-22). The old predicate also excluded OOO/NRR via
  > `contact_disposition` and a legacy `qualification` fallback; those are gone — OOO/NRR contacts are
  > no longer `leads` at all (ADR-0015), and the column + enum values were dropped.

- **Source:** `leads.created_at`, `leads.qualification`.
- **File:line:** the SQL is the single implementation — see the `public_lead_stats()` body in
  [`20260722z`](../../../supabase/migrations/20260722z_drop_legacy_ooo_columns.sql). No TS duplication
  remains (`deriveContactDisposition` was deleted with the disposition model).
- **Time window:** anchored to UTC midnight (same convention as `isoDaysAgo()`,
  [orm-gateway/index.ts:117](../../../supabase/functions/orm-gateway/index.ts#L117)).
  `yesterday` = the previous whole UTC day, half-open `[midnight-1d, midnight)`. `last_7_days` /
  `last_30_days` / `last_90_days` = `created_at >= midnight - Nd`, i.e. N whole days **plus** today
  so far, so the site's number ticks up during the day. `all_time` = every row.
- **Edge cases:** the legacy `CASE` branch must survive n8n's cutover to `contact_disposition`;
  historical rows keep `OOO`/`NRR` in `qualification` forever
  ([11-integrations §6](11-integrations.md)). Aggregation uses `count(created_at)`, not `count(*)`,
  because the query left-joins the filtered set onto a one-row bounds CTE - `count(*)` would report
  1 instead of 0 on an empty database.
- **Does NOT match any portal KPI.** `getClientKpis` counts MQLs only
  ([client-view-models.ts:37](../../../src/app/lib/client-view-models.ts#L37)); this counter
  includes preMQL and unqualified leads and is therefore larger. Expected, not a bug.
- **Visible to:** **everyone.** No authentication. This is the deliberate exception documented in
  ADR-0014.

Verified 2026-07-21 on a local copy of the production dump (4,723 leads): RPC output matched an
independently written cross-check query exactly on all five windows; an 8-row insert/rollback probe
confirmed exactly 3 of 8 synthetic leads counted (rejected, legacy OOO, legacy NRR, and both
canonical dispositions excluded); a 5-row boundary probe confirmed the half-open `yesterday` window
and the 7/30/90 day cut-offs.

---

## 17. OOO counters — what exists and what does not (ADR-0015)

There is **no outreach analytics surface in the portal**: OOO episodes are driven end-to-end by n8n,
and the portal shows no follow-up list or reply-mix dashboard (product decision, 2026-07-22). The
metrics below are therefore a definition of the underlying data, not of a rendered view.

**`daily_stats.ooo_count` is kept and is NOT a CRM metric.** It counts OOO **replies/events** the
sequencer reported for a `report_date`, written by the n8n daily UPSERT. It is never derived from
`leads.qualification`, and it does not affect the CRM lead count or preMQL→MQL conversion (spec §14).
It feeds §10.6 `wowOooRate` exactly as before.

Anything counted from `ooo_followups` answers a different question — how much open work exists right
now, accumulated over weeks — so "OOO replies today = 12" and "47 open episodes" can both be true:

| Quantity | Source |
|---|---|
| OOO replies/events per day | `daily_stats.ooo_count` |
| Active episodes (`pending`/`processing`/`failed`) | `ooo_followups`, matching `uq_ooo_followups_active` |
| Episodes handed to the sequencer | `ooo_followups.status = 'submitted'` |
| Overdue | active AND `scheduled_for < current_date` (server clock) |

Should a dashboard ever be wanted, note that these are recomputable by `GROUP BY` over raw
`replies` / `ooo_followups` rows — no stored counter is involved, so spec §16 holds by construction.

---

## 18. Per-channel & Aimfox split (manager mega-table)

The manager Clients **mega-table** ([`mega-table.tsx`](../../../src/app/pages/clients-page/mega-table.tsx))
splits the lead-count metrics of §§8–11 by outbound channel and adds a set of Aimfox (LinkedIn)
volume / acceptance / capacity columns. All of it is pre-aggregated **server-side** in the
`loadClientsMetricsSummary` handler of [`orm-gateway/index.ts`](../../../supabase/functions/orm-gateway/index.ts)
and mapped to rows by `createClientMetricsFromSummary` ([`client-metrics.ts`](../../../src/app/lib/client-metrics.ts));
the raw `createClientMetrics()` path has no sequencer dimension and leaves these fields undefined
(rendered as "—"). Bucket depth is the same 5 elements `[0, -1, -2, -3, -4]` as the blended columns.

**Channel identity** is `leads.sequencer_id` (ADR-0012): EmailBison = `…0002`, Aimfox = `…0003`.
Every existing blended column is unchanged and is now read as the **Total** series; the split adds
an **EmailBison-only** (`…_eb`) and **Aimfox-only** (`…_af`) column beside it.

### 18.1 Per-channel lead counts

- **What is split:** every lead-derived metric of the grid — 3-DoD (TOTAL + SQL), WoW (Total + SQL),
  MoM (Total + SQL + Mtg + Won). Nothing lead-derived is blended-only any more.
- **Where the split is *rendered* as its own column:** 3-DoD TOTAL/SQL, WoW Total/SQL and MoM
  Total/SQL each gain a `· EB` and a `· AF` sub-band, and those bands exist **only in the Both view**
  (§18.5). MoM Mtg / Won carry the split in the payload but have no side-by-side columns — they are
  read through the channel switch instead. Add them the day someone asks; the data is already there.
- **Formula:** identical `COUNT(*) FILTER (…)` windows as the blended metric, with an added
  `sequencer_id = <channel>` predicate (gateway query `leadChannelRows`, `GROUP BY client_id, sequencer_id`).
  The windows are copied **verbatim** from `leadSummaryRows`, including the deliberate m0
  `<= month-end` vs m1..m4 `< next-month-start` asymmetry — that is what makes the identity below hold.
- **Note:** `Total` is a bare count over **all** sequencers. Today the only sequencers are EmailBison
  and Aimfox, and `leads.sequencer_id` is `NOT NULL`, so `Total = EB + AF` exactly; the split query
  only becomes `Total ≥ EB + AF` if a future sequencer is added. EB and AF are strict per-sequencer
  counts, never `Total − other`. Verified 2026-08-12 against production: 33 clients × 5 months × 3
  MoM metrics = 495 buckets, 0 mismatches.

### 18.2 Aimfox daily volume & schedule

- **Source:** `sequencer_daily_stats` (ingestion-only, n8n service-role writes; ADR-0012), summed
  across the client's enabled LinkedIn profiles. The `'__workspace_total__'` sentinel row is
  **excluded** so a Sheets-backfill workspace row never double-counts per-profile rows (20260722h).
- **Daily sent (Aimfox)** bucket `0..-4`: `SUM(invites_sent)` per day, fixed `CURRENT_DATE` offsets
  to line up cell-for-cell with the Bison "Daily sent" band.
- **Schedule (Aimfox)** bucket `+2/+1/0`: `SUM(schedule_day_after / schedule_tomorrow / schedule_today)`
  from each client's **latest** report_date (the 2-hourly snapshot).

### 18.3 Invitation acceptance rate

- **Where:** a single `Accept` column in the **Aimfox capacity** band. It replaced the five-column
  `WoW Accept` sub-band, **removed 2026-08-19**.
- **Formula:** `SUM(campaigns.invites_accepted) / SUM(campaigns.invites_sent)` over the client's
  **ACTIVE** Aimfox campaigns. Both counters are cumulative over a campaign's life, so this is a
  standing figure, not a weekly one. **null (—), never 0%,** when there is no active campaign or
  nothing has been sent.
- **Thresholds** (`aimfox_accept_rate`, [20260819c](../../../supabase/migrations/20260819c_aimfox_capacity_colour_rules.sql)):
  ≥ 40% green · 30–39% yellow · < 30% red. Written as `0.4` / `0.3` — the context carries rates as
  0..1 fractions, like every other rate rule.

> **Why the WoW band went away.** It divided two per-day counters out of `sequencer_daily_stats`,
> and the numerator is measured wrongly at source: `invites_accepted` comes from a single-day
> `/analytics/interactions` query whose leading bucket is a known artefact, so it reads an order of
> magnitude low. ColdUnicorn PL had **4** accepted stored across its whole history against **333**
> that the vendor's own campaign metrics reported. The column was not showing a weaker version of
> the truth; it was showing a different number.

> **The consequence of scoping to ACTIVE campaigns:** a client's rate moves when a campaign
> completes, not only when performance changes. ColdUnicorn PL read 42% while its Sales Navigator
> campaign (772 sent / 328 accepted) was running, and 33% the week that campaign went `DONE`.

### 18.4 Aimfox capacity (Rem DB · Accept)

Both columns are derived from **`campaigns`**, not from the daily snapshot — they are facts of a
campaign, not of a day.

- **Rem DB** = `SUM(campaigns.database_size) − SUM(campaigns.invites_sent)` over the client's ACTIVE
  Aimfox campaigns, floored at 0. `database_size` is the vendor's `target_count`: the audience
  actually loaded into the campaign.
  **Thresholds** (`aimfox_remaining_db`): ≥ 200 green · 100–199 yellow · < 100 red.
- **Accept** — see §18.3.
- Both are `null` (—) when the client has no active campaign, and also when its campaigns exist but
  have not been measured yet (`aimfox-campaign-sync` catalogues a campaign up to an hour before
  `aimfox-daily-metrics` measures it; a remaining database of "the whole audience" would be a guess
  stated as a fact).

> **The old Rem DB was wrong by ~20x, and the old "Inv left" was a duplicate.**
>
> `sequencer_daily_stats.remaining_database_size` subtracted from Aimfox's `audience_size`, which is
> a **fixed ceiling the vendor assigns at campaign creation** — 10000 for every `list` campaign,
> 2500 for a `navigator` one — not the loaded audience. Bent Iron PL stored 19968 against a real
> 918. The column is **deprecated as of 2026-08-19**; n8n still writes it (now correctly), nothing
> reads it.
>
> `Inv left` (`invite_limit_remaining`) was removed because it is *the same variable* as the
> `Schedule (Aimfox)` bucket `0` cell — the ingestion workflow assigns both from one value — so the
> column repeated a number the grid already showed one band to the left. The weekly cap
> (`invite_limit`, ~195) is still fetched into `ClientMetricsSummary` and still not rendered.

**Update cadence:** every 2 hours, driven by the `aimfox-daily-metrics` n8n workflow — no portal-side
freshness change beyond the mega-table's existing refetch.

### 18.5 Channel view projection (Both / EmailBison / Aimfox)

The switch is a **display projection**, not a refetch. The page narrows each client's
`ClientMetricsPack` to the selected channel through `projectMetricsToChannel`
([`client-metrics.ts`](../../../src/app/lib/client-metrics.ts)) before building the grid rows, so the
neutral bands keep their columns, ids, widths and positions and simply hold different numbers.

Two consequences that define the whole design:

1. **A combined number is only ever on screen in `Both`.** In a single-channel view the neutral
   `3-DoD TOTAL leads` / `WoW SQL` / `MoM Total` band shows that sequencer's count, and the `· EB` /
   `· AF` comparison columns disappear (they would be duplicates).
2. **The EmailBison and Aimfox views are structurally identical** — same sections, same order, same
   early position — apart from the channel-native columns neither channel can mirror.

| Band | `both` | `email` | `aimfox` |
|---|---|---|---|
| Schedule, Daily sent | Bison | Bison | Aimfox (`sequencer_daily_stats`) |
| Schedule (Aimfox), Daily sent (Aimfox) | ✓ | — | — |
| 3-DoD TOTAL/SQL, WoW Total/SQL, MoM Total/SQL/Mtg/Won | blended | EB | AF |
| `· EB` / `· AF` comparison bands | ✓ | — | — |
| WoW Resp / Human / Bnc / OOO | ✓ | ✓ | — |
| Aimfox capacity (Rem DB, Accept) | ✓ | — | ✓ |
| Customer Success, Basic, Custom | ✓ | ✓ | ✓ |

**Parity gaps, and why they are irreducible:** `daily_stats` has no `sequencer_id` — it is
EmailBison by construction — so the reply / bounce / OOO rates simply do not exist for LinkedIn;
symmetrically, the LinkedIn acceptance rate and remaining audience have no email analogue. In the
Aimfox view those four rate bands are replaced by `Aimfox capacity`. `latest_prospects_count` (Basic → **Added**) is also Bison-derived and stays
neutral in all three views.

**Headers name the channel.** Outside `Both`, every metric band's header gets a `· EB` / `· AF`
suffix (applied after any master-admin `section:<sub>` rename), so a neutral name can never be
misread as "everything". A trailing channel qualifier the admin typed into the stored name is
stripped first — production has `section:Schedule → "Schedule (email)"`, which in the Aimfox view
would otherwise read "Schedule (email) · AF" over LinkedIn numbers.

**Conditions:** rules are always evaluated on the **blended** pack — their thresholds (`min_sent`,
the KPIs) are contract targets on total/email volume, and a display switch must not change what a
rule means. Because a projected cell would then be tinted against a number that is not on screen,
the per-bucket condition binding is dropped outside `Both` (`stripProjectedConditionKeys` in
`mega-table.tsx`). Basic-column and custom-field tints are unaffected — those values never move. In
the EmailBison view the DoD band and the four reply-rate bands keep their tint, because the
projection leaves those values alone.

---

Next: [05 В· Client portal](./05-client-portal.md).



