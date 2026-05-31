import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCampaignsPage } from "../client-campaigns-page";
import { ClientDashboardPage } from "../client-dashboard-page";
import { ClientStatisticsPage } from "../client-statistics-page";
import { useAuth } from "../../providers/auth";
import { useCoreData } from "../../providers/core-data";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(),
}));

// ClientDashboardPage (Phase 2A) loads via repository.loadClientDashboard — mock it.
// Synchronous factory; provide a stub RepositoryError so instanceof checks in mapDashboardError work.
vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "dashboard"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadClientDashboard: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseCoreData = vi.mocked(useCoreData);
const mockedRepo = vi.mocked(repository);

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
    users: [], clients: [], clientUsers: [], campaigns: [], leads: [], replies: [],
    campaignDailyStats: [], dailyStats: [], domains: [], invoices: [], emailExcludeList: [],
    loading: false, error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}), updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}), updateDomain: vi.fn(async () => {}),
    updateInvoice: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
    upsertEmailExcludeDomain: vi.fn(async () => {}),
    deleteEmailExcludeDomain: vi.fn(async () => {}),
  };
  return { ...base, ...overrides };
}

const emptyClientDashboard = {
  client: { id: "client-1", name: "Client One", status: null, kpi_leads: null, kpi_meetings: null, prospects_added: null },
  campaigns: [], leadProjections: [], campaignDailyStats: [], dailyStats: [],
};

function renderPage(Component: () => JSX.Element) {
  return render(<MemoryRouter><Component /></MemoryRouter>);
}

type LegacyHookCase = {
  name: string;
  Component: () => JSX.Element;
  loadingTitle: string;
  errorTitle: string;
  loadedTitle: string;
};

// Legacy client pages still served through CoreDataProvider (LegacySnapshotOutlet).
const LEGACY_CASES: LegacyHookCase[] = [
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
    // Dashboard repo hangs indefinitely — keeps loading state for sync loading checks.
    mockedRepo.loadClientDashboard.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Legacy non-dashboard client pages ──────────────────────────────────────────────────────

  it.each(LEGACY_CASES)("rerenders $name from loading to loaded without crashing", ({ Component, loadingTitle, loadedTitle }) => {
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: true, error: null }) as never);

    const view = renderPage(Component);
    expect(screen.getByText(loadingTitle)).toBeInTheDocument();

    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);
    view.rerender(<MemoryRouter><Component /></MemoryRouter>);

    expect(screen.queryByText(loadingTitle)).not.toBeInTheDocument();
    expect(screen.getByText(loadedTitle)).toBeInTheDocument();
  });

  it.each(LEGACY_CASES)("rerenders $name from error to loaded without crashing", ({ Component, errorTitle, loadedTitle }) => {
    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: "Data sync failed" }) as never);

    const view = renderPage(Component);
    expect(screen.getByText(errorTitle)).toBeInTheDocument();

    mockedUseCoreData.mockReturnValue(makeCoreData({ loading: false, error: null }) as never);
    view.rerender(<MemoryRouter><Component /></MemoryRouter>);

    expect(screen.queryByText(errorTitle)).not.toBeInTheDocument();
    expect(screen.getByText(loadedTitle)).toBeInTheDocument();
  });

  // ── Client dashboard (Phase 2A: per-page loader, no CoreDataProvider) ─────────────────────

  it("renders client dashboard loading state", () => {
    // Repo hangs (set in beforeEach) → hook stays in loading:true state.
    renderPage(ClientDashboardPage);
    expect(screen.getByText("Loading dashboard")).toBeInTheDocument();
  });

  it("renders client dashboard error state", async () => {
    // Use a distinct error message to avoid collision with the PortalErrorState title.
    mockedRepo.loadClientDashboard.mockRejectedValue(new Error("Simulated fetch failure"));
    renderPage(ClientDashboardPage);
    // Flush the rejected promise + resulting state update.
    await act(async () => {});
    // PortalErrorState renders the error string as its description paragraph.
    expect(screen.getByText("Simulated fetch failure")).toBeInTheDocument();
  });

  it("renders client dashboard loaded state", async () => {
    mockedRepo.loadClientDashboard.mockResolvedValue(emptyClientDashboard as never);
    renderPage(ClientDashboardPage);
    await act(async () => {});
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("applies the dashboard timeframe to client monthly charts", async () => {
    // Fake only Date so waitFor / act still use real timers internally.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-26T12:00:00.000Z"));

    mockedRepo.loadClientDashboard.mockResolvedValue({
      client: { id: "client-1", name: "Client One", status: null, kpi_leads: null, kpi_meetings: null, prospects_added: 0 },
      campaigns: [
        { id: "campaign-1", name: "Primary Campaign", status: "active", database_size: 0 },
      ],
      leadProjections: [],
      campaignDailyStats: [
        { campaign_id: "campaign-1", report_date: "2026-04-28", sent_count: 100, reply_count: 10, bounce_count: 1, unique_open_count: null, positive_replies_count: null },
        { campaign_id: "campaign-1", report_date: "2026-05-24", sent_count: 70, reply_count: 7, bounce_count: 0, unique_open_count: null, positive_replies_count: null },
      ],
      dailyStats: [
        { client_id: "client-1", report_date: "2026-04-28", mql_count: 5, prospects_count: 80, emails_sent: 100, response_count: 10, bounce_count: 1, negative_count: null, ooo_count: null, human_replies_count: null, schedule_today: null, schedule_tomorrow: null, schedule_day_after: null },
        { client_id: "client-1", report_date: "2026-05-24", mql_count: 2, prospects_count: 120, emails_sent: 70, response_count: 7, bounce_count: 0, negative_count: null, ooo_count: null, human_replies_count: null, schedule_today: null, schedule_tomorrow: null, schedule_day_after: null },
      ],
    } as never);

    renderPage(ClientDashboardPage);
    await act(async () => {});

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
