import { useMemo, useState } from "react";
import {
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
  PortalPageHeader,
  PortalSurface,
  ResponsiveChart,
} from "../components/portal-ui";
import { getCampaignPerformance } from "../lib/client-view-models";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaignStats, scopeCampaigns } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

export function ClientCampaignsPage() {
  const { identity } = useAuth();
  const { clients, campaigns, campaignDailyStats } = useCoreData();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());

  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const timeframeStats = useMemo(
    () => filterByTimeframe(scopedStats, (stat) => stat.report_date, timeframe),
    [scopedStats, timeframe],
  );
  const performance = useMemo(() => getCampaignPerformance(scopedCampaigns, timeframeStats), [scopedCampaigns, timeframeStats]);
  const selectedCampaign =
    scopedCampaigns.find((campaign) => campaign.id === selectedCampaignId) ?? scopedCampaigns[0] ?? null;
  const selectedStats = useMemo(
    () =>
      timeframeStats
        .filter((item) => item.campaign_id === selectedCampaign?.id)
        .sort((left, right) => left.report_date.localeCompare(right.report_date))
        .map((item) => ({
          label: formatDate(item.report_date, { day: "numeric", month: "short" }),
          sent: item.sent_count ?? 0,
          replies: item.reply_count ?? 0,
          bounces: item.bounce_count ?? 0,
          opens: item.unique_open_count ?? 0,
        })),
    [timeframeStats, selectedCampaign?.id],
  );
  const timeframeLabel = getTimeframeLabel(timeframe);

  return (
    <div className="space-y-8">
      <PortalPageHeader
        title="Campaigns"
        subtitle="Performance for your visible outreach campaigns"
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      {scopedCampaigns.length === 0 ? (
        <EmptyPortalState title="No campaigns in scope" description="Client users only see outreach campaigns from live Supabase data." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
          <PortalSurface
            title="Campaign portfolio"
            subtitle={`${scopedCampaigns.length} outreach campaigns`}
            className="flex h-[34rem] max-h-[68vh] min-h-0 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {scopedCampaigns.map((campaign) => {
                const stats = performance.find((item) => item.id === campaign.id);
                const active = selectedCampaign?.id === campaign.id;
                return (
                  <button
                    key={campaign.id}
                    onClick={() => setSelectedCampaignId(campaign.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active ? "border-emerald-500/30 bg-emerald-500/10" : "border-[#242424] bg-[#080808] hover:bg-[#111]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-base text-white">{campaign.name}</p>
                        <p className="mt-1 text-sm text-neutral-400">
                          {campaign.status} · started {formatDate(campaign.start_date, { day: "numeric", month: "short", year: "2-digit" })}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="text-emerald-400">{(stats?.replyRate ?? 0).toFixed(1)}%</p>
                        <p className="text-neutral-500">reply rate</p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-neutral-500">Database</p>
                        <p className="text-white">{formatNumber(campaign.database_size)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Sent</p>
                        <p className="text-white">{formatNumber(stats?.sent ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Positive</p>
                        <p className="text-white">{formatNumber(campaign.positive_responses)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </PortalSurface>

          <div className="space-y-6">
            <PortalSurface title={selectedCampaign?.name ?? "Campaign detail"} subtitle="Read-only campaign metadata from live schema">
              {selectedCampaign && (
                <div className="grid gap-4 md:grid-cols-4">
                  {[
                    ["Status", selectedCampaign.status],
                    ["Type", selectedCampaign.type],
                    ["Start date", formatDate(selectedCampaign.start_date)],
                    ["Database size", formatNumber(selectedCampaign.database_size)],
                    ["Positive responses", formatNumber(selectedCampaign.positive_responses)],
                    ["External id", selectedCampaign.external_id],
                    ["Gender target", selectedCampaign.gender_target ?? "—"],
                    ["Daily stat rows", formatNumber(selectedStats.length)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-[#101010] p-4">
                      <p className="text-sm text-neutral-500">{label}</p>
                      <p className="mt-2 break-all text-sm text-white">{value}</p>
                    </div>
                  ))}
                </div>
              )}
            </PortalSurface>

            <ChartPanel title="Daily campaign volume" subtitle={`Sent, replies, bounces, and opens for selected campaign (${timeframeLabel})`}>
            {selectedStats.length === 0 ? (
              <EmptyPortalState title="No daily metrics yet" description="campaign_daily_stats has no rows for this campaign." />
            ) : (
              <ResponsiveChart>
                <LineChart data={selectedStats}>
                  <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="sent" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="replies" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="opens" stroke="#8b5cf6" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="bounces" stroke="#f97316" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveChart>
            )}
          </ChartPanel>
          </div>
        </div>
      )}

      <ChartPanel title="Campaign sent count" subtitle={`campaign_daily_stats.sent_count grouped by outreach campaign (${timeframeLabel})`}>
        {performance.length === 0 ? (
          <EmptyPortalState title="No campaign ranking" description="Campaigns need daily stats for this chart." />
        ) : (
          <ResponsiveChart>
            <BarChart data={performance.slice(0, 10)}>
              <CartesianGrid stroke="#141414" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8a8a8a", fontSize: 12 }} axisLine={false} tickLine={false} />
              <ChartTooltip />
              <Bar dataKey="sent" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveChart>
        )}
      </ChartPanel>
    </div>
  );
}
