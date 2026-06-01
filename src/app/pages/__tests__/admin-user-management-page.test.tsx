import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserManagementPage } from "../admin-user-management-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

// core-data mock prevents the heavy transitive load from crm-integration-card etc.
vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(() => ({ clients: [], loading: false, error: null, refresh: vi.fn() })),
}));

vi.mock("../../providers/shell-data", () => ({
  useShellData: vi.fn(() => ({
    clientsLite: [{ id: "client-1", name: "Acme", manager_id: "manager-1", status: "active", kpi_leads: null, kpi_meetings: null, notification_emails: null }],
    usersLite: [],
    clientUsers: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

const pendingInvite = {
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
};

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "invites"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    listInvites: vi.fn(),
    sendInvite: vi.fn(),
    resendInvite: vi.fn(),
    revokeInvite: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

function makeAuth() {
  return {
    identity: { id: "admin-1", fullName: "Admin User", email: "admin@test.local", role: "admin" },
  };
}

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function renderPage() {
  return render(<MemoryRouter><AdminUserManagementPage /></MemoryRouter>);
}

describe("admin user management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.listInvites.mockResolvedValue([pendingInvite] as never);
    mockedRepo.sendInvite.mockResolvedValue({ inviteId: "invite-new" } as never);
    mockedRepo.resendInvite.mockResolvedValue(pendingInvite as never);
    mockedRepo.revokeInvite.mockResolvedValue(undefined as never);
  });

  it("sends client invite with selected client scope", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);

    renderPage();
    await act(async () => {}); // flush listInvites

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.client@test.local" } });
    await chooseOptionByLabel("Client", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockedRepo.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.client@test.local", role: "client", clientId: "client-1" }),
    );
  });

  it("allows admin to resend pending invites", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);

    renderPage();

    await screen.findByText("pending.user@test.local");
    fireEvent.click(screen.getAllByRole("button", { name: "Resend" })[0]);

    await waitFor(() => {
      expect(mockedRepo.resendInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.resendInvite).toHaveBeenCalledWith("invite-1");
  });
});
