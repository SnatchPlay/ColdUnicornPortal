import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function makeDailyStat(clientId: string, date: string, sent: number, scheduleToday = 0, scheduleTomorrow = 0, scheduleDayAfter = 0) {
  return {
    id: `${clientId}-${date}`,
    client_id: clientId,
    report_date: date,
    emails_sent: sent,
    prospects_in_base: 0,
    mql_count: 0,
    me_count: 0,
    response_count: Math.round(sent * 0.2),
    bounce_count: Math.round(sent * 0.05),
    won_count: 0,
    negative_count: Math.round(sent * 0.01),
    ooo_count: Math.round(sent * 0.03),
    human_replies_count: Math.round(sent * 0.1),
    inboxes_count: 0,
    prospects_count: 0,
    schedule_today: scheduleToday,
    schedule_tomorrow: scheduleTomorrow,
    schedule_day_after: scheduleDayAfter,
    week_number: 16,
    month_number: 4,
    year: 2026,
    created_at: `${date}T00:00:00.000Z`,
  };
}

function makeLead(clientId: string, date: string, qualification: string | null, meetingBooked = false, won = false) {
  return {
    id: `${clientId}-lead-${date}-${qualification ?? "none"}-${meetingBooked ? "meeting" : "nomeeting"}-${won ? "won" : "nowon"}`,
    created_at: `${date}T10:00:00.000Z`,
    updated_at: `${date}T10:00:00.000Z`,
    client_id: clientId,
    campaign_id: null,
    email: `${date}@test.local`,
    first_name: "Lead",
    last_name: "User",
    job_title: null,
    company_name: null,
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
    country: null,
    message_title: null,
    message_number: null,
    response_time_hours: null,
    response_time_label: null,
    meeting_booked: meetingBooked,
    meeting_held: false,
    offer_sent: false,
    won,
    added_to_ooo_campaign: false,
    external_blacklist_id: null,
    external_domain_blacklist_id: null,
    source: "test",
    reply_text: null,
    comments: null,
  };
}

function getDateKey(daysOffset: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function makeCoreData(overrides?: Record<string, unknown>) {
  const today = getDateKey(0);
  const minus1 = getDateKey(-1);
  const minus2 = getDateKey(-2);
  const minus3 = getDateKey(-3);
  const minus4 = getDateKey(-4);
  const minus9 = getDateKey(-9);
  const minus40 = getDateKey(-40);

  const base = {
    users: [
      {
        id: "manager-1",
        role: "manager",
        first_name: "Mary",
        last_name: "Manager",
        email: "manager@test.local",
      },
      {
        id: "client-user-1",
        role: "client",
        first_name: "Chris",
        last_name: "Client",
        email: "client@test.local",
      },
    ],
    clients: [
      {
        id: "client-1",
        created_at: "2026-01-01T00:00:00.000Z",
        name: "Acme",
        status: "Active",
        manager_id: "manager-1",
        kpi_leads: 10,
        min_daily_sent: 20,
        inboxes_count: 3,
        notification_emails: ["ops@acme.test"],
        sms_phone_numbers: ["+48123456789"],
        auto_ooo_enabled: true,
        setup_info: "Setup complete",
        contracted_amount: 1000,
        contract_due_date: "2026-12-01",
        updated_at: today,
      },
    ],
    clientUsers: [
      {
        id: "mapping-1",
        client_id: "client-1",
        user_id: "client-user-1",
      },
    ],
    campaigns: [],
    leads: [
      makeLead("client-1", today, "MQL"),
      makeLead("client-1", today, "preMQL"),
      makeLead("client-1", minus1, "MQL", true),
      makeLead("client-1", minus2, "preMQL"),
      makeLead("client-1", minus3, null),
      makeLead("client-1", minus40, "MQL", false, true),
    ],
    replies: [],
    campaignDailyStats: [],
    dailyStats: [
      makeDailyStat("client-1", today, 380, 380, 395, 410),
      makeDailyStat("client-1", minus1, 395),
      makeDailyStat("client-1", minus2, 384),
      makeDailyStat("client-1", minus3, 300),
      makeDailyStat("client-1", minus4, 280),
      makeDailyStat("client-1", minus9, 250),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    sendInvite: vi.fn(async () => ({ inviteId: "invite-1" })),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
  };

  return {
    ...base,
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <ClientsPage />
    </MemoryRouter>,
  );
}

function openClientDrawer(clientName = "Acme") {
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
    mockedUseAuth.mockReturnValue(makeAuth() as never);
  });

  it("opens and closes client drawer from table row click and Esc", () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openClientDrawer();

    expect(screen.getByRole("dialog", { name: "Acme details" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Acme details" })).not.toBeInTheDocument();
  });

  it("uses controlled save/cancel edit session in client drawer", async () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openClientDrawer();

    const nameInput = screen.getByLabelText("Client display name") as HTMLInputElement;
    expect(nameInput.value).toBe("Acme");

    fireEvent.change(nameInput, { target: { value: "Acme Updated" } });
    expect(core.updateClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Client display name") as HTMLInputElement).value).toBe("Acme");

    fireEvent.change(screen.getByLabelText("Client display name"), { target: { value: "Acme Final" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(core.updateClient).toHaveBeenCalledTimes(1);
    });
    expect(core.updateClient).toHaveBeenCalledWith("client-1", expect.objectContaining({ name: "Acme Final" }));
  });

  it("renders DoD/3DoD/WoW/MoM metric tables in drawer", () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    expect(screen.getByRole("button", { name: /DoD schedule \+2\/\+1\/0/i })).toBeInTheDocument();
    expect(screen.getByText("410 / 395 / 380")).toBeInTheDocument();

    openClientDrawer();

    expect(screen.getByText("DoD (schedule and sent)")).toBeInTheDocument();
    expect(screen.getByText("3DoD leads")).toBeInTheDocument();
    expect(screen.getByText("WoW rates and leads")).toBeInTheDocument();
    expect(screen.getByText("MoM pipeline")).toBeInTheDocument();
  });

  it("supports assigning and removing client-user mappings in drawer", async () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openClientDrawer();

    await chooseOptionByLabel("Client user account", /Chris Client.*client@test.local/i);
    fireEvent.click(screen.getByRole("button", { name: "Assign user" }));

    await waitFor(() => {
      expect(core.upsertClientUserMapping).toHaveBeenCalledTimes(1);
    });
    expect(core.upsertClientUserMapping).toHaveBeenCalledWith("client-user-1", "client-1");

    fireEvent.click(screen.getByRole("button", { name: "Remove mapping" }));

    await waitFor(() => {
      expect(core.deleteClientUserMapping).toHaveBeenCalledTimes(1);
    });
    expect(core.deleteClientUserMapping).toHaveBeenCalledWith("mapping-1");
  });

  it("forces admin client invite payload to role client with selected clientId", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openClientDrawer();

    fireEvent.change(screen.getByLabelText("User email"), { target: { value: "manager.new@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(core.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(core.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "manager.new@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("keeps manager invites scoped to selected client user role", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();
    openClientDrawer();

    fireEvent.change(screen.getByLabelText("User email"), { target: { value: "client.new@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(core.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(core.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "client.new@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("sorts overview table by MoM SQL column", async () => {
    const today = getDateKey(0);
    const minus5 = getDateKey(-5);
    const minus8 = getDateKey(-8);

    const core = makeCoreData({
      clients: [
        {
          id: "client-1",
          created_at: "2026-01-01T00:00:00.000Z",
          name: "Acme",
          status: "Active",
          manager_id: "manager-1",
          kpi_leads: 10,
          min_daily_sent: 20,
          inboxes_count: 3,
          notification_emails: ["ops@acme.test"],
          sms_phone_numbers: ["+48123456789"],
          auto_ooo_enabled: true,
          setup_info: "Setup complete",
          contracted_amount: 1000,
          contract_due_date: "2026-12-01",
          updated_at: today,
        },
        {
          id: "client-2",
          created_at: "2026-01-01T00:00:00.000Z",
          name: "Bravo",
          status: "Active",
          manager_id: "manager-1",
          kpi_leads: 10,
          min_daily_sent: 20,
          inboxes_count: 3,
          notification_emails: ["ops@bravo.test"],
          sms_phone_numbers: ["+48123456789"],
          auto_ooo_enabled: true,
          setup_info: "Setup complete",
          contracted_amount: 1000,
          contract_due_date: "2026-12-01",
          updated_at: minus5,
        },
      ],
      dailyStats: [
        makeDailyStat("client-1", today, 200, 100, 100, 100),
        makeDailyStat("client-2", today, 200, 100, 100, 100),
      ],
      leads: [
        makeLead("client-1", minus5, "MQL"),
        makeLead("client-2", minus5, "MQL"),
        makeLead("client-2", minus8, "MQL"),
        makeLead("client-2", today, "MQL"),
      ],
      clientUsers: [],
    });
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    const momSqlHeader = screen.getByRole("button", { name: /MoM SQL/i });
    fireEvent.click(momSqlHeader);

    const rowButtons = screen.getAllByRole("button", { name: /Open details for/i });
    expect(within(rowButtons[0]).getByText("Bravo")).toBeInTheDocument();

    fireEvent.click(momSqlHeader);
    const rowButtonsAsc = screen.getAllByRole("button", { name: /Open details for/i });
    expect(within(rowButtonsAsc[0]).getByText("Acme")).toBeInTheDocument();
  });
});
