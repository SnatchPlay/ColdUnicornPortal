import { useEffect, useMemo, useState } from "react";
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
import { DateRangeButton } from "../components/portal-ui";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaignStats, scopeCampaigns, scopeClients, scopeLeads } from "../lib/selectors";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { useCoreData } from "../providers/core-data";
import { useAuth } from "../providers/auth";
import { ClientStatisticsPage } from "./client-statistics-page";

const PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#f97316"];
const ALL_FILTER_VALUE = "__all__";

export function StatisticsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientStatisticsPage />;
  return <InternalStatisticsPage />;
}

function InternalStatisticsPage() {
  const { identity } = useAuth();
  const { clients, campaigns, leads, campaignDailyStats, loading, error, refresh } = useCoreData();
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());
  const [clientFilterId, setClientFilterId] = useState(ALL_FILTER_VALUE);
  const [campaignFilterId, setCampaignFilterId] = useState(ALL_FILTER_VALUE);

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

  const campaignById = useMemo(() => new Map(scopedCampaigns.map((item) => [item.id, item])), [scopedCampaigns]);

  const clientFilteredCampaigns = useMemo(
    () =>
      clientFilterId === ALL_FILTER_VALUE
        ? scopedCampaigns
        : scopedCampaigns.filter((item) => item.client_id === clientFilterId),
    [clientFilterId, scopedCampaigns],
  );

  useEffect(() => {
    if (campaignFilterId === ALL_FILTER_VALUE) return;
    if (!clientFilteredCampaigns.some((item) => item.id === campaignFilterId)) {
      setCampaignFilterId(ALL_FILTER_VALUE);
    }
  }, [campaignFilterId, clientFilteredCampaigns]);

  const timeframeStats = useMemo(
    () => filterByTimeframe(scopedStats, (item) => item.report_date, timeframe),
    [scopedStats, timeframe],
  );
  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (item) => item.updated_at || item.created_at, timeframe),
    [scopedLeads, timeframe],
  );

  const filteredStats = useMemo(
    () =>
      timeframeStats.filter((item) => {
        const campaign = campaignById.get(item.campaign_id);
        if (!campaign) return false;
        if (clientFilterId !== ALL_FILTER_VALUE && campaign.client_id !== clientFilterId) return false;
        if (campaignFilterId !== ALL_FILTER_VALUE && campaign.id !== campaignFilterId) return false;
        return true;
      }),
    [campaignById, campaignFilterId, clientFilterId, timeframeStats],
  );

  const filteredLeads = useMemo(
    () =>
      timeframeLeads.filter((item) => {
        if (clientFilterId !== ALL_FILTER_VALUE && item.client_id !== clientFilterId) return false;
        if (campaignFilterId !== ALL_FILTER_VALUE && item.campaign_id !== campaignFilterId) return false;
        return true;
      }),
    [campaignFilterId, clientFilterId, timeframeLeads],
  );

  const trendSeries = useMemo(
    () =>
      filteredStats
        .slice()
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .map((item) => ({
          label: formatDate(item.report_date, { day: "2-digit", month: "short" }),
          sent: item.sent_count ?? 0,
          replies: item.reply_count ?? 0,
          opens: item.unique_open_count ?? 0,
          bounces: item.bounce_count ?? 0,
        })),
    [filteredStats],
  );

  const qualificationSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredLeads) {
      const key = item.qualification ?? "unqualified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredLeads]);

  const campaignTotals = useMemo(() => {
    const totals = new Map<string, { sent: number; replies: number; rows: number }>();
    for (const item of timeframeStats) {
      const campaign = campaignById.get(item.campaign_id);
      if (!campaign) continue;
      if (clientFilterId !== ALL_FILTER_VALUE && campaign.client_id !== clientFilterId) continue;
      const current = totals.get(campaign.id) ?? { sent: 0, replies: 0, rows: 0 };
      current.sent += item.sent_count ?? 0;
      current.replies += item.reply_count ?? 0;
      current.rows += 1;
      totals.set(campaign.id, current);
    }
    return totals;
  }, [campaignById, clientFilterId, timeframeStats]);

  const campaignSeries = useMemo(
    () =>
      clientFilteredCampaigns
        .filter((item) => campaignFilterId === ALL_FILTER_VALUE || item.id === campaignFilterId)
        .map((campaign) => {
          const totals = campaignTotals.get(campaign.id);
          const sent = totals?.sent ?? 0;
          const replies = totals?.replies ?? 0;
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            type: campaign.type,
            startDate: campaign.start_date,
            databaseSize: campaign.database_size ?? 0,
            positiveResponses: campaign.positive_responses,
            sent,
            replies,
            replyRate: sent > 0 ? (replies / sent) * 100 : 0,
            dailyRows: totals?.rows ?? 0,
            externalId: campaign.external_id,
            genderTarget: campaign.gender_target ?? "-",
          };
        }),
    [campaignFilterId, campaignTotals, clientFilteredCampaigns],
  );

  const selectedCampaign = useMemo(
    () => campaignSeries.find((item) => item.id === campaignFilterId) ?? null,
    [campaignFilterId, campaignSeries],
  );
  const timeframeLabel = getTimeframeLabel(timeframe);

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Statistics"
          subtitle="Performance overview for campaigns in your current scope."
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
        subtitle="Performance overview for campaigns in your current scope."
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      <Surface title="Filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scopedClients.length > 1 ? (
            <Select value={clientFilterId} onValueChange={setClientFilterId}>
              <SelectTrigger
                aria-label="Filter statistics by client"
                className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
              >
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  All clients
                </SelectItem>
                {scopedClients.map((client) => (
                  <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="rounded-2xl border border-border bg-black/10 px-4 py-3 text-sm text-muted-foreground">
              Client scope: {scopedClients[0]?.name ?? "n/a"}
            </div>
          )}

          <Select value={campaignFilterId} onValueChange={setCampaignFilterId}>
            <SelectTrigger
              aria-label="Filter statistics by campaign"
              className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
            >
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
              <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                All campaigns
              </SelectItem>
              {clientFilteredCampaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Surface>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Surface title="Trend lines" subtitle="Sent, replies, opens, and bounces over time.">
          {trendSeries.length === 0 ? (
            <EmptyState title="No trend data yet" description="No activity data is available for the selected filters." />
          ) : (
            <>
              <ChartTextSummary summary={`Trend chart with ${trendSeries.length} points for sent, replies, opens, and bounces.`} />
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      contentStyle={{
                        backgroundColor: "rgba(2,6,23,0.98)",
                        border: "1px solid rgba(148,163,184,0.2)",
                        borderRadius: "16px",
                        color: "#fff",
                      }}
                      labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                      itemStyle={{ color: "#f8fafc" }}
                    />
                    <Line type="monotone" dataKey="sent" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="replies" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="opens" stroke="#a78bfa" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Surface>

        <Surface title="Lead qualification mix" subtitle="Based on visible lead records.">
          {qualificationSeries.length === 0 ? (
            <EmptyState title="No leads available" description="Once visible leads exist, the qualification mix appears here." />
          ) : (
            <>
              <ChartTextSummary summary={`Lead qualification pie chart with ${qualificationSeries.length} qualification buckets.`} />
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={qualificationSeries} dataKey="value" nameKey="name" outerRadius={110} innerRadius={64}>
                      {qualificationSeries.map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={false}
                      contentStyle={{
                        backgroundColor: "rgba(2,6,23,0.98)",
                        border: "1px solid rgba(148,163,184,0.2)",
                        borderRadius: "16px",
                        color: "#fff",
                      }}
                      labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                      itemStyle={{ color: "#f8fafc" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Surface>
      </div>

      <Surface title="Campaign portfolio" subtitle="Size and response density across visible campaigns.">
        {campaignSeries.length === 0 ? (
          <EmptyState title="No campaigns in scope" description="Adjust filters to view campaigns in this section." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {campaignSeries.map((campaign) => (
                <button
                  key={campaign.id}
                  onClick={() => setCampaignFilterId(campaign.id)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selectedCampaign?.id === campaign.id
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : "border-border bg-black/10 hover:bg-black/20"
                  }`}
                >
                  <p className="text-sm">{campaign.name}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database</p>
                      <p className="mt-1">{formatNumber(campaign.databaseSize)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Positive</p>
                      <p className="mt-1">{formatNumber(campaign.positiveResponses)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sent</p>
                      <p className="mt-1">{formatNumber(campaign.sent)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reply rate</p>
                      <p className="mt-1">{campaign.replyRate.toFixed(1)}%</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {selectedCampaign ? (
              <div className="rounded-2xl border border-border bg-black/10 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-base">{selectedCampaign.name}</p>
                  <button
                    onClick={() => setCampaignFilterId(ALL_FILTER_VALUE)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-white"
                  >
                    Clear campaign filter
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    ["Status", selectedCampaign.status],
                    ["Type", selectedCampaign.type],
                    ["Start date", selectedCampaign.startDate ? formatDate(selectedCampaign.startDate) : "-"],
                    ["Database size", formatNumber(selectedCampaign.databaseSize)],
                    ["Positive responses", formatNumber(selectedCampaign.positiveResponses)],
                    ["External id", selectedCampaign.externalId],
                    ["Gender target", selectedCampaign.genderTarget],
                    ["Daily stat rows", formatNumber(selectedCampaign.dailyRows)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-[#101010] p-4">
                      <p className="text-sm text-neutral-500">{label}</p>
                      <p className="mt-2 break-all text-sm text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="Select a campaign to inspect details"
                description="Click any campaign card to open detailed campaign information."
              />
            )}
          </div>
        )}
      </Surface>
    </div>
  );
}
