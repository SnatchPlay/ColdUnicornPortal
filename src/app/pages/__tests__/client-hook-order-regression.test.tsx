import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientCampaignsPage } from "../client-campaigns-page";
import { ClientDashboardPage } from "../client-dashboard-page";
import { ClientStatisticsPage } from "../client-statistics-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

// ClientDashboardPage loads via repository.loadClientDashboard — mock it.
// Synchronous factory; provide a stub RepositoryError so instanceof checks in mapDashboardError work.
vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "dashboard"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadClientDashboard: vi.fn(),
    loadCampaignsList: vi.fn(),
    loadCampaignStats: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
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

const emptyClientDashboard = {
  client: { id: "client-1", name: "Client One", status: null, kpi_leads: null, kpi_meetings: null, prospects_added: null },
  campaigns: [], leadProjections: [], campaignDailyStats: [], dailyStats: [],
};

function renderPage(Component: () => JSX.Element) {
  return render(<MemoryRouter><Component /></MemoryRouter>);
}

describe("client page hook-order regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    // Dashboard repo hangs indefinitely — keeps loading state for sync loading checks.
    mockedRepo.loadClientDashboard.mockReturnValue(new Promise(() => {}));
    // Campaigns per-page loaders hang by default; individual tests override as needed.
    mockedRepo.loadCampaignsList.mockReturnValue(new Promise(() => {}));
    mockedRepo.loadCampaignStats.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Client dashboard (per-page loader) ────────────────────────────────────────────────────

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

  // ── Client campaigns (per-page loader) ─────────────────────

  it("renders client campaigns loading state", () => {
    // loadCampaignsList hangs (set in beforeEach) → hook stays in loading:true state.
    renderPage(ClientCampaignsPage);
    expect(screen.getByText("Loading campaigns")).toBeInTheDocument();
  });

  it("renders client campaigns loaded state", async () => {
    mockedRepo.loadCampaignsList.mockResolvedValue({
      rows: [], totalCount: 0,
    } as never);
    renderPage(ClientCampaignsPage);
    await act(async () => {});
    expect(screen.getByText("Campaigns")).toBeInTheDocument();
  });

  // ── Client statistics (per-page loader) ─────────────────────

  it("renders client statistics loading state", () => {
    // loadClientDashboard hangs (set in beforeEach) → hook stays in loading:true state.
    renderPage(ClientStatisticsPage);
    expect(screen.getByText("Loading analytics")).toBeInTheDocument();
  });

  it("renders client statistics loaded state", async () => {
    mockedRepo.loadClientDashboard.mockResolvedValue(emptyClientDashboard as never);
    renderPage(ClientStatisticsPage);
    await act(async () => {});
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("applies the dashboard timeframe to client monthly charts", async () => {
    // Fake only Date so waitFor / act still use real timers internally.
    vi.useFakeTimers({ toFake: ["Date"] });
    // System time: May 5, so the default month-to-date window is May 1–5 and covers only the May 4
    // row. The switch below is to "Last month" rather than "Last 7 days" on purpose: on May 5 a
    // 7-day window resolves to the same rows as month-to-date, so the assertion would pass without
    // the timeframe doing anything.
    vi.setSystemTime(new Date("2026-05-05T12:00:00.000Z"));

    mockedRepo.loadClientDashboard.mockResolvedValue({
      client: { id: "client-1", name: "Client One", status: null, kpi_leads: null, kpi_meetings: null, prospects_added: 0 },
      campaigns: [
        { id: "campaign-1", name: "Primary Campaign", status: "active", database_size: 0 },
      ],
      leadProjections: [],
      campaignDailyStats: [
        { campaign_id: "campaign-1", report_date: "2026-04-28", sent_count: 100, reply_count: 10, bounce_count: 1, unique_open_count: null, positive_replies_count: null },
        { campaign_id: "campaign-1", report_date: "2026-05-04", sent_count: 70, reply_count: 7, bounce_count: 0, unique_open_count: null, positive_replies_count: null },
      ],
      dailyStats: [
        { client_id: "client-1", report_date: "2026-04-28", mql_count: 5, prospects_count: 80, emails_sent: 100, response_count: 10, bounce_count: 1, negative_count: null, ooo_count: null, human_replies_count: null, schedule_today: null, schedule_tomorrow: null, schedule_day_after: null },
        { client_id: "client-1", report_date: "2026-05-04", mql_count: 2, prospects_count: 120, emails_sent: 70, response_count: 7, bounce_count: 0, negative_count: null, ooo_count: null, human_replies_count: null, schedule_today: null, schedule_tomorrow: null, schedule_day_after: null },
      ],
    } as never);

    renderPage(ClientDashboardPage);
    await act(async () => {});

    expect(screen.getByText("Monthly leads chart with 1 month and total 2 leads.")).toBeInTheDocument();
    expect(screen.getByText("Monthly sent chart with 1 month and total 70 emails.")).toBeInTheDocument();
    expect(screen.getByText("Monthly prospects chart with 1 month and total 40 prospects added.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Current month/i }));
    fireEvent.click(screen.getByRole("button", { name: "Last month" }));

    expect(screen.getByText("Monthly leads chart with 1 month and total 5 leads.")).toBeInTheDocument();
    expect(screen.getByText("Monthly sent chart with 1 month and total 100 emails.")).toBeInTheDocument();
    // 0, not 80: "prospects added" is a day-over-day delta computed across the whole series before
    // the timeframe filter, and April 28 is the first row, so it has no predecessor to grow from.
    expect(screen.getByText("Monthly prospects chart with 1 month and total 0 prospects added.")).toBeInTheDocument();
  });
});
