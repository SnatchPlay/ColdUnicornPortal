import { describe, expect, it } from "vitest";
import {
  evaluateConditionNode,
  evaluateConditionRules,
  evaluateSingleRule,
  getCellCondition,
  getHighestSeverity,
  getRowCondition,
} from "../evaluator";
import type { ConditionNode, ConditionRule } from "../types";

function makeRule(overrides: Partial<ConditionRule>): ConditionRule {
  return {
    id: "rule-1",
    key: "rule_key",
    name: "Rule Name",
    description: null,
    targetEntity: "client",
    surface: "clients_overview",
    metricKey: "value",
    sourceSheet: "CS PDCA",
    sourceRange: "A1:A1",
    scopeType: "global",
    clientId: null,
    managerId: null,
    applyTo: "cell",
    columnKey: "value",
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

describe("condition evaluator", () => {
  it("supports gt/gte/lt/lte/eq/neq", () => {
    const context = { a: 10, b: 5 };
    const cases: Array<[ConditionNode, boolean]> = [
      [{ left: { metric: "a" }, op: "gt", right: { metric: "b" } }, true],
      [{ left: { metric: "a" }, op: "gte", right: { value: 10 } }, true],
      [{ left: { metric: "b" }, op: "lt", right: { value: 10 } }, true],
      [{ left: { metric: "b" }, op: "lte", right: { value: 5 } }, true],
      [{ left: { metric: "a" }, op: "eq", right: { value: 10 } }, true],
      [{ left: { metric: "a" }, op: "neq", right: { value: 7 } }, true],
    ];
    for (const [node, expected] of cases) {
      expect(evaluateConditionNode(context, node)).toBe(expected);
    }
  });

  it("supports between, starts_with, is_blank, not_blank, in/not_in", () => {
    const context = { rate: 0.15, text: "OK status", blank: "", listValue: "a" };
    expect(evaluateConditionNode(context, { left: { metric: "rate" }, op: "between", right: { value: [0.1, 0.2] } })).toBe(true);
    expect(evaluateConditionNode(context, { left: { metric: "text", transform: "lower" }, op: "starts_with", right: { value: "ok" } })).toBe(true);
    expect(evaluateConditionNode(context, { left: { metric: "blank" }, op: "is_blank" })).toBe(true);
    expect(evaluateConditionNode(context, { left: { metric: "text" }, op: "not_blank" })).toBe(true);
    expect(evaluateConditionNode(context, { left: { metric: "listValue" }, op: "in", right: { value: ["a", "b"] } })).toBe(true);
    expect(evaluateConditionNode(context, { left: { metric: "listValue" }, op: "not_in", right: { value: ["c"] } })).toBe(true);
  });

  it("supports all/any nested groups with multipliers", () => {
    const context = { current: 75, target: 100 };
    const node: ConditionNode = {
      any: [
        {
          all: [
            { left: { metric: "current" }, op: "gte", right: { metric: "target", multiplier: 0.7 } },
            { left: { metric: "current" }, op: "lt", right: { metric: "target" } },
          ],
        },
        { left: { value: false }, op: "eq", right: { value: true } },
      ],
    };
    expect(evaluateConditionNode(context, node)).toBe(true);
  });

  it("returns highest severity and cell/row matches by priority", () => {
    const rules = [
      makeRule({
        id: "1",
        key: "good_cell",
        metricKey: "a",
        columnKey: "a",
        priority: 30,
        branches: [{ severity: "good", when: { left: { metric: "a" }, op: "gte", right: { value: 1 } }, label: "good", message: "good" }],
      }),
      makeRule({
        id: "2",
        key: "danger_cell",
        metricKey: "a",
        columnKey: "a",
        priority: 20,
        branches: [{ severity: "danger", when: { left: { metric: "a" }, op: "gte", right: { value: 1 } }, label: "danger", message: "danger" }],
      }),
      makeRule({
        id: "3",
        key: "warn_row",
        metricKey: "a",
        applyTo: "row",
        priority: 10,
        branches: [{ severity: "warning", when: { left: { metric: "a" }, op: "gte", right: { value: 1 } }, label: "warn", message: "warn" }],
      }),
    ];

    const results = evaluateConditionRules({ a: 2 }, rules, { targetId: "client-1" });
    expect(getHighestSeverity(results)).toBe("danger");
    expect(getCellCondition(results, "a")?.severity).toBe("danger");
    expect(getRowCondition(results)?.severity).toBe("warning");
  });

  it("handles null/undefined with no-match behavior", () => {
    const rule = makeRule({
      key: "null_rule",
      metricKey: "missing",
      branches: [{ severity: "danger", when: { left: { metric: "missing" }, op: "gt", right: { value: 1 } }, label: "x", message: "x" }],
    });
    const result = evaluateSingleRule({}, rule, { targetId: "c1" });
    expect(result).toBeNull();
  });
});
