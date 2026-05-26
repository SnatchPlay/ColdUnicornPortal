import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsPage } from "../statistics-page";
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

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("statistics internal filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      identity: {
        id: "admin-1",
        fullName: "Admin",
        email: "admin@test.local",
        role: "admin",
      },
    } as never);
  });

  it("filters by client and opens campaign details from portfolio", async () => {
    const today = "2026-05-20";
    const core = {
      users: [],
      clients: [
        { id: "client-a", name: "Client Alpha", manager_id: "manager-1" },
        { id: "client-b", name: "Client Beta", manager_id: "manager-2" },
      ],
      campaigns: [
        {
          id: "camp-a",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Campaign Alpha",
          database_size: 120,
          positive_responses: 12,
          start_date: today,
          external_id: "ext-a",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "camp-b",
          client_id: "client-b",
          type: "outreach",
          status: "active",
          name: "Campaign Beta",
          database_size: 240,
          positive_responses: 20,
          start_date: today,
          external_id: "ext-b",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      leads: [],
      campaignDailyStats: [
        {
          id: "stat-a",
          campaign_id: "camp-a",
          report_date: today,
          sent_count: 100,
          reply_count: 6,
          bounce_count: 1,
          unique_open_count: 10,
          positive_replies_count: 2,
        },
        {
          id: "stat-b",
          campaign_id: "camp-b",
          report_date: today,
          sent_count: 80,
          reply_count: 4,
          bounce_count: 2,
          unique_open_count: 8,
          positive_replies_count: 1,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    };

    mockedUseCoreData.mockReturnValue(core as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    await chooseOptionByLabel("Filter statistics by client", "Client Alpha");
    expect(screen.getByText("Campaign Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Campaign Beta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Campaign Alpha/i }));
    expect(screen.getByRole("button", { name: "Clear campaign filter" })).toBeInTheDocument();
    expect(screen.getByText("External id")).toBeInTheDocument();
    expect(screen.getByText("ext-a")).toBeInTheDocument();
  });

  it("aggregates same-day campaign stats into one chart point", () => {
    const today = "2026-05-20";
    mockedUseCoreData.mockReturnValue({
      users: [],
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        {
          id: "camp-a",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Campaign Alpha",
          database_size: 120,
          positive_responses: 12,
          start_date: today,
          external_id: "ext-a",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "camp-b",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Campaign Beta",
          database_size: 240,
          positive_responses: 20,
          start_date: today,
          external_id: "ext-b",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      leads: [],
      campaignDailyStats: [
        {
          campaign_id: "camp-a",
          report_date: today,
          sent_count: 100,
          reply_count: 6,
          bounce_count: 1,
          unique_open_count: 10,
          positive_replies_count: 2,
        },
        {
          campaign_id: "camp-b",
          report_date: `${today}T03:00:00.000Z`,
          sent_count: 80,
          reply_count: 4,
          bounce_count: 2,
          unique_open_count: 8,
          positive_replies_count: 1,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    } as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sent volume chart with 30 calendar days and 1 active day.")).toBeInTheDocument();
    expect(screen.getByText("Signals chart with 30 calendar days and 1 active day.")).toBeInTheDocument();
    expect(screen.getByText(/Last 30 Days shows 30 calendar days; 1 active day contains campaign activity/)).toBeInTheDocument();
    expect(screen.getAllByText("180").length).toBeGreaterThan(0);
  });

  it("filters admin statistics by manager", async () => {
    const today = "2026-05-20";
    mockedUseCoreData.mockReturnValue({
      users: [
        {
          id: "manager-1",
          created_at: today,
          updated_at: null,
          email: "one@test.local",
          first_name: "One",
          last_name: "Manager",
          role: "manager",
        },
        {
          id: "manager-2",
          created_at: today,
          updated_at: null,
          email: "two@test.local",
          first_name: "Two",
          last_name: "Manager",
          role: "manager",
        },
      ],
      clients: [
        { id: "client-a", name: "Client Alpha", manager_id: "manager-1" },
        { id: "client-b", name: "Client Beta", manager_id: "manager-2" },
      ],
      campaigns: [
        {
          id: "camp-a",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Campaign Alpha",
          database_size: 120,
          positive_responses: 12,
          start_date: today,
          external_id: "ext-a",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "camp-b",
          client_id: "client-b",
          type: "outreach",
          status: "active",
          name: "Campaign Beta",
          database_size: 240,
          positive_responses: 20,
          start_date: today,
          external_id: "ext-b",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      leads: [],
      campaignDailyStats: [
        {
          campaign_id: "camp-a",
          report_date: today,
          sent_count: 100,
          reply_count: 6,
          bounce_count: 1,
          unique_open_count: 10,
          positive_replies_count: 2,
        },
        {
          campaign_id: "camp-b",
          report_date: today,
          sent_count: 80,
          reply_count: 4,
          bounce_count: 2,
          unique_open_count: 8,
          positive_replies_count: 1,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    } as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    await chooseOptionByLabel("Filter statistics by manager", "One Manager");
    expect(screen.getByText("Campaign Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Campaign Beta")).not.toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
  });

  it("applies date presets to summary metrics and campaign portfolio", async () => {
    const latest = "2026-05-20";
    const older = "2026-05-01";
    mockedUseCoreData.mockReturnValue({
      users: [],
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        {
          id: "camp-new",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Recent Campaign",
          database_size: 120,
          positive_responses: 12,
          start_date: latest,
          external_id: "ext-new",
          gender_target: null,
          updated_at: `${latest}T00:00:00.000Z`,
        },
        {
          id: "camp-old",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Older Campaign",
          database_size: 240,
          positive_responses: 20,
          start_date: older,
          external_id: "ext-old",
          gender_target: null,
          updated_at: `${older}T00:00:00.000Z`,
        },
      ],
      leads: [],
      campaignDailyStats: [
        {
          campaign_id: "camp-new",
          report_date: latest,
          sent_count: 100,
          reply_count: 6,
          bounce_count: 1,
          unique_open_count: 10,
          positive_replies_count: 2,
        },
        {
          campaign_id: "camp-old",
          report_date: older,
          sent_count: 80,
          reply_count: 4,
          bounce_count: 2,
          unique_open_count: 8,
          positive_replies_count: 1,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    } as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Recent Campaign")).toBeInTheDocument();
    expect(screen.getByText("Older Campaign")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Last 30 Days/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Last 7 Days" }));

    expect(screen.getByText("Recent Campaign")).toBeInTheDocument();
    expect(screen.queryByText("Older Campaign")).not.toBeInTheDocument();
    expect(screen.getByText("Sent volume chart with 7 calendar days and 1 active day.")).toBeInTheDocument();
    expect(screen.getByText(/Last 7 Days shows 7 calendar days; 1 active day contains campaign activity/)).toBeInTheDocument();
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
  });

  it("shows manager metrics for master admin even with one manager", () => {
    const today = "2026-05-20";
    mockedUseAuth.mockReturnValue({
      identity: {
        id: "master-1",
        fullName: "Master",
        email: "master@test.local",
        role: "master_admin",
      },
    } as never);
    mockedUseCoreData.mockReturnValue({
      users: [
        {
          id: "manager-1",
          created_at: today,
          updated_at: null,
          email: "one@test.local",
          first_name: "One",
          last_name: "Manager",
          role: "manager",
        },
      ],
      clients: [{ id: "client-a", name: "Client Alpha", manager_id: "manager-1" }],
      campaigns: [
        {
          id: "camp-a",
          client_id: "client-a",
          type: "outreach",
          status: "active",
          name: "Campaign Alpha",
          database_size: 120,
          positive_responses: 12,
          start_date: today,
          external_id: "ext-a",
          gender_target: null,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      leads: [
        {
          id: "lead-1",
          client_id: "client-a",
          campaign_id: "camp-a",
          qualification: "MQL",
          created_at: `${today}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "lead-2",
          client_id: "client-a",
          campaign_id: "camp-a",
          qualification: "preMQL",
          created_at: `${today}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "lead-3",
          client_id: "client-a",
          campaign_id: "camp-a",
          qualification: null,
          created_at: `${today}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      campaignDailyStats: [
        {
          campaign_id: "camp-a",
          report_date: today,
          sent_count: 100,
          reply_count: 6,
          bounce_count: 1,
          unique_open_count: 10,
          positive_replies_count: 2,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    } as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

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
    mockedUseCoreData.mockReturnValue({
      users: [],
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
      leads: [],
      campaignDailyStats: clients.map((client, index) => ({
        campaign_id: `camp-${index + 1}`,
        report_date: today,
        sent_count: 10,
        reply_count: 1,
        bounce_count: 0,
        unique_open_count: 2,
        positive_replies_count: 1,
      })),
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    } as never);

    render(
      <MemoryRouter>
        <StatisticsPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "Client 90" } });
    await chooseOptionByLabel("Filter statistics by client", "Client 90");
    expect(screen.getByText("Campaign 90")).toBeInTheDocument();
    expect(screen.queryByText("Campaign 01")).not.toBeInTheDocument();
  });
});
