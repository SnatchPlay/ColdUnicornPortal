import { memo, useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  Eye,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Rocket,
  Settings,
  UserCog,
  Users,
  Contrast,
} from "lucide-react";
import { useColorTheme } from "../providers/color-theme";
import { cn } from "./ui/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { LightweightSheet } from "./ui/lightweight-sheet";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { runtimeConfig } from "../lib/env";
import { logAfterRaf2, markInteractionStart, measureAfterRaf2 } from "../lib/perf-mark";
import { DevProfiler, useDevRenderCount } from "../lib/react-profiler-dev";
import { useAuth } from "../providers/auth";
import { useShellData } from "../providers/shell-data";
import type { AppRole, Identity } from "../types/core";
import type { ClientLite, UserLite } from "../types/view-contracts";
import { getRoleLabel, isInternalAdmin } from "../lib/selectors";
import { UserAvatar } from "./ui/user-avatar";
import coldUnicornLogo from "../../imports/logo white with name.png";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/leads", label: "Leads", icon: Users },
  { to: "/admin/campaigns", label: "Campaigns", icon: Rocket },
  { to: "/admin/statistics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/domains", label: "Domains", icon: Globe2 },
  { to: "/admin/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/admin/users", label: "User management", icon: UserCog },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

const NAV_BY_ROLE: Record<AppRole, NavItem[]> = {
  client: [
    { to: "/client/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/client/leads", label: "Leads", icon: Users },
    { to: "/client/campaigns", label: "Campaigns", icon: Rocket },
    { to: "/client/statistics", label: "Analytics", icon: BarChart3 },
    { to: "/client/settings", label: "Settings", icon: Settings },
  ],
  manager: [
    { to: "/manager/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/manager/clients", label: "Clients", icon: Building2 },
    { to: "/manager/leads", label: "Leads", icon: Users },
    { to: "/manager/campaigns", label: "Campaigns", icon: Rocket },
    { to: "/manager/statistics", label: "Analytics", icon: BarChart3 },
    { to: "/manager/domains", label: "Domains", icon: Globe2 },
    { to: "/manager/invoices", label: "Invoices", icon: ReceiptText },
    { to: "/manager/settings", label: "Settings", icon: Settings },
  ],
  admin: ADMIN_NAV,
  super_admin: ADMIN_NAV,
  master_admin: ADMIN_NAV,
};

const MOBILE_PRIMARY_BY_ROLE: Record<AppRole, string[]> = {
  client: ["/client/dashboard", "/client/leads", "/client/campaigns", "/client/settings"],
  manager: ["/manager/dashboard", "/manager/clients", "/manager/leads", "/manager/campaigns"],
  admin: ["/admin/dashboard", "/admin/clients", "/admin/leads", "/admin/campaigns"],
  super_admin: ["/admin/dashboard", "/admin/clients", "/admin/leads", "/admin/campaigns"],
  master_admin: ["/admin/dashboard", "/admin/clients", "/admin/leads", "/admin/campaigns"],
};

const SIDEBAR_HIDDEN_STORAGE_KEY = "app_shell_sidebar_hidden"; // legacy key
const SIDEBAR_MODE_STORAGE_KEY = "app_shell_sidebar_mode";

function roleHomePath(role: AppRole) {
  if (isInternalAdmin(role)) return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}

function settingsPathFor(role: AppRole) {
  if (isInternalAdmin(role)) return "/admin/settings";
  if (role === "manager") return "/manager/settings";
  return "/client/settings";
}

function readInitialSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  // Legacy: "1" in old hidden key means collapsed now (was fully hidden before).
  const legacy = window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
  if (legacy === "1") return true;
  if (legacy === "0") return false;
  const mode = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
  return mode === "collapsed" || mode === "hidden";
}

function isPathActive(currentPath: string, itemPath: string) {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

// ── SidebarPanel ────────────────────────────────────────────────────────────────────────────────
// Memoised so that state changes inside AppShell (isMobileMenuOpen, isDesktopSidebarHidden)
// don't re-render the sidebar content unnecessarily.

interface SidebarPanelProps {
  homePath: string;
  navItems: NavItem[];
  identity: Identity;
  activeClient: ClientLite | null;
  actorIdentity: Identity | null;
  managerOptions: UserLite[];
  clientOptions: ClientLite[];
  isImpersonating: boolean;
  impersonate: (identity: Identity) => void;
  stopImpersonation: () => void;
  signOut: () => void;
  onNavigate: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const SidebarPanel = memo(function SidebarPanel({
  homePath,
  navItems,
  identity,
  activeClient,
  actorIdentity,
  managerOptions,
  clientOptions,
  isImpersonating,
  impersonate,
  stopImpersonation,
  signOut,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
}: SidebarPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [, startNavTransition] = useTransition();
  const [managerTargetId, setManagerTargetId] = useState("");
  const [clientTargetId, setClientTargetId] = useState("");
  const { isContrast, toggleTheme } = useColorTheme();

  if (isCollapsed) {
    return (
      <div className="flex h-full flex-col items-center">
        <button
          onClick={onToggleCollapse}
          title="Show menu"
          aria-label="Expand sidebar"
          className="flex h-[88px] w-full items-center justify-center border-b border-[#1f1f1f] text-neutral-500 transition hover:bg-[#111] hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1 px-2 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = isPathActive(location.pathname, item.to);
            return (
              <a
                key={item.to}
                href={item.to}
                title={item.label}
                aria-label={item.label}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate();
                  startNavTransition(() => navigate(item.to));
                }}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl border transition",
                  isActive
                    ? "border-[#3a3a3a] bg-[#232323] text-white"
                    : "border-transparent text-neutral-400 hover:border-[#242424] hover:bg-[#111] hover:text-white",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
              </a>
            );
          })}
        </nav>
        <div className="flex flex-col items-center gap-2 border-t border-[#1f1f1f] px-2 py-4">
          <button
            onClick={() => {
              onNavigate();
              startNavTransition(() => navigate(settingsPathFor(identity.role)));
            }}
            title="Open settings"
            aria-label="Open settings"
            className="rounded-full ring-2 ring-transparent transition hover:ring-[#2b2b2b]"
          >
            <UserAvatar name={identity.fullName} email={identity.email} avatarPath={identity.avatarPath} className="size-10" />
          </button>
          <button
            onClick={() => { onNavigate(); void signOut(); }}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-[#111] hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  function handleImpersonateAdmin() {
    if (!actorIdentity) return;
    impersonate({ ...actorIdentity, role: "admin" });
    navigate(roleHomePath("admin"));
  }

  function handleImpersonateManager() {
    const manager = managerOptions.find((item) => item.id === managerTargetId);
    if (!manager) return;
    impersonate({
      id: manager.id,
      fullName: `${manager.first_name} ${manager.last_name}`.trim(),
      email: manager.email,
      role: "manager",
    });
    navigate(roleHomePath("manager"));
  }

  function handleImpersonateClient() {
    const client = clientOptions.find((item) => item.id === clientTargetId);
    if (!client) return;
    impersonate({
      id: client.id,
      fullName: `${client.name} client view`,
      email: client.notification_emails?.[0] ?? `client-view:${client.id}`,
      role: "client",
      clientId: client.id,
    });
    navigate(roleHomePath("client"));
  }

  return (
    <>
      <div className="flex items-start justify-between border-b border-[#1f1f1f] px-6 py-6">
        <Link to={homePath} onClick={onNavigate} className="min-w-0">
          <img src={coldUnicornLogo} alt="ColdUnicorn" className="h-10 w-auto object-contain" />
          <p className="mt-3 text-sm leading-5 text-neutral-500">PDCA portal</p>
        </Link>
        <button
          onClick={onToggleCollapse}
          title="Hide menu"
          aria-label="Collapse sidebar"
          className="mt-1 shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-[#111] hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>

      {identity.role === "client" ? (
        <div className="border-b border-[#1f1f1f] px-7 py-6">
          <p className="text-sm text-neutral-400">Client workspace</p>
          <p className="mt-2 text-base text-white">{activeClient?.name ?? identity.fullName}</p>
        </div>
      ) : null}

      <nav className="space-y-2 px-4 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = isPathActive(location.pathname, item.to);
          return (
            <a
              key={item.to}
              href={item.to}
              onClick={(e) => {
                e.preventDefault();
                onNavigate();
                startNavTransition(() => navigate(item.to));
              }}
              className={cn(
                "flex items-center gap-4 rounded-xl border px-4 py-3 text-base transition",
                isActive
                  ? "border-[#3a3a3a] bg-[#232323] text-white"
                  : "border-transparent text-neutral-400 hover:border-[#242424] hover:bg-[#111] hover:text-white",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </a>
          );
        })}
      </nav>

      {activeClient ? (
        <div className="mx-4 mt-auto rounded-xl border border-[#1f1f1f] bg-[#101010] p-4">
          <p className="text-sm text-neutral-400">Contract KPIs</p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-neutral-400">MQL target</p>
              <p className="mt-1 text-white">{activeClient.kpi_leads ?? 0}/mo</p>
            </div>
            <div>
              <p className="text-neutral-400">Meetings</p>
              <p className="mt-1 text-white">{activeClient.kpi_meetings ?? 0}/mo</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-[#1f1f1f] px-4 py-4">
        {runtimeConfig.allowInternalImpersonation && actorIdentity?.role === "super_admin" && (
          <div className="mb-4 space-y-3 rounded-xl border border-[#1f1f1f] bg-[#080808] p-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-emerald-400" />
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Impersonation</p>
            </div>
            <button
              onClick={handleImpersonateAdmin}
              className="w-full rounded-lg border border-[#242424] px-3 py-2 text-left text-sm transition hover:bg-[#111]"
            >
              Open admin view
            </button>
            <Select value={managerTargetId} onValueChange={setManagerTargetId}>
              <SelectTrigger className="h-auto rounded-lg border-[#242424] bg-[#050505] px-3 py-2 text-left text-sm text-white hover:bg-[#111] focus-visible:ring-[#2b2b2b]">
                <SelectValue placeholder="Select manager" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-lg border-[#242424] bg-[#050505] text-white">
                {managerOptions.map((manager) => (
                  <SelectItem
                    key={manager.id}
                    value={manager.id}
                    className="rounded-md text-sm text-white focus:bg-[#1a1a1a] focus:text-white"
                  >
                    {`${manager.first_name} ${manager.last_name}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={handleImpersonateManager}
              disabled={!managerTargetId}
              className="w-full rounded-lg border border-[#242424] px-3 py-2 text-left text-sm transition hover:bg-[#111] disabled:opacity-50"
            >
              Open manager view
            </button>
            <Select value={clientTargetId} onValueChange={setClientTargetId}>
              <SelectTrigger className="h-auto rounded-lg border-[#242424] bg-[#050505] px-3 py-2 text-left text-sm text-white hover:bg-[#111] focus-visible:ring-[#2b2b2b]">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-lg border-[#242424] bg-[#050505] text-white">
                {clientOptions.map((client) => (
                  <SelectItem
                    key={client.id}
                    value={client.id}
                    className="rounded-md text-sm text-white focus:bg-[#1a1a1a] focus:text-white"
                  >
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              onClick={handleImpersonateClient}
              disabled={!clientTargetId}
              className="w-full rounded-lg border border-[#242424] px-3 py-2 text-left text-sm transition hover:bg-[#111] disabled:opacity-50"
            >
              Open client view
            </button>
            {isImpersonating && (
              <button
                onClick={() => {
                  stopImpersonation();
                  if (actorIdentity) navigate(roleHomePath(actorIdentity.role));
                }}
                className="w-full rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-100"
              >
                Return to super admin
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <UserAvatar name={identity.fullName} email={identity.email} avatarPath={identity.avatarPath} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white">{identity.fullName}</p>
            <p className="truncate text-xs text-neutral-500">{getRoleLabel(identity.role)}</p>
          </div>
          <button
            onClick={toggleTheme}
            title={isContrast ? "Switch to default colours" : "Switch to contrast colours (colorblind-friendly)"}
            className={cn(
              "rounded-lg p-2 transition",
              isContrast
                ? "text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                : "text-neutral-400 hover:bg-[#111] hover:text-white",
            )}
          >
            <Contrast className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              onNavigate();
              void signOut();
            }}
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-[#111] hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
});

// ── StablePageContent ───────────────────────────────────────────────────────────────────────────
// Memoised wrapper so that AppShell state changes (isMobileMenuOpen, isDesktopSidebarHidden)
// don't cause the active route page — and its heavy tables — to re-render.

const StablePageContent = memo(function StablePageContent({ children }: { children: ReactNode }) {
  return <>{children}</>;
});

// ── AppShell ────────────────────────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  useDevRenderCount("AppShell");
  const navigate = useNavigate();
  const location = useLocation();
  const { usersLite: users, clientsLite: clients } = useShellData();
  const { actorIdentity, identity, isImpersonating, impersonate, stopImpersonation, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => readInitialSidebarCollapsed());

  const managerOptions = useMemo(
    () =>
      users
        .filter((item) => item.role === "manager")
        .sort((left, right) =>
          `${left.first_name} ${left.last_name}`.localeCompare(`${right.first_name} ${right.last_name}`),
        ),
    [users],
  );
  const clientOptions = useMemo(
    () => clients.slice().sort((left, right) => left.name.localeCompare(right.name)),
    [clients],
  );
  const activeClient = useMemo(
    () => clients.find((client) => client.id === identity?.clientId) ?? null,
    [clients, identity?.clientId],
  );

  // Stable callback — setIsMobileMenuOpen setter identity is guaranteed stable by React.
  const closeMenu = useCallback(() => setIsMobileMenuOpen(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, isDesktopSidebarCollapsed ? "collapsed" : "expanded");
  }, [isDesktopSidebarCollapsed]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  if (!identity) {
    return <>{children}</>;
  }

  const navItems = NAV_BY_ROLE[identity.role];
  const homePath = navItems[0]?.to ?? "/";
  const mobilePrimary = navItems.filter((item) => MOBILE_PRIMARY_BY_ROLE[identity.role].includes(item.to));
  const currentRolePrefix = identity.role === "super_admin" ? "admin" : identity.role;
  const rootPath = `/${currentRolePrefix}`;
  const crumbHomePath = roleHomePath(identity.role);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const pageLabel =
    navItems.find((item) => isPathActive(location.pathname, item.to))?.label ??
    pathParts[pathParts.length - 1]?.replace(/-/g, " ") ??
    "Page";

  const sidebarPanelNode = (
    <SidebarPanel
      homePath={homePath}
      navItems={navItems}
      identity={identity}
      activeClient={activeClient}
      actorIdentity={actorIdentity}
      managerOptions={managerOptions}
      clientOptions={clientOptions}
      isImpersonating={isImpersonating}
      impersonate={impersonate}
      stopImpersonation={stopImpersonation}
      signOut={signOut}
      onNavigate={closeMenu}
      isCollapsed={isDesktopSidebarCollapsed}
      onToggleCollapse={() => setIsDesktopSidebarCollapsed((c) => !c)}
    />
  );

  return (
    <div className="min-h-screen bg-[#030303] text-white">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-[#1f1f1f] bg-[#050505] transition-[width] duration-200 lg:flex",
            isDesktopSidebarCollapsed ? "w-16" : "w-[300px]",
          )}
        >
          {sidebarPanelNode}
        </aside>

        <LightweightSheet
          open={isMobileMenuOpen}
          onOpenChange={setIsMobileMenuOpen}
          side="left"
          labelledBy="mobile-nav-title"
          className="w-[86vw] max-w-[320px] border-r border-[#1f1f1f] bg-[#050505] p-0 text-white"
        >
          {/* sr-only accessible label for the dialog */}
          <h2 id="mobile-nav-title" className="sr-only">Navigation</h2>
          <div className="flex h-full flex-col overflow-y-auto">{sidebarPanelNode}</div>
        </LightweightSheet>

        <main className="min-w-0 flex-1 overflow-x-hidden bg-[#030303] px-3 py-4 pb-24 sm:px-4 sm:py-6 sm:pb-24 lg:px-10 lg:py-8 lg:pb-8">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#1f1f1f] pb-4 lg:hidden">
            <button
              onClick={() => {
                markInteractionStart("menu:click");
                measureAfterRaf2("menu:click", "[perf][menu] mobile click→raf2");
                logAfterRaf2("[perf][menu] lightweight-mobile open state→raf2");
                setIsMobileMenuOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-[#242424] bg-[#080808] px-3 py-2 text-sm text-neutral-300 transition hover:bg-[#111] hover:text-white"
              aria-label="Open sidebar menu"
            >
              <Menu className="h-4 w-4" />
              <span>Menu</span>
            </button>
            <p className="truncate text-sm text-neutral-400">{pageLabel}</p>
          </div>

          <div className="mb-4 border-b border-[#1f1f1f] pb-4">
            <Breadcrumb>
              <BreadcrumbList className="text-xs sm:text-sm">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={crumbHomePath}>{getRoleLabel(identity.role)}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {location.pathname === rootPath ? (
                    <BreadcrumbPage>Home</BreadcrumbPage>
                  ) : (
                    <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {/* StablePageContent prevents heavy route pages from re-rendering when AppShell
              toggles isMobileMenuOpen or isDesktopSidebarHidden. */}
          <DevProfiler id="StablePageContent">
            <StablePageContent>{children}</StablePageContent>
          </DevProfiler>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#1f1f1f] bg-[#050505]/95 px-2 py-2 backdrop-blur lg:hidden" aria-label="Primary navigation">
        <ul className="grid grid-cols-4 gap-1">
          {mobilePrimary.map((item) => {
            const Icon = item.icon;
            const active = isPathActive(location.pathname, item.to);
            return (
              <li key={item.to}>
                <button
                  onClick={() => navigate(item.to)}
                  aria-label={item.label}
                  className={cn(
                    "flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] transition",
                    active
                      ? "bg-[#232323] text-white"
                      : "text-neutral-400 hover:bg-[#111] hover:text-white",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
