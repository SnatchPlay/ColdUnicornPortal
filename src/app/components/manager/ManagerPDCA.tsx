import { useState } from 'react';
import { CheckCircle2, Clock, Info, XCircle, Calendar, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { mockClients, mockPdca, mockHealthAssessments } from '../../data/mock';
import type { PdcaStatus, ClientPdca } from '../../data/mock';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';

const MANAGER_ID = 'user-2';

const STATUS_CFG: Record<PdcaStatus, { label: string; icon: typeof CheckCircle2; color: string; dot: string; bg: string; border: string }> = {
  done:        { label: 'Done',        icon: CheckCircle2, color: 'text-green-400',       dot: 'bg-green-400',  bg: 'bg-green-500/8',  border: 'border-green-500/20' },
  in_progress: { label: 'In Progress', icon: Clock,        color: 'text-blue-400',         dot: 'bg-blue-400',   bg: 'bg-blue-500/8',   border: 'border-blue-500/20' },
  pending:     { label: 'Pending',     icon: Info,         color: 'text-muted-foreground', dot: 'bg-gray-500',   bg: 'bg-white/3',      border: 'border-border' },
  blocked:     { label: 'Blocked',     icon: XCircle,      color: 'text-red-400',          dot: 'bg-red-400',    bg: 'bg-red-500/8',    border: 'border-red-500/20' },
};

const PHASES: { key: keyof Omit<ClientPdca, 'client_id'>; label: string; color: string; desc: string }[] = [
  { key: 'plan',  label: 'Plan',  color: '#3b82f6', desc: 'ICP, strategy, sequences' },
  { key: 'do',    label: 'Do',    color: '#8b5cf6', desc: 'Execution, campaigns' },
  { key: 'check', label: 'Check', color: '#f59e0b', desc: 'KPIs, health review' },
  { key: 'act',   label: 'Act',   color: '#10b981', desc: 'Improvements, A/B tests' },
];

function PdcaPhaseCard({ phase, cell, clientName }: { phase: typeof PHASES[0]; cell: ClientPdca['plan']; clientName: string }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CFG[cell.status];
  const Icon = cfg.icon;

  return (
    <div className={`border rounded-xl ${cfg.border} ${cfg.bg} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/2 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
          <div>
            <p className="text-sm" style={{ color: phase.color }}>{phase.label}</p>
            <p className="text-xs text-muted-foreground">{phase.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
            <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
          {cell.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
              <p className="text-xs text-muted-foreground leading-relaxed">{item}</p>
            </div>
          ))}
          {cell.due && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 mt-2">
              <Calendar className="w-3 h-3" />Due: {cell.due}
            </div>
          )}
          {cell.note && (
            <div className="flex items-start gap-2 p-2.5 bg-yellow-500/5 border border-yellow-500/15 rounded-lg mt-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400">{cell.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ManagerPDCA() {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const myClients = mockClients.filter(c => c.cs_manager_id === MANAGER_ID);

  const enriched = myClients.map(c => {
    const pdca = mockPdca.find(p => p.client_id === c.id);
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest = assessments[0];
    const health = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as const;
    // Progress
    const phases = pdca ? PHASES.map(p => pdca[p.key].status) : [];
    const done = phases.filter(s => s === 'done').length;
    const blocked = phases.filter(s => s === 'blocked').length;
    return { client: c, pdca, health, done, blocked, phases };
  });

  const active = selectedClient ? enriched.find(e => e.client.id === selectedClient) : null;

  // Status counts across all my clients
  const allStatuses = enriched.flatMap(e => e.phases);
  const summary = allStatuses.reduce<Record<string, number>>((acc, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">PDCA</h1>
        <p className="text-sm text-muted-foreground">Plan → Do → Check → Act status for my clients</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(STATUS_CFG).map(([status, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={status} className={`border ${cfg.border} ${cfg.bg} rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${cfg.color}`} />
                <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className={`text-2xl ${cfg.color}`}>{summary[status] ?? 0}</p>
              <p className="text-xs text-muted-foreground">phase cells</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Client list */}
        <div className="space-y-2">
          <h3 className="text-sm text-muted-foreground px-1 mb-3">Select Client</h3>
          {enriched.map(({ client, health, done, blocked }) => (
            <button key={client.id}
              onClick={() => setSelectedClient(selectedClient === client.id ? null : client.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${selectedClient === client.id ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:border-primary/20'}`}
            >
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm">{client.name}</p>
                <HealthBadge status={health} />
              </div>
              {/* Progress bar */}
              <div className="flex gap-1 mt-2">
                {PHASES.map(p => {
                  const pdca = mockPdca.find(x => x.client_id === client.id);
                  const cellStatus = pdca ? pdca[p.key].status : 'pending';
                  const cfg = STATUS_CFG[cellStatus];
                  return (
                    <div key={p.key} className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: cellStatus === 'done' ? p.color : cellStatus === 'in_progress' ? `${p.color}60` : cellStatus === 'blocked' ? '#ef4444' : 'rgba(255,255,255,0.08)' }} />
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>{done}/4 phases done</span>
                {blocked > 0 && <span className="text-red-400">{blocked} blocked</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 space-y-4">
          {!active && (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground text-sm">
              Select a client to view PDCA details
            </div>
          )}
          {active && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base">{active.client.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">PDCA breakdown · click each phase to expand</p>
                </div>
                <HealthBadge status={active.health} />
              </div>
              {PHASES.map(p => active.pdca ? (
                <PdcaPhaseCard key={p.key} phase={p} cell={active.pdca[p.key]} clientName={active.client.name} />
              ) : (
                <div key={p.key} className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">No {p.label} data</div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
