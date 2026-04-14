import { useState } from 'react';
import { CheckCircle2, RotateCcw, Clock, Bot, AlertTriangle } from 'lucide-react';
import { mockLeadReplies, mockLeads, mockClients, mockCampaigns, mockOooLeads } from '../../data/mock';
import type { ReplyIntent, OooLead } from '../../data/schema';

const MANAGER_ID = 'user-2';

const INTENT_CFG: Record<ReplyIntent, { label: string; color: string; dot: string }> = {
  positive:       { label: 'Positive',       color: 'text-green-400 border-green-500/20 bg-green-500/8',   dot: 'bg-green-400' },
  negative:       { label: 'Negative',       color: 'text-red-400 border-red-500/20 bg-red-500/8',         dot: 'bg-red-400' },
  ooo:            { label: 'OOO',            color: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/8', dot: 'bg-yellow-400' },
  info_requested: { label: 'Info Request',   color: 'text-blue-400 border-blue-500/20 bg-blue-500/8',      dot: 'bg-blue-400' },
  unclassified:   { label: 'Unclassified',   color: 'text-gray-400 border-gray-500/20 bg-gray-500/8',      dot: 'bg-gray-400' },
};

type InboxTab = 'replies' | 'ooo';

export function ManagerAutomation() {
  const [tab, setTab] = useState<InboxTab>('replies');

  // Scope to manager's clients
  const myClients   = mockClients.filter(c => c.cs_manager_id === MANAGER_ID);
  const myClientIds = myClients.map(c => c.id);
  const myLeadIds   = mockLeads.filter(l => myClientIds.includes(l.client_id)).map(l => l.id);

  const [replies, setReplies] = useState(() =>
    mockLeadReplies
      .filter(r => r.direction === 'inbound' && myLeadIds.includes(r.lead_id))
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
  );
  const [oooLeads, setOooLeads] = useState<OooLead[]>(() =>
    mockOooLeads.filter(o => myClientIds.includes(o.client_id))
  );

  const unreviewed = replies.filter(r => !r.is_reviewed);
  const pendingOoo = oooLeads.filter(o => !o.is_processed);

  const markReviewed = (id: string) =>
    setReplies(prev => prev.map(r => r.id === id ? { ...r, is_reviewed: true } : r));

  const processOoo = (id: string) =>
    setOooLeads(prev => prev.map(o => o.id === id ? { ...o, is_processed: true, processed_at: new Date().toISOString() } : o));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">Automation Inbox</h1>
        <p className="text-sm text-muted-foreground">AI reply classification audit and OOO routing queue for your clients.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { id: 'replies' as InboxTab, label: 'Reply Classification', badge: unreviewed.length },
          { id: 'ooo'     as InboxTab, label: 'OOO Queue',            badge: pendingOoo.length },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs border-b-2 transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
            {t.badge > 0 && <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Reply Classification ── */}
      {tab === 'replies' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: 'Unreviewed',  value: unreviewed.length,                                    color: 'text-red-400' },
              { label: 'Positive',    value: replies.filter(r => r.ai_classification === 'positive').length, color: 'text-green-400' },
              { label: 'OOO',         value: replies.filter(r => r.ai_classification === 'ooo').length,      color: 'text-yellow-400' },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                <p className={`text-lg ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {replies.map(reply => {
              const lead   = mockLeads.find(l => l.id === reply.lead_id);
              const client = myClients.find(c => c.id === lead?.client_id);
              const cfg    = INTENT_CFG[reply.ai_classification];
              return (
                <div key={reply.id} className={`bg-card border rounded-xl p-4 ${!reply.is_reviewed ? 'border-primary/20' : 'border-border'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.color}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} mr-1`} />{cfg.label}
                        </span>
                        {reply.ai_confidence !== null && (
                          <span className="text-xs text-muted-foreground">{(reply.ai_confidence * 100).toFixed(0)}% conf.</span>
                        )}
                        {!reply.is_reviewed && (
                          <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">Needs review</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mb-1.5">
                        {lead?.full_name ?? lead?.email} · {client?.name}
                      </div>
                      {reply.message_subject && (
                        <p className="text-xs italic text-muted-foreground mb-2">"{reply.message_subject}"</p>
                      )}
                      <p className="text-xs leading-relaxed">
                        {reply.message_text.slice(0, 240)}{reply.message_text.length > 240 ? '…' : ''}
                      </p>
                      {reply.ai_reasoning && (
                        <div className="mt-2 flex items-start gap-2 p-2 bg-white/3 rounded-lg">
                          <Bot className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground">{reply.ai_reasoning}</p>
                        </div>
                      )}
                      {reply.extracted_date && (
                        <p className="text-xs text-yellow-400 mt-1.5">📅 OOO return: {reply.extracted_date}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <p className="text-xs text-muted-foreground">
                        {new Date(reply.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                      {!reply.is_reviewed ? (
                        <button onClick={() => markReviewed(reply.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-colors">
                          <CheckCircle2 className="w-3 h-3" />Review
                        </button>
                      ) : (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />Reviewed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {replies.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-10">No replies to review</div>
            )}
          </div>
        </div>
      )}

      {/* ── OOO Queue ── */}
      {tab === 'ooo' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: 'Total OOO',      value: oooLeads.length,             color: 'text-foreground' },
              { label: 'Pending Routing',value: pendingOoo.length,            color: 'text-yellow-400' },
              { label: 'Routed',         value: oooLeads.filter(o => o.is_processed).length, color: 'text-green-400' },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                <p className={`text-lg ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {oooLeads.map(ooo => {
            const lead   = mockLeads.find(l => l.id === ooo.lead_id);
            const client = myClients.find(c => c.id === ooo.client_id);
            const camp   = mockCampaigns.find(c => c.id === ooo.campaign_id);
            const routed = mockCampaigns.find(c => c.id === ooo.routed_campaign_id);
            return (
              <div key={ooo.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm">{lead?.full_name ?? lead?.email ?? '—'}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${ooo.is_processed ? 'text-green-400 bg-green-500/8 border-green-500/20' : 'text-yellow-400 bg-yellow-500/8 border-yellow-500/20'}`}>
                        {ooo.is_processed ? 'Routed' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      {client && <span>{client.name}</span>}
                      {lead?.gender && <span className="capitalize">{lead.gender}</span>}
                      {camp && <span>Source: {camp.name}</span>}
                      {routed && <span className="text-green-400">→ {routed.name}</span>}
                    </div>
                    {ooo.expected_return_date && (
                      <p className="text-xs text-yellow-400 mt-1.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />Returns: {ooo.expected_return_date}
                      </p>
                    )}
                  </div>
                  {!ooo.is_processed && (
                    <button onClick={() => processOoo(ooo.id)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors shrink-0">
                      <RotateCcw className="w-3.5 h-3.5" />Route Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {oooLeads.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-10">No OOO leads</div>
          )}
        </div>
      )}
    </div>
  );
}
