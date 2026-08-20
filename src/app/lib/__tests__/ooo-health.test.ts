import { describe, expect, it } from "vitest";
import { isOooLive, isOooRoutable, oooHealthRank, oooHealthWord, oooStatusNote } from "../ooo-health";
import type { OooRoutingHealthRow } from "../../types/view-contracts";

// The shapes are the ones actually present in production on 2026-08-19, not invented cases:
// 5 clients at 2 live of 3, 4 at 1 of 3, 3 at 0 of 3 with auto-OOO on, 4 with no rules at all, and
// zero clients fully live. That last number is why the column renders a fraction and not a dot.
const row = (
  routed: number,
  live: number,
  awaiting = 0,
  hasGeneral = true,
  // Default: every dead rule is archived, i.e. needs a human. Tests that care about the paused half
  // pass 0 explicitly.
  unrecoverable = routed - live - awaiting,
): OooRoutingHealthRow => ({
  client_id: "c1",
  routed,
  live,
  awaiting,
  hasGeneral,
  unrecoverable,
  campaigns_seen_at: "2026-08-19T19:15:19.187Z",
});

describe("routing target predicates", () => {
  it("treats a draft as routable but not as sending", () => {
    // The distinction the whole feature turns on: provisioning fills a rule from a draft, and that
    // client must not then be reported as broken.
    expect(isOooRoutable("draft")).toBe(true);
    expect(isOooLive("draft")).toBe(false);
  });

  it("treats stopped and completed as dead on both counts", () => {
    for (const status of ["stopped", "completed"] as const) {
      expect(isOooRoutable(status)).toBe(false);
      expect(isOooLive(status)).toBe(false);
    }
  });

  it("names only the statuses that need explaining", () => {
    // The two dead statuses must not read alike: one is undone overnight, the other never is.
    expect(oooStatusNote("stopped")).toBe("paused in Bison — the daily job will switch it back on");
    expect(oooStatusNote("completed")).toBe(
      "archived in Bison — automation cannot revive it, re-create the campaign",
    );
    expect(oooStatusNote("draft")).toBe("draft — no sequence written yet");
    // No identity entries to maintain: an unlisted status falls back to itself.
    expect(oooStatusNote("launching")).toBe("launching");
  });
});

describe("oooHealthRank", () => {
  it("ranks a fully live client best", () => {
    expect(oooHealthRank(row(3, 3), true)).toBe(0);
  });

  it("ranks a deliberate opt-out below every real fault", () => {
    // Auto OOO off is a configuration, not a defect. It must never outrank a client whose rules
    // point at campaigns that stopped — a descending sort exists to surface the second group.
    expect(oooHealthRank(row(3, 0), false)).toBeLessThan(oooHealthRank(row(3, 1), true));
    expect(oooHealthRank(null, false)).toBe(1);
  });

  it("ranks never-configured below any configured-and-imperfect state", () => {
    expect(oooHealthRank(null, true)).toBe(2);
    expect(oooHealthRank(row(3, 0, 3), true)).toBeGreaterThan(oooHealthRank(null, true));
  });

  it("refuses a green score to a rule set with no general fallback", () => {
    // One live `male` rule and nothing else reads 1/1 and is NOT healthy: `resolve_ooo_routing`
    // falls back to `general` for every key without its own rule, so female and general contacts
    // park as routing_missing. One live `general` rule, also 1/1, genuinely covers everyone.
    expect(oooHealthRank(row(1, 1, 0, false), true)).toBe(3);
    expect(oooHealthRank(row(1, 1, 0, true), true)).toBe(0);
    expect(oooHealthWord(row(1, 1, 0, false), true)).toBe(
      "No general fallback — contacts whose routing key has no rule of its own are recorded as routing missing",
    );
  });

  it("ranks a freshly provisioned triple of drafts below a dead one", () => {
    // Both read 0/3. One is a normal handover awaiting copy, the other is the disaster; sorting
    // them together is what made a successful onboarding look like a fault.
    expect(oooHealthRank(row(3, 0, 3), true)).toBe(3);
    expect(oooHealthRank(row(3, 0, 0), true)).toBe(5);
    expect(oooHealthRank(row(3, 0, 3), true)).toBeLessThan(oooHealthRank(row(3, 0, 0), true));
  });

  it("ranks a partly dead client between drafts and total failure", () => {
    expect(oooHealthRank(row(3, 2), true)).toBe(4);
    expect(oooHealthRank(row(3, 0), true)).toBe(5);
  });

  it("ranks a merely-paused client below one that needs a human", () => {
    // Same 0/3 on screen. One is handled overnight, the other is not handled at all.
    expect(oooHealthRank(row(3, 0, 0, true, 0), true)).toBe(3);
    expect(oooHealthRank(row(3, 0, 0, true, 3), true)).toBe(5);
  });
});

describe("oooHealthWord", () => {
  it("counts the dead rules, not just that something is wrong", () => {
    expect(oooHealthWord(row(3, 1), true)).toBe(
      "2 of 3 OOO campaigns are archived — automation cannot revive these, re-create them in Bison",
    );
  });

  it("says nobody needs to act when the daily job will fix it", () => {
    // Paused campaigns are switched back on unattended. Reporting them the same way as archived ones
    // is what made a client nobody has to touch look like a client on fire.
    expect(oooHealthWord(row(3, 1, 0, true, 0), true)).toBe(
      "2 of 3 OOO campaigns are paused — the daily job switches them back on",
    );
  });

  it("separates the two halves when a client has both", () => {
    expect(oooHealthWord(row(3, 1, 0, true, 1), true)).toBe(
      "1 of 3 OOO campaigns are archived and need re-creating in Bison; 1 are paused and will be switched back on",
    );
  });

  it("distinguishes never-configured from configured-and-broken", () => {
    expect(oooHealthWord(null, true)).toBe("No OOO routing configured");
    expect(oooHealthWord(row(3, 0), true)).toBe(
      "3 of 3 OOO campaigns are archived — automation cannot revive these, re-create them in Bison",
    );
  });

  it("tells a campaign that has not started to be finished, not re-created", () => {
    // "not sending yet" and not "still drafts": `awaiting` also covers `launching`, and telling
    // someone to start a campaign that is already starting is the wrong remedy.
    expect(oooHealthWord(row(3, 0, 3), true)).toBe(
      "3 of 3 OOO campaigns are not sending yet — write each sequence in Bison and start the campaign",
    );
  });

  it("says auto OOO is off before saying anything about the rules", () => {
    // Such a client routes nothing whatever its rules say, so leading with the rule count would
    // send an operator to fix the wrong thing.
    expect(oooHealthWord(row(3, 0), false)).toBe("Auto OOO is off — routing rules are not applied");
  });

  it("confirms a healthy client", () => {
    expect(oooHealthWord(row(3, 3), true)).toBe("Every OOO rule points at a sending campaign");
  });
});
