import { useMemo } from 'react';
import { Target, Calendar, TrendingUp, Send, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend } from 'recharts';
import { mockClients, mockClientDailySnapshots, mockHealthAssessments, mockCampaigns, mockCampaignDailyStats, mockLeads, mockUsers } from '../../data/mock';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';
import type { HealthStatus } from '../../data/schema';

const MANAGER_ID = 'user-2'; // Alex Kovalenko

const TT = { contentStyle: { backgroundColor: 'rgba(13,13,13,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', fontSize: 11, padding: '6px 10px' }, cursor: { fill: 'rgba(255,255,255,0.03)' } };

const STATUS_COLOR: Record<string, string> = {
  active:     'text-green-400 bg-green-500/10 border-green-500/20',
  onboarding: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  paused:     'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  churned:    'text-red-400 bg-red-500/10 border-red-500/20',
};

export function ManagerDashboard() {
  const myClients = mockClients.filter(c => c.cs_manager_id === MANAGER_ID);

  const clientData = useMemo(() => myClients.map(c => {
    const snaps     = mockClientDailySnapshots.filter(s => s.client_id === c.id);
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest    = assessments[0];
    const health    = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as HealthStatus;
    const mqls      = snaps.reduce((a, s) => a + s.mql_diff, 0);
    const meetings  = snaps.reduce((a, s) => a + s.me_diff, 0);
    const won       = snaps.reduce((a, s) => a + s.won_diff, 0);
    const activeCamps = mockCampaigns.filter(camp => camp.client_id === c.id && camp.status === 'active').length;
    const latestSnap = snaps[snaps.length - 1];
    const sentTotal = latestSnap?.emails_sent_total ?? 0;
    const urgentLeads = mockLeads.filter(l => l.client_id === c.id && ['MQL','meeting_scheduled'].includes(l.qualification)).length;
    return { client: c, health, mqls, meetings, won, activeCamps, sentTotal, urgentLeads, assessments, latestAssessment: latest };
  }), [myClients]);

  // Totals
  const totalMqls     = clientData.reduce((a, c) => a + c.mqls, 0);
  const totalMeetings = clientData.reduce((a, c) => a + c.meetings, 0);
  const totalWon      = clientData.reduce((a, c) => a + c.won, 0);
  const urgentTotal   = clientData.reduce((a, c) => a + c.urgentLeads, 0);

  // Action items (attention needed)
  const attentionItems: { type: string; text: string; level: 'error' | 'warn' }[] = [];
  clientData.forEach(({ client, health, assessments, urgentLeads }) => {
    if (health === 'red')   attentionItems.push({ type: 'health', text: `${client.name}: Red health — immediate action needed`, level: 'error' });
    if (health === 'yellow' && assessments.length > 0) attentionItems.push({ type: 'health', text: `${client.name}: Yellow health — review required`, level: 'warn' });
    if (urgentLeads > 0)    attentionItems.push({ type: 'leads',  text: `${client.name}: ${urgentLeads} leads awaiting action`, level: 'warn' });
  });

  // MQL trend across my clients
  const mqlTrend = useMemo(() => {
    const myClientIds = myClients.map(c => c.id);
    const map: Record<string, number> = {};
    mockClientDailySnapshots
      .filter(s => myClientIds.includes(s.client_id))
      .forEach(s => { map[s.snapshot_date] = (map[s.snapshot_date] ?? 0) + s.mql_diff; });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, mqls]) => ({
      date,   // raw ISO string — unique key for recharts
      mqls,
    }));
  }, [myClients]);

  // Campaign perf
  const campPerf = useMemo(() => {
    const myCampIds = mockCampaigns.filter(c => myClients.map(cl => cl.id).includes(c.client_id) && c.type === 'outreach');
    return myCampIds.map(c => {
      const stats = mockCampaignDailyStats.filter(s => s.campaign_id === c.id);
      const sent = stats.reduce((a, s) => a + s.sent_count, 0);
      const replies = stats.reduce((a, s) => a + s.reply_count, 0);
      const client = mockClients.find(cl => cl.id === c.client_id);
      return { name: c.name, client: client?.name ?? '', sent, replies, rate: sent > 0 ? (replies / sent) * 100 : 0 };
    }).filter(c => c.sent > 0).sort((a, b) => b.rate - a.rate);
  }, [myClients]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1">My Dashboard</h1>
        <p className="text-sm text-muted-foreground">{mockUsers.find(u => u.id === MANAGER_ID)?.full_name} · {myClients.length} clients assigned</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total MQLs',     value: totalMqls,     color: '#3b82f6', icon: Target },
          { label: 'Meetings',       value: totalMeetings, color: '#8b5cf6', icon: Calendar },
          { label: 'Deals Won',      value: totalWon,      color: '#10b981', icon: TrendingUp },
          { label: 'Urgent Leads',   value: urgentTotal,   color: urgentTotal > 0 ? '#f59e0b' : '#6b7280', icon: Send },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-card border border-border rounded-xl p-4">
              <div className="p-1.5 rounded-lg mb-3 w-fit" style={{ backgroundColor: `${k.color}18` }}>
                <Icon className="w-3.5 h-3.5" style={{ color: k.color }} />
              </div>
              <p className="text-xl" style={{ color: k.color }}>{k.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
            </div>
          );
        })}
      </div>

      {/* Attention items */}
      {attentionItems.length > 0 && (
        <div className="space-y-2">
          {attentionItems.map((item, i) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
              item.level === 'error' ? 'bg-red-500/8 border-red-500/20 text-red-400' : 'bg-yellow-500/8 border-yellow-500/20 text-yellow-400'
            }`}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {item.text}
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-4">MQL Trend (My Clients)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={mqlTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...TT} labelFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
              <Bar dataKey="mqls" name="MQLs" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-4">Campaign Reply Rates</h3>
          <div className="space-y-3">
            {campPerf.slice(0, 5).map((c, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <p className="text-xs truncate max-w-[200px]">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.client}</p>
                  </div>
                  <span className={`text-xs ${c.rate >= 5 ? 'text-green-400' : c.rate >= 3 ? 'text-yellow-400' : 'text-red-400'}`}>{c.rate.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full">
                  <div className={`h-full rounded-full ${c.rate >= 5 ? 'bg-green-500' : c.rate >= 3 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(c.rate * 10, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Client cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {clientData.map(({ client, health, mqls, meetings, won, activeCamps, sentTotal, urgentLeads, latestAssessment }) => (
          <div key={client.id} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm">{client.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${STATUS_COLOR[client.status] ?? ''}`}>{client.status}</span>
                  <HealthBadge status={health} />
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>€{client.contracted_amount?.toLocaleString() ?? '—'}/mo</p>
                <p>Due {client.contract_due_date}</p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { label: 'MQLs',      value: mqls,        color: 'text-blue-400' },
                { label: 'Meetings',  value: meetings,    color: 'text-purple-400' },
                { label: 'Won',       value: won,         color: 'text-green-400' },
                { label: 'Campaigns', value: activeCamps, color: 'text-amber-400' },
              ].map(k => (
                <div key={k.label} className="text-center">
                  <p className={`text-base ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                </div>
              ))}
            </div>

            {/* KPI progress */}
            <div className="space-y-2">
              {client.kpi_leads && (
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>MQL target</span>
                    <span>{mqls} / {client.kpi_leads * 3}/qtr</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full">
                    <div className={`h-full rounded-full transition-all ${mqls >= client.kpi_leads * 3 ? 'bg-green-500' : mqls >= client.kpi_leads * 2 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min((mqls / (client.kpi_leads * 3)) * 100, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>

            {urgentLeads > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
                <Clock className="w-3.5 h-3.5" />
                {urgentLeads} lead{urgentLeads > 1 ? 's' : ''} need attention
              </div>
            )}

            {latestAssessment?.insights && (
              <div className="mt-3 p-3 bg-white/3 rounded-xl">
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{latestAssessment.insights}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}