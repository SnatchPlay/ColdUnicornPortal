import { useState } from 'react';
import { Bot, Mail, Clock, CheckCircle2, XCircle, AlertTriangle, RotateCcw, Trash2, Plus, Search, Filter, Download } from 'lucide-react';
import {
  mockLeadReplies, mockLeads, mockClients, mockCampaigns,
  mockAuditEvents, mockOooLeads, mockEmailExcludeList, mockImportJobs,
} from '../../data/mock';
import type { ReplyIntent, AuditEventType } from '../../data/schema';

type AutoTab = 'replies' | 'ooo' | 'exclude' | 'imports' | 'audit';

const INTENT_CFG: Record<ReplyIntent, { label: string; color: string; dot: string }> = {
  positive:       { label: 'Positive',        color: 'text-green-400 border-green-500/20 bg-green-500/8',   dot: 'bg-green-400' },
  negative:       { label: 'Negative',        color: 'text-red-400 border-red-500/20 bg-red-500/8',         dot: 'bg-red-400' },
  ooo:            { label: 'OOO',             color: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/8', dot: 'bg-yellow-400' },
  info_requested: { label: 'Info Requested',  color: 'text-blue-400 border-blue-500/20 bg-blue-500/8',      dot: 'bg-blue-400' },
  unclassified:   { label: 'Unclassified',    color: 'text-gray-400 border-gray-500/20 bg-gray-500/8',      dot: 'bg-gray-400' },
};

const EVENT_ICON: Record<AuditEventType, typeof Bot> = {
  classification:   Bot,
  ooo_routed:       RotateCcw,
  blacklist_added:  XCircle,
  blacklist_removed:CheckCircle2,
  lead_updated:     CheckCircle2,
  export:           Download,
  import:           Plus,
  health_assessed:  CheckCircle2,
  campaign_changed: AlertTriangle,
  invoice_updated:  CheckCircle2,
  user_invited:     Plus,
};

export function AdminAutomation() {
  const [activeTab, setActiveTab] = useState<AutoTab>('replies');
  const [search, setSearch]       = useState('');
  const [excludeList, setExcludeList] = useState(mockEmailExcludeList);
  const [newDomain, setNewDomain]     = useState('');
  const [oooLeads, setOooLeads]       = useState(mockOooLeads);
  const [replies, setReplies]         = useState(mockLeadReplies);

  const TABS: { id: AutoTab; label: string; badge?: number }[] = [
    { id: 'replies',  label: 'Reply Audit',    badge: replies.filter(r => !r.is_reviewed && r.direction === 'inbound').length },
    { id: 'ooo',      label: 'OOO Queue',      badge: oooLeads.filter(o => !o.is_processed).length },
    { id: 'exclude',  label: 'Exclude List',   badge: undefined },
    { id: 'imports',  label: 'Import Center',  badge: mockImportJobs.filter(j => j.status === 'failed').length },
    { id: 'audit',    label: 'Audit Log',      badge: undefined },
  ];

  // Filtered replies — only inbound, sorted by date desc
  const filteredReplies = replies
    .filter(r => r.direction === 'inbound')
    .filter(r => !search || mockLeads.find(l => l.id === r.lead_id)?.email.includes(search))
    .sort((a, b) => b.received_at.localeCompare(a.received_at));

  const markReviewed = (id: string) =>
    setReplies(prev => prev.map(r => r.id === id ? { ...r, is_reviewed: true } : r));

  const processOoo = (id: string) =>
    setOooLeads(prev => prev.map(o => o.id === id ? { ...o, is_processed: true, processed_at: new Date().toISOString() } : o));

  const removeExclude = (domain: string) =>
    setExcludeList(prev => prev.filter(e => e.domain !== domain));

  const addExclude = () => {
    if (!newDomain.trim()) return;
    setExcludeList(prev => [...prev, { domain: newDomain.trim(), added_by: 'user-1', created_at: new Date().toISOString() }]);
    setNewDomain('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">Automation Ops</h1>
        <p className="text-sm text-muted-foreground">Reply classification audit, OOO queue, exclude list, imports and event log.</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs whitespace-nowrap border-b-2 transition-colors ${activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Reply Audit ── */}
      {activeTab === 'replies' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email..."
                className="w-full pl-8 pr-3 py-2 bg-secondary/30 border border-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <span className="text-xs text-muted-foreground">{filteredReplies.filter(r => !r.is_reviewed).length} unreviewed</span>
          </div>
          <div className="space-y-2">
            {filteredReplies.map(reply => {
              const lead   = mockLeads.find(l => l.id === reply.lead_id);
              const client = mockClients.find(c => c.id === lead?.client_id);
              const cfg    = INTENT_CFG[reply.ai_classification];
              return (
                <div key={reply.id} className={`bg-card border rounded-xl p-4 ${!reply.is_reviewed ? 'border-primary/20' : 'border-border'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.color}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} mr-1`} />{cfg.label}
                        </span>
                        {reply.ai_confidence !== null && (
                          <span className="text-xs text-muted-foreground">
                            {(reply.ai_confidence * 100).toFixed(0)}% confidence
                          </span>
                        )}
                        {!reply.is_reviewed && (
                          <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">New</span>
                        )}
                        {reply.ai_language && <span className="text-xs text-muted-foreground uppercase">{reply.ai_language}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{lead?.full_name ?? lead?.email ?? '—'} · {client?.name ?? '—'}</p>
                      {reply.message_subject && <p className="text-xs text-muted-foreground mt-0.5 italic">"{reply.message_subject}"</p>}
                      <p className="text-xs mt-2 leading-relaxed">{reply.message_text.slice(0, 200)}{reply.message_text.length > 200 ? '…' : ''}</p>
                      {reply.ai_reasoning && (
                        <p className="text-xs text-muted-foreground/70 mt-2 italic">{reply.ai_reasoning}</p>
                      )}
                      {reply.extracted_date && (
                        <p className="text-xs text-yellow-400 mt-1">📅 Return date: {reply.extracted_date}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <p className="text-xs text-muted-foreground">{new Date(reply.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                      {!reply.is_reviewed && (
                        <button onClick={() => markReviewed(reply.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors">
                          <CheckCircle2 className="w-3 h-3" />Mark Reviewed
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── OOO Queue ── */}
      {activeTab === 'ooo' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: 'Total OOO',      value: oooLeads.length,                           color: 'text-foreground' },
              { label: 'Pending Routing',value: oooLeads.filter(o => !o.is_processed).length, color: 'text-yellow-400' },
              { label: 'Routed',         value: oooLeads.filter(o => o.is_processed).length,  color: 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                <p className={`text-lg ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>
          {oooLeads.map(ooo => {
            const lead   = mockLeads.find(l => l.id === ooo.lead_id);
            const client = mockClients.find(c => c.id === ooo.client_id);
            const camp   = mockCampaigns.find(c => c.id === ooo.campaign_id);
            const routed = mockCampaigns.find(c => c.id === ooo.routed_campaign_id);
            return (
              <div key={ooo.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{lead?.full_name ?? lead?.email ?? '—'}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${ooo.is_processed ? 'text-green-400 bg-green-500/8 border-green-500/20' : 'text-yellow-400 bg-yellow-500/8 border-yellow-500/20'}`}>
                        {ooo.is_processed ? 'Routed' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>{client?.name}</span>
                      {camp && <span>From: {camp.name}</span>}
                      {routed && <span className="text-green-400">→ {routed.name}</span>}
                    </div>
                    {ooo.expected_return_date && (
                      <p className="text-xs text-yellow-400 mt-1">📅 Returns: {ooo.expected_return_date}</p>
                    )}
                  </div>
                  {!ooo.is_processed && (
                    <button onClick={() => processOoo(ooo.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors">
                      <RotateCcw className="w-3.5 h-3.5" />Route Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Exclude List ── */}
      {activeTab === 'exclude' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input value={newDomain} onChange={e => setNewDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addExclude()}
              placeholder="competitor-domain.com"
              className="flex-1 max-w-xs px-3 py-2 bg-secondary/30 border border-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
            <button onClick={addExclude}
              className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" />Add Domain
            </button>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-white/3">
                  <th className="text-left px-4 py-3 text-muted-foreground">Domain</th>
                  <th className="text-left px-4 py-3 text-muted-foreground">Added by</th>
                  <th className="text-left px-4 py-3 text-muted-foreground">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {excludeList.map(e => (
                  <tr key={e.domain} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                    <td className="px-4 py-3 font-mono">{e.domain}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.added_by ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(e.created_at).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => removeExclude(e.domain)}
                        className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Import Center ── */}
      {activeTab === 'imports' && (
        <div className="space-y-3">
          <div className="p-4 bg-blue-500/8 border border-blue-500/15 rounded-xl text-xs text-blue-400">
            Upload CSV files to import leads, domains, campaigns, or prospects. File must include required column headers.
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-white/3">
                  {['File','Type','Client','Total','Imported','Failed','Status','Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mockImportJobs.map(job => {
                  const client = mockClients.find(c => c.id === job.client_id);
                  const statusColor = {
                    done:       'text-green-400 bg-green-500/8 border-green-500/20',
                    failed:     'text-red-400 bg-red-500/8 border-red-500/20',
                    processing: 'text-blue-400 bg-blue-500/8 border-blue-500/20',
                    pending:    'text-gray-400 bg-gray-500/8 border-gray-500/20',
                  }[job.status];
                  return (
                    <tr key={job.id} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3 font-mono max-w-[160px] truncate">{job.file_name}</td>
                      <td className="px-4 py-3 capitalize">{job.entity_type}</td>
                      <td className="px-4 py-3">{client?.name ?? 'Global'}</td>
                      <td className="px-4 py-3">{job.total_rows.toLocaleString()}</td>
                      <td className="px-4 py-3 text-green-400">{job.imported_rows.toLocaleString()}</td>
                      <td className="px-4 py-3 text-red-400">{job.failed_rows > 0 ? job.failed_rows : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${statusColor}`}>{job.status}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(job.created_at).toLocaleDateString('en-GB')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mockImportJobs.some(j => j.error_log) && (
            <div className="space-y-2">
              {mockImportJobs.filter(j => j.error_log).map(j => (
                <div key={j.id} className="flex items-start gap-3 p-3 bg-red-500/8 border border-red-500/20 rounded-xl text-xs text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="mb-0.5">{j.file_name}</p>
                    <p className="text-red-400/70">{j.error_log}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit Log ── */}
      {activeTab === 'audit' && (
        <div className="space-y-2">
          {mockAuditEvents.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(evt => {
            const Icon = EVENT_ICON[evt.event_type] ?? Bot;
            const client = mockClients.find(c => c.id === evt.client_id);
            const isAuto = evt.triggered_by === 'automation';
            return (
              <div key={evt.id} className="flex items-start gap-3 p-3 bg-card border border-border rounded-xl">
                <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${isAuto ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs">{evt.description}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    {client && <span>{client.name}</span>}
                    <span className={`px-1.5 py-0.5 rounded text-xs ${isAuto ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {isAuto ? '🤖 Auto' : '👤 Manual'}
                    </span>
                    <span className="text-xs capitalize">{evt.event_type.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground shrink-0">
                  {new Date(evt.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
