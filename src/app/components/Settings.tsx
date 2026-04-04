import { useState } from 'react';
import {
  User, Bell, Shield, Link2, Users, CreditCard, Key,
  CheckCircle2, X, Plus, Trash2, Eye, EyeOff, Copy,
  Save, AlertTriangle, LogOut, Lock, Upload, ExternalLink
} from 'lucide-react';
import {
  mockUsers, mockClients, mockClientSetup,
  mockDomains, mockInvoices, mockEmailExcludeList
} from '../data/mock';
import type { UserRole, ClientStatus, HealthStatus } from '../data/schema';

type SettingsSection = 'client' | 'team' | 'domains' | 'notifications' | 'security' | 'billing' | 'api';

const SECTIONS: { id: SettingsSection; label: string; icon: React.ReactNode; table: string }[] = [
  { id: 'client',        label: 'Client & Setup',      icon: <User className="w-4 h-4" />,       table: 'clients + client_setup' },
  { id: 'team',          label: 'Team (users)',         icon: <Users className="w-4 h-4" />,      table: 'users + client_users' },
  { id: 'domains',       label: 'Domains',             icon: <Link2 className="w-4 h-4" />,      table: 'domains' },
  { id: 'notifications', label: 'Notifications',       icon: <Bell className="w-4 h-4" />,       table: 'client_setup' },
  { id: 'security',      label: 'Security',            icon: <Shield className="w-4 h-4" />,     table: 'users' },
  { id: 'billing',       label: 'Billing (invoices)',  icon: <CreditCard className="w-4 h-4" />, table: 'invoices + clients' },
  { id: 'api',           label: 'API / Exclude List',  icon: <Key className="w-4 h-4" />,        table: 'email_exclude_list' },
];

const roleColors: Record<UserRole, string> = {
  super_admin: 'bg-red-500/10 text-red-400 border-red-500/20',
  admin:       'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cs_manager:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  client:      'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const clientStatusColors: Record<ClientStatus, string> = {
  onboarding: 'bg-blue-500/10 text-blue-400',
  active:     'bg-green-500/10 text-green-400',
  paused:     'bg-yellow-500/10 text-yellow-400',
  churned:    'bg-orange-500/10 text-orange-400',
  lost:       'bg-red-500/10 text-red-400',
};

const healthColors: Record<HealthStatus, string> = {
  green:   'bg-green-500 text-white',
  yellow:  'bg-yellow-500 text-black',
  red:     'bg-red-500 text-white',
  unknown: 'bg-secondary text-muted-foreground',
};

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SavedBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg shadow-xl">
      <CheckCircle2 className="w-4 h-4" />
      <span className="text-sm">Changes saved</span>
    </div>
  );
}

export function Settings() {
  const [section, setSection] = useState<SettingsSection>('client');
  const [saved, setSaved] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [autoOoo, setAutoOoo] = useState(mockClientSetup[0]?.auto_ooo_enabled ?? true);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const client = mockClients[0];
  const setup = mockClientSetup[0];

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const AVATAR_GRADS = ['from-purple-500 to-pink-500', 'from-blue-500 to-cyan-500', 'from-green-500 to-emerald-500', 'from-orange-500 to-red-500'];

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="mb-1">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage data across DB tables — all fields map directly to schema</p>
        </div>

        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-56 shrink-0">
            <nav className="space-y-0.5">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`w-full flex flex-col items-start px-3 py-2.5 rounded-lg transition-all text-left ${
                    section === s.id
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm">
                    {s.icon}{s.label}
                  </div>
                  <span className="text-xs text-muted-foreground/60 font-mono pl-6 mt-0.5">{s.table}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* CLIENT & SETUP */}
            {section === 'client' && (
              <div className="space-y-4">
                {/* clients table */}
                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <h3>clients table</h3>
                    {client && <span className={`text-xs px-2 py-0.5 rounded capitalize ${clientStatusColors[client.status]}`}>{client.status}</span>}
                  </div>
                  {client && (
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: 'name',              value: client.name,                 editable: true },
                        { label: 'status',            value: client.status,               editable: false },
                        { label: 'kpi_leads',         value: String(client.kpi_leads ?? '—'), editable: true },
                        { label: 'kpi_meetings',      value: String(client.kpi_meetings ?? '—'), editable: true },
                        { label: 'contracted_amount', value: client.contracted_amount ? `$${client.contracted_amount.toFixed(2)}` : '—', editable: true },
                        { label: 'contract_due_date', value: client.contract_due_date ?? '—', editable: true },
                        { label: 'bison_workspace_id', value: client.bison_workspace_id ?? 'null', editable: true },
                        { label: 'smartlead_client_id', value: client.smartlead_client_id ?? 'null', editable: true },
                      ].map(({ label, value, editable }) => (
                        <div key={label}>
                          <label className="text-xs text-muted-foreground font-mono block mb-1">{label}</label>
                          {editable ? (
                            <input
                              defaultValue={value}
                              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          ) : (
                            <div className="px-3 py-2 bg-secondary/20 border border-border/50 rounded-md text-sm text-muted-foreground capitalize">{value}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* client_setup table */}
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-4">client_setup table</h3>
                  {setup && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { label: 'min_sent_daily',    value: String(setup.min_sent_daily) },
                          { label: 'inboxes_count',     value: String(setup.inboxes_count) },
                          { label: 'prospects_in_base', value: String(setup.prospects_in_base) },
                          { label: 'crm_platform',      value: setup.crm_platform ?? 'none' },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <label className="text-xs text-muted-foreground font-mono block mb-1">{label}</label>
                            <input
                              defaultValue={value}
                              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg">
                        <div>
                          <p className="text-sm">auto_ooo_enabled</p>
                          <p className="text-xs text-muted-foreground">Automatically re-engage OOO leads on expected_return_date</p>
                        </div>
                        <Toggle on={autoOoo} onChange={setAutoOoo} />
                      </div>

                      {setup.crm_credentials && (
                        <div>
                          <label className="text-xs text-muted-foreground font-mono block mb-1">crm_credentials (JSONB — masked)</label>
                          <div className="px-3 py-2 bg-secondary/20 border border-border/50 rounded-md text-sm font-mono text-muted-foreground">
                            {'{ "api_key": "***", "company_domain": "***" }'}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
                    <Save className="w-4 h-4" />Save Changes
                  </button>
                </div>
              </div>
            )}

            {/* TEAM — users table */}
            {section === 'team' && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3>users table</h3>
                      <p className="text-xs text-muted-foreground">Fields: id, email, full_name, role, is_active, organization_id</p>
                    </div>
                    <button className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 text-sm transition-colors">
                      <Plus className="w-4 h-4" />Invite User
                    </button>
                  </div>

                  <div className="space-y-2">
                    {mockUsers.map((user, i) => (
                      <div key={user.id} className="flex items-center gap-3 p-3 bg-secondary/20 rounded-lg">
                        <div className={`w-9 h-9 bg-gradient-to-br ${AVATAR_GRADS[i % AVATAR_GRADS.length]} rounded-lg flex items-center justify-center text-white text-xs shrink-0`}>
                          {getInitials(user.full_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm truncate">{user.full_name}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${roleColors[user.role]}`}>{user.role}</span>
                            {!user.is_active && <span className="text-xs px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">inactive</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground font-mono">is_active: <span className={user.is_active ? 'text-green-400' : 'text-red-400'}>{String(user.is_active)}</span></p>
                          <select defaultValue={user.role} className="text-xs bg-secondary/50 border border-border rounded px-2 py-1 focus:outline-none mt-1">
                            <option value="super_admin">super_admin</option>
                            <option value="admin">admin</option>
                            <option value="cs_manager">cs_manager</option>
                            <option value="client">client</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Role permission matrix */}
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-4">Role Permissions (user_role ENUM)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 text-muted-foreground">Permission</th>
                          {(['super_admin', 'admin', 'cs_manager', 'client'] as UserRole[]).map(r => (
                            <th key={r} className="text-center py-2 text-muted-foreground font-mono">{r}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {[
                          ['View dashboard + analytics', true, true, true, true],
                          ['View leads (preMQL+)', true, true, true, true],
                          ['Edit lead qualification', true, true, true, true],
                          ['Manage campaigns', true, true, true, false],
                          ['View all clients', true, true, false, false],
                          ['Export reports', true, true, true, false],
                          ['Manage users', true, true, false, false],
                          ['Manage billing / invoices', true, true, false, false],
                          ['API key management', true, false, false, false],
                          ['email_exclude_list admin', true, true, false, false],
                        ].map(([label, ...perms]) => (
                          <tr key={String(label)} className="hover:bg-secondary/10">
                            <td className="py-2.5">{String(label)}</td>
                            {perms.map((has, i) => (
                              <td key={i} className="text-center py-2.5">
                                {has ? <Check className="w-4 h-4 text-green-400 mx-auto" /> : <X className="w-4 h-4 text-muted-foreground mx-auto" />}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* DOMAINS table */}
            {section === 'domains' && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-border">
                    <h3 className="mb-0.5">domains table</h3>
                    <p className="text-xs text-muted-foreground">
                      Fields: domain_name, setup_email, purchase_date, exchange_date, warmup_reputation (0–100), is_active, is_blacklisted
                    </p>
                  </div>
                  <table className="w-full">
                    <thead className="bg-secondary/30">
                      <tr>
                        {['domain_name', 'setup_email', 'purchase_date', 'exchange_date', 'warmup_reputation', 'is_active', 'is_blacklisted'].map(h => (
                          <th key={h} className="text-left p-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mockDomains.map(d => (
                        <tr key={d.id} className={`hover:bg-secondary/10 transition-colors ${d.is_blacklisted ? 'opacity-60' : ''}`}>
                          <td className="p-3 text-sm font-mono">{d.domain_name}</td>
                          <td className="p-3 text-xs text-muted-foreground">{d.setup_email ?? '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{d.purchase_date ?? '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">{d.exchange_date ?? '—'}</td>
                          <td className="p-3">
                            {d.warmup_reputation !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-secondary/60 rounded-full h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full ${d.warmup_reputation >= 80 ? 'bg-green-500' : d.warmup_reputation >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                    style={{ width: `${d.warmup_reputation}%` }}
                                  />
                                </div>
                                <span className={`text-xs ${d.warmup_reputation >= 80 ? 'text-green-400' : d.warmup_reputation >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {d.warmup_reputation}%
                                </span>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="p-3">
                            <span className={`text-xs ${d.is_active ? 'text-green-400' : 'text-red-400'}`}>{String(d.is_active)}</span>
                          </td>
                          <td className="p-3">
                            <span className={`text-xs ${d.is_blacklisted ? 'text-red-400' : 'text-green-400'}`}>{String(d.is_blacklisted)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* NOTIFICATIONS — client_setup fields */}
            {section === 'notifications' && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-1">Notification Settings</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Stored in <code className="bg-secondary/50 px-1 rounded">client_setup</code> and user preferences
                  </p>

                  {/* min_sent_daily alert threshold */}
                  <div className="p-4 bg-secondary/20 rounded-lg mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm">Daily Send KPI Alert</p>
                        <p className="text-xs text-muted-foreground font-mono">client_setup.min_sent_daily = {setup?.min_sent_daily ?? 0}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded">Active</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Alert fires when daily sent emails fall below <strong>{setup?.min_sent_daily}</strong>. Data source: <code className="bg-secondary/50 px-1 rounded">client_daily_snapshots.emails_sent_total</code>
                    </p>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: 'New MQL (mql_diff > 0)', sub: 'Trigger: client_daily_snapshots.mql_diff', email: true, slack: true },
                      { label: 'New Meeting (me_diff > 0)', sub: 'Trigger: client_daily_snapshots.me_diff', email: true, slack: true },
                      { label: 'Won Deal (won_diff > 0)', sub: 'Trigger: client_daily_snapshots.won_diff', email: true, slack: true },
                      { label: 'Bounce Rate > 3%', sub: 'Trigger: campaign_daily_stats.bounce_count / sent_count', email: true, slack: true },
                      { label: 'OOO Lead Return', sub: 'Trigger: leads.expected_return_date = CURRENT_DATE', email: false, slack: true },
                      { label: 'AI confidence < 0.85', sub: 'Trigger: lead_replies.ai_confidence < 0.85', email: false, slack: true },
                    ].map((n, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm">{n.label}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{n.sub}</p>
                        </div>
                        <div className="flex items-center gap-4 ml-4">
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground mb-1">Email</p>
                            <Toggle on={n.email} onChange={() => {}} />
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground mb-1">Slack</p>
                            <Toggle on={n.slack} onChange={() => {}} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm">
                    <Save className="w-4 h-4" />Save
                  </button>
                </div>
              </div>
            )}

            {/* SECURITY — users fields */}
            {section === 'security' && (
              <div className="space-y-4">
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-4">Change Password</h3>
                  <p className="text-xs text-muted-foreground mb-4">Managed via Supabase Auth — updates <code className="bg-secondary/50 px-1 rounded">auth.users</code></p>
                  <div className="space-y-3 max-w-sm">
                    {['Current Password', 'New Password', 'Confirm New Password'].map(label => (
                      <div key={label}>
                        <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                        <input type="password" placeholder="••••••••"
                          className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                    ))}
                    <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm">
                      <Lock className="w-4 h-4" />Update Password
                    </button>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="mb-0.5">users.is_active</h3>
                      <p className="text-xs text-muted-foreground">Current session user — auth managed by Supabase RLS</p>
                    </div>
                    <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />is_active: true
                    </span>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: 'id',              value: mockUsers[0].id,           mono: true },
                      { label: 'email',           value: mockUsers[0].email,        mono: false },
                      { label: 'full_name',       value: mockUsers[0].full_name,    mono: false },
                      { label: 'role',            value: mockUsers[0].role,         mono: false },
                      { label: 'organization_id', value: mockUsers[0].organization_id ?? 'null', mono: true },
                    ].map(({ label, value, mono }) => (
                      <div key={label} className="flex justify-between py-2 border-b border-border/40 last:border-0">
                        <span className="text-xs text-muted-foreground font-mono">{label}</span>
                        <span className={`text-xs ${mono ? 'font-mono text-muted-foreground' : ''}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* BILLING — clients + invoices */}
            {section === 'billing' && (
              <div className="space-y-4">
                {/* Client contract */}
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-1">Contract (clients table)</h3>
                  <p className="text-xs text-muted-foreground mb-4">contracted_amount, kpi_leads, kpi_meetings, contract_due_date</p>
                  {client && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'contracted_amount', value: `$${client.contracted_amount?.toLocaleString() ?? '—'}/mo`, color: 'text-green-400' },
                        { label: 'kpi_leads',         value: `${client.kpi_leads ?? '—'} leads/mo`, color: 'text-blue-400' },
                        { label: 'kpi_meetings',      value: `${client.kpi_meetings ?? '—'} meetings/mo`, color: 'text-purple-400' },
                        { label: 'contract_due_date', value: client.contract_due_date ?? '—', color: 'text-foreground' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-secondary/20 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground font-mono mb-1">{label}</p>
                          <p className={`text-sm ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* invoices table */}
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-border">
                    <h3>invoices table</h3>
                    <p className="text-xs text-muted-foreground">id, client_id, issue_date, amount, status (draft|sent|paid|overdue), vindication_stage</p>
                  </div>
                  <table className="w-full">
                    <thead className="bg-secondary/30">
                      <tr>
                        {['id', 'issue_date', 'amount', 'status', 'vindication_stage'].map(h => (
                          <th key={h} className="text-left p-3 text-xs text-muted-foreground font-mono">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mockInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-secondary/10 transition-colors">
                          <td className="p-3 text-xs text-muted-foreground font-mono">{inv.id}</td>
                          <td className="p-3 text-sm">{inv.issue_date}</td>
                          <td className="p-3 text-sm">${inv.amount.toLocaleString()}</td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              inv.status === 'paid'    ? 'bg-green-500/10 text-green-400' :
                              inv.status === 'overdue' ? 'bg-red-500/10 text-red-400' :
                              inv.status === 'sent'    ? 'bg-blue-500/10 text-blue-400' :
                              'bg-secondary/50 text-muted-foreground'
                            }`}>{inv.status}</span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">{inv.vindication_stage ?? 'null'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* API — email_exclude_list */}
            {section === 'api' && (
              <div className="space-y-4">
                {/* Simulated API key */}
                <div className="bg-card border border-border rounded-lg p-6">
                  <h3 className="mb-1">API Key</h3>
                  <p className="text-xs text-muted-foreground mb-4">Used for webhook authentication with Make.com and Supabase Edge Functions</p>
                  <div className="flex items-center gap-2 mb-3">
                    <code className="flex-1 text-xs bg-black/30 px-3 py-2 rounded text-green-400 font-mono">
                      {showApiKey ? 'gh_live_sk_a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5' : 'gh_live_sk_••••••••••••••••••••••••••••••••'}
                    </code>
                    <button onClick={() => setShowApiKey(!showApiKey)} className="text-muted-foreground hover:text-foreground transition-colors p-2">
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={() => navigator.clipboard.writeText('gh_live_sk_a8f3b2c1d4e5f6a7b8c9d0e1f2a3b4c5')} className="text-muted-foreground hover:text-foreground transition-colors p-2">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Used in webhook headers from Bison/Smartlead → Make.com → Supabase. Rotate immediately if compromised.</p>
                </div>

                {/* email_exclude_list table */}
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div>
                      <h3>email_exclude_list table</h3>
                      <p className="text-xs text-muted-foreground">Fields: domain (PK), added_by (user_id FK), created_at. Blocks all outreach to matching domains.</p>
                    </div>
                    <button className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 text-sm transition-colors">
                      <Plus className="w-4 h-4" />Add Domain
                    </button>
                  </div>

                  {mockEmailExcludeList.length > 0 ? (
                    <table className="w-full">
                      <thead className="bg-secondary/30">
                        <tr>
                          {['domain (PK)', 'added_by', 'created_at', ''].map(h => (
                            <th key={h} className="text-left p-3 text-xs text-muted-foreground font-mono">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {mockEmailExcludeList.map(item => {
                          const adder = mockUsers.find(u => u.id === item.added_by);
                          return (
                            <tr key={item.domain} className="hover:bg-secondary/10 transition-colors">
                              <td className="p-3 text-sm font-mono text-red-400">{item.domain}</td>
                              <td className="p-3 text-sm text-muted-foreground">{adder?.full_name ?? item.added_by ?? '—'}</td>
                              <td className="p-3 text-xs text-muted-foreground">{item.created_at.split('T')[0]}</td>
                              <td className="p-3">
                                <button className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-muted-foreground text-sm">No excluded domains</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <SavedBanner visible={saved} />
    </>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
