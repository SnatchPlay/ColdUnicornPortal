import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check, Building2, Settings2, Loader2 } from 'lucide-react';
import type { Client, ClientSetup, CrmPlatform, ClientStatus } from '../../data/schema';
import { mockUsers } from '../../data/mock';

interface Props {
  onClose: () => void;
  onCreate: (client: Client, setup: ClientSetup) => void;
}

type Step = 1 | 2;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder = '', required }: {
  value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} required={required}
      className="w-full px-3 py-2 bg-secondary/30 border border-border rounded-xl text-sm
        focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-colors"
    />
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 bg-secondary/30 border border-border rounded-xl text-sm
        focus:outline-none focus:ring-2 focus:ring-primary/25 cursor-pointer">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const STEPS: { id: Step; label: string; icon: typeof Building2 }[] = [
  { id: 1, label: 'Client Info',  icon: Building2 },
  { id: 2, label: 'Workspace',    icon: Settings2 },
];

export function NewClientModal({ onClose, onCreate }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 1 — Client basics
  const [name, setName]               = useState('');
  const [status, setStatus]           = useState<ClientStatus>('onboarding');
  const [managerId, setManagerId]     = useState('');
  const [kpiLeads, setKpiLeads]       = useState('30');
  const [kpiMeetings, setKpiMeetings] = useState('10');
  const [contractAmt, setContractAmt] = useState('');
  const [contractDue, setContractDue] = useState('');
  const [bisonWsId, setBisonWsId]     = useState('');

  // Step 2 — Workspace setup
  const [inboxes, setInboxes]       = useState('0');
  const [minSent, setMinSent]       = useState('100');
  const [prospects, setProspects]   = useState('0');
  const [crm, setCrm]               = useState<CrmPlatform>('none');
  const [ooo, setOoo]               = useState(false);

  const managers = mockUsers.filter(u => u.role === 'cs_manager' || u.role === 'admin');

  const step1Valid = name.trim().length > 0;
  const step2Valid = true;

  const handleNext = () => { if (step1Valid) setStep(2); };

  const handleCreate = async () => {
    if (!step1Valid) return;
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));

    const id = `client-${Date.now()}`;
    const now = new Date().toISOString();

    const newClient: Client = {
      id,
      organization_id: 'org-1',
      name: name.trim(),
      status,
      cs_manager_id: managerId || null,
      kpi_leads: kpiLeads ? Number(kpiLeads) : null,
      kpi_meetings: kpiMeetings ? Number(kpiMeetings) : null,
      contracted_amount: contractAmt ? Number(contractAmt) : null,
      contract_due_date: contractDue || null,
      bison_workspace_id: bisonWsId || null,
      smartlead_client_id: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };

    const newSetup: ClientSetup = {
      client_id: id,
      auto_ooo_enabled: ooo,
      min_sent_daily: Number(minSent) || 0,
      crm_platform: crm,
      crm_credentials: null,
      inboxes_count: Number(inboxes) || 0,
      prospects_in_base: Number(prospects) || 0,
      updated_at: now,
    };

    onCreate(newClient, newSetup);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#0d0d0d] border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base">New Client</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Step {step} of 2 — {STEPS[step - 1].label}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4 shrink-0">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs ${
                    active ? 'bg-primary/10 text-primary border border-primary/20' :
                    done   ? 'text-green-400'   : 'text-muted-foreground'
                  }`}>
                    {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                    {s.label}
                  </div>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── Step 1: Client basics ── */}
          {step === 1 && (
            <>
              <Field label="Company name *">
                <Input value={name} onChange={setName} placeholder="e.g. TechCorp Solutions" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select value={status} onChange={v => setStatus(v as ClientStatus)}
                    options={['onboarding','active','paused','churned','lost'].map(s => ({ value: s, label: s }))} />
                </Field>
                <Field label="CS Manager">
                  <Select value={managerId} onChange={setManagerId}
                    options={[{ value: '', label: '— Unassigned —' }, ...managers.map(m => ({ value: m.id, label: m.full_name }))]} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="MQL Target / mo">
                  <Input type="number" value={kpiLeads} onChange={setKpiLeads} placeholder="30" />
                </Field>
                <Field label="Meeting Target / mo">
                  <Input type="number" value={kpiMeetings} onChange={setKpiMeetings} placeholder="10" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Contract €/mo">
                  <Input type="number" value={contractAmt} onChange={setContractAmt} placeholder="4500" />
                </Field>
                <Field label="Contract Due Date">
                  <Input type="date" value={contractDue} onChange={setContractDue} />
                </Field>
              </div>
              <Field label="EmailBison Workspace ID" hint="Leave blank if not yet configured">
                <Input value={bisonWsId} onChange={setBisonWsId} placeholder="bison-ws-000" />
              </Field>
            </>
          )}

          {/* ── Step 2: Workspace setup ── */}
          {step === 2 && (
            <>
              <div className="p-3 bg-blue-500/8 border border-blue-500/15 rounded-xl text-xs text-blue-400">
                Configure the outreach infrastructure for this client. You can update these settings later from the client's 360° view.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inboxes count" hint="Active sending inboxes">
                  <Input type="number" value={inboxes} onChange={setInboxes} placeholder="0" />
                </Field>
                <Field label="Min emails / day">
                  <Input type="number" value={minSent} onChange={setMinSent} placeholder="100" />
                </Field>
              </div>
              <Field label="Prospects in base">
                <Input type="number" value={prospects} onChange={setProspects} placeholder="0" />
              </Field>
              <Field label="CRM Platform">
                <Select value={crm} onChange={v => setCrm(v as CrmPlatform)}
                  options={[
                    { value: 'none',       label: 'None / not connected' },
                    { value: 'pipedrive',  label: 'Pipedrive' },
                    { value: 'salesforce', label: 'Salesforce' },
                    { value: 'zoho',       label: 'Zoho CRM' },
                    { value: 'livespace',  label: 'Livespace' },
                  ]} />
              </Field>
              <Field label="OOO Routing">
                <div className="flex items-center gap-3">
                  <button onClick={() => setOoo(!ooo)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${ooo ? 'bg-primary' : 'bg-gray-600'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${ooo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-sm text-muted-foreground">{ooo ? 'Enabled' : 'Disabled'}</span>
                </div>
              </Field>

              {/* Summary */}
              <div className="mt-2 p-4 bg-white/3 border border-border rounded-xl space-y-2 text-xs">
                <p className="text-muted-foreground mb-2">Summary</p>
                {[
                  ['Company', name],
                  ['Status', status],
                  ['Manager', managers.find(m => m.id === managerId)?.full_name ?? 'Unassigned'],
                  ['MQL Target', `${kpiLeads}/mo`],
                  ['Contract', contractAmt ? `€${Number(contractAmt).toLocaleString()}/mo` : '—'],
                  ['Bison WS', bisonWsId || '—'],
                  ['Inboxes', inboxes],
                  ['Min sent/day', minSent],
                  ['CRM', crm],
                  ['OOO', ooo ? 'enabled' : 'off'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="capitalize">{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0">
          <button
            onClick={() => step === 1 ? onClose() : setStep(1)}
            className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors">
            {step === 1 ? <><X className="w-3.5 h-3.5" />Cancel</> : <><ChevronLeft className="w-3.5 h-3.5" />Back</>}
          </button>
          {step === 1 ? (
            <button onClick={handleNext} disabled={!step1Valid}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition-colors ${step1Valid ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed'}`}>
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors disabled:opacity-60">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Creating…</> : <><Check className="w-3.5 h-3.5" />Create Client</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
