import { useState, useMemo } from 'react';
import { DateRangePicker, DateRange } from '../DateRangePicker';
import { Target, Calendar, TrendingUp, Send, ArrowUp, ArrowDown, Minus, Users } from 'lucide-react';
import {
  ComposedChart, Bar, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, LabelList, BarChart
} from 'recharts';
import {
  mockClientDailySnapshots, mockCampaigns, mockCampaignDailyStats,
  mockDailySentLast30, mockWeeklyMqlData, mockMonthlyMqlData,
  mockProspectsAddedByDate, mockSentLast3Months, mockProspectsAddedByMonth,
} from '../../data/mock';

// ── Tooltip style (dark) ──────────────────────────────────────
const TT = {
  contentStyle: {
    backgroundColor: 'rgba(13,13,13,0.98)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: '#fff',
    fontSize: 12,
    padding: '8px 12px',
  },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};

const GREEN = '#22c55e';
const AXIS_TICK = { fill: 'rgba(255,255,255,0.4)', fontSize: 10 };

// ── Sparkline ─────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 64, h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeltaBadge({ change }: { change: number | null }) {
  if (change === null) return null;
  if (Math.abs(change) < 0.5) return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="w-3 h-3" />{Math.abs(change).toFixed(0)}%</span>;
  const up = change > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${up ? 'text-green-400' : 'text-red-400'}`}>
      {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

// ── Chart section wrapper ─────────────────────────────────────
function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="mb-4">
        <h3 className="text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// Custom label for bars — only show non-zero
function BarLabel(props: any) {
  const { x, y, width, value } = props;
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 4} fill="rgba(255,255,255,0.55)" fontSize={9} textAnchor="middle">
      {value.toLocaleString()}
    </text>
  );
}

export function ClientDashboard() {
  const [dateRange, setDateRange] = useState<DateRange>({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
    label: 'Last 30 Days',
  });

  // Snapshots for selected period
  const snapshots = useMemo(() =>
    mockClientDailySnapshots.filter(s => {
      const d = new Date(s.snapshot_date);
      return d >= dateRange.from && d <= dateRange.to;
    }), [dateRange]);

  const prevSnapshots = useMemo(() => {
    const span = dateRange.to.getTime() - dateRange.from.getTime();
    const pFrom = new Date(dateRange.from.getTime() - span);
    const pTo   = new Date(dateRange.from.getTime() - 1);
    return mockClientDailySnapshots.filter(s => {
      const d = new Date(s.snapshot_date);
      return d >= pFrom && d <= pTo;
    });
  }, [dateRange]);

  const kpis = useMemo(() => {
    const mqls     = snapshots.reduce((a, s) => a + s.mql_diff, 0);
    const meetings = snapshots.reduce((a, s) => a + s.me_diff, 0);
    const won      = snapshots.reduce((a, s) => a + s.won_diff, 0);
    const latest   = snapshots[snapshots.length - 1];
    const sentTotal = latest?.emails_sent_total ?? 0;
    const prospects = latest?.prospects_count ?? 0;

    const pMqls     = prevSnapshots.reduce((a, s) => a + s.mql_diff, 0);
    const pMeetings = prevSnapshots.reduce((a, s) => a + s.me_diff, 0);
    const pWon      = prevSnapshots.reduce((a, s) => a + s.won_diff, 0);
    const pct = (c: number, p: number) => p > 0 ? ((c - p) / p) * 100 : null;

    return {
      mqls, meetings, won, sentTotal, prospects,
      mqlsChange:     pct(mqls, pMqls),
      meetingsChange: pct(meetings, pMeetings),
      wonChange:      pct(won, pWon),
      mqlTrend:    snapshots.map(s => s.mql_diff),
      meetingTrend: snapshots.map(s => s.me_diff),
      wonTrend:    snapshots.map(s => s.won_diff),
      sentTrend:   snapshots.map((s, i, arr) => i === 0 ? 0 : s.emails_sent_total - arr[i-1].emails_sent_total),
    };
  }, [snapshots, prevSnapshots]);

  // Velocity chart
  const velocityData = useMemo(() =>
    snapshots.map((s, i, arr) => ({
      date: new Date(s.snapshot_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
      sent: i === 0 ? 0 : s.emails_sent_total - arr[i-1].emails_sent_total,
      mqls: s.mql_diff,
    })), [snapshots]);

  // Funnel
  const allMqls     = mockClientDailySnapshots.reduce((a, s) => a + s.mql_diff, 0);
  const allMeetings = mockClientDailySnapshots.reduce((a, s) => a + s.me_diff, 0);
  const allWon      = mockClientDailySnapshots.reduce((a, s) => a + s.won_diff, 0);
  const latestSnap  = mockClientDailySnapshots[mockClientDailySnapshots.length - 1];
  const prospects   = latestSnap?.prospects_count ?? 0;

  const funnelStages = [
    { label: 'Prospects', value: prospects,    color: '#3b82f6' },
    { label: 'MQLs',      value: allMqls,      color: '#6366f1' },
    { label: 'Meetings',  value: allMeetings,  color: '#8b5cf6' },
    { label: 'Won',       value: allWon,       color: '#22c55e' },
  ];

  // Campaign perf
  const campPerf = mockCampaigns
    .filter(c => c.type === 'outreach')
    .map(c => {
      const stats = mockCampaignDailyStats
        .filter(s => s.campaign_id === c.id)
        .filter(s => new Date(s.report_date) >= dateRange.from && new Date(s.report_date) <= dateRange.to);
      const sent    = stats.reduce((a, s) => a + s.sent_count, 0);
      const replies = stats.reduce((a, s) => a + s.reply_count, 0);
      return { name: c.name, sent, replies, rate: sent > 0 ? (replies / sent) * 100 : 0 };
    })
    .filter(c => c.sent > 0);

  const KPI_CARDS = [
    { title: 'MQLs Delivered',  value: kpis.mqls,      change: kpis.mqlsChange,     trend: kpis.mqlTrend,     icon: Target,    color: '#10b981', border: 'border-green-500/20',  bg: 'from-green-500/8 to-transparent'  },
    { title: 'Meetings Booked', value: kpis.meetings,  change: kpis.meetingsChange,  trend: kpis.meetingTrend, icon: Calendar,  color: '#8b5cf6', border: 'border-purple-500/20', bg: 'from-purple-500/8 to-transparent' },
    { title: 'Deals Won',       value: kpis.won,        change: kpis.wonChange,       trend: kpis.wonTrend,     icon: TrendingUp,color: '#f59e0b', border: 'border-amber-500/20',  bg: 'from-amber-500/8 to-transparent'  },
    { title: 'Emails Sent',     value: kpis.sentTotal >= 1000 ? `${(kpis.sentTotal/1000).toFixed(1)}K` : kpis.sentTotal, change: null, trend: kpis.sentTrend, icon: Send, color: '#3b82f6', border: 'border-blue-500/20', bg: 'from-blue-500/8 to-transparent' },
    { title: 'Prospects',       value: kpis.prospects >= 1000 ? `${(kpis.prospects/1000).toFixed(1)}K` : kpis.prospects, change: null, trend: snapshots.map(s => s.prospects_count), icon: Users, color: '#6366f1', border: 'border-indigo-500/20', bg: 'from-indigo-500/8 to-transparent' },
  ];

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="mb-1">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your lead generation overview</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {KPI_CARDS.map(c => {
          const Icon = c.icon;
          return (
            <div key={c.title} className={`bg-card border ${c.border} rounded-xl p-4 relative overflow-hidden`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${c.bg} pointer-events-none`} />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${c.color}18` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: c.color }} />
                  </div>
                  <DeltaBadge change={c.change} />
                </div>
                <p className="text-xl mb-0.5" style={{ color: c.color }}>{c.value}</p>
                <p className="text-xs text-muted-foreground">{c.title}</p>
                <div className="mt-2"><Sparkline data={c.trend} color={c.color} /></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Charts Row 1: Daily Sent + Leads Count per Week ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ChartCard title="Daily sent (last 30 days)" subtitle="campaign_daily_stats.sent_count aggregated by report_date">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockDailySentLast30} margin={{ top: 16, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Sent Count', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10, dy: 40 }} />
              <Tooltip {...TT} formatter={(v: number) => [v.toLocaleString(), 'Sent']} />
              <Bar dataKey="sent" fill={GREEN} radius={[2, 2, 0, 0]} maxBarSize={18}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Leads Count per week" subtitle="client_daily_snapshots.mql_diff grouped by ISO week">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockWeeklyMqlData} margin={{ top: 16, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="week" tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Week', position: 'insideBottom', offset: -2, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Leads Count', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10, dy: 45 }} />
              <Tooltip {...TT} formatter={(v: number) => [v, 'MQLs']} />
              <Bar dataKey="count" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={40}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Charts Row 2: Leads Count per Month + Prospects Added ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ChartCard title="Leads Count per month" subtitle="client_daily_snapshots.mql_diff Σ per calendar month">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockMonthlyMqlData} margin={{ top: 16, right: 4, left: -20, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-40} textAnchor="end" interval={0} label={{ value: 'Month', position: 'insideBottom', offset: -28, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: 'Leads Count', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10, dy: 45 }} />
              <Tooltip {...TT} formatter={(v: number) => [v, 'MQLs']} />
              <Bar dataKey="count" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={28}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Prospects added" subtitle="Δ client_daily_snapshots.prospects_count by date">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockProspectsAddedByDate} margin={{ top: 16, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} height={45} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: number) => [v.toLocaleString(), 'Prospects']} />
              <Bar dataKey="count" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={32}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Charts Row 3: Sent Last 3 Months + Prospects by Month ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ChartCard title="Sent count for last three months" subtitle="campaign_daily_stats.sent_count Σ per month">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockSentLast3Months} margin={{ top: 16, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: number) => [v.toLocaleString(), 'Sent']} />
              <Bar dataKey="sent" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={80}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Prospects added by Month" subtitle="monthly Δ of client_daily_snapshots.prospects_count">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={mockProspectsAddedByMonth} margin={{ top: 16, right: 4, left: -10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} angle={-40} textAnchor="end" interval={0} label={{ value: 'Month', position: 'insideBottom', offset: -28, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip {...TT} formatter={(v: number) => [v.toLocaleString(), 'Added']} />
              <Bar dataKey="count" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={28}>
                <LabelList content={<BarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── Velocity Chart + Conversion Funnel ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ChartCard title="Velocity Chart" subtitle="Emails sent vs MQLs for selected period">
          {snapshots.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={velocityData} margin={{ top: 4, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip {...TT} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', paddingTop: 8 }} />
                <Bar    yAxisId="l" dataKey="sent" name="Emails Sent" fill="#3b82f6" opacity={0.7} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line  yAxisId="r" type="monotone" dataKey="mqls" name="MQLs" stroke={GREEN} strokeWidth={2.5} dot={{ fill: GREEN, r: 4, strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Conversion Funnel" subtitle="All-time: prospects → MQL → meeting → won">
          <div className="space-y-4 pt-1">
            {funnelStages.map((s, i) => {
              const pct = funnelStages[0].value > 0 ? (s.value / funnelStages[0].value) * 100 : 0;
              const convPct = i > 0 && funnelStages[i-1].value > 0
                ? ((s.value / funnelStages[i-1].value) * 100).toFixed(1)
                : null;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm">{s.label}</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="tabular-nums">{s.value.toLocaleString()}</span>
                      {convPct && <span className="text-muted-foreground">← {convPct}%</span>}
                    </div>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {campPerf.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border space-y-2">
              <p className="text-xs text-muted-foreground mb-2">Campaign reply rates (selected period)</p>
              {campPerf.map(c => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="truncate flex-1 text-muted-foreground">{c.name}</span>
                  <span className={c.rate >= 5 ? 'text-green-400' : c.rate >= 3 ? 'text-yellow-400' : 'text-red-400'}>
                    {c.rate.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}