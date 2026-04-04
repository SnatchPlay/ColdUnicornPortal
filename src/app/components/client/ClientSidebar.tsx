import { useEffect } from 'react';
import { LayoutDashboard, Users, TrendingUp, LogOut, Settings, X } from 'lucide-react';
import { Logo } from '../Logo';
import { mockUsers, mockClients } from '../../data/mock';

const CLIENT_USER = mockUsers.find(u => u.role === 'client')!;
const CLIENT      = mockClients[0];

export type ClientTab = 'dashboard' | 'leads' | 'analytics' | 'settings';

interface Props {
  activeTab: ClientTab;
  onTabChange: (tab: ClientTab) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const NAV: { id: ClientTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard',   icon: LayoutDashboard },
  { id: 'leads',     label: 'My Pipeline', icon: Users },
  { id: 'analytics', label: 'Analytics',   icon: TrendingUp },
];

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function SidebarContent({ activeTab, onTabChange, onClose }: {
  activeTab: ClientTab; onTabChange: (tab: ClientTab) => void; onClose?: () => void;
}) {
  const handleNav = (tab: ClientTab) => {
    onTabChange(tab);
    onClose?.();
  };

  return (
    <div className="w-60 bg-[#0d0d0d] border-r border-border h-full flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-border flex items-start justify-between gap-3">
        <div>
          <Logo />
          <div className="mt-4 px-1">
            <p className="text-xs text-muted-foreground">Client workspace</p>
            <p className="text-sm truncate mt-0.5">{CLIENT.name}</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="mt-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0 lg:hidden">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(item => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left ${
                active ? 'bg-primary/10 text-primary border border-primary/20' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
              }`}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* KPI widget */}
      <div className="mx-3 mb-3 p-3 bg-white/3 border border-border/50 rounded-lg">
        <p className="text-xs text-muted-foreground mb-2">Contract KPIs</p>
        <div className="flex justify-between text-xs">
          <div>
            <p className="text-muted-foreground">MQL target</p>
            <p className="text-foreground">{CLIENT.kpi_leads}/mo</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Meetings</p>
            <p className="text-foreground">{CLIENT.kpi_meetings}/mo</p>
          </div>
        </div>
      </div>

      {/* User footer */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs shrink-0">
            {getInitials(CLIENT_USER.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{CLIENT_USER.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{CLIENT_USER.role}</p>
          </div>
          <button onClick={() => handleNav('settings')}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${activeTab === 'settings' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}>
            <Settings className="w-4 h-4" />
          </button>
          <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientSidebar({ activeTab, onTabChange, mobileOpen, onMobileClose }: Props) {
  // Lock body scroll when mobile menu open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop sidebar — always visible on lg+ */}
      <aside className="hidden lg:flex h-screen shrink-0">
        <SidebarContent activeTab={activeTab} onTabChange={onTabChange} />
      </aside>

      {/* Mobile overlay + drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onMobileClose}
          />
          {/* Drawer slides in from left */}
          <div className="relative z-10 h-full animate-in slide-in-from-left duration-250">
            <SidebarContent activeTab={activeTab} onTabChange={onTabChange} onClose={onMobileClose} />
          </div>
        </div>
      )}
    </>
  );
}
