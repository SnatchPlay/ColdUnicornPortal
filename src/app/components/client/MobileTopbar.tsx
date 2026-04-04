import { Menu, Settings } from 'lucide-react';
import { Logo } from '../Logo';
import type { ClientTab } from './ClientSidebar';

interface Props {
  activeTab: ClientTab;
  onMenuOpen: () => void;
  onSettings: () => void;
}

const PAGE_LABELS: Record<ClientTab, string> = {
  dashboard: 'Dashboard',
  leads:     'My Pipeline',
  analytics: 'Analytics',
  settings:  'Settings',
};

export function MobileTopbar({ activeTab, onMenuOpen, onSettings }: Props) {
  return (
    <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-[#0d0d0d]/95 backdrop-blur-md border-b border-border">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="h-5 w-px bg-border" />
        <Logo />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{PAGE_LABELS[activeTab]}</span>
        <button
          onClick={onSettings}
          className={`p-2 rounded-xl transition-colors ${
            activeTab === 'settings'
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
          }`}
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
