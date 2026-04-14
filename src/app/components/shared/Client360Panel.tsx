import { useState, useMemo } from 'react';
import { X, Globe, Building2, Calendar, FileText, Users, BarChart3,
  CheckCircle2, AlertCircle, ChevronDown, Pencil, Save, XCircle,
  Send, TrendingUp, Plus, ToggleLeft, ToggleRight, Percent, Mail,
  AlertTriangle, Clock, Bot } from 'lucide-react';
import type { Client, ClientSetup, Domain, Campaign, Lead, LeadQualification,
  ClientHealthAssessment, HealthStatus, CrmPlatform, ClientIssue, IssueSeverity, IssueStatus } from '../../data/schema';
import {
  mockClientSetup, mockDomains, mockCampaigns, mockLeads,
  mockClientDailySnapshots, mockHealthAssessments, mockInvoices,
  mockUsers, mockPdca, mockCampaignDailyStats, mockClientIssues, mockAuditEvents,
} from '../../data/mock';
import type { PdcaStatus, ClientPdca } from '../../data/mock';
import { HealthBadge, HealthDot, getOverallHealth } from './HealthBadge';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';

type Tab = 'overview' | 'campaigns' | 'domains' | 'leads' | 'invoices' | 'pdca' | 'issues' | 'activity';

const TABS: { id: Tab; label: string; icon: typeof Globe }[] = [
  { id: 'overview',  label: 'Overview',  icon: BarChart3 },
  { id: 'campaigns', label: 'Campaigns', icon: Send },
  { id: 'domains',   label: 'Domains',   icon: Globe },
  { id: 'leads',     label: 'Leads',     icon: Users },
  { id: 'invoices',  label: 'Invoices',  icon: FileText },
  { id: 'pdca',      label: 'PDCA',      icon: CheckCircle2 },
  { id: 'issues',    label: 'Issues',    icon: AlertTriangle },
  { id: 'activity',  label: 'Activity',  icon: Clock },
];

const SEV_CFG: Record<IssueSeverity, { label: string; color: string; bg: string }> = {
  low:      { label: 'Low',      color: 'text-gray-400',   bg: 'bg-gray-500/10 border-gray-500/20' },
  medium:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  high:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  critical: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
};
const ISS_STATUS_CFG: Record<IssueStatus, { label: string; color: string }> = {
  open:        { label: 'Open',        color: 'text-red-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-400' },
  resolved:    { label: 'Resolved',    color: 'text-green-400' },
  closed:      { label: 'Closed',      color: 'text-muted-foreground' },
};

const HEALTH_LABELS: Record<string, string> = {
  ip_health: 'IP', domains_health: 'Domains', warmup_health: 'Warmup',
  copy_health: 'Copy', funnel_health: 'Funnel',
};
const HEALTH_OPTIONS: HealthStatus[] = ['green', 'yellow', 'red', 'unknown'];

const TT = {
  contentStyle: { backgroundColor: 'rgba(13,13,13,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#fff', fontSize: 11, padding: '6px 10px' },
  cursor: { stroke: 'rgba(255,255,255,0.1)' },
};

const CAMP_STATUS: Record<string, string> = {
  active:    'text-green-400 bg-green-500/10 border-green-500/20',
  paused:    'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  draft:     'text-muted-foreground bg-secondary/50 border-border',
  completed: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};
const INVOICE_CFG: Record<string, string> = {
  paid:    'text-green-400 bg-green-500/10 border-green-500/20',
  sent:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
  draft:   'text-muted-foreground bg-secondary/50 border-border',
  overdue: 'text-red-400 bg-red-500/10 border-red-500/20',
};
const Q_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  preMQL:            { label: 'Pre-MQL',           color: 'text-yellow-400', dot: 'bg-yellow-400' },
  MQL:               { label: 'MQL',               color: 'text-blue-400',   dot: 'bg-blue-400' },
  meeting_scheduled: { label: 'Meeting Scheduled', color: 'text-purple-400', dot: 'bg-purple-400' },
  meeting_held:      { label: 'Meeting Held',      color: 'text-indigo-400', dot: 'bg-indigo-400' },
  offer_sent:        { label: 'Offer Sent',        color: 'text-orange-400', dot: 'bg-orange-400' },
  won:               { label: 'Won',               color: 'text-green-400',  dot: 'bg-green-400' },
  rejected:          { label: 'Rejected',          color: 'text-red-400',    dot: 'bg-red-400' },
  unprocessed:       { label: 'Unprocessed',       color: 'text-muted-foreground', dot: 'bg-gray-500' },
  unqualified:       { label: 'Unqualified',       color: 'text-muted-foreground', dot: 'bg-gray-500' },
};
const ALL_Q: LeadQualification[] = ['unprocessed','unqualified','preMQL','MQL','meeting_scheduled','meeting_held','offer_sent','won','rejected'];

const PDCA_CFG: Record<PdcaStatus, { label: string; color: string; dot: string; bg: string }> = {
  done:        { label: 'Done',        color: 'text-green-400',       dot: 'bg-green-400', bg: 'bg-green-500/8 border-green-500/20' },
  in_progress: { label: 'In Progress', color: 'text-blue-400',        dot: 'bg-blue-400',  bg: 'bg-blue-500/8 border-blue-500/20' },
  pending:     { label: 'Pending',     color: 'text-muted-foreground', dot: 'bg-gray-500', bg: 'bg-white/3 border-border' },
  blocked:     { label: 'Blocked',     color: 'text-red-400',         dot: 'bg-red-400',   bg: 'bg-red-500/8 border-red-500/20' },
};
const STATUS_COLOR: Record<string, string> = {
  active:     'text-green-400 bg-green-500/10 border-green-500/20',
  onboarding: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  paused:     'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  churned:    'text-red-400 bg-red-500/10 border-red-500/20',
  lost:       'text-gray-400 bg-gray-500/10 border-gray-500/20',
};

// ── Tiny helper components ────────────────────────────────────

function EditBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/8 transition-colors shrink-0">
      <Pencil className="w-3.5 h-3.5" />
    </button>
  );
}

function SaveBar({ onSave, onCancel, saved }: { onSave: () => void; onCancel: () => void; saved: boolean }) {
  return (
    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
      {saved ? (
        <span className="flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5" /> Saved
        </span>
      ) : (
        <>
          <button onClick={onSave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={onCancel}
            className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder = '' }: {
  value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/40" />
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 cursor-pointer">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ── Campaign detail card ──────────────────────────────────────

function CampaignCard({
  campaign, onStatusToggle, onEdit,
}: {
  campaign: Campaign;
  onStatusToggle: (id: string, newStatus: string) => void;
  onEdit: (id: string, field: string, value: string | number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode]   = useState(false);
  const [saved, setSaved]         = useState(false);
  const [name, setName]           = useState(campaign.name);
  const [dbSize, setDbSize]       = useState(String(campaign.database_size));

  const stats = mockCampaignDailyStats.filter(s => s.campaign_id === campaign.id);
  const totalSent    = stats.reduce((a, s) => a + s.sent_count, 0);
  const totalReplies = stats.reduce((a, s) => a + s.reply_count, 0);
  const totalBounces = stats.reduce((a, s) => a + s.bounce_count, 0);
  const totalOpens   = stats.reduce((a, s) => a + s.unique_open_count, 0);

  const replyRate  = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
  const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
  const openRate   = totalSent > 0 ? (totalOpens   / totalSent) * 100 : 0;

  const chartData = stats.map(s => ({
    date: s.report_date,
    sent:    s.sent_count,
    replies: s.reply_count,
    bounces: s.bounce_count,
    opens:   s.unique_open_count,
  }));

  const rateColor = (r: number) => r >= 5 ? 'text-green-400' : r >= 3 ? 'text-yellow-400' : 'text-red-400';

  const handleSave = () => {
    onEdit(campaign.id, 'name', name);
    onEdit(campaign.id, 'database_size', Number(dbSize));
    setSaved(true);
    setTimeout(() => { setSaved(false); setEditMode(false); }, 1200);
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {editMode ? (
              <Input value={name} onChange={setName} placeholder="Campaign name" />
            ) : (
              <p className="text-sm">{campaign.name}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${CAMP_STATUS[campaign.status ?? 'draft']}`}>
                {campaign.status ?? 'draft'}
              </span>
              <span className="text-xs text-muted-foreground capitalize">{campaign.type}</span>
              {campaign.external_id && (
                <span className="text-xs text-muted-foreground font-mono">{campaign.external_id}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Status toggle */}
            {campaign.status !== 'draft' && (
              <button
                onClick={() => onStatusToggle(campaign.id, campaign.status === 'active' ? 'paused' : 'active')}
                className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                  campaign.status === 'active'
                    ? 'border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/10'
                    : 'border-green-500/20 text-green-400 hover:bg-green-500/10'
                }`}
              >
                {campaign.status === 'active' ? 'Pause' : 'Resume'}
              </button>
            )}
            <EditBtn onClick={() => { setEditMode(!editMode); setSaved(false); }} />
            <button onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/8 transition-colors">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Stats row — always visible */}
        {totalSent > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {[
              { label: 'Sent',    value: totalSent.toLocaleString(),   sub: null,                           color: 'text-foreground' },
              { label: 'Replies', value: `${replyRate.toFixed(1)}%`,   sub: `${totalReplies} total`,        color: rateColor(replyRate) },
              { label: 'Opens',   value: `${openRate.toFixed(1)}%`,    sub: `${totalOpens.toLocaleString()}`, color: 'text-blue-400' },
              { label: 'Bounces', value: `${bounceRate.toFixed(1)}%`,  sub: `${totalBounces} total`,        color: bounceRate > 3 ? 'text-red-400' : 'text-muted-foreground' },
            ].map(m => (
              <div key={m.label} className="bg-white/3 rounded-lg p-2 text-center">
                <p className={`text-sm ${m.color}`}>{m.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                {m.sub && <p className="text-xs text-muted-foreground/60">{m.sub}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Database size */}
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          {editMode ? (
            <Field label="Prospects in DB">
              <Input type="number" value={dbSize} onChange={setDbSize} />
            </Field>
          ) : (
            <span>Prospects in DB: {campaign.database_size > 0 ? campaign.database_size.toLocaleString() : '—'}</span>
          )}
          {campaign.database_size > 0 && totalSent > 0 && (
            <span>Coverage: {Math.min((totalSent / campaign.database_size) * 100, 100).toFixed(0)}%</span>
          )}
        </div>

        {editMode && <SaveBar onSave={handleSave} onCancel={() => setEditMode(false)} saved={saved} />}
      </div>

      {/* Expanded chart */}
      {expanded && chartData.length > 0 && (
        <div className="border-t border-border p-4 bg-black/20">
          <p className="text-xs text-muted-foreground mb-3">Daily performance</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="date"
                tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...TT} labelFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
              <Bar dataKey="sent"    name="Sent"    fill="#3b82f640" radius={[2,2,0,0]} maxBarSize={18} />
              <Bar dataKey="replies" name="Replies" fill="#3b82f6"   radius={[2,2,0,0]} maxBarSize={18} />
              <Bar dataKey="bounces" name="Bounces" fill="#ef4444"   radius={[2,2,0,0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────

interface Props { client: Client; onClose: () => void; }

export function Client360Panel({ client, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  // ── Local editable state ──────────────────────────────────
  const [lClient, setLClient]   = useState<Client>({ ...client });
  const [lSetup,  setLSetup]    = useState<ClientSetup | undefined>(
    () => mockClientSetup.find(s => s.client_id === client.id) ? { ...mockClientSetup.find(s => s.client_id === client.id)! } : undefined
  );
  const [lDomains,     setLDomains]     = useState(() => mockDomains.filter(d => d.client_id === client.id).map(d => ({ ...d })));
  const [lCampaigns,   setLCampaigns]   = useState(() => mockCampaigns.filter(c => c.client_id === client.id).map(c => ({ ...c })));
  const [lLeads,       setLLeads]       = useState(() => mockLeads.filter(l => l.client_id === client.id).map(l => ({ ...l })));
  const [lAssessments, setLAssessments] = useState(() => mockHealthAssessments.filter(h => h.client_id === client.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at)).map(a => ({ ...a })));
  const [lInvoices,    setLInvoices]    = useState(() => mockInvoices.filter(i => i.client_id === client.id).sort((a, b) => b.issue_date.localeCompare(a.issue_date)).map(i => ({ ...i })));
  const [lIssues,      setLIssues]      = useState<ClientIssue[]>(() => mockClientIssues.filter(i => i.client_id === client.id).map(i => ({ ...i })));
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [issueForm,    setIssueForm]    = useState({ title: '', description: '', severity: 'medium' as IssueSeverity });

  const clientEvents = mockAuditEvents.filter(e => e.client_id === client.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  // ── Edit modes ────────────────────────────────────────────
  const [editClient,  setEditClient]  = useState(false);
  const [editSetup,   setEditSetup]   = useState(false);
  const [clientSaved, setClientSaved] = useState(false);
  const [setupSaved,  setSetupSaved]  = useState(false);
  const [addHealth,   setAddHealth]   = useState(false);

  // New health assessment form
  const [newHealth, setNewHealth] = useState<Omit<ClientHealthAssessment, 'id' | 'client_id' | 'assessed_by' | 'assessed_at'>>({
    ip_health: 'green', domains_health: 'green', warmup_health: 'green',
    copy_health: 'green', funnel_health: 'green', insights: '',
  });

  const snapshots    = mockClientDailySnapshots.filter(s => s.client_id === client.id);
  const pdca         = mockPdca.find(p => p.client_id === client.id);
  const manager      = mockUsers.find(u => u.id === lClient.cs_manager_id);
  const managers     = mockUsers.filter(u => u.role === 'cs_manager' || u.role === 'admin');
  const latest       = lAssessments[0];
  const overallHealth = latest ? getOverallHealth([latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health]) : 'unknown';

  const snapshotChart = snapshots.map(s => ({
    date:     s.snapshot_date,
    mqls:     s.mql_diff,
    meetings: s.me_diff,
  }));
  const totalMqls     = snapshots.reduce((a, s) => a + s.mql_diff, 0);
  const totalMeetings = snapshots.reduce((a, s) => a + s.me_diff, 0);
  const totalWon      = snapshots.reduce((a, s) => a + s.won_diff, 0);
  const latestSnap    = snapshots[snapshots.length - 1];

  // ── Handlers ──────────────────────────────────────────────

  const saveClient = () => {
    setClientSaved(true);
    setTimeout(() => { setClientSaved(false); setEditClient(false); }, 1200);
  };

  const saveSetup = () => {
    setSetupSaved(true);
    setTimeout(() => { setSetupSaved(false); setEditSetup(false); }, 1200);
  };

  const submitHealth = () => {
    const id = `health-${Date.now()}`;
    setLAssessments(prev => [{
      id, client_id: client.id, assessed_by: 'user-1',
      assessed_at: new Date().toISOString(),
      ...newHealth,
    }, ...prev]);
    setAddHealth(false);
    setNewHealth({ ip_health: 'green', domains_health: 'green', warmup_health: 'green', copy_health: 'green', funnel_health: 'green', insights: '' });
  };

  const updateDomain = (id: string, patch: Partial<Domain>) =>
    setLDomains(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));

  const toggleCampaignStatus = (id: string, status: string) =>
    setLCampaigns(prev => prev.map(c => c.id === id ? { ...c, status } : c));

  const editCampaignField = (id: string, field: string, value: string | number) =>
    setLCampaigns(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));

  const updateLead = (id: string, q: LeadQualification) =>
    setLLeads(prev => prev.map(l => l.id === id ? { ...l, qualification: q } : l));

  const updateInvoice = (id: string, status: string) =>
    setLInvoices(prev => prev.map(i => i.id === id ? { ...i, status: status as any } : i));

  const submitIssue = () => {
    if (!issueForm.title.trim()) return;
    const now = new Date().toISOString();
    setLIssues(prev => [...prev, {
      id: `issue-${Date.now()}`,
      client_id: client.id,
      created_by: 'user-1',
      title: issueForm.title.trim(),
      description: issueForm.description.trim() || null,
      severity: issueForm.severity,
      status: 'open',
      resolved_at: null,
      created_at: now,
      updated_at: now,
    }]);
    setIssueForm({ title: '', description: '', severity: 'medium' });
    setShowNewIssue(false);
  };

  const updateIssueStatus = (id: string, status: IssueStatus) =>
    setLIssues(prev => prev.map(i => i.id === id ? { ...i, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null } : i));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-[740px] max-w-full h-full bg-[#0d0d0d] border-l border-border flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-[#0a0a0a] flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base">{lClient.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-lg border capitalize ${STATUS_COLOR[lClient.status] ?? ''}`}>{lClient.status}</span>
                <HealthBadge status={overallHealth} />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" />{manager?.full_name ?? '—'}</span>
                {lClient.contracted_amount && <span className="flex items-center gap-1"><FileText className="w-3 h-3" />€{lClient.contracted_amount.toLocaleString()}/mo</span>}
                {lClient.contract_due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Due {lClient.contract_due_date}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 border-b border-border overflow-x-auto shrink-0">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-3 text-xs whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ══ OVERVIEW ══════════════════════════════════════ */}
          {tab === 'overview' && (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total MQLs',  value: totalMqls,     color: '#3b82f6', target: lClient.kpi_leads },
                  { label: 'Meetings',    value: totalMeetings, color: '#8b5cf6', target: lClient.kpi_meetings },
                  { label: 'Won',         value: totalWon,      color: '#10b981', target: null },
                  { label: 'Prospects',   value: latestSnap?.prospects_count ?? 0, color: '#f59e0b', target: null },
                ].map(k => (
                  <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                    <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
                    <p className="text-xl" style={{ color: k.color }}>{k.value.toLocaleString()}</p>
                    {k.target && <p className="text-xs text-muted-foreground mt-0.5">target {k.target}/mo</p>}
                  </div>
                ))}
              </div>

              {/* Pipeline trend */}
              {snapshotChart.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <h4 className="text-sm mb-3">Pipeline Trend</h4>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={snapshotChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip {...TT} labelFormatter={v => new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
                      <Area type="monotone" dataKey="mqls"     name="MQLs"     stroke="#3b82f6" fill="#3b82f618" strokeWidth={2} />
                      <Area type="monotone" dataKey="meetings" name="Meetings" stroke="#8b5cf6" fill="#8b5cf618" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Client info — editable */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm">Client Info</h4>
                  {!editClient && <EditBtn onClick={() => setEditClient(true)} />}
                </div>
                {editClient ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name"><Input value={lClient.name} onChange={v => setLClient(p => ({ ...p, name: v }))} /></Field>
                    <Field label="Status">
                      <Select value={lClient.status} onChange={v => setLClient(p => ({ ...p, status: v as any }))}
                        options={['active','onboarding','paused','churned','lost'].map(s => ({ value: s, label: s }))} />
                    </Field>
                    <Field label="CS Manager">
                      <Select value={lClient.cs_manager_id ?? ''} onChange={v => setLClient(p => ({ ...p, cs_manager_id: v }))}
                        options={managers.map(m => ({ value: m.id, label: m.full_name }))} />
                    </Field>
                    <Field label="Bison Workspace ID"><Input value={lClient.bison_workspace_id ?? ''} onChange={v => setLClient(p => ({ ...p, bison_workspace_id: v || null }))} /></Field>
                    <Field label="MQL Target/mo"><Input type="number" value={lClient.kpi_leads ?? ''} onChange={v => setLClient(p => ({ ...p, kpi_leads: Number(v) || null }))} /></Field>
                    <Field label="Meeting Target/mo"><Input type="number" value={lClient.kpi_meetings ?? ''} onChange={v => setLClient(p => ({ ...p, kpi_meetings: Number(v) || null }))} /></Field>
                    <Field label="Contract €/mo"><Input type="number" value={lClient.contracted_amount ?? ''} onChange={v => setLClient(p => ({ ...p, contracted_amount: Number(v) || null }))} /></Field>
                    <Field label="Contract Due"><Input type="date" value={lClient.contract_due_date ?? ''} onChange={v => setLClient(p => ({ ...p, contract_due_date: v || null }))} /></Field>
                    <SaveBar onSave={saveClient} onCancel={() => { setEditClient(false); setLClient({ ...client }); }} saved={clientSaved} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    {[
                      { label: 'Status',    value: lClient.status },
                      { label: 'Manager',   value: manager?.full_name ?? '—' },
                      { label: 'Bison WS',  value: lClient.bison_workspace_id ?? '—' },
                      { label: 'MQL Target', value: lClient.kpi_leads ? `${lClient.kpi_leads}/mo` : '—' },
                      { label: 'Mtg Target', value: lClient.kpi_meetings ? `${lClient.kpi_meetings}/mo` : '—' },
                      { label: 'Contract',  value: lClient.contracted_amount ? `€${lClient.contracted_amount.toLocaleString()}/mo` : '—' },
                      { label: 'Due',       value: lClient.contract_due_date ?? '—' },
                    ].map(f => (
                      <div key={f.label} className="bg-white/3 rounded-lg p-2.5">
                        <p className="text-muted-foreground mb-0.5">{f.label}</p>
                        <p className="capitalize">{f.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Setup — editable */}
              {lSetup && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm">Workspace Setup</h4>
                    {!editSetup && <EditBtn onClick={() => setEditSetup(true)} />}
                  </div>
                  {editSetup ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Inboxes count"><Input type="number" value={lSetup.inboxes_count} onChange={v => setLSetup(p => p ? { ...p, inboxes_count: Number(v) } : p)} /></Field>
                      <Field label="Min sent/day"><Input type="number" value={lSetup.min_sent_daily} onChange={v => setLSetup(p => p ? { ...p, min_sent_daily: Number(v) } : p)} /></Field>
                      <Field label="Prospects base"><Input type="number" value={lSetup.prospects_in_base} onChange={v => setLSetup(p => p ? { ...p, prospects_in_base: Number(v) } : p)} /></Field>
                      <Field label="CRM Platform">
                        <Select value={lSetup.crm_platform ?? 'none'} onChange={v => setLSetup(p => p ? { ...p, crm_platform: v as CrmPlatform } : p)}
                          options={['none','pipedrive','salesforce','zoho','livespace'].map(s => ({ value: s, label: s }))} />
                      </Field>
                      <Field label="OOO Routing">
                        <Select value={lSetup.auto_ooo_enabled ? 'on' : 'off'} onChange={v => setLSetup(p => p ? { ...p, auto_ooo_enabled: v === 'on' } : p)}
                          options={[{ value: 'on', label: 'Enabled' }, { value: 'off', label: 'Disabled' }]} />
                      </Field>
                      <SaveBar onSave={saveSetup} onCancel={() => setEditSetup(false)} saved={setupSaved} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      {[
                        { label: 'Inboxes',      value: `${lSetup.inboxes_count}` },
                        { label: 'Min sent/day', value: `${lSetup.min_sent_daily}` },
                        { label: 'Prospects',    value: lSetup.prospects_in_base.toLocaleString() },
                        { label: 'CRM',          value: lSetup.crm_platform ?? 'none' },
                        { label: 'OOO',          value: lSetup.auto_ooo_enabled ? 'enabled' : 'off' },
                      ].map(f => (
                        <div key={f.label} className="bg-white/3 rounded-lg p-2.5">
                          <p className="text-muted-foreground mb-0.5">{f.label}</p>
                          <p className="capitalize">{f.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Health assessment */}
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm">Health Assessment</h4>
                  <div className="flex items-center gap-2">
                    {latest && <span className="text-xs text-muted-foreground">{new Date(latest.assessed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
                    <button onClick={() => setAddHealth(!addHealth)}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
                      <Plus className="w-3.5 h-3.5" />New
                    </button>
                  </div>
                </div>

                {addHealth && (
                  <div className="mb-4 p-4 bg-white/3 border border-border rounded-xl space-y-3">
                    <p className="text-xs text-muted-foreground mb-2">Add new health assessment</p>
                    <div className="grid grid-cols-5 gap-2">
                      {(['ip_health','domains_health','warmup_health','copy_health','funnel_health'] as const).map(key => (
                        <div key={key} className="text-center">
                          <p className="text-xs text-muted-foreground mb-1">{HEALTH_LABELS[key]}</p>
                          <select value={newHealth[key]} onChange={e => setNewHealth(p => ({ ...p, [key]: e.target.value as HealthStatus }))}
                            className="w-full px-1 py-1 bg-secondary/40 border border-border rounded text-xs focus:outline-none cursor-pointer">
                            {HEALTH_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                    <div>
                      <textarea value={newHealth.insights ?? ''} onChange={e => setNewHealth(p => ({ ...p, insights: e.target.value }))}
                        placeholder="Insights / notes..."
                        className="w-full px-2.5 py-2 bg-secondary/30 border border-border rounded-lg text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40"
                        rows={2} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={submitHealth} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 transition-colors flex items-center gap-1">
                        <Save className="w-3 h-3" />Submit
                      </button>
                      <button onClick={() => setAddHealth(false)} className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                )}

                {latest ? (
                  <>
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {(['ip_health','domains_health','warmup_health','copy_health','funnel_health'] as const).map(key => (
                        <div key={key} className="text-center">
                          <HealthDot status={latest[key]} />
                          <p className="text-xs text-muted-foreground mt-1 leading-tight">{HEALTH_LABELS[key]}</p>
                        </div>
                      ))}
                    </div>
                    {latest.insights && (
                      <div className="p-3 bg-white/3 rounded-xl text-xs text-muted-foreground leading-relaxed">{latest.insights}</div>
                    )}
                    <p className="text-xs text-muted-foreground/50 mt-2">
                      By {mockUsers.find(u => u.id === latest.assessed_by)?.full_name ?? '—'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No assessment yet</p>
                )}
              </div>
            </>
          )}

          {/* ══ CAMPAIGNS ═════════════════════════════════════ */}
          {tab === 'campaigns' && (
            <div className="space-y-3">
              {/* Aggregate stats */}
              {lCampaigns.length > 0 && (() => {
                const outreachCamps = lCampaigns.filter(c => c.type === 'outreach');
                const allStats = mockCampaignDailyStats.filter(s => outreachCamps.find(c => c.id === s.campaign_id));
                const tSent    = allStats.reduce((a, s) => a + s.sent_count, 0);
                const tReplies = allStats.reduce((a, s) => a + s.reply_count, 0);
                const tBounces = allStats.reduce((a, s) => a + s.bounce_count, 0);
                const tOpens   = allStats.reduce((a, s) => a + s.unique_open_count, 0);
                if (tSent === 0) return null;
                return (
                  <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-4 mb-2">
                    <p className="text-xs text-blue-400 mb-2">Portfolio totals (outreach campaigns)</p>
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Emails Sent', value: tSent.toLocaleString(), color: 'text-foreground' },
                        { label: 'Reply Rate',  value: `${((tReplies/tSent)*100).toFixed(2)}%`, color: (tReplies/tSent)*100 >= 5 ? 'text-green-400' : 'text-yellow-400' },
                        { label: 'Open Rate',   value: `${((tOpens/tSent)*100).toFixed(1)}%`,   color: 'text-blue-400' },
                        { label: 'Bounce Rate', value: `${((tBounces/tSent)*100).toFixed(2)}%`, color: (tBounces/tSent)*100 > 3 ? 'text-red-400' : 'text-muted-foreground' },
                      ].map(m => (
                        <div key={m.label} className="text-center">
                          <p className={`text-base ${m.color}`}>{m.value}</p>
                          <p className="text-xs text-muted-foreground">{m.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {lCampaigns.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-12">No campaigns yet</div>
              )}
              {lCampaigns.map(c => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  onStatusToggle={toggleCampaignStatus}
                  onEdit={editCampaignField}
                />
              ))}
            </div>
          )}

          {/* ══ DOMAINS ═══════════════════════════════════════ */}
          {tab === 'domains' && (
            <div className="space-y-2">
              {lDomains.length === 0 && <div className="text-center text-muted-foreground text-sm py-12">No domains</div>}
              {lDomains.map(d => (
                <DomainRow key={d.id} domain={d} onUpdate={updateDomain} />
              ))}
            </div>
          )}

          {/* ══ LEADS ═════════════════════════════════════════ */}
          {tab === 'leads' && (
            <div className="space-y-2">
              {lLeads.length === 0 && <div className="text-center text-muted-foreground text-sm py-12">No leads yet</div>}
              {lLeads.map(l => (
                <LeadRow key={l.id} lead={l} onUpdateQ={updateLead} />
              ))}
            </div>
          )}

          {/* ══ INVOICES ══════════════════════════════════════ */}
          {tab === 'invoices' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">Total Invoiced</p>
                  <p className="text-lg text-green-400">€{lInvoices.reduce((a, i) => a + i.amount, 0).toLocaleString()}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-3">
                  <p className="text-xs text-muted-foreground mb-1">Outstanding</p>
                  <p className="text-lg text-yellow-400">€{lInvoices.filter(i => i.status !== 'paid').reduce((a, i) => a + i.amount, 0).toLocaleString()}</p>
                </div>
              </div>
              {lInvoices.map(inv => (
                <div key={inv.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm">€{inv.amount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{inv.issue_date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {inv.vindication_stage && <span className="text-xs text-orange-400">{inv.vindication_stage}</span>}
                    <select value={inv.status} onChange={e => updateInvoice(inv.id, e.target.value)}
                      className={`text-xs px-2 py-0.5 rounded-lg border cursor-pointer bg-transparent focus:outline-none ${INVOICE_CFG[inv.status]}`}>
                      {['draft','sent','paid','overdue'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ══ PDCA ══════════════════════════════════════════ */}
          {tab === 'pdca' && (
            <div className="space-y-3">
              {!pdca && <div className="text-center text-muted-foreground text-sm py-12">No PDCA data</div>}
              {pdca && (['plan','do','check','act'] as const).map(phase => {
                const cell = pdca[phase];
                const cfg  = PDCA_CFG[cell.status];
                const labels: Record<string, string> = { plan: 'Plan', do: 'Do', check: 'Check', act: 'Act' };
                const descs:  Record<string, string> = {
                  plan:  'ICP, sequences, campaign architecture',
                  do:    'Active sending, infrastructure, daily execution',
                  check: 'KPI review, health assessment, analytics',
                  act:   'Improvements, A/B tests, pivots',
                };
                return (
                  <div key={phase} className={`border rounded-xl p-4 ${cfg.bg}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm">{labels[phase]}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.bg} ${cfg.color}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} mr-1`} />{cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{descs[phase]}</p>
                      </div>
                      {cell.due && <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />{cell.due}</span>}
                    </div>
                    <ul className="space-y-1.5">
                      {cell.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />{item}
                        </li>
                      ))}
                    </ul>
                    {cell.note && (
                      <div className="mt-3 flex items-start gap-2 p-2.5 bg-white/3 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-yellow-400">{cell.note}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* ══ ISSUES ════════════════════════════════════════ */}
          {tab === 'issues' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{lIssues.filter(i => ['open','in_progress'].includes(i.status)).length} open</p>
                <button onClick={() => setShowNewIssue(!showNewIssue)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
                  <Plus className="w-3.5 h-3.5" />New Issue
                </button>
              </div>
              {showNewIssue && (
                <div className="bg-white/3 border border-primary/20 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Severity">
                      <select value={issueForm.severity} onChange={e => setIssueForm(p => ({ ...p, severity: e.target.value as IssueSeverity }))}
                        className="w-full px-2.5 py-1.5 bg-secondary/30 border border-border rounded-lg text-xs focus:outline-none cursor-pointer">
                        {(['low','medium','high','critical'] as IssueSeverity[]).map(s => (
                          <option key={s} value={s}>{SEV_CFG[s].label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Title">
                      <Input value={issueForm.title} onChange={v => setIssueForm(p => ({ ...p, title: v }))} placeholder="Issue title..." />
                    </Field>
                  </div>
                  <Field label="Description">
                    <textarea value={issueForm.description} onChange={e => setIssueForm(p => ({ ...p, description: e.target.value }))}
                      rows={2} placeholder="Optional details..."
                      className="w-full px-2.5 py-2 bg-secondary/30 border border-border rounded-lg text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/40" />
                  </Field>
                  <div className="flex gap-2">
                    <button onClick={submitIssue}
                      className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs hover:bg-primary/90 flex items-center gap-1">
                      <Save className="w-3 h-3" />Submit
                    </button>
                    <button onClick={() => setShowNewIssue(false)} className="px-3 py-1.5 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {lIssues.length === 0 && !showNewIssue && (
                <div className="text-center text-muted-foreground text-sm py-8">No issues logged</div>
              )}
              {lIssues.sort((a, b) => {
                const o: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
                return o[a.severity] - o[b.severity];
              }).map(issue => {
                const sevCfg  = SEV_CFG[issue.severity];
                const statCfg = ISS_STATUS_CFG[issue.status];
                const creator = mockUsers.find(u => u.id === issue.created_by);
                return (
                  <div key={issue.id} className={`bg-card border rounded-xl p-4 ${issue.severity === 'critical' ? 'border-red-500/30' : issue.severity === 'high' ? 'border-orange-500/20' : 'border-border'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className={`text-xs px-2 py-0.5 rounded-lg border ${sevCfg.bg} ${sevCfg.color}`}>{sevCfg.label}</span>
                          <span className={`text-xs ${statCfg.color}`}>{statCfg.label}</span>
                        </div>
                        <p className="text-sm">{issue.title}</p>
                        {issue.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{issue.description}</p>}
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>{new Date(issue.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                          {creator && <span>by {creator.full_name}</span>}
                          {issue.resolved_at && <span className="text-green-400">Resolved</span>}
                        </div>
                      </div>
                      <select value={issue.status} onChange={e => updateIssueStatus(issue.id, e.target.value as IssueStatus)}
                        className={`text-xs px-2 py-1 bg-secondary/30 border border-border rounded-lg focus:outline-none cursor-pointer shrink-0 ${statCfg.color}`}>
                        {(['open','in_progress','resolved','closed'] as IssueStatus[]).map(s => (
                          <option key={s} value={s}>{ISS_STATUS_CFG[s].label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ══ ACTIVITY ══════════════════════════════════════ */}
          {tab === 'activity' && (
            <div className="space-y-2">
              {clientEvents.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-8">No activity logged</div>
              )}
              {clientEvents.map(evt => {
                const isAuto = evt.triggered_by === 'automation';
                const actor  = mockUsers.find(u => u.id === evt.triggered_by);
                return (
                  <div key={evt.id} className="flex items-start gap-3 p-3 bg-card border border-border rounded-xl">
                    <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${isAuto ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {isAuto ? <Bot className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">{evt.description}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded ${isAuto ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                          {isAuto ? '🤖 Auto' : `👤 ${actor?.full_name ?? evt.triggered_by}`}
                        </span>
                        <span className="capitalize">{evt.event_type.replace(/_/g, ' ')}</span>
                      </div>
                      {evt.metadata && (
                        <p className="text-xs text-muted-foreground/50 mt-1 font-mono truncate">
                          {JSON.stringify(evt.metadata).slice(0, 80)}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">
                      {new Date(evt.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Domain row with inline edit ───────────────────────────────

function DomainRow({ domain, onUpdate }: { domain: Domain; onUpdate: (id: string, patch: Partial<Domain>) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [rep, setRep]           = useState(String(domain.warmup_reputation ?? ''));

  const handleSave = () => {
    onUpdate(domain.id, { warmup_reputation: rep ? Number(rep) : null });
    setSaved(true);
    setTimeout(() => { setSaved(false); setEditMode(false); }, 1000);
  };

  const repVal  = domain.warmup_reputation ?? 0;
  const repColor = repVal >= 80 ? 'bg-green-500' : repVal >= 60 ? 'bg-yellow-500' : repVal >= 40 ? 'bg-orange-500' : 'bg-red-500';

  return (
    <div className={`bg-card border rounded-xl p-4 ${domain.is_blacklisted ? 'border-red-500/30' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Globe className={`w-4 h-4 shrink-0 ${domain.is_active ? 'text-green-400' : 'text-muted-foreground'}`} />
          <div className="min-w-0">
            <p className="text-sm truncate">{domain.domain_name}</p>
            <p className="text-xs text-muted-foreground truncate">{domain.setup_email ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle active */}
          <button onClick={() => onUpdate(domain.id, { is_active: !domain.is_active })}
            title={domain.is_active ? 'Deactivate' : 'Activate'}
            className="transition-colors">
            {domain.is_active
              ? <ToggleRight className="w-5 h-5 text-green-400" />
              : <ToggleLeft  className="w-5 h-5 text-muted-foreground" />}
          </button>
          {/* Toggle blacklist */}
          <button onClick={() => onUpdate(domain.id, { is_blacklisted: !domain.is_blacklisted })}
            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${domain.is_blacklisted ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'border-border text-muted-foreground hover:border-red-500/20 hover:text-red-400'}`}>
            {domain.is_blacklisted ? 'Blacklisted' : 'Blacklist'}
          </button>
          <EditBtn onClick={() => { setEditMode(!editMode); setSaved(false); }} />
        </div>
      </div>

      {/* Warmup bar */}
      {domain.warmup_reputation !== null && (
        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 bg-white/8 rounded-full h-1.5">
            <div className={`h-full rounded-full ${repColor}`} style={{ width: `${repVal}%` }} />
          </div>
          <span className="text-xs text-muted-foreground w-8">{repVal}%</span>
        </div>
      )}

      {editMode && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <Field label="Warmup reputation (0–100)">
            <Input type="number" value={rep} onChange={setRep} placeholder="0–100" />
          </Field>
          <SaveBar onSave={handleSave} onCancel={() => setEditMode(false)} saved={saved} />
        </div>
      )}

      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        {domain.purchase_date && <span>Purchased: {domain.purchase_date}</span>}
        {domain.exchange_date && <span>Exchange: {domain.exchange_date}</span>}
      </div>
    </div>
  );
}

// ── Lead row with inline qualification change ─────────────────

function LeadRow({ lead, onUpdateQ }: { lead: Lead; onUpdateQ: (id: string, q: LeadQualification) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [editOoo, setEditOoo]   = useState(false);
  const [saved, setSaved]       = useState(false);
  const [returnDate, setReturnDate] = useState(lead.expected_return_date ?? '');

  const cfg = Q_CONFIG[lead.qualification];

  const handleSaveOoo = () => {
    setSaved(true);
    setTimeout(() => { setSaved(false); setEditOoo(false); }, 1000);
  };

  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">{lead.full_name ?? lead.email}</p>
          <p className="text-xs text-muted-foreground">{lead.job_title ?? '—'} · {lead.company_name ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{lead.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {lead.is_ooo && (
            <button onClick={() => setEditOoo(!editOoo)}
              className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded border border-yellow-500/20">
              OOO
            </button>
          )}
          {editMode ? (
            <select value={lead.qualification} onChange={e => { onUpdateQ(lead.id, e.target.value as LeadQualification); setEditMode(false); }}
              className="text-xs bg-secondary/40 border border-primary/30 rounded-lg px-2 py-1 focus:outline-none cursor-pointer">
              {ALL_Q.map(q => <option key={q} value={q}>{Q_CONFIG[q]?.label ?? q}</option>)}
            </select>
          ) : (
            <button onClick={() => setEditMode(true)}
              className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg border ${cfg?.color ?? 'text-muted-foreground'} border-current/20 hover:opacity-80 transition-opacity`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg?.dot ?? 'bg-gray-400'}`} />
              {cfg?.label ?? lead.qualification}
              <Pencil className="w-2.5 h-2.5 opacity-60" />
            </button>
          )}
          {lead.latest_reply_at && (
            <span className="text-xs text-muted-foreground">
              {new Date(lead.latest_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
      </div>

      {editOoo && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <Field label="Expected return date">
            <Input type="date" value={returnDate} onChange={setReturnDate} />
          </Field>
          <SaveBar onSave={handleSaveOoo} onCancel={() => setEditOoo(false)} saved={saved} />
        </div>
      )}
    </div>
  );
}
