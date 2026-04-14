import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import {
  mockClients, mockClientIssues, mockHealthAssessments, mockUsers,
} from '../../data/mock';
import type { ClientIssue, IssueSeverity, IssueStatus, HealthStatus } from '../../data/schema';
import { HealthBadge, HealthDot, getOverallHealth } from '../shared/HealthBadge';

const MANAGER_ID = 'user-2';

const SEV_CFG: Record<IssueSeverity, { label: string; color: string; bg: string }> = {
  low:      { label: 'Low',      color: 'text-gray-400',   bg: 'bg-gray-500/10 border-gray-500/20' },
  medium:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  high:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  critical: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
};
const STATUS_CFG: Record<IssueStatus, { label: string; color: string }> = {
  open:        { label: 'Open',        color: 'text-red-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-400' },
  resolved:    { label: 'Resolved',    color: 'text-green-400' },
  closed:      { label: 'Closed',      color: 'text-muted-foreground' },
};
const HEALTH_LABELS: Record<string, string> = {
  ip_health: 'IP', domains_health: 'Domains', warmup_health: 'Warmup', copy_health: 'Copy', funnel_health: 'Funnel',
};

type NewIssueForm = { client_id: string; title: string; description: string; severity: IssueSeverity };

export function ManagerHealth() {
  const myClients   = mockClients.filter(c => c.cs_manager_id === MANAGER_ID);
  const myClientIds = myClients.map(c => c.id);

  const [issues, setIssues]       = useState<ClientIssue[]>(mockClientIssues.filter(i => myClientIds.includes(i.client_id)));
  const [clientFilter, setClient] = useState('all');
  const [statusFilter, setStatus] = useState<IssueStatus | 'all'>('all');
  const [showNew, setShowNew]     = useState(false);
  const [form, setForm]           = useState<NewIssueForm>({ client_id: myClients[0]?.id ?? '', title: '', description: '', severity: 'medium' });

  const assessments = mockHealthAssessments.filter(h => myClientIds.includes(h.client_id)).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));

  const filteredIssues = issues
    .filter(i => clientFilter === 'all' || i.client_id === clientFilter)
    .filter(i => statusFilter === 'all' || i.status === statusFilter)
    .sort((a, b) => {
      const o: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return o[a.severity] - o[b.severity];
    });

  const submitIssue = () => {
    if (!form.title.trim()) return;
    const now = new Date().toISOString();
    setIssues(prev => [...prev, {
      id: `issue-${Date.now()}`,
      client_id: form.client_id,
      created_by: MANAGER_ID,
      title: form.title.trim(),
      description: form.description.trim() || null,
      severity: form.severity,
      status: 'open',
      resolved_at: null,
      created_at: now,
      updated_at: now,
    }]);
    setForm({ client_id: myClients[0]?.id ?? '', title: '', description: '', severity: 'medium' });
    setShowNew(false);
  };

  const updateStatus = (id: string, status: IssueStatus) =>
    setIssues(prev => prev.map(i => i.id === id ? {
      ...i, status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } : i));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1">Health &amp; Issues</h1>
        <p className="text-sm text-muted-foreground">Client health assessments and structured issue tracker for assigned clients.</p>
      </div>

      {/* Health snapshot */}
      <div>
        <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Latest Health — My Clients</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {myClients.map(c => {
            const latest = assessments.find(a => a.client_id === c.id);
            const overall = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown';
            const openCount = issues.filter(i => i.client_id === c.id && ['open','in_progress'].includes(i.status)).length;
            return (
              <div key={c.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm">{c.name}</p>
                    {openCount > 0 && <p className="text-xs text-orange-400 mt-0.5">{openCount} open issue{openCount > 1 ? 's' : ''}</p>}
                  </div>
                  <HealthBadge status={overall} />
                </div>
                {latest ? (
                  <>
                    <div className="flex items-center gap-4 mb-3">
                      {(['ip_health','domains_health','warmup_health','copy_health','funnel_health'] as const).map(k => (
                        <div key={k} className="text-center">
                          <HealthDot status={latest[k] as HealthStatus} />
                          <p className="text-xs text-muted-foreground mt-1">{HEALTH_LABELS[k]}</p>
                        </div>
                      ))}
                    </div>
                    {latest.insights && <p className="text-xs text-muted-foreground leading-relaxed">{latest.insights}</p>}
                    <p className="text-xs text-muted-foreground/50 mt-2">
                      {new Date(latest.assessed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })} ·
                      by {mockUsers.find(u => u.id === latest.assessed_by)?.full_name ?? '—'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No assessment yet</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Issues Tracker</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={clientFilter} onChange={e => setClient(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer">
              <option value="all">All clients</option>
              {myClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatus(e.target.value as IssueStatus | 'all')}
              className="text-xs px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer">
              <option value="all">All statuses</option>
              {(['open','in_progress','resolved','closed'] as IssueStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_CFG[s].label}</option>
              ))}
            </select>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" />New Issue
            </button>
          </div>
        </div>

        {showNew && (
          <div className="bg-card border border-primary/20 rounded-xl p-4 space-y-3">
            <p className="text-xs text-primary mb-1">New Issue</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Client</label>
                <select value={form.client_id} onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-xs focus:outline-none cursor-pointer">
                  {myClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Severity</label>
                <select value={form.severity} onChange={e => setForm(p => ({ ...p, severity: e.target.value as IssueSeverity }))}
                  className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-xs focus:outline-none cursor-pointer">
                  {(['low','medium','high','critical'] as IssueSeverity[]).map(s => (
                    <option key={s} value={s}>{SEV_CFG[s].label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Title *</label>
              <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Issue title..."
                className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3}
                placeholder="Describe the issue..."
                className="w-full px-2.5 py-2 bg-secondary/30 border border-border rounded-lg text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <div className="flex gap-2">
              <button onClick={submitIssue}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 transition-colors flex items-center gap-1">
                <Save className="w-3 h-3" />Submit
              </button>
              <button onClick={() => setShowNew(false)} className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {filteredIssues.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">No issues found</div>
          )}
          {filteredIssues.map(issue => {
            const client   = myClients.find(c => c.id === issue.client_id);
            const sevCfg   = SEV_CFG[issue.severity];
            const statCfg  = STATUS_CFG[issue.status];
            const creator  = mockUsers.find(u => u.id === issue.created_by);
            return (
              <div key={issue.id} className={`bg-card border rounded-xl p-4 ${issue.severity === 'critical' ? 'border-red-500/30' : issue.severity === 'high' ? 'border-orange-500/20' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${sevCfg.bg} ${sevCfg.color}`}>{sevCfg.label}</span>
                      <span className={`text-xs ${statCfg.color}`}>{statCfg.label}</span>
                      {client && <span className="text-xs text-muted-foreground">{client.name}</span>}
                    </div>
                    <p className="text-sm">{issue.title}</p>
                    {issue.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{issue.description}</p>}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                      <span>{new Date(issue.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      {creator && <span>by {creator.full_name}</span>}
                      {issue.resolved_at && (
                        <span className="text-green-400">
                          Resolved {new Date(issue.resolved_at).toLocaleDateString('en-GB')}
                        </span>
                      )}
                    </div>
                  </div>
                  <select value={issue.status} onChange={e => updateStatus(issue.id, e.target.value as IssueStatus)}
                    className={`text-xs px-2 py-1.5 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer shrink-0 ${statCfg.color}`}>
                    {(['open','in_progress','resolved','closed'] as IssueStatus[]).map(s => (
                      <option key={s} value={s}>{STATUS_CFG[s].label}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
