import { describe, expect, it } from "vitest";
import { parseOrmGatewayRequest } from "../orm-gateway-contract";

describe("parseOrmGatewayRequest", () => {
  it("accepts loadSnapshot payload", () => {
    const parsed = parseOrmGatewayRequest({ action: "loadSnapshot", includeDailyStats: true, leadsLimit: 50 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.action).toBe("loadSnapshot");
      expect(parsed.value.leadsLimit).toBe(50);
    }
  });

  it("rejects missing action", () => {
    const parsed = parseOrmGatewayRequest({});
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("action");
    }
  });

  it("rejects malformed update payload", () => {
    const parsed = parseOrmGatewayRequest({ action: "updateLead", leadId: "abc" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("updateLead");
    }
  });
});
