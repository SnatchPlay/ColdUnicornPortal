import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
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
  ShieldBan,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "./ui/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { runtimeConfig } from "../lib/env";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { AppRole } from "../types/core";
import { getRoleLabel } from "../lib/selectors";
import coldUnicornLogo from "../../imports/logo white with name.png";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "User management", icon: UserCog },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/leads", label: "Leads", icon: Users },
  { to: "/admin/campaigns", label: "Campaigns", icon: Rocket },
  { to: "/admin/statistics", label: "Analytics", icon: BarChart3 },
  { to: "/admin/domains", label: "Domains", icon: Globe2 },
  { to: "/admin/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/admin/blacklist", label: "Blacklist", icon: ShieldBan },
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
    { to: "/manager/blacklist", label: "Blacklist", icon: ShieldBan },
    { to: "/manager/settings", label: "Settings", icon: Settings },
  ],
  admin: ADMIN_NAV,
  super_admin: ADMIN_NAV,
};

const MOBILE_PRIMARY_BY_ROLE: Record<AppRole, string[]> = {
  client: ["/client/dashboard", "/client/leads", "/client/campaigns", "/client/settings"],
  manager: ["/manager/dashboard", "/manager/clients", "/manager/leads", "/manager/campaigns"],
  admin: ["/admin/dashboard", "/admin/clients", "/admin/leads", "/admin/campaigns"],
  super_admin: ["/admin/dashboard", "/admin/clients", "/admin/leads", "/admin/campaigns"],
};

const SIDEBAR_HIDDEN_STORAGE_KEY = "app_shell_sidebar_hidden";
const SIDEBAR_MODE_STORAGE_KEY = "app_shell_sidebar_mode";

function roleHomePath(role: AppRole) {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}

function readInitialSidebarHidden() {
  if (typeof window === "undefined") return false;

  const legacy = window.localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY);
  if (legacy === "1") return true;
  if (legacy === "0") return false;

  const mode = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
  return mode === "hidden";
}

function isPathActive(currentPath: string, itemPath: string) {
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { users, clients } = useCoreData();
  const { actorIdentity, identity, isImpersonating, impersonate, stopImpersonation, signOut } = useAuth();
  const [managerTargetId, setManagerTargetId] = useState("");
  const [clientTargetId, setClientTargetId] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopSidebarHidden, setIsDesktopSidebarHidden] = useState(() => readInitialSidebarHidden());

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, isDesktopSidebarHidden ? "1" : "0");
  }, [isDesktopSidebarHidden]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  if (!identity) {
    return <>{children}</>;
  }

  const navItems = NAV_BY_ROLE[identity.role];
  const homePath = navItems[0]?.to ?? "/";
  const hasDesktopSidebar = !isDesktopSidebarHidden;
  const mobilePrimary = navItems.filter((item) => MOBILE_PRIMARY_BY_ROLE[identity.role].includes(item.to));
  const currentRolePrefix = identity.role === "super_admin" ? "admin" : identity.role;
  const rootPath = `/${currentRolePrefix}`;
  const crumbHomePath = roleHomePath(identity.role);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const pageLabel =
    navItems.find((item) => isPathActive(location.pathname, item.to))?.label ??
    pathParts[pathParts.length - 1]?.replace(/-/g, " ") ??
    "Page";

  const sidebarPanel = () => (
    <>
      <Link to={homePath} onClick={() => setIsMobileMenuOpen(false)} className="border-b border-[#1f1f1f] px-6 py-6">
        <div className="flex items-center">
          <img src={coldUnicornLogo} alt="ColdUnicorn" className="h-10 w-auto object-contain" />
        </div>
        <p className="mt-3 text-sm leading-5 text-neutral-500">ColdUnicorn PDCA Platform</p>
      </Link>

      {identity.role === "client" ? (
        <div className="border-b border-[#1f1f1f] px-7 py-6">
          <p className="text-sm text-neutral-400">Client workspace</p>
          <p className="mt-2 text-base text-white">{activeClient?.name ?? identity.fullName}</p>
        </div>
      ) : null}

      <nav className="space-y-2 px-4 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setIsMobileMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-4 rounded-xl border px-4 py-3 text-base transition",
                  isActive
                    ? "border-[#3a3a3a] bg-[#232323] text-white"
                    : "border-transparent text-neutral-400 hover:border-[#242424] hover:bg-[#111] hover:text-white",
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
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
                  navigate(roleHomePath(actorIdentity.role));
                }}
                className="w-full rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-100"
              >
                Return to super admin
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500 text-sm">
            {identity.fullName
              .split(" ")
              .map((item) => item[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white">{identity.fullName}</p>
            <p className="truncate text-xs text-neutral-500">{getRoleLabel(identity.role)}</p>
          </div>
          <button
            onClick={() => {
              setIsMobileMenuOpen(false);
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
    <div className="min-h-screen bg-[#030303] text-white">
      <div className="flex min-h-screen">
        {hasDesktopSidebar && (
          <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 flex-col overflow-y-auto border-r border-[#1f1f1f] bg-[#050505] lg:flex">
            {sidebarPanel()}
          </aside>
        )}

        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetContent
            side="left"
            className="w-[86vw] max-w-[320px] border-r border-[#1f1f1f] bg-[#050505] p-0 text-white lg:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Open workspace navigation and account controls.</SheetDescription>
            </SheetHeader>
            <div className="flex h-full flex-col overflow-y-auto">{sidebarPanel()}</div>
          </SheetContent>
        </Sheet>

        <main className="min-w-0 flex-1 overflow-x-hidden bg-[#030303] px-3 py-4 pb-24 sm:px-4 sm:py-6 sm:pb-24 lg:px-10 lg:py-8 lg:pb-8">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#1f1f1f] pb-4 lg:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#242424] bg-[#080808] px-3 py-2 text-sm text-neutral-300 transition hover:bg-[#111] hover:text-white"
              aria-label="Open sidebar menu"
            >
              <Menu className="h-4 w-4" />
              <span>Menu</span>
            </button>
            <p className="truncate text-sm text-neutral-400">{pageLabel}</p>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] pb-4">
            <div className="min-w-0">
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
            <button
              onClick={() => setIsDesktopSidebarHidden((current) => !current)}
              className="hidden items-center gap-2 rounded-lg border border-[#242424] bg-[#080808] px-3 py-2 text-sm text-neutral-300 transition hover:bg-[#111] hover:text-white lg:inline-flex"
              aria-label="Toggle menu"
            >
              <Menu className="h-4 w-4" />
              <span>{isDesktopSidebarHidden ? "Show menu" : "Hide menu"}</span>
            </button>
          </div>

          {children}
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
                  className={cn(
                    "flex w-full flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] transition",
                    active
                      ? "bg-[#232323] text-white"
                      : "text-neutral-400 hover:bg-[#111] hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
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
