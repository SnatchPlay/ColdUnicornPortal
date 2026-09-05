import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserManagementPage } from "../admin-user-management-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/shell-data", () => ({
  useShellData: vi.fn(() => ({
    clientsLite: [
      { id: "client-2", name: "Zebra Corp", manager_id: "manager-1", status: "active", kpi_leads: null, kpi_meetings: null, notification_emails: null },
      { id: "client-1", name: "Acme", manager_id: "manager-1", status: "active", kpi_leads: null, kpi_meetings: null, notification_emails: null },
      { id: "client-3", name: "Beta Ltd", manager_id: "manager-1", status: "active", kpi_leads: null, kpi_meetings: null, notification_emails: null },
    ],
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
    setUserAvatar: vi.fn(),
    setUserName: vi.fn(),
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
    mockedRepo.setUserName.mockImplementation(
      async (id: string, first: string, last: string) =>
        makeUser({ ...managerUser, id, first_name: first, last_name: last }) as never,
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

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: " Anna " } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Derevianko" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.client@test.local" } });
    await chooseOptionByLabel("Client", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockedRepo.sendInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new.client@test.local",
        role: "client",
        clientId: "client-1",
        firstName: "Anna",
        lastName: "Derevianko",
      }),
    );
  });

  it("refuses to send an invitation without a first and last name", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);

    renderPage();
    await act(async () => {}); // flush listInvites

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.client@test.local" } });
    await chooseOptionByLabel("Client", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText("Enter both a first and a last name for the invited user.")).toBeInTheDocument();
    expect(mockedRepo.sendInvite).not.toHaveBeenCalled();
  });

  it("lists invite clients A→Z and narrows them from inside the dropdown", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);

    renderPage();
    await act(async () => {}); // flush listInvites

    // Closed, the field is a plain trigger — there is no separate search row anywhere.
    expect(screen.queryByLabelText("Search clients")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Client"));
    // Open, the trigger itself became the search input (no second row was added).
    expect(screen.queryByLabelText("Client")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Search clients")).toHaveFocus();
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Acme",
      "Beta Ltd",
      "Zebra Corp",
    ]);

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "zeb" } });
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Zebra Corp"]);

    // Escape restores the trigger and drops the query.
    fireEvent.keyDown(screen.getByLabelText("Search clients"), { key: "Escape" });
    await waitFor(() => expect(screen.getByLabelText("Client")).toBeInTheDocument());
    expect(screen.queryByLabelText("Search clients")).not.toBeInTheDocument();
  });

  it("picks a client with the keyboard from inside the dropdown", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);

    renderPage();
    await act(async () => {}); // flush listInvites

    fireEvent.change(screen.getByLabelText("First name", { exact: true }), { target: { value: "Olena" } });
    fireEvent.change(screen.getByLabelText("Last name", { exact: true }), { target: { value: "Kovalenko" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.client@test.local" } });

    fireEvent.click(screen.getByLabelText("Client"));
    // The trigger *is* the search field while open, so the button node is gone until it closes.
    const search = await screen.findByLabelText("Search clients");
    fireEvent.change(search, { target: { value: "b" } }); // matches Beta Ltd, then Zebra Corp
    fireEvent.keyDown(search, { key: "ArrowDown" }); // move off Beta Ltd onto Zebra Corp
    fireEvent.keyDown(search, { key: "Enter" });

    // Selection shows on the trigger even though the dropdown (and its filter) is gone.
    await waitFor(() => expect(screen.getByLabelText("Client")).toHaveTextContent("Zebra Corp"));
    expect(screen.queryByLabelText("Search clients")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => {
      expect(mockedRepo.sendInvite).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-2" }));
    });
  });

  it("lists team users for an admin (2B)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    expect(await screen.findByText("manager.nine@test.local")).toBeInTheDocument();
    expect(mockedRepo.listManagedUsers).toHaveBeenCalledTimes(1);
  });

  async function findUserRow(email: string) {
    const emailEl = await screen.findByText(email);
    return emailEl.closest('[data-testid="user-row"]') as HTMLElement;
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

  it("saves a corrected first/last name on blur (2C)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    await findUserRow("manager.nine@test.local");

    const firstNameInput = screen.getByLabelText("First name for manager.nine@test.local");
    fireEvent.change(firstNameInput, { target: { value: "Marta" } });
    fireEvent.blur(firstNameInput);

    await waitFor(() => {
      expect(mockedRepo.setUserName).toHaveBeenCalledWith("manager-9", "Marta", "X");
    });
  });

  it("saves both names in one RPC when tabbing between the fields", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    await findUserRow("manager.nine@test.local");

    const firstNameInput = screen.getByLabelText("First name for manager.nine@test.local");
    const lastNameInput = screen.getByLabelText("Last name for manager.nine@test.local");
    fireEvent.change(firstNameInput, { target: { value: "Marta" } });
    // Focus moves to the sibling input — one logical edit, so no commit yet.
    fireEvent.blur(firstNameInput, { relatedTarget: lastNameInput });
    fireEvent.change(lastNameInput, { target: { value: "Nowak" } });
    fireEvent.blur(lastNameInput);

    await waitFor(() => {
      expect(mockedRepo.setUserName).toHaveBeenCalledWith("manager-9", "Marta", "Nowak");
    });
    expect(mockedRepo.setUserName).toHaveBeenCalledTimes(1);
  });

  it("reverts and warns when both names are cleared", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    await findUserRow("manager.nine@test.local");

    const firstNameInput = screen.getByLabelText("First name for manager.nine@test.local");
    const lastNameInput = screen.getByLabelText("Last name for manager.nine@test.local");
    fireEvent.change(firstNameInput, { target: { value: "" } });
    fireEvent.blur(firstNameInput, { relatedTarget: lastNameInput });
    fireEvent.change(lastNameInput, { target: { value: "" } });
    fireEvent.blur(lastNameInput);

    expect(await screen.findByText("A user needs at least a first or a last name.")).toBeInTheDocument();
    expect(mockedRepo.setUserName).not.toHaveBeenCalled();
    // The row must not keep showing a name the server does not have.
    expect(firstNameInput).toHaveValue("User");
    expect(lastNameInput).toHaveValue("X");
  });

  it("adopts a record refreshed underneath an untouched row", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    // `send-invite` rewrites the name of an address that already has an account, and the page
    // refreshes the user list right after.
    mockedRepo.listManagedUsers
      .mockResolvedValueOnce([adminSelf, managerUser] as never)
      .mockResolvedValueOnce([
        adminSelf,
        makeUser({ ...managerUser, first_name: "Renamed", last_name: "Elsewhere" }),
      ] as never);
    renderPage();
    await findUserRow("manager.nine@test.local");

    const firstNameInput = screen.getByLabelText("First name for manager.nine@test.local") as HTMLInputElement;

    fireEvent.change(screen.getByLabelText("First name", { exact: true }), { target: { value: "Olena" } });
    fireEvent.change(screen.getByLabelText("Last name", { exact: true }), { target: { value: "Kovalenko" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "manager.nine@test.local" } });
    await chooseOptionByLabel("Client", "Acme"); // the Radix select steals focus, so focus after it

    // Focus the row without typing anything, then let the refresh land on top of it.
    firstNameInput.focus(); // real focus — `fireEvent.focus` does not move document.activeElement
    expect(document.activeElement).toBe(firstNameInput);
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(firstNameInput).toHaveValue("Renamed"));
    // …and blurring the untouched row must not write the stale name back.
    fireEvent.blur(firstNameInput);
    await act(async () => {});
    expect(mockedRepo.setUserName).not.toHaveBeenCalled();
  });

  it("ignores a slow name save that a newer one has superseded", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    // The fields stay editable during a save, so two writes on one row can overlap. The first
    // response arrives last and must not repaint the row with a name the DB no longer has.
    mockedRepo.setUserName
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(makeUser({ ...managerUser, first_name: "Slow" }) as never), 60),
          ),
      )
      .mockImplementationOnce(async () => makeUser({ ...managerUser, first_name: "Fast" }) as never);

    renderPage();
    await findUserRow("manager.nine@test.local");
    const firstNameInput = screen.getByLabelText("First name for manager.nine@test.local");

    fireEvent.change(firstNameInput, { target: { value: "Slow" } });
    fireEvent.blur(firstNameInput);
    fireEvent.change(firstNameInput, { target: { value: "Fast" } });
    fireEvent.blur(firstNameInput);

    await waitFor(() => expect(mockedRepo.setUserName).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 120)); // let the stale response land
    expect(firstNameInput).toHaveValue("Fast");
  });

  it("locks the name fields on your own row (Settings owns self edits)", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    await findUserRow("admin@test.local");

    expect(screen.getByLabelText("First name for admin@test.local")).toBeDisabled();
    expect(screen.getByLabelText("Last name for admin@test.local")).toBeDisabled();
    expect(screen.getByLabelText("First name for manager.nine@test.local")).toBeEnabled();
  });

  it("does not call the RPC when a name is blurred unchanged", async () => {
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();
    await findUserRow("manager.nine@test.local");

    const lastNameInput = screen.getByLabelText("Last name for manager.nine@test.local");
    fireEvent.change(lastNameInput, { target: { value: "X" } });
    fireEvent.blur(lastNameInput);

    await act(async () => {});
    expect(mockedRepo.setUserName).not.toHaveBeenCalled();
  });

  it("searches and paginates the team users list", async () => {
    const manyUsers = Array.from({ length: 17 }, (_, index) =>
      makeUser({ id: `user-${index}`, email: `user${index}@test.local`, first_name: "User", last_name: `N${index}` }),
    );
    mockedRepo.listManagedUsers.mockResolvedValue([adminSelf, ...manyUsers] as never);
    mockedUseAuth.mockReturnValue(makeAuth() as never);
    renderPage();

    // 18 active users → 15 on page 1, 3 on page 2.
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(15));
    fireEvent.click(screen.getByRole("link", { name: "2" }));
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(3));

    fireEvent.change(screen.getByLabelText("Search team users"), { target: { value: "user16@" } });
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(1));
    expect(screen.getByText("user16@test.local")).toBeInTheDocument();
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
