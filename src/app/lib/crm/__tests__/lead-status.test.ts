import { describe, expect, it } from "vitest";
import {
  deriveCrmStage,
  resolveCrmStatus,
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
  it("preMQL otherwise", () => {
    expect(deriveCrmStage({ qualification: "preMQL" })).toBe("preMQL");
    expect(deriveCrmStage({})).toBe("preMQL");
  });
  it("activity outranks the MQL qualification stamp", () => {
    expect(deriveCrmStage({ qualification: "MQL", meeting_booked: true })).toBe("SQL");
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
    expect(resolveCrmStatus({})).toBe("preMQL");
  });
});
