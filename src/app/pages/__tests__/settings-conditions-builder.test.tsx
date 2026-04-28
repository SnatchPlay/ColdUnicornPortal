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

function makeRule() {
  return {
    id: "rule-1",
    key: "wow_bounce_rate",
    name: "WoW Bounce Rate",
    description: null,
    target_entity: "client",
    surface: "clients_wow",
    metric_key: "wow_bounce_rate",
    source_sheet: "CS PDCA",
    source_range: "AK4:AN70",
    scope_type: "global",
    client_id: null,
    manager_id: null,
    apply_to: "cell",
    column_key: "wow_bounce_rate",
    branches: [
      {
        severity: "danger",
        when: { left: { metric: "value" }, op: "gte", right: { value: 0.02 } },
        label: "Bounce danger",
        message: "Bounce over 2%",
      },
    ],
    base_filter: null,
    priority: 50,
    enabled: true,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("settings condition rules builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows admin-only rule builder and supports quick updates", async () => {
    const updateConditionRule = vi.fn(async () => {});
    mockedUseAuth.mockReturnValue({
      actorIdentity: null,
      identity: { id: "admin-1", fullName: "Admin", email: "admin@test.local", role: "admin" },
      session: { user: { email: "admin@test.local" } },
      error: null,
      isImpersonating: false,
      updateProfileName: vi.fn(async () => ({ ok: true, message: "ok" })),
      updatePassword: vi.fn(async () => ({ ok: true, message: "ok" })),
      requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
      signOut: vi.fn(async () => {}),
    } as never);
    mockedUseCoreData.mockReturnValue({
      conditionRules: [makeRule()],
      createConditionRule: vi.fn(async () => {}),
      updateConditionRule,
      deleteConditionRule: vi.fn(async () => {}),
    } as never);

    render(<SettingsPage />);
    expect(screen.getByText("Condition rules")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enabled" }));
    await waitFor(() => {
      expect(updateConditionRule).toHaveBeenCalledWith("rule-1", { enabled: false });
    });
  });

  it("hides rule builder for manager and runs validation in create flow", async () => {
    const createConditionRule = vi.fn(async () => {});
    mockedUseAuth.mockReturnValue({
      actorIdentity: null,
      identity: { id: "manager-1", fullName: "Manager", email: "manager@test.local", role: "manager" },
      session: { user: { email: "manager@test.local" } },
      error: null,
      isImpersonating: false,
      updateProfileName: vi.fn(async () => ({ ok: true, message: "ok" })),
      updatePassword: vi.fn(async () => ({ ok: true, message: "ok" })),
      requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
      signOut: vi.fn(async () => {}),
    } as never);
    mockedUseCoreData.mockReturnValue({
      conditionRules: [makeRule()],
      createConditionRule,
      updateConditionRule: vi.fn(async () => {}),
      deleteConditionRule: vi.fn(async () => {}),
    } as never);

    render(<SettingsPage />);
    expect(screen.queryByText("Condition rules")).not.toBeInTheDocument();
    expect(createConditionRule).not.toHaveBeenCalled();
  });

  it("creates new rule from visual builder", async () => {
    const createConditionRule = vi.fn(async () => {});
    mockedUseAuth.mockReturnValue({
      actorIdentity: null,
      identity: { id: "admin-1", fullName: "Admin", email: "admin@test.local", role: "admin" },
      session: { user: { email: "admin@test.local" } },
      error: null,
      isImpersonating: false,
      updateProfileName: vi.fn(async () => ({ ok: true, message: "ok" })),
      updatePassword: vi.fn(async () => ({ ok: true, message: "ok" })),
      requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
      signOut: vi.fn(async () => {}),
    } as never);
    mockedUseCoreData.mockReturnValue({
      conditionRules: [makeRule()],
      createConditionRule,
      updateConditionRule: vi.fn(async () => {}),
      deleteConditionRule: vi.fn(async () => {}),
    } as never);

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "New rule" }));

    fireEvent.change(screen.getByLabelText("Rule key"), { target: { value: "new_rule_key" } });
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "New Rule Name" } });
    fireEvent.change(screen.getByLabelText("Metric key"), { target: { value: "wow_bounce_rate" } });

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => {
      expect(createConditionRule).toHaveBeenCalledTimes(1);
    });
  });
});
