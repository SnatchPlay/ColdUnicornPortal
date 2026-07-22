import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsPage } from "../leads-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "leads"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadLeadsList: vi.fn(),
    loadLeadDetail: vi.fn(),
    loadLeadsFilterOptions: vi.fn(),
    createLead: vi.fn(),
    updateLead: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

function makeAuth() {
  return { identity: { id: "manager-1", fullName: "Manager", email: "manager@test.local", role: "manager" } };
}

function getDateKey(offset: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeRows(count: number, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => {
    const idx = startIndex + i + 1;
    const dateKey = getDateKey(-Math.min(i, 29));
    return {
      id: `lead-${idx}`,
      created_at: `${dateKey}T10:00:00.000Z`,
      updated_at: `${dateKey}T10:00:00.000Z`,
      client_id: "client-1",
      campaign_id: "camp-1",
      email: `lead${idx}@test.local`,
      first_name: "Lead",
      last_name: `${idx}`,
      job_title: null, company_name: `Company ${idx}`, linkedin_url: null, gender: null,
      qualification: null, external_id: null, phone_number: null,
      phone_source: null, industry: null, headcount_range: null, website: null, country: "PL",
      message_title: null, message_number: 1, response_time_hours: null, response_time_label: null,
      meeting_booked: false, meeting_held: false, offer_sent: false, won: false,
      external_blacklist_id: null, external_domain_blacklist_id: null,
      source: "test", reply_text: null, client_note: null, coldunicorn_note: null, highlight: null,
      sequencer_id: "00000000-0000-4000-a000-000000000002", linkedin_invitation_sent_at: null,
      contact_made_at: null, contact_method: null, negotiation_started_at: null,
      conclusion: null, concluded_at: null, final_outcome: null,
      clientName: "Acme", campaignName: "Campaign 1", replyCount: 0, lastReplyAt: null,
    };
  });
}

function makeResponse(rows: ReturnType<typeof makeRows>, totalCount: number) {
  return { rows, totalCount, stageCounts: {} };
}

describe("leads pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedRepo.loadLeadDetail.mockResolvedValue({ replies: [] });
    mockedRepo.loadLeadsFilterOptions.mockResolvedValue({ clientsLite: [], campaignsLite: [] });
  });

  it("shows first page and moves to next page", async () => {
    // Page 1: 50 rows, totalCount 75
    mockedRepo.loadLeadsList.mockResolvedValueOnce(makeResponse(makeRows(50), 75));
    // Page 2: 25 rows, totalCount 75
    mockedRepo.loadLeadsList.mockResolvedValue(makeResponse(makeRows(25, 50), 75));

    render(<MemoryRouter><LeadsPage /></MemoryRouter>);
    await act(async () => {});

    expect(screen.getByText("50 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Go to next page" }));
    await act(async () => {});

    expect(screen.getByText("25 of 75 leads in current scope")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("calls loadLeadsList with incremented page on next page click", async () => {
    mockedRepo.loadLeadsList.mockResolvedValue(makeResponse(makeRows(50), 75));

    render(<MemoryRouter><LeadsPage /></MemoryRouter>);
    await act(async () => {});

    fireEvent.click(screen.getByRole("link", { name: "Go to next page" }));
    await act(async () => {});

    const lastCall = mockedRepo.loadLeadsList.mock.calls.at(-1)?.[0];
    expect(lastCall?.page).toBe(2);
  });
});
