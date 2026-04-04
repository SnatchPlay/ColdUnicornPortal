import { useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, XCircle, ChevronDown, Calendar, Info } from 'lucide-react';
import { mockClients, mockPdca, mockUsers, mockHealthAssessments } from '../../data/mock';
import type { PdcaStatus, ClientPdca } from '../../data/mock';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';

const STATUS_CFG: Record<PdcaStatus, { label: string; icon: typeof CheckCircle2; color: string; dot: string; bg: string }> = {
  done:        { label: 'Done',        icon: CheckCircle2, color: 'text-green-400',          dot: 'bg-green-400',  bg: 'bg-green-500/8 border-green-500/20' },
  in_progress: { label: 'In Progress', icon: Clock,        color: 'text-blue-400',            dot: 'bg-blue-400',   bg: 'bg-blue-500/8 border-blue-500/20' },
  pending:     { label: 'Pending',     icon: Info,         color: 'text-muted-foreground',    dot: 'bg-gray-500',   bg: 'bg-white/3 border-border' },
  blocked:     { label: 'Blocked',     icon: XCircle,      color: 'text-red-400',             dot: 'bg-red-400',    bg: 'bg-red-500/8 border-red-500/20' },
};

const PHASES: { key: keyof Omit<ClientPdca, 'client_id'>; label: string; desc: string; color: string }[] = [
  { key: 'plan',  label: 'Plan',  desc: 'ICP, strategy, copy',  color: '#3b82f6' },
  { key: 'do',    label: 'Do',    desc: 'Execution, sending',   color: '#8b5cf6' },
  { key: 'check', label: 'Check', desc: 'KPIs, health review',  color: '#f59e0b' },
  { key: 'act',   label: 'Act',   desc: 'Improvements, A/B',    color: '#10b981' },
];

function StatusBadge({ status }: { status: PdcaStatus }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function CellDetail({ cell }: { cell: ClientPdca['plan'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
        <StatusBadge status={cell.status} />
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {cell.items.map((item, i) => (
            <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_CFG[cell.status].dot}`} />
              {item}
            </p>
          ))}
          {cell.due && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Calendar className="w-3 h-3" />Due {cell.due}</p>}
          {cell.note && <p className="text-xs text-yellow-400 flex items-start gap-1 mt-1"><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />{cell.note}</p>}
        </div>
      )}
    </div>
  );
}

export function AdminPDCA() {
  const [view, setView] = useState<'matrix' | 'cards'>('matrix');
  const [expandAll, setExpandAll] = useState(false);

  const enriched = mockClients.map(c => {
    const pdca = mockPdca.find(p => p.client_id === c.id);
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest = assessments[0];
    const health = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as const;
    const manager = mockUsers.find(u => u.id === c.cs_manager_id);
    return { client: c, pdca, health, manager };
  });

  // Summary stats
  const allCells = enriched.flatMap(e => e.pdca ? PHASES.map(p => e.pdca![p.key].status) : []);
  const statusCounts = allCells.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="mb-1">PDCA Matrix</h1>
          <p className="text-sm text-muted-foreground">Plan → Do → Check → Act status across all clients</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-card border border-border rounded-xl overflow-hidden">
            <button onClick={() => setView('matrix')} className={`px-3 py-2 text-xs transition-colors ${view === 'matrix' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Matrix</button>
            <button onClick={() => setView('cards')}  className={`px-3 py-2 text-xs transition-colors ${view === 'cards'  ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Cards</button>
          </div>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(STATUS_CFG).map(([status, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={status} className={`border rounded-xl p-4 ${cfg.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${cfg.color}`} />
                <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className={`text-2xl ${cfg.color}`}>{statusCounts[status] ?? 0}</p>
              <p className="text-xs text-muted-foreground">cells</p>
            </div>
          );
        })}
      </div>

      {/* ── MATRIX VIEW ── */}
      {view === 'matrix' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/20 border-b border-border">
                <tr>
                  <th className="text-left p-4 text-xs text-muted-foreground uppercase tracking-wider w-48">Client</th>
                  {PHASES.map(p => (
                    <th key={p.key} className="text-left p-4 w-56">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <div>
                          <p className="text-xs uppercase tracking-wider" style={{ color: p.color }}>{p.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 normal-case">{p.desc}</p>
                        </div>
                      </div>
                    </th>
                  ))}
                  <th className="text-left p-4 text-xs text-muted-foreground uppercase tracking-wider">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {enriched.map(({ client, pdca, health, manager }) => (
                  <tr key={client.id} className="hover:bg-white/2 transition-colors">
                    <td className="p-4 align-top">
                      <p className="text-sm">{client.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{manager?.full_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground/60 capitalize mt-0.5">{client.status}</p>
                    </td>
                    {PHASES.map(p => (
                      <td key={p.key} className="p-4 align-top">
                        {pdca ? <CellDetail cell={pdca[p.key]} /> : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    ))}
                    <td className="p-4 align-top"><HealthBadge status={health} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── CARDS VIEW ── */}
      {view === 'cards' && (
        <div className="space-y-4">
          {enriched.map(({ client, pdca, health, manager }) => (
            <div key={client.id} className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Client header */}
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{manager?.full_name} · <span className="capitalize">{client.status}</span></p>
                  </div>
                </div>
                <HealthBadge status={health} />
              </div>

              {/* PDCA phases grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border border-0">
                {PHASES.map(p => {
                  const cell = pdca?.[p.key];
                  const cfg = cell ? STATUS_CFG[cell.status] : null;
                  const Icon = cfg?.icon;
                  return (
                    <div key={p.key} className="p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-xs" style={{ color: p.color }}>{p.label}</span>
                      </div>
                      {cell && cfg ? (
                        <>
                          <div className="flex items-center gap-1 mb-2">
                            {Icon && <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />}
                            <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                          </div>
                          <ul className="space-y-1">
                            {cell.items.slice(0, 3).map((item, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                                <span className="leading-tight">{item}</span>
                              </li>
                            ))}
                          </ul>
                          {cell.note && <p className="text-xs text-yellow-400 mt-2 leading-tight">{cell.note}</p>}
                          {cell.due && <p className="text-xs text-muted-foreground/60 mt-1 flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" />{cell.due}</p>}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No data</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
