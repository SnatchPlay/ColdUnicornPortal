import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserManagementPage } from "../admin-user-management-page";
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
    users: [],
    clients: [
      {
        id: "client-1",
        name: "Acme",
        manager_id: "manager-1",
      },
    ],
    clientUsers: [],
    campaigns: [],
    leads: [],
    replies: [],
    campaignDailyStats: [],
    dailyStats: [],
    domains: [],
    invoices: [],
    emailExcludeList: [],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    updateDomain: vi.fn(async () => {}),
    updateInvoice: vi.fn(async () => {}),
    sendInvite: vi.fn(async () => {}),
    listInvites: vi.fn(async () => [
      {
        id: "invite-1",
        email: "pending.user@test.local",
        role: "client",
        status: "pending",
        invitedAt: "2026-04-10T12:00:00.000Z",
        acceptedAt: null,
        expiresAt: "2026-04-17T12:00:00.000Z",
        clientId: "client-1",
        clientName: "Acme",
        invitedById: "admin-1",
        invitedByName: "Admin User",
        canResend: true,
        canRevoke: true,
      },
      {
        id: "invite-2",
        email: "accepted.user@test.local",
        role: "manager",
        status: "accepted",
        invitedAt: "2026-04-01T12:00:00.000Z",
        acceptedAt: "2026-04-02T10:00:00.000Z",
        expiresAt: "2026-04-08T12:00:00.000Z",
        clientId: null,
        clientName: null,
        invitedById: "admin-1",
        invitedByName: "Admin User",
        canResend: false,
        canRevoke: false,
      },
    ]),
    resendInvite: vi.fn(async () => {}),
    revokeInvite: vi.fn(async () => {}),
    upsertClientUserMapping: vi.fn(async () => {}),
    deleteClientUserMapping: vi.fn(async () => {}),
    upsertEmailExcludeDomain: vi.fn(async () => {}),
    deleteEmailExcludeDomain: vi.fn(async () => {}),
  };

  return {
    ...base,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminUserManagementPage />
    </MemoryRouter>,
  );
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("admin user management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends client invite with selected client scope", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.client@test.local" } });
    await chooseOptionByLabel("Client", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(core.sendInvite).toHaveBeenCalledTimes(1);
    });

    expect(core.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.client@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("allows admin to resend pending invites", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    mockedUseCoreData.mockReturnValue(core as never);

    renderPage();

    await screen.findByText("pending.user@test.local");
    fireEvent.click(screen.getAllByRole("button", { name: "Resend" })[0]);

    await waitFor(() => {
      expect(core.resendInvite).toHaveBeenCalledTimes(1);
    });

    expect(core.resendInvite).toHaveBeenCalledWith("invite-1");
  });
});
