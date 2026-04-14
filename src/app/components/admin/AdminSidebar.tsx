import { useEffect } from 'react';
import { LayoutDashboard, Users, GitBranch, Trello, Settings, LogOut, X,
  UserCheck, DollarSign, Bot, TrendingUp } from 'lucide-react';
import { Logo } from '../Logo';
import { mockUsers } from '../../data/mock';

const ADMIN_USER = mockUsers.find(u => u.role === 'admin')!;

export type AdminTab = 'overview' | 'clients' | 'crm' | 'lg-pipeline' | 'pdca' | 'finance' | 'automation' | 'users';

interface Props {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const NAV: { id: AdminTab; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { id: 'overview',    label: 'Agency Overview', icon: LayoutDashboard },
  { id: 'clients',     label: 'Clients & 360°',  icon: UserCheck },
  { id: 'pdca',        label: 'PDCA Matrix',      icon: GitBranch },
  { id: 'automation',  label: 'Automation Ops',   icon: Bot },
  { id: 'crm',         label: 'Agency CRM',       icon: Trello },
  { id: 'lg-pipeline', label: 'LG Pipeline',      icon: TrendingUp },
  { id: 'finance',     label: 'Finance',          icon: DollarSign },
  { id: 'users',       label: 'Users',            icon: Users },
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function SidebarContent({ activeTab, onTabChange, onClose }: {
  activeTab: AdminTab; onTabChange: (tab: AdminTab) => void; onClose?: () => void;
}) {
  const handleNav = (tab: AdminTab) => { onTabChange(tab); onClose?.(); };

  return (
    <div className="w-62 bg-[#0d0d0d] border-r border-border h-full flex flex-col" style={{ width: 240 }}>
      <div className="p-5 border-b border-border flex items-start justify-between gap-2">
        <div>
          <Logo />
          <div className="mt-4 px-1">
            <p className="text-xs text-muted-foreground">Admin Portal</p>
            <p className="text-sm mt-0.5">GHEADS Agency</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="mt-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const Icon   = item.icon;
          const active = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${active ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'}`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm flex-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center text-white text-xs shrink-0">
            {getInitials(ADMIN_USER.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{ADMIN_USER.full_name}</p>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminSidebar({ activeTab, onTabChange, mobileOpen, onMobileClose }: Props) {
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
