import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, MetricCard, Surface } from "../components/app-ui";
import { repository } from "../data/repository";
import { DASHBOARD_CHART_TOOLTIP, MOMENTUM_CHARTS, formatCountSeries, formatMomentumSeries, mapDashboardError, pipelineCountsFromGroups } from "../lib/dashboard-momentum";
import { formatDate, formatNumber } from "../lib/format";
import type { AdminDashboardOverview } from "../types/view-contracts";
import { useAuth } from "../providers/auth";

function useAdminDashboard() {
  const { identity, loading: authLoading } = useAuth();
  const [data, setData] = useState<AdminDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await repository.loadAdminDashboardOverview();
      setData(result);
      setError(null);
    } catch (reason) {
      setError(mapDashboardError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !identity) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, identity, load]);

  return { data, loading, error, refresh: load };
}

export function AdminDashboardPage() {
  const { data, loading, error, refresh } = useAdminDashboard();

  const pipelineCounts = useMemo(() => pipelineCountsFromGroups(data?.pipelineGroups), [data]);

  const campaignSeries = useMemo(() => formatMomentumSeries(data?.campaignMomentum21d), [data]);
  const clientsWithLeadsSeries = useMemo(() => formatCountSeries(data?.clientsWithLeads21d), [data]);
  const activeClientsWithSentSeries = useMemo(() => formatCountSeries(data?.activeClientsWithSent21d), [data]);

  const managerCapacityRows = useMemo(() => {
    return (data?.managerCapacity ?? []).map((row) => ({
      managerName: row.managerName,
      managerRole: row.managerRole,
      clients: row.clientsCount,
      activeCampaigns: row.activeCampaignsCount,
      leads: row.leadsCount,
    }));
  }, [data]);

  const metrics = useMemo(() => [
    {
      label: "Clients",
      value: formatNumber(data?.metrics.clientsCount ?? 0),
      hint: `${formatNumber(data?.metrics.activeClientsCount ?? 0)} active · ${formatNumber(data?.metrics.clientsWithoutManager ?? 0)} without manager`,
      tone: "info" as const,
    },
    {
      label: "Active campaigns",
      value: formatNumber(data?.metrics.activeCampaignsCount ?? 0),
      hint: "Global operational volume",
      tone: "success" as const,
    },
    {
      label: "MQLs (SQLs)",
      value: formatNumber(pipelineCounts.mql),
      hint: `${formatNumber(pipelineCounts.beyondMql)} moved beyond MQL · last 21 days`,
      tone: "neutral" as const,
    },
    {
      label: "preMQLs",
      value: formatNumber(pipelineCounts.preMql),
      hint: `${formatNumber(pipelineCounts.unqualified)} not yet qualified · last 21 days`,
      tone: "neutral" as const,
    },
  ], [data, pipelineCounts]);

  const latestSnapshotDate = data?.latestSnapshotDate ?? null;

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton
          onClick={() => {
            void refresh();
          }}
        >
          Retry data sync
        </InlineLinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {MOMENTUM_CHARTS.map((chart) => (
            <Surface key={chart.key} title={chart.title} subtitle={chart.subtitle}>
              {campaignSeries.length === 0 ? (
                <EmptyState title="No campaign trend data" description="No campaign trend data is available for the current scope." />
              ) : (
                <>
                  <ChartTextSummary summary={`${chart.title} chart with ${campaignSeries.length} daily points.`} />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={campaignSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip {...DASHBOARD_CHART_TOOLTIP} />
                        <Area type="monotone" dataKey={chart.key} stroke={chart.stroke} fill={chart.fill} strokeWidth={2} />
                        <Line type="monotone" dataKey={`${chart.key}_trend`} stroke={chart.stroke} strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Surface>
          ))}

          <Surface title="Daily count of clients with at least one new lead received" subtitle="">
            {clientsWithLeadsSeries.length === 0 ? (
              <EmptyState title="No lead data" description="No leads were created in the last 21 days." />
            ) : (
              <>
                <ChartTextSummary summary={`Clients receiving leads chart with ${clientsWithLeadsSeries.length} daily points.`} />
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={clientsWithLeadsSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...DASHBOARD_CHART_TOOLTIP} />
                      <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="count_trend" stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Surface>

          <Surface title="Daily count of Active-status clients with at least one email sent" subtitle="">
            {activeClientsWithSentSeries.length === 0 ? (
              <EmptyState title="No send data" description="No Active clients had emails sent in the last 21 days." />
            ) : (
              <>
                <ChartTextSummary summary={`Active clients sending chart with ${activeClientsWithSentSeries.length} daily points.`} />
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={activeClientsWithSentSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...DASHBOARD_CHART_TOOLTIP} />
                      <Line type="monotone" dataKey="count" stroke="#38bdf8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="count_trend" stroke="#38bdf8" strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Surface>
        </div>

        <Surface
          title="Team capacity"
          subtitle=""
          actions={<p className="text-xs text-muted-foreground">Snapshot: {formatDate(latestSnapshotDate)}</p>}
        >
          {managerCapacityRows.length === 0 ? (
            <EmptyState title="No team capacity data" description="Assign clients to managers to populate this section." />
          ) : (
            <div className="space-y-3">
              {managerCapacityRows.map((row) => (
                <div key={row.managerName} className="rounded-2xl border border-border bg-black/10 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm">{row.managerName}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${row.managerRole === "admin" ? "bg-violet-500/15 text-violet-400" : "bg-sky-500/15 text-sky-400"}`}>
                      {row.managerRole === "admin" ? "Admin" : "CS Manager"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Clients</p>
                      <p>{formatNumber(row.clients)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Active campaigns</p>
                      <p>{formatNumber(row.activeCampaigns)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Leads</p>
                      <p>{formatNumber(row.leads)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
