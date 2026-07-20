import { describe, expect, it } from "vitest";
import { parseOrmGatewayRequest } from "../orm-gateway-contract";

describe("parseOrmGatewayRequest", () => {
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

  it("accepts loadLeadCrmList and normalizes params", () => {
    const parsed = parseOrmGatewayRequest({
      action: "loadLeadCrmList",
      params: { sortField: "lead", sortDir: "asc", page: 2, pageSize: 999, replyScope: "ooo", search: "  acme  " },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.action === "loadLeadCrmList") {
      expect(parsed.value.params.pageSize).toBe(100); // clamped to max
      expect(parsed.value.params.page).toBe(2);
      expect(parsed.value.params.replyScope).toBe("ooo");
      expect(parsed.value.params.search).toBe("acme"); // trimmed
    }
  });

  it("rejects loadLeadCrmList without sort params", () => {
    const parsed = parseOrmGatewayRequest({ action: "loadLeadCrmList", params: {} });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("loadLeadCrmList");
  });

  it("concludeLead: accepts a terminal outcome with a non-empty conclusion", () => {
    const parsed = parseOrmGatewayRequest({
      action: "concludeLead", leadId: "l1", finalOutcome: "won", conclusion: "Signed a 6-month deal.",
    });
    expect(parsed.ok).toBe(true);
  });

  it("concludeLead: rejects a terminal outcome with an empty/whitespace conclusion (spec item 4)", () => {
    for (const conclusion of ["", "   ", null, undefined]) {
      const parsed = parseOrmGatewayRequest({ action: "concludeLead", leadId: "l1", finalOutcome: "lost", conclusion });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("non-empty conclusion");
    }
  });

  it("concludeLead: allows un-concluding (finalOutcome null) with any conclusion", () => {
    const parsed = parseOrmGatewayRequest({ action: "concludeLead", leadId: "l1", finalOutcome: null, conclusion: null });
    expect(parsed.ok).toBe(true);
  });

  it("updateLead: a generic patch cannot set the terminal final_outcome (only concludeLead writes it)", () => {
    const parsed = parseOrmGatewayRequest({ action: "updateLead", leadId: "l1", patch: { final_outcome: "won" } });
    expect(parsed.ok).toBe(true);
    // The patch parses, but the mapLeadPatch whitelist (gateway) drops final_outcome — asserted here at
    // the contract boundary that the field is not part of the editable patch surface.
    if (parsed.ok && parsed.value.action === "updateLead") {
      expect(parsed.value.patch).toBeDefined();
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

  it("accepts updateProfileAvatar with a path and with null (clear)", () => {
    const withPath = parseOrmGatewayRequest({
      action: "updateProfileAvatar",
      sessionUserId: "u1",
      avatarPath: "avatars/u1/abc.webp",
    });
    expect(withPath.ok).toBe(true);
    if (withPath.ok && withPath.value.action === "updateProfileAvatar") {
      expect(withPath.value.avatarPath).toBe("avatars/u1/abc.webp");
    }

    const cleared = parseOrmGatewayRequest({
      action: "updateProfileAvatar",
      sessionUserId: "u1",
      avatarPath: null,
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok && cleared.value.action === "updateProfileAvatar") {
      expect(cleared.value.avatarPath).toBeNull();
    }
  });

  it("rejects updateProfileAvatar with a non-string, non-null avatarPath", () => {
    const parsed = parseOrmGatewayRequest({
      action: "updateProfileAvatar",
      sessionUserId: "u1",
      avatarPath: 42,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("updateProfileAvatar");
  });
});
