import { describe, expect, it } from "vitest";
import { LEAD_CRM_REGISTRY, LEAD_CRM_REGISTRY_LIST } from "../lead-crm-registry";

/** Spreadsheet letters A..AS — kept as traceability metadata, in document order. */
const EXPECTED_LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL",
  "AM", "AN", "AO", "AP", "AQ", "AR", "AS",
];

describe("Lead CRM registry (canonical source of truth, keyed by semantic id)", () => {
  it("is keyed by stable semantic ids, not spreadsheet letters", () => {
    // The keys are the semantic column ids; a letter must NOT appear as a key.
    const keys = Object.keys(LEAD_CRM_REGISTRY);
    expect(keys).toContain("days_to_contact");
    expect(keys).toContain("process_issues");
    expect(keys).not.toContain("Q");
    expect(keys).not.toContain("AO");
    // Every entry's healthId (when present) equals its own key — one identifier across registry/health.
    for (const [id, entry] of Object.entries(LEAD_CRM_REGISTRY)) {
      if (entry.healthId) expect(entry.healthId).toBe(id);
    }
  });

  it("has unique spreadsheet references A:AS in document order (traceability only)", () => {
    const references = LEAD_CRM_REGISTRY_LIST.map((e) => e.spreadsheetColumn);
    expect(new Set(references).size).toBe(references.length); // unique
    expect(references).toHaveLength(45);
    expect(references).toEqual(EXPECTED_LETTERS); // Object.values preserves insertion (document) order
  });

  it("every entry carries the full metadata contract (acceptance #2)", () => {
    for (const e of LEAD_CRM_REGISTRY_LIST) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.stage).toBeTruthy();
      expect(e.modes.length).toBeGreaterThan(0);
      expect(e.source).toBeTruthy();
      expect(e.implementationStatus).toBeTruthy();
      expect(e.editable).toBeTruthy();
      expect(e.visibility).toMatchObject({
        client: expect.anything(),
        manager: expect.anything(),
        admin: expect.anything(),
        internal: expect.anything(),
      });
    }
  });

  it("keeps OPEN, DEFERRED and PARTIAL explicitly distinct (acceptance #4)", () => {
    expect(LEAD_CRM_REGISTRY.domain.implementationStatus).toBe("open"); // Domain semantics OPEN
    expect(LEAD_CRM_REGISTRY.msg_history.implementationStatus).toBe("partial"); // Msg history PARTIAL
    expect(LEAD_CRM_REGISTRY.process_issues.implementationStatus).toBe("open"); // Process issues OPEN
    expect(LEAD_CRM_REGISTRY.crm_ai_support.implementationStatus).toBe("deferred"); // CRM AI DEFERRED
    expect(LEAD_CRM_REGISTRY.performance_insights.implementationStatus).toBe("deferred"); // DEFERRED
  });

  it("split status dimensions: status is derived, conclusion is the atomic terminal action", () => {
    expect(LEAD_CRM_REGISTRY.status.implementationStatus).toBe("derived");
    expect(LEAD_CRM_REGISTRY.conclusion.editable).toBe("atomic_action");
  });

  it("performance_insights is Cold Unicorn internal only (acceptance #9)", () => {
    expect(LEAD_CRM_REGISTRY.performance_insights.visibility).toEqual({
      client: false, manager: false, admin: false, internal: true,
    });
  });

  it("registry dump — full A:AS reference", () => {
    const dump = LEAD_CRM_REGISTRY_LIST.map((e) => {
      const modes = e.modes.join("|");
      const vis = `c:${e.visibility.client} m:${e.visibility.manager} a:${e.visibility.admin} i:${e.visibility.internal}`;
      return `${e.spreadsheetColumn.padEnd(2)} ${e.label.padEnd(22)} ${e.stage.padEnd(13)} ${modes.padEnd(20)} ${e.source.padEnd(14)} ${e.implementationStatus.padEnd(11)} ${e.editable.padEnd(28)} health:${e.healthId ?? "—"} ${vis}`;
    }).join("\n");
    // eslint-disable-next-line no-console
    console.log(`\nCold CRM / PDCA — canonical column registry (semantic id ↔ A:AS)\n${dump}\n`);
    expect(LEAD_CRM_REGISTRY_LIST).toHaveLength(45);
  });
});
