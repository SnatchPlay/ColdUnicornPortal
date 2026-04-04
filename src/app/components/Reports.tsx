import { useState } from 'react';
import {
  FileText, Download, Calendar, Clock, RefreshCw, Send,
  CheckCircle2, Plus, Search, AlertTriangle
} from 'lucide-react';
import { mockInvoices, mockClients } from '../data/mock';
import type { InvoiceStatus } from '../data/schema';

// ── Report templates strictly referencing DB tables ───────────

type ReportFormat = 'PDF' | 'CSV';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  tables: string[];       // actual DB table names
  fields: string[];       // actual column names from schema
  formats: ReportFormat[];
  estimatedTime: string;
}

const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'rt-1',
    name: 'Lead Pipeline Export',
    description: 'All leads with qualification status, replied_at_step, total_replies_count, latest_reply_at, campaign name',
    tables: ['leads', 'campaigns'],
    fields: ['email', 'full_name', 'job_title', 'company_name', 'gender', 'qualification', 'is_ooo', 'expected_return_date', 'replied_at_step', 'total_replies_count', 'latest_reply_at', 'campaign_id', 'created_at'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~10 sec',
  },
  {
    id: 'rt-2',
    name: 'AI Reply Classification Report',
    description: 'All lead_replies with AI classification, confidence score, reasoning, and extracted OOO dates',
    tables: ['lead_replies', 'leads'],
    fields: ['lead_id', 'direction', 'sequence_step', 'received_at', 'ai_classification', 'ai_reasoning', 'ai_confidence', 'extracted_date'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~15 sec',
  },
  {
    id: 'rt-3',
    name: 'Client Daily Snapshot Report',
    description: 'Full history of client_daily_snapshots: emails_sent_total, mql_diff, me_diff, won_diff, bounce_count, ooo_accumulated, negative_total, human_replies_total',
    tables: ['client_daily_snapshots'],
    fields: ['snapshot_date', 'inboxes_active', 'prospects_count', 'emails_sent_total', 'bounce_count', 'mql_diff', 'me_diff', 'won_diff', 'ooo_accumulated', 'negative_total', 'human_replies_total'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~20 sec',
  },
  {
    id: 'rt-4',
    name: 'Campaign Performance Report',
    description: 'Per-campaign aggregation from campaign_daily_stats: sent_count, reply_count, bounce_count, unique_open_count with calculated rates',
    tables: ['campaign_daily_stats', 'campaigns'],
    fields: ['campaign_id', 'report_date', 'sent_count', 'reply_count', 'bounce_count', 'unique_open_count'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~15 sec',
  },
  {
    id: 'rt-5',
    name: 'Domain Health Report',
    description: 'Status of all registered sending domains: warmup_reputation, is_active, is_blacklisted, purchase_date, exchange_date',
    tables: ['domains'],
    fields: ['domain_name', 'setup_email', 'purchase_date', 'exchange_date', 'warmup_reputation', 'is_active', 'is_blacklisted'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~5 sec',
  },
  {
    id: 'rt-6',
    name: 'Client Setup & KPI Report',
    description: 'Current client configuration: kpi_leads, kpi_meetings, contracted_amount, crm_platform, inboxes_count, prospects_in_base, min_sent_daily',
    tables: ['clients', 'client_setup'],
    fields: ['name', 'status', 'kpi_leads', 'kpi_meetings', 'contracted_amount', 'contract_due_date', 'crm_platform', 'inboxes_count', 'prospects_in_base', 'min_sent_daily', 'auto_ooo_enabled'],
    formats: ['PDF'],
    estimatedTime: '~10 sec',
  },
  {
    id: 'rt-7',
    name: 'Invoice History',
    description: 'All invoices from the invoices table: issue_date, amount, status, vindication_stage',
    tables: ['invoices'],
    fields: ['id', 'client_id', 'issue_date', 'amount', 'status', 'vindication_stage', 'created_at'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~5 sec',
  },
  {
    id: 'rt-8',
    name: 'OOO Processing Log',
    description: 'All leads with is_ooo=true, their expected_return_date, gender, and assigned OOO campaign from client_ooo_routing',
    tables: ['leads', 'client_ooo_routing', 'campaigns'],
    fields: ['email', 'full_name', 'gender', 'is_ooo', 'expected_return_date', 'qualification', 'campaign_id'],
    formats: ['CSV', 'PDF'],
    estimatedTime: '~8 sec',
  },
];

interface ScheduledReport {
  id: string;
  template_id: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  format: ReportFormat;
  recipients: string[];
  next_run: string;
  is_active: boolean;
}

const SCHEDULED_REPORTS: ScheduledReport[] = [
  {
    id: 'sr-1', template_id: 'rt-3', frequency: 'daily', format: 'CSV',
    recipients: ['client@techcorp.com'],
    next_run: '2026-04-04 07:00', is_active: true,
  },
  {
    id: 'sr-2', template_id: 'rt-4', frequency: 'weekly', format: 'PDF',
    recipients: ['client@techcorp.com', 'alex@gheads.io'],
    next_run: '2026-04-07 08:00 (Monday)', is_active: true,
  },
  {
    id: 'sr-3', template_id: 'rt-6', frequency: 'monthly', format: 'PDF',
    recipients: ['admin@gheads.io'],
    next_run: '2026-05-01 09:00', is_active: true,
  },
];

const invoiceStatusConfig: Record<InvoiceStatus, { label: string; color: string }> = {
  draft:   { label: 'Draft',   color: 'bg-secondary/50 text-muted-foreground' },
  sent:    { label: 'Sent',    color: 'bg-blue-500/10 text-blue-400' },
  paid:    { label: 'Paid',    color: 'bg-green-500/10 text-green-400' },
  overdue: { label: 'Overdue', color: 'bg-red-500/10 text-red-400' },
};

type Tab = 'templates' | 'scheduled' | 'invoices';

export function Reports() {
  const [tab, setTab] = useState<Tab>('templates');
  const [generating, setGenerating] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<Record<string, ReportFormat>>({});

  const handleGenerate = (templateId: string) => {
    setGenerating(templateId);
    setTimeout(() => {
      setGenerating(null);
      setGenerated(prev => [...prev, templateId]);
    }, 1800);
  };

  const filteredTemplates = REPORT_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.tables.some(tbl => tbl.toLowerCase().includes(search.toLowerCase()))
  );

  const getTemplateName = (id: string) => REPORT_TEMPLATES.find(t => t.id === id)?.name ?? id;
  const client = mockClients[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="mb-1">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Export data from DB tables. All templates map directly to schema columns.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
          <Plus className="w-4 h-4" />Custom Export
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Report Templates', value: REPORT_TEMPLATES.length, color: 'text-blue-400' },
          { label: 'Scheduled Active', value: SCHEDULED_REPORTS.filter(s => s.is_active).length, color: 'text-green-400' },
          { label: 'Invoices (total)', value: mockInvoices.length, color: 'text-purple-400' },
          { label: 'Paid Invoices', value: mockInvoices.filter(i => i.status === 'paid').length, color: 'text-emerald-400' },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground mb-2">{m.label}</p>
            <p className={`text-2xl font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
        {[
          { id: 'templates' as Tab, label: 'Report Templates' },
          { id: 'scheduled' as Tab, label: 'Scheduled' },
          { id: 'invoices' as Tab, label: 'Invoices (invoices table)' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm transition-all ${tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TEMPLATES */}
      {tab === 'templates' && (
        <div className="space-y-5">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or table..."
              className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map(t => {
              const isGen = generating === t.id;
              const isDone = generated.includes(t.id);
              const fmt = selectedFormat[t.id] ?? t.formats[0];
              return (
                <div key={t.id} className="bg-card border border-border rounded-lg p-5 hover:border-primary/20 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm pr-2">{t.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Clock className="w-3 h-3" />{t.estimatedTime}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t.description}</p>

                  {/* DB Tables */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {t.tables.map(tbl => (
                      <span key={tbl} className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded text-xs font-mono">{tbl}</span>
                    ))}
                  </div>

                  {/* Fields */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.fields.slice(0, 5).map(f => (
                      <span key={f} className="px-1.5 py-0.5 bg-secondary/40 text-muted-foreground rounded text-xs font-mono">{f}</span>
                    ))}
                    {t.fields.length > 5 && (
                      <span className="px-1.5 py-0.5 bg-secondary/40 text-muted-foreground rounded text-xs">+{t.fields.length - 5} more</span>
                    )}
                  </div>

                  {/* Format selector */}
                  <div className="flex items-center gap-2 mb-3">
                    {t.formats.map(f => (
                      <button
                        key={f}
                        onClick={() => setSelectedFormat(prev => ({ ...prev, [t.id]: f }))}
                        className={`px-2 py-0.5 rounded text-xs transition-all ${fmt === f
                          ? f === 'PDF' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'
                          : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleGenerate(t.id)}
                    disabled={isGen}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-all ${
                      isDone ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                      isGen  ? 'bg-secondary/50 text-muted-foreground cursor-not-allowed' :
                               'bg-primary text-primary-foreground hover:bg-primary/90'
                    }`}
                  >
                    {isDone ? (
                      <><CheckCircle2 className="w-4 h-4" />Download {fmt}</>
                    ) : isGen ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" />Generating...</>
                    ) : (
                      <><Download className="w-4 h-4" />Export {fmt}</>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SCHEDULED */}
      {tab === 'scheduled' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="mb-0.5">Scheduled Reports</h3>
                <p className="text-xs text-muted-foreground">Auto-generated and emailed to recipients</p>
              </div>
              <button className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 text-sm transition-colors">
                <Plus className="w-4 h-4" />Schedule New
              </button>
            </div>
            <table className="w-full">
              <thead className="bg-secondary/30">
                <tr>
                  {['Template', 'Frequency', 'Format', 'Recipients', 'Next Run', 'Active'].map(h => (
                    <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SCHEDULED_REPORTS.map(s => (
                  <tr key={s.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{getTemplateName(s.template_id)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`text-sm capitalize ${
                        s.frequency === 'daily' ? 'text-green-400' :
                        s.frequency === 'weekly' ? 'text-blue-400' : 'text-purple-400'
                      }`}>{s.frequency}</span>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.format === 'PDF' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                        {s.format}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="space-y-0.5">
                        {s.recipients.map(r => (
                          <p key={r} className="text-xs text-muted-foreground">{r}</p>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />{s.next_run}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs ${s.is_active ? 'text-green-400' : 'text-red-400'}`}>
                        {String(s.is_active)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INVOICES — from invoices table */}
      {tab === 'invoices' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="mb-0.5">invoices table</h3>
            <p className="text-xs text-muted-foreground">
              Fields: id, client_id, issue_date, amount, status, vindication_stage · Client: <span className="text-foreground">{client?.name}</span>
            </p>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-3 gap-3 p-4 border-b border-border">
            {[
              { label: 'Total Invoiced', value: `$${mockInvoices.reduce((a, i) => a + i.amount, 0).toLocaleString()}`, color: 'text-foreground' },
              { label: 'Paid', value: `$${mockInvoices.filter(i => i.status === 'paid').reduce((a, i) => a + i.amount, 0).toLocaleString()}`, color: 'text-green-400' },
              { label: 'Overdue', value: mockInvoices.filter(i => i.status === 'overdue').length, color: 'text-red-400' },
            ].map(m => (
              <div key={m.label} className="bg-secondary/20 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                <p className={`text-lg font-semibold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          <table className="w-full">
            <thead className="bg-secondary/30">
              <tr>
                {['id', 'client_id', 'issue_date', 'amount', 'status', 'vindication_stage', 'created_at', ''].map(h => (
                  <th key={h} className="text-left p-3 text-xs text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mockInvoices.map(inv => {
                const scfg = invoiceStatusConfig[inv.status];
                return (
                  <tr key={inv.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="p-3 text-xs text-muted-foreground font-mono">{inv.id}</td>
                    <td className="p-3 text-xs text-muted-foreground font-mono">{inv.client_id}</td>
                    <td className="p-3 text-sm">{inv.issue_date}</td>
                    <td className="p-3 text-sm">${inv.amount.toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${scfg.color}`}>{scfg.label}</span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.vindication_stage ?? '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{inv.created_at.split('T')[0]}</td>
                    <td className="p-3">
                      <button className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 rounded text-xs hover:bg-primary/20 transition-colors">
                        <Download className="w-3 h-3" />PDF
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