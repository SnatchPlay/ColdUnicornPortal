import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banner, EmptyState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatNumber } from "../lib/format";
import {
  scopeCampaignStats,
  scopeCampaigns,
  scopeClients,
  scopeDailyStats,
  scopeLeads,
} from "../lib/selectors";
import { useCoreData } from "../providers/core-data";
import { useAuth } from "../providers/auth";
import { ClientDashboardPage } from "./client-dashboard-page";
import { ManagerDashboardPage } from "./manager-dashboard-page";

const TT = {
  contentStyle: {
    backgroundColor: "rgba(2,6,23,0.98)",
    border: "1px solid rgba(148,163,184,0.2)",
    borderRadius: "16px",
    color: "#fff",
  },
};

export function DashboardPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientDashboardPage />;
  if (identity?.role === "manager") return <ManagerDashboardPage />;
  return <InternalDashboardPage />;
}

function InternalDashboardPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, campaignDailyStats, dailyStats, error } = useCoreData();

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedCampaignDailyStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const scopedDailyStats = useMemo(
    () => (identity ? scopeDailyStats(identity, clients, dailyStats) : []),
    [clients, dailyStats, identity],
  );

  const metrics = useMemo(() => {
    const activeCampaigns = scopedCampaigns.filter((item) => item.status === "active").length;
    const mqls = scopedLeads.filter((item) => item.qualification === "MQL").length;
    const preMqls = scopedLeads.filter((item) => item.qualification === "preMQL").length;
    const won = scopedLeads.filter((item) => item.won).length;

    return [
      { label: "Clients", value: formatNumber(scopedClients.length), hint: "Scoped by current role", tone: "info" as const },
      { label: "Active campaigns", value: formatNumber(activeCampaigns), hint: "Outreach campaigns currently active", tone: "success" as const },
      { label: "MQLs", value: formatNumber(mqls), hint: `${formatNumber(preMqls)} preMQL in the same scope`, tone: "neutral" as const },
      { label: "Won", value: formatNumber(won), hint: "Closed opportunities from visible lead set", tone: "warning" as const },
    ];
  }, [scopedCampaigns, scopedClients.length, scopedLeads]);

  const statSeries = useMemo(() => {
    const map = new Map<string, { date: string; sent: number; replies: number; bounces: number; positive: number }>();
    for (const item of scopedCampaignDailyStats) {
      const key = item.report_date;
      const current = map.get(key) ?? {
        date: key,
        sent: 0,
        replies: 0,
        bounces: 0,
        positive: 0,
      };
      current.sent += item.sent_count ?? 0;
      current.replies += item.reply_count ?? 0;
      current.bounces += item.bounce_count ?? 0;
      current.positive += item.positive_replies_count ?? 0;
      map.set(key, current);
    }
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
      .map((item) => ({
        ...item,
        label: formatDate(item.date, { day: "2-digit", month: "short" }),
      }));
  }, [scopedCampaignDailyStats]);

  const dailySeries = useMemo(
    () =>
      scopedDailyStats
        .slice()
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .slice(-14)
        .map((item) => ({
          label: formatDate(item.report_date, { day: "2-digit", month: "short" }),
          emailsSent: item.emails_sent,
          responseCount: item.response_count,
          mqlCount: item.mql_count,
        })),
    [scopedDailyStats],
  );

  const topCampaigns = useMemo(
    () =>
      scopedCampaigns
        .slice()
        .sort((a, b) => (b.positive_responses ?? 0) - (a.positive_responses ?? 0))
        .slice(0, 6),
    [scopedCampaigns],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Cross-module overview for the current role scope. Metrics and charts come from the live schema contract."
      />

      {error && <Banner tone="warning">{error}</Banner>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Surface title="Campaign performance" subtitle="Daily sent, replies, bounces, and positive replies from campaign_daily_stats.">
          {statSeries.length === 0 ? (
            <EmptyState title="No campaign statistics yet" description="campaign_daily_stats is empty for the current role scope." />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={statSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TT} />
                  <Area type="monotone" dataKey="sent" stroke="#38bdf8" fill="#38bdf822" strokeWidth={2} />
                  <Area type="monotone" dataKey="replies" stroke="#22c55e" fill="#22c55e22" strokeWidth={2} />
                  <Area type="monotone" dataKey="bounces" stroke="#f97316" fill="#f9731622" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Surface>

        <Surface title="Top campaigns" subtitle="Sorted by positive_responses from campaigns.">
          {topCampaigns.length === 0 ? (
            <EmptyState title="No campaigns available" description="Once outreach campaigns exist, this panel will rank them." />
          ) : (
            <div className="space-y-3">
              {topCampaigns.map((campaign) => (
                <div key={campaign.id} className="rounded-2xl border border-border bg-black/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm">{campaign.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {campaign.status} · {campaign.type}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl">{formatNumber(campaign.positive_responses)}</p>
                      <p className="text-xs text-muted-foreground">positive responses</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      <Surface title="Daily client snapshots" subtitle="Secondary analytics from daily_stats.">
        {dailySeries.length === 0 ? (
          <EmptyState
            title="daily_stats is not populated yet"
            description="Manager and admin operational dashboards will deepen once this table receives real synchronized data."
          />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Bar dataKey="emailsSent" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="responseCount" fill="#a78bfa" radius={[6, 6, 0, 0]} />
                <Bar dataKey="mqlCount" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Surface>
    </div>
  );
}
