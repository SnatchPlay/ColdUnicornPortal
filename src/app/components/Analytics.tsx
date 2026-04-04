import { useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
  Cell, Legend, PieChart, Pie
} from 'recharts';
import { ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import {
  mockClientDailySnapshots,
  mockCampaignDailyStats,
  mockCampaigns,
  mockLeadReplies,
  mockLeads,
} from '../data/mock';
import type { ReplyIntent, LeadQualification } from '../data/schema';

const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'rgba(17,17,17,0.95)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: 12,
  }
};

// ── Derived datasets strictly from schema tables ──────────────

// 1. Snapshot trend (client_daily_snapshots)
const snapshotTrend = mockClientDailySnapshots.map((s, i, arr) => ({
  date: new Date(s.snapshot_date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
  mql_diff: s.mql_diff,
  me_diff: s.me_diff,
  won_diff: s.won_diff,
  ooo_accumulated: s.ooo_accumulated,
  negative_total: s.negative_total,
  human_replies_total: s.human_replies_total,
  bounce_count: s.bounce_count,
  prospects_count: s.prospects_count,
  sent_delta: i === 0 ? s.emails_sent_total : s.emails_sent_total - arr[i - 1].emails_sent_total,
}));

// 2. campaign_daily_stats per campaign aggregated
const campaignAggregated = mockCampaigns.map(c => {
  const stats = mockCampaignDailyStats.filter(s => s.campaign_id === c.id);
  const sent = stats.reduce((a, s) => a + s.sent_count, 0);
  const replies = stats.reduce((a, s) => a + s.reply_count, 0);
  const bounces = stats.reduce((a, s) => a + s.bounce_count, 0);
  const opens = stats.reduce((a, s) => a + s.unique_open_count, 0);
  return {
    campaign: c,
    sent_count: sent,
    reply_count: replies,
    bounce_count: bounces,
    unique_open_count: opens,
    reply_rate: sent > 0 ? parseFloat(((replies / sent) * 100).toFixed(2)) : 0,
    open_rate: sent > 0 ? parseFloat(((opens / sent) * 100).toFixed(2)) : 0,
    bounce_rate: sent > 0 ? parseFloat(((bounces / sent) * 100).toFixed(2)) : 0,
  };
}).filter(r => r.sent_count > 0);

// 3. lead_replies: classification distribution (reply_intent)
const intentCounts = mockLeadReplies
  .filter(r => r.direction === 'inbound')
  .reduce<Record<string, number>>((acc, r) => {
    acc[r.ai_classification] = (acc[r.ai_classification] ?? 0) + 1;
    return acc;
  }, {});

const intentChartData: { intent: ReplyIntent; count: number; color: string }[] = [
  { intent: 'positive',       count: intentCounts['positive']       ?? 0, color: '#10b981' },
  { intent: 'info_requested', count: intentCounts['info_requested'] ?? 0, color: '#3b82f6' },
  { intent: 'ooo',            count: intentCounts['ooo']            ?? 0, color: '#f59e0b' },
  { intent: 'negative',       count: intentCounts['negative']       ?? 0, color: '#ef4444' },
  { intent: 'unclassified',   count: intentCounts['unclassified']   ?? 0, color: '#6b7280' },
];

// 4. leads: qualification funnel (from leads table)
const qualCounts = mockLeads.reduce<Record<string, number>>((acc, l) => {
  acc[l.qualification] = (acc[l.qualification] ?? 0) + 1;
  return acc;
}, {});

const qualificationFunnel: { stage: LeadQualification; count: number; color: string }[] = [
  { stage: 'preMQL',            count: qualCounts['preMQL']            ?? 0, color: '#eab308' },
  { stage: 'MQL',               count: qualCounts['MQL']               ?? 0, color: '#3b82f6' },
  { stage: 'meeting_scheduled', count: qualCounts['meeting_scheduled'] ?? 0, color: '#8b5cf6' },
  { stage: 'meeting_held',      count: qualCounts['meeting_held']      ?? 0, color: '#6366f1' },
  { stage: 'offer_sent',        count: qualCounts['offer_sent']        ?? 0, color: '#f97316' },
  { stage: 'won',               count: qualCounts['won']               ?? 0, color: '#10b981' },
];

// 5. ai_confidence distribution from lead_replies
const confidenceBuckets = [
  { range: '0–50%',  count: 0 },
  { range: '51–70%', count: 0 },
  { range: '71–85%', count: 0 },
  { range: '86–95%', count: 0 },
  { range: '96–100%', count: 0 },
];
mockLeadReplies.forEach(r => {
  if (r.ai_confidence === null) return;
  const pct = r.ai_confidence * 100;
  if (pct <= 50) confidenceBuckets[0].count++;
  else if (pct <= 70) confidenceBuckets[1].count++;
  else if (pct <= 85) confidenceBuckets[2].count++;
  else if (pct <= 95) confidenceBuckets[3].count++;
  else confidenceBuckets[4].count++;
});

// ── Summary KPIs from snapshots ───────────────────────────────
const totalMqls     = mockClientDailySnapshots.reduce((s, x) => s + x.mql_diff, 0);
const totalMeetings = mockClientDailySnapshots.reduce((s, x) => s + x.me_diff, 0);
const totalWon      = mockClientDailySnapshots.reduce((s, x) => s + x.won_diff, 0);
const totalOoo      = mockClientDailySnapshots[mockClientDailySnapshots.length - 1]?.ooo_accumulated ?? 0;
const totalNeg      = mockClientDailySnapshots[mockClientDailySnapshots.length - 1]?.negative_total ?? 0;
const totalHumanReplies = mockClientDailySnapshots[mockClientDailySnapshots.length - 1]?.human_replies_total ?? 0;
const latestSent    = mockClientDailySnapshots[mockClientDailySnapshots.length - 1]?.emails_sent_total ?? 0;
const totalBounces  = mockClientDailySnapshots[mockClientDailySnapshots.length - 1]?.bounce_count ?? 0;
const bounceRate    = latestSent > 0 ? ((totalBounces / latestSent) * 100).toFixed(2) : '0';
const replyRate     = latestSent > 0 ? ((totalHumanReplies / latestSent) * 100).toFixed(2) : '0';

const SUMMARY_STATS = [
  { label: 'Total MQLs',      value: totalMqls,                field: 'mql_diff Σ',          color: 'text-blue-400' },
  { label: 'Meetings',         value: totalMeetings,            field: 'me_diff Σ',           color: 'text-purple-400' },
  { label: 'Won',              value: totalWon,                  field: 'won_diff Σ',          color: 'text-green-400' },
  { label: 'Human Replies',    value: totalHumanReplies,        field: 'human_replies_total', color: 'text-indigo-400' },
  { label: 'OOO Accumulated',  value: totalOoo,                  field: 'ooo_accumulated',     color: 'text-yellow-400' },
  { label: 'Negative Total',   value: totalNeg,                  field: 'negative_total',      color: 'text-red-400' },
  { label: 'Bounce Count',     value: totalBounces,             field: 'bounce_count',        color: 'text-orange-400' },
  { label: 'Reply Rate',       value: `${replyRate}%`,          field: 'human_replies / sent', color: 'text-emerald-400' },
  { label: 'Bounce Rate',      value: `${bounceRate}%`,         field: 'bounce_count / sent', color: parseFloat(bounceRate) > 3 ? 'text-red-400' : 'text-green-400' },
];

type Tab = 'snapshots' | 'campaigns' | 'replies' | 'leads';
const TABS: { id: Tab; label: string; source: string }[] = [
  { id: 'snapshots', label: 'Snapshot Trends',      source: 'client_daily_snapshots' },
  { id: 'campaigns', label: 'Campaign Daily Stats', source: 'campaign_daily_stats' },
  { id: 'replies',   label: 'Reply Intelligence',   source: 'lead_replies' },
  { id: 'leads',     label: 'Lead Funnel',          source: 'leads' },
];

export function Analytics() {
  const [tab, setTab] = useState<Tab>('snapshots');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="mb-1">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Data sourced strictly from DB tables: <code className="text-xs bg-secondary/50 px-1 rounded">client_daily_snapshots</code>, <code className="text-xs bg-secondary/50 px-1 rounded">campaign_daily_stats</code>, <code className="text-xs bg-secondary/50 px-1 rounded">lead_replies</code>, <code className="text-xs bg-secondary/50 px-1 rounded">leads</code>
        </p>
      </div>

      {/* Summary KPI grid */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {SUMMARY_STATS.map(s => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
            <p className={`text-lg font-semibold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{s.field}</p>
          </div>
        ))}
      </div>

      {/* Bounce alert */}
      {parseFloat(bounceRate) > 3 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-red-300">Bounce Rate Alert: {bounceRate}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Exceeds 3% threshold. Check domain health in Settings → Domains. Source: <code className="text-xs bg-secondary/40 px-1 rounded">client_daily_snapshots.bounce_count</code>
            </p>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm transition-all ${tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-muted-foreground/60">{t.source}</span>
          </button>
        ))}
      </div>

      {/* SNAPSHOTS TAB */}
      {tab === 'snapshots' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MQL/Meeting/Won deltas */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Pipeline Deltas</h3>
              <p className="text-xs text-muted-foreground mb-4">mql_diff / me_diff / won_diff — client_daily_snapshots</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={snapshotTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
                  <Line type="monotone" dataKey="mql_diff" name="mql_diff" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="me_diff" name="me_diff" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="won_diff" name="won_diff" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Replies & OOO trends */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Replies & OOO Accumulated</h3>
              <p className="text-xs text-muted-foreground mb-4">human_replies_total / ooo_accumulated / negative_total</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={snapshotTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
                  <Line type="monotone" dataKey="human_replies_total" name="human_replies_total" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="ooo_accumulated" name="ooo_accumulated" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="negative_total" name="negative_total" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Snapshot table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3>client_daily_snapshots — Raw View</h3>
              <p className="text-xs text-muted-foreground">All fields from the snapshots table</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30">
                  <tr>
                    {['snapshot_date', 'inboxes_active', 'prospects_count', 'emails_sent_total', 'bounce_count', 'mql_diff', 'me_diff', 'won_diff', 'ooo_accumulated', 'negative_total', 'human_replies_total'].map(h => (
                      <th key={h} className="text-left p-2 text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockClientDailySnapshots.map(s => (
                    <tr key={s.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="p-2 whitespace-nowrap">{s.snapshot_date}</td>
                      <td className="p-2 text-blue-400">{s.inboxes_active}</td>
                      <td className="p-2">{s.prospects_count.toLocaleString()}</td>
                      <td className="p-2">{s.emails_sent_total.toLocaleString()}</td>
                      <td className="p-2 text-orange-400">{s.bounce_count}</td>
                      <td className="p-2 text-green-400">{s.mql_diff}</td>
                      <td className="p-2 text-purple-400">{s.me_diff}</td>
                      <td className="p-2 text-yellow-400">{s.won_diff}</td>
                      <td className="p-2 text-yellow-400">{s.ooo_accumulated}</td>
                      <td className="p-2 text-red-400">{s.negative_total}</td>
                      <td className="p-2">{s.human_replies_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* CAMPAIGN DAILY STATS TAB */}
      {tab === 'campaigns' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Sent Count by Campaign</h3>
              <p className="text-xs text-muted-foreground mb-4">campaign_daily_stats.sent_count (aggregated)</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={campaignAggregated}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="campaign.name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                  <Bar dataKey="sent_count" name="Sent" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Reply Rate by Campaign</h3>
              <p className="text-xs text-muted-foreground mb-4">reply_count / sent_count × 100</p>
              <div className="space-y-4 mt-2">
                {campaignAggregated.map(r => (
                  <div key={r.campaign.id}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm truncate max-w-[200px]">{r.campaign.name}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{r.sent_count.toLocaleString()} sent</span>
                        <span className={`font-medium ${r.reply_rate >= 5 ? 'text-green-400' : r.reply_rate >= 3 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {r.reply_rate}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-secondary/40 rounded-full">
                      <div
                        className={`h-full rounded-full ${r.reply_rate >= 5 ? 'bg-green-500' : r.reply_rate >= 3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(r.reply_rate * 10, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Campaign stats table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3>campaign_daily_stats — Aggregated per Campaign</h3>
            </div>
            <table className="w-full">
              <thead className="bg-secondary/30">
                <tr>
                  {['Campaign', 'Type', 'Status', 'sent_count', 'reply_count', 'bounce_count', 'unique_open_count', 'reply_rate', 'open_rate', 'bounce_rate'].map(h => (
                    <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaignAggregated.map(r => (
                  <tr key={r.campaign.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="p-3 text-sm">{r.campaign.name}</td>
                    <td className="p-3 text-xs text-muted-foreground capitalize">{r.campaign.type}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded capitalize ${
                        r.campaign.status === 'active' ? 'bg-green-500/10 text-green-400' :
                        r.campaign.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-secondary/50 text-muted-foreground'
                      }`}>{r.campaign.status ?? '—'}</span>
                    </td>
                    <td className="p-3 text-sm">{r.sent_count.toLocaleString()}</td>
                    <td className="p-3 text-sm">{r.reply_count}</td>
                    <td className="p-3 text-sm text-orange-400">{r.bounce_count}</td>
                    <td className="p-3 text-sm">{r.unique_open_count}</td>
                    <td className="p-3 text-sm text-green-400">{r.reply_rate}%</td>
                    <td className="p-3 text-sm text-blue-400">{r.open_rate}%</td>
                    <td className={`p-3 text-sm ${r.bounce_rate > 3 ? 'text-red-400' : 'text-green-400'}`}>{r.bounce_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REPLY INTELLIGENCE TAB */}
      {tab === 'replies' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* reply_intent distribution */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Reply Intent Distribution</h3>
              <p className="text-xs text-muted-foreground mb-4">lead_replies.ai_classification (inbound only)</p>
              <div className="space-y-3">
                {intentChartData.map(item => {
                  const total = intentChartData.reduce((s, i) => s + i.count, 0);
                  const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0';
                  return (
                    <div key={item.intent}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="capitalize">{item.intent.replace('_', ' ')}</span>
                        <span className="text-muted-foreground">{item.count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-secondary/40 rounded-full">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Confidence distribution */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">AI Confidence Distribution</h3>
              <p className="text-xs text-muted-foreground mb-4">lead_replies.ai_confidence (0.00–1.00)</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={confidenceBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="range" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="Replies" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* lead_replies raw table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3>lead_replies — All Records</h3>
              <p className="text-xs text-muted-foreground">Fields: direction, sequence_step, ai_classification, ai_confidence, extracted_date</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30">
                  <tr>
                    {['lead_id', 'direction', 'sequence_step', 'received_at', 'ai_classification', 'ai_confidence', 'extracted_date'].map(h => (
                      <th key={h} className="text-left p-2 text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockLeadReplies.map(r => {
                    const lead = mockLeads.find(l => l.id === r.lead_id);
                    return (
                      <tr key={r.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="p-2 text-muted-foreground">{lead?.full_name ?? r.lead_id}</td>
                        <td className="p-2 capitalize">{r.direction}</td>
                        <td className="p-2">{r.sequence_step ?? '—'}</td>
                        <td className="p-2 whitespace-nowrap">{new Date(r.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            r.ai_classification === 'positive'       ? 'bg-green-500/10 text-green-400' :
                            r.ai_classification === 'negative'       ? 'bg-red-500/10 text-red-400' :
                            r.ai_classification === 'ooo'            ? 'bg-yellow-500/10 text-yellow-400' :
                            r.ai_classification === 'info_requested' ? 'bg-blue-500/10 text-blue-400' :
                            'bg-secondary/50 text-muted-foreground'
                          }`}>{r.ai_classification}</span>
                        </td>
                        <td className="p-2 text-green-400">{r.ai_confidence !== null ? `${Math.round(r.ai_confidence * 100)}%` : '—'}</td>
                        <td className="p-2 text-yellow-400">{r.extracted_date ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* LEAD FUNNEL TAB */}
      {tab === 'leads' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Qualification funnel */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">Lead Qualification Funnel</h3>
              <p className="text-xs text-muted-foreground mb-4">leads.qualification (current state of all leads)</p>
              <div className="space-y-3">
                {qualificationFunnel.map((q, i) => (
                  <div key={q.stage}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{q.stage.replace('_', ' ')}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">{q.count} leads</span>
                        {i > 0 && qualificationFunnel[i - 1].count > 0 && (
                          <span className="text-muted-foreground">
                            → {((q.count / qualificationFunnel[i - 1].count) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2.5 bg-secondary/40 rounded-full">
                      <div className="h-full rounded-full" style={{ width: `${(q.count / mockLeads.length) * 100}%`, backgroundColor: q.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* OOO leads */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="mb-1">OOO Leads</h3>
              <p className="text-xs text-muted-foreground mb-4">leads.is_ooo = true → expected_return_date</p>
              {mockLeads.filter(l => l.is_ooo).length > 0 ? (
                <div className="space-y-3">
                  {mockLeads.filter(l => l.is_ooo).map(l => (
                    <div key={l.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm">{l.full_name ?? l.email}</p>
                          <p className="text-xs text-muted-foreground">{l.company_name} · {l.job_title}</p>
                        </div>
                        <span className="text-xs text-yellow-400">Returns: {l.expected_return_date ?? '—'}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Campaign: {mockCampaigns.find(c => c.id === l.campaign_id)?.name ?? '—'} · gender: {l.gender}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No OOO leads currently</p>
              )}
            </div>
          </div>

          {/* leads raw table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3>leads — All Visible Records</h3>
              <p className="text-xs text-muted-foreground">RLS policy: clients_see_only_qualified_leads (preMQL and above)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30">
                  <tr>
                    {['full_name', 'email', 'company_name', 'job_title', 'gender', 'qualification', 'is_ooo', 'replied_at_step', 'total_replies_count', 'latest_reply_at'].map(h => (
                      <th key={h} className="text-left p-2 text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mockLeads.map(l => (
                    <tr key={l.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="p-2 whitespace-nowrap">{l.full_name ?? '—'}</td>
                      <td className="p-2 text-muted-foreground">{l.email}</td>
                      <td className="p-2">{l.company_name ?? '—'}</td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">{l.job_title ?? '—'}</td>
                      <td className="p-2 capitalize">{l.gender}</td>
                      <td className="p-2">
                        <span className="px-1.5 py-0.5 bg-secondary/50 rounded capitalize whitespace-nowrap">
                          {l.qualification.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-2">{l.is_ooo ? <span className="text-yellow-400">true</span> : 'false'}</td>
                      <td className="p-2">{l.replied_at_step ?? '—'}</td>
                      <td className="p-2">{l.total_replies_count}</td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {l.latest_reply_at ? new Date(l.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
