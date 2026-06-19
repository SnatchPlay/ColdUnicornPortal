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

  it("accepts createLeadCustomField with a valid input", () => {
    const parsed = parseOrmGatewayRequest({
      action: "createLeadCustomField",
      input: { client_id: "c1", name: "Region", field_type: "text" },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.action).toBe("createLeadCustomField");
  });

  it("rejects createLeadCustomField missing client_id", () => {
    const parsed = parseOrmGatewayRequest({
      action: "createLeadCustomField",
      input: { name: "Region", field_type: "text" },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("client_id");
  });

  it("accepts upsertLeadCustomFieldValue and a null value", () => {
    const parsed = parseOrmGatewayRequest({
      action: "upsertLeadCustomFieldValue",
      leadId: "l1",
      fieldId: "f1",
      value: null,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.action).toBe("upsertLeadCustomFieldValue");
  });
});
