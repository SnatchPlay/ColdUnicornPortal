import { useMemo } from "react";
import {
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { formatDate } from "../lib/format";
import { scopeCampaignStats, scopeCampaigns, scopeClients, scopeLeads } from "../lib/selectors";
import { useCoreData } from "../providers/core-data";
import { useAuth } from "../providers/auth";
import { ClientStatisticsPage } from "./client-statistics-page";

const PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"];

export function StatisticsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientStatisticsPage />;
  return <InternalStatisticsPage />;
}

function InternalStatisticsPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, campaignDailyStats, loading, error, refresh } = useCoreData();

  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );

  const trendSeries = useMemo(
    () =>
      scopedStats
        .slice()
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .map((item) => ({
          label: formatDate(item.report_date, { day: "2-digit", month: "short" }),
          sent: item.sent_count ?? 0,
          replies: item.reply_count ?? 0,
          opens: item.unique_open_count ?? 0,
          bounces: item.bounce_count ?? 0,
        })),
    [scopedStats],
  );

  const qualificationSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of scopedLeads) {
      const key = item.qualification ?? "unqualified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [scopedLeads]);

  const campaignSeries = useMemo(
    () =>
      scopedCampaigns.map((campaign) => ({
        name: campaign.name,
        databaseSize: campaign.database_size ?? 0,
        positiveResponses: campaign.positive_responses,
      })),
    [scopedCampaigns],
  );

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Statistics"
          subtitle="Shared analytics layer built on top of campaign_daily_stats and role-scoped campaign metadata."
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
        title="Statistics"
        subtitle="Shared analytics layer built on top of campaign_daily_stats and role-scoped campaign metadata."
      />

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Surface title="Trend lines" subtitle="Sent, replies, opens, and bounces over time.">
          {trendSeries.length === 0 ? (
            <EmptyState title="No trend data yet" description="The statistics page needs campaign_daily_stats rows for the current scope." />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(2,6,23,0.98)",
                      border: "1px solid rgba(148,163,184,0.2)",
                      borderRadius: "16px",
                      color: "#fff",
                    }}
                  />
                  <Line type="monotone" dataKey="sent" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="replies" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="opens" stroke="#a78bfa" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Surface>

        <Surface title="Lead qualification mix" subtitle="Based on visible lead records.">
          {qualificationSeries.length === 0 ? (
            <EmptyState title="No leads available" description="Once visible leads exist, the qualification mix appears here." />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={qualificationSeries} dataKey="value" nameKey="name" outerRadius={110} innerRadius={64}>
                    {qualificationSeries.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(2,6,23,0.98)",
                      border: "1px solid rgba(148,163,184,0.2)",
                      borderRadius: "16px",
                      color: "#fff",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Surface>
      </div>

      <Surface title="Campaign portfolio" subtitle="Size and response density across visible campaigns.">
        {campaignSeries.length === 0 ? (
          <EmptyState title="No campaigns in scope" description="Once campaigns are visible, this section becomes available." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {campaignSeries.map((campaign) => (
              <div key={campaign.name} className="rounded-2xl border border-border bg-black/10 p-4">
                <p className="text-sm">{campaign.name}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database</p>
                    <p className="mt-1">{campaign.databaseSize}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Positive</p>
                    <p className="mt-1">{campaign.positiveResponses}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
