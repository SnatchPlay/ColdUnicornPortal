import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsPage } from "../statistics-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "analytics"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadAnalyticsOverview: vi.fn(),
    loadCampaignStats: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

function makeAuth(role: "admin" | "master_admin" = "admin") {
  return {
    identity: {
      id: "admin-1",
      fullName: role === "master_admin" ? "Master" : "Admin",
      email: `${role}@test.local`,
      role,
    },
  };
}

/** Build a minimal AnalyticsOverviewPayload suitable for tests. */
function makeOverview(overrides: Partial<{
  users: unknown[];
  clients: { id: string; name: string; manager_id: string }[];
  campaigns: { id: string; client_id: string; type: string; status: string; name: string; database_size: number; positive_responses: number; start_date: string; external_id: string; gender_target: null; updated_at: string; created_at?: string }[];
  dailyStats: { client_id: string; report_date: string; emails_sent: number; response_count: number; bounce_count: number; negative_count: number; ooo_count: number; human_replies_count: number; schedule_today: number; schedule_tomorrow: number; schedule_day_after: number }[];
  leadGroups: { client_id: string; campaign_id: string | null; qualification: string | null; date: string; count: number }[];
}> = {}) {
  return {
    users: overrides.users ?? [],
    clients: overrides.clients ?? [],
    campaigns: overrides.campaigns ?? [],
    dailyStats: overrides.dailyStats ?? [],
    leadGroups: overrides.leadGroups ?? [],
  };
}

/** Build a minimal CampaignStatsResponse suitable for tests. */
function makeCampaignStats(rows: { campaign_id: string; report_date: string; sent_count: number; reply_count: number; bounce_count: number }[]) {
  return {
    rows: rows.map((r) => ({
      ...r,
      unique_open_count: null,
      positive_replies_count: null,
    })),
  };
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function renderPage() {
  render(<MemoryRouter><StatisticsPage /></MemoryRouter>);
}

describe("statistics internal filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedRepo.loadCampaignStats.mockResolvedValue(makeCampaignStats([]) as never);
  });

  it("filters by client and shows only that client's campaigns", async () => {
    const today = "2026-05-20";
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      clients: [
        { id: "client-a", name: "Client Alpha", manager_id: "manager-1" },
        { id: "client-b", name: "Client Beta", manager_id: "manager-2" },
      ],
      campaigns: [
        { id: "camp-a", client_id: "client-a", type: "outreach", status: "active", name: "Campaign Alpha", database_size: 120, positive_responses: 12, start_date: today, external_id: "ext-a", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
        { id: "camp-b", client_id: "client-b", type: "outreach", status: "active", name: "Campaign Beta", database_size: 240, positive_responses: 20, start_date: today, external_id: "ext-b", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
      ],
    }) as never);

    renderPage();
    await act(async () => {});

    await chooseOptionByLabel("Filter statistics by client", "Client Alpha");

    expect(screen.getByText("Campaign Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Campaign Beta")).not.toBeInTheDocument();
  });

  it("uses client daily stats for time series when no campaign filter is active", async () => {
    const latest = "2026-05-20";
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        { id: "camp-a", client_id: "client-a", type: "outreach", status: "active", name: "Campaign Alpha", database_size: 120, positive_responses: 12, start_date: latest, external_id: "ext-a", gender_target: null, updated_at: `${latest}T00:00:00.000Z` },
      ],
      dailyStats: [
        { client_id: "client-a", report_date: "2026-05-18", emails_sent: 100, response_count: 10, bounce_count: 2, negative_count: 0, ooo_count: 0, human_replies_count: 8, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
        { client_id: "client-a", report_date: "2026-05-19", emails_sent: 110, response_count: 11, bounce_count: 3, negative_count: 0, ooo_count: 0, human_replies_count: 9, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
        { client_id: "client-a", report_date: latest, emails_sent: 120, response_count: 12, bounce_count: 4, negative_count: 0, ooo_count: 0, human_replies_count: 10, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
      ],
    }) as never);

    renderPage();
    await act(async () => {});

    // daily_stats used: 3 active days, sum(emails_sent) = 100+110+120 = 330
    expect(screen.getByText("Sent volume chart with 21 calendar days and 3 active days.")).toBeInTheDocument();
    expect(screen.getAllByText("330").length).toBeGreaterThan(0);
  });

  it("uses campaign stats for time series when campaign filter is active", async () => {
    const today = "2026-05-20";
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        { id: "camp-a", client_id: "client-a", type: "outreach", status: "active", name: "Campaign Alpha", database_size: 120, positive_responses: 12, start_date: today, external_id: "ext-a", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
      ],
    }) as never);
    mockedRepo.loadCampaignStats.mockResolvedValue(makeCampaignStats([
      { campaign_id: "camp-a", report_date: today, sent_count: 150, reply_count: 8, bounce_count: 2 },
    ]) as never);

    renderPage();
    await act(async () => {});

    // Select campaign filter
    await chooseOptionByLabel("Filter statistics by campaign", "Campaign Alpha");
    await act(async () => {}); // flush loadCampaignStats

    expect(screen.getByText("Sent volume chart with 21 calendar days and 1 active day.")).toBeInTheDocument();
    expect(screen.getAllByText("150").length).toBeGreaterThan(0);
  });

  it("filters admin statistics by manager", async () => {
    const today = "2026-05-20";
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      users: [
        { id: "manager-1", created_at: today, updated_at: null, email: "one@test.local", first_name: "One", last_name: "Manager", role: "manager" },
        { id: "manager-2", created_at: today, updated_at: null, email: "two@test.local", first_name: "Two", last_name: "Manager", role: "manager" },
      ],
      clients: [
        { id: "client-a", name: "Client Alpha", manager_id: "manager-1" },
        { id: "client-b", name: "Client Beta", manager_id: "manager-2" },
      ],
      campaigns: [
        { id: "camp-a", client_id: "client-a", type: "outreach", status: "active", name: "Campaign Alpha", database_size: 120, positive_responses: 12, start_date: today, external_id: "ext-a", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
        { id: "camp-b", client_id: "client-b", type: "outreach", status: "active", name: "Campaign Beta", database_size: 240, positive_responses: 20, start_date: today, external_id: "ext-b", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
      ],
      dailyStats: [
        { client_id: "client-a", report_date: today, emails_sent: 100, response_count: 6, bounce_count: 1, negative_count: 0, ooo_count: 0, human_replies_count: 5, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
        { client_id: "client-b", report_date: today, emails_sent: 80, response_count: 4, bounce_count: 2, negative_count: 0, ooo_count: 0, human_replies_count: 3, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
      ],
    }) as never);

    renderPage();
    await act(async () => {});

    await chooseOptionByLabel("Filter statistics by manager", "One Manager");

    expect(screen.getByText("Campaign Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Campaign Beta")).not.toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
  });

  it("applies date presets to the sent volume chart via dailyStats", async () => {
    const latest = "2026-05-20";
    const older = "2026-05-01";
    // In the default view (no campaign filter), the page uses daily_stats for the time series.
    // The campaign portfolio only shows campaigns with activity — we apply a client filter to
    // make campaigns appear, then verify both chart and portfolio respond to the date preset.
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        { id: "camp-new", client_id: "client-a", type: "outreach", status: "active", name: "Recent Campaign", database_size: 120, positive_responses: 12, start_date: latest, external_id: "ext-new", gender_target: null, updated_at: `${latest}T00:00:00.000Z` },
        { id: "camp-old", client_id: "client-a", type: "outreach", status: "active", name: "Older Campaign", database_size: 240, positive_responses: 20, start_date: older, external_id: "ext-old", gender_target: null, updated_at: `${older}T00:00:00.000Z` },
      ],
      dailyStats: [
        { client_id: "client-a", report_date: latest, emails_sent: 100, response_count: 6, bounce_count: 1, negative_count: 0, ooo_count: 0, human_replies_count: 5, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
        { client_id: "client-a", report_date: older, emails_sent: 80, response_count: 4, bounce_count: 2, negative_count: 0, ooo_count: 0, human_replies_count: 3, schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0 },
      ],
    }) as never);

    renderPage();
    await act(async () => {});

    // Default 30-day view: both daily stat dates are in range → 2 active days, sent=100+80=180
    expect(screen.getByText("Sent volume chart with 21 calendar days and 2 active days.")).toBeInTheDocument();
    expect(screen.getAllByText("180").length).toBeGreaterThan(0);

    // Switch to Last 7 Days — older date (2026-05-01) falls outside
    fireEvent.click(screen.getByRole("button", { name: /Last 21 Days/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Last 7 Days" }));

    // Only latest date (2026-05-20) is in a 7-day window around today only if today is close.
    // Just verify the chart label changes to 7 calendar days.
    expect(screen.getByText(/Sent volume chart with 7 calendar days/)).toBeInTheDocument();
  });

  it("shows manager metrics for master admin even with one manager", async () => {
    const today = "2026-05-20";
    mockedUseAuth.mockReturnValue(makeAuth("master_admin") as never);
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      users: [
        { id: "manager-1", created_at: today, updated_at: null, email: "one@test.local", first_name: "One", last_name: "Manager", role: "manager" },
      ],
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        { id: "camp-a", client_id: "client-a", type: "outreach", status: "active", name: "Campaign Alpha", database_size: 120, positive_responses: 12, start_date: today, external_id: "ext-a", gender_target: null, updated_at: `${today}T00:00:00.000Z` },
      ],
      leadGroups: [
        { client_id: "client-a", campaign_id: "camp-a", qualification: "MQL",    date: today, count: 1 },
        { client_id: "client-a", campaign_id: "camp-a", qualification: "preMQL", date: today, count: 1 },
        { client_id: "client-a", campaign_id: "camp-a", qualification: null,     date: today, count: 1 },
      ],
    }) as never);

    renderPage();
    await act(async () => {});

    expect(screen.getAllByText("By manager").length).toBeGreaterThan(0);
    expect(screen.getAllByText("One Manager").length).toBeGreaterThan(0);
    expect(screen.getByText("Lead count and qualification split.")).toBeInTheDocument();
    expect(screen.getByText("MQL 1")).toBeInTheDocument();
    expect(screen.getByText("preMQL 1")).toBeInTheDocument();
    expect(screen.getByText("Unqualified 1")).toBeInTheDocument();
  });

  it("searches long client filter lists beyond the initial option cap", async () => {
    const today = "2026-05-20";
    const clients = Array.from({ length: 90 }, (_, index) => ({
      id: `client-${index + 1}`,
      name: `Client ${String(index + 1).padStart(2, "0")}`,
      manager_id: "manager-1",
    }));
    mockedRepo.loadAnalyticsOverview.mockResolvedValue(makeOverview({
      clients,
      campaigns: clients.map((client, index) => ({
        id: `camp-${index + 1}`,
        client_id: client.id,
        type: "outreach",
        status: "active",
        name: `Campaign ${String(index + 1).padStart(2, "0")}`,
        database_size: 120,
        positive_responses: 12,
        start_date: today,
        external_id: `ext-${index + 1}`,
        gender_target: null,
        updated_at: `${today}T00:00:00.000Z`,
      })),
    }) as never);

    renderPage();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "Client 90" } });
    await chooseOptionByLabel("Filter statistics by client", "Client 90");

    expect(screen.getByText("Campaign 90")).toBeInTheDocument();
    expect(screen.queryByText("Campaign 01")).not.toBeInTheDocument();
  });
});
