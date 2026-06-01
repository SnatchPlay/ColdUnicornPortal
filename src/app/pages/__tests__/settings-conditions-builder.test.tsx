import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../settings-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

// These tests exercise the real condition-rule builder, so it stays unmocked.
// But the master-admin clients table-customization (mega-table) and the client
// CRM card never render for super_admin/manager — stub them so this file does
// not pull those heavy module graphs and tip the full suite over the heap limit.
vi.mock("../clients-page/mega-table", () => ({
  MEGA_COLUMNS: [],
}));
vi.mock("../../components/crm-integration-card", () => ({
  CrmIntegrationCard: () => null,
}));

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/core-data", () => ({
  useCoreData: vi.fn(() => ({
    clients: [], conditionRules: [], columnOverrides: [], clientCustomFields: [],
    createConditionRule: vi.fn(), updateConditionRule: vi.fn(), deleteConditionRule: vi.fn(),
  })),
}));

vi.mock("../../providers/shell-data", () => ({
  useShellData: vi.fn(() => ({
    clientsLite: [], usersLite: [], clientUsers: [], loading: false, error: null, refresh: vi.fn(),
  })),
}));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "settings"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadAdminSettings: vi.fn(),
    createConditionRule: vi.fn(),
    updateConditionRule: vi.fn(),
    deleteConditionRule: vi.fn(),
    upsertColumnOverride: vi.fn(),
    setColumnOrder: vi.fn(),
    createClientCustomField: vi.fn(),
    updateClientCustomField: vi.fn(),
    deleteClientCustomField: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

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

function makeSettings(overrides: { conditionRules?: ReturnType<typeof makeRule>[] } = {}) {
  return {
    clients: [],
    conditionRules: overrides.conditionRules ?? [],
    columnOverrides: [],
    clientCustomFields: [],
  };
}

function makeAuth(role: "super_admin" | "manager" = "super_admin") {
  return {
    actorIdentity: null,
    identity: {
      id: role === "super_admin" ? "super-admin-1" : "manager-1",
      fullName: role === "super_admin" ? "Admin" : "Manager",
      email: `${role}@test.local`,
      role,
    },
    session: { user: { email: `${role}@test.local` } },
    error: null,
    isImpersonating: false,
    updateProfileName: vi.fn(async () => ({ ok: true, message: "ok" })),
    updatePassword: vi.fn(async () => ({ ok: true, message: "ok" })),
    requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
    signOut: vi.fn(async () => {}),
  };
}

describe("settings condition rules builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.updateConditionRule.mockResolvedValue(makeRule() as never);
    mockedRepo.createConditionRule.mockResolvedValue(makeRule() as never);
  });

  it("shows admin-only rule builder and supports quick updates", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("super_admin") as never);
    mockedRepo.loadAdminSettings.mockResolvedValue(makeSettings({ conditionRules: [makeRule()] }) as never);

    render(<SettingsPage />);
    await act(async () => {});

    expect(screen.getByText("Condition rules")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enabled" }));
    await waitFor(() => {
      expect(mockedRepo.updateConditionRule).toHaveBeenCalledWith("rule-1", { enabled: false });
    });
  });

  it("hides rule builder for manager", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedRepo.loadAdminSettings.mockResolvedValue(makeSettings({ conditionRules: [makeRule()] }) as never);

    render(<SettingsPage />);
    await act(async () => {});

    expect(screen.queryByText("Condition rules")).not.toBeInTheDocument();
    expect(mockedRepo.createConditionRule).not.toHaveBeenCalled();
  });

  it("creates new rule from visual builder", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("super_admin") as never);
    mockedRepo.loadAdminSettings.mockResolvedValue(makeSettings({ conditionRules: [makeRule()] }) as never);

    render(<SettingsPage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "New rule" }));

    const keyInput = Array.from(document.querySelectorAll<HTMLInputElement>("input")).find(
      (input) => input.value.startsWith("new-rule-"),
    );
    if (!keyInput) throw new Error("Could not find rule key input");
    fireEvent.change(keyInput, { target: { value: "new_rule_key" } });
    fireEvent.change(screen.getByDisplayValue("New rule"), { target: { value: "New Rule Name" } });

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => {
      expect(mockedRepo.createConditionRule).toHaveBeenCalledTimes(1);
    });
  });
});
