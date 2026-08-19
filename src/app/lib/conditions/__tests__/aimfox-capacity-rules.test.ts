import { describe, expect, it } from "vitest";
import { evaluateClientConditions } from "../client-condition-results";
import type { ClientConditionContext } from "../client-condition-context";
import type { ConditionRule } from "../types";
import type { ClientMetricsPack } from "../../client-metrics";
import type { ClientRecord } from "../../../types/core";

// Mirrors supabase/migrations/20260819c_aimfox_capacity_colour_rules.sql.
//
// Two things are under test. The boundaries, because the ranges are written out in full and an
// off-by-one there is invisible in a screenshot. And the null case, because these rules carry NO
// base_filter on purpose: a client with no active LinkedIn campaign has a null metric, and the
// evaluator's numeric operators must decline to colour it rather than treat null as zero.

const CLIENT = { id: "c1", manager_id: null } as ClientRecord;

function rule(overrides: Partial<ConditionRule>): ConditionRule {
  return {
    id: "r",
    key: "k",
    name: "n",
    description: null,
    targetEntity: "client",
    surface: "clients_overview",
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
    priority: 46,
    enabled: true,
    notes: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const band = (metric: string, good: number, warn: number) => [
  {
    severity: "good" as const,
    when: { left: { metric }, op: "gte" as const, right: { value: good } },
    label: "good",
    message: "",
  },
  {
    severity: "warning" as const,
    when: {
      all: [
        { left: { metric }, op: "gte" as const, right: { value: warn } },
        { left: { metric }, op: "lt" as const, right: { value: good } },
      ],
    },
    label: "warn",
    message: "",
  },
  {
    severity: "danger" as const,
    when: { left: { metric }, op: "lt" as const, right: { value: warn } },
    label: "danger",
    message: "",
  },
];

const RULES: ConditionRule[] = [
  rule({
    id: "acc",
    key: "aimfox_accept_rate",
    metricKey: "aimfox_accept_rate",
    columnKey: "aimfox_accept_rate",
    branches: band("aimfox_accept_rate", 0.4, 0.3),
  }),
  rule({
    id: "db",
    key: "aimfox_remaining_db",
    metricKey: "aimfox_remaining_db",
    columnKey: "aimfox_remaining_db",
    priority: 47,
    branches: band("aimfox_remaining_db", 200, 100),
  }),
];

function emptyMetrics(): ClientMetricsPack {
  return {
    overview: {} as ClientMetricsPack["overview"],
    dodRows: [],
    threeDodRows: [],
    wowRows: [],
    momRows: [],
  };
}

function severityFor(metric: string, value: number | null) {
  const context = { target_id: "c1", custom: {}, [metric]: value } as unknown as ClientConditionContext;
  const pack = evaluateClientConditions(context, RULES, emptyMetrics(), CLIENT);
  return pack.allResults.find((r) => r.columnKey === metric)?.severity ?? null;
}

describe("LinkedIn capacity cell rules", () => {
  it("grades acceptance at 40% and 30%, on the 0..1 scale the context uses", () => {
    expect(severityFor("aimfox_accept_rate", 0.42)).toBe("good");
    expect(severityFor("aimfox_accept_rate", 0.4)).toBe("good");
    expect(severityFor("aimfox_accept_rate", 0.399)).toBe("warning");
    expect(severityFor("aimfox_accept_rate", 0.3)).toBe("warning");
    expect(severityFor("aimfox_accept_rate", 0.299)).toBe("danger");
    // Sent invites, none accepted — a real zero, and the worst case there is.
    expect(severityFor("aimfox_accept_rate", 0)).toBe("danger");
  });

  it("grades remaining database at 200 and 100", () => {
    expect(severityFor("aimfox_remaining_db", 2213)).toBe("good");
    expect(severityFor("aimfox_remaining_db", 200)).toBe("good");
    expect(severityFor("aimfox_remaining_db", 199)).toBe("warning");
    expect(severityFor("aimfox_remaining_db", 100)).toBe("warning");
    expect(severityFor("aimfox_remaining_db", 99)).toBe("danger");
    expect(severityFor("aimfox_remaining_db", 0)).toBe("danger");
  });

  it("leaves a client with no active LinkedIn campaign uncoloured, without a base filter", () => {
    // This is what carries the "IF LinkedIn connected" requirement here: null, not a gate. If the
    // evaluator ever coerced a null left operand to 0, both cells would turn red for every
    // email-only client — which is exactly the failure the DoD rules needed an explicit filter for,
    // because their counters arrive as a real 0 rather than as null.
    expect(severityFor("aimfox_accept_rate", null)).toBeNull();
    expect(severityFor("aimfox_remaining_db", null)).toBeNull();
  });
});
