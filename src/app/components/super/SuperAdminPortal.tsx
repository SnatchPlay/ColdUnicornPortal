import { useState } from 'react';
import {
  Users, Shield, Globe2, Upload, ScrollText, UserCog,
  LogOut, Menu, X, ChevronDown, CheckCircle2, XCircle, Pencil, Save,
  Plus, Trash2, Eye, EyeOff, AlertTriangle, Copy,
} from 'lucide-react';
import { Logo } from '../Logo';
import {
  mockUsers, mockClients, mockClientUsers, mockAuditEvents, mockImportJobs,
} from '../../data/mock';
import type { User, UserRole } from '../../data/schema';

type SATab = 'users' | 'access' | 'integrations' | 'imports' | 'audit' | 'impersonation';

const ROLE_CFG: Record<UserRole, { label: string; color: string }> = {
  super_admin: { label: 'Super Admin', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  admin:       { label: 'Admin',       color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
  cs_manager:  { label: 'CS Manager',  color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  client:      { label: 'Client',      color: 'text-green-400 bg-green-500/10 border-green-500/20' },
};

const NAV: { id: SATab; label: string; icon: typeof Users; danger?: boolean }[] = [
  { id: 'users',         label: 'Users & Roles',           icon: Users },
  { id: 'access',        label: 'Client Access',           icon: Shield },
  { id: 'integrations',  label: 'Integrations & Secrets',  icon: Globe2 },
  { id: 'imports',       label: 'Imports & Migration',     icon: Upload },
  { id: 'audit',         label: 'Audit Logs',              icon: ScrollText },
  { id: 'impersonation', label: 'Impersonation',           icon: UserCog, danger: true },
];

const SUPER_USER = mockUsers.find(u => u.role === 'super_admin')!;

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const INTEGRATIONS = [
  { name: 'EmailBison',      key: 'BISON_API_KEY',       value: 'bsn_sk_••••••••••••••••', status: 'connected', last_tested: '2026-04-03' },
  { name: 'OpenAI',          key: 'OPENAI_API_KEY',      value: 'sk-proj-••••••••••••••••', status: 'connected', last_tested: '2026-04-03' },
  { name: 'Look4Lead',       key: 'L4L_TOKEN',           value: 'l4l_••••••••••••••••',    status: 'connected', last_tested: '2026-04-02' },
  { name: 'Snov.io',         key: 'SNOV_CLIENT_SECRET',  value: '••••••••••••••••',         status: 'connected', last_tested: '2026-04-01' },
  { name: 'Supabase',        key: 'SUPABASE_SERVICE_KEY',value: 'eyJhbGci••••••••••••••',   status: 'connected', last_tested: '2026-04-03' },
  { name: 'Webhook Secret',  key: 'WEBHOOK_SECRET',      value: 'whsec_••••••••••••••••',   status: 'connected', last_tested: '2026-04-03' },
];

export function SuperAdminPortal() {
  const [activeTab, setActiveTab]   = useState<SATab>('users');
  const [mobileOpen, setMobile]     = useState(false);
  const [users, setUsers]           = useState<User[]>(mockUsers);
  const [editUserId, setEditUser]   = useState<string | null>(null);
  const [editRole, setEditRole]     = useState<UserRole>('client');
  const [showSecrets, setSecrets]   = useState<Record<string, boolean>>({});
  const [access, setAccess]         = useState(mockClientUsers);
  const [impersonating, setImpersonating] = useState<User | null>(null);
  const [copied, setCopied]         = useState('');

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const saveUserRole = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role: editRole } : u));
    setEditUser(null);
  };

  const toggleUserActive = (id: string) =>
    setUsers(prev => prev.map(u => u.id === id ? { ...u, is_active: !u.is_active } : u));

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Sidebar */}
      <>
        <aside className="hidden lg:flex h-screen shrink-0">
          <SidebarContent activeTab={activeTab} onTabChange={setActiveTab} />
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobile(false)} />
            <div className="relative z-10 h-full">
              <SidebarContent activeTab={activeTab} onTabChange={t => { setActiveTab(t); setMobile(false); }} onClose={() => setMobile(false)} />
            </div>
          </div>
        )}
      </>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-[#0d0d0d]/95 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobile(true)} className="p-2 -ml-1 rounded-xl text-muted-foreground hover:bg-white/5">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm">{NAV.find(n => n.id === activeTab)?.label}</span>
          </div>
          <span className="text-xs text-red-400 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg">Super Admin</span>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">

            {/* ── Users & Roles ── */}
            {activeTab === 'users' && (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="mb-1">Users &amp; Roles</h1>
                    <p className="text-sm text-muted-foreground">Manage all users, roles, and activation status.</p>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-white/3">
                        {['Name','Email','Role','Status','Created','Actions'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => {
                        const roleCfg = ROLE_CFG[u.role];
                        return (
                          <tr key={u.id} className="border-b border-border/50 hover:bg-white/3 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 bg-gradient-to-br from-primary to-purple-600 rounded-full flex items-center justify-center text-white text-xs shrink-0">
                                  {getInitials(u.full_name)}
                                </div>
                                {u.full_name}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                            <td className="px-4 py-3">
                              {editUserId === u.id ? (
                                <select value={editRole} onChange={e => setEditRole(e.target.value as UserRole)}
                                  className="text-xs px-2 py-1 bg-secondary/40 border border-border rounded focus:outline-none cursor-pointer">
                                  {(['super_admin','admin','cs_manager','client'] as UserRole[]).map(r => (
                                    <option key={r} value={r}>{ROLE_CFG[r].label}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className={`text-xs px-2 py-0.5 rounded-lg border ${roleCfg.color}`}>{roleCfg.label}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs ${u.is_active ? 'text-green-400' : 'text-muted-foreground'}`}>
                                {u.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString('en-GB')}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {editUserId === u.id ? (
                                  <>
                                    <button onClick={() => saveUserRole(u.id)} className="p-1 text-green-400 hover:bg-green-500/10 rounded">
                                      <Save className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => setEditUser(null)} className="p-1 text-muted-foreground hover:bg-white/5 rounded">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => { setEditUser(u.id); setEditRole(u.role); }}
                                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded" title="Edit role">
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => toggleUserActive(u.id)}
                                      className={`p-1 rounded hover:bg-white/5 ${u.is_active ? 'text-green-400' : 'text-muted-foreground'}`}
                                      title={u.is_active ? 'Deactivate' : 'Activate'}>
                                      {u.is_active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── Client Access ── */}
            {activeTab === 'access' && (
              <>
                <div>
                  <h1 className="mb-1">Client Access Assignment</h1>
                  <p className="text-sm text-muted-foreground">Map client users to their workspaces. Invited users receive portal access for their assigned client only.</p>
                </div>
                <div className="space-y-3">
                  {mockClients.map(c => {
                    const clientAccess = access.filter(a => a.client_id === c.id);
                    return (
                      <div key={c.id} className="bg-card border border-border rounded-xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm">{c.name}</p>
                          <span className="text-xs text-muted-foreground">{clientAccess.length} user{clientAccess.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="space-y-2">
                          {clientAccess.map(ca => {
                            const user = mockUsers.find(u => u.id === ca.user_id);
                            return (
                              <div key={ca.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center text-white text-xs shrink-0">
                                    {getInitials(user?.full_name ?? '??')}
                                  </div>
                                  <div>
                                    <p>{user?.full_name ?? '—'}</p>
                                    <p className="text-muted-foreground">{user?.email}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 text-muted-foreground">
                                  {ca.accepted_at ? (
                                    <span className="text-green-400 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" />Accepted
                                    </span>
                                  ) : (
                                    <span className="text-yellow-400">Pending invite</span>
                                  )}
                                  <button onClick={() => setAccess(prev => prev.filter(a => a.id !== ca.id))}
                                    className="p-1 text-red-400 hover:bg-red-500/10 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {clientAccess.length === 0 && (
                            <p className="text-xs text-muted-foreground">No client users assigned</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Integrations ── */}
            {activeTab === 'integrations' && (
              <>
                <div>
                  <h1 className="mb-1">Integrations &amp; Secrets</h1>
                  <p className="text-sm text-muted-foreground">Global API keys and integration secrets. Visible only to Super Admins.</p>
                </div>
                <div className="p-3 bg-red-500/8 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  These secrets grant full system access. Never share outside the engineering team.
                </div>
                <div className="space-y-2">
                  {INTEGRATIONS.map(intg => {
                    const shown = showSecrets[intg.key];
                    return (
                      <div key={intg.key} className="bg-card border border-border rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm">{intg.name}</p>
                              <span className="text-xs text-green-400">● Connected</span>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono">{intg.key}</p>
                            <p className="text-xs font-mono mt-1">{shown ? 'sk-proj-real-key-would-be-here' : intg.value}</p>
                            <p className="text-xs text-muted-foreground mt-1">Last tested: {intg.last_tested}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setSecrets(p => ({ ...p, [intg.key]: !p[intg.key] }))}
                              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg">
                              {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => copy(intg.value, intg.key)}
                              className={`p-1.5 rounded-lg transition-colors ${copied === intg.key ? 'text-green-400' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}>
                              {copied === intg.key ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            <button className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-lg">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Imports ── */}
            {activeTab === 'imports' && (
              <>
                <div>
                  <h1 className="mb-1">Imports &amp; Migration</h1>
                  <p className="text-sm text-muted-foreground">Global import history, validation logs, and migration management.</p>
                </div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-white/3">
                        {['File','Type','Client','Total','OK','Failed','Status','By','Date'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mockImportJobs.map(job => {
                        const client = mockClients.find(c => c.id === job.client_id);
                        const importer = mockUsers.find(u => u.id === job.imported_by);
                        const sc = { done: 'text-green-400 bg-green-500/8 border-green-500/20', failed: 'text-red-400 bg-red-500/8 border-red-500/20', processing: 'text-blue-400 bg-blue-500/8 border-blue-500/20', pending: 'text-gray-400 bg-gray-500/8 border-gray-500/20' }[job.status];
                        return (
                          <tr key={job.id} className="border-b border-border/50 hover:bg-white/3">
                            <td className="px-4 py-3 font-mono max-w-[140px] truncate">{job.file_name}</td>
                            <td className="px-4 py-3 capitalize">{job.entity_type}</td>
                            <td className="px-4 py-3">{client?.name ?? 'Global'}</td>
                            <td className="px-4 py-3">{job.total_rows.toLocaleString()}</td>
                            <td className="px-4 py-3 text-green-400">{job.imported_rows.toLocaleString()}</td>
                            <td className="px-4 py-3 text-red-400">{job.failed_rows > 0 ? job.failed_rows : '—'}</td>
                            <td className="px-4 py-3"><span className={`text-xs px-1.5 py-0.5 rounded border ${sc}`}>{job.status}</span></td>
                            <td className="px-4 py-3 text-muted-foreground">{importer?.full_name ?? '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground">{new Date(job.created_at).toLocaleDateString('en-GB')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── Audit ── */}
            {activeTab === 'audit' && (
              <>
                <div>
                  <h1 className="mb-1">Audit Logs</h1>
                  <p className="text-sm text-muted-foreground">Full platform event history — automation triggers, user actions, and system events.</p>
                </div>
                <div className="space-y-2">
                  {mockAuditEvents.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(evt => {
                    const client  = mockClients.find(c => c.id === evt.client_id);
                    const trigger = mockUsers.find(u => u.id === evt.triggered_by);
                    const isAuto  = evt.triggered_by === 'automation';
                    return (
                      <div key={evt.id} className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${isAuto ? 'bg-purple-400' : 'bg-blue-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs">{evt.description}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isAuto ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                              {isAuto ? '🤖 automation' : `👤 ${trigger?.full_name ?? evt.triggered_by}`}
                            </span>
                            {client && <span>{client.name}</span>}
                            <span className="capitalize">{evt.event_type.replace(/_/g, ' ')}</span>
                          </div>
                          {evt.metadata && (
                            <p className="text-xs text-muted-foreground/60 mt-1 font-mono truncate">
                              {JSON.stringify(evt.metadata).slice(0, 100)}
                            </p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {new Date(evt.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Impersonation ── */}
            {activeTab === 'impersonation' && (
              <>
                <div>
                  <h1 className="mb-1">Impersonation</h1>
                  <p className="text-sm text-muted-foreground">Temporarily assume any user's identity for support and debugging.</p>
                </div>
                <div className="p-4 bg-red-500/8 border border-red-500/20 rounded-xl text-sm text-red-400">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <p>Impersonation sessions are fully logged and visible to the account owner.</p>
                  </div>
                  <p className="text-xs text-red-400/70">All actions taken during impersonation are attributed to the impersonated user in the audit log with an [impersonated] tag.</p>
                </div>
                {impersonating ? (
                  <div className="bg-yellow-500/8 border border-yellow-500/20 rounded-xl p-4">
                    <p className="text-sm text-yellow-400 mb-2">🎭 Currently impersonating: {impersonating.full_name}</p>
                    <button onClick={() => setImpersonating(null)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-sm hover:bg-red-500/20 transition-colors">
                      <XCircle className="w-4 h-4" />End Session
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mockUsers.filter(u => u.id !== 'user-0').map(u => {
                      const roleCfg = ROLE_CFG[u.role];
                      return (
                        <div key={u.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-gradient-to-br from-primary to-purple-600 rounded-full flex items-center justify-center text-white text-xs shrink-0">
                              {getInitials(u.full_name)}
                            </div>
                            <div>
                              <p className="text-sm">{u.full_name}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded-lg border ${roleCfg.color}`}>{roleCfg.label}</span>
                            <button
                              onClick={() => {
                                if (window.confirm(`Impersonate ${u.full_name}? This will be logged.`)) {
                                  setImpersonating(u);
                                }
                              }}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
                              <UserCog className="w-3.5 h-3.5" />Impersonate
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ activeTab, onTabChange, onClose }: {
  activeTab: SATab; onTabChange: (t: SATab) => void; onClose?: () => void;
}) {
  return (
    <div className="bg-[#0d0d0d] border-r border-border h-full flex flex-col" style={{ width: 240 }}>
      <div className="p-5 border-b border-border flex items-start justify-between gap-2">
        <div>
          <Logo />
          <div className="mt-4 px-1">
            <p className="text-xs text-muted-foreground">Super Admin</p>
            <p className="text-sm mt-0.5">{SUPER_USER.full_name}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="mt-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(item => {
          const Icon   = item.icon;
          const active = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => { onTabChange(item.id); onClose?.(); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${
                active
                  ? item.danger ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-primary/10 text-primary border border-primary/20'
                  : item.danger ? 'text-red-400/60 hover:bg-red-500/5 hover:text-red-400' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center text-white text-xs shrink-0">
            ŁN
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{SUPER_USER.full_name}</p>
            <p className="text-xs text-red-400">Super Admin</p>
          </div>
          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
