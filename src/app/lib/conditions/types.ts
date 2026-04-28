export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "is_blank"
  | "not_blank"
  | "starts_with"
  | "not_starts_with"
  | "in"
  | "not_in";

export type ConditionSeverity =
  | "good"
  | "info"
  | "warning"
  | "danger"
  | "critical_over";

export type ConditionApplyTo = "row" | "cell" | "badge" | "section";
export type ConditionTargetEntity = "client" | "campaign" | "lead";
export type ConditionScopeType = "global" | "client" | "manager";

export type ConditionTransform = "lower" | "upper" | "trim" | "abs" | "round";

export interface ConditionValueRef {
  value?: unknown;
  metric?: string;
  multiplier?: number;
  transform?: ConditionTransform;
}

export interface ConditionComparisonNode {
  left: ConditionValueRef;
  op: ConditionOperator;
  right?: ConditionValueRef;
}

export interface ConditionAllNode {
  all: ConditionNode[];
}

export interface ConditionAnyNode {
  any: ConditionNode[];
}

export type ConditionNode = ConditionComparisonNode | ConditionAllNode | ConditionAnyNode;

export interface ConditionBranch {
  severity: ConditionSeverity;
  when: ConditionNode;
  label: string;
  message: string;
}

export interface ConditionRule {
  id: string;
  key: string;
  name: string;
  description: string | null;

  targetEntity: ConditionTargetEntity;
  surface: string;
  metricKey: string;

  sourceSheet: string | null;
  sourceRange: string | null;

  scopeType: ConditionScopeType;
  clientId: string | null;
  managerId: string | null;

  applyTo: ConditionApplyTo;
  columnKey: string | null;

  branches: ConditionBranch[];
  baseFilter: ConditionNode | null;

  priority: number;
  enabled: boolean;
  notes: string | null;

  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConditionRuleInput {
  key: string;
  name: string;
  description?: string | null;
  targetEntity?: ConditionTargetEntity;
  surface: string;
  metricKey: string;
  sourceSheet?: string | null;
  sourceRange?: string | null;
  scopeType?: ConditionScopeType;
  clientId?: string | null;
  managerId?: string | null;
  applyTo?: ConditionApplyTo;
  columnKey?: string | null;
  branches: ConditionBranch[];
  baseFilter?: ConditionNode | null;
  priority?: number;
  enabled?: boolean;
  notes?: string | null;
}

export interface ConditionRulePatch {
  name?: string;
  description?: string | null;
  surface?: string;
  metricKey?: string;
  sourceSheet?: string | null;
  sourceRange?: string | null;
  scopeType?: ConditionScopeType;
  clientId?: string | null;
  managerId?: string | null;
  applyTo?: ConditionApplyTo;
  columnKey?: string | null;
  branches?: ConditionBranch[];
  baseFilter?: ConditionNode | null;
  priority?: number;
  enabled?: boolean;
  notes?: string | null;
}

export interface ConditionEvaluationResult {
  ruleId: string;
  ruleKey: string;
  ruleName: string;

  targetEntity: ConditionTargetEntity;
  targetId: string;

  surface: string;
  metricKey: string;

  severity: ConditionSeverity;
  applyTo: ConditionApplyTo;
  columnKey?: string;

  label: string;
  message: string;

  value?: unknown;
  threshold?: unknown;

  priority: number;

  sourceSheet?: string | null;
  sourceRange?: string | null;
}

export const CONDITION_SEVERITY_RANK: Record<ConditionSeverity, number> = {
  good: 0,
  info: 1,
  warning: 2,
  danger: 3,
  critical_over: 4,
};