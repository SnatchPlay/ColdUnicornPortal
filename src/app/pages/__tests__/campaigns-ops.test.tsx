import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignsPage } from "../campaigns-page";
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

function getDateKey(daysOffset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function makeAuth(role: "admin" | "manager" = "manager") {
  return {
    identity: {
      id: role === "admin" ? "admin-1" : "manager-1",
      fullName: role === "admin" ? "Admin User" : "Manager User",
      email: role === "admin" ? "admin@test.local" : "manager@test.local",
      role,
    },
  };
}

function makeCoreData(overrides?: Record<string, unknown>) {
  const today = getDateKey(0);
  const oneDayAgo = getDateKey(-1);

  const base = {
    users: [],
    clients: [
      {
        id: "client-1",
        name: "Acme",
        manager_id: "manager-1",
      },
    ],
    clientUsers: [],
    campaigns: [
      {
        id: "campaign-1",
        name: "Outreach A",
        type: "outreach",
        status: "active",
        positive_responses: 12,
        database_size: 3500,
        start_date: oneDayAgo,
        external_id: "ext-camp-1",
        gender_target: "all",
        client_id: "client-1",
        created_at: `${oneDayAgo}T00:00:00.000Z`,
        updated_at: `${today}T00:00:00.000Z`,
      },
    ],
    leads: [],
    replies: [],
    campaignDailyStats: [
      {
        id: "stat-1",
        campaign_id: "campaign-1",
        report_date: today,
        sent_count: 100,
        reply_count: 8,
        bounce_count: 2,
      },
    ],
    dailyStats: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
  };

  return {
    ...base,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>,
  );
}

function openCampaignDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach A" }));
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("campaigns drawer operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
  });

  it("opens campaign drawer from table row click", () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    openCampaignDrawer();

    expect(screen.getByRole("dialog", { name: "Outreach A details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("saves campaign draft changes from drawer", async () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openCampaignDrawer();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Outreach A Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(core.updateCampaign).toHaveBeenCalledTimes(1);
    });
    expect(core.updateCampaign).toHaveBeenCalledWith("campaign-1", expect.objectContaining({ name: "Outreach A Updated" }));
  });

  it("renders campaign chart in drawer when stats are available", () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    const { container } = renderPage();
    openCampaignDrawer();

    expect(screen.queryByText("No daily metrics yet")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-responsive-container").length).toBeGreaterThan(0);
  });

  it("applies search, status, and client filters before opening details", async () => {
    const today = getDateKey(0);
    const oneDayAgo = getDateKey(-1);
    const core = makeCoreData({
      clients: [
        { id: "client-1", name: "Acme", manager_id: "manager-1" },
        { id: "client-2", name: "Bravo", manager_id: "manager-1" },
      ],
      campaigns: [
        {
          id: "campaign-1",
          name: "Outreach A",
          type: "outreach",
          status: "active",
          positive_responses: 12,
          database_size: 3500,
          start_date: oneDayAgo,
          external_id: "ext-camp-1",
          gender_target: "all",
          client_id: "client-1",
          created_at: `${oneDayAgo}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "campaign-2",
          name: "Outreach B",
          type: "outreach",
          status: "stopped",
          positive_responses: 6,
          database_size: 1200,
          start_date: today,
          external_id: "ext-camp-2",
          gender_target: "all",
          client_id: "client-2",
          created_at: `${oneDayAgo}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      campaignDailyStats: [
        {
          id: "stat-1",
          campaign_id: "campaign-1",
          report_date: oneDayAgo,
          sent_count: 100,
          reply_count: 8,
          bounce_count: 2,
        },
        {
          id: "stat-2",
          campaign_id: "campaign-2",
          report_date: today,
          sent_count: 80,
          reply_count: 3,
          bounce_count: 1,
        },
      ],
    });
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search campaign name or external id"), { target: { value: "Outreach B" } });
    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open details for Outreach B" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search campaign name or external id"), { target: { value: "" } });
    await chooseOptionByLabel("Filter campaigns by status", "active");
    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open details for Outreach A" })).toBeInTheDocument();

    await chooseOptionByLabel("Filter campaigns by status", "All statuses");
    await chooseOptionByLabel("Filter campaigns by client", "Bravo");
    fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach B" }));
    expect(screen.getByRole("dialog", { name: "Outreach B details" })).toBeInTheDocument();
  });
});
