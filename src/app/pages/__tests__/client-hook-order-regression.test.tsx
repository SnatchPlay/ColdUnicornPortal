import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCampaignsPage } from "../client-campaigns-page";
import { ClientDashboardPage } from "../client-dashboard-page";
import { ClientStatisticsPage } from "../client-statistics-page";
import { useAuth } from "../../providers/auth";
import { useCoreData } from "../../providers/core-data";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseCoreData = vi.mocked(useCoreData);

function makeAuth() {
  return {
    identity: {
      id: "client-user-1",
      fullName: "Client User",
      email: "client@test.local",
      role: "client",
      clientId: "client-1",
    },
  };
}

function makeCoreData(overrides?: Record<string, unknown>) {
  const base = {
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

  return {
    ...base,
    ...overrides,
  };
}

function renderPage(Component: () => JSX.Element) {
  return render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>,
  );
}

type HookCase = {
  name: string;
  Component: () => JSX.Element;
  loadingTitle: string;
  errorTitle: string;
  loadedTitle: string;
};

const CASES: HookCase[] = [
  {
    name: "client dashboard",
    Component: ClientDashboardPage,
    loadingTitle: "Loading dashboard",
    errorTitle: "Dashboard data is unavailable",
    loadedTitle: "Dashboard",
  },
  {
    name: "client campaigns",
    Component: ClientCampaignsPage,
    loadingTitle: "Loading campaigns",
    errorTitle: "Campaign data is unavailable",
    loadedTitle: "Campaigns",
  },
  {
    name: "client statistics",
    Component: ClientStatisticsPage,
    loadingTitle: "Loading analytics",
    errorTitle: "Analytics data is unavailable",
    loadedTitle: "Analytics",
  },
];

describe("client page hook-order regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
  });

  it.each(CASES)("rerenders $name from loading to loaded without crashing", ({ Component, loadingTitle, loadedTitle }) => {
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: true, error: null }) as never);

    const view = renderPage(Component);
    expect(screen.getByText(loadingTitle)).toBeInTheDocument();

    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);
    view.rerender(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );

    expect(screen.queryByText(loadingTitle)).not.toBeInTheDocument();
    expect(screen.getByText(loadedTitle)).toBeInTheDocument();
  });

  it.each(CASES)("rerenders $name from error to loaded without crashing", ({ Component, errorTitle, loadedTitle }) => {
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: "Data sync failed" }) as never);

    const view = renderPage(Component);
    expect(screen.getByText(errorTitle)).toBeInTheDocument();

    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);
    view.rerender(
      <MemoryRouter>
        <Component />
      </MemoryRouter>,
    );

    expect(screen.queryByText(errorTitle)).not.toBeInTheDocument();
    expect(screen.getByText(loadedTitle)).toBeInTheDocument();
  });
});
