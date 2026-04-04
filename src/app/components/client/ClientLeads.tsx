import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search, X, Mail, Building2, ChevronDown, CheckCircle2,
  Send, Linkedin, MessageSquare, ExternalLink, Clock, Info,
  Download, ArrowUp, ArrowDown, ChevronsUpDown, SlidersHorizontal,
  ArrowRight
} from 'lucide-react';
import type { Lead, LeadQualification, LeadReply, Campaign } from '../../data/schema';
import { mockLeads, mockLeadReplies, mockCampaigns } from '../../data/mock';

// ── Config ───────────────────────────────────────────────────

const CLIENT_QUALIFICATIONS: LeadQualification[] = [
  'preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'
];

const Q_CONFIG: Record<LeadQualification, { label: string; color: string; dot: string; description: string }> = {
  unprocessed:       { label: 'Unprocessed',      color: '', dot: '', description: '' },
  unqualified:       { label: 'Unqualified',       color: '', dot: '', description: '' },
  preMQL:            { label: 'Pre-MQL',           color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25', dot: 'bg-yellow-400', description: 'Being reviewed by your account manager' },
  MQL:               { label: 'MQL',               color: 'bg-blue-500/10 text-blue-400 border-blue-500/25',      dot: 'bg-blue-400',   description: 'Qualified — ready for your action' },
  meeting_scheduled: { label: 'Meeting Scheduled', color: 'bg-purple-500/10 text-purple-400 border-purple-500/25', dot: 'bg-purple-400', description: 'Meeting booked' },
  meeting_held:      { label: 'Meeting Held',      color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25', dot: 'bg-indigo-400', description: 'Meeting completed' },
  offer_sent:        { label: 'Offer Sent',        color: 'bg-orange-500/10 text-orange-400 border-orange-500/25', dot: 'bg-orange-400', description: 'Proposal sent' },
  won:               { label: 'Won',               color: 'bg-green-500/10 text-green-400 border-green-500/25',   dot: 'bg-green-400',  description: 'Deal closed' },
  rejected:          { label: 'Rejected',          color: 'bg-red-500/10 text-red-400 border-red-500/25',         dot: 'bg-red-400',    description: 'Lead rejected' },
};

const CLIENT_ACTIONABLE: LeadQualification[] = [
  'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'
];

const INTENT_COLOR: Record<string, string> = {
  positive:       'text-green-400 bg-green-500/10',
  negative:       'text-red-400 bg-red-500/10',
  ooo:            'text-yellow-400 bg-yellow-500/10',
  info_requested: 'text-blue-400 bg-blue-500/10',
  unclassified:   'text-muted-foreground bg-secondary/50',
};

type SortKey = 'full_name' | 'company_name' | 'qualification' | 'latest_reply_at' | 'replied_at_step' | 'total_replies_count' | 'created_at';
type SortDir = 'asc' | 'desc';

const VISIBLE_LEADS = mockLeads.filter(l =>
  ['preMQL','MQL','meeting_scheduled','meeting_held','offer_sent','won','rejected'].includes(l.qualification)
);

function getInitials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}
const GRADS = ['from-purple-500 to-pink-500','from-blue-500 to-cyan-500','from-green-500 to-emerald-500','from-orange-500 to-red-500','from-indigo-500 to-purple-500'];
const grad = (id: string) => GRADS[id.charCodeAt(id.length-1) % GRADS.length];

// ── Sub-components ────────────────────────────────────────────

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40 ml-1" />;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-primary ml-1" />
    : <ArrowDown className="w-3 h-3 text-primary ml-1" />;
}

function StatusDropdown({ lead, onUpdate }: { lead: Lead; onUpdate: (id: string, q: LeadQualification) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const cfg = Q_CONFIG[lead.qualification];
  if (!cfg.label) return null;
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap ${cfg.color}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
        <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-[#181818] border border-border rounded-xl shadow-2xl z-50 py-1.5">
          <p className="text-xs text-muted-foreground px-3 py-1.5 border-b border-border mb-1">Update status</p>
          {CLIENT_ACTIONABLE.map(q => {
            const c = Q_CONFIG[q];
            return (
              <button key={q} onClick={() => { onUpdate(lead.id, q); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left ${lead.qualification === q ? 'bg-white/5' : ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                <span className="text-foreground flex-1">{c.label}</span>
                {lead.qualification === q && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Lead Drawer ───────────────────────────────────────────────
function LeadDrawer({ lead, replies, campaign, onClose, onUpdate }: {
  lead: Lead; replies: LeadReply[]; campaign: Campaign | undefined;
  onClose: () => void; onUpdate: (id: string, q: LeadQualification) => void;
}) {
  const cfg = Q_CONFIG[lead.qualification];
  const sorted = [...replies].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  const latestAI = sorted.find(r => r.ai_confidence !== null && r.direction === 'inbound');

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[500px] max-w-full h-full bg-[#0f0f0f] border-l border-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-border bg-[#0a0a0a]">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 bg-gradient-to-br ${grad(lead.id)} rounded-xl flex items-center justify-center text-white shrink-0`}>
                <span className="text-sm">{getInitials(lead.full_name)}</span>
              </div>
              <div>
                <p className="text-base">{lead.full_name ?? lead.email}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{lead.job_title ?? '—'}{lead.company_name ? ` · ${lead.company_name}` : ''}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border ${cfg.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />{cfg.label}
            </span>
            {lead.is_ooo && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-lg text-xs">
                <Clock className="w-3 h-3" />OOO · returns {lead.expected_return_date}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {/* AI Analysis */}
          {latestAI && (
            <div className="p-5">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">AI Analysis</h4>
              <div className="bg-white/3 border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded capitalize ${INTENT_COLOR[latestAI.ai_classification]}`}>
                    {latestAI.ai_classification.replace('_', ' ')}
                  </span>
                  {latestAI.ai_confidence !== null && (
                    <div className="flex items-center gap-2">
                      <div className="w-20 bg-white/10 rounded-full h-1">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${latestAI.ai_confidence * 100}%` }} />
                      </div>
                      <span className="text-xs text-green-400">{Math.round(latestAI.ai_confidence * 100)}%</span>
                    </div>
                  )}
                </div>
                {latestAI.ai_reasoning && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{latestAI.ai_reasoning}</p>
                )}
              </div>
            </div>
          )}

          {/* Update Pipeline */}
          <div className="p-5">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Update Pipeline</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {CLIENT_ACTIONABLE.map(q => {
                const c = Q_CONFIG[q];
                const isActive = lead.qualification === q;
                return (
                  <button key={q} onClick={() => onUpdate(lead.id, q)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs border transition-all text-left ${isActive ? c.color : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                    <span className="truncate">{c.label}</span>
                    {isActive && <CheckCircle2 className="w-3 h-3 ml-auto shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contact */}
          <div className="p-5">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Contact</h4>
            <div className="space-y-2">
              <a href={`mailto:${lead.email}`}
                className="flex items-center gap-3 p-3 bg-white/3 rounded-xl hover:bg-white/6 transition-colors group">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm group-hover:text-primary transition-colors">{lead.email}</span>
              </a>
              {lead.linkedin_url && (
                <a href={`https://${lead.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-white/3 rounded-xl hover:bg-white/6 transition-colors group">
                  <Linkedin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm text-blue-400 truncate">{lead.linkedin_url}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100" />
                </a>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="p-5">
            <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Details</h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Campaign',       value: campaign?.name },
                { label: 'Replied at Step', value: lead.replied_at_step !== null ? `Step ${lead.replied_at_step}` : null },
                { label: 'Total Replies',  value: String(lead.total_replies_count) },
                { label: 'Gender',         value: lead.gender },
                { label: 'Created',        value: new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) },
                { label: 'Last Reply',     value: lead.latest_reply_at ? new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="bg-white/3 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                  <p className="text-xs capitalize">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Reply Thread */}
          {sorted.length > 0 && (
            <div className="p-5">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Conversation ({sorted.length})
              </h4>
              <div className="space-y-3">
                {sorted.map((reply, i) => (
                  <div key={reply.id}>
                    <div className={`rounded-xl p-3.5 ${reply.direction === 'inbound' ? 'bg-white/3' : 'bg-primary/5 border border-primary/10'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {reply.direction === 'inbound'
                            ? <MessageSquare className="w-3.5 h-3.5 text-green-400" />
                            : <Send className="w-3.5 h-3.5 text-blue-400" />}
                          <span className="text-xs text-muted-foreground capitalize">{reply.direction}</span>
                          {reply.sequence_step !== null && (
                            <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">Step {reply.sequence_step}</span>
                          )}
                          {reply.ai_classification !== 'unclassified' && reply.direction === 'inbound' && (
                            <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${INTENT_COLOR[reply.ai_classification]}`}>
                              {reply.ai_classification.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(reply.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/90">{reply.message_text}</p>
                    </div>
                    {i < sorted.length - 1 && (
                      <div className="flex justify-center my-1">
                        <ArrowRight className="w-3 h-3 text-muted-foreground/30 rotate-90" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-[#0a0a0a]">
          <div className="flex gap-2">
            <a href={`mailto:${lead.email}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
              <Mail className="w-4 h-4" />Contact
            </a>
            {lead.linkedin_url && (
              <a href={`https://${lead.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2.5 border border-border rounded-xl hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground">
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

export function ClientLeads() {
  const [leads, setLeads]       = useState<Lead[]>(VISIBLE_LEADS);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [search, setSearch]     = useState('');
  const [filterQ, setFilterQ]   = useState<LeadQualification | 'all'>('all');
  const [filterCamp, setFilterCamp] = useState<string>('all');
  const [filterOoo, setFilterOoo]   = useState<boolean | null>(null);
  const [sortKey, setSortKey]   = useState<SortKey>('latest_reply_at');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [showFilters, setShowFilters] = useState(false);

  const handleUpdate = (id: string, q: LeadQualification) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, qualification: q, updated_at: new Date().toISOString() } : l));
    setSelected(prev => prev?.id === id ? { ...prev, qualification: q } : prev);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    let result = leads.filter(l => {
      const text = [l.full_name, l.email, l.company_name, l.job_title].join(' ').toLowerCase();
      return (
        text.includes(search.toLowerCase()) &&
        (filterQ === 'all' || l.qualification === filterQ) &&
        (filterCamp === 'all' || l.campaign_id === filterCamp) &&
        (filterOoo === null || l.is_ooo === filterOoo)
      );
    });

    result = [...result].sort((a, b) => {
      let av: string | number = 0, bv: string | number = 0;
      switch (sortKey) {
        case 'full_name':            av = a.full_name ?? ''; bv = b.full_name ?? ''; break;
        case 'company_name':         av = a.company_name ?? ''; bv = b.company_name ?? ''; break;
        case 'qualification':        av = CLIENT_QUALIFICATIONS.indexOf(a.qualification); bv = CLIENT_QUALIFICATIONS.indexOf(b.qualification); break;
        case 'latest_reply_at':      av = a.latest_reply_at ?? ''; bv = b.latest_reply_at ?? ''; break;
        case 'replied_at_step':      av = a.replied_at_step ?? 999; bv = b.replied_at_step ?? 999; break;
        case 'total_replies_count':  av = a.total_replies_count; bv = b.total_replies_count; break;
        case 'created_at':           av = a.created_at; bv = b.created_at; break;
      }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [leads, search, filterQ, filterCamp, filterOoo, sortKey, sortDir]);

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.qualification] = (acc[l.qualification] ?? 0) + 1;
    return acc;
  }, {});

  const getCampaign = (id: string | null) => mockCampaigns.find(c => c.id === id);
  const getReplies  = (id: string) => mockLeadReplies.filter(r => r.lead_id === id);
  const outreachCamps = mockCampaigns.filter(c => c.type === 'outreach');

  const handleExport = () => {
    const headers = ['Name','Email','Company','Title','Qualification','Campaign','Step','Replies','Last Reply','Created'];
    const rows = filtered.map(l => [
      l.full_name ?? '', l.email, l.company_name ?? '', l.job_title ?? '',
      l.qualification, getCampaign(l.campaign_id)?.name ?? '',
      l.replied_at_step ?? '', l.total_replies_count,
      l.latest_reply_at ? new Date(l.latest_reply_at).toLocaleDateString('en-GB') : '',
      new Date(l.created_at).toLocaleDateString('en-GB'),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'my-leads.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const SortTh = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      onClick={() => handleSort(col)}
      className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none"
    >
      <span className="inline-flex items-center gap-0.5">
        {label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </span>
    </th>
  );

  const activeFilters = (filterQ !== 'all' ? 1 : 0) + (filterCamp !== 'all' ? 1 : 0) + (filterOoo !== null ? 1 : 0);

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="mb-1">My Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              {filtered.length} leads · click a row to open details · update status inline
            </p>
          </div>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all">
            <Download className="w-4 h-4" />Export CSV
          </button>
        </div>

        {/* Status pill counts */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterQ('all')}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${filterQ === 'all' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
            All <span className="ml-1 opacity-60">{leads.length}</span>
          </button>
          {CLIENT_QUALIFICATIONS.map(q => {
            const cfg = Q_CONFIG[q];
            const n = counts[q] ?? 0;
            if (n === 0) return null;
            return (
              <button key={q} onClick={() => setFilterQ(filterQ === q ? 'all' : q)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${filterQ === q ? cfg.color : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
                <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Search + Filter row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, company or email..."
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Campaign filter */}
          <select
            value={filterCamp}
            onChange={e => setFilterCamp(e.target.value)}
            className="px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-0 max-w-[160px] sm:max-w-none"
          >
            <option value="all">All Campaigns</option>
            {outreachCamps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* OOO filter */}
          <select
            value={filterOoo === null ? 'all' : filterOoo ? 'ooo' : 'active'}
            onChange={e => setFilterOoo(e.target.value === 'all' ? null : e.target.value === 'ooo')}
            className="px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer min-w-0 max-w-[140px] sm:max-w-none"
          >
            <option value="all">All (OOO + Active)</option>
            <option value="active">Active leads</option>
            <option value="ooo">OOO only</option>
          </select>

          {activeFilters > 0 && (
            <button
              onClick={() => { setFilterQ('all'); setFilterCamp('all'); setFilterOoo(null); }}
              className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-red-400 border border-red-500/20 bg-red-500/5 rounded-xl hover:bg-red-500/10 transition-colors">
              <X className="w-3.5 h-3.5" />Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Table — hidden on mobile, replaced by cards */}
        <div className="hidden sm:block bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/20 border-b border-border">
                <tr>
                  <SortTh col="full_name"           label="Lead" />
                  <SortTh col="company_name"         label="Company" />
                  <SortTh col="qualification"        label="Status" />
                  <th className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">Campaign</th>
                  <SortTh col="replied_at_step"      label="Step #" />
                  <SortTh col="total_replies_count"  label="Replies" />
                  <SortTh col="latest_reply_at"      label="Last Reply" />
                  <SortTh col="created_at"           label="Added" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground text-sm">
                      No leads match filters
                    </td>
                  </tr>
                ) : filtered.map(lead => {
                  const cfg = Q_CONFIG[lead.qualification];
                  const campaign = getCampaign(lead.campaign_id);
                  const latestReply = mockLeadReplies.find(r => r.lead_id === lead.id && r.direction === 'inbound');
                  const isSelected = selected?.id === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelected(isSelected ? null : lead)}
                      className={`cursor-pointer transition-colors group ${isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-white/3'}`}
                    >
                      {/* Lead */}
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 bg-gradient-to-br ${grad(lead.id)} rounded-lg flex items-center justify-center text-white text-xs shrink-0`}>
                            {getInitials(lead.full_name)}
                          </div>
                          <div>
                            <p className="text-sm">{lead.full_name ?? '—'}</p>
                            <p className="text-xs text-muted-foreground">{lead.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Company */}
                      <td className="p-3">
                        <p className="text-sm">{lead.company_name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{lead.job_title ?? '—'}</p>
                      </td>

                      {/* Status inline */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <StatusDropdown lead={lead} onUpdate={handleUpdate} />
                          {lead.is_ooo && (
                            <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">OOO</span>
                          )}
                        </div>
                      </td>

                      {/* Campaign */}
                      <td className="p-3">
                        <p className="text-xs text-muted-foreground truncate max-w-[130px]">
                          {campaign?.name ?? '—'}
                        </p>
                      </td>

                      {/* replied_at_step */}
                      <td className="p-3">
                        {lead.replied_at_step !== null ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 bg-primary/10 text-primary rounded-lg text-xs">
                            {lead.replied_at_step}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* total_replies_count */}
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{lead.total_replies_count}</span>
                          {latestReply?.ai_classification && latestReply.ai_classification !== 'unclassified' && (
                            <span className={`px-1.5 py-0.5 rounded capitalize ${INTENT_COLOR[latestReply.ai_classification]}`}>
                              {latestReply.ai_classification === 'info_requested' ? 'info' : latestReply.ai_classification}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* latest_reply_at */}
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {lead.latest_reply_at
                          ? new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
                          : '—'}
                      </td>

                      {/* created_at */}
                      <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {filtered.length} of {leads.length} leads</span>
              <span>Sorted by {sortKey.replace(/_/g, ' ')} · {sortDir}</span>
            </div>
          )}
        </div>

        {/* Mobile card list */}
        <div className="sm:hidden space-y-2">
          {filtered.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
              No leads match filters
            </div>
          ) : filtered.map(lead => {
            const cfg = Q_CONFIG[lead.qualification];
            const campaign = getCampaign(lead.campaign_id);
            const latestReply = mockLeadReplies.find(r => r.lead_id === lead.id && r.direction === 'inbound');
            return (
              <div key={lead.id}
                onClick={() => setSelected(selected?.id === lead.id ? null : lead)}
                className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 bg-gradient-to-br ${grad(lead.id)} rounded-xl flex items-center justify-center text-white text-xs shrink-0`}>
                    {getInitials(lead.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm truncate">{lead.full_name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground truncate">{lead.company_name ?? lead.job_title ?? '—'}</p>
                      </div>
                      {lead.latest_reply_at && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <div onClick={e => e.stopPropagation()}>
                        <StatusDropdown lead={lead} onUpdate={handleUpdate} />
                      </div>
                      {lead.is_ooo && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">OOO</span>
                      )}
                      {latestReply?.ai_classification && latestReply.ai_classification !== 'unclassified' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${INTENT_COLOR[latestReply.ai_classification]}`}>
                          {latestReply.ai_classification === 'info_requested' ? 'info' : latestReply.ai_classification}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length > 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              {filtered.length} of {leads.length} leads
            </p>
          )}
        </div>
      </div>

      {selected && (
        <LeadDrawer
          lead={selected}
          replies={getReplies(selected.id)}
          campaign={getCampaign(selected.campaign_id)}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}
    </>
  );
}