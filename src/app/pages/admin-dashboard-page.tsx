import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { repository } from "../data/repository";
import { DASHBOARD_CHART_TOOLTIP, MOMENTUM_CHARTS, formatMomentumSeries, mapDashboardError, pipelineCountsFromGroups } from "../lib/dashboard-momentum";
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

  const managerCapacityRows = useMemo(() => {
    return (data?.managerCapacity ?? []).map((row) => ({
      managerName: row.managerName,
      clients: row.clientsCount,
      activeCampaigns: row.activeCampaignsCount,
      leads: row.leadsCount,
    }));
  }, [data]);

  const metrics = useMemo(() => [
    {
      label: "Clients",
      value: formatNumber(data?.metrics.clientsCount ?? 0),
      hint: `${formatNumber(data?.metrics.clientsWithoutManager ?? 0)} without valid manager assignment`,
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
      hint: `${formatNumber(pipelineCounts.beyondMql)} moved beyond MQL`,
      tone: "neutral" as const,
    },
    {
      label: "preMQLs",
      value: formatNumber(pipelineCounts.preMql),
      hint: `${formatNumber(pipelineCounts.unqualified)} not yet qualified`,
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
        <PageHeader
          title="Admin Dashboard"
          subtitle="Global operational command center for portfolio health and assignments."
        />
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
      <PageHeader
        title="Admin Dashboard"
        subtitle="Global command surface: assignment health and campaign momentum."
      />
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
                      <AreaChart data={campaignSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip {...DASHBOARD_CHART_TOOLTIP} />
                        <Area type="monotone" dataKey={chart.key} stroke={chart.stroke} fill={chart.fill} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Surface>
          ))}
        </div>

        <Surface
          title="Manager capacity"
          subtitle="Visible load split across managers and assignments."
          actions={<p className="text-xs text-muted-foreground">Snapshot: {formatDate(latestSnapshotDate)}</p>}
        >
          {managerCapacityRows.length === 0 ? (
            <EmptyState title="No manager capacity data" description="Assign clients to managers to populate this section." />
          ) : (
            <div className="space-y-3">
              {managerCapacityRows.map((row) => (
                <div key={row.managerName} className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-sm">{row.managerName}</p>
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
