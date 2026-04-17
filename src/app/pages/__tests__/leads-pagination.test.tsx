import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsPage } from "../leads-page";
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
      id: "manager-1",
      fullName: "Manager",
      email: "manager@test.local",
      role: "manager",
    },
  };
}

function makeLeads(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `lead-${index + 1}`,
    client_id: "client-1",
    campaign_id: `camp-${index + 1}`,
    lead_name: `Lead ${index + 1}`,
    company_name: `Company ${index + 1}`,
    status: "Open",
    email: `lead${index + 1}@test.local`,
    updated_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
  }));
}

function makeCoreData() {
  return {
    users: [],
    clients: [
      {
        id: "client-1",
        name: "Acme",
        manager_id: "manager-1",
      },
    ],
    campaigns: [],
    leads: makeLeads(75),
    replies: [],
    campaignDailyStats: [],
    dailyStats: [],
    clientUsers: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
  };
}

describe("leads pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedUseCoreData.mockReturnValue(makeCoreData() as never);
  });

  it("shows first page and loads more leads on demand", () => {
    render(
      <MemoryRouter>
        <LeadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("50 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more leads" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more leads" }));

    expect(screen.getByText("75 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more leads" })).not.toBeInTheDocument();
  });
});