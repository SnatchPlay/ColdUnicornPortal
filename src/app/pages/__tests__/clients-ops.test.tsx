import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPage } from "../clients-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

// ClientsPage loads shell via loadClientsOverview then compact metrics via loadClientsMetricsSummary.
// Synchronous factory so RepositoryError is a stub class (instanceof works in page code).
vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "clients"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadClientsOverview: vi.fn(),
    // The clients grid loads the caller's saved layout on mount; an unstubbed method here
    // would throw synchronously inside the hook.
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

function makeAuth(role: "admin" | "manager" = "admin") {
  return {
    identity: {
      id: role === "admin" ? "admin-1" : "manager-1",
      fullName: role === "admin" ? "Admin User" : "Manager User",
      email: role === "admin" ? "admin@test.local" : "manager@test.local",
      role,
    },
  };
}

function getDateKey(daysOffset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Compact metrics summary helpers — Phase 5C replacement for raw stats transfer.

function makeEmptySummary(clientId: string) {
  return {
    client_id: clientId,
    daily_sent: [0, 0, 0, 0, 0],
    schedule_today: 0, schedule_tomorrow: 0, schedule_day_after: 0,
    wow_sent: [0, 0, 0, 0, 0], wow_human: [0, 0, 0, 0, 0], wow_bounce: [0, 0, 0, 0, 0],
    wow_ooo: [0, 0, 0, 0, 0], wow_negative: [0, 0, 0, 0, 0],
    wow_leads: [0, 0, 0, 0, 0], wow_sql: [0, 0, 0, 0, 0],
    mom_total: [0, 0, 0, 0, 0], mom_sql: [0, 0, 0, 0, 0],
    mom_meetings: [0, 0, 0, 0, 0], mom_won: [0, 0, 0, 0, 0],
    threedod_total: [0, 0, 0, 0, 0], threedod_sql: [0, 0, 0, 0, 0],
    latest_prospects_count: 0,
    threedod_total_eb: [0, 0, 0, 0, 0], threedod_total_af: [0, 0, 0, 0, 0],
    threedod_sql_eb: [0, 0, 0, 0, 0], threedod_sql_af: [0, 0, 0, 0, 0],
    wow_leads_eb: [0, 0, 0, 0, 0], wow_leads_af: [0, 0, 0, 0, 0],
    wow_sql_eb: [0, 0, 0, 0, 0], wow_sql_af: [0, 0, 0, 0, 0],
    mom_total_eb: [0, 0, 0, 0, 0], mom_total_af: [0, 0, 0, 0, 0],
    mom_sql_eb: [0, 0, 0, 0, 0], mom_sql_af: [0, 0, 0, 0, 0],
    mom_meetings_eb: [0, 0, 0, 0, 0], mom_meetings_af: [0, 0, 0, 0, 0],
    mom_won_eb: [0, 0, 0, 0, 0], mom_won_af: [0, 0, 0, 0, 0],
    aimfox_daily_sent: [0, 0, 0, 0, 0],
    aimfox_schedule_today: 0, aimfox_schedule_tomorrow: 0, aimfox_schedule_day_after: 0,
    aimfox_wow_sent: [0, 0, 0, 0, 0], aimfox_wow_accepted: [null, null, null, null, null],
    aimfox_invite_limit: null, aimfox_invite_limit_remaining: null, aimfox_remaining_database_size: null,
  };
}

function wrapSummaries(summaries: ReturnType<typeof makeEmptySummary>[]) {
  return {
    summaries,
    _meta: { clientsCount: summaries.length, dailyStatsRowsRead: summaries.length, leadRowsRead: summaries.length, computedAt: "" },
  };
}

// Default summary used for tests that assert DoD schedule/sent values.
// Mirrors the values that makeClientsStats() previously produced via raw daily_stats rows:
//   today: sent=380, schedToday=380, schedTomorrow=395, schedDayAfter=410
//   yesterday: sent=395; -2: 384; -3: 300; -4: 280
// 3-DoD: today has MQL+preMQL=2 (total), MQL=1 (sql); yesterday: MQL=1; -2: preMQL=1
function makeMetricsSummaryPayload() {
  return wrapSummaries([{
    ...makeEmptySummary("client-1"),
    daily_sent: [380, 395, 384, 300, 280],
    schedule_today: 380, schedule_tomorrow: 395, schedule_day_after: 410,
    wow_sent: [380, 0, 0, 0, 0],
    threedod_total: [2, 1, 1, 0, 0],
    threedod_sql:   [1, 1, 0, 0, 0],
  }]);
}

// Full client record shape needed by the mega-table and drawer.
function makeClient(overrides?: Record<string, unknown>) {
  const today = getDateKey(0);
  return {
    id: "client-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: today,
    name: "Acme",
    status: "Active",
    manager_id: "manager-1",
    kpi_leads: 10,
    kpi_meetings: null,
    contracted_amount: 1000,
    contract_due_date: "2026-12-01",
    min_daily_sent: 20,
    inboxes_count: 3,
    crm_config: null,
    sms_phone_numbers: ["+48123456789"],
    notification_emails: ["ops@acme.test"],
    auto_ooo_enabled: true,
    prospects_signed: 0,
    prospects_added: 0,
    setup_info: "Setup complete",
    bi_setup_done: false,
    lost_reason: null,
    notes: null,
    ...overrides,
  };
}

// Shell payload — returned by loadClientsOverview (no stats).
function makeClientsOverview(overrides?: Record<string, unknown>) {
  const base = {
    clients: [makeClient()],
    usersLite: [
      { id: "manager-1", role: "manager", first_name: "Mary", last_name: "Manager", email: "manager@test.local" },
      { id: "client-user-1", role: "client", first_name: "Chris", last_name: "Client", email: "client@test.local" },
    ],
    clientUsers: [{ id: "mapping-1", client_id: "client-1", user_id: "client-user-1" }],
    conditionRules: [],
    columnOverrides: [],
    clientCustomFields: [],
    clientCustomFieldValues: [],
    sequencers: [],
    clientSequencers: [],
  };
  return { ...base, ...overrides };
}

async function renderPage() {
  render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  );
  // Flush the async loadClientsOverview promise so the loaded state renders.
  await act(async () => {});
}

async function openClientDrawer(clientName = "Acme") {
  fireEvent.click(screen.getByRole("button", { name: `Open details for ${clientName}` }));
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("clients operational tooling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useTablePreferences caches the saved layout in localStorage; without this a filter
    // set by one test leaks into the next one and silently empties the grid.
    window.localStorage.clear();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    // Default: compact metrics summary loads alongside shell (Phase 5C).
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(makeMetricsSummaryPayload() as never);
    // Default: all mutations succeed silently.
    mockedRepo.updateClient.mockResolvedValue(makeClient() as never);
    mockedRepo.sendInvite.mockResolvedValue({ inviteId: "invite-1" });
    // Return same ID as the existing mapping so the optimistic state update doesn't change the ID.
    mockedRepo.upsertClientUserMapping.mockResolvedValue({
      id: "mapping-1", client_id: "client-1", user_id: "client-user-1", created_at: "2026-01-01",
    } as never);
    mockedRepo.deleteClientUserMapping.mockResolvedValue(undefined as never);
    mockedRepo.upsertClientCustomFieldValue.mockResolvedValue({
      client_id: "client-1", field_id: "f1", value: null, updated_at: "", updated_by: null,
    } as never);
  });

  it("opens and closes client drawer from table row click and Esc", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);

    await renderPage();
    await openClientDrawer();

    expect(screen.getByRole("dialog", { name: "Acme details" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Acme details" })).not.toBeInTheDocument();
  });

  it("uses controlled save/cancel edit session in client drawer", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);
    mockedRepo.updateClient.mockResolvedValue(makeClient({ name: "Acme Final" }) as never);

    await renderPage();
    await openClientDrawer();

    const nameInput = screen.getByLabelText("Client display name") as HTMLInputElement;
    expect(nameInput.value).toBe("Acme");

    fireEvent.change(nameInput, { target: { value: "Acme Updated" } });
    expect(mockedRepo.updateClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Client display name") as HTMLInputElement).value).toBe("Acme");

    fireEvent.change(screen.getByLabelText("Client display name"), { target: { value: "Acme Final" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedRepo.updateClient).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.updateClient).toHaveBeenCalledWith("client-1", expect.objectContaining({ name: "Acme Final" }));
  });

  it("renders DoD/3DoD/WoW/MoM metric groups in the mega-table via loadClientsMetricsSummary", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);

    await renderPage();

    // Phase 5C: ClientsPage must use the compact summary path, not raw stats.
    expect(mockedRepo.loadClientsMetricsSummary).toHaveBeenCalledTimes(1);
    expect(mockedRepo.loadClientsStats).not.toHaveBeenCalled();

    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Daily sent")).toBeInTheDocument();
    expect(screen.getAllByText("3-DoD TOTAL leads").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WoW Total").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MoM Total").length).toBeGreaterThan(0);
    // Schedule value 410 (+2) is unique to schedule_day_after for today
    expect(screen.getByText("410")).toBeInTheDocument();
    // 395 appears in both schedule +1 and DoD sent -1 — at least one match
    expect(screen.getAllByText("395").length).toBeGreaterThan(0);
  });

  it("supports assigning and removing client-user mappings in drawer", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);

    await renderPage();
    await openClientDrawer();

    await chooseOptionByLabel("Client user account", /Chris Client.*client@test.local/i);
    fireEvent.click(screen.getByRole("button", { name: "Assign user" }));

    await waitFor(() => {
      expect(mockedRepo.upsertClientUserMapping).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.upsertClientUserMapping).toHaveBeenCalledWith("client-user-1", "client-1");

    fireEvent.click(screen.getByRole("button", { name: "Remove mapping" }));

    await waitFor(() => {
      expect(mockedRepo.deleteClientUserMapping).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.deleteClientUserMapping).toHaveBeenCalledWith("mapping-1");
  });

  it("forces admin client invite payload to role client with selected clientId", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);

    await renderPage();
    await openClientDrawer();

    fireEvent.change(screen.getByLabelText("User email"), { target: { value: "manager.new@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockedRepo.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "manager.new@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("keeps manager invites scoped to selected client user role", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedRepo.loadClientsOverview.mockResolvedValue(makeClientsOverview() as never);

    await renderPage();
    await openClientDrawer();

    fireEvent.change(screen.getByLabelText("User email"), { target: { value: "client.new@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockedRepo.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "client.new@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("sorts overview table by MoM SQL column", async () => {
    const minus5 = getDateKey(-5);

    const client2 = makeClient({ id: "client-2", name: "Bravo", manager_id: "manager-1", updated_at: minus5, notification_emails: ["ops@bravo.test"] });

    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeClientsOverview({ clients: [makeClient(), client2], clientUsers: [] }) as never,
    );
    // client-1: 1 MQL this month; client-2: 3 MQLs this month — Bravo ranks higher DESC.
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(wrapSummaries([
      { ...makeEmptySummary("client-1"), daily_sent: [200, 0, 0, 0, 0], schedule_today: 100, schedule_tomorrow: 100, schedule_day_after: 100, mom_sql: [1, 0, 0, 0, 0] },
      { ...makeEmptySummary("client-2"), daily_sent: [200, 0, 0, 0, 0], schedule_today: 100, schedule_tomorrow: 100, schedule_day_after: 100, mom_sql: [3, 0, 0, 0, 0] },
    ]) as never);

    await renderPage();

    const momSqlHeader = screen.getByRole("button", { name: "Sort by MoM SQL 0" });
    fireEvent.click(momSqlHeader);

    const rowButtons = screen.getAllByRole("button", { name: /Open details for/i });
    expect(within(rowButtons[0]).getByText("Bravo")).toBeInTheDocument();

    fireEvent.click(momSqlHeader);
    const rowButtonsAsc = screen.getAllByRole("button", { name: /Open details for/i });
    expect(within(rowButtonsAsc[0]).getByText("Acme")).toBeInTheDocument();
  });
});
