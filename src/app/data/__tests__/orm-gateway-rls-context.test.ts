import { describe, expect, it } from "vitest";
import { parseJwtClaims, resolvePassthroughRole } from "../../../../supabase/functions/orm-gateway/rls-context";

function buildToken(payload: Record<string, unknown>) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${header}.${body}.signature`;
}

describe("orm-gateway rls context helpers", () => {
  it("decodes JWT payload claims", () => {
    const claims = parseJwtClaims(buildToken({ sub: "user-1", role: "authenticated" }));
    expect(claims.sub).toBe("user-1");
    expect(claims.role).toBe("authenticated");
  });

  it("falls back to authenticated for unknown role", () => {
    expect(resolvePassthroughRole("admin")).toBe("authenticated");
    expect(resolvePassthroughRole("authenticated")).toBe("authenticated");
    expect(resolvePassthroughRole("service_role")).toBe("service_role");
  });
});
