import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
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
  getPipelineActivitySeries,
  formatCompact,
} from "../lib/client-view-models";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { scopeCampaignStats, scopeCampaigns, scopeClients, scopeLeads } from "../lib/selectors";
import { formatNumber } from "../lib/format";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

export function ClientStatisticsPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, campaignDailyStats, loading, error, refresh } = useCoreData();
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());

  if (loading) {
    return <PortalLoadingState title="Loading analytics" description="Building conversion and performance views." />;
  }

  if (error) {
    return (
      <PortalErrorState
        title="Analytics data is unavailable"
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
  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (lead) => lead.updated_at || lead.created_at, timeframe),
    [scopedLeads, timeframe],
  );
  const timeframeStats = useMemo(
    () => filterByTimeframe(scopedStats, (stat) => stat.report_date, timeframe),
    [scopedStats, timeframe],
  );
  const kpis = useMemo(
    () => getClientKpis(scopedClients, scopedCampaigns, timeframeLeads, timeframeStats),
    [scopedCampaigns, scopedClients, timeframeLeads, timeframeStats],
  );
  const dailySent = useMemo(() => getDailySentSeries(timeframeStats), [timeframeStats]);
  const activity = useMemo(() => getPipelineActivitySeries(timeframeLeads), [timeframeLeads]);
  const performance = useMemo(() => getCampaignPerformance(scopedCampaigns, timeframeStats), [scopedCampaigns, timeframeStats]);
  const conversion = useMemo(() => getConversionRates(timeframeLeads, kpis.prospects), [kpis.prospects, timeframeLeads]);
  const timeframeLabel = getTimeframeLabel(timeframe);

  return (
    <div className="space-y-8">
      <PortalPageHeader
        title="Analytics"
        subtitle="Your campaign performance and pipeline analytics"
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="MQLs Delivered" value={formatNumber(kpis.mqls)} hint={`${kpis.prospects ? ((kpis.mqls / kpis.prospects) * 100).toFixed(1) : "0.0"}% prospect→MQL`} tone="blue" />
        <KpiTile label="Meetings Booked" value={formatNumber(kpis.meetings)} hint={`${kpis.mqls ? ((kpis.meetings / kpis.mqls) * 100).toFixed(1) : "0.0"}% MQL→meeting`} tone="purple" />
        <KpiTile label="Deals Won" value={formatNumber(kpis.won)} hint={`${kpis.meetings ? ((kpis.won / kpis.meetings) * 100).toFixed(1) : "0.0"}% meeting→won`} tone="green" />
        <KpiTile label="Prospects Base" value={formatCompact(kpis.prospects)} hint="current visible outreach base" tone="indigo" />
      </div>

      <ChartPanel title="Pipeline Activity" subtitle={`New MQLs, meetings booked, and deals won over time (${timeframeLabel})`}>
        {activity.length === 0 ? (
          <EmptyPortalState title="No pipeline activity" description="No live lead timestamps are available for this view." />
        ) : (
          <ResponsiveChart>
            <LineChart data={activity}>
              <CartesianGrid stroke="#141414" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
              <ChartTooltip />
              <Line type="monotone" dataKey="mqls" stroke="#3b82f6" strokeWidth={2.5} />
              <Line type="monotone" dataKey="meetings" stroke="#8b5cf6" strokeWidth={2.5} />
              <Line type="monotone" dataKey="won" stroke="#22c55e" strokeWidth={2.5} />
            </LineChart>
          </ResponsiveChart>
        )}
      </ChartPanel>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="Daily sent" subtitle={`campaign_daily_stats.sent_count for the selected scope (${timeframeLabel})`}>
          {dailySent.length === 0 ? (
            <EmptyPortalState title="No send volume" description="No campaign_daily_stats rows exist for this client." />
          ) : (
            <ResponsiveChart>
              <AreaChart data={dailySent}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Area type="monotone" dataKey="sent" stroke="#22c55e" fill="#22c55e22" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveChart>
          )}
        </ChartPanel>

        <ChartPanel title="Campaign reply rates" subtitle={`Reply rate ranking by campaign (${timeframeLabel})`}>
          {performance.length === 0 ? (
            <EmptyPortalState title="No campaign stats" description="Campaign performance needs campaign_daily_stats rows." />
          ) : (
            <ResponsiveChart>
              <BarChart data={performance.slice(0, 8)}>
                <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                <ChartTooltip />
                <Bar dataKey="replyRate" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveChart>
          )}
        </ChartPanel>
      </div>

      <PortalSurface title="Conversion Funnel" subtitle="Live-schema funnel: prospects → MQL → meeting → won">
        <div className="space-y-5">
          {conversion.map((item) => (
            <div key={item.label}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-base text-white">{item.label}</p>
                <p className="text-sm text-white">
                  {formatNumber(item.value)} {item.rateLabel && <span className="ml-3 text-neutral-400">← {item.rateLabel}</span>}
                </p>
              </div>
              <div className="h-2 rounded-full bg-[#151515]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (item.value / Math.max(1, kpis.prospects)) * 100)}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </PortalSurface>
    </div>
  );
}
