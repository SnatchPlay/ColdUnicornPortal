import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlacklistPage } from "../blacklist-page";
import { DomainsPage } from "../domains-page";
import { InvoicesPage } from "../invoices-page";
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

function makeAuth(role: "admin" | "manager") {
  return {
    identity: {
      id: role === "admin" ? "admin-1" : "manager-1",
      fullName: role === "admin" ? "Admin User" : "Manager User",
      email: `${role}@test.local`,
      role,
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
    domains: [
      {
        id: "domain-1",
        created_at: "2026-01-01",
        client_id: "client-1",
        domain_name: "acme.com",
        setup_email: "setup@acme.com",
        purchase_date: "2026-01-01",
        exchange_date: "2026-01-10",
        updated_at: "2026-01-12",
        status: "active",
        reputation: "good",
        exchange_cost: 199,
        campaign_verified_at: null,
        warmup_verified_at: null,
      },
    ],
    invoices: [
      {
        id: "invoice-1",
        created_at: "2026-01-01",
        client_id: "client-1",
        issue_date: "2026-01-10",
        amount: 1000,
        status: "pending",
        updated_at: "2026-01-10",
      },
    ],
    emailExcludeList: [
      {
        domain: "blocked.com",
        created_at: "2026-01-01",
      },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    updateClient: vi.fn(async () => {}),
    updateCampaign: vi.fn(async () => {}),
    updateLead: vi.fn(async () => {}),
    updateDomain: vi.fn(async () => {}),
    updateInvoice: vi.fn(async () => {}),
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

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Sprint B module operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves domain draft changes", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedUseCoreData.mockReturnValue(core as never);

    render(
      <MemoryRouter>
        <DomainsPage />
      </MemoryRouter>,
    );

    await chooseOptionByLabel("Status", "blocked");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(core.updateDomain).toHaveBeenCalledTimes(1);
    });
    expect(core.updateDomain).toHaveBeenCalledWith("domain-1", expect.objectContaining({ status: "blocked" }));
  });

  it("saves invoice draft changes", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);
    mockedUseCoreData.mockReturnValue(core as never);

    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(core.updateInvoice).toHaveBeenCalledTimes(1);
    });
    expect(core.updateInvoice).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ amount: 1250 }));
  });

  it("allows admin to add and remove blacklist domains", async () => {
    const core = makeCoreData();
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);
    mockedUseCoreData.mockReturnValue(core as never);

    render(
      <MemoryRouter>
        <BlacklistPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("New blacklist domain"), { target: { value: "spam.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() => {
      expect(core.upsertEmailExcludeDomain).toHaveBeenCalledTimes(1);
    });
    expect(core.upsertEmailExcludeDomain).toHaveBeenCalledWith("spam.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));

    await waitFor(() => {
      expect(core.deleteEmailExcludeDomain).toHaveBeenCalledTimes(1);
    });
    expect(core.deleteEmailExcludeDomain).toHaveBeenCalledWith("blocked.com");
  });
});
