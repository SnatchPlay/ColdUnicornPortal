import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  Eye,
  Globe2,
  LayoutDashboard,
  LogOut,
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
    { to: "/client/leads", label: "My Pipeline", icon: Users },
    { to: "/client/campaigns", label: "Campaigns", icon: Rocket },
    { to: "/client/statistics", label: "Analytics", icon: BarChart3 },
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

function roleHomePath(role: AppRole) {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { users, clients } = useCoreData();
  const { actorIdentity, identity, isImpersonating, impersonate, stopImpersonation, signOut } = useAuth();
  const [managerTargetId, setManagerTargetId] = useState("");
  const [clientTargetId, setClientTargetId] = useState("");

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

  if (!identity) {
    return <>{children}</>;
  }

  const navItems = NAV_BY_ROLE[identity.role];
  const homePath = navItems[0]?.to ?? "/";

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
        <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 flex-col overflow-y-auto border-r border-[#1f1f1f] bg-[#050505] lg:flex">
          <Link to={homePath} className="border-b border-[#1f1f1f] px-6 py-6">
            <div>
              <img src={coldUnicornLogo} alt="ColdUnicorn" className="h-10 w-auto object-contain" />
              <p className="mt-3 text-sm leading-5 text-neutral-500">ColdUnicorn PDCA Platform</p>
            </div>
          </Link>

          <div className="border-b border-[#1f1f1f] px-7 py-6">
            <p className="text-sm text-neutral-400">{identity.role === "client" ? "Client workspace" : "Workspace"}</p>
            <p className="mt-2 text-base text-white">
              {identity.role === "client" ? activeClient?.name ?? identity.fullName : getRoleLabel(identity.role)}
            </p>
          </div>

          <nav className="space-y-2 px-4 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-4 rounded-xl border px-4 py-3 text-base transition",
                      isActive
                        ? "border-[#3a3a3a] bg-[#232323] text-white"
                        : "border-transparent text-neutral-400 hover:border-[#242424] hover:bg-[#111] hover:text-white",
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          {activeClient && (
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
          )}

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
                  void signOut();
                }}
                className="rounded-lg p-2 text-neutral-400 transition hover:bg-[#111] hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#030303] px-6 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
