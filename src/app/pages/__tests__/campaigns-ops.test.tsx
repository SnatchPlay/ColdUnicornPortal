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
        start_date: "2026-01-10",
        external_id: "ext-camp-1",
        gender_target: "all",
        client_id: "client-1",
        created_at: "2026-01-01",
        updated_at: "2026-01-10",
      },
    ],
    leads: [],
    replies: [],
    campaignDailyStats: [
      {
        id: "stat-1",
        campaign_id: "campaign-1",
        report_date: "2026-01-10",
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
});
