import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock("../../lib/env", () => ({
  runtimeConfig: {
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "test-publishable-key",
    error: null,
    isConfigured: true,
  },
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
    },
  },
}));

describe("repository orm-gateway envelope handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token-a",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    mockRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "token-b",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
  });

  it("maps gateway permission envelope to RepositoryError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              message: "RLS policy denied",
              code: "42501",
            },
          }),
          { status: 403, statusText: "Forbidden" },
        ),
      ),
    );

    const { repository, RepositoryError } = await import("../repository");
    try {
      await repository.loadConditionRules();
      throw new Error("Expected loadConditionRules to fail.");
    } catch (reason) {
      expect(reason).toBeInstanceOf(RepositoryError);
      expect(reason).toMatchObject({
        kind: "permission",
        code: "42501",
        table: "condition_rules",
        operation: "select",
      });
    }
  });

  it("returns parsed data from success envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: [],
          }),
          { status: 200 },
        ),
      ),
    );

    const { repository } = await import("../repository");

    const rules = await repository.loadConditionRules();
    expect(rules).toEqual([]);
  });
});
