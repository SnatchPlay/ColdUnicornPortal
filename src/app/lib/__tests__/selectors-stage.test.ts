import { describe, expect, it } from "vitest";
import { getLeadStage } from "../selectors";

describe("getLeadStage precedence (mirrors SQL CASE in loadLeadsList)", () => {
  it("won wins over all other flags", () => {
    expect(getLeadStage({ won: true, offer_sent: true, meeting_held: true, meeting_booked: true, qualification: "MQL" })).toBe("won");
  });

  it("offer_sent beats meeting_held, meeting_booked, qualification", () => {
    expect(getLeadStage({ won: false, offer_sent: true, meeting_held: true, meeting_booked: true, qualification: "MQL" })).toBe("offer_sent");
  });

  it("meeting_held beats meeting_booked and qualification", () => {
    expect(getLeadStage({ won: false, offer_sent: false, meeting_held: true, meeting_booked: true, qualification: "MQL" })).toBe("meeting_held");
  });

  it("meeting_booked beats qualification", () => {
    expect(getLeadStage({ won: false, offer_sent: false, meeting_held: false, meeting_booked: true, qualification: "MQL" })).toBe("meeting_scheduled");
  });

  it("returns qualification when no boolean flags are set", () => {
    expect(getLeadStage({ won: false, offer_sent: false, meeting_held: false, meeting_booked: false, qualification: "MQL" })).toBe("MQL");
    expect(getLeadStage({ won: false, offer_sent: false, meeting_held: false, meeting_booked: false, qualification: "rejected" })).toBe("rejected");
  });

  it("returns unqualified when qualification is null and no flags", () => {
    expect(getLeadStage({ won: false, offer_sent: false, meeting_held: false, meeting_booked: false, qualification: null })).toBe("unqualified");
    expect(getLeadStage({})).toBe("unqualified");
  });

  it("null/undefined flags are treated as false", () => {
    expect(getLeadStage({ won: null, offer_sent: null, meeting_held: null, meeting_booked: null, qualification: "MQL" })).toBe("MQL");
  });
});
