import type { DailyStatRecord, LeadRecord } from "../types/core";

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

export interface DodRow {
  bucket: string;
  schedule: number | null;
  sent: number | null;
}

export interface ThreeDodRow {
  bucket: string;
  totalLeads: number;
  sqlLeads: number;
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
}

export interface MomRow {
  bucket: string;
  totalLeads: number;
  sqlLeads: number;
  meetings: number;
  won: number;
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
}

export interface ClientMetricsPack {
  overview: ClientMetricsOverview;
  dodRows: DodRow[];
  threeDodRows: ThreeDodRow[];
  wowRows: WowRow[];
  momRows: MomRow[];
}

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

function aggregateDailyStats(stats: DailyStatRecord[]) {
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

function aggregateLeads(leads: LeadRecord[]) {
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

export function createClientMetrics(dailyStats: DailyStatRecord[], leads: LeadRecord[], now = new Date()): ClientMetricsPack {
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
  const wowRows: WowRow[] = [0, 1, 2, 3].map((offset) => {
    const start = addDays(currentWeekStart, -7 * offset);
    const end = addDays(start, 6);

    const sent = sumInRange(dailyByDate.values(), start, end, (item) => item.emailsSent);
    const response = sumInRange(dailyByDate.values(), start, end, (item) => item.responseCount);
    const human = sumInRange(dailyByDate.values(), start, end, (item) => item.humanRepliesCount);
    const bounce = sumInRange(dailyByDate.values(), start, end, (item) => item.bounceCount);
    const ooo = sumInRange(dailyByDate.values(), start, end, (item) => item.oooCount);
    const negative = sumInRange(dailyByDate.values(), start, end, (item) => item.negativeCount);

    return {
      bucket: offset === 0 ? "0" : `-${offset}`,
      totalLeads: sumInRange(leadByDate.values(), start, end, (item) => item.all),
      sqlLeads: sumInRange(leadByDate.values(), start, end, (item) => item.sql),
      responseRate: toRate(response, sent),
      humanRate: toRate(human, sent),
      bounceRate: toRate(bounce, sent),
      oooRate: toRate(ooo, sent),
      negativeRate: toRate(negative, sent),
    };
  });

  const currentMonthStart = startOfMonth(today);
  const momRows: MomRow[] = [0, 1, 2, 3].map((offset) => {
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
  };

  return {
    overview,
    dodRows,
    threeDodRows,
    wowRows,
    momRows,
  };
}
