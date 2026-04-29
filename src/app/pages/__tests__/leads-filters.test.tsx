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

function makeLead(
  id: string,
  campaignId: string,
  qualification: string | null,
  createdDate: string,
) {
  return {
    id,
    created_at: `${createdDate}T10:00:00.000Z`,
    updated_at: `${createdDate}T10:00:00.000Z`,
    client_id: "client-1",
    campaign_id: campaignId,
    email: `${id}@test.local`,
    first_name: id,
    last_name: "Lead",
    job_title: "Owner",
    company_name: "Company",
    linkedin_url: null,
    gender: null,
    qualification,
    expected_return_date: null,
    external_id: null,
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
  };
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("internal leads filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      identity: {
        id: "manager-1",
        fullName: "Manager User",
        email: "manager@test.local",
        role: "manager",
      },
    } as never);
  });

  it("supports combined reply/campaign/stage filters", async () => {
    const today = getDateKey(0);
    const core = {
      clients: [{ id: "client-1", name: "Acme", manager_id: "manager-1" }],
      campaigns: [
        {
          id: "camp-a",
          client_id: "client-1",
          type: "outreach",
          status: "active",
          name: "Campaign Alpha",
          database_size: 100,
          positive_responses: 2,
          start_date: today,
          external_id: "ext-a",
          gender_target: null,
          created_at: `${today}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
        {
          id: "camp-b",
          client_id: "client-1",
          type: "outreach",
          status: "active",
          name: "Campaign Beta",
          database_size: 100,
          positive_responses: 2,
          start_date: today,
          external_id: "ext-b",
          gender_target: null,
          created_at: `${today}T00:00:00.000Z`,
          updated_at: `${today}T00:00:00.000Z`,
        },
      ],
      leads: [
        makeLead("lead-mql", "camp-a", "MQL", today),
        makeLead("lead-ooo", "camp-b", "OOO", today),
        makeLead("lead-pre", "camp-a", "preMQL", today),
      ],
      replies: [],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
      updateLead: vi.fn(async () => {}),
    };

    mockedUseCoreData.mockReturnValue(core as never);

    render(
      <MemoryRouter>
        <LeadsPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(3);

    await chooseOptionByLabel("Filter leads by OOO qualification", "OOO only");
    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /lead-ooo Lead/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /^MQL \(/i }));
    expect(screen.getByText("No leads match the current filters")).toBeInTheDocument();

    await chooseOptionByLabel("Filter leads by OOO qualification", "All leads");
    await chooseOptionByLabel("Filter leads by campaign", "Campaign Alpha");
    fireEvent.click(screen.getByRole("radio", { name: /All \(\d+\)/i }));
    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /lead-ooo Lead/i })).not.toBeInTheDocument();
  });
});
