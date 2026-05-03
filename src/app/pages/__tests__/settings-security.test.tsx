import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../settings-page";
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

describe("settings security controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseCoreData.mockReturnValue({
      clients: [],
      conditionRules: [],
      createConditionRule: vi.fn(async () => {}),
      updateConditionRule: vi.fn(async () => {}),
      deleteConditionRule: vi.fn(async () => {}),
      updateClient: vi.fn(async () => {}),
    } as never);
  });

  it("handles profile name, password, reset link request, and sign out", async () => {
    const updateProfileName = vi.fn(async () => ({ ok: true, message: "Profile name updated successfully." }));
    const updatePassword = vi.fn(async () => ({ ok: true, message: "Password updated successfully." }));
    const requestPasswordReset = vi.fn(async () => ({ ok: true, message: "Password reset email sent." }));
    const signOut = vi.fn(async () => {});

    mockedUseAuth.mockReturnValue({
      actorIdentity: null,
      identity: {
        id: "admin-1",
        fullName: "Admin User",
        email: "admin@test.local",
        role: "admin",
      },
      session: { user: { email: "admin@test.local" } },
      error: null,
      isImpersonating: false,
      updateProfileName,
      updatePassword,
      requestPasswordReset,
      signOut,
    } as never);

    render(<SettingsPage />);

    expect(screen.queryByText("Implementation notes")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Enter full name"), { target: { value: "Admin Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Update name" }));

    await waitFor(() => {
      expect(updateProfileName).toHaveBeenCalledTimes(1);
    });
    expect(updateProfileName).toHaveBeenCalledWith("Admin Updated");

    fireEvent.change(screen.getByPlaceholderText("Enter new password"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat new password"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(updatePassword).toHaveBeenCalledTimes(1);
    });
    expect(updatePassword).toHaveBeenCalledWith("new-password-123");

    fireEvent.change(screen.getByPlaceholderText("name@company.com"), { target: { value: "ops@test.local" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    });
    expect(requestPasswordReset).toHaveBeenCalledWith("ops@test.local");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("hides current identity card for client role", () => {
    mockedUseAuth.mockReturnValue({
      actorIdentity: null,
      identity: {
        id: "client-1",
        fullName: "Client User",
        email: "client@test.local",
        role: "client",
        clientId: "client-1",
      },
      session: { user: { email: "client@test.local" } },
      error: null,
      isImpersonating: false,
      updateProfileName: vi.fn(async () => ({ ok: true, message: "ok" })),
      updatePassword: vi.fn(async () => ({ ok: true, message: "ok" })),
      requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
      signOut: vi.fn(async () => {}),
    } as never);

    render(<SettingsPage />);

    expect(screen.queryByText("Current identity")).not.toBeInTheDocument();
    expect(screen.queryByText("Request password reset link")).not.toBeInTheDocument();
    expect(screen.getByText("Security controls")).toBeInTheDocument();
  });
});
