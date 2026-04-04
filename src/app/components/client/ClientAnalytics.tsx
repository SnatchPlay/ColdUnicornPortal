import { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts';
import { TrendingUp, ArrowUp, ArrowDown } from 'lucide-react';
import { mockClientDailySnapshots, mockCampaigns, mockCampaignDailyStats, mockLeads } from '../../data/mock';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import type { LeadQualification } from '../../data/schema';

const TT = {
  contentStyle: {
    backgroundColor: 'rgba(13,13,13,0.98)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: 12,
    padding: '8px 12px',
  },
};

function StatCard({ label, value, sub, color = 'text-foreground' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <p className={`text-2xl ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

// Qualification labels visible to clients
const Q_LABELS: Partial<Record<LeadQualification, string>> = {
  preMQL:            'Pre-MQL',
  MQL:               'MQL',
  meeting_scheduled: 'Meeting Scheduled',
  meeting_held:      'Meeting Held',
  offer_sent:        'Offer Sent',
  won:               'Won',
};

const FUNNEL_COLORS: Record<string, string> = {
  'Pre-MQL':           '#eab308',
  'MQL':               '#3b82f6',
  'Meeting Scheduled': '#8b5cf6',
  'Meeting Held':      '#6366f1',
  'Offer Sent':        '#f97316',
  'Won':               '#10b981',
};

export function ClientAnalytics() {
  const [dateRange, setDateRange] = useState<DateRange>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
    label: 'Last 30 Days',
  });

  // Filter snapshots by period
  const snapshots = useMemo(() =>
    mockClientDailySnapshots.filter(s => {
      const d = new Date(s.snapshot_date);
      return d >= dateRange.from && d <= dateRange.to;
    }), [dateRange]);

  // Trend data: MQL, Meeting, Won per day
  const trendData = useMemo(() =>
    snapshots.map(s => ({
      date: new Date(s.snapshot_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      mqls:     s.mql_diff,
      meetings: s.me_diff,
      won:      s.won_diff,
    })), [snapshots]);

  // Aggregate KPIs
  const mqls     = snapshots.reduce((a, s) => a + s.mql_diff, 0);
  const meetings = snapshots.reduce((a, s) => a + s.me_diff, 0);
  const won      = snapshots.reduce((a, s) => a + s.won_diff, 0);
  const latest   = mockClientDailySnapshots[mockClientDailySnapshots.length - 1];
  const prospects = latest?.prospects_count ?? 0;

  // Conversion rates
  const mqlRate  = prospects > 0  ? ((mqls / prospects) * 100).toFixed(1) : '—';
  const meetRate = mqls > 0       ? ((meetings / mqls) * 100).toFixed(1) : '—';
  const wonRate  = meetings > 0   ? ((won / meetings) * 100).toFixed(1) : '—';

  // Lead funnel from leads table (current state of all leads visible to client)
  const clientLeads = mockLeads.filter(l =>
    ['preMQL','MQL','meeting_scheduled','meeting_held','offer_sent','won'].includes(l.qualification)
  );
  const qualCounts = clientLeads.reduce<Record<string, number>>((acc, l) => {
    const label = Q_LABELS[l.qualification];
    if (label) acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const funnelRows = Object.entries(Q_LABELS)
    .map(([q, label]) => ({ label: label!, count: qualCounts[label!] ?? 0 }))
    .filter(r => r.count > 0);
  const maxCount = Math.max(...funnelRows.map(r => r.count), 1);

  // Campaign reply rates (only outreach campaigns, no internal info)
  const campPerf = mockCampaigns
    .filter(c => c.type === 'outreach')
    .map(c => {
      const stats = mockCampaignDailyStats
        .filter(s => s.campaign_id === c.id)
        .filter(s => {
          const d = new Date(s.report_date);
          return d >= dateRange.from && d <= dateRange.to;
        });
      const sent    = stats.reduce((a, s) => a + s.sent_count, 0);
      const replies = stats.reduce((a, s) => a + s.reply_count, 0);
      return { name: c.name, sent, replies, rate: sent > 0 ? (replies / sent) * 100 : 0 };
    })
    .filter(c => c.sent > 0)
    .sort((a, b) => b.rate - a.rate);

  return (
    <div className="space-y-7">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="mb-1">Analytics</h1>
          <p className="text-sm text-muted-foreground">Your campaign performance and pipeline analytics</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI summary for period */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MQLs Delivered" value={mqls}     color="text-blue-400"   sub={`${mqlRate}% prospect→MQL`} />
        <StatCard label="Meetings Booked" value={meetings} color="text-purple-400" sub={`${meetRate}% MQL→meeting`} />
        <StatCard label="Deals Won"       value={won}      color="text-green-400"  sub={`${wonRate}% meeting→won`} />
        <StatCard label="Prospects Base"  value={prospects.toLocaleString()} color="text-foreground" sub="current count" />
      </div>

      {/* MQL / Meetings / Won trend */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="mb-1">Pipeline Activity</h3>
        <p className="text-xs text-muted-foreground mb-5">New MQLs, meetings booked, and deals won over time</p>
        {trendData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No data for selected period</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...TT} />
              <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', paddingTop: 12 }} />
              <Line type="monotone" dataKey="mqls"     name="MQLs"     stroke="#3b82f6" strokeWidth={2.5} dot={{ fill: '#3b82f6',  r: 4, strokeWidth: 0 }} />
              <Line type="monotone" dataKey="meetings" name="Meetings" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6',  r: 4, strokeWidth: 0 }} />
              <Line type="monotone" dataKey="won"      name="Won"      stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981',  r: 4, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Current Pipeline Funnel + Conversion Rates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Funnel */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="mb-1">Current Pipeline</h3>
          <p className="text-xs text-muted-foreground mb-5">Where your leads stand today</p>
          <div className="space-y-3.5">
            {funnelRows.map(r => (
              <div key={r.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm">{r.label}</span>
                  <span className="text-sm tabular-nums">{r.count}</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(r.count / maxCount) * 100}%`, backgroundColor: FUNNEL_COLORS[r.label] ?? '#6b7280' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion rates */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="mb-1">Conversion Rates</h3>
          <p className="text-xs text-muted-foreground mb-5">For selected period</p>
          <div className="space-y-4">
            {[
              { from: 'Prospects', to: 'MQL',     rate: mqlRate,  color: '#3b82f6', num: mqls,     den: prospects },
              { from: 'MQL',       to: 'Meeting',  rate: meetRate, color: '#8b5cf6', num: meetings, den: mqls },
              { from: 'Meeting',   to: 'Won',      rate: wonRate,  color: '#10b981', num: won,      den: meetings },
            ].map(r => {
              const pct = r.rate === '—' ? 0 : parseFloat(r.rate);
              return (
                <div key={r.from}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-muted-foreground">{r.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{r.to}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{r.num} / {r.den}</span>
                      <span className="text-sm" style={{ color: r.color }}>{r.rate}{r.rate !== '—' ? '%' : ''}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: r.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall */}
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Overall (Prospect → Won)</span>
              <span className="text-sm text-green-400">
                {prospects > 0 && won > 0 ? `${((won / prospects) * 100).toFixed(2)}%` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Reply Rates */}
      {campPerf.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="mb-1">Campaign Performance</h3>
          <p className="text-xs text-muted-foreground mb-5">Reply rates for active outreach campaigns in selected period</p>
          <div className="space-y-4">
            {campPerf.map((c, i) => (
              <div key={c.name} className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm truncate max-w-[240px]">{c.name}</span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span>{c.sent.toLocaleString()} sent</span>
                      <span className={`tabular-nums ${c.rate >= 5 ? 'text-green-400' : c.rate >= 3 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {c.rate.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full">
                    <div
                      className={`h-full rounded-full ${c.rate >= 5 ? 'bg-green-500' : c.rate >= 3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(c.rate * 10, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Industry benchmark: ≥5% excellent · 3–5% good · &lt;3% review copy
          </p>
        </div>
      )}
    </div>
  );
}