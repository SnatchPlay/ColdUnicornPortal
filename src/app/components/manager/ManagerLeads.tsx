import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, Download, ArrowUp, ArrowDown, ChevronsUpDown, MessageSquare, ChevronDown, CheckCircle2, Mail, ExternalLink } from 'lucide-react';
import type { Lead, LeadQualification } from '../../data/schema';
import { mockLeads, mockClients, mockCampaigns, mockLeadReplies } from '../../data/mock';

const MANAGER_ID = 'user-2';
const MY_CLIENT_IDS = mockClients.filter(c => c.cs_manager_id === MANAGER_ID).map(c => c.id);

const Q_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  unprocessed:       { label: 'Unprocessed',      color: 'bg-secondary/50 text-muted-foreground border-border', dot: 'bg-gray-500' },
  unqualified:       { label: 'Unqualified',       color: 'bg-secondary/50 text-muted-foreground border-border', dot: 'bg-gray-500' },
  preMQL:            { label: 'Pre-MQL',           color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25', dot: 'bg-yellow-400' },
  MQL:               { label: 'MQL',               color: 'bg-blue-500/10 text-blue-400 border-blue-500/25',      dot: 'bg-blue-400' },
  meeting_scheduled: { label: 'Meeting Scheduled', color: 'bg-purple-500/10 text-purple-400 border-purple-500/25', dot: 'bg-purple-400' },
  meeting_held:      { label: 'Meeting Held',      color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25', dot: 'bg-indigo-400' },
  offer_sent:        { label: 'Offer Sent',        color: 'bg-orange-500/10 text-orange-400 border-orange-500/25', dot: 'bg-orange-400' },
  won:               { label: 'Won',               color: 'bg-green-500/10 text-green-400 border-green-500/25',   dot: 'bg-green-400' },
  rejected:          { label: 'Rejected',          color: 'bg-red-500/10 text-red-400 border-red-500/25',         dot: 'bg-red-400' },
};

const ALL_QUALIFICATIONS = ['unprocessed','unqualified','preMQL','MQL','meeting_scheduled','meeting_held','offer_sent','won','rejected'] as LeadQualification[];

const INTENT_COLOR: Record<string, string> = {
  positive: 'text-green-400 bg-green-500/10', negative: 'text-red-400 bg-red-500/10',
  ooo: 'text-yellow-400 bg-yellow-500/10', info_requested: 'text-blue-400 bg-blue-500/10',
  unclassified: 'text-muted-foreground bg-secondary/50',
};

const GRADS = ['from-purple-500 to-pink-500','from-blue-500 to-cyan-500','from-green-500 to-emerald-500','from-orange-500 to-red-500','from-indigo-500 to-purple-500'];
const grad = (id: string) => GRADS[id.charCodeAt(id.length-1) % GRADS.length];
function getInitials(name: string | null) { if (!name) return '?'; return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(); }

type SortKey = 'full_name' | 'company_name' | 'qualification' | 'latest_reply_at' | 'total_replies_count' | 'created_at';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40 ml-1" />;
  return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-primary ml-1" /> : <ArrowDown className="w-3 h-3 text-primary ml-1" />;
}

function StatusDropdown({ lead, onUpdate }: { lead: Lead; onUpdate: (id: string, q: LeadQualification) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const cfg = Q_CONFIG[lead.qualification];
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap ${cfg.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        {cfg.label}
        <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-[#181818] border border-border rounded-xl shadow-2xl z-50 py-1.5">
          {ALL_QUALIFICATIONS.map(q => {
            const c = Q_CONFIG[q];
            return (
              <button key={q} onClick={() => { onUpdate(lead.id, q); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left ${lead.qualification === q ? 'bg-white/5' : ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                <span className="flex-1">{c.label}</span>
                {lead.qualification === q && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ManagerLeads() {
  const allLeads = mockLeads.filter(l => MY_CLIENT_IDS.includes(l.client_id));
  const [leads, setLeads] = useState<Lead[]>(allLeads);
  const [search, setSearch]     = useState('');
  const [filterQ, setFilterQ]   = useState<string>('all');
  const [filterClient, setFilterClient] = useState('all');
  const [sortKey, setSortKey]   = useState<SortKey>('latest_reply_at');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');

  const handleUpdate = (id: string, q: LeadQualification) =>
    setLeads(prev => prev.map(l => l.id === id ? { ...l, qualification: q } : l));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    let r = leads.filter(l => {
      const text = [l.full_name, l.email, l.company_name, l.job_title].join(' ').toLowerCase();
      return text.includes(search.toLowerCase()) &&
        (filterQ === 'all' || l.qualification === filterQ) &&
        (filterClient === 'all' || l.client_id === filterClient);
    });
    return r.sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'full_name')            { av = a.full_name ?? ''; bv = b.full_name ?? ''; }
      else if (sortKey === 'company_name')    { av = a.company_name ?? ''; bv = b.company_name ?? ''; }
      else if (sortKey === 'qualification')   { av = ALL_QUALIFICATIONS.indexOf(a.qualification); bv = ALL_QUALIFICATIONS.indexOf(b.qualification); }
      else if (sortKey === 'latest_reply_at') { av = a.latest_reply_at ?? ''; bv = b.latest_reply_at ?? ''; }
      else if (sortKey === 'total_replies_count') { av = a.total_replies_count; bv = b.total_replies_count; }
      else if (sortKey === 'created_at')      { av = a.created_at; bv = b.created_at; }
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, search, filterQ, filterClient, sortKey, sortDir]);

  const myClients = mockClients.filter(c => MY_CLIENT_IDS.includes(c.id));
  const counts = leads.reduce<Record<string, number>>((acc, l) => { acc[l.qualification] = (acc[l.qualification] ?? 0) + 1; return acc; }, {});

  const getClient = (cid: string | null) => cid ? mockClients.find(c => c.id === cid) : undefined;
  const getCampaign = (cid: string | null) => cid ? mockCampaigns.find(c => c.id === cid) : undefined;
  const getLatestReply = (lid: string) => mockLeadReplies.find(r => r.lead_id === lid && r.direction === 'inbound');

  const SortTh = ({ col, label }: { col: SortKey; label: string }) => (
    <th onClick={() => handleSort(col)}
      className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none">
      <span className="inline-flex items-center gap-0.5">{label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} /></span>
    </th>
  );

  const handleExport = () => {
    const csv = [
      ['Name','Email','Company','Client','Qualification','Campaign','Replies','Last Reply'],
      ...filtered.map(l => [l.full_name??'', l.email, l.company_name??'', getClient(l.client_id)?.name??'', l.qualification, getCampaign(l.campaign_id)?.name??'', l.total_replies_count, l.latest_reply_at??''])
    ].map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'my-leads.csv'; a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="mb-1">Leads Workspace</h1>
          <p className="text-sm text-muted-foreground">All leads across my {myClients.length} clients · full qualification control</p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all">
          <Download className="w-4 h-4" />Export
        </button>
      </div>

      {/* Status pills */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilterQ('all')} className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${filterQ === 'all' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
          All <span className="opacity-60">{leads.length}</span>
        </button>
        {ALL_QUALIFICATIONS.filter(q => (counts[q] ?? 0) > 0).map(q => {
          const cfg = Q_CONFIG[q];
          return (
            <button key={q} onClick={() => setFilterQ(filterQ === q ? 'all' : q)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all ${filterQ === q ? cfg.color : 'bg-card border-border text-muted-foreground hover:border-primary/20'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label} <span className="opacity-60">{counts[q]}</span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads..."
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="w-4 h-4" /></button>}
        </div>
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
          className="px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-muted-foreground focus:outline-none cursor-pointer">
          <option value="all">All Clients</option>
          {myClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary/20 border-b border-border">
              <tr>
                <SortTh col="full_name"           label="Lead" />
                <SortTh col="company_name"         label="Company" />
                <th className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider">Client</th>
                <SortTh col="qualification"        label="Status" />
                <th className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider">Campaign</th>
                <SortTh col="total_replies_count"  label="Replies" />
                <SortTh col="latest_reply_at"      label="Last Reply" />
                <SortTh col="created_at"           label="Added" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="p-12 text-center text-muted-foreground text-sm">No leads match filters</td></tr>
              )}
              {filtered.map(lead => {
                const client   = getClient(lead.client_id);
                const campaign = getCampaign(lead.campaign_id);
                const reply    = getLatestReply(lead.id);
                return (
                  <tr key={lead.id} className="hover:bg-white/3 transition-colors">
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
                    <td className="p-3">
                      <p className="text-sm">{lead.company_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{lead.job_title ?? '—'}</p>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{client?.name ?? '—'}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusDropdown lead={lead} onUpdate={handleUpdate} />
                        {lead.is_ooo && <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">OOO</span>}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[130px]">
                      <span className="truncate block">{campaign?.name ?? '—'}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 text-xs">
                        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{lead.total_replies_count}</span>
                        {reply?.ai_classification && reply.ai_classification !== 'unclassified' && (
                          <span className={`px-1.5 py-0.5 rounded capitalize ${INTENT_COLOR[reply.ai_classification]}`}>
                            {reply.ai_classification === 'info_requested' ? 'info' : reply.ai_classification}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {lead.latest_reply_at ? new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(lead.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} of {leads.length} leads</span>
          <span>Sorted by {sortKey.replace(/_/g, ' ')} · {sortDir}</span>
        </div>
      </div>
    </div>
  );
}
