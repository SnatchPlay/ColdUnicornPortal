import { describe, expect, it } from "vitest";
import {
  deriveContactDisposition,
  deriveCrmStage,
  resolveCrmStatus,
  type LeadStatusFacts,
} from "../lead-status";

describe("deriveCrmStage (non-terminal funnel position)", () => {
  it("SQL when any meeting/offer progress exists", () => {
    expect(deriveCrmStage({ meeting_booked: true })).toBe("SQL");
    expect(deriveCrmStage({ meeting_held: true })).toBe("SQL");
    expect(deriveCrmStage({ offer_sent: true })).toBe("SQL");
  });
  it("MQL when qualification is MQL and no activity", () => {
    expect(deriveCrmStage({ qualification: "MQL" })).toBe("MQL");
  });
  it("preMQL otherwise (incl. OOO/NRR — a disposition, not a stage)", () => {
    expect(deriveCrmStage({ qualification: "preMQL" })).toBe("preMQL");
    expect(deriveCrmStage({ qualification: "OOO" })).toBe("preMQL");
    expect(deriveCrmStage({ qualification: "NRR" })).toBe("preMQL");
    expect(deriveCrmStage({})).toBe("preMQL");
  });
  it("activity outranks the MQL qualification stamp", () => {
    expect(deriveCrmStage({ qualification: "MQL", meeting_booked: true })).toBe("SQL");
  });
});

describe("deriveContactDisposition (separate dimension)", () => {
  it("maps OOO/NRR from qualification, null otherwise", () => {
    expect(deriveContactDisposition({ qualification: "OOO" })).toBe("OOO");
    expect(deriveContactDisposition({ qualification: "NRR" })).toBe("NRR");
    expect(deriveContactDisposition({ qualification: "MQL" })).toBeNull();
    expect(deriveContactDisposition({})).toBeNull();
  });
});

describe("resolveCrmStatus (display/health single status)", () => {
  it("explicit final_outcome wins over everything", () => {
    expect(resolveCrmStatus({ final_outcome: "lost", won: true, meeting_booked: true })).toBe("lost");
    expect(resolveCrmStatus({ final_outcome: "lost_premql", qualification: "MQL" })).toBe("lost_premql");
  });
  it("bridges the legacy won boolean", () => {
    expect(resolveCrmStatus({ won: true, meeting_held: true })).toBe("won");
  });
  it("bridges the legacy rejected qualification to lost", () => {
    expect(resolveCrmStatus({ qualification: "rejected" })).toBe("lost");
  });
  it("falls through to the derived non-terminal stage", () => {
    expect(resolveCrmStatus({ meeting_booked: true })).toBe("SQL");
    expect(resolveCrmStatus({ qualification: "MQL" })).toBe("MQL");
    expect(resolveCrmStatus({ qualification: "OOO" })).toBe("preMQL"); // OOO preserves the funnel stage
    expect(resolveCrmStatus({})).toBe("preMQL");
  });
  it("NRR is NOT auto-lost — stays at its funnel stage until an explicit outcome", () => {
    expect(resolveCrmStatus({ qualification: "NRR" })).toBe("preMQL");
    expect(resolveCrmStatus({ qualification: "NRR", meeting_booked: true })).toBe("SQL");
  });
});
