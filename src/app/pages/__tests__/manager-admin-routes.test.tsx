import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(),
}));

type AppRole = "super_admin" | "admin" | "manager" | "client";

type RouteCase = {
  name: string;
  role: AppRole;
  title: string;
  Component: () => JSX.Element;
};

const ROUTE_CASES: RouteCase[] = [
  {
    name: "manager dashboard route",
    role: "manager",
    title: "Manager Dashboard",
    Component: ManagerDashboardPage,
  },
  {
    name: "manager clients route",
    role: "manager",
    title: "Clients",
    Component: ClientsPage,
  },
  {
    name: "manager leads route",
    role: "manager",
    title: "Leads",
    Component: LeadsPage,
  },
  {
    name: "manager campaigns route",
    role: "manager",
    title: "Campaigns",
    Component: CampaignsPage,
  },
  {
    name: "manager statistics route",
    role: "manager",
    title: "Statistics",
    Component: StatisticsPage,
  },
  {
    name: "manager domains route",
    role: "manager",
    title: "Domains",
    Component: DomainsPage,
  },
  {
    name: "manager invoices route",
    role: "manager",
    title: "Invoices",
    Component: InvoicesPage,
  },
  {
    name: "manager blacklist route",
    role: "manager",
    title: "Blacklist",
    Component: BlacklistPage,
  },
  {
    name: "admin dashboard route",
    role: "admin",
    title: "Admin Dashboard",
    Component: AdminDashboardPage,
  },
  {
    name: "admin clients route",
    role: "admin",
    title: "Clients",
    Component: ClientsPage,
  },
  {
    name: "admin leads route",
    role: "admin",
    title: "Leads",
    Component: LeadsPage,
  },
  {
    name: "admin campaigns route",
    role: "admin",
    title: "Campaigns",
    Component: CampaignsPage,
  },
  {
    name: "admin statistics route",
    role: "admin",
    title: "Statistics",
    Component: StatisticsPage,
  },
  {
    name: "admin domains route",
    role: "admin",
    title: "Domains",
    Component: DomainsPage,
  },
  {
    name: "admin invoices route",
    role: "admin",
    title: "Invoices",
    Component: InvoicesPage,
  },
  {
    name: "admin blacklist route",
    role: "admin",
    title: "Blacklist",
    Component: BlacklistPage,
  },
];

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseCoreData = vi.mocked(useCoreData);

function makeAuth(role: AppRole) {
  return {
    identity: {
      id: "user-1",
      fullName: "Test User",
      email: "user@test.local",
      role,
    },
  };
}

function makeCoreData(overrides?: Partial<ReturnType<typeof makeCoreDataBase>>) {
  return {
    ...makeCoreDataBase(),
    ...overrides,
  };
}

function makeCoreDataBase() {
  return {
    users: [],
    clients: [],
    clientUsers: [],
    campaigns: [],
    leads: [],
    replies: [],
    campaignDailyStats: [],
    dailyStats: [],
    domains: [],
    invoices: [],
    emailExcludeList: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    updateDomain: vi.fn(async () => {}),
    updateInvoice: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
    upsertEmailExcludeDomain: vi.fn(async () => {}),
    deleteEmailExcludeDomain: vi.fn(async () => {}),
  };
}

function renderRoute(Component: RouteCase["Component"]) {
  render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>,
  );
}

describe("manager/admin route states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(ROUTE_CASES)("renders loading state on $name", ({ role, Component }) => {
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: true, error: null }) as never);

    renderRoute(Component);

    expect(screen.getByText("Loading workspace data")).toBeInTheDocument();
  });

  it.each(ROUTE_CASES)("renders error + retry on $name", ({ role, title, Component }) => {
    const refresh = vi.fn(async () => {});
    mockedUseAuth.mockReturnValue(makeAuth(role) as never);
    mockedUseCoreData.mockReturnValue(
      makeCoreData({
        loading: false,
        error: "Runtime data sync failed",
        refresh,
      }) as never,
    );

    renderRoute(Component);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText("Runtime data sync failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry data sync/i }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("removes admin reply triage queue panel and keeps campaign panel stretched", () => {
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);

    renderRoute(AdminDashboardPage);

    expect(screen.queryByText("Reply triage queue")).not.toBeInTheDocument();
    const campaignSection = screen.getByText("Campaign momentum").closest("section");
    expect(campaignSection?.className).toContain("xl:row-span-2");
  });

  it("removes manager reply triage panel and keeps campaign watchlist stretched", () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);

    renderRoute(ManagerDashboardPage);

    expect(screen.queryByText("Reply triage")).not.toBeInTheDocument();
    const watchlistSection = screen.getByText("Campaign watchlist").closest("section");
    expect(watchlistSection?.className).toContain("xl:row-span-2");
  });
});
