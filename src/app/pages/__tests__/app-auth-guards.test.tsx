import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

type AuthState = {
  loading: boolean;
  session: unknown;
  identity: {
    id: string;
    fullName: string;
    email: string;
    role: "client" | "manager" | "admin" | "super_admin";
    clientId?: string;
  } | null;
  error: string | null;
  errorCode: "profile_missing" | "client_mapping_missing" | "permission" | "session_invalid" | "network" | null;
  refreshIdentity: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

async function renderGuardApp(authState: Partial<AuthState>, initialEntry = "/client/dashboard") {
  vi.resetModules();

  vi.doMock("../../providers/auth", () => ({
    useAuth: () =>
      ({
        loading: false,
        session: { user: { id: "user-1" } },
        identity: null,
        error: null,
        errorCode: null,
        refreshIdentity: vi.fn(async () => {}),
        signOut: vi.fn(async () => {}),
        ...authState,
      }) satisfies AuthState,
  }));

  vi.doMock("../../lib/env", () => ({
    runtimeConfig: {
      isConfigured: false,
      error: null,
      allowInternalImpersonation: false,
    },
  }));

  const { ClientAccessBlocker, RequireAuth, RequireRole, SessionAccessBlocker } = await import("../../App");

  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<div>Login route</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/blocked" element={<SessionAccessBlocker />} />
          <Route path="/client" element={<RequireRole allowed={["client"]} />}>
            <Route
              path="dashboard"
              element={authState.identity?.clientId ? <div>Client dashboard</div> : <ClientAccessBlocker />}
            />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("app auth guards", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock("../../providers/auth");
    vi.unmock("../../lib/env");
  });

  it("redirects unauthenticated sessions to login", async () => {
    await renderGuardApp(
      {
        session: null,
      },
      "/blocked",
    );

    expect(screen.getByText("Login route")).toBeInTheDocument();
  });

  it("renders a blocker when the session exists but profile bootstrap failed", async () => {
    await renderGuardApp(
      {
        identity: null,
        error: "Your account is authenticated, but the portal profile is not provisioned yet.",
        errorCode: "profile_missing",
      },
      "/blocked",
    );

    expect(screen.getByText("Account access requires attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry account check" })).toBeInTheDocument();
  });

  it("blocks client routes when client mapping is missing", async () => {
    await renderGuardApp({
      identity: {
        id: "client-1",
        fullName: "Client User",
        email: "client@test.local",
        role: "client",
      },
      error: "Your client account is authenticated, but no client access mapping is assigned yet.",
      errorCode: "client_mapping_missing",
    });

    expect(screen.getByText("Account setup required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry setup check" })).toBeInTheDocument();
  });
});
