import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    listManagedUsers: vi.fn(),
    updateUserRole: vi.fn(),
    setUserActive: vi.fn(),
  },
}));

function makeUser(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-x",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    email: "user.x@test.local",
    first_name: "User",
    last_name: "X",
    role: "manager",
    is_active: true,
    deactivated_at: null,
    deactivated_by: null,
    ...over,
  };
}

const adminSelf = makeUser({ id: "admin-1", email: "admin@test.local", role: "admin", first_name: "Admin", last_name: "User" });
const managerUser = makeUser({ id: "manager-9", email: "manager.nine@test.local", role: "manager" });

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

function makeAuth() {
  return {
    identity: { id: "admin-1", fullName: "Admin User", email: "admin@test.local", role: "admin" },
    actorIdentity: { id: "admin-1", fullName: "Admin User", email: "admin@test.local", role: "admin" },
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
    mockedRepo.listManagedUsers.mockResolvedValue([adminSelf, managerUser] as never);
    mockedRepo.updateUserRole.mockImplementation(
      async (id: string, role: string) => makeUser({ ...managerUser, id, role }) as never,
    );
    mockedRepo.setUserActive.mockImplementation(
      async (id: string, active: boolean) =>
        makeUser({ ...managerUser, id, is_active: active, deactivated_at: active ? null : "2026-06-18T00:00:00.000Z" }) as never,
    );
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

  it("lists team users for an admin (2B)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    expect(await screen.findByText("manager.nine@test.local")).toBeInTheDocument();
    expect(mockedRepo.listManagedUsers).toHaveBeenCalledTimes(1);
  });

  async function findUserRow(email: string) {
    const emailEl = await screen.findByText(email);
    return emailEl.closest("div.min-w-0")!.parentElement as HTMLElement;
  }

  it("changes a user's role (2C)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    const row = await findUserRow("manager.nine@test.local");

    // The manager row's role selector → choose Admin (options render in a portal).
    fireEvent.click(within(row).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "admin" }));

    await waitFor(() => {
      expect(mockedRepo.updateUserRole).toHaveBeenCalledWith("manager-9", "admin");
    });
  });

  it("deactivates a user after confirmation (2C)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    const row = await findUserRow("manager.nine@test.local");

    fireEvent.click(within(row).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(mockedRepo.setUserActive).toHaveBeenCalledWith("manager-9", false);
    });
    confirmSpy.mockRestore();
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
