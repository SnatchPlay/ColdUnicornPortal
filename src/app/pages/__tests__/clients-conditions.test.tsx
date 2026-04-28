import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsPage } from "../clients-page";
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

function makeCoreData({
  sentToday,
  scheduleToday,
  bounceCount,
  conditionRules,
  minDailySent = 100,
}: {
  sentToday: number;
  scheduleToday: number;
  bounceCount: number;
  conditionRules: unknown[];
  minDailySent?: number;
}) {
  const today = getDateKey(0);
  const minus1 = getDateKey(-1);
  const minus2 = getDateKey(-2);

  return {
    users: [
      {
        id: "manager-1",
        role: "manager",
        first_name: "Mary",
        last_name: "Manager",
        email: "manager@test.local",
      },
    ],
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
        external_workspace_id: 444,
        status: "Active",
        external_api_key: null,
        min_daily_sent: minDailySent,
        inboxes_count: 8,
        crm_config: null,
        sms_phone_numbers: [],
        notification_emails: [],
        auto_ooo_enabled: false,
        linkedin_api_key: null,
        prospects_signed: 100,
        prospects_added: 95,
        setup_info: null,
        bi_setup_done: false,
        lost_reason: null,
        notes: null,
      },
    ],
    clientUsers: [],
    campaigns: [],
    leads: [],
    replies: [],
    campaignDailyStats: [],
    dailyStats: [
      {
        id: `d-${today}`,
        client_id: "client-1",
        report_date: today,
        emails_sent: sentToday,
        prospects_in_base: 0,
        mql_count: 0,
        me_count: 0,
        response_count: 2,
        bounce_count: bounceCount,
        won_count: 0,
        negative_count: 0,
        ooo_count: 0,
        human_replies_count: 1,
        inboxes_count: 0,
        prospects_count: 0,
        schedule_today: scheduleToday,
        schedule_tomorrow: 0,
        schedule_day_after: 0,
        week_number: 17,
        month_number: 4,
        year: 2026,
        created_at: `${today}T00:00:00.000Z`,
      },
      {
        id: `d-${minus1}`,
        client_id: "client-1",
        report_date: minus1,
        emails_sent: 0,
        prospects_in_base: 0,
        mql_count: 0,
        me_count: 0,
        response_count: 0,
        bounce_count: 0,
        won_count: 0,
        negative_count: 0,
        ooo_count: 0,
        human_replies_count: 0,
        inboxes_count: 0,
        prospects_count: 0,
        schedule_today: 0,
        schedule_tomorrow: 0,
        schedule_day_after: 0,
        week_number: 17,
        month_number: 4,
        year: 2026,
        created_at: `${minus1}T00:00:00.000Z`,
      },
      {
        id: `d-${minus2}`,
        client_id: "client-1",
        report_date: minus2,
        emails_sent: 0,
        prospects_in_base: 0,
        mql_count: 0,
        me_count: 0,
        response_count: 0,
        bounce_count: 0,
        won_count: 0,
        negative_count: 0,
        ooo_count: 0,
        human_replies_count: 0,
        inboxes_count: 0,
        prospects_count: 0,
        schedule_today: 0,
        schedule_tomorrow: 0,
        schedule_day_after: 0,
        week_number: 17,
        month_number: 4,
        year: 2026,
        created_at: `${minus2}T00:00:00.000Z`,
      },
    ],
    domains: [],
    invoices: [],
    emailExcludeList: [],
    conditionRules,
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    updateDomain: vi.fn(async () => {}),
    updateInvoice: vi.fn(async () => {}),
    createConditionRule: vi.fn(async () => {}),
    updateConditionRule: vi.fn(async () => {}),
    deleteConditionRule: vi.fn(async () => {}),
    sendInvite: vi.fn(async () => {}),
    listInvites: vi.fn(async () => []),
    resendInvite: vi.fn(async () => {}),
    revokeInvite: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
    upsertEmailExcludeDomain: vi.fn(async () => {}),
    deleteEmailExcludeDomain: vi.fn(async () => {}),
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  );
}

describe("clients condition surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue({
      identity: {
        id: "manager-1",
        fullName: "Mary Manager",
        email: "manager@test.local",
        role: "manager",
      },
    } as never);
  });

  it("shows danger highlight and explanation for bounce >= 2%", async () => {
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
    mockedUseCoreData.mockReturnValue(
      makeCoreData({ sentToday: 100, scheduleToday: 100, bounceCount: 3, conditionRules: [wowBounceRule] }) as never,
    );

    renderPage();

    const cell = screen.getByText("3.0%").closest("div");
    expect(cell?.className).toContain("border-red");
    expect(screen.getByText(/Bounce danger/i)).toBeInTheDocument();
  });

  it("shows DoD danger highlight when value is below 80% of min sent", () => {
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
    mockedUseCoreData.mockReturnValue(
      makeCoreData({ sentToday: 70, scheduleToday: 70, bounceCount: 0, conditionRules: [dodRule], minDailySent: 100 }) as never,
    );

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open details for Acme" }));

    const dangerCells = screen.getAllByText("70");
    const highlighted = dangerCells.find((item) => item.closest("div")?.className.includes("border-red"));
    expect(highlighted).toBeTruthy();
  });

  it("supports healthy filter and hides non-good badges for healthy client", () => {
    const wowBounceRule = makeConditionRule({
      key: "wow_bounce_rate",
      name: "WoW Bounce Rate",
      surface: "clients_wow",
      metric_key: "wow_bounce_rate",
      column_key: "wow_bounce_rate",
      branches: [
        { severity: "good", when: { left: { metric: "value" }, op: "lte", right: { value: 0.01 } }, label: "Healthy bounce", message: "Healthy." },
      ],
    });
    mockedUseCoreData.mockReturnValue(
      makeCoreData({ sentToday: 100, scheduleToday: 100, bounceCount: 0, conditionRules: [wowBounceRule] }) as never,
    );

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Healthy only" }));

    expect(screen.getByRole("button", { name: "Open details for Acme" })).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("toggles danger badge visibility", () => {
    const wowBounceRule = makeConditionRule({
      key: "wow_bounce_rate",
      name: "WoW Bounce Rate",
      surface: "clients_wow",
      metric_key: "wow_bounce_rate",
      column_key: "wow_bounce_rate",
      branches: [
        { severity: "danger", when: { left: { metric: "value" }, op: "gte", right: { value: 0.02 } }, label: "Bounce danger", message: "Bounce rate is above 2%." },
      ],
    });
    mockedUseCoreData.mockReturnValue(
      makeCoreData({ sentToday: 100, scheduleToday: 100, bounceCount: 3, conditionRules: [wowBounceRule] }) as never,
    );

    renderPage();
    expect(screen.getByText(/Bounce danger/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Danger" }));
    expect(screen.queryByText(/Bounce danger/i)).not.toBeInTheDocument();
  });
});
