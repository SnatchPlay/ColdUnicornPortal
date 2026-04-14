import { useState } from 'react';
import { Plus, Pencil, Save, X, TrendingUp, DollarSign, Target } from 'lucide-react';
import { mockLgPipeline } from '../../data/mock';
import type { LgPipelineDeal, LgPipelineStage } from '../../data/schema';

const STAGES: LgPipelineStage[] = ['new', 'contacted', 'demo', 'proposal', 'closed_won', 'closed_lost'];
const STAGE_CFG: Record<LgPipelineStage, { label: string; color: string; bg: string }> = {
  new:         { label: 'New',         color: 'text-gray-400',   bg: 'bg-gray-500/10 border-gray-500/20' },
  contacted:   { label: 'Contacted',   color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  demo:        { label: 'Demo',        color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
  proposal:    { label: 'Proposal',    color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  closed_won:  { label: 'Closed Won',  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
  closed_lost: { label: 'Closed Lost', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
};

export function AdminLgPipeline() {
  const [deals, setDeals]   = useState<LgPipelineDeal[]>(mockLgPipeline);
  const [editId, setEditId] = useState<string | null>(null);
  const [edits, setEdits]   = useState<Partial<LgPipelineDeal>>({});
  const [saved, setSaved]   = useState(false);
  const [view, setView]     = useState<'kanban' | 'table'>('kanban');

  const totalPipeline    = deals.filter(d => !['closed_won','closed_lost'].includes(d.stage)).reduce((a, d) => a + (d.estimated_value ?? 0), 0);
  const wonValue         = deals.filter(d => d.stage === 'closed_won').reduce((a, d) => a + (d.estimated_value ?? 0), 0);
  const weightedPipeline = deals.filter(d => !['closed_won','closed_lost'].includes(d.stage)).reduce((a, d) => a + (d.estimated_value ?? 0) * (d.win_chance ?? 0) / 100, 0);

  const startEdit = (deal: LgPipelineDeal) => { setEditId(deal.id); setEdits({ ...deal }); setSaved(false); };
  const saveEdit  = () => {
    setDeals(prev => prev.map(d => d.id === editId ? { ...d, ...edits, updated_at: new Date().toISOString() } : d));
    setSaved(true);
    setTimeout(() => { setSaved(false); setEditId(null); }, 1000);
  };
  const updateStage = (id: string, stage: LgPipelineStage) =>
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage, updated_at: new Date().toISOString() } : d));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1">LG Pipeline</h1>
          <p className="text-sm text-muted-foreground">Lead generation deals — GHEADS agency's own new-business pipeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden border border-border text-xs">
            {(['kanban','table'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors capitalize ${view === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active Pipeline',   value: `€${totalPipeline.toLocaleString()}`,    color: '#3b82f6', icon: Target },
          { label: 'Weighted Pipeline', value: `€${Math.round(weightedPipeline).toLocaleString()}`, color: '#8b5cf6', icon: TrendingUp },
          { label: 'Closed Won',        value: `€${wonValue.toLocaleString()}`,          color: '#10b981', icon: DollarSign },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-card border border-border rounded-xl p-4">
              <div className="p-1.5 rounded-lg mb-3 w-fit" style={{ backgroundColor: `${k.color}18` }}>
                <Icon className="w-3.5 h-3.5" style={{ color: k.color }} />
              </div>
              <p className="text-xl" style={{ color: k.color }}>{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </div>
          );
        })}
      </div>

      {/* Kanban view */}
      {view === 'kanban' && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map(stage => {
            const stageCfg   = STAGE_CFG[stage];
            const stageDeals = deals.filter(d => d.stage === stage);
            const stageValue = stageDeals.reduce((a, d) => a + (d.estimated_value ?? 0), 0);
            return (
              <div key={stage} className="shrink-0 w-64">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-lg border ${stageCfg.bg} ${stageCfg.color}`}>{stageCfg.label}</span>
                    <span className="text-xs text-muted-foreground">{stageDeals.length}</span>
                  </div>
                  {stageValue > 0 && <span className="text-xs text-muted-foreground">€{stageValue.toLocaleString()}</span>}
                </div>
                <div className="space-y-2 min-h-[60px]">
                  {stageDeals.map(deal => (
                    <div key={deal.id} className="bg-card border border-border rounded-xl p-3">
                      {editId === deal.id ? (
                        <div className="space-y-2">
                          <input value={edits.company_name ?? ''} onChange={e => setEdits(p => ({ ...p, company_name: e.target.value }))}
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                          <input value={edits.contact_name ?? ''} onChange={e => setEdits(p => ({ ...p, contact_name: e.target.value }))} placeholder="Contact"
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                          <input type="number" value={edits.estimated_value ?? ''} onChange={e => setEdits(p => ({ ...p, estimated_value: Number(e.target.value) }))} placeholder="Value €"
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                          <input type="number" value={edits.win_chance ?? ''} onChange={e => setEdits(p => ({ ...p, win_chance: Number(e.target.value) }))} placeholder="Win % (0-100)"
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none" />
                          <textarea value={edits.notes ?? ''} onChange={e => setEdits(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" rows={2}
                            className="w-full px-2 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none resize-none" />
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="flex-1 py-1 bg-primary text-primary-foreground rounded text-xs flex items-center justify-center gap-1">
                              <Save className="w-3 h-3" />{saved ? 'Saved!' : 'Save'}
                            </button>
                            <button onClick={() => setEditId(null)} className="p-1 border border-border rounded text-xs text-muted-foreground">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs">{deal.company_name}</p>
                            <button onClick={() => startEdit(deal)} className="p-0.5 text-muted-foreground hover:text-foreground shrink-0">
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          {deal.contact_name && <p className="text-xs text-muted-foreground">{deal.contact_name}</p>}
                          {deal.estimated_value && (
                            <p className="text-xs text-green-400 mt-1">€{deal.estimated_value.toLocaleString()}</p>
                          )}
                          {deal.win_chance !== null && (
                            <div className="mt-2 h-1 bg-white/5 rounded-full">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${deal.win_chance}%` }} />
                            </div>
                          )}
                          {deal.notes && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{deal.notes}</p>}
                          {deal.next_follow_up && (
                            <p className="text-xs text-blue-400 mt-1">📅 {deal.next_follow_up}</p>
                          )}
                          {/* Move stage buttons */}
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {STAGES.filter(s => s !== stage).slice(0, 3).map(s => (
                              <button key={s} onClick={() => updateStage(deal.id, s)}
                                className="text-xs px-1.5 py-0.5 border border-border rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                                → {STAGE_CFG[s].label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-white/3">
                {['Company','Contact','Stage','Value','Win%','Follow-up','Notes',''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deals.map(deal => {
                const cfg = STAGE_CFG[deal.stage];
                return (
                  <tr key={deal.id} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3">{deal.company_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{deal.contact_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <select value={deal.stage} onChange={e => updateStage(deal.id, e.target.value as LgPipelineStage)}
                        className={`text-xs px-2 py-0.5 rounded-lg border bg-transparent cursor-pointer focus:outline-none ${cfg.bg} ${cfg.color}`}>
                        {STAGES.map(s => <option key={s} value={s}>{STAGE_CFG[s].label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-green-400">{deal.estimated_value ? `€${deal.estimated_value.toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3">{deal.win_chance !== null ? `${deal.win_chance}%` : '—'}</td>
                    <td className="px-4 py-3 text-blue-400">{deal.next_follow_up ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{deal.notes ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => startEdit(deal)} className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
