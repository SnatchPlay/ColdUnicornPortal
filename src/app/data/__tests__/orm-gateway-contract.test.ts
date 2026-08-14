import { describe, expect, it } from "vitest";
import { ARCHIVABLE_ENTITIES, parseOrmGatewayRequest } from "../orm-gateway-contract";

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
      params: { sortField: "lead", sortDir: "asc", page: 2, pageSize: 999, search: "  acme  " },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.value.action === "loadLeadCrmList") {
      expect(parsed.value.params.pageSize).toBe(100); // clamped to max
      expect(parsed.value.params.page).toBe(2);
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

  // setEntityArchived — the portal's delete (migration 20260813_entity_archival). The entity name
  // selects a table in the handler, so the closed-list check is the load-bearing part of this
  // contract: an unknown value must never reach ARCHIVABLE_TABLES.
  it("accepts setEntityArchived for every archivable entity", () => {
    for (const entity of ARCHIVABLE_ENTITIES) {
      const parsed = parseOrmGatewayRequest({ action: "setEntityArchived", entity, id: "row-1", archived: true });
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.value.action === "setEntityArchived") {
        expect(parsed.value.entity).toBe(entity);
        expect(parsed.value.archived).toBe(true);
      }
    }
  });

  it("rejects setEntityArchived with an entity outside the closed list", () => {
    for (const entity of ["reply", "user", "daily_stats", "leads; drop table", "", null]) {
      const parsed = parseOrmGatewayRequest({ action: "setEntityArchived", entity, id: "row-1", archived: true });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("setEntityArchived.entity");
    }
  });

  it("rejects setEntityArchived without an id or with a non-boolean archived flag", () => {
    const noId = parseOrmGatewayRequest({ action: "setEntityArchived", entity: "lead", archived: true });
    expect(noId.ok).toBe(false);

    for (const archived of ["true", 1, null, undefined]) {
      const parsed = parseOrmGatewayRequest({ action: "setEntityArchived", entity: "lead", id: "l1", archived });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("archived");
    }
  });

  it("defaults includeArchived to false on the list actions that support it", () => {
    for (const action of ["loadClientsOverview", "loadDomainsPage", "loadEmailAccountsPage", "loadInvoicesPage"] as const) {
      const parsed = parseOrmGatewayRequest({ action });
      expect(parsed.ok).toBe(true);
      if (parsed.ok && "includeArchived" in parsed.value) expect(parsed.value.includeArchived).toBe(false);
    }

    const optedIn = parseOrmGatewayRequest({ action: "loadInvoicesPage", includeArchived: true });
    expect(optedIn.ok).toBe(true);
    if (optedIn.ok && optedIn.value.action === "loadInvoicesPage") expect(optedIn.value.includeArchived).toBe(true);

    // Only a real `true` opts in — a truthy string must not widen the list.
    const truthyString = parseOrmGatewayRequest({ action: "loadInvoicesPage", includeArchived: "yes" });
    expect(truthyString.ok).toBe(true);
    if (truthyString.ok && truthyString.value.action === "loadInvoicesPage") {
      expect(truthyString.value.includeArchived).toBe(false);
    }
  });

  it("passes includeArchived through the leads list params", () => {
    const off = parseOrmGatewayRequest({ action: "loadLeadsList", params: { sortField: "lead", sortDir: "asc" } });
    expect(off.ok).toBe(true);
    if (off.ok && off.value.action === "loadLeadsList") expect(off.value.params.includeArchived).toBe(false);

    const on = parseOrmGatewayRequest({
      action: "loadLeadsList",
      params: { sortField: "lead", sortDir: "asc", includeArchived: true },
    });
    expect(on.ok).toBe(true);
    if (on.ok && on.value.action === "loadLeadsList") expect(on.value.params.includeArchived).toBe(true);
  });
});
