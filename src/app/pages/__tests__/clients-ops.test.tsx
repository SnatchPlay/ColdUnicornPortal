import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function makeAuth() {
  return {
    identity: {
      id: "admin-1",
      fullName: "Admin User",
      email: "admin@test.local",
      role: "admin",
    },
  };
}

function makeCoreData(overrides?: Record<string, unknown>) {
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
    leads: [],
    replies: [],
    campaignDailyStats: [],
    dailyStats: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
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

describe("clients operational tooling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
  });

  it("uses controlled save/cancel edit session for client detail", async () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    const nameInput = screen.getByLabelText("Client name") as HTMLInputElement;
    expect(nameInput.value).toBe("Acme");

    fireEvent.change(nameInput, { target: { value: "Acme Updated" } });
    expect(core.updateClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Client name") as HTMLInputElement).value).toBe("Acme");

    fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Acme Final" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(core.updateClient).toHaveBeenCalledTimes(1);
    });
    expect(core.updateClient).toHaveBeenCalledWith("client-1", expect.objectContaining({ name: "Acme Final" }));
  });

  it("supports assigning and removing client-user mappings", async () => {
    const core = makeCoreData();
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    fireEvent.change(screen.getByLabelText("Client user"), { target: { value: "client-user-1" } });
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
});