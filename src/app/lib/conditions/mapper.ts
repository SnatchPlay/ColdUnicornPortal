import type { ConditionRule } from "./types";
import type { ConditionRuleRecord } from "../../types/core";

export function toConditionRule(record: ConditionRuleRecord): ConditionRule {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    targetEntity: record.target_entity,
    surface: record.surface,
    metricKey: record.metric_key,
    sourceSheet: record.source_sheet,
    sourceRange: record.source_range,
    scopeType: record.scope_type,
    clientId: record.client_id,
    managerId: record.manager_id,
    applyTo: record.apply_to,
    columnKey: record.column_key,
    branches: Array.isArray(record.branches) ? (record.branches as ConditionRule["branches"]) : [],
    baseFilter: (record.base_filter as ConditionRule["baseFilter"]) ?? null,
    priority: record.priority,
    enabled: record.enabled,
    notes: record.notes,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function fromConditionRule(rule: ConditionRule): ConditionRuleRecord {
  return {
    id: rule.id,
    key: rule.key,
    name: rule.name,
    description: rule.description,
    target_entity: rule.targetEntity,
    surface: rule.surface,
    metric_key: rule.metricKey,
    source_sheet: rule.sourceSheet,
    source_range: rule.sourceRange,
    scope_type: rule.scopeType,
    client_id: rule.clientId,
    manager_id: rule.managerId,
    apply_to: rule.applyTo,
    column_key: rule.columnKey,
    branches: rule.branches,
    base_filter: rule.baseFilter,
    priority: rule.priority,
    enabled: rule.enabled,
    notes: rule.notes,
    created_by: rule.createdBy,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
  };
}