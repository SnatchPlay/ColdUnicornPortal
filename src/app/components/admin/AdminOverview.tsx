import { useMemo } from 'react';
import { Users, DollarSign, TrendingUp, Send, AlertTriangle, CheckCircle2, Target, BarChart3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend } from 'recharts';
import { mockClients, mockClientDailySnapshots, mockHealthAssessments, mockCampaigns, mockCampaignDailyStats, mockInvoices, mockUsers, mockAgencyCrmDeals } from '../../data/mock';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';
import type { HealthStatus } from '../../data/schema';

const TT = { contentStyle: { backgroundColor: 'rgba(13,13,13,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', fontSize: 11, padding: '6px 10px' }, cursor: { fill: 'rgba(255,255,255,0.03)' } };

function KpiCard({ label, value, sub, icon: Icon, color, border }: { label: string; value: string | number; sub?: string; icon: typeof Users; color: string; border: string }) {
  return (
    <div className={`bg-card border ${border} rounded-xl p-4 relative overflow-hidden`}>
      <div className={`absolute inset-0 bg-gradient-to-br opacity-50 pointer-events-none`} style={{ background: `linear-gradient(135deg, ${color}10 0%, transparent 70%)` }} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}20` }}>
            <Icon className="w-3.5 h-3.5" style={{ color }} />
          </div>
        </div>
        <p className="text-xl" style={{ color }}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/60 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export function AdminOverview() {
  const activeClients = mockClients.filter(c => c.status === 'active');
  const mrr = mockInvoices.filter(i => i.status !== 'overdue').reduce((acc, inv) => {
    const client = mockClients.find(c => c.id === inv.client_id);
    return acc + (client?.contracted_amount ?? 0);
  }, 0);
  const uniqueMrr = mockClients.filter(c => c.status === 'active' || c.status === 'onboarding')
    .reduce((acc, c) => acc + (c.contracted_amount ?? 0), 0);

  const totalMqls     = mockClientDailySnapshots.reduce((a, s) => a + s.mql_diff, 0);
  const totalMeetings = mockClientDailySnapshots.reduce((a, s) => a + s.me_diff, 0);
  const totalWon      = mockClientDailySnapshots.reduce((a, s) => a + s.won_diff, 0);

  const activeCampaigns = mockCampaigns.filter(c => c.status === 'active').length;
  const totalSent = mockCampaignDailyStats.reduce((a, s) => a + s.sent_count, 0);

  const overdueInvoices = mockInvoices.filter(i => i.status === 'overdue').length;

  // Health distribution
  const healthDist = mockClients.map(c => {
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    if (!assessments[0]) return 'unknown';
    const a = assessments[0];
    return getOverallHealth([a.ip_health, a.domains_health, a.warmup_health, a.copy_health, a.funnel_health]);
  });

  const greenCount   = healthDist.filter(h => h === 'green').length;
  const yellowCount  = healthDist.filter(h => h === 'yellow').length;
  const redCount     = healthDist.filter(h => h === 'red').length;
  const unknownCount = healthDist.filter(h => h === 'unknown').length;

  // MQL trend (all clients combined by date)
  const mqlByDate = useMemo(() => {
    const map: Record<string, number> = {};
    mockClientDailySnapshots.forEach(s => {
      const d = s.snapshot_date;
      map[d] = (map[d] ?? 0) + s.mql_diff;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([date, mqls]) => ({
      date, // keep raw ISO string as unique key
      label: new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      mqls,
    }));
  }, []);

  // Revenue by month (from invoices)
  const revenueByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    mockInvoices.forEach(inv => {
      const m = inv.issue_date.slice(0, 7);
      map[m] = (map[m] ?? 0) + inv.amount;
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([month, revenue]) => ({
      month, // keep raw YYYY-MM as unique key
      label: new Date(month + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      revenue,
    }));
  }, []);

  // CRM pipeline
  const pipeline = mockAgencyCrmDeals.filter(d => !['won','lost'].includes(d.stage));
  const pipelineValue = pipeline.reduce((a, d) => a + (d.estimated_value ?? 0), 0);

  // Per-client health summary
  const clientHealth = mockClients.map(c => {
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest = assessments[0];
    const health = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as HealthStatus;
    const manager = mockUsers.find(u => u.id === c.cs_manager_id);
    const snaps = mockClientDailySnapshots.filter(s => s.client_id === c.id);
    const mqls = snaps.reduce((a, s) => a + s.mql_diff, 0);
    const meetings = snaps.reduce((a, s) => a + s.me_diff, 0);
    return { client: c, health, manager, mqls, meetings };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1">Agency Overview</h1>
        <p className="text-sm text-muted-foreground">Real-time snapshot of GHEADS portfolio</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Active Clients"    value={activeClients.length} sub={`${mockClients.length} total`}       icon={Users}      color="#3b82f6" border="border-blue-500/20" />
        <KpiCard label="Monthly Revenue"   value={`€${uniqueMrr.toLocaleString()}`} sub="MRR"          icon={DollarSign} color="#10b981" border="border-green-500/20" />
        <KpiCard label="Active Campaigns"  value={activeCampaigns}      sub={`${totalSent.toLocaleString()} sent`} icon={Send}       color="#8b5cf6" border="border-purple-500/20" />
        <KpiCard label="Total MQLs"        value={totalMqls}            sub={`${totalMeetings} meetings · ${totalWon} won`} icon={Target} color="#f59e0b" border="border-amber-500/20" />
      </div>

      {/* Alerts */}
      {(overdueInvoices > 0 || redCount > 0) && (
        <div className="flex flex-wrap gap-3">
          {overdueInvoices > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/8 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertTriangle className="w-4 h-4" />
              {overdueInvoices} overdue invoice{overdueInvoices > 1 ? 's' : ''}
            </div>
          )}
          {redCount > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/8 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertTriangle className="w-4 h-4" />
              {redCount} client{redCount > 1 ? 's' : ''} with red health
            </div>
          )}
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-1">MQL Trend (All Clients)</h3>
          <p className="text-xs text-muted-foreground mb-4">Daily MQL delta across portfolio</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={mqlByDate} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => { const d = new Date(v); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...TT} labelFormatter={(v) => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
              <Bar dataKey="mqls" name="MQLs" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-1">Revenue Trend</h3>
          <p className="text-xs text-muted-foreground mb-4">Monthly invoiced revenue</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revenueByMonth} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={(v) => new Date(v + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
              <Tooltip {...TT} formatter={(v: number) => [`€${v.toLocaleString()}`, 'Revenue']} labelFormatter={(v) => new Date(v + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} />
              <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Health distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-4">Health Distribution</h3>
          <div className="space-y-3">
            {[
              { label: 'Green',   count: greenCount,   color: 'bg-green-500',   text: 'text-green-400' },
              { label: 'Yellow',  count: yellowCount,  color: 'bg-yellow-500',  text: 'text-yellow-400' },
              { label: 'Red',     count: redCount,     color: 'bg-red-500',     text: 'text-red-400' },
              { label: 'Unknown', count: unknownCount, color: 'bg-gray-500',    text: 'text-muted-foreground' },
            ].map(h => (
              <div key={h.label} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${h.color} shrink-0`} />
                <span className="text-sm flex-1">{h.label}</span>
                <span className={`text-sm ${h.text}`}>{h.count}</span>
                <div className="w-20 bg-white/5 rounded-full h-1.5">
                  <div className={`h-full rounded-full ${h.color}`} style={{ width: `${mockClients.length > 0 ? (h.count / mockClients.length) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-4">Pipeline (CRM)</h3>
          <p className="text-2xl text-blue-400 mb-1">€{pipelineValue.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mb-4">Active pipeline value</p>
          {pipeline.slice(0, 4).map(d => (
            <div key={d.id} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
              <div>
                <p className="text-xs">{d.company_name}</p>
                <p className="text-xs text-muted-foreground capitalize">{d.stage}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-green-400">€{d.estimated_value?.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{d.win_chance}%</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm mb-4">Invoice Status</h3>
          {[
            { label: 'Paid',    status: 'paid',    color: 'text-green-400' },
            { label: 'Sent',    status: 'sent',    color: 'text-blue-400' },
            { label: 'Draft',   status: 'draft',   color: 'text-muted-foreground' },
            { label: 'Overdue', status: 'overdue', color: 'text-red-400' },
          ].map(s => {
            const invs = mockInvoices.filter(i => i.status === s.status);
            const total = invs.reduce((a, i) => a + i.amount, 0);
            return (
              <div key={s.status} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <span className="text-sm">{s.label} <span className="text-muted-foreground text-xs">({invs.length})</span></span>
                <span className={`text-sm ${s.color}`}>€{total.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Client health table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm">Client Portfolio Snapshot</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary/20 border-b border-border">
              <tr>
                {['Client', 'Status', 'CS Manager', 'Health', 'MQLs', 'Meetings', 'Contract'].map(h => (
                  <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {clientHealth.map(({ client, health, manager, mqls, meetings }) => (
                <tr key={client.id} className="hover:bg-white/3 transition-colors">
                  <td className="p-3 text-sm">{client.name}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${
                      client.status === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                      client.status === 'onboarding' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                      client.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                      'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>{client.status}</span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{manager?.full_name ?? '—'}</td>
                  <td className="p-3"><HealthBadge status={health} /></td>
                  <td className="p-3 text-sm">{mqls}</td>
                  <td className="p-3 text-sm">{meetings}</td>
                  <td className="p-3 text-xs text-muted-foreground">€{client.contracted_amount?.toLocaleString() ?? '—'}/mo</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}