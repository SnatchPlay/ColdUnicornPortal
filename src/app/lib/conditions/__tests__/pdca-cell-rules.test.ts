import { describe, expect, it } from "vitest";
import { evaluateClientConditions } from "../client-condition-results";
import type { ClientConditionContext } from "../client-condition-context";
import type { ConditionRule } from "../types";
import type { ClientMetricsPack } from "../../client-metrics";
import type { ClientRecord } from "../../../types/core";

// Mirrors the rules seeded by supabase/migrations/20260714_pdca_cell_colour_rules.sql.
// The point of these tests is the *per-bucket* evaluation path: each cell must be
// judged on its own day/week/month, not on the row-level rolling aggregate.

const SETUP_FIELD = "field-setup";

function rule(overrides: Partial<ConditionRule>): ConditionRule {
  return {
    id: "r",
    key: "k",
    name: "n",
    description: null,
    targetEntity: "client",
    surface: "clients_3dod",
    metricKey: "value",
    sourceSheet: null,
    sourceRange: null,
    scopeType: "global",
    clientId: null,
    managerId: null,
    applyTo: "cell",
    columnKey: null,
    branches: [],
    baseFilter: null,
    priority: 10,
    enabled: true,
    notes: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * value >= KPI / divisor → good · >= 80% of that → warning · below → danger.
 *
 * The KPI is kept on the right untouched and the (integer) cell value is scaled instead:
 * `value * 20 >= kpi` is exact, while `value >= kpi * 0.04` drifts in IEEE-754 and would
 * flip a client sitting exactly on the 80% boundary from yellow to red.
 */
function kpiRule(
  key: string,
  surface: string,
  metricKey: string,
  divisor: number,
  kpiMetric = "monthly_sql_kpi",
): ConditionRule {
  const kpi = { metric: kpiMetric };
  const scaled = (factor: number) =>
    factor === 1 ? { metric: "value" } : { metric: "value", multiplier: factor };
  const onTarget = scaled(divisor);
  const atWarningFloor = scaled(divisor * 1.25); // 80% of the target

  return rule({
    key,
    surface,
    metricKey,
    branches: [
      { severity: "good", when: { left: onTarget, op: "gte", right: kpi }, label: "on target", message: "" },
      {
        severity: "warning",
        when: {
          all: [
            { left: atWarningFloor, op: "gte", right: kpi },
            { left: onTarget, op: "lt", right: kpi },
          ],
        },
        label: "slightly below",
        message: "",
      },
      {
        severity: "danger",
        when: { left: atWarningFloor, op: "lt", right: kpi },
        label: "below",
        message: "",
      },
    ],
  });
}

const RULES: ConditionRule[] = [
  kpiRule("three_dod_sql_vs_monthly_lead_kpi_daily_target", "clients_3dod", "three_dod_sql", 20), // KPI / 20 days
  kpiRule("wow_sql_vs_monthly_lead_kpi_weekly_target", "clients_wow", "wow_sql", 4), // KPI / 4 weeks
  kpiRule("mom_sql_vs_monthly_lead_kpi", "clients_mom", "mom_sql", 1), // KPI
  kpiRule("mom_meetings_vs_meeting_kpi", "clients_mom", "mom_meetings", 1, "monthly_meeting_kpi"),
  rule({
    key: "three_dod_total_too_high_vs_sql",
    surface: "clients_3dod",
    metricKey: "three_dod_total",
    baseFilter: { left: { metric: "value" }, op: "gt", right: { value: 0 } },
    branches: [
      {
        severity: "warning",
        when: {
          left: { metric: "value", multiplier: 100 },
          op: "gte",
          right: { metric: "cell.sql_leads", multiplier: 251 },
        },
        label: "total too high vs sql",
        message: "",
      },
    ],
  }),
  rule({
    key: "setup_type_colour",
    surface: "clients_overview",
    metricKey: `custom.${SETUP_FIELD}`,
    columnKey: `cf:${SETUP_FIELD}`,
    branches: [
      {
        severity: "good",
        when: { left: { metric: `custom.${SETUP_FIELD}` }, op: "in", right: { value: ["BiS1", "BiS2"] } },
        label: "bis",
        message: "",
      },
      {
        severity: "danger",
        when: { left: { metric: `custom.${SETUP_FIELD}` }, op: "eq", right: { value: "One" } },
        label: "one",
        message: "",
      },
    ],
  }),
];

const CLIENT = { id: "c1", manager_id: null } as ClientRecord;

function context(kpiLeads: number | null, setupValue: string | null): ClientConditionContext {
  return {
    target_id: "c1",
    monthly_sql_kpi: kpiLeads,
    monthly_meeting_kpi: kpiLeads,
    // Row-level rolling aggregates. Deliberately set to values that would produce the
    // *wrong* colours if a rule read them instead of the bucket's own `value`.
    three_dod_sql: 999,
    three_dod_total: 999,
    wow_sql: 999,
    mom_sql: 999,
    mom_meetings: 999,
    custom: { [SETUP_FIELD]: setupValue },
  } as unknown as ClientConditionContext;
}

function metrics(overrides: Partial<ClientMetricsPack> = {}): ClientMetricsPack {
  const buckets = ["0", "-1", "-2", "-3", "-4"];
  return {
    overview: {} as ClientMetricsPack["overview"],
    dodRows: [],
    threeDodRows: buckets.map((bucket) => ({ bucket, totalLeads: 0, sqlLeads: 0 })),
    wowRows: buckets.map((bucket) => ({
      bucket,
      totalLeads: 0,
      sqlLeads: 0,
      responseRate: null,
      humanRate: null,
      bounceRate: null,
      oooRate: null,
      negativeRate: null,
    })),
    momRows: buckets.map((bucket) => ({ bucket, totalLeads: 0, sqlLeads: 0, meetings: 0, won: 0 })),
    ...overrides,
  };
}

function severityAt(pack: ReturnType<typeof evaluateClientConditions>, cellKey: string) {
  return pack.allResults.find((r) => r.columnKey === cellKey)?.severity ?? null;
}

describe("PDCA grid cell-colour rules", () => {
  it("colours each 3-DoD SQL day against KPI / 20, independently per bucket", () => {
    // KPI 100 → daily target 5, warning floor 4.
    const pack = evaluateClientConditions(
      context(100, null),
      RULES,
      metrics({
        threeDodRows: [
          { bucket: "0", totalLeads: 5, sqlLeads: 5 }, // == target → good
          { bucket: "-1", totalLeads: 4, sqlLeads: 4 }, // 80% → warning
          { bucket: "-2", totalLeads: 3, sqlLeads: 3 }, // < 80% → danger
          { bucket: "-3", totalLeads: 9, sqlLeads: 9 }, // above target → good
          { bucket: "-4", totalLeads: 0, sqlLeads: 0 }, // nothing → danger
        ],
      }),
      CLIENT,
    );

    expect(severityAt(pack, "td3:0:three_dod_sql")).toBe("good");
    expect(severityAt(pack, "td3:-1:three_dod_sql")).toBe("warning");
    expect(severityAt(pack, "td3:-2:three_dod_sql")).toBe("danger");
    expect(severityAt(pack, "td3:-3:three_dod_sql")).toBe("good");
    expect(severityAt(pack, "td3:-4:three_dod_sql")).toBe("danger");
  });

  it("flags a 3-DoD TOTAL cell only when it is >= 2.51x the SQL of the same day", () => {
    const pack = evaluateClientConditions(
      context(100, null),
      RULES,
      metrics({
        threeDodRows: [
          { bucket: "0", totalLeads: 26, sqlLeads: 10 }, // 2.6x → warning
          { bucket: "-1", totalLeads: 25, sqlLeads: 10 }, // 2.5x → no colour
          { bucket: "-2", totalLeads: 4, sqlLeads: 0 }, // SQL 0, total > 0 → warning
          { bucket: "-3", totalLeads: 0, sqlLeads: 0 }, // empty day → no colour (base filter)
          { bucket: "-4", totalLeads: 10, sqlLeads: 10 }, // 1x → no colour
        ],
      }),
      CLIENT,
    );

    expect(severityAt(pack, "td3:0:three_dod_total")).toBe("warning");
    expect(severityAt(pack, "td3:-1:three_dod_total")).toBeNull();
    expect(severityAt(pack, "td3:-2:three_dod_total")).toBe("warning");
    expect(severityAt(pack, "td3:-3:three_dod_total")).toBeNull();
    expect(severityAt(pack, "td3:-4:three_dod_total")).toBeNull();
  });

  it("colours WoW SQL against KPI / 4 and MoM SQL against the KPI itself", () => {
    const wow = metrics().wowRows.map((row, i) => ({ ...row, sqlLeads: [25, 20, 19, 0, 30][i] }));
    const mom = metrics().momRows.map((row, i) => ({ ...row, sqlLeads: [100, 80, 79, 0, 120][i] }));

    const pack = evaluateClientConditions(context(100, null), RULES, metrics({ wowRows: wow, momRows: mom }), CLIENT);

    // KPI 100 → weekly target 25, warning floor 20.
    expect(severityAt(pack, "wow:0:wow_sql")).toBe("good");
    expect(severityAt(pack, "wow:-1:wow_sql")).toBe("warning");
    expect(severityAt(pack, "wow:-2:wow_sql")).toBe("danger");
    expect(severityAt(pack, "wow:-3:wow_sql")).toBe("danger");
    expect(severityAt(pack, "wow:-4:wow_sql")).toBe("good");

    // KPI 100 → monthly target 100, warning floor 80.
    expect(severityAt(pack, "mom:0:mom_sql")).toBe("good");
    expect(severityAt(pack, "mom:-1:mom_sql")).toBe("warning");
    expect(severityAt(pack, "mom:-2:mom_sql")).toBe("danger");
    expect(severityAt(pack, "mom:-3:mom_sql")).toBe("danger");
    expect(severityAt(pack, "mom:-4:mom_sql")).toBe("good");
  });

  it("grades each MoM Meetings cell on its own month, not on the current one", () => {
    // Regression guard: the rule used to read the row-level `mom_meetings` key (= the
    // current month), so a month with 0 meetings rendered green next to a literal "0".
    const momRows = metrics().momRows.map((row, i) => ({ ...row, meetings: [12, 10, 8, 7, 0][i] }));
    const pack = evaluateClientConditions(context(10, null), RULES, metrics({ momRows }), CLIENT);

    // KPI meetings 10 → target 10, warning floor 8.
    expect(severityAt(pack, "mom:0:mom_meetings")).toBe("good");
    expect(severityAt(pack, "mom:-1:mom_meetings")).toBe("good");
    expect(severityAt(pack, "mom:-2:mom_meetings")).toBe("warning");
    expect(severityAt(pack, "mom:-3:mom_meetings")).toBe("danger");
    expect(severityAt(pack, "mom:-4:mom_meetings")).toBe("danger");
  });

  it("leaves KPI-driven cells uncoloured when the client has no KPI LEADS / MONTH", () => {
    const pack = evaluateClientConditions(
      context(null, null),
      RULES,
      metrics({
        threeDodRows: [{ bucket: "0", totalLeads: 0, sqlLeads: 0 }],
        wowRows: [{ ...metrics().wowRows[0], sqlLeads: 0 }],
        momRows: [{ ...metrics().momRows[0], sqlLeads: 0 }],
      }),
      CLIENT,
    );

    expect(severityAt(pack, "td3:0:three_dod_sql")).toBeNull();
    expect(severityAt(pack, "wow:0:wow_sql")).toBeNull();
    expect(severityAt(pack, "mom:0:mom_sql")).toBeNull();
  });

  it("colours the Setup droplist: One = danger, BiS1 / BiS2 = good", () => {
    const severityFor = (value: string | null) =>
      severityAt(evaluateClientConditions(context(100, value), RULES, metrics(), CLIENT), `cf:${SETUP_FIELD}`);

    expect(severityFor("One")).toBe("danger");
    expect(severityFor("BiS1")).toBe("good");
    expect(severityFor("BiS2")).toBe("good");
    expect(severityFor(null)).toBeNull();
  });
});
