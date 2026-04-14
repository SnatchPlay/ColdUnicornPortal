import { useState } from 'react';
import { Menu, ChevronDown } from 'lucide-react';

// Client
import { ClientSidebar } from './components/client/ClientSidebar';
import type { ClientTab } from './components/client/ClientSidebar';
import { MobileTopbar } from './components/client/MobileTopbar';
import { ClientDashboard } from './components/client/ClientDashboard';
import { ClientLeads } from './components/client/ClientLeads';
import { ClientAnalytics } from './components/client/ClientAnalytics';
import { ClientSettings } from './components/client/ClientSettings';

// Admin
import { AdminSidebar } from './components/admin/AdminSidebar';
import type { AdminTab } from './components/admin/AdminSidebar';
import { AdminOverview } from './components/admin/AdminOverview';
import { AdminClients } from './components/admin/AdminClients';
import { AdminCRM } from './components/admin/AdminCRM';
import { AdminPDCA } from './components/admin/AdminPDCA';
import { AdminUsers } from './components/admin/AdminUsers';
import { AdminFinance } from './components/admin/AdminFinance';
import { AdminAutomation } from './components/admin/AdminAutomation';
import { AdminLgPipeline } from './components/admin/AdminLgPipeline';

// Manager
import { ManagerSidebar } from './components/manager/ManagerSidebar';
import type { ManagerTab } from './components/manager/ManagerSidebar';
import { ManagerDashboard } from './components/manager/ManagerDashboard';
import { ManagerClients } from './components/manager/ManagerClients';
import { ManagerLeads } from './components/manager/ManagerLeads';
import { ManagerPDCA } from './components/manager/ManagerPDCA';
import { ManagerHealth } from './components/manager/ManagerHealth';
import { ManagerAutomation } from './components/manager/ManagerAutomation';

// Super Admin
import { SuperAdminPortal } from './components/super/SuperAdminPortal';

type Role = 'client' | 'cs_manager' | 'admin' | 'super_admin';

const ROLE_LABELS: Record<Role, { label: string; color: string }> = {
  client:      { label: 'Client Portal', color: 'text-green-400 border-green-500/20 bg-green-500/8' },
  cs_manager:  { label: 'CS Manager',    color: 'text-blue-400 border-blue-500/20 bg-blue-500/8' },
  admin:       { label: 'Admin',         color: 'text-orange-400 border-orange-500/20 bg-orange-500/8' },
  super_admin: { label: 'Super Admin',   color: 'text-red-400 border-red-500/20 bg-red-500/8' },
};

function RoleSwitcher({ role, onSwitch }: { role: Role; onSwitch: (r: Role) => void }) {
  const [open, setOpen] = useState(false);
  const cfg = ROLE_LABELS[role];
  return (
    <div className="fixed bottom-5 right-5 z-[9999]">
      <div className="relative">
        {open && (
          <div className="absolute bottom-full right-0 mb-2 bg-[#181818] border border-border rounded-xl shadow-2xl overflow-hidden min-w-[190px]">
            <p className="text-xs text-muted-foreground px-3 py-2 border-b border-border">Switch role (demo)</p>
            {(Object.entries(ROLE_LABELS) as [Role, typeof ROLE_LABELS[Role]][]).map(([r, c]) => (
              <button key={r} onClick={() => { onSwitch(r); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs hover:bg-white/5 transition-colors text-left ${role === r ? 'bg-white/5' : ''}`}>
                <span className={`px-2 py-0.5 rounded border text-xs ${c.color}`}>{c.label}</span>
                {role === r && <span className="ml-auto text-primary text-xs">active</span>}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => setOpen(!open)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs shadow-xl backdrop-blur-sm ${cfg.color}`}>
          <span>{cfg.label}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

// ── Client layout ─────────────────────────────────────────────
function ClientApp() {
  const [activeTab, setActiveTab] = useState<ClientTab>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleTab = (tab: ClientTab) => { setActiveTab(tab); setMobileOpen(false); };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <ClientSidebar activeTab={activeTab} onTabChange={handleTab} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopbar activeTab={activeTab} onMenuOpen={() => setMobileOpen(true)} onSettings={() => handleTab('settings')} />
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
            {activeTab === 'dashboard' && <ClientDashboard />}
            {activeTab === 'leads'     && <ClientLeads />}
            {activeTab === 'analytics' && <ClientAnalytics />}
            {activeTab === 'settings'  && <ClientSettings />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Admin layout ──────────────────────────────────────────────
function AdminApp() {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleTab = (tab: AdminTab) => { setActiveTab(tab); setMobileOpen(false); };

  const PAGE_LABELS: Record<AdminTab, string> = {
    overview: 'Agency Overview', clients: 'Clients & 360°', crm: 'Agency CRM',
    'lg-pipeline': 'LG Pipeline', pdca: 'PDCA Matrix', finance: 'Finance',
    automation: 'Automation Ops', users: 'Users',
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <AdminSidebar activeTab={activeTab} onTabChange={handleTab} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-[#0d0d0d]/95 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="p-2 -ml-1 rounded-xl text-muted-foreground hover:bg-white/5 transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm">{PAGE_LABELS[activeTab]}</span>
          </div>
          <span className="text-xs text-orange-400 px-2 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg">Admin</span>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            {activeTab === 'overview'     && <AdminOverview />}
            {activeTab === 'clients'      && <AdminClients />}
            {activeTab === 'crm'          && <AdminCRM />}
            {activeTab === 'lg-pipeline'  && <AdminLgPipeline />}
            {activeTab === 'pdca'         && <AdminPDCA />}
            {activeTab === 'finance'      && <AdminFinance />}
            {activeTab === 'automation'   && <AdminAutomation />}
            {activeTab === 'users'        && <AdminUsers />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Manager layout ────────────────────────────────────────────
function ManagerApp() {
  const [activeTab, setActiveTab] = useState<ManagerTab>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleTab = (tab: ManagerTab) => { setActiveTab(tab); setMobileOpen(false); };

  const PAGE_LABELS: Record<ManagerTab, string> = {
    dashboard:  'My Dashboard',
    clients:    'Client 360°',
    leads:      'Leads Workspace',
    pdca:       'PDCA',
    health:     'Health & Issues',
    automation: 'Automation Inbox',
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground">
      <ManagerSidebar activeTab={activeTab} onTabChange={handleTab} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-[#0d0d0d]/95 backdrop-blur-md border-b border-border">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="p-2 -ml-1 rounded-xl text-muted-foreground hover:bg-white/5 transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm">{PAGE_LABELS[activeTab]}</span>
          </div>
          <span className="text-xs text-blue-400 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">CS Manager</span>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
            {activeTab === 'dashboard'  && <ManagerDashboard />}
            {activeTab === 'clients'    && <ManagerClients />}
            {activeTab === 'leads'      && <ManagerLeads />}
            {activeTab === 'pdca'       && <ManagerPDCA />}
            {activeTab === 'health'     && <ManagerHealth />}
            {activeTab === 'automation' && <ManagerAutomation />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────
export default function App() {
  const [role, setRole] = useState<Role>('admin');

  return (
    <div className="dark">
      {role === 'client'      && <ClientApp />}
      {role === 'cs_manager'  && <ManagerApp />}
      {role === 'admin'       && <AdminApp />}
      {role === 'super_admin' && <SuperAdminPortal />}
      <RoleSwitcher role={role} onSwitch={setRole} />
    </div>
  );
}
