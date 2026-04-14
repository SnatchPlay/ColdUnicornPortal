import { useEffect } from 'react';
import { LayoutDashboard, Users, GitBranch, UserCheck, LogOut, X, HeartPulse, Bot } from 'lucide-react';
import { Logo } from '../Logo';
import { mockUsers, mockClients, mockClientIssues } from '../../data/mock';

const MANAGER_USER = mockUsers.find(u => u.role === 'cs_manager' && u.id === 'user-2')!;

export type ManagerTab = 'dashboard' | 'clients' | 'leads' | 'pdca' | 'health' | 'automation';

interface Props {
  activeTab: ManagerTab;
  onTabChange: (tab: ManagerTab) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const NAV: { id: ManagerTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard',  label: 'My Dashboard',    icon: LayoutDashboard },
  { id: 'clients',    label: 'Client 360°',     icon: UserCheck },
  { id: 'leads',      label: 'Leads Workspace', icon: Users },
  { id: 'pdca',       label: 'PDCA',            icon: GitBranch },
  { id: 'health',     label: 'Health & Issues', icon: HeartPulse },
  { id: 'automation', label: 'Automation Inbox',icon: Bot },
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function SidebarContent({ activeTab, onTabChange, onClose }: {
  activeTab: ManagerTab; onTabChange: (tab: ManagerTab) => void; onClose?: () => void;
}) {
  const myClients    = mockClients.filter(c => c.cs_manager_id === MANAGER_USER.id);
  const myClientIds  = myClients.map(c => c.id);
  const openIssues   = mockClientIssues.filter(i => myClientIds.includes(i.client_id) && ['open','in_progress'].includes(i.status)).length;
  const handleNav    = (tab: ManagerTab) => { onTabChange(tab); onClose?.(); };

  return (
    <div className="bg-[#0d0d0d] border-r border-border h-full flex flex-col" style={{ width: 240 }}>
      <div className="p-5 border-b border-border flex items-start justify-between gap-2">
        <div>
          <Logo />
          <div className="mt-4 px-1">
            <p className="text-xs text-muted-foreground">CS Manager</p>
            <p className="text-sm mt-0.5">{MANAGER_USER.full_name}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="mt-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(item => {
          const Icon   = item.icon;
          const active = activeTab === item.id;
          const badge  = item.id === 'health' ? openIssues : 0;
          return (
            <button key={item.id} onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${active ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'}`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm flex-1">{item.label}</span>
              {badge > 0 && (
                <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* My clients mini-list */}
      <div className="mx-3 mb-3 p-3 bg-white/3 border border-border/50 rounded-lg">
        <p className="text-xs text-muted-foreground mb-2">My Clients ({myClients.length})</p>
        <div className="space-y-1.5">
          {myClients.map(c => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-green-400' : c.status === 'onboarding' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
              <span className="truncate text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white text-xs shrink-0">
            {getInitials(MANAGER_USER.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{MANAGER_USER.full_name}</p>
            <p className="text-xs text-muted-foreground">CS Manager</p>
          </div>
          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManagerSidebar({ activeTab, onTabChange, mobileOpen, onMobileClose }: Props) {
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <>
      <aside className="hidden lg:flex h-screen shrink-0">
        <SidebarContent activeTab={activeTab} onTabChange={onTabChange} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative z-10 h-full animate-in slide-in-from-left duration-250">
            <SidebarContent activeTab={activeTab} onTabChange={onTabChange} onClose={onMobileClose} />
          </div>
        </div>
      )}
    </>
  );
}
