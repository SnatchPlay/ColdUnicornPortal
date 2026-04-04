import { useState, useMemo } from 'react';
import { Plus, Mail, Phone, User, ChevronRight, ChevronLeft, DollarSign, X, TrendingUp } from 'lucide-react';
import type { AgencyCrmDeal, CrmPipelineStage } from '../../data/schema';
import { mockAgencyCrmDeals, mockUsers } from '../../data/mock';

const STAGES: { id: CrmPipelineStage; label: string; color: string; dot: string }[] = [
  { id: 'new',         label: 'New',         color: 'border-gray-500/30  bg-gray-500/5',   dot: 'bg-gray-500' },
  { id: 'contacted',   label: 'Contacted',   color: 'border-blue-500/30  bg-blue-500/5',   dot: 'bg-blue-400' },
  { id: 'qualified',   label: 'Qualified',   color: 'border-indigo-500/30 bg-indigo-500/5', dot: 'bg-indigo-400' },
  { id: 'proposal',    label: 'Proposal',    color: 'border-purple-500/30 bg-purple-500/5', dot: 'bg-purple-400' },
  { id: 'negotiation', label: 'Negotiation', color: 'border-orange-500/30 bg-orange-500/5', dot: 'bg-orange-400' },
  { id: 'won',         label: 'Won',         color: 'border-green-500/30  bg-green-500/5',  dot: 'bg-green-400' },
  { id: 'lost',        label: 'Lost',        color: 'border-red-500/30    bg-red-500/5',    dot: 'bg-red-400' },
];

const STAGE_ORDER = STAGES.map(s => s.id);

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function WinChanceBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 bg-white/10 rounded-full h-1">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-7">{pct}%</span>
    </div>
  );
}

function DealCard({ deal, onMove }: { deal: AgencyCrmDeal; onMove: (id: string, dir: 'prev' | 'next') => void }) {
  const [expanded, setExpanded] = useState(false);
  const sp = mockUsers.find(u => u.id === deal.salesperson_id);
  const days = daysSince(deal.stage_updated_at);
  const stageIdx = STAGE_ORDER.indexOf(deal.stage);

  return (
    <div className="bg-[#181818] border border-border rounded-xl p-3 hover:border-primary/20 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm leading-tight">{deal.company_name}</p>
          {deal.contact_name && <p className="text-xs text-muted-foreground mt-0.5">{deal.contact_name}</p>}
        </div>
        {deal.estimated_value && (
          <span className="text-xs text-green-400 shrink-0">€{deal.estimated_value.toLocaleString()}</span>
        )}
      </div>

      {deal.win_chance !== null && deal.win_chance > 0 && <WinChanceBar pct={deal.win_chance} />}

      <div className="flex items-center justify-between mt-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {sp && <span className="flex items-center gap-1"><User className="w-3 h-3" />{sp.full_name.split(' ')[0]}</span>}
          {deal.source && <span className="opacity-60">{deal.source}</span>}
        </div>
        <span className={`text-xs ${days > 14 ? 'text-yellow-400' : 'text-muted-foreground'}`}>{days}d</span>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs text-muted-foreground">
          {deal.email && <p className="flex items-center gap-1.5"><Mail className="w-3 h-3" />{deal.email}</p>}
          {deal.phone && <p className="flex items-center gap-1.5"><Phone className="w-3 h-3" />{deal.phone}</p>}
          {deal.lesson_learned && <p className="text-yellow-400/80 mt-1 leading-relaxed">{deal.lesson_learned}</p>}
        </div>
      )}

      <div className="flex items-center justify-between mt-2.5">
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {expanded ? 'Less' : 'More'}
        </button>
        <div className="flex gap-1">
          {stageIdx > 0 && (
            <button onClick={() => onMove(deal.id, 'prev')}
              className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
          {stageIdx < STAGE_ORDER.length - 1 && (
            <button onClick={() => onMove(deal.id, 'next')}
              className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminCRM() {
  const [deals, setDeals] = useState<AgencyCrmDeal[]>(mockAgencyCrmDeals);
  const [view, setView]   = useState<'kanban' | 'table'>('kanban');

  const handleMove = (id: string, dir: 'prev' | 'next') => {
    setDeals(prev => prev.map(d => {
      if (d.id !== id) return d;
      const idx = STAGE_ORDER.indexOf(d.stage);
      const newIdx = dir === 'next' ? idx + 1 : idx - 1;
      if (newIdx < 0 || newIdx >= STAGE_ORDER.length) return d;
      return { ...d, stage: STAGE_ORDER[newIdx], stage_updated_at: new Date().toISOString() };
    }));
  };

  // Pipeline stats
  const activePipeline = deals.filter(d => !['won','lost'].includes(d.stage));
  const pipelineValue  = activePipeline.reduce((a, d) => a + (d.estimated_value ?? 0), 0);
  const wonValue       = deals.filter(d => d.stage === 'won').reduce((a, d) => a + (d.estimated_value ?? 0), 0);
  const weightedValue  = activePipeline.reduce((a, d) => a + (d.estimated_value ?? 0) * ((d.win_chance ?? 0) / 100), 0);
  const winRate        = deals.filter(d => ['won','lost'].includes(d.stage)).length > 0
    ? Math.round((deals.filter(d => d.stage === 'won').length / deals.filter(d => ['won','lost'].includes(d.stage)).length) * 100)
    : 0;

  const stageMap = useMemo(() => {
    const map: Record<CrmPipelineStage, AgencyCrmDeal[]> = {} as any;
    STAGES.forEach(s => { map[s.id] = []; });
    deals.forEach(d => { map[d.stage].push(d); });
    return map;
  }, [deals]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="mb-1">Agency CRM</h1>
          <p className="text-sm text-muted-foreground">New client deal pipeline — move cards between stages</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-card border border-border rounded-xl overflow-hidden">
            <button onClick={() => setView('kanban')} className={`px-3 py-2 text-xs transition-colors ${view === 'kanban' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Kanban</button>
            <button onClick={() => setView('table')}  className={`px-3 py-2 text-xs transition-colors ${view === 'table'  ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>Table</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Pipeline',   value: `€${pipelineValue.toLocaleString()}`,       color: 'text-blue-400',  icon: TrendingUp },
          { label: 'Weighted Pipeline', value: `€${Math.round(weightedValue).toLocaleString()}`, color: 'text-purple-400', icon: DollarSign },
          { label: 'Won Revenue',       value: `€${wonValue.toLocaleString()}`,             color: 'text-green-400', icon: DollarSign },
          { label: 'Win Rate',          value: `${winRate}%`,                               color: 'text-amber-400', icon: TrendingUp },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${s.color}`} />
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
              <p className={`text-xl ${s.color}`}>{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Kanban Board */}
      {view === 'kanban' && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {STAGES.map(stage => {
              const stageDeal = stageMap[stage.id];
              const stageValue = stageDeal.reduce((a, d) => a + (d.estimated_value ?? 0), 0);
              return (
                <div key={stage.id} className={`w-56 flex flex-col rounded-xl border ${stage.color} p-3`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                      <span className="text-xs">{stage.label}</span>
                      <span className="text-xs text-muted-foreground">({stageDeal.length})</span>
                    </div>
                    {stageValue > 0 && <span className="text-xs text-muted-foreground">€{(stageValue/1000).toFixed(0)}k</span>}
                  </div>
                  <div className="space-y-2 flex-1">
                    {stageDeal.map(deal => (
                      <DealCard key={deal.id} deal={deal} onMove={handleMove} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/20 border-b border-border">
                <tr>
                  {['Company', 'Contact', 'Stage', 'Value', 'Win%', 'Source', 'Salesperson', 'Days in Stage', 'Move'].map(h => (
                    <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {deals.map(d => {
                  const sp = mockUsers.find(u => u.id === d.salesperson_id);
                  const stageInfo = STAGES.find(s => s.id === d.stage);
                  const stageIdx = STAGE_ORDER.indexOf(d.stage);
                  return (
                    <tr key={d.id} className="hover:bg-white/3 transition-colors">
                      <td className="p-3 text-sm">{d.company_name}</td>
                      <td className="p-3 text-xs text-muted-foreground">{d.contact_name ?? '—'}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className={`w-1.5 h-1.5 rounded-full ${stageInfo?.dot}`} />
                          {stageInfo?.label}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-green-400">{d.estimated_value ? `€${d.estimated_value.toLocaleString()}` : '—'}</td>
                      <td className="p-3"><WinChanceBar pct={d.win_chance ?? 0} /></td>
                      <td className="p-3 text-xs text-muted-foreground">{d.source ?? '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{sp?.full_name ?? '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">{daysSince(d.stage_updated_at)}d</td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {stageIdx > 0 && <button onClick={() => handleMove(d.id, 'prev')} className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground"><ChevronLeft className="w-3.5 h-3.5" /></button>}
                          {stageIdx < STAGE_ORDER.length - 1 && <button onClick={() => handleMove(d.id, 'next')} className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground"><ChevronRight className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
