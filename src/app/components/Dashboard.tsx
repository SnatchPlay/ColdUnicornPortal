import { useState, useMemo } from 'react';
import { MetricCard } from './MetricCard';
import { DateRangePicker, DateRange } from './DateRangePicker';
import { Target, Calendar, TrendingUp, Send, Users } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
  Cell, LabelList, Legend
} from 'recharts';
import { mockClientDailySnapshots, mockCampaigns, mockCampaignDailyStats } from '../data/mock';
import type { ClientDailySnapshot, CampaignDailyStat } from '../data/schema';

const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'rgba(17,17,17,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: 12,
  }
};

// Compute daily sent delta from consecutive emails_sent_total snapshots
function computeDailySentDelta(snapshots: ClientDailySnapshot[]): { date: string; sent_delta: number }[] {
  return snapshots.map((snap, i) => {
    const prev = i > 0 ? snapshots[i - 1].emails_sent_total : 0;
    return {
      date: new Date(snap.snapshot_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      sent_delta: snap.emails_sent_total - prev,
    };
  });
}

// Aggregate campaign stats per campaign for the table
function aggregateCampaignStats(stats: CampaignDailyStat[], from: Date, to: Date) {
  const filtered = stats.filter(s => {
    const d = new Date(s.report_date);
    return d >= from && d <= to;
  });
  const map = new Map<string, { sent_count: number; reply_count: number; bounce_count: number; unique_open_count: number }>();
  for (const s of filtered) {
    const existing = map.get(s.campaign_id) ?? { sent_count: 0, reply_count: 0, bounce_count: 0, unique_open_count: 0 };
    map.set(s.campaign_id, {
      sent_count: existing.sent_count + s.sent_count,
      reply_count: existing.reply_count + s.reply_count,
      bounce_count: existing.bounce_count + s.bounce_count,
      unique_open_count: existing.unique_open_count + s.unique_open_count,
    });
  }
  return map;
}

export function Dashboard() {
  const [dateRange, setDateRange] = useState<DateRange>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
    label: 'Last 30 Days',
  });

  // Filter snapshots by date range
  const filteredSnapshots = useMemo(() =>
    mockClientDailySnapshots.filter(s => {
      const d = new Date(s.snapshot_date);
      return d >= dateRange.from && d <= dateRange.to;
    }),
    [dateRange]
  );

  // Previous period for delta comparison
  const prevSnapshots = useMemo(() => {
    const periodMs = dateRange.to.getTime() - dateRange.from.getTime();
    const prevFrom = new Date(dateRange.from.getTime() - periodMs);
    const prevTo = new Date(dateRange.from.getTime() - 1);
    return mockClientDailySnapshots.filter(s => {
      const d = new Date(s.snapshot_date);
      return d >= prevFrom && d <= prevTo;
    });
  }, [dateRange]);

  // KPI metrics from client_daily_snapshots
  const metrics = useMemo(() => {
    const mqls    = filteredSnapshots.reduce((s, x) => s + x.mql_diff, 0);
    const meetings = filteredSnapshots.reduce((s, x) => s + x.me_diff, 0);
    const won     = filteredSnapshots.reduce((s, x) => s + x.won_diff, 0);
    const latestSnap = filteredSnapshots[filteredSnapshots.length - 1];
    const sent    = latestSnap?.emails_sent_total ?? 0;
    const prospects = latestSnap?.prospects_count ?? 0;

    const prevMqls    = prevSnapshots.reduce((s, x) => s + x.mql_diff, 0);
    const prevMeetings = prevSnapshots.reduce((s, x) => s + x.me_diff, 0);
    const prevWon     = prevSnapshots.reduce((s, x) => s + x.won_diff, 0);

    const pct = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev) * 100 : 0;

    return {
      mqls, meetings, won, sent, prospects,
      mqlsChange:    pct(mqls, prevMqls),
      meetingsChange: pct(meetings, prevMeetings),
      wonChange:     pct(won, prevWon),
      mqlsTrend:    filteredSnapshots.map(s => s.mql_diff),
      meetingsTrend: filteredSnapshots.map(s => s.me_diff),
      wonTrend:     filteredSnapshots.map(s => s.won_diff),
      sentTrend:    filteredSnapshots.map((_, i, arr) =>
        i === 0 ? arr[0].emails_sent_total : arr[i].emails_sent_total - arr[i - 1].emails_sent_total
      ),
    };
  }, [filteredSnapshots, prevSnapshots]);

  // Chart data from snapshots
  const snapshotChartData = useMemo(() =>
    filteredSnapshots.map((s, i, arr) => ({
      date: new Date(s.snapshot_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      // daily sent delta
      sent_delta: i === 0 ? s.emails_sent_total : s.emails_sent_total - arr[i - 1].emails_sent_total,
      prospects_count: s.prospects_count,
      mql_diff: s.mql_diff,
      me_diff: s.me_diff,
      won_diff: s.won_diff,
      bounce_count: s.bounce_count,
      human_replies_total: s.human_replies_total,
    })),
    [filteredSnapshots]
  );

  // Campaign stats
  const campaignStatsMap = useMemo(
    () => aggregateCampaignStats(mockCampaignDailyStats, dateRange.from, dateRange.to),
    [dateRange]
  );

  const campaignsWithStats = mockCampaigns
    .filter(c => campaignStatsMap.has(c.id))
    .map(c => ({ campaign: c, stats: campaignStatsMap.get(c.id)! }));

  // Funnel data from metrics (derived from daily snapshots)
  const funnelData = [
    { stage: 'Prospects', count: metrics.prospects, fill: '#3b82f6' },
    { stage: 'MQLs', count: metrics.mqls, fill: '#6366f1' },
    { stage: 'Meetings', count: metrics.meetings, fill: '#8b5cf6' },
    { stage: 'Won', count: metrics.won, fill: '#10b981' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="mb-2">Client Dashboard</h1>
          <p className="text-muted-foreground text-sm">Real-time overview from <code className="text-xs bg-secondary/50 px-1 rounded">client_daily_snapshots</code></p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI Cards — from client_daily_snapshots */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="MQLs (mql_diff Σ)"
          value={metrics.mqls}
          change={parseFloat(metrics.mqlsChange.toFixed(1))}
          trend={metrics.mqlsTrend}
          icon={<Target className="w-5 h-5" />}
        />
        <MetricCard
          title="Meetings (me_diff Σ)"
          value={metrics.meetings}
          change={parseFloat(metrics.meetingsChange.toFixed(1))}
          trend={metrics.meetingsTrend}
          icon={<Calendar className="w-5 h-5" />}
        />
        <MetricCard
          title="Won (won_diff Σ)"
          value={metrics.won}
          change={parseFloat(metrics.wonChange.toFixed(1))}
          trend={metrics.wonTrend}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <MetricCard
          title="Emails Sent (total)"
          value={metrics.sent >= 1000 ? `${(metrics.sent / 1000).toFixed(1)}K` : metrics.sent}
          trend={metrics.sentTrend}
          icon={<Send className="w-5 h-5" />}
        />
        <MetricCard
          title="Prospects"
          value={metrics.prospects >= 1000 ? `${(metrics.prospects / 1000).toFixed(1)}K` : metrics.prospects}
          trend={filteredSnapshots.map(s => s.prospects_count)}
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      {/* Charts Row 1: Daily Sent + Prospects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4">
            <h3>Daily Sent (Δ emails_sent_total)</h3>
            <p className="text-xs text-muted-foreground">Computed delta from client_daily_snapshots.emails_sent_total</p>
          </div>
          {snapshotChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="sent_delta" name="Emails Sent" fill="#10b981" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="sent_delta" position="top" fill="rgba(255,255,255,0.5)" fontSize={9} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">No data for period</div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4">
            <h3>Prospects Count</h3>
            <p className="text-xs text-muted-foreground">client_daily_snapshots.prospects_count</p>
          </div>
          {snapshotChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={snapshotChartData}>
                <defs>
                  <linearGradient id="prospGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="prospects_count" name="Prospects" stroke="#3b82f6" strokeWidth={2} fill="url(#prospGrad)" dot={{ fill: '#3b82f6', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">No data for period</div>
          )}
        </div>
      </div>

      {/* Charts Row 2: Velocity (mql_diff + sent) + MQL/Meetings/Won deltas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4">
            <h3>Velocity Chart</h3>
            <p className="text-xs text-muted-foreground">Δ emails_sent vs mql_diff (client_daily_snapshots)</p>
          </div>
          {snapshotChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis yAxisId="left" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
                <Bar yAxisId="left" dataKey="sent_delta" name="Emails Sent Δ" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="mql_diff" name="MQLs Δ" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">No data for period</div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="mb-4">
            <h3>Pipeline Deltas</h3>
            <p className="text-xs text-muted-foreground">mql_diff / me_diff / won_diff per snapshot</p>
          </div>
          {snapshotChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={snapshotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
                <Line type="monotone" dataKey="mql_diff" name="MQL Δ" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                <Line type="monotone" dataKey="me_diff" name="Meeting Δ" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} />
                <Line type="monotone" dataKey="won_diff" name="Won Δ" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center text-muted-foreground text-sm">No data for period</div>
          )}
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="mb-4">
          <h3>Conversion Funnel</h3>
          <p className="text-xs text-muted-foreground">Aggregated from client_daily_snapshots for selected period</p>
        </div>
        <div className="space-y-3">
          {funnelData.map((stage, i) => (
            <div key={stage.stage}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm">{stage.stage}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{stage.count.toLocaleString()}</span>
                  {i > 0 && funnelData[i - 1].count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {((stage.count / funnelData[i - 1].count) * 100).toFixed(1)}% of prev
                    </span>
                  )}
                </div>
              </div>
              <div className="h-2.5 bg-secondary/40 rounded-full">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: funnelData[0].count > 0 ? `${(stage.count / funnelData[0].count) * 100}%` : '0%',
                    backgroundColor: stage.fill,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign Performance — from campaigns + campaign_daily_stats */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3>Campaign Performance</h3>
            <p className="text-xs text-muted-foreground">Aggregated from campaign_daily_stats for selected period</p>
          </div>
        </div>

        {campaignsWithStats.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No campaign stats in the selected period
          </div>
        ) : (
          <div className="space-y-3">
            {campaignsWithStats.map(({ campaign, stats }) => {
              const replyRate = stats.sent_count > 0 ? (stats.reply_count / stats.sent_count) * 100 : 0;
              const bounceRate = stats.sent_count > 0 ? (stats.bounce_count / stats.sent_count) * 100 : 0;
              return (
                <div key={campaign.id} className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg hover:bg-secondary/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm">{campaign.name}</h4>
                      <span className="px-2 py-0.5 bg-secondary/50 text-muted-foreground text-xs rounded capitalize">{campaign.type}</span>
                      {campaign.status && (
                        <span className={`px-2 py-0.5 text-xs rounded capitalize ${
                          campaign.status === 'active' ? 'bg-green-500/10 text-green-400' :
                          campaign.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-secondary/50 text-muted-foreground'
                        }`}>{campaign.status}</span>
                      )}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Sent: <span className="text-foreground">{stats.sent_count.toLocaleString()}</span></span>
                      <span>Replies: <span className="text-foreground">{stats.reply_count}</span></span>
                      <span>Opens: <span className="text-foreground">{stats.unique_open_count}</span></span>
                      <span>Bounces: <span className={bounceRate > 3 ? 'text-red-400' : 'text-foreground'}>{stats.bounce_count}</span></span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <div className={`text-sm ${replyRate >= 5 ? 'text-green-400' : replyRate >= 3 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {replyRate.toFixed(2)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Reply Rate</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
