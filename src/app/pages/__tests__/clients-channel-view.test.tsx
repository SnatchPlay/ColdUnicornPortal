import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPage } from "../clients-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";
import type { ClientMetricsSummary } from "../../types/view-contracts";

vi.mock("../../providers/auth", () => ({ useAuth: vi.fn() }));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "clients"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadClientsOverview: vi.fn(),
    loadTablePreferences: vi.fn().mockResolvedValue({ tableKey: "clients:mega", preferences: null, updatedAt: null }),
    saveTablePreferences: vi.fn().mockResolvedValue({ tableKey: "clients:mega", preferences: {}, updatedAt: null }),
    loadClientsStats: vi.fn(),
    loadClientsMetricsSummary: vi.fn(),
    updateClient: vi.fn(),
    sendInvite: vi.fn(),
    upsertClientUserMapping: vi.fn(),
    deleteClientUserMapping: vi.fn(),
    upsertClientCustomFieldValue: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

const ZEROS = [0, 0, 0, 0, 0];

function makeSummary(clientId: string, overrides: Partial<ClientMetricsSummary> = {}): ClientMetricsSummary {
  return {
    client_id: clientId,
    daily_sent: [...ZEROS],
    schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0,
    wow_sent: [...ZEROS], wow_human: [...ZEROS], wow_bounce: [...ZEROS],
    wow_ooo: [...ZEROS], wow_negative: [...ZEROS],
    wow_leads: [...ZEROS], wow_sql: [...ZEROS],
    mom_total: [...ZEROS], mom_sql: [...ZEROS], mom_meetings: [...ZEROS], mom_won: [...ZEROS],
    threedod_total: [...ZEROS], threedod_sql: [...ZEROS],
    latest_prospects_count: 0,
    threedod_total_eb: [...ZEROS], threedod_total_af: [...ZEROS],
    threedod_sql_eb: [...ZEROS], threedod_sql_af: [...ZEROS],
    wow_leads_eb: [...ZEROS], wow_leads_af: [...ZEROS],
    wow_sql_eb: [...ZEROS], wow_sql_af: [...ZEROS],
    mom_total_eb: [...ZEROS], mom_total_af: [...ZEROS],
    mom_sql_eb: [...ZEROS], mom_sql_af: [...ZEROS],
    mom_meetings_eb: [...ZEROS], mom_meetings_af: [...ZEROS],
    mom_won_eb: [...ZEROS], mom_won_af: [...ZEROS],
    aimfox_daily_sent: [...ZEROS],
    aimfox_schedule_today: 0, aimfox_schedule_tomorrow: 0, aimfox_schedule_day_after: 0,
    aimfox_wow_sent: [...ZEROS], aimfox_wow_accepted: [null, null, null, null, null],
    aimfox_invite_limit: null, aimfox_invite_limit_remaining: null, aimfox_remaining_database_size: null,
    ...overrides,
  };
}

function wrapSummaries(summaries: ClientMetricsSummary[]) {
  return {
    summaries,
    _meta: { clientsCount: summaries.length, dailyStatsRowsRead: 0, leadRowsRead: 0, computedAt: "" },
  };
}

function makeClient(overrides?: Record<string, unknown>) {
  return {
    id: "client-1", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01",
    name: "Acme", status: "Active", manager_id: "manager-1",
    kpi_leads: null, kpi_meetings: null, contracted_amount: null, contract_due_date: null,
    min_daily_sent: 20, inboxes_count: 3, crm_config: null,
    sms_phone_numbers: [], notification_emails: [], auto_ooo_enabled: false,
    prospects_signed: 0, prospects_added: 0, setup_info: null, bi_setup_done: false,
    lost_reason: null, notes: null,
    ...overrides,
  };
}

function makeOverview(clients: unknown[]) {
  return {
    clients,
    usersLite: [{ id: "manager-1", role: "manager", first_name: "Mary", last_name: "Manager", email: "manager@test.local" }],
    clientUsers: [],
    conditionRules: [],
    columnOverrides: [],
    clientCustomFields: [],
    clientCustomFieldValues: [],
    sequencers: [],
    clientSequencers: [],
  };
}

async function renderPage() {
  render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  );
  await act(async () => {});
}

/** The section (sub-band) header row, in DOM order. It is the only band using this tracking. */
function sectionHeaders(): string[] {
  const band = document.querySelector('div[class*="tracking-[0.14em]"]');
  if (!band) throw new Error("section band not rendered");
  return Array.from(band.children).map((el) => (el.textContent ?? "").trim());
}

function switchChannel(
  view: "Both channels, combined and side by side" | "Email numbers only" | "LinkedIn numbers only",
) {
  fireEvent.click(screen.getByRole("radio", { name: view }));
}

describe("clients grid channel view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockedUseAuth.mockReturnValue({
      identity: { id: "admin-1", fullName: "Admin User", email: "admin@test.local", role: "admin" },
    } as never);
    mockedRepo.loadClientsOverview.mockResolvedValue(makeOverview([makeClient()]) as never);
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(
      wrapSummaries([
        makeSummary("client-1", {
          threedod_total: [101, 0, 0, 0, 0],
          threedod_total_eb: [71, 0, 0, 0, 0],
          threedod_total_af: [31, 0, 0, 0, 0],
          daily_sent: [500, 0, 0, 0, 0],
          aimfox_daily_sent: [40, 0, 0, 0, 0],
        }),
      ]) as never,
    );
  });

  it("shows the combined series and the side-by-side splits only in Both", async () => {
    await renderPage();

    // Both: blended 101 plus its EB/AF comparison columns, and the Aimfox mirror bands.
    expect(screen.getAllByText("101").length).toBeGreaterThan(0);
    expect(screen.getAllByText("71").length).toBeGreaterThan(0);
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
    const both = sectionHeaders();
    expect(both).toContain("3-DoD TOTAL · EB");
    expect(both).toContain("3-DoD TOTAL · AF");
    expect(both).toContain("Schedule (Aimfox)");
    expect(both).toContain("Daily sent (Aimfox)");
    expect(both).toContain("MoM Total · EB");
    expect(both).toContain("MoM Total · AF");
  });

  it("renders the neutral bands with the selected sequencer's numbers and no combined total", async () => {
    await renderPage();

    switchChannel("Email numbers only");
    expect(screen.queryByText("101")).not.toBeInTheDocument();
    expect(screen.getAllByText("71").length).toBeGreaterThan(0);
    expect(screen.queryByText("31")).not.toBeInTheDocument();
    expect(screen.getAllByText("500").length).toBeGreaterThan(0); // Bison daily sent

    switchChannel("LinkedIn numbers only");
    expect(screen.queryByText("101")).not.toBeInTheDocument();
    expect(screen.queryByText("71")).not.toBeInTheDocument();
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
    // Daily sent now carries the LinkedIn invite volume, not the Bison send volume.
    expect(screen.queryByText("500")).not.toBeInTheDocument();
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);
  });

  it("gives the EmailBison and Aimfox views the same structure", async () => {
    await renderPage();

    switchChannel("Email numbers only");
    const email = sectionHeaders();
    switchChannel("LinkedIn numbers only");
    const aimfox = sectionHeaders();

    // Drop the "· EB" / "· AF" the header suffix adds, so what is left is the band's own name.
    const unsuffixed = (headers: string[]) => headers.map((h) => h.replace(/ · (EB|AF)$/, ""));

    // Neither view may keep a comparison band: the neutral band already holds that channel.
    for (const headers of [unsuffixed(email), unsuffixed(aimfox)]) {
      expect(headers.some((h) => h.includes("· EB") || h.includes("· AF"))).toBe(false);
      expect(headers.some((h) => h.includes("(Aimfox)"))).toBe(false);
      // The lead bands must sit at their original early position, not after the whole grid.
      expect(headers.findIndex((h) => h.startsWith("Schedule"))).toBeLessThan(
        headers.findIndex((h) => h.startsWith("3-DoD TOTAL")),
      );
    }

    // Same sections in the same order, once each view's channel-native extras are removed.
    const emailOnly = ["WoW Resp", "WoW Human", "WoW Bnc", "WoW OOO"];
    const aimfoxOnly = ["Aimfox capacity", "WoW Accept"];
    const strip = (headers: string[], native: string[]) => unsuffixed(headers).filter((h) => !native.includes(h));
    expect(strip(email, emailOnly)).toEqual(strip(aimfox, aimfoxOnly));

    // …and each view names the channel it is showing.
    expect(email).toContain("3-DoD TOTAL leads · EB");
    expect(aimfox).toContain("3-DoD TOTAL leads · AF");
  });

  it("sorts by the projected channel, not the blended total", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeOverview([makeClient(), makeClient({ id: "client-2", name: "Bravo" })]) as never,
    );
    // Acme leads on EmailBison, Bravo leads on Aimfox — so the two views must order them oppositely.
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(
      wrapSummaries([
        makeSummary("client-1", { threedod_total: [90, 0, 0, 0, 0], threedod_total_eb: [70, 0, 0, 0, 0], threedod_total_af: [20, 0, 0, 0, 0] }),
        makeSummary("client-2", { threedod_total: [50, 0, 0, 0, 0], threedod_total_eb: [10, 0, 0, 0, 0], threedod_total_af: [40, 0, 0, 0, 0] }),
      ]) as never,
    );

    await renderPage();

    switchChannel("Email numbers only");
    fireEvent.click(screen.getByRole("button", { name: "Sort by 3-DoD TOTAL leads · EB 0" }));
    expect(within(screen.getAllByRole("button", { name: /Open details for/i })[0]).getByText("Acme")).toBeInTheDocument();

    // Same column, same descending sort — only the projected numbers changed, so the order flips.
    switchChannel("LinkedIn numbers only");
    expect(screen.getByRole("button", { name: "Sort by 3-DoD TOTAL leads · AF 0" })).toBeInTheDocument();
    expect(within(screen.getAllByRole("button", { name: /Open details for/i })[0]).getByText("Bravo")).toBeInTheDocument();
  });

  it("drops a sort bound to a column the switch hides", async () => {
    await renderPage();

    // "WoW Accept" is Aimfox-native; it does not exist in the EmailBison view.
    switchChannel("LinkedIn numbers only");
    fireEvent.click(screen.getByRole("button", { name: "Sort by WoW Accept · AF 0" }));
    switchChannel("Email numbers only");

    // The gateway write is debounced; the layout cache is written synchronously, so assert there.
    const cached = JSON.parse(window.localStorage.getItem("table-prefs:clients:mega") ?? "{}");
    expect(cached).toMatchObject({ channelView: "email", sort: { key: "name", direction: "asc" } });
  });

  it("restores the persisted channel view on mount", async () => {
    mockedRepo.loadTablePreferences.mockResolvedValue({
      tableKey: "clients:mega",
      preferences: { channelView: "aimfox" },
      updatedAt: null,
    } as never);

    await renderPage();

    expect(sectionHeaders()).toContain("3-DoD TOTAL leads · AF");
    expect(screen.queryByText("101")).not.toBeInTheDocument();
  });
});
