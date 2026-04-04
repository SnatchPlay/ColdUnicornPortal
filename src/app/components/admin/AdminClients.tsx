import { useState, useMemo } from 'react';
import { Search, X, ChevronRight, Plus } from 'lucide-react';
import type { Client, ClientStatus } from '../../data/schema';
import { mockClients, mockHealthAssessments, mockClientDailySnapshots, mockUsers, mockCampaigns } from '../../data/mock';
import type { ClientSetup } from '../../data/schema';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';
import { Client360Panel } from '../shared/Client360Panel';
import { NewClientModal } from './NewClientModal';

type StatusFilter = 'all' | ClientStatus;

const STATUS_CFG: Record<ClientStatus, { label: string; color: string }> = {
  active:     { label: 'Active',     color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  onboarding: { label: 'Onboarding', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  paused:     { label: 'Paused',     color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  churned:    { label: 'Churned',    color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  lost:       { label: 'Lost',       color: 'bg-gray-500/10 text-muted-foreground border-gray-500/20' },
};

export function AdminClients() {
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatus]     = useState<StatusFilter>('all');
  const [managerFilter, setManager]   = useState('all');
  const [selected, setSelected]       = useState<Client | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [clients, setClients]         = useState(mockClients);

  const managers = mockUsers.filter(u => u.role === 'cs_manager');

  const enriched = useMemo(() => clients.map(c => {
    const assessments = mockHealthAssessments
      .filter(h => h.client_id === c.id)
      .sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest  = assessments[0];
    const health  = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as const;
    const snaps   = mockClientDailySnapshots.filter(s => s.client_id === c.id);
    const mqls    = snaps.reduce((a, s) => a + s.mql_diff, 0);
    const meetings= snaps.reduce((a, s) => a + s.me_diff, 0);
    const manager = mockUsers.find(u => u.id === c.cs_manager_id);
    const activeCampaigns = mockCampaigns.filter(camp => camp.client_id === c.id && camp.status === 'active').length;
    return { ...c, health, mqls, meetings, manager, activeCampaigns, latestAssessment: latest };
  }), [clients]);

  const filtered = useMemo(() => enriched.filter(c => {
    const q = search.toLowerCase();
    const textMatch = [c.name, c.manager?.full_name ?? ''].join(' ').toLowerCase().includes(q);
    const statusMatch = statusFilter === 'all' || c.status === statusFilter;
    const managerMatch = managerFilter === 'all' || c.cs_manager_id === managerFilter;
    return textMatch && statusMatch && managerMatch;
  }), [enriched, search, statusFilter, managerFilter]);

  const counts = enriched.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1; return acc;
  }, {});

  const handleCreate = (client: Client, setup: ClientSetup) => {
    setClients(prev => [...prev, client]);
    setShowNewModal(false);
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="mb-1">Clients & 360°</h1>
            <p className="text-sm text-muted-foreground">Full client portfolio with health, KPIs and PDCA status. Click any row to open 360° panel.</p>
          </div>
          <button onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" />New Client
          </button>
        </div>

        {/* Status pills */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStatus('all')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${statusFilter === 'all' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
            All <span className="ml-1 opacity-60">{enriched.length}</span>
          </button>
          {(Object.entries(STATUS_CFG) as [ClientStatus, typeof STATUS_CFG[ClientStatus]][]).map(([status, cfg]) => {
            const n = counts[status] ?? 0;
            if (n === 0) return null;
            return (
              <button key={status} onClick={() => setStatus(statusFilter === status ? 'all' : status)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${statusFilter === status ? cfg.color : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
                {cfg.label} <span className="ml-1 opacity-60">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients..."
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>}
          </div>
          <select value={managerFilter} onChange={e => setManager(e.target.value)}
            className="px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-muted-foreground focus:outline-none cursor-pointer">
            <option value="all">All Managers</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/20 border-b border-border">
                <tr>
                  {['Client', 'Status', 'CS Manager', 'Health', 'MQLs', 'Meetings', 'Campaigns', 'Contract', 'Due Date', ''].map(h => (
                    <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="p-12 text-center text-muted-foreground text-sm">No clients match filters</td></tr>
                )}
                {filtered.map(c => {
                  const isSelected = selected?.id === c.id;
                  return (
                    <tr key={c.id} onClick={() => setSelected(isSelected ? null : c)}
                      className={`cursor-pointer transition-colors group ${isSelected ? 'bg-primary/5' : 'hover:bg-white/3'}`}>
                      <td className="p-3">
                        <p className="text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.id}</p>
                      </td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${STATUS_CFG[c.status]?.color ?? ''}`}>{c.status}</span>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{c.manager?.full_name ?? '—'}</td>
                      <td className="p-3"><HealthBadge status={c.health} /></td>
                      <td className="p-3">
                        <div className="text-sm">{c.mqls}</div>
                        {c.kpi_leads && <div className="text-xs text-muted-foreground">target {c.kpi_leads}/mo</div>}
                      </td>
                      <td className="p-3">
                        <div className="text-sm">{c.meetings}</div>
                        {c.kpi_meetings && <div className="text-xs text-muted-foreground">target {c.kpi_meetings}/mo</div>}
                      </td>
                      <td className="p-3">
                        <span className={`text-sm ${c.activeCampaigns > 0 ? 'text-green-400' : 'text-muted-foreground'}`}>{c.activeCampaigns} active</span>
                      </td>
                      <td className="p-3 text-sm">
                        {c.contracted_amount ? `€${c.contracted_amount.toLocaleString()}` : '—'}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {c.contract_due_date ? (
                          <span className={new Date(c.contract_due_date) < new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) ? 'text-yellow-400' : ''}>
                            {c.contract_due_date}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-3">
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-border/50 text-xs text-muted-foreground">
            {filtered.length} of {enriched.length} clients
          </div>
        </div>
      </div>

      {selected && <Client360Panel client={selected} onClose={() => setSelected(null)} />}
      {showNewModal && <NewClientModal onClose={() => setShowNewModal(false)} onCreate={handleCreate} />}
    </>
  );
}