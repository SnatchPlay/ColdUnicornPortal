import { useState, useRef, useEffect } from 'react';
import {
  Search, Filter, Mail, Building2, ChevronDown, X, ExternalLink,
  Clock, Calendar, MessageSquare, CheckCircle2, Send,
  Linkedin, StickyNote, ChevronRight, Info, ArrowRight, Users
} from 'lucide-react';
import type { Lead, LeadQualification, LeadReply, ReplyIntent, Campaign } from '../data/schema';
import { mockLeads, mockLeadReplies, mockCampaigns } from '../data/mock';

// ── Config ───────────────────────────────────────────────────

const ALL_QUALIFICATIONS: LeadQualification[] = [
  'preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'
];

const qualificationConfig: Record<LeadQualification, { label: string; color: string; dot: string }> = {
  unprocessed:       { label: 'Unprocessed',       color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',       dot: 'bg-gray-400'    },
  unqualified:       { label: 'Unqualified',        color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',       dot: 'bg-zinc-400'    },
  preMQL:            { label: 'Pre-MQL',            color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', dot: 'bg-yellow-400'  },
  MQL:               { label: 'MQL',                color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',       dot: 'bg-blue-400'    },
  meeting_scheduled: { label: 'Meeting Scheduled',  color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', dot: 'bg-purple-400'  },
  meeting_held:      { label: 'Meeting Held',       color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', dot: 'bg-indigo-400'  },
  offer_sent:        { label: 'Offer Sent',         color: 'bg-orange-500/10 text-orange-400 border-orange-500/20', dot: 'bg-orange-400'  },
  won:               { label: 'Won',                color: 'bg-green-500/10 text-green-400 border-green-500/20',    dot: 'bg-green-400'   },
  rejected:          { label: 'Rejected',           color: 'bg-red-500/10 text-red-400 border-red-500/20',          dot: 'bg-red-400'     },
};

const intentConfig: Record<ReplyIntent, { label: string; color: string }> = {
  positive:       { label: 'Positive',       color: 'bg-green-500/10 text-green-400 border border-green-500/20' },
  negative:       { label: 'Negative',       color: 'bg-red-500/10 text-red-400 border border-red-500/20' },
  ooo:            { label: 'OOO',            color: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' },
  info_requested: { label: 'Info Requested', color: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' },
  unclassified:   { label: 'Unclassified',   color: 'bg-gray-500/10 text-gray-400 border border-gray-500/20' },
};

const replyDirectionIcon = {
  inbound:  <MessageSquare className="w-3 h-3 text-green-400" />,
  outbound: <Send className="w-3 h-3 text-blue-400" />,
};

function getInitials(fullName: string | null) {
  if (!fullName) return '?';
  return fullName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'from-purple-500 to-pink-500', 'from-blue-500 to-cyan-500',
  'from-green-500 to-emerald-500', 'from-orange-500 to-red-500',
  'from-indigo-500 to-purple-500', 'from-pink-500 to-rose-500',
];
function getAvatarGradient(id: string) {
  return AVATAR_GRADIENTS[id.charCodeAt(id.length - 1) % AVATAR_GRADIENTS.length];
}

// ── Inline Status Dropdown ────────────────────────────────────

function QualificationDropdown({
  lead,
  onUpdate,
}: {
  lead: Lead;
  onUpdate: (id: string, q: LeadQualification) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const cfg = qualificationConfig[lead.qualification];

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border cursor-pointer hover:opacity-80 transition-opacity ${cfg.color}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-[#1a1a1a] border border-border rounded-lg shadow-2xl z-50 py-1">
          {ALL_QUALIFICATIONS.map(q => {
            const c = qualificationConfig[q];
            return (
              <button
                key={q}
                onClick={() => { onUpdate(lead.id, q); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left ${lead.qualification === q ? 'bg-white/5' : ''}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                <span className="text-foreground">{c.label}</span>
                {lead.qualification === q && <CheckCircle2 className="w-3 h-3 ml-auto text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Lead Drawer ───────────────────────────────────────────────

function LeadDrawer({
  lead,
  replies,
  campaign,
  onClose,
  onUpdate,
}: {
  lead: Lead;
  replies: LeadReply[];
  campaign: Campaign | undefined;
  onClose: () => void;
  onUpdate: (id: string, q: LeadQualification) => void;
}) {
  const cfg = qualificationConfig[lead.qualification];
  const sortedReplies = [...replies].sort(
    (a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()
  );
  const latestAiReply = sortedReplies.find(r => r.ai_confidence !== null);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[520px] max-w-full h-full bg-[#111111] border-l border-border flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-5 border-b border-border bg-[#0d0d0d]">
          <div className="flex items-start justify-between mb-1">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 bg-gradient-to-br ${getAvatarGradient(lead.id)} rounded-xl flex items-center justify-center text-white shrink-0`}>
                <span className="text-sm">{getInitials(lead.full_name)}</span>
              </div>
              <div>
                <h2 className="text-base">{lead.full_name ?? lead.email}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{lead.job_title ?? '—'}</p>
                {lead.company_name && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Building2 className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{lead.company_name}</span>
                  </div>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 hover:bg-white/5 rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* OOO badge */}
          {lead.is_ooo && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-md text-xs">
              <Clock className="w-3 h-3" />
              OOO — returns {lead.expected_return_date ?? 'unknown date'}
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Pipeline */}
          <div className="p-5 border-b border-border">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Pipeline</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Qualification</p>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${cfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </div>
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Campaign</p>
                <p className="text-sm">{campaign?.name ?? '—'}</p>
                {campaign && (
                  <p className="text-xs text-muted-foreground capitalize">{campaign.type}</p>
                )}
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Replied at Step</p>
                <p className="text-sm">
                  {lead.replied_at_step !== null ? `Step ${lead.replied_at_step}` : '—'}
                </p>
              </div>
              <div className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1.5">Total Replies</p>
                <p className="text-sm">{lead.total_replies_count}</p>
              </div>
            </div>

            {/* Change Qualification */}
            <p className="text-xs text-muted-foreground mb-2">Change Qualification</p>
            <div className="grid grid-cols-3 gap-1.5">
              {ALL_QUALIFICATIONS.map(q => {
                const c = qualificationConfig[q];
                const isActive = lead.qualification === q;
                return (
                  <button
                    key={q}
                    onClick={() => onUpdate(lead.id, q)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs border transition-all ${isActive ? c.color : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                    <span className="truncate">{c.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contact Info — from leads table */}
          <div className="p-5 border-b border-border">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Contact</h3>
            <div className="space-y-2">
              <a href={`mailto:${lead.email}`}
                className="flex items-center gap-3 p-2.5 bg-secondary/20 rounded-lg hover:bg-secondary/30 transition-colors group">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm group-hover:text-primary transition-colors">{lead.email}</span>
              </a>
              {lead.linkedin_url && (
                <a href={`https://${lead.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2.5 bg-secondary/20 rounded-lg hover:bg-secondary/30 transition-colors group">
                  <Linkedin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-blue-400 truncate">{lead.linkedin_url}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              )}
            </div>
          </div>

          {/* Lead metadata — from leads table */}
          <div className="p-5 border-b border-border">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Record Details</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Gender',         value: lead.gender },
                { label: 'Is OOO',         value: lead.is_ooo ? 'Yes' : 'No' },
                { label: 'Expected Return',value: lead.expected_return_date ?? '—' },
                { label: 'Latest Reply',   value: lead.latest_reply_at ? new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                { label: 'Created',        value: new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
                { label: 'Updated',        value: new Date(lead.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-secondary/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                  <p className="text-xs capitalize">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Analysis — from lead_replies (latest classified reply) */}
          {latestAiReply && (
            <div className="p-5 border-b border-border">
              <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">AI Analysis (ARM)</h3>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm">Latest Classification</span>
                <span className={`text-xs px-2.5 py-1 rounded ${intentConfig[latestAiReply.ai_classification].color}`}>
                  {intentConfig[latestAiReply.ai_classification].label}
                </span>
              </div>
              {latestAiReply.ai_confidence !== null && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-muted-foreground">Confidence</span>
                  <div className="flex-1 bg-secondary/60 rounded-full h-1.5">
                    <div
                      className="bg-gradient-to-r from-green-500 to-emerald-400 h-1.5 rounded-full"
                      style={{ width: `${latestAiReply.ai_confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-green-400">{Math.round(latestAiReply.ai_confidence * 100)}%</span>
                </div>
              )}
              {latestAiReply.ai_reasoning && (
                <div className="bg-secondary/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{latestAiReply.ai_reasoning}</p>
                  </div>
                </div>
              )}
              {latestAiReply.extracted_date && (
                <div className="mt-2 flex items-center gap-2 text-xs text-yellow-400">
                  <Calendar className="w-3 h-3" />
                  Extracted return date: {latestAiReply.extracted_date}
                </div>
              )}
            </div>
          )}

          {/* Reply Timeline — from lead_replies */}
          {sortedReplies.length > 0 && (
            <div className="p-5">
              <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Reply History ({sortedReplies.length})
              </h3>
              <div className="space-y-3">
                {sortedReplies.map((reply, i) => (
                  <div key={reply.id}>
                    <div className="bg-secondary/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {replyDirectionIcon[reply.direction as 'inbound' | 'outbound'] ?? replyDirectionIcon.inbound}
                          <span className="text-xs capitalize text-muted-foreground">{reply.direction}</span>
                          {reply.sequence_step !== null && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                              Step {reply.sequence_step}
                            </span>
                          )}
                          {reply.ai_classification !== 'unclassified' && reply.direction === 'inbound' && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${intentConfig[reply.ai_classification].color}`}>
                              {intentConfig[reply.ai_classification].label}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(reply.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      {reply.message_subject && (
                        <p className="text-xs text-muted-foreground mb-1">{reply.message_subject}</p>
                      )}
                      <p className="text-xs leading-relaxed">{reply.message_text}</p>
                      {reply.ai_confidence !== null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          AI: {Math.round(reply.ai_confidence * 100)}% confidence
                        </p>
                      )}
                    </div>
                    {i < sortedReplies.length - 1 && (
                      <div className="flex justify-center my-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground rotate-90" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-[#0d0d0d]">
          <div className="flex gap-2">
            <a href={`mailto:${lead.email}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
              <Mail className="w-4 h-4" />Send Email
            </a>
            {lead.linkedin_url && (
              <a href={`https://${lead.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 border border-border rounded-lg hover:bg-secondary/50 transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export function LeadsTable() {
  const [leads, setLeads] = useState<Lead[]>(mockLeads);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQualification, setFilterQualification] = useState<LeadQualification | 'all'>('all');

  const handleQualificationUpdate = (id: string, q: LeadQualification) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, qualification: q, updated_at: new Date().toISOString() } : l));
    setSelectedLead(prev => prev?.id === id ? { ...prev, qualification: q } : prev);
  };

  const filtered = leads.filter(l => {
    const searchable = [l.full_name, l.email, l.company_name, l.job_title].join(' ').toLowerCase();
    const matchSearch = searchable.includes(searchQuery.toLowerCase());
    const matchQ = filterQualification === 'all' || l.qualification === filterQualification;
    return matchSearch && matchQ;
  });

  const getCampaign = (id: string | null) => mockCampaigns.find(c => c.id === id);
  const getReplies = (leadId: string) => mockLeadReplies.filter(r => r.lead_id === leadId);

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg">Leads Workspace</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {filtered.length} leads · only preMQL and above (RLS policy)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={filterQualification}
                onChange={e => setFilterQualification(e.target.value as LeadQualification | 'all')}
                className="px-3 py-1.5 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All Qualifications</option>
                {ALL_QUALIFICATIONS.map(q => (
                  <option key={q} value={q}>{qualificationConfig[q].label}</option>
                ))}
              </select>
              <button className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors text-sm">
                <Filter className="w-4 h-4" />Filters
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, email or company..."
              className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary/30">
              <tr>
                {['Lead', 'Company', 'Qualification', 'Campaign', 'Replied at Step', 'Replies', 'Latest Reply At'].map(h => (
                  <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(lead => {
                const cfg = qualificationConfig[lead.qualification];
                const campaign = getCampaign(lead.campaign_id);
                return (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`hover:bg-secondary/20 cursor-pointer transition-colors ${selectedLead?.id === lead.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                  >
                    {/* Lead */}
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 bg-gradient-to-br ${getAvatarGradient(lead.id)} rounded-lg flex items-center justify-center text-white text-xs shrink-0`}>
                          {getInitials(lead.full_name)}
                        </div>
                        <div>
                          <div className="text-sm">{lead.full_name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="w-2.5 h-2.5" />{lead.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Company */}
                    <td className="p-3">
                      <div className="flex items-start gap-2">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <div className="text-sm">{lead.company_name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">{lead.job_title ?? '—'}</div>
                        </div>
                      </div>
                    </td>

                    {/* Qualification inline */}
                    <td className="p-3">
                      <QualificationDropdown lead={lead} onUpdate={handleQualificationUpdate} />
                    </td>

                    {/* Campaign */}
                    <td className="p-3">
                      {campaign ? (
                        <div>
                          <div className="text-sm">{campaign.name}</div>
                          <div className="text-xs text-muted-foreground capitalize">{campaign.type}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* replied_at_step */}
                    <td className="p-3">
                      {lead.replied_at_step !== null ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 bg-primary/10 text-primary rounded text-xs">
                          {lead.replied_at_step}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* total_replies_count */}
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm">{lead.total_replies_count}</span>
                        {lead.is_ooo && (
                          <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">OOO</span>
                        )}
                      </div>
                    </td>

                    {/* latest_reply_at */}
                    <td className="p-3 text-xs text-muted-foreground">
                      {lead.latest_reply_at
                        ? new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground text-sm">
                    No leads found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          replies={getReplies(selectedLead.id)}
          campaign={getCampaign(selectedLead.campaign_id)}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleQualificationUpdate}
        />
      )}
    </>
  );
}
