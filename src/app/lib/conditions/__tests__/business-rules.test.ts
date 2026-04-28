import { describe, expect, it } from "vitest";
import { evaluateConditionRules } from "../evaluator";
import type { ConditionRule } from "../types";

function rule(overrides: Partial<ConditionRule>): ConditionRule {
  return {
    id: "r1",
    key: "key",
    name: "name",
    description: null,
    targetEntity: "client",
    surface: "clients_overview",
    metricKey: "value",
    sourceSheet: "CS PDCA",
    sourceRange: "A1",
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

describe("seeded business rules", () => {
  it("prospects_added_vs_signed", () => {
    const r = rule({
      key: "prospects_added_vs_signed",
      metricKey: "prospects_added",
      branches: [
        { severity: "good", when: { left: { metric: "prospects_added" }, op: "gte", right: { metric: "prospects_signed" } }, label: "good", message: "good" },
        { severity: "warning", when: { all: [{ left: { metric: "prospects_added" }, op: "gte", right: { metric: "prospects_signed", multiplier: 0.8 } }, { left: { metric: "prospects_added" }, op: "lt", right: { metric: "prospects_signed" } }] }, label: "warn", message: "warn" },
        { severity: "danger", when: { left: { metric: "prospects_added" }, op: "lt", right: { metric: "prospects_signed", multiplier: 0.8 } }, label: "danger", message: "danger" },
      ],
    });
    const warning = evaluateConditionRules({ prospects_added: 85, prospects_signed: 100 }, [r], { targetId: "c1" });
    expect(warning[0]?.severity).toBe("warning");
  });

  it("dod_sent_or_schedule_vs_min_sent", () => {
    const r = rule({
      key: "dod_sent_or_schedule_vs_min_sent",
      surface: "clients_dod",
      metricKey: "value",
      branches: [
        { severity: "good", when: { all: [{ left: { metric: "value" }, op: "gte", right: { metric: "min_sent", multiplier: 0.971 } }, { left: { metric: "value" }, op: "lt", right: { metric: "min_sent", multiplier: 1.5 } }] }, label: "good", message: "good" },
        { severity: "warning", when: { all: [{ left: { metric: "value" }, op: "gte", right: { metric: "min_sent", multiplier: 0.8 } }, { left: { metric: "value" }, op: "lte", right: { metric: "min_sent", multiplier: 0.97 } }] }, label: "warn", message: "warn" },
        { severity: "danger", when: { left: { metric: "value" }, op: "lt", right: { metric: "min_sent", multiplier: 0.8 } }, label: "danger", message: "danger" },
      ],
    });
    const danger = evaluateConditionRules({ value: 70, min_sent: 100 }, [r], { targetId: "c1" });
    expect(danger[0]?.severity).toBe("danger");
  });

  it("inboxes_vs_min_sent", () => {
    const r = rule({
      key: "inboxes_vs_min_sent",
      metricKey: "inboxes",
      branches: [
        { severity: "good", when: { left: { metric: "inboxes" }, op: "gte", right: { metric: "min_sent", multiplier: 0.1 } }, label: "good", message: "good" },
        { severity: "danger", when: { left: { metric: "inboxes" }, op: "lt", right: { metric: "min_sent", multiplier: 0.1 } }, label: "danger", message: "danger" },
      ],
    });
    const result = evaluateConditionRules({ inboxes: 5, min_sent: 100 }, [r], { targetId: "c1" });
    expect(result[0]?.severity).toBe("danger");
  });

  it("wow bounce/total/human/ooo rules", () => {
    const bounce = rule({
      key: "wow_bounce_rate",
      metricKey: "wow_bounce_rate",
      branches: [
        { severity: "good", when: { left: { metric: "value" }, op: "lte", right: { value: 0.01 } }, label: "good", message: "good" },
        { severity: "warning", when: { all: [{ left: { metric: "value" }, op: "gt", right: { value: 0.01 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.02 } }] }, label: "warn", message: "warn" },
        { severity: "danger", when: { left: { metric: "value" }, op: "gte", right: { value: 0.02 } }, label: "danger", message: "danger" },
      ],
    });
    expect(evaluateConditionRules({ value: 0.025 }, [bounce], { targetId: "c1" })[0]?.severity).toBe("danger");

    const total = rule({
      key: "wow_total_response_rate",
      branches: [
        { severity: "good", when: { any: [{ left: { metric: "value" }, op: "gte", right: { value: 0.02 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.001 } }] }, label: "good", message: "good" },
        { severity: "danger", when: { all: [{ left: { metric: "value" }, op: "gte", right: { value: 0.001 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.02 } }] }, label: "danger", message: "danger" },
      ],
    });
    expect(evaluateConditionRules({ value: 0.01 }, [total], { targetId: "c1" })[0]?.severity).toBe("danger");

    const human = rule({
      key: "wow_human_response_rate",
      branches: [
        { severity: "good", when: { any: [{ left: { metric: "value" }, op: "gte", right: { value: 0.01 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.001 } }] }, label: "good", message: "good" },
        { severity: "warning", when: { all: [{ left: { metric: "value" }, op: "gte", right: { value: 0.001 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.01 } }] }, label: "warning", message: "warning" },
      ],
    });
    expect(evaluateConditionRules({ value: 0.005 }, [human], { targetId: "c1" })[0]?.severity).toBe("warning");

    const ooo = rule({
      key: "wow_ooo_rate",
      branches: [
        { severity: "good", when: { any: [{ all: [{ left: { metric: "value" }, op: "gte", right: { value: 0.005 } }, { left: { metric: "value" }, op: "lte", right: { value: 0.06 } }] }, { left: { metric: "value" }, op: "lt", right: { value: 0.001 } }] }, label: "good", message: "good" },
        { severity: "warning", when: { any: [{ left: { metric: "value" }, op: "gt", right: { value: 0.06 } }, { all: [{ left: { metric: "value" }, op: "gte", right: { value: 0.001 } }, { left: { metric: "value" }, op: "lt", right: { value: 0.005 } }] }] }, label: "warning", message: "warning" },
      ],
    });
    expect(evaluateConditionRules({ value: 0.08 }, [ooo], { targetId: "c1" })[0]?.severity).toBe("warning");
  });

  it("mom_sql_vs_monthly_lead_kpi", () => {
    const r = rule({
      key: "mom_sql_vs_monthly_lead_kpi",
      metricKey: "mom_sql",
      branches: [
        { severity: "good", when: { left: { metric: "mom_sql" }, op: "gte", right: { metric: "monthly_sql_kpi" } }, label: "good", message: "good" },
        { severity: "warning", when: { all: [{ left: { metric: "mom_sql" }, op: "gte", right: { metric: "monthly_sql_kpi", multiplier: 0.8 } }, { left: { metric: "mom_sql" }, op: "lt", right: { metric: "monthly_sql_kpi" } }] }, label: "warn", message: "warn" },
        { severity: "danger", when: { left: { metric: "mom_sql" }, op: "lt", right: { metric: "monthly_sql_kpi", multiplier: 0.8 } }, label: "danger", message: "danger" },
      ],
    });
    const result = evaluateConditionRules({ mom_sql: 7, monthly_sql_kpi: 10 }, [r], { targetId: "c1" });
    expect(result[0]?.severity).toBe("danger");
  });
});
