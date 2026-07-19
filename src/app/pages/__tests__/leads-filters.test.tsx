import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsPage } from "../leads-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

// LeadsPage (Phase 4) loads via repository.loadLeadsList — mock the whole module.
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

function getDateKey(offset: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeRow(overrides: Partial<{
  id: string; campaignId: string | null; qualification: string | null;
  firstName: string; campaignName: string | null; clientName: string;
}> = {}) {
  const today = getDateKey(0);
  return {
    id: overrides.id ?? "lead-1",
    created_at: `${today}T10:00:00.000Z`,
    updated_at: `${today}T10:00:00.000Z`,
    client_id: "client-1",
    campaign_id: overrides.campaignId ?? "camp-a",
    email: `${overrides.id ?? "lead-1"}@test.local`,
    first_name: overrides.firstName ?? overrides.id ?? "Lead",
    last_name: "User",
    job_title: null, company_name: null, linkedin_url: null, gender: null,
    qualification: overrides.qualification ?? null,
    expected_return_date: null, external_id: null, phone_number: null, phone_source: null,
    industry: null, headcount_range: null, website: null, country: null,
    message_title: null, message_number: null, response_time_hours: null, response_time_label: null,
    meeting_booked: false, meeting_held: false, offer_sent: false, won: false,
    added_to_ooo_campaign: false, external_blacklist_id: null, external_domain_blacklist_id: null,
    source: "test", reply_text: null, client_note: null, coldunicorn_note: null, highlight: null,
    sequencer_id: "00000000-0000-4000-a000-000000000002", linkedin_invitation_sent_at: null,
    contact_made_at: null, contact_method: null, negotiation_started_at: null,
    conclusion: null, concluded_at: null, final_outcome: null,
    clientName: overrides.clientName ?? "Acme",
    campaignName: overrides.campaignName ?? "Campaign Alpha",
    replyCount: 0, lastReplyAt: null,
  };
}

function makeResponse(rows: ReturnType<typeof makeRow>[], extras?: { stageCounts?: Record<string, number>; totalCount?: number }) {
  return {
    rows,
    totalCount: extras?.totalCount ?? rows.length,
    stageCounts: extras?.stageCounts ?? {},
  };
}

async function renderPage() {
  render(<MemoryRouter><LeadsPage /></MemoryRouter>);
  await act(async () => {});
}

describe("internal leads filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      identity: { id: "manager-1", fullName: "Manager User", email: "manager@test.local", role: "manager" },
    } as never);
    mockedRepo.loadLeadDetail.mockResolvedValue({ replies: [] });
    mockedRepo.loadLeadsFilterOptions.mockResolvedValue({
      clientsLite: [{ id: "client-1", name: "Acme" }],
      campaignsLite: [
        { id: "camp-a", name: "Campaign Alpha", clientId: "client-1" },
        { id: "camp-b", name: "Campaign Beta", clientId: "client-1" },
      ],
    });
  });

  it("supports combined reply/campaign/stage filters", async () => {
    // First call: 3 rows (no filters)
    mockedRepo.loadLeadsList.mockResolvedValueOnce(makeResponse([
      makeRow({ id: "lead-mql", campaignId: "camp-a", qualification: "MQL", firstName: "lead-mql", campaignName: "Campaign Alpha" }),
      makeRow({ id: "lead-ooo", campaignId: "camp-b", qualification: "OOO", firstName: "lead-ooo", campaignName: "Campaign Beta" }),
      makeRow({ id: "lead-pre", campaignId: "camp-a", qualification: "preMQL", firstName: "lead-pre", campaignName: "Campaign Alpha" }),
    ], { stageCounts: { MQL: 1, preMQL: 1 } }));

    // OOO replyScope call: only ooo row
    mockedRepo.loadLeadsList.mockResolvedValueOnce(makeResponse([
      makeRow({ id: "lead-ooo", campaignId: "camp-b", qualification: "OOO", firstName: "lead-ooo", campaignName: "Campaign Beta" }),
    ], { stageCounts: {} }));

    // OOO + MQL stage call: 0 rows
    mockedRepo.loadLeadsList.mockResolvedValueOnce(makeResponse([], { stageCounts: {} }));

    // All + campaign Alpha call: 2 rows
    mockedRepo.loadLeadsList.mockResolvedValue(makeResponse([
      makeRow({ id: "lead-mql", campaignId: "camp-a", qualification: "MQL", firstName: "lead-mql", campaignName: "Campaign Alpha" }),
      makeRow({ id: "lead-pre", campaignId: "camp-a", qualification: "preMQL", firstName: "lead-pre", campaignName: "Campaign Alpha" }),
    ], { stageCounts: { MQL: 1, preMQL: 1 } }));

    await renderPage();

    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(3);

    // Filter to OOO only.
    const oooTrigger = screen.getByLabelText("Filter leads by OOO qualification");
    fireEvent.click(oooTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "OOO only" }));
    await act(async () => {});

    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /lead-ooo/i })).toBeInTheDocument();

    // Stage filter MQL while ooo scope is on → no results.
    fireEvent.click(screen.getByRole("button", { name: /^MQL \(/i }));
    await act(async () => {});

    expect(screen.getByText("No leads match the current filters")).toBeInTheDocument();

    // Reset replyScope + filter campaign Alpha.
    const allTrigger = screen.getByLabelText("Filter leads by OOO qualification");
    fireEvent.click(allTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "All leads" }));
    await act(async () => {});

    const campTrigger = screen.getByLabelText("Filter leads by campaign");
    fireEvent.click(campTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Campaign Alpha" }));
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /All \(\d+\)/i }));
    await act(async () => {});

    expect(screen.getAllByRole("button", { name: /Open details for/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /lead-ooo/i })).not.toBeInTheDocument();
  });

  it("calls loadLeadsList with correct replyScope param when OOO filter is selected", async () => {
    mockedRepo.loadLeadsList.mockResolvedValue(makeResponse([]));

    await renderPage();

    const trigger = screen.getByLabelText("Filter leads by OOO qualification");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "OOO only" }));
    await act(async () => {});

    const lastCall = mockedRepo.loadLeadsList.mock.calls.at(-1)?.[0];
    expect(lastCall?.replyScope).toBe("ooo");
  });
});
