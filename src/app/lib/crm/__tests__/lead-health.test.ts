import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_DAY_CONFIG } from "../business-days";
import {
  evaluateCellHealth,
  evaluateLeadHealth,
  processIssuesCount,
  processIssuesHealth,
  type CellHealth,
  type HealthContext,
  type LeadCrmFacts,
} from "../lead-health";

// Reference calendar (Europe/Warsaw): Mon 2026-07-13 · Tue 07-14 · Wed 07-15.
// Lead received Mon 2026-07-13 09:00 local (07:00Z), before the 16:00 cutoff → contact day 0 = 07-13.
const RECEIVED = "2026-07-13T07:00:00Z";
const ctx = (asOf: string): HealthContext => ({ asOf, businessDays: DEFAULT_BUSINESS_DAY_CONFIG });
const cell = (colId: string, facts: LeadCrmFacts, asOf: string): CellHealth =>
  evaluateCellHealth(colId, facts, ctx(asOf));

describe("presence columns (green / neutral)", () => {
  it("A Company green when set, neutral when missing", () => {
    expect(cell("company", { company_name: "Acme" }, RECEIVED).state).toBe("green");
    expect(cell("company", { company_name: "" }, RECEIVED).state).toBe("neutral");
  });
  it("K Msg history green only when replyCount > 0 (matches LeadCrmRow field name)", () => {
    expect(cell("msg_history", { replyCount: 3 }, RECEIVED).state).toBe("green");
    expect(cell("msg_history", { replyCount: 0 }, RECEIVED).state).toBe("neutral");
  });
  it("unregistered columns (H/J/M) are neutral", () => {
    expect(cell("status", {}, RECEIVED).state).toBe("neutral");
  });
});

describe("I LinkedIn invitation (integration prerequisite)", () => {
  it("green when sent", () => {
    expect(cell("linkedin_invitation", { linkedin_invitation_sent_at: RECEIVED }, RECEIVED).state).toBe("green");
  });
  it("yellow only when integration connected but not sent", () => {
    expect(cell("linkedin_invitation", { linkedin_integration_connected: true }, RECEIVED).state).toBe("yellow");
  });
  it("not_applicable (not falsely yellow) when integration is disconnected", () => {
    expect(cell("linkedin_invitation", {}, RECEIVED).state).toBe("not_applicable");
  });
});

describe("P Contact made — phone/email business-day matrix", () => {
  const asOf = "2026-07-16T12:00:00Z"; // after all deadlines so timing drives colour
  const withPhone = (contactAt: string, method: string): LeadCrmFacts => ({
    created_at: RECEIVED,
    phone_number: "+380...",
    contact_made_at: contactAt,
    contact_method: method,
    status: "MQL",
  });

  it("phone on day 0 → green", () => {
    expect(cell("contact_made", withPhone("2026-07-13T10:00:00Z", "phone"), asOf).state).toBe("green");
  });
  it("email on day 0 (phone exists) → yellow", () => {
    expect(cell("contact_made", withPhone("2026-07-13T10:00:00Z", "email"), asOf).state).toBe("yellow");
  });
  it("phone on day +1 → yellow", () => {
    expect(cell("contact_made", withPhone("2026-07-14T10:00:00Z", "phone"), asOf).state).toBe("yellow");
  });
  it("email on day +1 (phone exists) → orange", () => {
    expect(cell("contact_made", withPhone("2026-07-14T10:00:00Z", "email"), asOf).state).toBe("orange");
  });
  it("anything later than day +1 → red", () => {
    expect(cell("contact_made", withPhone("2026-07-15T10:00:00Z", "phone"), asOf).state).toBe("red");
  });

  it("no phone: email day 0 green, day +1 yellow, later red", () => {
    const noPhone = (contactAt: string): LeadCrmFacts => ({
      created_at: RECEIVED,
      contact_made_at: contactAt,
      contact_method: "email",
      status: "MQL",
    });
    expect(cell("contact_made", noPhone("2026-07-13T10:00:00Z"), asOf).state).toBe("green");
    expect(cell("contact_made", noPhone("2026-07-14T10:00:00Z"), asOf).state).toBe("yellow");
    expect(cell("contact_made", noPhone("2026-07-15T10:00:00Z"), asOf).state).toBe("red");
  });

  it("not contacted yet → pending on day 0, yellow in the day+1 window, red past day +1", () => {
    const facts: LeadCrmFacts = { created_at: RECEIVED, phone_number: "+380", status: "MQL" };
    expect(cell("contact_made", facts, "2026-07-13T06:00:00Z").state).toBe("pending"); // still within day 0
    expect(cell("contact_made", facts, "2026-07-14T12:00:00Z").state).toBe("yellow"); // past day 0, in the day+1 window
    expect(cell("contact_made", facts, "2026-07-15T00:00:00Z").state).toBe("red"); // past day +1
  });

  it("Q Days to contact mirrors P's state but explains itself as a day count", () => {
    const facts = withPhone("2026-07-14T10:00:00Z", "email");
    expect(cell("days_to_contact", facts, asOf).state).toBe(cell("contact_made", facts, asOf).state);
    expect(cell("days_to_contact", facts, asOf).reason).toMatch(/working day\(s\) to contact/);
  });
});

describe("prerequisite suppression", () => {
  it("R Meeting set is not_applicable below MQL", () => {
    expect(cell("meeting_set", { status: "preMQL", created_at: RECEIVED }, "2026-07-16T12:00:00Z").state).toBe("not_applicable");
  });
  it("intro transcript/score/insights are not_applicable with no intro meeting", () => {
    const facts: LeadCrmFacts = { status: "MQL", created_at: RECEIVED };
    const late = "2026-07-20T12:00:00Z";
    expect(cell("intro_transcript", facts, late).state).toBe("not_applicable");
    expect(cell("intro_score", facts, late).state).toBe("not_applicable");
    expect(cell("intro_conversion", facts, late).state).toBe("not_applicable");
  });
});

describe("R Meeting set SLA (MQL, 1 working day, yellow only)", () => {
  const base: LeadCrmFacts = { status: "MQL", created_at: RECEIVED };
  it("green when a meeting is scheduled", () => {
    expect(cell("meeting_set", { ...base, intro_meeting: { status: "scheduled", scheduled_at: "2026-07-14T09:00:00Z" } }, "2026-07-13T12:00:00Z").state).toBe("green");
  });
  it("pending before the 1-working-day deadline", () => {
    expect(cell("meeting_set", base, "2026-07-13T12:00:00Z").state).toBe("pending");
  });
  it("yellow after the 1-working-day deadline", () => {
    expect(cell("meeting_set", base, "2026-07-16T12:00:00Z").state).toBe("yellow");
  });
});

describe("T Intro transcription (2h SLA)", () => {
  const held = "2026-07-14T09:00:00Z";
  const base: LeadCrmFacts = { status: "MQL", intro_meeting: { status: "held", held_at: held } };
  it("green when transcription url is set", () => {
    expect(cell("intro_transcript", { ...base, intro_meeting: { ...base.intro_meeting, transcription_url: "http://f" } }, "2026-07-14T20:00:00Z").state).toBe("green");
  });
  it("pending within 2h, red after 2h", () => {
    expect(cell("intro_transcript", base, "2026-07-14T10:00:00Z").state).toBe("pending");
    expect(cell("intro_transcript", base, "2026-07-14T12:00:00Z").state).toBe("red");
  });
});

describe("U Intro process score thresholds (RECOMMENDED 30/50/70)", () => {
  const meeting = { status: "held", held_at: "2026-07-14T09:00:00Z" };
  const at = "2026-07-14T20:00:00Z";
  it("bands", () => {
    expect(cell("intro_score", { intro_meeting: { ...meeting, process_score: 80 } }, at).state).toBe("green");
    expect(cell("intro_score", { intro_meeting: { ...meeting, process_score: 60 } }, at).state).toBe("yellow");
    expect(cell("intro_score", { intro_meeting: { ...meeting, process_score: 40 } }, at).state).toBe("orange");
    expect(cell("intro_score", { intro_meeting: { ...meeting, process_score: 20 } }, at).state).toBe("red");
  });
  it("missing score: pending then red 1 day after meeting", () => {
    expect(cell("intro_score", { intro_meeting: meeting }, "2026-07-14T20:00:00Z").state).toBe("pending");
    expect(cell("intro_score", { intro_meeting: meeting }, "2026-07-16T12:00:00Z").state).toBe("red");
  });
});

describe("terminal LOST suppresses future SLA", () => {
  it("W offer date is not_applicable when lost", () => {
    const facts: LeadCrmFacts = {
      status: "lost",
      intro_meeting: { status: "held", held_at: "2026-07-14T09:00:00Z" },
    };
    expect(cell("offer_date", facts, "2026-07-30T12:00:00Z").state).toBe("not_applicable");
  });
});

describe("AI Days in negotiation (RECOMMENDED 30/60/90 bands)", () => {
  it("green ≤30, yellow 31-60", () => {
    expect(cell("negotiation_days", { negotiation_started_at: "2026-07-01T10:00:00Z" }, "2026-07-13T10:00:00Z").state).toBe("green"); // 12d
    expect(cell("negotiation_days", { negotiation_started_at: "2026-06-01T10:00:00Z" }, "2026-07-13T10:00:00Z").state).toBe("yellow"); // 42d
  });
  it("not_applicable before negotiation starts", () => {
    expect(cell("negotiation_days", {}, "2026-07-13T10:00:00Z").state).toBe("not_applicable");
  });
});

describe("AO process-issue count", () => {
  it("counts only canonical counted steps in orange/red; excludes quality bands (U/AI) and the Q duplicate", () => {
    const health = {
      contact_made: { state: "red", reason: "", deadlineAt: null }, // counted
      offer_date: { state: "orange", reason: "", deadlineAt: null }, // counted
      days_to_contact: { state: "red", reason: "", deadlineAt: null }, // duplicate of P — excluded
      intro_score: { state: "orange", reason: "", deadlineAt: null }, // quality band — excluded
      negotiation_days: { state: "red", reason: "", deadlineAt: null }, // duration band — excluded
      meeting_set: { state: "yellow", reason: "", deadlineAt: null }, // yellow — excluded
      intro_transcript: { state: "not_applicable", reason: "", deadlineAt: null },
      company: { state: "green", reason: "", deadlineAt: null },
    } as const;
    expect(processIssuesCount(health as never)).toBe(2); // P + W only
  });

  it("processIssuesHealth maps 0→green, 1→yellow, 3→orange, 5→red", () => {
    expect(processIssuesHealth(0).state).toBe("green");
    expect(processIssuesHealth(1).state).toBe("yellow");
    expect(processIssuesHealth(3).state).toBe("orange");
    expect(processIssuesHealth(5).state).toBe("red");
  });

  it("root failure counts once: no intro meeting suppresses the whole downstream chain", () => {
    // MQL lead, contacted on time, but intro never set → R yellow (not counted), T/U/V/W/X na.
    const facts: LeadCrmFacts = {
      status: "MQL",
      created_at: RECEIVED,
      phone_number: "+380",
      contact_made_at: "2026-07-13T10:00:00Z",
      contact_method: "phone",
    };
    const health = evaluateLeadHealth(facts, ctx("2026-07-20T12:00:00Z"));
    expect(health.intro_transcript.state).toBe("not_applicable");
    expect(health.offer_date.state).toBe("not_applicable");
    expect(processIssuesCount(health)).toBe(0);
    expect(health.process_issues.state).toBe("green");
  });
});

describe("terminal outcome suppresses forward SLA (won included)", () => {
  const at = "2026-07-30T12:00:00Z";
  it("won lead → W (offer date) not_applicable", () => {
    const facts: LeadCrmFacts = { status: "won", intro_meeting: { status: "held", held_at: "2026-07-14T09:00:00Z" } };
    expect(cell("offer_date", facts, at).state).toBe("not_applicable");
  });
  it("won lead → AI (days in negotiation) not_applicable", () => {
    expect(cell("negotiation_days", { status: "won", negotiation_started_at: "2026-01-01T00:00:00Z" }, at).state).toBe("not_applicable");
  });
});

describe("AN keys on final_outcome, not concluded_at alone", () => {
  it("green when a terminal outcome is recorded", () => {
    expect(cell("conclusion", { final_outcome: "won" }, RECEIVED).state).toBe("green");
  });
  it("neutral when only concluded_at is set (no outcome)", () => {
    expect(cell("conclusion", { concluded_at: RECEIVED }, RECEIVED).state).toBe("neutral");
  });
});

describe("code-review fixes", () => {
  const late = "2026-07-20T12:00:00Z";

  it("a cancelled intro meeting is not active: R is not green and T is not_applicable", () => {
    const facts: LeadCrmFacts = {
      status: "MQL",
      created_at: RECEIVED,
      intro_meeting: { status: "cancelled", scheduled_at: "2026-07-14T09:00:00Z" },
    };
    expect(cell("meeting_set", facts, late).state).not.toBe("green");
    expect(cell("intro_transcript", facts, late).state).toBe("not_applicable");
  });

  it("a populated process score is graded even while the meeting row is still 'planned'", () => {
    expect(cell("intro_score", { intro_meeting: { status: "planned", process_score: 85 } }, RECEIVED).state).toBe("green");
  });

  it("AI is suppressed when the lead is lost", () => {
    expect(cell("negotiation_days", { status: "lost", negotiation_started_at: "2026-01-01T00:00:00Z" }, "2026-07-13T00:00:00Z").state).toBe("not_applicable");
  });

  it("a single late contact counts once in AO (P counted, Q duplicate excluded)", () => {
    const facts: LeadCrmFacts = {
      status: "MQL",
      created_at: RECEIVED,
      phone_number: "+380",
      contact_made_at: "2026-07-16T10:00:00Z", // 3 working days late → red
      contact_method: "phone",
    };
    const health = evaluateLeadHealth(facts, ctx(late));
    expect(health.contact_made.state).toBe("red");
    expect(health.days_to_contact.state).toBe("red");
    expect(processIssuesCount(health)).toBe(1); // not 2
    expect(health.process_issues.state).toBe("yellow");
  });
});

describe("evaluateLeadHealth", () => {
  it("returns a state for every column plus the derived AO", () => {
    const health = evaluateLeadHealth({ company_name: "Acme", created_at: RECEIVED }, ctx(RECEIVED));
    expect(health.company.state).toBe("green");
    expect(health.process_issues).toBeDefined();
    expect(Object.keys(health)).toContain("process_issues");
  });
});
