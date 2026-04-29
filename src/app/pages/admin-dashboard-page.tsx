import { useMemo } from "react";
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
import { formatDate, formatNumber } from "../lib/format";
import {
  scopeCampaignStats,
  scopeCampaigns,
  scopeClients,
  scopeDailyStats,
  scopeLeads,
} from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

const TOOLTIP = {
  contentStyle: {
    backgroundColor: "rgba(2,6,23,0.98)",
    border: "1px solid rgba(148,163,184,0.2)",
    borderRadius: "16px",
    color: "#fff",
  },
  labelStyle: {
    color: "rgba(226,232,240,0.92)",
  },
  itemStyle: {
    color: "#f8fafc",
  },
  cursor: false,
};

const MOMENTUM_CHARTS = [
  {
    key: "sent" as const,
    title: "Campaign momentum: Sent",
    subtitle: "21-day sent trend.",
    stroke: "#38bdf8",
    fill: "#38bdf822",
  },
  {
    key: "replies" as const,
    title: "Campaign momentum: Replies",
    subtitle: "21-day replies trend.",
    stroke: "#22c55e",
    fill: "#22c55e22",
  },
  {
    key: "positive" as const,
    title: "Campaign momentum: Positive",
    subtitle: "21-day positive replies trend.",
    stroke: "#f59e0b",
    fill: "#f59e0b22",
  },
];

export function AdminDashboardPage() {
  const { identity } = useAuth();
  const { users, clients, campaigns, leads, campaignDailyStats, dailyStats, loading, error, refresh } = useCoreData();

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedCampaignStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const scopedDailyStats = useMemo(
    () => (identity ? scopeDailyStats(identity, clients, dailyStats) : []),
    [clients, dailyStats, identity],
  );

  const managerIds = useMemo(
    () => new Set(users.filter((user) => user.role === "manager").map((user) => user.id)),
    [users],
  );

  const clientsWithoutManager = useMemo(
    () => scopedClients.filter((client) => !managerIds.has(client.manager_id)).length,
    [managerIds, scopedClients],
  );

  const campaignSeries = useMemo(() => {
    const grouped = new Map<string, { date: string; sent: number; replies: number; positive: number }>();

    for (const item of scopedCampaignStats) {
      const key = item.report_date;
      const current = grouped.get(key) ?? { date: key, sent: 0, replies: 0, positive: 0 };
      current.sent += item.sent_count ?? 0;
      current.replies += item.reply_count ?? 0;
      current.positive += item.positive_replies_count ?? 0;
      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-21)
      .map((item) => ({
        ...item,
        label: formatDate(item.date, { day: "2-digit", month: "short" }),
      }));
  }, [scopedCampaignStats]);

  const managerCapacityRows = useMemo(() => {
    const byManager = new Map<string, { managerName: string; clients: number; activeCampaigns: number; leads: number }>();

    for (const client of scopedClients) {
      const manager = users.find((item) => item.id === client.manager_id);
      const managerName = manager ? `${manager.first_name} ${manager.last_name}`.trim() : "Unassigned";
      const key = manager?.id ?? `unknown:${client.manager_id}`;

      const current = byManager.get(key) ?? {
        managerName,
        clients: 0,
        activeCampaigns: 0,
        leads: 0,
      };

      current.clients += 1;
      current.activeCampaigns += scopedCampaigns.filter(
        (campaign) => campaign.client_id === client.id && campaign.status === "active",
      ).length;
      current.leads += scopedLeads.filter((lead) => lead.client_id === client.id).length;
      byManager.set(key, current);
    }

    return Array.from(byManager.values())
      .sort((left, right) => right.clients - left.clients)
      .slice(0, 8);
  }, [scopedCampaigns, scopedClients, scopedLeads, users]);

  const latestSnapshotDate = scopedDailyStats
    .map((item) => item.report_date)
    .sort((left, right) => right.localeCompare(left))[0];

  const metrics = [
    {
      label: "Clients",
      value: formatNumber(scopedClients.length),
      hint: `${formatNumber(clientsWithoutManager)} without valid manager assignment`,
      tone: "info" as const,
    },
    {
      label: "Active campaigns",
      value: formatNumber(scopedCampaigns.filter((campaign) => campaign.status === "active").length),
      hint: "Global operational volume",
      tone: "success" as const,
    },
    {
      label: "Lead pipeline",
      value: formatNumber(scopedLeads.length),
      hint: `${formatNumber(scopedLeads.filter((lead) => lead.won).length)} won leads`,
      tone: "neutral" as const,
    },
  ];

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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                        <Tooltip {...TOOLTIP} />
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
