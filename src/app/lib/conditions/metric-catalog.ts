// Metric catalog — the code-level registry of every metric the guided rule
// builder can target. Each entry tells the builder:
//   - the dotted `metric` path the evaluator resolves at runtime
//     (see `evaluator.ts:getMetricValue`)
//   - the `column_key` to colour when `apply_to = 'cell'`
//     (mega-table column `conditionKey`)
//   - which operators make sense for the metric's value type
//   - for enum metrics: the allowed option list
//
// Built-in entries are hand-authored against
// `client-condition-context.ts` (context keys) and the `conditionKey`
// values on `MEGA_COLUMNS` (mega-table.tsx). Custom entries are generated
// at runtime from `clientCustomFields`.
//
// Out of scope for v1: `clients_dod` surface — DoD cells use a dynamic
// `dod:{bucket}:{kind}` column key handled by a separate evaluation path
// in client-condition-results.ts. Authoring DoD rules stays in raw mode.

import type { ClientCustomFieldRecord } from "../../types/core";
import type { ConditionOperator } from "./types";

export type MetricValueType = "number" | "percent" | "boolean" | "text" | "enum";

export type ConditionSurface =
  | "clients_overview"
  | "clients_3dod"
  | "clients_wow"
  | "clients_mom"
  | "clients_setup"
  | "clients_dod";

export interface MetricDescriptor {
  /** Dotted path used in `when.left.metric`. Resolves through the context. */
  path: string;
  /** Human label shown in the picker. */
  label: string;
  /** Surface the metric lives on — sets `rule.surface`. */
  surface: ConditionSurface;
  /** `rule.column_key` to colour when `apply_to = 'cell'`. */
  columnKey: string | null;
  valueType: MetricValueType;
  /** Operators offered for this metric. */
  operators: ConditionOperator[];
  /** For valueType=enum: allowed option strings. */
  enumOptions?: string[];
  /** Optgroup label in the picker. */
  group: string;
}

export const CONDITION_SURFACES: { id: ConditionSurface; label: string }[] = [
  { id: "clients_overview", label: "Overview" },
  { id: "clients_3dod", label: "3-Day rolling" },
  { id: "clients_wow", label: "Week over Week" },
  { id: "clients_mom", label: "Month over Month" },
  { id: "clients_setup", label: "Setup" },
  { id: "clients_dod", label: "DoD (advanced — raw mode only)" },
];

// --- Operator presets per value type --------------------------------------
const NUMERIC_OPS: ConditionOperator[] = ["lt", "lte", "gt", "gte", "between", "eq", "neq"];
const PERCENT_OPS: ConditionOperator[] = NUMERIC_OPS;
const BOOLEAN_OPS: ConditionOperator[] = ["eq", "neq"];
const ENUM_OPS: ConditionOperator[] = ["eq", "neq", "in", "not_in"];
const TEXT_OPS: ConditionOperator[] = ["is_blank", "not_blank", "starts_with", "eq", "neq"];

export const OPERATORS_BY_VALUE_TYPE: Record<MetricValueType, ConditionOperator[]> = {
  number: NUMERIC_OPS,
  percent: PERCENT_OPS,
  boolean: BOOLEAN_OPS,
  enum: ENUM_OPS,
  text: TEXT_OPS,
};

const CLIENT_STATUS_OPTIONS = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"];

// --- Built-in metric catalog ---------------------------------------------
//
// Conventions:
//  * `path` mirrors the context key in `client-condition-context.ts`.
//  * For cell-colourable metrics, `columnKey` matches a `conditionKey` on
//    `MEGA_COLUMNS` (mega-table.tsx).
//  * `null` columnKey means the metric is readable inside `when` but is not
//    currently linked to a built-in cell — useful as a base_filter operand
//    or for `apply_to: row | badge | section`.

export const BUILTIN_METRICS: MetricDescriptor[] = [
  // --- Overview / Basic ---
  {
    path: "client.status",
    label: "Client status",
    surface: "clients_overview",
    columnKey: null,
    valueType: "enum",
    operators: ENUM_OPS,
    enumOptions: CLIENT_STATUS_OPTIONS,
    group: "Client",
  },
  {
    path: "min_sent",
    label: "Min daily sent",
    surface: "clients_overview",
    columnKey: "min_sent",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Basic",
  },
  {
    path: "inboxes",
    label: "Inboxes count",
    surface: "clients_overview",
    columnKey: "inboxes",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Basic",
  },
  {
    path: "prospects_signed",
    label: "Prospects signed",
    surface: "clients_overview",
    columnKey: "prospects_signed",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Basic",
  },
  {
    path: "prospects_added",
    label: "Prospects added",
    surface: "clients_overview",
    columnKey: "prospects_added",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Basic",
  },
  {
    path: "client.kpi_leads",
    label: "KPI Leads (contracted)",
    surface: "clients_overview",
    columnKey: "kpi_leads",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "KPI",
  },
  {
    path: "client.kpi_meetings",
    label: "KPI Meetings (contracted)",
    surface: "clients_overview",
    columnKey: "kpi_meetings",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "KPI",
  },
  {
    path: "client.auto_ooo_enabled",
    label: "Auto-OOO enabled",
    surface: "clients_overview",
    columnKey: null,
    valueType: "boolean",
    operators: BOOLEAN_OPS,
    group: "Client",
  },

  // --- 3-Day rolling ---
  {
    path: "three_dod_total",
    label: "3-DoD Total (current)",
    surface: "clients_3dod",
    columnKey: "three_dod_total",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "3-Day rolling",
  },
  {
    path: "three_dod_sql",
    label: "3-DoD SQL (current)",
    surface: "clients_3dod",
    columnKey: "three_dod_sql",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "3-Day rolling",
  },

  // --- Week over Week ---
  {
    path: "wow_total_response_rate",
    label: "WoW Total response rate",
    surface: "clients_wow",
    columnKey: "wow_total_response_rate",
    valueType: "percent",
    operators: PERCENT_OPS,
    group: "Week over Week",
  },
  {
    path: "wow_human_response_rate",
    label: "WoW Human response rate",
    surface: "clients_wow",
    columnKey: "wow_human_response_rate",
    valueType: "percent",
    operators: PERCENT_OPS,
    group: "Week over Week",
  },
  {
    path: "wow_bounce_rate",
    label: "WoW Bounce rate",
    surface: "clients_wow",
    columnKey: "wow_bounce_rate",
    valueType: "percent",
    operators: PERCENT_OPS,
    group: "Week over Week",
  },
  {
    path: "wow_ooo_rate",
    label: "WoW OOO rate",
    surface: "clients_wow",
    columnKey: "wow_ooo_rate",
    valueType: "percent",
    operators: PERCENT_OPS,
    group: "Week over Week",
  },
  {
    path: "wow_negative_rate",
    label: "WoW Negative rate",
    surface: "clients_wow",
    columnKey: null,
    valueType: "percent",
    operators: PERCENT_OPS,
    group: "Week over Week",
  },
  {
    path: "wow_sql",
    label: "WoW SQL",
    surface: "clients_wow",
    columnKey: "wow_sql",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Week over Week",
  },

  // --- Month over Month ---
  {
    path: "mom_sql",
    label: "MoM SQL",
    surface: "clients_mom",
    columnKey: "mom_sql",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Month over Month",
  },
  {
    path: "mom_meetings",
    label: "MoM Meetings",
    surface: "clients_mom",
    columnKey: "mom_meetings",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Month over Month",
  },
  {
    path: "mom_won",
    label: "MoM Won",
    surface: "clients_mom",
    columnKey: "mom_won",
    valueType: "number",
    operators: NUMERIC_OPS,
    group: "Month over Month",
  },

  // --- Setup ---
  {
    path: "client.setup_info",
    label: "Setup info note",
    surface: "clients_setup",
    columnKey: null,
    valueType: "text",
    operators: TEXT_OPS,
    group: "Setup",
  },
];

const SIMPLE_TRIGGER_KEY_PREFIX = "simple_trigger:";
export { SIMPLE_TRIGGER_KEY_PREFIX };

// --- Custom-field metric generation --------------------------------------

function customFieldOperators(field: ClientCustomFieldRecord): ConditionOperator[] {
  if (field.field_type === "checkbox") return BOOLEAN_OPS;
  if (field.field_type === "droplist") return ENUM_OPS;
  return TEXT_OPS;
}

function customFieldValueType(field: ClientCustomFieldRecord): MetricValueType {
  if (field.field_type === "checkbox") return "boolean";
  if (field.field_type === "droplist") return "enum";
  return "text";
}

export function buildCustomFieldMetrics(
  fields: readonly ClientCustomFieldRecord[],
): MetricDescriptor[] {
  return fields
    .slice()
    .sort((l, r) => l.position - r.position)
    .map((field) => ({
      path: `custom.${field.id}`,
      label: field.name,
      surface: "clients_overview" as const,
      columnKey: `cf:${field.id}`,
      valueType: customFieldValueType(field),
      operators: customFieldOperators(field),
      enumOptions: field.field_type === "droplist" ? field.options ?? undefined : undefined,
      group: "Custom columns",
    }));
}

/** Full catalog — built-ins followed by custom-field metrics. */
export function getCatalog(
  customFields: readonly ClientCustomFieldRecord[],
): MetricDescriptor[] {
  return [...BUILTIN_METRICS, ...buildCustomFieldMetrics(customFields)];
}

/** Lookup by `path` (the value stored in `when.left.metric`). */
export function findMetricByPath(
  path: string,
  customFields: readonly ClientCustomFieldRecord[],
): MetricDescriptor | null {
  const all = getCatalog(customFields);
  return all.find((m) => m.path === path) ?? null;
}

/** All metrics for a given surface — used to filter the picker. */
export function getMetricsForSurface(
  surface: ConditionSurface,
  customFields: readonly ClientCustomFieldRecord[],
): MetricDescriptor[] {
  return getCatalog(customFields).filter((m) => m.surface === surface);
}

/** Operators that support a metric-on-the-right comparison ("vs another metric"). */
const METRIC_COMPARE_OPS = new Set<ConditionOperator>([
  "lt",
  "lte",
  "gt",
  "gte",
  "eq",
  "neq",
]);

export function supportsMetricRight(left: MetricDescriptor, op: ConditionOperator): boolean {
  if (!METRIC_COMPARE_OPS.has(op)) return false;
  return left.valueType === "number" || left.valueType === "percent";
}

/**
 * Metrics that make sense on the right side of a comparison against `left`.
 * v1: numeric ↔ numeric only. (Comparing a percent against a number works at
 * the engine level — they're just numbers — so we group them together.)
 */
export function getCompatibleRightMetrics(
  left: MetricDescriptor,
  customFields: readonly ClientCustomFieldRecord[],
): MetricDescriptor[] {
  if (left.valueType !== "number" && left.valueType !== "percent") return [];
  return getCatalog(customFields).filter(
    (m) => m.valueType === "number" || m.valueType === "percent",
  );
}
