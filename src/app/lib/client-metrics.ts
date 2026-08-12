import type { ClientMetricsSummary } from "../types/view-contracts.ts";

/**
 * Minimal lead field set read by createClientMetrics. Accepts full LeadRecord (backwards-compatible)
 * and any projection that carries these four fields. Do NOT cast projections to LeadRecord.
 */
export interface LeadMetricInput {
  created_at: string | null;
  qualification: string | null;
  meeting_booked: boolean | null;
  won: boolean | null;
}

/**
 * Minimal daily-stat field set consumed by createClientMetrics (aggregateDailyStats). Accepts full
 * DailyStatRecord (backwards-compatible) and leaner projections from per-page loaders (Phase 3+).
 * Fields NOT consumed: mql_count, prospects_count, client_id (used for partitioning externally).
 */
export interface DailyStatInput {
  report_date: string | null;
  emails_sent: number | null;
  response_count: number | null;
  bounce_count: number | null;
  // Optional — present in clients-overview and daily_stats full loads but omitted in analytics overview.
  human_replies_count?: number | null;
  ooo_count?: number | null;
  negative_count?: number | null;
  schedule_today?: number | null;
  schedule_tomorrow?: number | null;
  schedule_day_after?: number | null;
}

interface DailyAggregate {
  emailsSent: number;
  responseCount: number;
  bounceCount: number;
  humanRepliesCount: number;
  oooCount: number;
  negativeCount: number;
  scheduleToday: number;
  scheduleTomorrow: number;
  scheduleDayAfter: number;
}

interface LeadAggregate {
  all: number;
  threeDodTotal: number;
  sql: number;
  meetings: number;
  won: number;
}

interface DatedEntry<T> {
  date: Date;
  value: T;
}

// Per-channel and Aimfox fields are optional: the raw createClientMetrics() path (used by tests and
// the condition context) has no sequencer dimension and leaves them undefined, which the mega-table
// renders as "—". Only the summary path (createClientMetricsFromSummary) populates them.
export interface DodRow {
  bucket: string;
  schedule: number | null;
  sent: number | null;
  /** Aimfox planned invite volume for this bucket (+2/+1/0 only), else null. */
  aimfoxSchedule?: number | null;
  /** Aimfox invites_sent for this daily-sent bucket (0..-4 only), else null. */
  aimfoxSent?: number | null;
}

export interface ThreeDodRow {
  bucket: string;
  totalLeads: number;
  sqlLeads: number;
  totalLeadsEb?: number;
  totalLeadsAf?: number;
  sqlLeadsEb?: number;
  sqlLeadsAf?: number;
}

export interface WowRow {
  bucket: string;
  totalLeads: number;
  sqlLeads: number;
  responseRate: number | null;
  humanRate: number | null;
  bounceRate: number | null;
  oooRate: number | null;
  negativeRate: number | null;
  totalLeadsEb?: number;
  totalLeadsAf?: number;
  sqlLeadsEb?: number;
  sqlLeadsAf?: number;
  /** Aimfox acceptance rate for the week: accepted/sent. null when sent=0 or accepted unmeasured. */
  acceptRate?: number | null;
}

export interface MomRow {
  bucket: string;
  totalLeads: number;
  sqlLeads: number;
  meetings: number;
  won: number;
  totalLeadsEb?: number;
  totalLeadsAf?: number;
  sqlLeadsEb?: number;
  sqlLeadsAf?: number;
  meetingsEb?: number;
  meetingsAf?: number;
  wonEb?: number;
  wonAf?: number;
}

export interface ClientMetricsOverview {
  scheduleToday: number;
  scheduleTomorrow: number;
  scheduleDayAfter: number;
  sentToday: number;
  sentYesterday: number;
  sentTwoDaysAgo: number;
  threeDodTotal: number;
  threeDodSql: number;
  wowResponseRate: number | null;
  wowHumanRate: number | null;
  wowBounceRate: number | null;
  wowOooRate: number | null;
  wowSql: number;
  momSql: number;
  /** Latest daily_stats.prospects_count by report_date; 0 when no daily_stats rows exist. */
  latestProspectsCount: number;
  /** Aimfox weekly connect-cap snapshot ("~195 per account"), latest day. undefined in the raw path. */
  aimfoxInviteLimit?: number | null;
  /** Aimfox invites still available today (PDCA sheet column S "Invitations limit"). undefined in the raw path. */
  aimfoxInviteLimitRemaining?: number | null;
  /** Aimfox remaining database size, latest day. undefined in the raw path. */
  aimfoxRemainingDb?: number | null;
}

export interface ClientMetricsPack {
  overview: ClientMetricsOverview;
  dodRows: DodRow[];
  threeDodRows: ThreeDodRow[];
  wowRows: WowRow[];
  momRows: MomRow[];
}

/** The clients-grid channel switch. Re-exported as `ChannelView` by the mega-table. */
export type MetricsChannelView = "both" | "email" | "aimfox";

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
}

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  date.setHours(12, 0, 0, 0);
  return date;
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function startOfMonth(value: Date) {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(12, 0, 0, 0);
  return date;
}

function shiftMonthStart(value: Date, monthOffset: number) {
  return new Date(value.getFullYear(), value.getMonth() + monthOffset, 1, 12, 0, 0, 0);
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 12, 0, 0, 0);
}

function createDailyAggregate(): DailyAggregate {
  return {
    emailsSent: 0,
    responseCount: 0,
    bounceCount: 0,
    humanRepliesCount: 0,
    oooCount: 0,
    negativeCount: 0,
    scheduleToday: 0,
    scheduleTomorrow: 0,
    scheduleDayAfter: 0,
  };
}

function createLeadAggregate(): LeadAggregate {
  return {
    all: 0,
    threeDodTotal: 0,
    sql: 0,
    meetings: 0,
    won: 0,
  };
}

function aggregateDailyStats(stats: DailyStatInput[]) {
  const byDate = new Map<string, DatedEntry<DailyAggregate>>();

  for (const stat of stats) {
    const date = parseDate(stat.report_date);
    if (!date) continue;
    const key = toDateKey(date);

    if (!byDate.has(key)) {
      byDate.set(key, { date, value: createDailyAggregate() });
    }

    const target = byDate.get(key) as DatedEntry<DailyAggregate>;
    target.value.emailsSent += stat.emails_sent ?? 0;
    target.value.responseCount += stat.response_count ?? 0;
    target.value.bounceCount += stat.bounce_count ?? 0;
    target.value.humanRepliesCount += stat.human_replies_count ?? 0;
    target.value.oooCount += stat.ooo_count ?? 0;
    target.value.negativeCount += stat.negative_count ?? 0;
    target.value.scheduleToday += stat.schedule_today ?? 0;
    target.value.scheduleTomorrow += stat.schedule_tomorrow ?? 0;
    target.value.scheduleDayAfter += stat.schedule_day_after ?? 0;
  }

  return byDate;
}

function aggregateLeads(leads: LeadMetricInput[]) {
  const byDate = new Map<string, DatedEntry<LeadAggregate>>();

  for (const lead of leads) {
    const date = parseDate(lead.created_at);
    if (!date) continue;
    const key = toDateKey(date);

    if (!byDate.has(key)) {
      byDate.set(key, { date, value: createLeadAggregate() });
    }

    const target = byDate.get(key) as DatedEntry<LeadAggregate>;
    const qualification = lead.qualification?.toLowerCase();

    target.value.all += 1;

    if (qualification === "mql") {
      target.value.sql += 1;
      target.value.threeDodTotal += 1;
    }

    if (qualification === "premql") {
      target.value.threeDodTotal += 1;
    }

    if (lead.meeting_booked) {
      target.value.meetings += 1;
    }

    if (lead.won) {
      target.value.won += 1;
    }
  }

  return byDate;
}

function sumInRange<T>(entries: Iterable<DatedEntry<T>>, start: Date, end: Date, getValue: (value: T) => number) {
  const startTs = start.getTime();
  const endTs = end.getTime();
  let total = 0;

  for (const entry of entries) {
    const ts = entry.date.getTime();
    if (ts < startTs || ts > endTs) continue;
    total += getValue(entry.value);
  }

  return total;
}

function toRate(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function valueByDayOffset<T>(
  entriesByDate: Map<string, DatedEntry<T>>,
  today: Date,
  offset: number,
  getValue: (value: T) => number,
) {
  const date = addDays(today, -offset);
  const key = toDateKey(date);
  const entry = entriesByDate.get(key);
  if (!entry) return 0;
  return getValue(entry.value);
}

export function createClientMetrics(dailyStats: DailyStatInput[], leads: LeadMetricInput[], now = new Date()): ClientMetricsPack {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);

  const dailyByDate = aggregateDailyStats(dailyStats);
  const leadByDate = aggregateLeads(leads);

  const todayKey = toDateKey(today);
  const todayDaily = dailyByDate.get(todayKey)?.value ?? createDailyAggregate();

  const dodRows: DodRow[] = [
    { bucket: "+2", schedule: todayDaily.scheduleDayAfter, sent: null },
    { bucket: "+1", schedule: todayDaily.scheduleTomorrow, sent: null },
    { bucket: "0", schedule: todayDaily.scheduleToday, sent: valueByDayOffset(dailyByDate, today, 0, (item) => item.emailsSent) },
    { bucket: "-1", schedule: null, sent: valueByDayOffset(dailyByDate, today, 1, (item) => item.emailsSent) },
    { bucket: "-2", schedule: null, sent: valueByDayOffset(dailyByDate, today, 2, (item) => item.emailsSent) },
    { bucket: "-3", schedule: null, sent: valueByDayOffset(dailyByDate, today, 3, (item) => item.emailsSent) },
    { bucket: "-4", schedule: null, sent: valueByDayOffset(dailyByDate, today, 4, (item) => item.emailsSent) },
  ];

  const threeDodRows: ThreeDodRow[] = [0, 1, 2, 3, 4].map((offset) => ({
    bucket: offset === 0 ? "0" : `-${offset}`,
    totalLeads: valueByDayOffset(leadByDate, today, offset, (item) => item.threeDodTotal),
    sqlLeads: valueByDayOffset(leadByDate, today, offset, (item) => item.sql),
  }));

  const currentWeekStart = startOfWeek(today);
  const wowRows: WowRow[] = [0, 1, 2, 3, 4].map((offset) => {
    const start = addDays(currentWeekStart, -7 * offset);
    const end = addDays(start, 6);

    const sent = sumInRange(dailyByDate.values(), start, end, (item) => item.emailsSent);
    const human = sumInRange(dailyByDate.values(), start, end, (item) => item.humanRepliesCount);
    const bounce = sumInRange(dailyByDate.values(), start, end, (item) => item.bounceCount);
    const ooo = sumInRange(dailyByDate.values(), start, end, (item) => item.oooCount);
    const negative = sumInRange(dailyByDate.values(), start, end, (item) => item.negativeCount);

    return {
      bucket: offset === 0 ? "0" : `-${offset}`,
      totalLeads: sumInRange(leadByDate.values(), start, end, (item) => item.all),
      sqlLeads: sumInRange(leadByDate.values(), start, end, (item) => item.sql),
      responseRate: toRate(human + ooo, sent),
      humanRate: toRate(human, sent),
      bounceRate: toRate(bounce, sent),
      oooRate: toRate(ooo, sent),
      negativeRate: toRate(negative, sent),
    };
  });

  const currentMonthStart = startOfMonth(today);
  const momRows: MomRow[] = [0, 1, 2, 3, 4].map((offset) => {
    const start = shiftMonthStart(currentMonthStart, -offset);
    const end = endOfMonth(start);

    return {
      bucket: offset === 0 ? "0" : `-${offset}`,
      totalLeads: sumInRange(leadByDate.values(), start, end, (item) => item.all),
      sqlLeads: sumInRange(leadByDate.values(), start, end, (item) => item.sql),
      meetings: sumInRange(leadByDate.values(), start, end, (item) => item.meetings),
      won: sumInRange(leadByDate.values(), start, end, (item) => item.won),
    };
  });

  const threeDodTotal = threeDodRows.slice(0, 3).reduce((total, row) => total + row.totalLeads, 0);
  const threeDodSql = threeDodRows.slice(0, 3).reduce((total, row) => total + row.sqlLeads, 0);

  const latestDailyStat = dailyStats.reduce<DailyStatRecord | null>(
    (best, s) =>
      (s.prospects_count ?? 0) > 0 && (!best || (s.report_date ?? "") > (best.report_date ?? "")) ? s : best,
    null,
  );
  const latestProspectsCount = latestDailyStat?.prospects_count ?? 0;

  const overview: ClientMetricsOverview = {
    scheduleToday: todayDaily.scheduleToday,
    scheduleTomorrow: todayDaily.scheduleTomorrow,
    scheduleDayAfter: todayDaily.scheduleDayAfter,
    sentToday: valueByDayOffset(dailyByDate, today, 0, (item) => item.emailsSent),
    sentYesterday: valueByDayOffset(dailyByDate, today, 1, (item) => item.emailsSent),
    sentTwoDaysAgo: valueByDayOffset(dailyByDate, today, 2, (item) => item.emailsSent),
    threeDodTotal,
    threeDodSql,
    wowResponseRate: wowRows[0]?.responseRate ?? null,
    wowHumanRate: wowRows[0]?.humanRate ?? null,
    wowBounceRate: wowRows[0]?.bounceRate ?? null,
    wowOooRate: wowRows[0]?.oooRate ?? null,
    wowSql: wowRows[0]?.sqlLeads ?? 0,
    momSql: momRows[0]?.sqlLeads ?? 0,
    latestProspectsCount,
  };

  return {
    overview,
    dodRows,
    threeDodRows,
    wowRows,
    momRows,
  };
}

/**
 * Produce a ClientMetricsPack from a compact pre-bucketed summary (returned by
 * loadClientsMetricsSummary). No raw row iteration — all temporal aggregation was
 * done server-side. Output shape is identical to createClientMetrics().
 */
export function createClientMetricsFromSummary(s: ClientMetricsSummary): ClientMetricsPack {
  // Defensive against undefined arrays: the per-channel/Aimfox fields are optional on the contract
  // and older test fixtures may omit them; a bare arr[i] would throw on undefined.
  const g = (arr: number[] | undefined, i: number) => arr?.[i] ?? 0;
  const gN = (arr: Array<number | null> | undefined, i: number) => arr?.[i] ?? null;

  const dodRows: DodRow[] = [
    { bucket: "+2", schedule: s.schedule_day_after, sent: null,             aimfoxSchedule: s.aimfox_schedule_day_after ?? null, aimfoxSent: null },
    { bucket: "+1", schedule: s.schedule_tomorrow,  sent: null,             aimfoxSchedule: s.aimfox_schedule_tomorrow ?? null,  aimfoxSent: null },
    { bucket:  "0", schedule: s.schedule_today,     sent: g(s.daily_sent, 0), aimfoxSchedule: s.aimfox_schedule_today ?? null,   aimfoxSent: g(s.aimfox_daily_sent, 0) },
    { bucket: "-1", schedule: null,                 sent: g(s.daily_sent, 1), aimfoxSchedule: null,                              aimfoxSent: g(s.aimfox_daily_sent, 1) },
    { bucket: "-2", schedule: null,                 sent: g(s.daily_sent, 2), aimfoxSchedule: null,                              aimfoxSent: g(s.aimfox_daily_sent, 2) },
    { bucket: "-3", schedule: null,                 sent: g(s.daily_sent, 3), aimfoxSchedule: null,                              aimfoxSent: g(s.aimfox_daily_sent, 3) },
    { bucket: "-4", schedule: null,                 sent: g(s.daily_sent, 4), aimfoxSchedule: null,                              aimfoxSent: g(s.aimfox_daily_sent, 4) },
  ];

  const threeDodRows: ThreeDodRow[] = [0, 1, 2, 3, 4].map((i) => ({
    bucket: i === 0 ? "0" : `-${i}`,
    totalLeads:   g(s.threedod_total,    i),
    sqlLeads:     g(s.threedod_sql,      i),
    totalLeadsEb: g(s.threedod_total_eb, i),
    totalLeadsAf: g(s.threedod_total_af, i),
    sqlLeadsEb:   g(s.threedod_sql_eb,   i),
    sqlLeadsAf:   g(s.threedod_sql_af,   i),
  }));

  const wowRows: WowRow[] = [0, 1, 2, 3, 4].map((i) => {
    const sent    = g(s.wow_sent,     i);
    const human   = g(s.wow_human,    i);
    const bounce  = g(s.wow_bounce,   i);
    const ooo     = g(s.wow_ooo,      i);
    const negative = g(s.wow_negative, i);
    const afSent     = g(s.aimfox_wow_sent, i);
    const afAccepted = gN(s.aimfox_wow_accepted, i);
    return {
      bucket: i === 0 ? "0" : `-${i}`,
      totalLeads:   g(s.wow_leads, i),
      sqlLeads:     g(s.wow_sql,   i),
      responseRate: toRate(human + ooo, sent),
      humanRate:    toRate(human,       sent),
      bounceRate:   toRate(bounce,      sent),
      oooRate:      toRate(ooo,         sent),
      negativeRate: toRate(negative,    sent),
      totalLeadsEb: g(s.wow_leads_eb, i),
      totalLeadsAf: g(s.wow_leads_af, i),
      sqlLeadsEb:   g(s.wow_sql_eb,   i),
      sqlLeadsAf:   g(s.wow_sql_af,   i),
      // Acceptance rate: null (not 0) when nothing was sent or acceptances were unmeasured.
      acceptRate:   afAccepted === null ? null : toRate(afAccepted, afSent),
    };
  });

  const momRows: MomRow[] = [0, 1, 2, 3, 4].map((i) => ({
    bucket: i === 0 ? "0" : `-${i}`,
    totalLeads:   g(s.mom_total,       i),
    sqlLeads:     g(s.mom_sql,         i),
    meetings:     g(s.mom_meetings,    i),
    won:          g(s.mom_won,         i),
    totalLeadsEb: g(s.mom_total_eb,    i),
    totalLeadsAf: g(s.mom_total_af,    i),
    sqlLeadsEb:   g(s.mom_sql_eb,      i),
    sqlLeadsAf:   g(s.mom_sql_af,      i),
    meetingsEb:   g(s.mom_meetings_eb, i),
    meetingsAf:   g(s.mom_meetings_af, i),
    wonEb:        g(s.mom_won_eb,      i),
    wonAf:        g(s.mom_won_af,      i),
  }));

  const overview = deriveOverview({ dodRows, threeDodRows, wowRows, momRows }, {
    latestProspectsCount: s.latest_prospects_count,
    aimfoxInviteLimit: s.aimfox_invite_limit ?? null,
    aimfoxInviteLimitRemaining: s.aimfox_invite_limit_remaining ?? null,
    aimfoxRemainingDb: s.aimfox_remaining_database_size ?? null,
  });

  return { overview, dodRows, threeDodRows, wowRows, momRows };
}

/** Facts the row bands cannot carry — they are per-client, not per-bucket. */
type OverviewExtras = Pick<
  ClientMetricsOverview,
  "latestProspectsCount" | "aimfoxInviteLimit" | "aimfoxInviteLimitRemaining" | "aimfoxRemainingDb"
>;

/**
 * Fold the row bands into the overview — shared by the summary path and the channel projection.
 * Every number here is a restatement of a cell in the bands below it (3-DoD = the first three
 * buckets, the WoW rates = the current week, …), and a second copy of that fold is how an overview
 * starts disagreeing with the grid underneath it. (`createClientMetrics`, the raw path, still folds
 * its own: it works from raw rows, not from these bands, and nothing renders it today.)
 */
function deriveOverview(
  rows: Pick<ClientMetricsPack, "dodRows" | "threeDodRows" | "wowRows" | "momRows">,
  extras: OverviewExtras,
): ClientMetricsOverview {
  const { dodRows, threeDodRows, wowRows, momRows } = rows;
  const dodAt = (bucket: string) => dodRows.find((r) => r.bucket === bucket);
  return {
    scheduleToday:    dodAt("0")?.schedule  ?? 0,
    scheduleTomorrow: dodAt("+1")?.schedule ?? 0,
    scheduleDayAfter: dodAt("+2")?.schedule ?? 0,
    sentToday:        dodAt("0")?.sent  ?? 0,
    sentYesterday:    dodAt("-1")?.sent ?? 0,
    sentTwoDaysAgo:   dodAt("-2")?.sent ?? 0,
    threeDodTotal: threeDodRows.slice(0, 3).reduce((acc, r) => acc + r.totalLeads, 0),
    threeDodSql:   threeDodRows.slice(0, 3).reduce((acc, r) => acc + r.sqlLeads,   0),
    wowResponseRate: wowRows[0]?.responseRate ?? null,
    wowHumanRate:    wowRows[0]?.humanRate    ?? null,
    wowBounceRate:   wowRows[0]?.bounceRate   ?? null,
    wowOooRate:      wowRows[0]?.oooRate      ?? null,
    wowSql:          wowRows[0]?.sqlLeads     ?? 0,
    momSql:          momRows[0]?.sqlLeads     ?? 0,
    // Listed one by one, not spread: `extras` is sometimes a whole overview (the channel
    // projection passes the unprojected one), and a spread would put the stale folds back.
    latestProspectsCount: extras.latestProspectsCount,
    aimfoxInviteLimit: extras.aimfoxInviteLimit,
    aimfoxInviteLimitRemaining: extras.aimfoxInviteLimitRemaining,
    aimfoxRemainingDb: extras.aimfoxRemainingDb,
  };
}

/**
 * Narrow a metrics pack to one outbound channel for the clients grid.
 *
 * The grid's neutral bands (Schedule, Daily sent, 3-DoD, WoW, MoM) keep their columns, ids and
 * positions in every view — only the numbers behind them change, so the EmailBison and Aimfox views
 * are structurally identical. `"both"` returns the pack unchanged, so the default view pays nothing.
 *
 * Only meaningful on packs from createClientMetricsFromSummary(): the raw createClientMetrics() path
 * has no sequencer dimension and leaves the per-channel fields undefined, which project to 0 here.
 */
export function projectMetricsToChannel(
  pack: ClientMetricsPack,
  view: MetricsChannelView,
): ClientMetricsPack {
  if (view === "both") return pack;
  const email = view === "email";
  /** The channel's own count, or 0 when this pack has no sequencer dimension (raw path). */
  const pick = (eb: number | undefined, af: number | undefined) => (email ? eb : af) ?? 0;

  // Schedule / Daily sent come from daily_stats, which has no sequencer column — they are already
  // EmailBison. Only the Aimfox view swaps in the sequencer_daily_stats mirror.
  const dodRows: DodRow[] = email
    ? pack.dodRows
    : pack.dodRows.map((r) => ({ ...r, schedule: r.aimfoxSchedule ?? null, sent: r.aimfoxSent ?? null }));

  const threeDodRows: ThreeDodRow[] = pack.threeDodRows.map((r) => ({
    ...r,
    totalLeads: pick(r.totalLeadsEb, r.totalLeadsAf),
    sqlLeads: pick(r.sqlLeadsEb, r.sqlLeadsAf),
  }));

  // Reply / bounce / OOO rates exist only for Bison, acceptance only for Aimfox. Blank the other
  // channel's so no future column change can surface one under the wrong heading.
  const wowRows: WowRow[] = pack.wowRows.map((r) => ({
    ...r,
    totalLeads: pick(r.totalLeadsEb, r.totalLeadsAf),
    sqlLeads: pick(r.sqlLeadsEb, r.sqlLeadsAf),
    responseRate: email ? r.responseRate : null,
    humanRate: email ? r.humanRate : null,
    bounceRate: email ? r.bounceRate : null,
    oooRate: email ? r.oooRate : null,
    negativeRate: email ? r.negativeRate : null,
    acceptRate: email ? null : r.acceptRate,
  }));

  const momRows: MomRow[] = pack.momRows.map((r) => ({
    ...r,
    totalLeads: pick(r.totalLeadsEb, r.totalLeadsAf),
    sqlLeads: pick(r.sqlLeadsEb, r.sqlLeadsAf),
    meetings: pick(r.meetingsEb, r.meetingsAf),
    won: pick(r.wonEb, r.wonAf),
  }));

  // Re-fold the overview so it agrees with the projected bands. The condition engine keeps running
  // on the *unprojected* pack (see clients-page.tsx) — nothing here changes what a rule means.
  const overview = deriveOverview({ dodRows, threeDodRows, wowRows, momRows }, pack.overview);

  return { overview, dodRows, threeDodRows, wowRows, momRows };
}
