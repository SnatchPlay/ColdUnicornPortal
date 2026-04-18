import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

type RuntimeConfigMock = {
  authInviteOnly: boolean;
  authAllowMagicLink: boolean;
};

type AuthMock = {
  identity: null;
  session: null;
  loading: boolean;
  error: string | null;
  signInWithOtp: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  requestPasswordReset: ReturnType<typeof vi.fn>;
};

async function renderLoginPage(config: RuntimeConfigMock, authOverrides?: Partial<AuthMock>) {
  vi.resetModules();

  vi.doMock("../../lib/env", () => ({
    runtimeConfig: {
      authInviteOnly: config.authInviteOnly,
      authAllowMagicLink: config.authAllowMagicLink,
    },
  }));

  vi.doMock("../../providers/auth", () => ({
    useAuth: () =>
      ({
        identity: null,
        session: null,
        loading: false,
        error: null,
        signInWithOtp: vi.fn(async () => ({ ok: true, message: "ok" })),
        signInWithPassword: vi.fn(async () => ({ ok: true, message: "ok" })),
        requestPasswordReset: vi.fn(async () => ({ ok: true, message: "ok" })),
        ...authOverrides,
      }) satisfies AuthMock,
  }));

  const { LoginPage } = await import("../login-page");

  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("login production auth flags", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock("../../lib/env");
    vi.unmock("../../providers/auth");
  });

  it("hides self-signup copy when registration is disabled", async () => {
    await renderLoginPage({
      authInviteOnly: true,
      authAllowMagicLink: true,
    });

    expect(screen.getByText("Access is provisioned by your account administrator.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Magic link" })).toBeInTheDocument();
  });

  it("hides magic link entry when passwordless auth is disabled", async () => {
    await renderLoginPage({
      authInviteOnly: true,
      authAllowMagicLink: false,
    });

    expect(screen.queryByRole("button", { name: "Magic link" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forgot password" })).toBeInTheDocument();
  });
});
