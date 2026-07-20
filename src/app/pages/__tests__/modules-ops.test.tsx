import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlacklistPage } from "../blacklist-page";
import { DomainsPage } from "../domains-page";
import { InvoicesPage } from "../invoices-page";
import { useAuth } from "../../providers/auth";
import { repository } from "../../data/repository";

vi.mock("../../providers/auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../providers/shell-data", () => ({
  useShellData: vi.fn(() => ({
    clientsLite: [], usersLite: [], clientUsers: [], loading: false, error: null, refresh: vi.fn(),
  })),
}));

vi.mock("../../data/repository", () => ({
  RepositoryError: class RepositoryError extends Error {
    table = "domains"; operation = "select"; kind = "unknown";
    constructor(args: { message: string }) { super(args.message); }
  },
  repository: {
    loadDomainsPage: vi.fn(),
    loadInvoicesPage: vi.fn(),
    loadBlacklistPage: vi.fn(),
    createDomain: vi.fn(),
    updateDomain: vi.fn(),
    updateInvoice: vi.fn(),
    upsertEmailExcludeDomain: vi.fn(),
    deleteEmailExcludeDomain: vi.fn(),
  },
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedRepo = vi.mocked(repository);

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

const domain = {
  id: "domain-1", created_at: "2026-01-01", client_id: "client-1",
  domain_name: "acme.com", setup_email: "setup@acme.com",
  purchase_date: "2026-01-01",
  updated_at: "2026-01-12", status: "active", winnr_status: "active",
};

const client = { id: "client-1", name: "Acme", manager_id: "manager-1" };

describe("Sprint B module operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.loadDomainsPage.mockResolvedValue({ clients: [client], domains: [domain] } as never);
    mockedRepo.loadInvoicesPage.mockResolvedValue({ clients: [client], invoices: [{
      id: "invoice-1", created_at: "2026-01-01", client_id: "client-1",
      issue_date: "2026-01-10", amount: 1000, status: "pending", updated_at: "2026-01-10",
    }] } as never);
    mockedRepo.loadBlacklistPage.mockResolvedValue({ emailExcludeList: [{
      domain: "blocked.com", created_at: "2026-01-01",
    }] } as never);
    mockedRepo.updateDomain.mockResolvedValue(domain as never);
    mockedRepo.updateInvoice.mockResolvedValue({} as never);
    mockedRepo.upsertEmailExcludeDomain.mockResolvedValue({ domain: "spam.com", created_at: "2026-01-01" } as never);
    mockedRepo.deleteEmailExcludeDomain.mockResolvedValue(undefined as never);
  });

  it("saves domain draft changes", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);

    render(<MemoryRouter><DomainsPage /></MemoryRouter>);
    await act(async () => {});

    // Detail is a drawer now — click the domain row to open it before editing.
    fireEvent.click(screen.getAllByText("acme.com")[0]);
    await act(async () => {});

    await chooseOptionByLabel("Status", "blocked");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedRepo.updateDomain).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.updateDomain).toHaveBeenCalledWith("domain-1", expect.objectContaining({ status: "blocked" }));
  });

  // Invoice writes are admin-only in RLS (invoices_update_admin = private.is_admin_user()).
  it("saves invoice draft changes as admin", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);

    render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedRepo.updateInvoice).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.updateInvoice).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ amount: 1250 }));
  });

  // Regression guard: a manager can READ invoices but every write is rejected by RLS with 42501.
  // The edit controls must not be offered at all — see 09-mutations-rls.md §4.
  it("hides invoice edit controls from managers", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("manager") as never);

    render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
    await act(async () => {});

    // The invoice is still visible (row + drawer both name the client)...
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    // ...but it cannot be edited.
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    expect(screen.getByLabelText("Issue date")).toBeDisabled();
  });

  it("allows admin to add and remove blacklist domains", async () => {
    mockedUseAuth.mockReturnValue(makeAuth("admin") as never);

    render(<MemoryRouter><BlacklistPage /></MemoryRouter>);
    await act(async () => {});

    fireEvent.change(screen.getByLabelText("New blacklist domain"), { target: { value: "spam.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() => {
      expect(mockedRepo.upsertEmailExcludeDomain).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.upsertEmailExcludeDomain).toHaveBeenCalledWith("spam.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove domain" }));

    await waitFor(() => {
      expect(mockedRepo.deleteEmailExcludeDomain).toHaveBeenCalledTimes(1);
    });
    expect(mockedRepo.deleteEmailExcludeDomain).toHaveBeenCalledWith("blocked.com");
  });
});

async function chooseOptionByLabel(label: string, option: string | RegExp) {
  const trigger = screen.getByLabelText(label);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
