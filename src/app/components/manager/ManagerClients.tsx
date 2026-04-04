import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Client } from '../../data/schema';
import { mockClients, mockHealthAssessments } from '../../data/mock';
import { HealthBadge, getOverallHealth } from '../shared/HealthBadge';
import { Client360Panel } from '../shared/Client360Panel';

const MANAGER_ID = 'user-2';

const STATUS_COLOR: Record<string, string> = {
  active:     'bg-green-500/10 text-green-400 border-green-500/20',
  onboarding: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  paused:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  churned:    'bg-red-500/10 text-red-400 border-red-500/20',
};

export function ManagerClients() {
  const [selected, setSelected] = useState<Client | null>(null);

  const myClients = mockClients.filter(c => c.cs_manager_id === MANAGER_ID).map(c => {
    const assessments = mockHealthAssessments.filter(h => h.client_id === c.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const latest = assessments[0];
    const health = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown' as const;
    return { ...c, health, latestAssessment: latest };
  });

  return (
    <>
      <div className="space-y-5">
        <div>
          <h1 className="mb-1">Client 360°</h1>
          <p className="text-sm text-muted-foreground">Select a client to view full details — campaigns, domains, leads, invoices and PDCA status.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {myClients.map(c => (
            <div key={c.id}
              onClick={() => setSelected(selected?.id === c.id ? null : c)}
              className={`bg-card border rounded-xl p-5 cursor-pointer transition-all hover:border-primary/30 group ${selected?.id === c.id ? 'border-primary/40 bg-primary/3' : 'border-border'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base">{c.name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${STATUS_COLOR[c.status] ?? ''}`}>{c.status}</span>
                    <HealthBadge status={c.health} />
                  </div>
                </div>
                <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform ${selected?.id === c.id ? 'rotate-90 text-primary' : 'group-hover:translate-x-0.5'}`} />
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-white/3 rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">MQL target</p>
                  <p className="text-sm mt-0.5 text-blue-400">{c.kpi_leads ?? '—'}/mo</p>
                </div>
                <div className="bg-white/3 rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Meetings</p>
                  <p className="text-sm mt-0.5 text-purple-400">{c.kpi_meetings ?? '—'}/mo</p>
                </div>
                <div className="bg-white/3 rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Contract</p>
                  <p className="text-sm mt-0.5 text-green-400">€{c.contracted_amount?.toLocaleString() ?? '—'}</p>
                </div>
              </div>

              {c.latestAssessment?.insights && (
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed line-clamp-2 border-t border-border/50 pt-3">
                  {c.latestAssessment.insights}
                </p>
              )}

              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>Due: {c.contract_due_date ?? '—'}</span>
                <span>Click to open 360° →</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && <Client360Panel client={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
