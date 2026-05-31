import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignsPage } from "../campaigns-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/shell-data", () => ({
  useShellData: vi.fn(() => ({
    clientsLite: [
      { id: "client-1", name: "Acme" },
      { id: "client-2", name: "Bravo" },
    ],
    usersLite: [], clientUsers: [], loading: false, error: null, refresh: vi.fn(),
  })),
}));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "campaigns"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadCampaignsList: vi.fn(),
    loadCampaignStats: vi.fn(),
    updateCampaign: vi.fn(),
    createCampaign: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

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

function makeCampaignRow(overrides: Partial<Record<string, unknown>> = {}) {
  const today = getDateKey(0);
  const yesterday = getDateKey(-1);
  return {
    id: "campaign-1",
    name: "Outreach A",
    type: "outreach",
    status: "active",
    positive_responses: 12,
    database_size: 3500,
    start_date: yesterday,
    external_id: "ext-camp-1",
    gender_target: null,
    client_id: "client-1",
    created_at: `${yesterday}T00:00:00.000Z`,
    updated_at: `${today}T00:00:00.000Z`,
    clientName: "Acme",
    ...overrides,
  };
}

function makeListResponse(rows: ReturnType<typeof makeCampaignRow>[]) {
  return { rows, totalCount: rows.length };
}

function makeStatsResponse() {
  const today = getDateKey(0);
  return {
    rows: [
      { campaign_id: "campaign-1", report_date: today, sent_count: 100, reply_count: 8, bounce_count: 2, unique_open_count: null, positive_replies_count: null },
    ],
  };
}

function renderPage() {
  return render(<MemoryRouter><CampaignsPage /></MemoryRouter>);
}

describe("campaigns drawer operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedRepo.loadCampaignsList.mockResolvedValue(makeListResponse([makeCampaignRow()]) as never);
    mockedRepo.loadCampaignStats.mockResolvedValue(makeStatsResponse() as never);
    mockedRepo.updateCampaign.mockResolvedValue({ id: "campaign-1" } as never);
    mockedRepo.createCampaign.mockResolvedValue({ id: "campaign-new" } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens campaign drawer from table row click", async () => {
    renderPage();
    await act(async () => {});

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach A" }));

    expect(screen.getByRole("dialog", { name: "Outreach A details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("saves campaign draft changes from drawer", async () => {
    renderPage();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach A" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Outreach A Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockedRepo.updateCampaign).toHaveBeenCalledTimes(1));
    expect(mockedRepo.updateCampaign).toHaveBeenCalledWith(
      "campaign-1",
      expect.objectContaining({ name: "Outreach A Updated" }),
    );
  });

  it("renders campaign chart in drawer when stats are available", async () => {
    const { container } = renderPage();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach A" }));
    await act(async () => {}); // flush useCampaignStats

    expect(screen.queryByText("No daily metrics yet")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-responsive-container").length).toBeGreaterThan(0);
  });

  it("applies status and client filters and opens correct drawer", async () => {
    const today = getDateKey(0);
    const yesterday = getDateKey(-1);
    const rowA = makeCampaignRow({ id: "campaign-1", name: "Outreach A", status: "active", client_id: "client-1", clientName: "Acme" });
    const rowB = makeCampaignRow({
      id: "campaign-2", name: "Outreach B", type: "outreach", status: "stopped",
      positive_responses: 6, database_size: 1200, start_date: today,
      external_id: "ext-camp-2", client_id: "client-2", clientName: "Bravo",
      created_at: `${yesterday}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z`,
    });

    // Default: both; after status=active: only A; after status reset: both; after client=Bravo: only B
    mockedRepo.loadCampaignsList
      .mockResolvedValueOnce(makeListResponse([rowA, rowB]) as never)   // initial
      .mockResolvedValueOnce(makeListResponse([rowA]) as never)          // after status=active
      .mockResolvedValueOnce(makeListResponse([rowA, rowB]) as never)   // after status reset
      .mockResolvedValue(makeListResponse([rowB]) as never);             // after client=Bravo

    renderPage();
    await act(async () => {});

    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(2);

    // Filter by status=active → only Outreach A
    const statusTrigger = screen.getByLabelText("Filter campaigns by status");
    fireEvent.click(statusTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "active" }));
    await act(async () => {});
    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open details for Outreach A" })).toBeInTheDocument();

    // Reset status filter (one step at a time to avoid mid-flight race)
    fireEvent.click(screen.getByLabelText("Filter campaigns by status"));
    fireEvent.click(await screen.findByRole("option", { name: "All statuses" }));
    await act(async () => {}); // wait for status-reset fetch to land

    // Now filter by client=Bravo
    const clientTrigger = screen.getByLabelText("Filter campaigns by client");
    fireEvent.click(clientTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Bravo" }));
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Open details for Outreach B" }));
    expect(screen.getByRole("dialog", { name: "Outreach B details" })).toBeInTheDocument();
  });
});
