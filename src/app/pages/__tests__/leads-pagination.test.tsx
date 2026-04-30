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

function getDateKey(daysOffset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

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
  return Array.from({ length: count }, (_, index) => {
    const dateKey = getDateKey(-Math.min(index, 29));
    return {
      id: `lead-${index + 1}`,
      client_id: "client-1",
      campaign_id: "camp-1",
      first_name: `Lead`,
      last_name: `${index + 1}`,
      job_title: "Owner",
      company_name: `Company ${index + 1}`,
      linkedin_url: null,
      gender: null,
      qualification: null,
      expected_return_date: null,
      external_id: null,
      email: `lead${index + 1}@test.local`,
      phone_number: null,
      phone_source: null,
      industry: null,
      headcount_range: null,
      website: null,
      country: "PL",
      message_title: null,
      message_number: 1,
      response_time_hours: null,
      response_time_label: null,
      meeting_booked: false,
      meeting_held: false,
      offer_sent: false,
      won: false,
      added_to_ooo_campaign: false,
      external_blacklist_id: null,
      external_domain_blacklist_id: null,
      source: "test",
      reply_text: null,
      comments: null,
      created_at: `${dateKey}T10:00:00.000Z`,
      updated_at: `${dateKey}T10:00:00.000Z`,
    };
  });
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
    campaignDailyStats: [],
    dailyStats: [],
    clientUsers: [],
    leads: makeLeads(75),
    replies: [],
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

  it("shows first page and moves to next page", () => {
    render(
      <MemoryRouter>
        <LeadsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("50 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Go to next page" }));

    expect(screen.getByText("25 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});
