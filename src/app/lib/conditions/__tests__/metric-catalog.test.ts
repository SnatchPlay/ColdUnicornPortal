import { describe, expect, it } from "vitest";
import {
  BUILTIN_METRICS,
  buildCustomFieldMetrics,
  findMetricByPath,
  getCatalog,
  getMetricsForSurface,
  OPERATORS_BY_VALUE_TYPE,
} from "../metric-catalog";
import type { ClientCustomFieldRecord } from "../../../types/core";

function makeField(overrides: Partial<ClientCustomFieldRecord>): ClientCustomFieldRecord {
  return {
    id: "field-1",
    name: "Trial ends",
    field_type: "text",
    options: null,
    position: 0,
    created_by: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("metric-catalog", () => {
  it("built-in metrics each declare a valid surface and operator list", () => {
    for (const m of BUILTIN_METRICS) {
      expect(m.path).toMatch(/^[a-z][a-z0-9._]*$/i);
      expect(m.operators.length).toBeGreaterThan(0);
      expect(OPERATORS_BY_VALUE_TYPE[m.valueType]).toEqual(
        expect.arrayContaining(m.operators),
      );
    }
  });

  it("getCatalog merges built-in metrics and custom-field metrics", () => {
    const field = makeField({ id: "abc", name: "Trial ends", field_type: "text" });
    const catalog = getCatalog([field]);
    expect(catalog.length).toBe(BUILTIN_METRICS.length + 1);
    expect(catalog.at(-1)).toMatchObject({
      path: "custom.abc",
      columnKey: "cf:abc",
      valueType: "text",
      group: "Custom columns",
    });
  });

  it("buildCustomFieldMetrics maps field types to value types and operators", () => {
    const fields = [
      makeField({ id: "t", field_type: "text", name: "Text" }),
      makeField({ id: "c", field_type: "checkbox", name: "Checkbox" }),
      makeField({
        id: "d",
        field_type: "droplist",
        name: "Stage",
        options: ["Active", "Paused", "At risk"],
      }),
    ];
    const generated = buildCustomFieldMetrics(fields);
    expect(generated.map((m) => m.valueType)).toEqual(["text", "boolean", "enum"]);
    const enumMetric = generated.find((m) => m.valueType === "enum");
    expect(enumMetric?.enumOptions).toEqual(["Active", "Paused", "At risk"]);
    const boolMetric = generated.find((m) => m.valueType === "boolean");
    expect(boolMetric?.operators).toContain("eq");
  });

  it("findMetricByPath resolves both built-in and custom paths", () => {
    const field = makeField({ id: "abc", name: "Note" });
    expect(findMetricByPath("wow_bounce_rate", [])?.surface).toBe("clients_wow");
    expect(findMetricByPath("custom.abc", [field])?.label).toBe("Note");
    expect(findMetricByPath("not.a.real.path", [])).toBeNull();
  });

  it("getMetricsForSurface filters by surface", () => {
    const overview = getMetricsForSurface("clients_overview", []);
    expect(overview.every((m) => m.surface === "clients_overview")).toBe(true);
    expect(overview.length).toBeGreaterThan(0);
  });
});
