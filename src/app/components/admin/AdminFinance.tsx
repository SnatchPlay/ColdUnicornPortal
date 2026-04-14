import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Users, Handshake, Target, Pencil, Save, Plus, X } from 'lucide-react';
import { mockCashFlow, mockPartnerships, mockAccountBasedSelling, mockInvoices, mockClients } from '../../data/mock';
import type { CashFlowProjection, Partnership, AccountBasedSelling, PartnershipStatus, AbsStatus } from '../../data/schema';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts';

type FinTab = 'cashflow' | 'invoices' | 'partnerships' | 'abs';

const TT = {
  contentStyle: { backgroundColor: 'rgba(13,13,13,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', fontSize: 11, padding: '6px 10px' },
};

const ABS_COLOR: Record<AbsStatus, string> = {
  prospect:  'text-gray-400 bg-gray-500/10 border-gray-500/20',
  contacted: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  engaged:   'text-purple-400 bg-purple-500/10 border-purple-500/20',
  won:       'text-green-400 bg-green-500/10 border-green-500/20',
  lost:      'text-red-400 bg-red-500/10 border-red-500/20',
};
const PART_COLOR: Record<PartnershipStatus, string> = {
  active: 'text-green-400 bg-green-500/10 border-green-500/20',
  paused: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  ended:  'text-gray-400 bg-gray-500/10 border-gray-500/20',
};
const INV_COLOR: Record<string, string> = {
  paid:    'text-green-400 bg-green-500/10 border-green-500/20',
  sent:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
  draft:   'text-gray-400 bg-gray-500/10 border-gray-500/20',
  overdue: 'text-red-400 bg-red-500/10 border-red-500/20',
};

export function AdminFinance() {
  const [activeTab, setActiveTab] = useState<FinTab>('cashflow');
  const [cashFlow, setCashFlow]   = useState<CashFlowProjection[]>(mockCashFlow);
  const [partners, setPartners]   = useState<Partnership[]>(mockPartnerships);
  const [abs, setAbs]             = useState<AccountBasedSelling[]>(mockAccountBasedSelling);
  const [invoices, setInvoices]   = useState(mockInvoices);
  const [editCfRow, setEditCfRow] = useState<string | null>(null);
  const [cfEdits, setCfEdits]     = useState<Partial<CashFlowProjection>>({});

  const TABS: { id: FinTab; label: string }[] = [
    { id: 'cashflow',     label: 'Cash Flow' },
    { id: 'invoices',     label: 'Invoices' },
    { id: 'partnerships', label: 'Partnerships' },
    { id: 'abs',          label: 'ABS Scoring' },
  ];

  // Cash flow totals
  const historical = cashFlow.filter(c => c.actual_revenue !== null);
  const totalRevenue  = historical.reduce((a, c) => a + (c.actual_revenue ?? 0), 0);
  const totalCosts    = historical.reduce((a, c) => a + (c.actual_costs ?? 0), 0);
  const netProfit     = totalRevenue - totalCosts;
  const projectedRev  = cashFlow.filter(c => c.actual_revenue === null).reduce((a, c) => a + c.expected_revenue, 0);

  const chartData = cashFlow.map(c => ({
    month: c.month,
    'Expected Rev': c.expected_revenue,
    'Actual Rev':   c.actual_revenue ?? 0,
    'Expected Cost':c.expected_costs,
    'Actual Cost':  c.actual_costs ?? 0,
  }));

  const saveCfRow = (id: string) => {
    setCashFlow(prev => prev.map(c => c.id === id ? { ...c, ...cfEdits } : c));
    setEditCfRow(null);
    setCfEdits({});
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">Finance</h1>
        <p className="text-sm text-muted-foreground">Cash flow, invoicing, partnerships and ABS scoring.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Revenue (YTD)',  value: `€${totalRevenue.toLocaleString()}`,  color: '#10b981', icon: TrendingUp },
          { label: 'Costs (YTD)',    value: `€${totalCosts.toLocaleString()}`,     color: '#f59e0b', icon: TrendingDown },
          { label: 'Net Profit',     value: `€${netProfit.toLocaleString()}`,      color: netProfit > 0 ? '#3b82f6' : '#ef4444', icon: DollarSign },
          { label: 'Projected (3mo)',value: `€${projectedRev.toLocaleString()}`,   color: '#8b5cf6', icon: Target },
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

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-xs border-b-2 transition-colors ${activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cash Flow ── */}
      {activeTab === 'cashflow' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm mb-4">Revenue vs Costs</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                <Tooltip {...TT} formatter={(v: number) => [`€${v.toLocaleString()}`, '']} />
                <Bar dataKey="Expected Rev"  fill="#3b82f630" radius={[2,2,0,0]} maxBarSize={20} />
                <Bar dataKey="Actual Rev"    fill="#3b82f6"   radius={[2,2,0,0]} maxBarSize={20} />
                <Bar dataKey="Expected Cost" fill="#ef444430" radius={[2,2,0,0]} maxBarSize={20} />
                <Bar dataKey="Actual Cost"   fill="#f59e0b"   radius={[2,2,0,0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-white/3">
                  {['Month','Exp. Rev','Act. Rev','Exp. Cost','Act. Cost','Net','Notes',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cashFlow.map(row => {
                  const net = (row.actual_revenue ?? row.expected_revenue) - (row.actual_costs ?? row.expected_costs);
                  const editing = editCfRow === row.id;
                  return (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">{row.month}</td>
                      <td className="px-4 py-3">€{row.expected_revenue.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <input type="number" value={cfEdits.actual_revenue ?? row.actual_revenue ?? ''}
                            onChange={e => setCfEdits(p => ({ ...p, actual_revenue: Number(e.target.value) || null }))}
                            className="w-24 px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                        ) : (
                          <span className={row.actual_revenue !== null ? 'text-green-400' : 'text-muted-foreground/50'}>
                            {row.actual_revenue !== null ? `€${row.actual_revenue.toLocaleString()}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">€{row.expected_costs.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <input type="number" value={cfEdits.actual_costs ?? row.actual_costs ?? ''}
                            onChange={e => setCfEdits(p => ({ ...p, actual_costs: Number(e.target.value) || null }))}
                            className="w-24 px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                        ) : (
                          <span className={row.actual_costs !== null ? 'text-yellow-400' : 'text-muted-foreground/50'}>
                            {row.actual_costs !== null ? `€${row.actual_costs.toLocaleString()}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${net > 0 ? 'text-green-400' : 'text-red-400'}`}>€{net.toLocaleString()}</td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {editing ? (
                          <input value={cfEdits.notes ?? row.notes ?? ''}
                            onChange={e => setCfEdits(p => ({ ...p, notes: e.target.value }))}
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                        ) : (
                          <span className="text-muted-foreground truncate block">{row.notes ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <div className="flex gap-1">
                            <button onClick={() => saveCfRow(row.id)} className="p-1 text-green-400 hover:bg-green-500/10 rounded"><Save className="w-3 h-3" /></button>
                            <button onClick={() => { setEditCfRow(null); setCfEdits({}); }} className="p-1 text-muted-foreground hover:bg-white/5 rounded"><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditCfRow(row.id); setCfEdits({}); }} className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded">
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Invoices ── */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
            {(['paid','sent','draft','overdue'] as const).map(s => {
              const total = invoices.filter(i => i.status === s).reduce((a, i) => a + i.amount, 0);
              return (
                <div key={s} className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1 capitalize">{s}</p>
                  <p className={`text-lg ${INV_COLOR[s].split(' ')[0]}`}>€{total.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-white/3">
                  {['Client','Issue Date','Amount','Status','Vindication','Notes',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const client = mockClients.find(c => c.id === inv.client_id);
                  return (
                    <tr key={inv.id} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">{client?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.issue_date}</td>
                      <td className="px-4 py-3">€{inv.amount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <select value={inv.status} onChange={e => setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: e.target.value as any } : i))}
                          className={`text-xs px-2 py-0.5 rounded-lg border bg-transparent cursor-pointer focus:outline-none ${INV_COLOR[inv.status]}`}>
                          {['draft','sent','paid','overdue'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-orange-400">{inv.vindication_stage ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <button className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Partnerships ── */}
      {activeTab === 'partnerships' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: 'Active',      count: partners.filter(p => p.status === 'active').length,  color: 'text-green-400' },
              { label: 'Monthly Cost',value: `€${partners.filter(p => p.status === 'active').reduce((a, p) => a + (p.monthly_fee ?? 0), 0).toLocaleString()}`, color: 'text-yellow-400' },
              { label: 'Total',       count: partners.length, color: 'text-muted-foreground' },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                <p className={`text-lg ${k.color}`}>{k.count ?? k.value}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {partners.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{p.partner_name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${PART_COLOR[p.status]}`}>{p.status}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {p.contact_name && <span>{p.contact_name}</span>}
                      {p.email && <span>{p.email}</span>}
                      {p.monthly_fee && <span className="text-yellow-400">€{p.monthly_fee}/mo</span>}
                    </div>
                    {p.notes && <p className="text-xs text-muted-foreground mt-2">{p.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <select value={p.status} onChange={e => setPartners(prev => prev.map(x => x.id === p.id ? { ...x, status: e.target.value as PartnershipStatus } : x))}
                      className="text-xs px-2 py-1 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer">
                      {(['active','paused','ended'] as PartnershipStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ABS Scoring ── */}
      {activeTab === 'abs' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Account-Based Selling tracker — high-value target companies for GHEADS agency growth.</p>
          <div className="space-y-3">
            {abs.sort((a, b) => b.score - a.score).map(item => (
              <div key={item.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-sm">{item.company_name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${ABS_COLOR[item.status]}`}>{item.status}</span>
                      {item.decision_maker && <span className="text-xs text-muted-foreground">{item.decision_maker}</span>}
                    </div>
                    {item.notes && <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Score ring */}
                    <div className="text-center">
                      <p className={`text-lg ${item.score >= 80 ? 'text-green-400' : item.score >= 60 ? 'text-yellow-400' : 'text-muted-foreground'}`}>{item.score}</p>
                      <p className="text-xs text-muted-foreground">score</p>
                    </div>
                    <select value={item.status} onChange={e => setAbs(prev => prev.map(x => x.id === item.id ? { ...x, status: e.target.value as AbsStatus } : x))}
                      className="text-xs px-2 py-1 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer">
                      {(['prospect','contacted','engaged','won','lost'] as AbsStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-white/5 rounded-full">
                  <div className={`h-full rounded-full transition-all ${item.score >= 80 ? 'bg-green-500' : item.score >= 60 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                    style={{ width: `${item.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
