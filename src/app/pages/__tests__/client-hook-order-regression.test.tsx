import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("applies the dashboard timeframe to client monthly charts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));

    mockedUseCoreData.mockReturnValue(
      makeCoreData({
        clients: [{ id: "client-1", name: "Client One", manager_id: "manager-1", prospects_added: 0 }],
        campaigns: [
          {
            id: "campaign-1",
            client_id: "client-1",
            type: "outreach",
            status: "active",
            name: "Primary Campaign",
            database_size: 0,
          },
        ],
        campaignDailyStats: [
          {
            campaign_id: "campaign-1",
            report_date: "2026-04-28",
            sent_count: 100,
            reply_count: 10,
            bounce_count: 1,
          },
          {
            campaign_id: "campaign-1",
            report_date: "2026-05-24",
            sent_count: 70,
            reply_count: 7,
            bounce_count: 0,
          },
        ],
        dailyStats: [
          {
            client_id: "client-1",
            report_date: "2026-04-28",
            mql_count: 5,
            prospects_count: 80,
            emails_sent: 100,
            response_count: 10,
            bounce_count: 1,
          },
          {
            client_id: "client-1",
            report_date: "2026-05-24",
            mql_count: 2,
            prospects_count: 120,
            emails_sent: 70,
            response_count: 7,
            bounce_count: 0,
          },
        ],
      }) as never,
    );

    renderPage(ClientDashboardPage);

    expect(screen.getByText("Monthly leads chart with 2 months and total 7 leads.")).toBeInTheDocument();
    expect(screen.getByText("Monthly sent chart with 2 months and total 170 emails.")).toBeInTheDocument();
    expect(screen.getByText("Monthly prospects chart with 2 months and total 40 prospects added.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Last 30 Days/i }));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 Days" }));

    expect(screen.getByText("Monthly leads chart with 1 month and total 2 leads.")).toBeInTheDocument();
    expect(screen.getByText("Monthly sent chart with 1 month and total 70 emails.")).toBeInTheDocument();
    expect(screen.getByText("Monthly prospects chart with 1 month and total 40 prospects added.")).toBeInTheDocument();
  });
});
