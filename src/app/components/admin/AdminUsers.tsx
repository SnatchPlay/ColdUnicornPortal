import { useState } from 'react';
import { Search, UserPlus, Check, X, Shield, Users, User, Eye, EyeOff, ToggleLeft, ToggleRight } from 'lucide-react';
import type { UserRole } from '../../data/schema';
import { mockUsers, mockClients, mockEmailExcludeList, mockAbmLostClients } from '../../data/mock';

const ROLE_CFG: Record<UserRole, { label: string; color: string; icon: typeof User }> = {
  super_admin: { label: 'Super Admin', color: 'text-red-400 bg-red-500/10 border-red-500/20',     icon: Shield },
  admin:       { label: 'Admin',       color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', icon: Shield },
  cs_manager:  { label: 'CS Manager',  color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',  icon: Users },
  client:      { label: 'Client',      color: 'text-green-400 bg-green-500/10 border-green-500/20', icon: User },
};

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

const GRAD = ['from-purple-500 to-pink-500', 'from-blue-500 to-cyan-500', 'from-orange-500 to-red-500', 'from-green-500 to-emerald-500', 'from-indigo-500 to-purple-500'];
const grad = (id: string) => GRAD[id.charCodeAt(id.length - 1) % GRAD.length];

export function AdminUsers() {
  const [users, setUsers]         = useState(mockUsers);
  const [search, setSearch]       = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [section, setSection]     = useState<'users' | 'exclude' | 'lost'>('users');
  const [excludeList, setExcludeList] = useState(mockEmailExcludeList);
  const [newDomain, setNewDomain] = useState('');

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return (
      [u.full_name, u.email, u.role].join(' ').toLowerCase().includes(q) &&
      (roleFilter === 'all' || u.role === roleFilter)
    );
  });

  const toggleActive = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, is_active: !u.is_active } : u));
  };

  const addExclude = () => {
    const d = newDomain.trim().toLowerCase();
    if (!d || excludeList.find(e => e.domain === d)) return;
    setExcludeList(prev => [...prev, { domain: d, added_by: 'user-1', created_at: new Date().toISOString() }]);
    setNewDomain('');
  };

  const removeExclude = (domain: string) => setExcludeList(prev => prev.filter(e => e.domain !== domain));

  const clientsForManager = (uid: string) => mockClients.filter(c => c.cs_manager_id === uid).length;
  const clientForUser     = (uid: string) => mockClients.find(c => mockUsers.find(u => u.id === uid)?.role === 'client' && true);

  const SECTIONS = [
    { id: 'users',   label: `Users (${users.length})` },
    { id: 'exclude', label: `Exclude List (${excludeList.length})` },
    { id: 'lost',    label: `Lost Clients (${mockAbmLostClients.length})` },
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1">Users & Settings</h1>
        <p className="text-sm text-muted-foreground">Manage users, roles and system configuration</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1 w-fit">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id as any)}
            className={`px-4 py-2 text-xs rounded-lg transition-colors ${section === s.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── USERS ── */}
      {section === 'users' && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..."
                className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)}
              className="px-3 py-2.5 bg-card border border-border rounded-xl text-sm text-muted-foreground focus:outline-none cursor-pointer">
              <option value="all">All Roles</option>
              {Object.entries(ROLE_CFG).map(([r, c]) => <option key={r} value={r}>{c.label}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            {filtered.map(u => {
              const cfg = ROLE_CFG[u.role];
              const Icon = cfg.icon;
              const clientCount = u.role === 'cs_manager' ? clientsForManager(u.id) : 0;
              return (
                <div key={u.id} className={`bg-card border border-border rounded-xl p-4 flex items-center gap-4 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <div className={`w-10 h-10 bg-gradient-to-br ${grad(u.id)} rounded-xl flex items-center justify-center text-white text-sm shrink-0`}>
                    {getInitials(u.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm">{u.full_name}</p>
                      {!u.is_active && <span className="text-xs text-muted-foreground">(inactive)</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    {clientCount > 0 && <p className="text-xs text-muted-foreground/60">{clientCount} client{clientCount > 1 ? 's' : ''} assigned</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs px-2 py-1 rounded-lg border ${cfg.color} flex items-center gap-1`}>
                      <Icon className="w-3 h-3" />{cfg.label}
                    </span>
                    <button onClick={() => toggleActive(u.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                      {u.is_active
                        ? <ToggleRight className="w-5 h-5 text-green-400" />
                        : <ToggleLeft className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Role breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(ROLE_CFG).map(([role, cfg]) => {
              const count = users.filter(u => u.role === role).length;
              if (count === 0) return null;
              const Icon = cfg.icon;
              return (
                <div key={role} className={`border rounded-xl p-4 ${cfg.color.replace('text-', 'border-').split(' ')[0].replace('border-', 'border-')}`} style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${cfg.color.split(' ')[0]}`} />
                    <span className="text-xs text-muted-foreground">{cfg.label}</span>
                  </div>
                  <p className={`text-xl ${cfg.color.split(' ')[0]}`}>{count}</p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── EMAIL EXCLUDE LIST ── */}
      {section === 'exclude' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm mb-3">Add Domain to Exclude List</h3>
            <div className="flex gap-3">
              <input
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addExclude()}
                placeholder="e.g. donotcontact.io"
                className="flex-1 px-3 py-2.5 bg-secondary/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button onClick={addExclude} className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors">
                Add
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Emails from these domains will be excluded from all campaigns globally.</p>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm">Excluded Domains ({excludeList.length})</h3>
            </div>
            <div className="divide-y divide-border/50">
              {excludeList.length === 0 && <p className="p-5 text-sm text-muted-foreground text-center">No excluded domains</p>}
              {excludeList.map(e => {
                const addedBy = mockUsers.find(u => u.id === e.added_by);
                return (
                  <div key={e.domain} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-mono">{e.domain}</p>
                      <p className="text-xs text-muted-foreground">Added by {addedBy?.full_name ?? '—'} · {new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</p>
                    </div>
                    <button onClick={() => removeExclude(e.domain)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/5 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── LOST CLIENTS (ABM) ── */}
      {section === 'lost' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Historical lost clients for ABM re-engagement tracking.</p>
          {mockAbmLostClients.map(l => (
            <div key={l.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm">{l.client_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Lost: {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                {l.return_probability && (
                  <span className={`text-xs px-2 py-1 rounded-lg border ${
                    l.return_probability.startsWith('Medium') ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                    l.return_probability.startsWith('Low')    ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-green-500/10 text-green-400 border-green-500/20'
                  }`}>{l.return_probability.split(' ')[0]}</span>
                )}
              </div>
              {l.reason_for_loss && (
                <div className="mt-3 p-3 bg-white/3 rounded-xl">
                  <p className="text-xs text-muted-foreground leading-relaxed"><span className="text-foreground">Reason: </span>{l.reason_for_loss}</p>
                </div>
              )}
              {l.return_probability && (
                <p className="text-xs text-muted-foreground mt-2">{l.return_probability}</p>
              )}
              {l.documents_link && (
                <a href={`https://${l.documents_link}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 mt-2 inline-block">
                  View Documents →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
