# 04 В· Metrics Catalog

Every metric shown anywhere in the portal, with its formula, source columns, file:line of the computation, time window, edge-case handling, and which roles see it. When a metric is derived from `leads`, remember that the snapshot loader orders leads by `updated_at DESC` and may be limited (`loadSnapshot({ leadsLimit })`); timeframe filters are applied client-side on top of that.

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

All client-side metric code lives in [`lib/client-view-models.ts`](../../../src/app/lib/client-view-models.ts) and [`lib/client-metrics.ts`](../../../src/app/lib/client-metrics.ts); pages consume these through the `useCoreData()` snapshot plus scope functions from [`lib/selectors.ts`](../../../src/app/lib/selectors.ts).

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

- **Where:** Client Dashboard KPI tile 4 (compact number), Client Dashboard "Daily sent (last 30 days)" chart, Statistics page trend lines, ClientsPage Overview "Sent" column (today).
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

- **Where:** Client Dashboard "Daily sent (last 30 days)" bar chart; Client Statistics "Daily sent" area chart.
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
- **Note:** driven by the pre-aggregated table; **not** by the leads list. This is why the metric is available only for roles whose snapshot includes `daily_stats` (manager/admin) вЂ” clients reach this via the subset of daily stats they are RLS-visible for; if the client's snapshot intentionally excluded `daily_stats`, the chart falls back to empty state. Today the exclusion is only applied for the client role ([core-data.tsx](../../../src/app/providers/core-data.tsx)).

### 6.5 Prospects added daily вЂ” Client Dashboard

- **Where:** Client Dashboard "Prospects added" (last 10 days).
- **Formula:** delta between consecutive `daily_stats.prospects_count` entries sorted by `report_date`.
- **Source:** `daily_stats.prospects_count`.
- **Edge cases:** first day has no previous в†’ delta = 0 (skipped).

### 6.6 Sent last 3 months вЂ” Client Dashboard

- **Where:** "Sent count for last three months" bar.
- **Formula:** `sum(campaign_daily_stats.sent_count)` grouped by calendar month, last 3 months.

### 6.7 Prospects added by month вЂ” Client Dashboard

- **Where:** "Prospects added by Month" bar, last 12 months.
- **Formula:** month-over-month delta of `sum(daily_stats.prospects_count) per month` (aggregate by month first, then delta).

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
const response = sumInRange(dailyByDate.values(), start, end, i => i.responseCount);
const human    = sumInRange(dailyByDate.values(), start, end, i => i.humanRepliesCount);
const bounce   = sumInRange(dailyByDate.values(), start, end, i => i.bounceCount);
const ooo      = sumInRange(dailyByDate.values(), start, end, i => i.oooCount);
const negative = sumInRange(dailyByDate.values(), start, end, i => i.negativeCount);

return {
  bucket,
  totalLeads:   sumInRange(leadByDate.values(), start, end, i => i.all),
  sqlLeads:     sumInRange(leadByDate.values(), start, end, i => i.sql),
  responseRate: toRate(response, sent),
  humanRate:    toRate(human,    sent),
  bounceRate:   toRate(bounce,   sent),
  oooRate:      toRate(ooo,      sent),
  negativeRate: toRate(negative, sent),
};
```

`toRate(numerator, denominator)` at [client-metrics.ts:230-233](../../../src/app/lib/client-metrics.ts#L230-L233) returns `null` when `denominator <= 0`.

### 10.1 WoW Total Leads

- **Formula:** `count(leads created in week)`.
- **Source:** `leads.created_at`, `leads.qualification` (LeadAggregate.all counts every lead regardless of qualification).

### 10.2 WoW SQL Leads

- **Formula:** `count(leads created in week WHERE qualification='MQL')`.

### 10.3 WoW Response Rate

- **Formula:** `sum(response_count) / sum(emails_sent)` or null.
- **Source:** `daily_stats.response_count`, `daily_stats.emails_sent`.
- **Edge cases:** the numerator `response_count` is total replies; contrast with `human_replies_count`. Also null when zero sends.

### 10.4 WoW Human Reply Rate

- **Formula:** `sum(human_replies_count) / sum(emails_sent)`.
- **Source:** `daily_stats.human_replies_count`.
- **Use:** excludes automated/OOO/bounce replies вЂ” the "quality" signal.

### 10.5 WoW Bounce Rate

- **Formula:** `sum(bounce_count) / sum(emails_sent)`.

### 10.6 WoW OOO Rate

- **Formula:** `sum(ooo_count) / sum(emails_sent)`.

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

Inline in [`manager-dashboard-page.tsx`](../../../src/app/pages/manager-dashboard-page.tsx).

### 12.1 Assigned clients

- **Formula:** `scopeClients(identity, clients).length`.
- **Source:** `clients.manager_id`.
- **Scope:** clients where `manager_id = identity.id`.

### 12.2 Active campaigns

- **Formula:** `count(scopeCampaigns(вЂ¦) WHERE status = 'active')`.
- **Source:** `campaigns.status`.

### 12.3 Leads in progress

- **Formula:** `count(scopeLeads(вЂ¦) WHERE stage в€‰ ('won','rejected'))` roughly; the page uses `count(scopedLeads)` over a recency filter (leads updated in last 14 days are the working set).

### 12.4 Unclassified replies <a id="125-unclassified-replies"></a>

- **Formula:** `count(scopeReplies(вЂ¦) WHERE classification IS NULL)`.
- **Source:** `replies.classification`.
- **Interpretation:** sanity check on **n8n ingestion**, not a user action queue. All replies are classified by n8n; an "unclassified" count growing means ingestion is lagging or broken. There is no triage UI ([decision](../../BUSINESS_LOGIC.md#decision-2026-04-25-no-reply-triage-ui)).

### 12.5 Per-client KPI progress

For each assigned client:

- `campaignsCount` = `count(campaigns WHERE client_id = client.id)`.
- `mqls` = `count(leads WHERE client_id = client.id AND qualification='MQL')`.
- `won`  = `count(leads WHERE client_id = client.id AND won=true)`.
- Progress ratios: `mqls / client.kpi_leads`, `meetings / client.kpi_meetings` (target values from `clients.kpi_leads` / `kpi_meetings`).

### 12.6 Campaign watchlist

Filtering logic in `manager-dashboard-page.tsx` selects campaigns that are either `stopped`/`launching` **or** have a low reply rate computed from the 14-day window of `campaign_daily_stats`.

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
| `prospects_added` | `clients.prospects_added` |
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
| `auto_li_api_key` | `clients.linkedin_api_key` |
| `bi_setup` | `clients.bi_setup_done` |

### 15.2 DoD dynamic bucket evaluation

DoD condition checks do not hardcode per-column comparisons. Each DoD schedule/sent cell injects a runtime `value` and evaluates the shared rule key (`dod_sent_or_schedule_vs_min_sent`) with dynamic column keys (`dod:{bucket}:{schedule|sent}`).

### 15.3 Legacy-rate parity keys

For parity with CS PDCA sheet behavior, the WoW response/human/OOO rules preserve green branches for very low rates (`<0.10%`) and record this in seeded `notes`. See [14 · Condition rules](./14-condition-rules.md#10-known-legacy-quirks).

Next: [05 В· Client portal](./05-client-portal.md).



