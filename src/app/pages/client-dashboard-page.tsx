import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarCheck, Send, Target, Trophy, Users } from "lucide-react";
import {
  ChartPanel,
  ChartTooltip,
  DateRangeButton,
  EmptyPortalState,
  KpiTile,
  PortalErrorState,
  PortalLoadingState,
  PortalPageHeader,
  PortalSurface,
  ResponsiveChart,
} from "../components/portal-ui";
import {
  getCampaignPerformance,
  getClientKpis,
  getConversionRates,
  getDailySentSeries,
  formatCompact,
} from "../lib/client-view-models";
import {
  createDefaultTimeframe,
  filterByTimeframe,
  getTimeframeLabel,
  resolveTimeframeBounds,
  type TimeframeValue,
} from "../lib/timeframe";
import { scopeCampaignStats, scopeCampaigns, scopeClients, scopeDailyStats, scopeLeads } from "../lib/selectors";
import { formatDate, formatNumber } from "../lib/format";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseUnknownDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toWeekStartKey(value: Date) {
  const date = new Date(value);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return toDateKey(date);
}

function toPercentChange(current: number, previous: number | null) {
  if (previous === null || !Number.isFinite(previous)) return null;
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function makePreviousRange(timeframe: TimeframeValue) {
  const bounds = resolveTimeframeBounds(timeframe);
  if (!bounds.start || !bounds.end) {
    return null;
  }

  const span = bounds.end.getTime() - bounds.start.getTime();
  const previousEnd = new Date(bounds.start.getTime() - DAY_MS);
  const previousStart = new Date(previousEnd.getTime() - span);
  return { start: previousStart, end: previousEnd };
}

function filterByDateBounds<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  bounds: { start: Date; end: Date } | null,
) {
  if (!bounds) return [];
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();

  return items.filter((item) => {
    const date = parseUnknownDate(getDate(item));
    if (!date) return false;
    const timestamp = date.getTime();
    return timestamp >= start && timestamp <= end;
  });
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const safeValues = values.length ? values : [0, 0];
  const max = Math.max(...safeValues);
  const min = Math.min(...safeValues);
  const range = max - min || 1;

  const points = safeValues
    .map((value, index) => {
      const x = safeValues.length === 1 ? 0 : (index / (safeValues.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 100" className="h-9 w-24 opacity-90" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function DashboardKpiCard({
  icon,
  label,
  value,
  percent,
  spark,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  percent: number | null;
  spark: number[];
  tone: "green" | "purple" | "amber" | "blue" | "indigo";
}) {
  const toneClasses = {
    green: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400",
    purple: "border-violet-500/30 bg-violet-500/[0.06] text-violet-400",
    amber: "border-amber-500/30 bg-amber-500/[0.06] text-amber-400",
    blue: "border-blue-500/30 bg-blue-500/[0.06] text-blue-400",
    indigo: "border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-400",
  };

  const deltaTone = percent === null ? "text-neutral-500" : percent >= 0 ? "text-emerald-400" : "text-red-400";
  const deltaText = percent === null ? "n/a" : `${percent >= 0 ? "↑" : "↓"} ${Math.abs(percent).toFixed(1)}%`;
  const sparkColor = tone === "amber" ? "#f59e0b" : tone === "purple" ? "#8b5cf6" : tone === "indigo" ? "#6366f1" : tone === "blue" ? "#3b82f6" : "#22c55e";

  return (
    <div className={`rounded-3xl border p-5 ${toneClasses[tone]}`}>
      <div className="flex items-start justify-between">
        <div className="rounded-2xl bg-current/10 p-2">{icon}</div>
        <p className={`text-2xs font-semibold tracking-[0.08em] ${deltaTone}`}>{deltaText}</p>
      </div>
      <p className="mt-4 text-[34px] font-medium leading-none text-current">{value}</p>
      <p className="mt-2 text-[28px] leading-none text-neutral-300">{label}</p>
      <div className="mt-4">
        <Sparkline values={spark} color={sparkColor} />
      </div>
    </div>
  );
}

function monthLabelFromKey(monthKey: string) {
  return formatDate(`${monthKey}-01`, { month: "short", year: "2-digit" });
}

export function ClientDashboardPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, campaignDailyStats, dailyStats, loading, error, refresh } = useCoreData();
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());

  if (loading) {
    return <PortalLoadingState title="Loading dashboard" description="Preparing KPI, funnel, and campaign trends." />;
  }

  if (error) {
    return (
      <PortalErrorState
        title="Dashboard data is unavailable"
        description={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const scopedDailyStats = useMemo(
    () => (identity ? scopeDailyStats(identity, clients, dailyStats) : []),
    [clients, dailyStats, identity],
  );

  const previousRange = useMemo(() => makePreviousRange(timeframe), [timeframe]);

  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (lead) => lead.updated_at || lead.created_at, timeframe),
    [scopedLeads, timeframe],
  );
  const timeframeStats = useMemo(
    () => filterByTimeframe(scopedStats, (stat) => stat.report_date, timeframe),
    [scopedStats, timeframe],
  );
  const timeframeDailyStats = useMemo(
    () => filterByTimeframe(scopedDailyStats, (stat) => stat.report_date, timeframe),
    [scopedDailyStats, timeframe],
  );

  const previousLeads = useMemo(
    () => filterByDateBounds(scopedLeads, (lead) => lead.updated_at || lead.created_at, previousRange),
    [previousRange, scopedLeads],
  );
  const previousCampaignStats = useMemo(
    () => filterByDateBounds(scopedStats, (stat) => stat.report_date, previousRange),
    [previousRange, scopedStats],
  );
  const previousDailyStats = useMemo(
    () => filterByDateBounds(scopedDailyStats, (stat) => stat.report_date, previousRange),
    [previousRange, scopedDailyStats],
  );

  const sortedTimeframeDailyStats = useMemo(
    () => timeframeDailyStats.slice().sort((left, right) => left.report_date.localeCompare(right.report_date)),
    [timeframeDailyStats],
  );
  const sortedScopedDailyStats = useMemo(
    () => scopedDailyStats.slice().sort((left, right) => left.report_date.localeCompare(right.report_date)),
    [scopedDailyStats],
  );

  const kpis = useMemo(
    () => getClientKpis(scopedClients, scopedCampaigns, timeframeLeads, timeframeStats),
    [scopedCampaigns, scopedClients, timeframeLeads, timeframeStats],
  );
  const previousKpis = useMemo(
    () => getClientKpis(scopedClients, scopedCampaigns, previousLeads, previousCampaignStats),
    [previousCampaignStats, previousLeads, scopedCampaigns, scopedClients],
  );
  const latestProspects = sortedScopedDailyStats[sortedScopedDailyStats.length - 1]?.prospects_count ?? kpis.prospects;
  const previousProspects = useMemo(() => {
    const sorted = previousDailyStats.slice().sort((left, right) => left.report_date.localeCompare(right.report_date));
    const latest = sorted[sorted.length - 1]?.prospects_count;
    return latest ?? null;
  }, [previousDailyStats]);

  const dailySent = useMemo(() => getDailySentSeries(timeframeStats), [timeframeStats]);
  const allTimeDailySent = useMemo(() => getDailySentSeries(scopedStats), [scopedStats]);
  const performance = useMemo(
    () => getCampaignPerformance(scopedCampaigns, timeframeStats).slice(0, 6),
    [scopedCampaigns, timeframeStats],
  );

  const weeklyLeadsSeries = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const lead of timeframeLeads) {
      if (lead.qualification !== "MQL") continue;
      const date = parseUnknownDate(lead.updated_at || lead.created_at);
      if (!date) continue;
      const key = toWeekStartKey(date);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }

    return Array.from(byWeek.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-8)
      .map(([weekStart, count]) => ({
        weekStart,
        label: formatDate(weekStart, { day: "numeric", month: "numeric" }),
        count,
      }));
  }, [timeframeLeads]);

  const monthlyLeadsSeries = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const item of sortedScopedDailyStats) {
      const date = parseUnknownDate(item.report_date);
      if (!date) continue;
      const key = toMonthKey(date);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (item.mql_count ?? 0));
    }

    return Array.from(byMonth.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-12)
      .map(([month, leadsCount]) => ({
        month,
        label: monthLabelFromKey(month),
        leadsCount,
      }));
  }, [sortedScopedDailyStats]);

  const prospectsAddedDailySeries = useMemo(() => {
    let previous: number | null = null;
    const points = sortedTimeframeDailyStats.map((item) => {
      const current = item.prospects_count ?? 0;
      const delta = previous === null ? current : current - previous;
      previous = current;
      return {
        date: item.report_date,
        label: formatDate(item.report_date, { day: "numeric", month: "numeric" }),
        prospectsAdded: delta,
      };
    });

    return points.slice(-10);
  }, [sortedTimeframeDailyStats]);

  const sentLastThreeMonthsSeries = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const item of scopedStats) {
      const date = parseUnknownDate(item.report_date);
      if (!date) continue;
      const key = toMonthKey(date);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (item.sent_count ?? 0));
    }

    return Array.from(byMonth.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-3)
      .map(([month, sent]) => ({
        month,
        label: monthLabelFromKey(month),
        sent,
      }));
  }, [scopedStats]);

  const prospectsAddedByMonthSeries = useMemo(() => {
    const byMonth = new Map<string, number>();
    let previous: number | null = null;

    for (const item of sortedScopedDailyStats) {
      const current = item.prospects_count ?? 0;
      const delta = previous === null ? current : current - previous;
      previous = current;

      const date = parseUnknownDate(item.report_date);
      if (!date) continue;
      const key = toMonthKey(date);
      byMonth.set(key, (byMonth.get(key) ?? 0) + delta);
    }

    return Array.from(byMonth.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-12)
      .map(([month, prospectsAdded]) => ({
        month,
        label: monthLabelFromKey(month),
        prospectsAdded,
      }));
  }, [sortedScopedDailyStats]);

  const velocitySeries = useMemo(() => {
    const byWeek = new Map<string, { sent: number; mqls: number }>();

    for (const stat of timeframeStats) {
      const date = parseUnknownDate(stat.report_date);
      if (!date) continue;
      const key = toWeekStartKey(date);
      const current = byWeek.get(key) ?? { sent: 0, mqls: 0 };
      current.sent += stat.sent_count ?? 0;
      byWeek.set(key, current);
    }

    for (const lead of timeframeLeads) {
      if (lead.qualification !== "MQL") continue;
      const date = parseUnknownDate(lead.updated_at || lead.created_at);
      if (!date) continue;
      const key = toWeekStartKey(date);
      const current = byWeek.get(key) ?? { sent: 0, mqls: 0 };
      current.mqls += 1;
      byWeek.set(key, current);
    }

    let previousSent: number | null = null;

    return Array.from(byWeek.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-8)
      .map(([week, values]) => {
        const sentDelta = previousSent === null ? values.sent : values.sent - previousSent;
        previousSent = values.sent;
        return {
          week,
          label: formatDate(week, { day: "numeric", month: "short" }),
          emailsDelta: sentDelta,
          mqls: values.mqls,
        };
      });
  }, [timeframeLeads, timeframeStats]);

  const conversion = useMemo(() => getConversionRates(scopedLeads, latestProspects), [latestProspects, scopedLeads]);
  const maxConversion = Math.max(1, ...conversion.map((item) => item.value));

  const mqlSpark = useMemo(() => weeklyLeadsSeries.map((item) => item.count).slice(-6), [weeklyLeadsSeries]);
  const meetingsSpark = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const lead of timeframeLeads) {
      if (!lead.meeting_booked) continue;
      const date = parseUnknownDate(lead.updated_at || lead.created_at);
      if (!date) continue;
      const key = toWeekStartKey(date);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    return Array.from(byWeek.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, count]) => count)
      .slice(-6);
  }, [timeframeLeads]);
  const wonSpark = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const lead of timeframeLeads) {
      if (!lead.won) continue;
      const date = parseUnknownDate(lead.updated_at || lead.created_at);
      if (!date) continue;
      const key = toWeekStartKey(date);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    return Array.from(byWeek.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, count]) => count)
      .slice(-6);
  }, [timeframeLeads]);
  const emailsSpark = useMemo(() => dailySent.map((item) => item.sent).slice(-7), [dailySent]);
  const prospectsSpark = useMemo(
    () => prospectsAddedByMonthSeries.map((item) => item.prospectsAdded).slice(-7),
    [prospectsAddedByMonthSeries],
  );

  const cardDelta = {
    mqls: toPercentChange(kpis.mqls, previousKpis.mqls),
    meetings: toPercentChange(kpis.meetings, previousKpis.meetings),
    won: toPercentChange(kpis.won, previousKpis.won),
    sent: toPercentChange(kpis.emailsSent, previousKpis.emailsSent),
    prospects: toPercentChange(latestProspects, previousProspects),
  };

  const timeframeLabel = getTimeframeLabel(timeframe);

  return (
    <div className="space-y-8">
      <PortalPageHeader
        title="Dashboard"
        subtitle="Your lead generation overview"
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <DashboardKpiCard
          label="MQLs Delivered"
          value={formatNumber(kpis.mqls)}
          percent={cardDelta.mqls}
          spark={mqlSpark}
          tone="green"
          icon={<Target className="h-4 w-4" />}
        />
        <DashboardKpiCard
          label="Meetings Booked"
          value={formatNumber(kpis.meetings)}
          percent={cardDelta.meetings}
          spark={meetingsSpark}
          tone="purple"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <DashboardKpiCard
          label="Deals Won"
          value={formatNumber(kpis.won)}
          percent={cardDelta.won}
          spark={wonSpark}
          tone="amber"
          icon={<Trophy className="h-4 w-4" />}
        />
        <DashboardKpiCard
          label="Emails Sent"
          value={formatCompact(kpis.emailsSent)}
          percent={cardDelta.sent}
          spark={emailsSpark}
          tone="blue"
          icon={<Send className="h-4 w-4" />}
        />
        <DashboardKpiCard
          label="Prospects"
          value={formatCompact(latestProspects)}
          percent={cardDelta.prospects}
          spark={prospectsSpark}
          tone="indigo"
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="Daily sent (last 30 days)" subtitle={`campaign_daily_stats.sent_count aggregated by report_date (${timeframeLabel})`}>
          {dailySent.length === 0 ? (
            <EmptyPortalState title="No sent data" description="No campaign_daily_stats rows exist for this client scope." />
          ) : (
            <ResponsiveChart>
              <BarChart data={dailySent}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="sent" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>

        <ChartPanel title="Leads Count per week" subtitle="client_daily_snapshots.mql_diff grouped by ISO week">
          {weeklyLeadsSeries.length === 0 ? (
            <EmptyPortalState title="No weekly lead data" description="No MQL activity for selected range." />
          ) : (
            <ResponsiveChart>
              <BarChart data={weeklyLeadsSeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="Leads Count per month" subtitle="client_daily_snapshots.mql_diff Σ per calendar month">
          {monthlyLeadsSeries.length === 0 ? (
            <EmptyPortalState title="No monthly lead data" description="Historical client snapshots are empty." />
          ) : (
            <ResponsiveChart>
              <BarChart data={monthlyLeadsSeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="leadsCount" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>

        <ChartPanel title="Prospects added" subtitle="Δ client_daily_snapshots.prospects_count by date">
          {prospectsAddedDailySeries.length === 0 ? (
            <EmptyPortalState title="No prospects delta" description="Not enough daily snapshot data to calculate deltas." />
          ) : (
            <ResponsiveChart>
              <BarChart data={prospectsAddedDailySeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="prospectsAdded" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="Sent count for last three months" subtitle="campaign_daily_stats.sent_count Σ per month">
          {sentLastThreeMonthsSeries.length === 0 ? (
            <EmptyPortalState title="No monthly sent data" description="No campaign stats in this client scope." />
          ) : (
            <ResponsiveChart>
              <BarChart data={sentLastThreeMonthsSeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="sent" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>

        <ChartPanel title="Prospects added by Month" subtitle="monthly Δ of client_daily_snapshots.prospects_count">
          {prospectsAddedByMonthSeries.length === 0 ? (
            <EmptyPortalState title="No monthly prospect deltas" description="Daily snapshots are required for this view." />
          ) : (
            <ResponsiveChart>
              <BarChart data={prospectsAddedByMonthSeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="prospectsAdded" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="Velocity Chart" subtitle="Emails sent vs MQLs for selected period">
          {velocitySeries.length === 0 ? (
            <EmptyPortalState title="No velocity data" description="Not enough campaign or lead movement in selected timeframe." />
          ) : (
            <ResponsiveChart>
              <ComposedChart data={velocitySeries}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar yAxisId="left" dataKey="emailsDelta" radius={[4, 4, 0, 0]}>
                  {velocitySeries.map((item) => (
                    <Cell key={item.week} fill={item.emailsDelta >= 0 ? "#3b82f6" : "#1d4ed8"} />
                  ))}
                </Bar>
                <Line yAxisId="right" dataKey="mqls" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveChart>
          )}
        </ChartPanel>

        <PortalSurface title="Conversion Funnel" subtitle="All-time: prospects → MQL → meeting → won">
          <div className="space-y-5">
            {conversion.map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-base">
                  <span>{item.label}</span>
                  <span style={{ color: item.color }}>
                    {formatNumber(item.value)} {item.rateLabel ? <span className="ml-2 text-neutral-400">← {item.rateLabel}</span> : null}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-[#151515]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, (item.value / maxConversion) * 100)}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}

            <div className="border-t border-[#1f1f1f] pt-5">
              <p className="text-base text-neutral-300">Campaign reply rates (selected period)</p>
              <div className="mt-3 space-y-2">
                {performance.length === 0 ? (
                  <p className="text-sm text-neutral-500">No campaign performance for selected range.</p>
                ) : (
                  performance.map((campaign) => {
                    const color = campaign.replyRate >= 5 ? "#22c55e" : "#facc15";
                    return (
                      <div key={campaign.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-neutral-300">{campaign.name}</span>
                        <span style={{ color }}>{campaign.replyRate.toFixed(1)}%</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </PortalSurface>
      </div>
    </div>
  );
}
