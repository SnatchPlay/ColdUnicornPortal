import { describe, expect, it } from "vitest";
import { evaluateClientConditions } from "../client-condition-results";
import type { ClientConditionContext } from "../client-condition-context";
import type { ConditionRule } from "../types";
import type { ClientMetricsPack, DodRow } from "../../client-metrics";
import type { ClientRecord } from "../../../types/core";

// Mirrors supabase/migrations/20260819_aimfox_dod_colour_rules.sql. Two things are under test:
// the LinkedIn bands get their own absolute floors (they do NOT read `min_sent` like the Bison
// bands do), and the connector gate holds — because the gateway reports 0, not null, for a client
// with no Aimfox, an ungated rule would paint every email-only client red.

const CLIENT = { id: "c1", manager_id: null } as ClientRecord;

const LINKEDIN_CONNECTED = { left: { metric: "linkedin_connected" }, op: "eq", right: { value: true } } as const;

function rule(overrides: Partial<ConditionRule>): ConditionRule {
  return {
    id: "r",
    key: "k",
    name: "n",
    description: null,
    targetEntity: "client",
    surface: "clients_dod",
    metricKey: "value",
    sourceSheet: null,
    sourceRange: null,
    scopeType: "global",
    clientId: null,
    managerId: null,
    applyTo: "cell",
    columnKey: "dynamic_dod_bucket",
    branches: [],
    baseFilter: null,
    priority: 20,
    enabled: true,
    notes: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const RULES: ConditionRule[] = [
  // The Bison band, kept in the set so the tests also prove the two families do not bleed into
  // each other: this one would call 20 invites a disaster, the LinkedIn one calls it healthy.
  rule({
    id: "eb",
    key: "dod_sent_or_schedule_vs_min_sent",
    surface: "clients_dod",
    branches: [
      {
        severity: "good",
        when: { left: { metric: "value" }, op: "gte", right: { metric: "min_sent" } },
        label: "on target",
        message: "",
      },
      {
        severity: "danger",
        when: { left: { metric: "value" }, op: "lt", right: { metric: "min_sent" } },
        label: "below floor",
        message: "",
      },
    ],
  }),
  rule({
    id: "af-sched",
    key: "dod_aimfox_schedule_floor",
    surface: "clients_dod_aimfox_schedule",
    priority: 21,
    baseFilter: LINKEDIN_CONNECTED,
    branches: [
      {
        severity: "good",
        when: { left: { metric: "value" }, op: "gte", right: { value: 30 } },
        label: "healthy",
        message: "",
      },
      {
        severity: "danger",
        when: { left: { metric: "value" }, op: "lt", right: { value: 30 } },
        label: "too low",
        message: "",
      },
    ],
  }),
  rule({
    id: "af-sent",
    key: "dod_aimfox_sent_floor",
    surface: "clients_dod_aimfox_sent",
    priority: 22,
    baseFilter: LINKEDIN_CONNECTED,
    branches: [
      {
        severity: "good",
        when: { left: { metric: "value" }, op: "gte", right: { value: 20 } },
        label: "on target",
        message: "",
      },
      {
        severity: "warning",
        when: {
          all: [
            { left: { metric: "value" }, op: "gte", right: { value: 10 } },
            { left: { metric: "value" }, op: "lt", right: { value: 20 } },
          ],
        },
        label: "below target",
        message: "",
      },
      {
        severity: "danger",
        when: { left: { metric: "value" }, op: "lt", right: { value: 10 } },
        label: "critical",
        message: "",
      },
    ],
  }),
];

function context(linkedinConnected: boolean): ClientConditionContext {
  return {
    target_id: "c1",
    min_sent: 500,
    linkedin_connected: linkedinConnected,
    custom: {},
  } as unknown as ClientConditionContext;
}

function metrics(dodRows: DodRow[]): ClientMetricsPack {
  return {
    overview: {} as ClientMetricsPack["overview"],
    dodRows,
    threeDodRows: [],
    wowRows: [],
    momRows: [],
  };
}

function severityAt(pack: ReturnType<typeof evaluateClientConditions>, cellKey: string) {
  return pack.allResults.find((r) => r.columnKey === cellKey)?.severity ?? null;
}

describe("LinkedIn (Aimfox) DoD cell rules", () => {
  it("grades the Schedule band at an absolute floor of 30, per bucket", () => {
    const pack = evaluateClientConditions(
      context(true),
      RULES,
      metrics([
        { bucket: "+2", schedule: null, sent: null, aimfoxSchedule: 30, aimfoxSent: null },
        { bucket: "+1", schedule: null, sent: null, aimfoxSchedule: 29, aimfoxSent: null },
        { bucket: "0", schedule: null, sent: null, aimfoxSchedule: 0, aimfoxSent: null },
      ]),
      CLIENT,
    );

    expect(severityAt(pack, "dod:+2:aimfox_schedule")).toBe("good");
    expect(severityAt(pack, "dod:+1:aimfox_schedule")).toBe("danger");
    expect(severityAt(pack, "dod:0:aimfox_schedule")).toBe("danger");
  });

  it("grades the Daily sent band 20 / 10, per bucket", () => {
    const pack = evaluateClientConditions(
      context(true),
      RULES,
      metrics(
        [20, 19, 10, 9, 0].map((aimfoxSent, i) => ({
          bucket: i === 0 ? "0" : `-${i}`,
          schedule: null,
          sent: null,
          aimfoxSchedule: null,
          aimfoxSent,
        })),
      ),
      CLIENT,
    );

    expect(severityAt(pack, "dod:0:aimfox_sent")).toBe("good");
    expect(severityAt(pack, "dod:-1:aimfox_sent")).toBe("warning");
    expect(severityAt(pack, "dod:-2:aimfox_sent")).toBe("warning");
    expect(severityAt(pack, "dod:-3:aimfox_sent")).toBe("danger");
    expect(severityAt(pack, "dod:-4:aimfox_sent")).toBe("danger");
  });

  it("leaves every LinkedIn cell uncoloured when the client has no LinkedIn connector", () => {
    // The failure this guards: the metrics summary runs the Aimfox counters through `toInt`, so an
    // email-only client arrives here as a genuine 0 — indistinguishable from "sent nothing today"
    // without the base filter.
    const pack = evaluateClientConditions(
      context(false),
      RULES,
      metrics([{ bucket: "0", schedule: null, sent: null, aimfoxSchedule: 0, aimfoxSent: 0 }]),
      CLIENT,
    );

    expect(severityAt(pack, "dod:0:aimfox_schedule")).toBeNull();
    expect(severityAt(pack, "dod:0:aimfox_sent")).toBeNull();
  });

  it("keeps the Bison and LinkedIn bands on separate thresholds for the same bucket", () => {
    const pack = evaluateClientConditions(
      context(true),
      RULES,
      metrics([{ bucket: "0", schedule: 20, sent: 20, aimfoxSchedule: 30, aimfoxSent: 20 }]),
      CLIENT,
    );

    // min_sent is 500, so 20 is a disaster on the email bands...
    expect(severityAt(pack, "dod:0:schedule")).toBe("danger");
    expect(severityAt(pack, "dod:0:sent")).toBe("danger");
    // ...and fine on the LinkedIn ones.
    expect(severityAt(pack, "dod:0:aimfox_schedule")).toBe("good");
    expect(severityAt(pack, "dod:0:aimfox_sent")).toBe("good");
  });

  it("skips buckets the band does not cover and clients with no Aimfox numbers at all", () => {
    // `aimfoxSchedule` / `aimfoxSent` are optional on DodRow — the raw createClientMetrics() path
    // has no sequencer dimension and leaves them undefined, which must not read as 0.
    const pack = evaluateClientConditions(
      context(true),
      RULES,
      metrics([{ bucket: "0", schedule: 600, sent: 600 }]),
      CLIENT,
    );

    expect(severityAt(pack, "dod:0:aimfox_schedule")).toBeNull();
    expect(severityAt(pack, "dod:0:aimfox_sent")).toBeNull();
    expect(severityAt(pack, "dod:0:schedule")).toBe("good");
  });
});
