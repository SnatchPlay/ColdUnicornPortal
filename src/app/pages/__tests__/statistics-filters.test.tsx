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
    const today = "2026-04-20";
    const core = {
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
          created_at: `${today}T00:00:00.000Z`,
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
          created_at: `${today}T00:00:00.000Z`,
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
          inboxes_active: 1,
          positive_replies_count: 2,
          created_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "stat-b",
          campaign_id: "camp-b",
          report_date: today,
          sent_count: 80,
          reply_count: 4,
          bounce_count: 2,
          unique_open_count: 8,
          inboxes_active: 1,
          positive_replies_count: 1,
          created_at: `${today}T00:00:00.000Z`,
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
});
