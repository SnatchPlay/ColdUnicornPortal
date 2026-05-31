import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminDashboardPage } from "../admin-dashboard-page";
import { BlacklistPage } from "../blacklist-page";
import { CampaignsPage } from "../campaigns-page";
import { ClientsPage } from "../clients-page";
import { DomainsPage } from "../domains-page";
import { InvoicesPage } from "../invoices-page";
import { LeadsPage } from "../leads-page";
import { ManagerDashboardPage } from "../manager-dashboard-page";
import { StatisticsPage } from "../statistics-page";
import { useAuth } from "../../providers/auth";
import { useCoreData } from "../../providers/core-data";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(),
}));

// Dashboard + clients pages (Phase 2A/3) load their own data via repository; mock those methods.
// Synchronous factory so RepositoryError can be re-exported as a simple stub class.
vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "dashboard"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadAdminDashboardOverview: vi.fn(),
    loadManagerDashboardOverview: vi.fn(),
    loadClientDashboard: vi.fn(),
    loadClientsOverview: vi.fn(),
  },
}));

type AppRole = "super_admin" | "admin" | "manager" | "client";

type RouteCase = {
  name: string;
  role: AppRole;
  title: string;
  Component: () => JSX.Element;
};

// Non-dashboard, non-clients routes still use CoreDataProvider (LegacySnapshotOutlet).
const LEGACY_ROUTE_CASES: RouteCase[] = [
  { name: "manager leads route", role: "manager", title: "Leads", Component: LeadsPage },
  { name: "manager campaigns route", role: "manager", title: "Campaigns", Component: CampaignsPage },
  { name: "manager statistics route", role: "manager", title: "Statistics", Component: StatisticsPage },
  { name: "manager domains route", role: "manager", title: "Domains", Component: DomainsPage },
  { name: "manager invoices route", role: "manager", title: "Invoices", Component: InvoicesPage },
  { name: "manager blacklist route", role: "manager", title: "Blacklist", Component: BlacklistPage },
  { name: "admin leads route", role: "admin", title: "Leads", Component: LeadsPage },
  { name: "admin campaigns route", role: "admin", title: "Campaigns", Component: CampaignsPage },
  { name: "admin statistics route", role: "admin", title: "Statistics", Component: StatisticsPage },
  { name: "admin domains route", role: "admin", title: "Domains", Component: DomainsPage },
  { name: "admin invoices route", role: "admin", title: "Invoices", Component: InvoicesPage },
  { name: "admin blacklist route", role: "admin", title: "Blacklist", Component: BlacklistPage },
];

// Clients routes (Phase 3): per-page loaders, no CoreDataProvider.
const CLIENTS_ROUTE_CASES: RouteCase[] = [
  { name: "manager clients route", role: "manager", title: "Clients", Component: ClientsPage },
  { name: "admin clients route", role: "admin", title: "Clients", Component: ClientsPage },
];

// Dashboard routes (Phase 2A): per-page loaders, no CoreDataProvider.
const DASHBOARD_ROUTE_CASES: RouteCase[] = [
  { name: "manager dashboard route", role: "manager", title: "Manager Dashboard", Component: ManagerDashboardPage },
  { name: "admin dashboard route", role: "admin", title: "Admin Dashboard", Component: AdminDashboardPage },
];

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseCoreData = vi.mocked(useCoreData);
const mockedRepo = vi.mocked(repository);

function makeAuth(role: AppRole) {
  return {
    identity: { id: "user-1", fullName: "Test User", email: "user@test.local", role },
  };
}

function makeCoreData(overrides?: Partial<ReturnType<typeof makeCoreDataBase>>) {
  return { ...makeCoreDataBase(), ...overrides };
}

function makeCoreDataBase() {
  return {
    users: [], clients: [], clientUsers: [], campaigns: [], leads: [], replies: [],
    campaignDailyStats: [], dailyStats: [], domains: [], invoices: [], emailExcludeList: [],
    loading: false, error: null,
    refresh: vi.fn(async () => {}), updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}), updateLead: vi.fn(async () => {}),
    updateDomain: vi.fn(async () => {}), updateInvoice: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}), deleteClientUserMapping: vi.fn(async () => {}),
    upsertEmailExcludeDomain: vi.fn(async () => {}), deleteEmailExcludeDomain: vi.fn(async () => {}),
  };
}

const emptyAdminDashboard = {
  metrics: { clientsCount: 0, clientsWithoutManager: 0, activeCampaignsCount: 0 },
  pipelineGroups: [], campaignMomentum21d: [], managerCapacity: [], latestSnapshotDate: null,
};

const emptyManagerDashboard = {
  metrics: { assignedClientsCount: 0, activeCampaignsCount: 0, leadsInProgressCount: 0, unclassifiedRepliesCount: 0, recentRepliesCount14d: 0 },
  clientPortfolio: [], campaignWatchlist: [], leadQueue: [],
};

function renderRoute(Component: RouteCase["Component"]) {
  render(<MemoryRouter><Component /></MemoryRouter>);
}

describe("manager/admin route states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // All per-page loaders hang indefinitely — keeps loading state for sync loading checks.
    mockedRepo.loadAdminDashboardOverview.mockReturnValue(new Promise(() => {}));
    mockedRepo.loadManagerDashboardOverview.mockReturnValue(new Promise(() => {}));
    mockedRepo.loadClientsOverview.mockReturnValue(new Promise(() => {}));
  });

  // ── Legacy snapshot routes (still on CoreDataProvider) ──────────────────────────────────────

  it.each(LEGACY_ROUTE_CASES)("renders loading state on $name", ({ role, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: true, error: null }) as never);
    renderRoute(Component);
    expect(screen.getByText("Loading workspace data")).toBeInTheDocument();
  });

  it.each(LEGACY_ROUTE_CASES)("renders error + retry on $name", ({ role, title, Component }) => {
    const refresh = vi.fn(async () => {});
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: "Runtime data sync failed", refresh }) as never);
    renderRoute(Component);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText("Runtime data sync failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry data sync/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // ── Dashboard routes (Phase 2A: per-page loaders, no CoreDataProvider) ──────────────────────

  it.each(DASHBOARD_ROUTE_CASES)("renders loading state on $name", ({ role, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    // Repo methods hang (set in beforeEach) → hook stays in loading:true state.
    renderRoute(Component);
    expect(screen.getByText("Loading workspace data")).toBeInTheDocument();
  });

  it.each(DASHBOARD_ROUTE_CASES)("renders error + retry on $name", async ({ role, title, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedRepo.loadAdminDashboardOverview.mockRejectedValue(new Error("Runtime data sync failed"));
    mockedRepo.loadManagerDashboardOverview.mockRejectedValue(new Error("Runtime data sync failed"));

    renderRoute(Component);

    // Flush the async rejection and resulting state update.
    await act(async () => {});

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText("Runtime data sync failed")).toBeInTheDocument();

    const callsBefore =
      mockedRepo.loadAdminDashboardOverview.mock.calls.length +
      mockedRepo.loadManagerDashboardOverview.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Retry data sync/i }));
    await act(async () => {});

    expect(
      mockedRepo.loadAdminDashboardOverview.mock.calls.length +
      mockedRepo.loadManagerDashboardOverview.mock.calls.length,
    ).toBeGreaterThan(callsBefore);
  });

  // ── Clients routes (Phase 3: per-page loader, no CoreDataProvider) ──────────────────────────

  it.each(CLIENTS_ROUTE_CASES)("renders loading state on $name", ({ role, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    // loadClientsOverview hangs (set in beforeEach) → hook stays in loading:true.
    renderRoute(Component);
    expect(screen.getByText("Loading workspace data")).toBeInTheDocument();
  });

  it.each(CLIENTS_ROUTE_CASES)("renders error + retry on $name", async ({ role, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedRepo.loadClientsOverview.mockRejectedValue(new Error("Runtime data sync failed"));

    renderRoute(Component);
    await act(async () => {});

    expect(screen.getByText("Clients")).toBeInTheDocument();
    expect(screen.getByText("Runtime data sync failed")).toBeInTheDocument();

    const callsBefore = mockedRepo.loadClientsOverview.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Retry data sync/i }));
    await act(async () => {});

    expect(mockedRepo.loadClientsOverview.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("removes admin unclassified and at-risk surfaces and shows split momentum charts", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);
    mockedRepo.loadAdminDashboardOverview.mockResolvedValue(emptyAdminDashboard as never);

    renderRoute(AdminDashboardPage);
    await act(async () => {});

    expect(screen.queryByText("Unclassified replies")).not.toBeInTheDocument();
    expect(screen.queryByText("At-risk clients")).not.toBeInTheDocument();
    expect(screen.getByText("Campaign momentum: Sent")).toBeInTheDocument();
    expect(screen.getByText("Campaign momentum: Replies")).toBeInTheDocument();
    expect(screen.getByText("Campaign momentum: Positive")).toBeInTheDocument();
  });

  it("removes manager reply triage panel and keeps campaign watchlist stretched", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedRepo.loadManagerDashboardOverview.mockResolvedValue(emptyManagerDashboard as never);

    renderRoute(ManagerDashboardPage);
    await act(async () => {});

    expect(screen.queryByText("Reply triage")).not.toBeInTheDocument();
    expect(screen.getByText("Campaign watchlist")).toBeInTheDocument();
    const watchlistSection = screen.getByText("Campaign watchlist").closest("section");
    expect(watchlistSection?.className).toContain("xl:row-span-2");
  });
});
