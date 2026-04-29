import {
  CONDITION_SEVERITY_RANK,
  type ConditionApplyTo,
  type ConditionComparisonNode,
  type ConditionEvaluationResult,
  type ConditionNode,
  type ConditionOperator,
  type ConditionRule,
  type ConditionSeverity,
  type ConditionValueRef,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlank(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toComparableString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function applyTransform(value: unknown, transform?: ConditionValueRef["transform"]) {
  if (!transform) return value;

  if (transform === "lower") return toComparableString(value).toLowerCase();
  if (transform === "upper") return toComparableString(value).toUpperCase();
  if (transform === "trim") return toComparableString(value).trim();
  if (transform === "abs") {
    const numeric = toNumber(value);
    return numeric === null ? value : Math.abs(numeric);
  }
  if (transform === "round") {
    const numeric = toNumber(value);
    return numeric === null ? value : Math.round(numeric);
  }

  return value;
}

function getMetricValue(context: Record<string, unknown>, metricPath: string) {
  const segments = metricPath.split(".").filter(Boolean);
  if (segments.length === 0) return undefined;

  let current: unknown = context;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function resolveValueRef(context: Record<string, unknown>, ref?: ConditionValueRef): unknown {
  if (!ref) return undefined;

  let base: unknown;
  if (typeof ref.metric === "string") {
    base = getMetricValue(context, ref.metric);
  } else {
    base = ref.value;
  }

  if (typeof ref.multiplier === "number") {
    const numeric = toNumber(base);
    if (numeric !== null) {
      base = numeric * ref.multiplier;
    }
  }

  return applyTransform(base, ref.transform);
}

function compareWithOperator(left: unknown, operator: ConditionOperator, right: unknown): boolean {
  if (operator === "is_blank") return isBlank(left);
  if (operator === "not_blank") return !isBlank(left);

  if (operator === "eq") return left === right;
  if (operator === "neq") return left !== right;

  if (operator === "starts_with") {
    const source = toComparableString(left).toLowerCase();
    const prefix = toComparableString(right).toLowerCase();
    return source.startsWith(prefix);
  }

  if (operator === "not_starts_with") {
    const source = toComparableString(left).toLowerCase();
    const prefix = toComparableString(right).toLowerCase();
    return !source.startsWith(prefix);
  }

  if (operator === "in" || operator === "not_in") {
    const candidates = Array.isArray(right) ? right : [];
    const hit = candidates.some((candidate) => candidate === left);
    return operator === "in" ? hit : !hit;
  }

  if (operator === "between") {
    const leftNumber = toNumber(left);
    const values = Array.isArray(right) ? right : [];
    const min = toNumber(values[0]);
    const max = toNumber(values[1]);

    if (leftNumber === null || min === null || max === null) return false;
    return leftNumber >= min && leftNumber <= max;
  }

  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber === null || rightNumber === null) return false;

  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  if (operator === "lte") return leftNumber <= rightNumber;

  return false;
}

function evaluateComparison(context: Record<string, unknown>, node: ConditionComparisonNode) {
  const left = resolveValueRef(context, node.left);
  const right = resolveValueRef(context, node.right);
  return compareWithOperator(left, node.op, right);
}

export function evaluateConditionNode(context: Record<string, unknown>, node: ConditionNode): boolean {
  if ("all" in node) {
    return node.all.every((child) => evaluateConditionNode(context, child));
  }

  if ("any" in node) {
    return node.any.some((child) => evaluateConditionNode(context, child));
  }

  return evaluateComparison(context, node);
}

interface EvaluateRuleOptions {
  columnKey?: string;
  applyTo?: ConditionApplyTo;
  value?: unknown;
  threshold?: unknown;
}

export function evaluateConditionRules(
  context: Record<string, unknown>,
  rules: ConditionRule[],
  options: { targetId: string },
): ConditionEvaluationResult[] {
  const matches: ConditionEvaluationResult[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const metricValue = getMetricValue(context, rule.metricKey);
    const contextForRule =
      Object.prototype.hasOwnProperty.call(context, "value")
        ? context
        : { ...context, value: metricValue };

    if (rule.baseFilter && !evaluateConditionNode(contextForRule, rule.baseFilter)) {
      continue;
    }

    const branch = rule.branches.find((item) => evaluateConditionNode(contextForRule, item.when));
    if (!branch) continue;

    const value = metricValue;
    matches.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      ruleName: rule.name,
      targetEntity: rule.targetEntity,
      targetId: options.targetId,
      surface: rule.surface,
      metricKey: rule.metricKey,
      severity: branch.severity,
      applyTo: rule.applyTo,
      columnKey: rule.columnKey ?? undefined,
      label: branch.label,
      message: branch.message,
      value,
      priority: rule.priority,
      sourceSheet: rule.sourceSheet,
      sourceRange: rule.sourceRange,
    });
  }

  return matches.sort((left, right) => {
    const severityGap = CONDITION_SEVERITY_RANK[right.severity] - CONDITION_SEVERITY_RANK[left.severity];
    if (severityGap !== 0) return severityGap;
    return left.priority - right.priority;
  });
}

export function evaluateSingleRule(
  context: Record<string, unknown>,
  rule: ConditionRule,
  options: { targetId: string } & EvaluateRuleOptions,
): ConditionEvaluationResult | null {
  if (!rule.enabled) return null;
  const metricValue = options.value ?? getMetricValue(context, rule.metricKey);
  const contextForRule =
    options.value !== undefined
      ? { ...context, value: options.value }
      : Object.prototype.hasOwnProperty.call(context, "value")
        ? context
        : { ...context, value: metricValue };

  if (rule.baseFilter && !evaluateConditionNode(contextForRule, rule.baseFilter)) {
    return null;
  }

  const branch = rule.branches.find((item) => evaluateConditionNode(contextForRule, item.when));
  if (!branch) return null;

  return {
    ruleId: rule.id,
    ruleKey: rule.key,
    ruleName: rule.name,
    targetEntity: rule.targetEntity,
    targetId: options.targetId,
    surface: rule.surface,
    metricKey: rule.metricKey,
    severity: branch.severity,
    applyTo: options.applyTo ?? rule.applyTo,
    columnKey: options.columnKey ?? rule.columnKey ?? undefined,
    label: branch.label,
    message: branch.message,
    value: metricValue,
    threshold: options.threshold,
    priority: rule.priority,
    sourceSheet: rule.sourceSheet,
    sourceRange: rule.sourceRange,
  };
}

export function getHighestSeverity(results: ConditionEvaluationResult[]): ConditionSeverity | null {
  if (results.length === 0) return null;

  let best = results[0].severity;
  for (const result of results) {
    if (CONDITION_SEVERITY_RANK[result.severity] > CONDITION_SEVERITY_RANK[best]) {
      best = result.severity;
    }
  }

  return best;
}

export function getHealthScore(results: ConditionEvaluationResult[]) {
  if (results.length === 0) return 100;

  let penalty = 0;
  for (const result of results) {
    if (result.severity === "critical_over") {
      penalty += 60;
      continue;
    }
    if (result.severity === "danger") {
      penalty += 25;
      continue;
    }
    if (result.severity === "warning") {
      penalty += 8;
    }
  }

  return Math.max(0, Math.min(100, 100 - penalty));
}

export function getRowCondition(results: ConditionEvaluationResult[]): ConditionEvaluationResult | null {
  const rowResults = results.filter((item) => item.applyTo === "row");
  if (rowResults.length === 0) return null;
  return rowResults.sort((left, right) => {
    const severityGap = CONDITION_SEVERITY_RANK[right.severity] - CONDITION_SEVERITY_RANK[left.severity];
    if (severityGap !== 0) return severityGap;
    return left.priority - right.priority;
  })[0] ?? null;
}

export function getCellCondition(results: ConditionEvaluationResult[], columnKey: string): ConditionEvaluationResult | null {
  const cellResults = results.filter((item) => item.applyTo === "cell" && item.columnKey === columnKey);
  if (cellResults.length === 0) return null;

  return cellResults.sort((left, right) => {
    const severityGap = CONDITION_SEVERITY_RANK[right.severity] - CONDITION_SEVERITY_RANK[left.severity];
    if (severityGap !== 0) return severityGap;
    return left.priority - right.priority;
  })[0] ?? null;
}

export function getSeverityClassName(severity: ConditionSeverity | null) {
  if (!severity) return "";

  if (severity === "critical_over") return "border-fuchsia-400/60 bg-fuchsia-500/12 text-fuchsia-100";
  if (severity === "danger") return "border-red-400/45 bg-red-500/12 text-red-100";
  if (severity === "warning") return "border-amber-300/45 bg-amber-500/12 text-amber-100";
  if (severity === "info") return "border-sky-300/45 bg-sky-500/12 text-sky-100";
  return "border-emerald-300/45 bg-emerald-500/12 text-emerald-100";
}
