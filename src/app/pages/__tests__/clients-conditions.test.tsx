import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPage } from "../clients-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

// ClientsPage loads shell via loadClientsOverview then compact metrics via loadClientsMetricsSummary.
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

function getDateKey(offset: number) {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  now.setDate(now.getDate() + offset);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function makeConditionRule(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    key: "rule",
    name: "Rule",
    description: null,
    target_entity: "client",
    surface: "clients_overview",
    metric_key: "value",
    source_sheet: "CS PDCA",
    source_range: "A1:A1",
    scope_type: "global",
    client_id: null,
    manager_id: null,
    apply_to: "cell",
    column_key: "value",
    branches: [],
    base_filter: null,
    priority: 10,
    enabled: true,
    notes: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Shell payload — returned by loadClientsOverview. Contains clients + config but no stats.
function makeClientsOverview({
  conditionRules,
  minDailySent = 100,
  satisfaction = null,
}: {
  sentToday?: number;
  scheduleToday?: number;
  bounceCount?: number;
  conditionRules: unknown[];
  minDailySent?: number;
  satisfaction?: 1 | 2 | 3 | null;
}) {
  const today = getDateKey(0);
  return {
    clients: [
      {
        id: "client-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: `${today}T00:00:00.000Z`,
        name: "Acme",
        manager_id: "manager-1",
        kpi_leads: 20,
        kpi_meetings: 8,
        contracted_amount: 1000,
        contract_due_date: "2026-12-01",
        status: "Active",
        min_daily_sent: minDailySent,
        inboxes_count: 8,
        crm_config: null,
        sms_phone_numbers: [],
        notification_emails: [],
        auto_ooo_enabled: false,
        prospects_signed: 100,
        prospects_added: 95,
        setup_info: null,
        bi_setup_done: false,
        lost_reason: null,
        notes: null,
        satisfaction,
      },
    ],
    usersLite: [
      { id: "manager-1", role: "manager", first_name: "Mary", last_name: "Manager", email: "manager@test.local" },
    ],
    clientUsers: [],
    conditionRules,
    columnOverrides: [],
    clientCustomFields: [],
    clientCustomFieldValues: [],
    sequencers: [],
    clientSequencers: [],
  };
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
    // Per-channel splits (04-metrics §18) — kept in the fixture so a test can set one without
    // tripping the excess-property check, and so this copy does not drift from the contract.
    threedod_total_eb: [0, 0, 0, 0, 0], threedod_total_af: [0, 0, 0, 0, 0],
    threedod_sql_eb: [0, 0, 0, 0, 0], threedod_sql_af: [0, 0, 0, 0, 0],
    wow_leads_eb: [0, 0, 0, 0, 0], wow_leads_af: [0, 0, 0, 0, 0],
    wow_sql_eb: [0, 0, 0, 0, 0], wow_sql_af: [0, 0, 0, 0, 0],
    mom_total_eb: [0, 0, 0, 0, 0], mom_total_af: [0, 0, 0, 0, 0],
    mom_sql_eb: [0, 0, 0, 0, 0], mom_sql_af: [0, 0, 0, 0, 0],
    mom_meetings_eb: [0, 0, 0, 0, 0], mom_meetings_af: [0, 0, 0, 0, 0],
    mom_won_eb: [0, 0, 0, 0, 0], mom_won_af: [0, 0, 0, 0, 0],
  };
}

function wrapSummaries(summaries: ReturnType<typeof makeEmptySummary>[]) {
  return {
    summaries,
    _meta: { clientsCount: summaries.length, dailyStatsRowsRead: summaries.length, leadRowsRead: 0, computedAt: "" },
  };
}

// Compact summary equivalent of the old makeClientsStats. Produces a single-client payload
// with sentToday in daily_sent[0] and wow_sent[0], scheduleToday in schedule_today, and
// bounceCount in wow_bounce[0] (current-week bucket) so condition rules on wow_bounce_rate work.
function makeMetricsSummaryPayload({
  sentToday,
  scheduleToday,
  bounceCount,
}: {
  sentToday: number;
  scheduleToday: number;
  bounceCount: number;
}) {
  return wrapSummaries([{
    ...makeEmptySummary("client-1"),
    daily_sent: [sentToday, 0, 0, 0, 0],
    schedule_today: scheduleToday,
    wow_sent: [sentToday, 0, 0, 0, 0],
    wow_bounce: [bounceCount, 0, 0, 0, 0],
  }]);
}

async function renderPage() {
  render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  );
  // Flush the async loadClientsOverview promise.
  await act(async () => {});
}

describe("clients condition surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useTablePreferences caches the saved layout in localStorage; without this a filter
    // set by one test leaks into the next one and silently empties the grid.
    window.localStorage.clear();
    mockedUseAuth.mockReturnValue({
      identity: {
        id: "manager-1",
        fullName: "Mary Manager",
        email: "manager@test.local",
        role: "manager",
      },
    } as never);
    mockedRepo.updateClient.mockResolvedValue({} as never);
    mockedRepo.sendInvite.mockResolvedValue({ inviteId: null });
    mockedRepo.upsertClientUserMapping.mockResolvedValue({} as never);
    mockedRepo.deleteClientUserMapping.mockResolvedValue(undefined as never);
    // Compact metrics summary default — individual tests override this when they need specific values.
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(makeMetricsSummaryPayload({ sentToday: 100, scheduleToday: 100, bounceCount: 0 }) as never);
  });

  // The row-level severity rollup (badge + reason string) was replaced by the manual satisfaction
  // rating, so a danger rule now shows up only as a tinted cell — the label lives in the cell's
  // tooltip, which Radix mounts on hover.
  it("tints the cell for bounce >= 2%", async () => {
    const wowBounceRule = makeConditionRule({
      key: "wow_bounce_rate",
      name: "WoW Bounce Rate",
      surface: "clients_wow",
      metric_key: "wow_bounce_rate",
      column_key: "wow_bounce_rate",
      branches: [
        { severity: "good", when: { left: { metric: "value" }, op: "lte", right: { value: 0.01 } }, label: "Good", message: "Good" },
        { severity: "warning", when: { all: [{ left: { metric: "value" }, op: "gt", right: { value: 0.01 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.02 } }] }, label: "Warning", message: "Warning" },
        { severity: "danger", when: { left: { metric: "value" }, op: "gte", right: { value: 0.02 } }, label: "Bounce danger", message: "Bounce rate is above 2%." },
      ],
    });
    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeClientsOverview({ conditionRules: [wowBounceRule] }) as never,
    );
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(
      makeMetricsSummaryPayload({ sentToday: 100, scheduleToday: 100, bounceCount: 3 }) as never,
    );

    await renderPage();

    const cell = screen.getByText("3.0%").closest("div");
    expect(cell?.className).toContain("cond-cell-danger");
  });

  // A neutral metric cell shows the selected channel's number while the rules keep running on the
  // blended pack, so the tint would judge a value that is not on screen. It is dropped instead.
  it("drops metric-cell tint outside the Both view but keeps the Basic-column tint", async () => {
    const td3Rule = makeConditionRule({
      key: "three_dod_total",
      name: "3-DoD TOTAL",
      surface: "clients_3dod",
      metric_key: "three_dod_total",
      column_key: "three_dod_total",
      branches: [
        { severity: "danger", when: { left: { metric: "value" }, op: "gte", right: { value: 100 } }, label: "Too many", message: "Too many." },
      ],
    });
    const inboxesRule = makeConditionRule({
      key: "inboxes",
      name: "Inboxes",
      surface: "clients_overview",
      metric_key: "inboxes",
      column_key: "inboxes",
      branches: [
        { severity: "danger", when: { left: { metric: "value" }, op: "lte", right: { value: 10 } }, label: "Too few", message: "Too few." },
      ],
    });
    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeClientsOverview({ conditionRules: [td3Rule, inboxesRule] }) as never,
    );
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(wrapSummaries([{
      ...makeEmptySummary("client-1"),
      threedod_total: [101, 0, 0, 0, 0],
      threedod_total_eb: [71, 0, 0, 0, 0],
      threedod_total_af: [31, 0, 0, 0, 0],
    }]) as never);

    await renderPage();

    const tinted = (text: string) =>
      screen.getAllByText(text).some((el) => el.closest("div")?.className.includes("cond-cell-danger"));

    expect(tinted("101")).toBe(true);
    expect(tinted("8")).toBe(true); // inboxes_count = 8, a Basic column

    fireEvent.click(screen.getByRole("radio", { name: "Email numbers only" }));
    expect(tinted("71")).toBe(false);
    expect(tinted("8")).toBe(true);
  });

  it("shows DoD danger highlight when value is below 80% of min sent", async () => {
    const dodRule = makeConditionRule({
      key: "dod_sent_or_schedule_vs_min_sent",
      name: "DoD rule",
      surface: "clients_dod",
      metric_key: "value",
      column_key: "dynamic_dod_bucket",
      branches: [
        { severity: "danger", when: { left: { metric: "value" }, op: "lt", right: { metric: "min_sent", multiplier: 0.8 } }, label: "Low", message: "Below 80%." },
      ],
    });
    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeClientsOverview({ conditionRules: [dodRule], minDailySent: 100 }) as never,
    );
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(
      makeMetricsSummaryPayload({ sentToday: 70, scheduleToday: 70, bounceCount: 0 }) as never,
    );

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open details for Acme" }));

    const dangerCells = screen.getAllByText("70");
    const highlighted = dangerCells.find((item) => item.closest("div")?.className.includes("cond-cell-danger"));
    expect(highlighted).toBeTruthy();
  });

  // The satisfaction filter chips were removed from the filter bar on 2026-08-14 (the space went to
  // the grid). The hearts survive only as the inline rating in the Client column, so this is now the
  // page's only satisfaction radiogroup — which is why the exact-name query below is unambiguous.
  it("writes a satisfaction rating from the grid's Client cell", async () => {
    mockedRepo.loadClientsOverview.mockResolvedValue(
      makeClientsOverview({ conditionRules: [], satisfaction: null }) as never,
    );
    mockedRepo.loadClientsMetricsSummary.mockResolvedValue(
      makeMetricsSummaryPayload({ sentToday: 100, scheduleToday: 100, bounceCount: 0 }) as never,
    );
    mockedRepo.updateClient.mockResolvedValue({} as never);

    await renderPage();
    // The row's hearts are a radiogroup; "Happy" is the third one.
    const hearts = screen.getAllByRole("radio", { name: "Happy" });
    fireEvent.click(hearts[0]);

    expect(mockedRepo.updateClient).toHaveBeenCalledWith("client-1", { satisfaction: 3 });
  });
});
