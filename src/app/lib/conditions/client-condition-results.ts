import type { ClientRecord } from "../../types/core";
import type { ClientMetricsPack } from "../client-metrics";
import type { ClientConditionContext } from "./client-condition-context";
import { evaluateConditionRules, evaluateSingleRule } from "./evaluator";
import type { ConditionEvaluationResult, ConditionRule } from "./types";

export interface ClientConditionPack {
  allResults: ConditionEvaluationResult[];
  overviewResults: ConditionEvaluationResult[];
  threeDodResults: ConditionEvaluationResult[];
  wowResults: ConditionEvaluationResult[];
  momResults: ConditionEvaluationResult[];
  setupResults: ConditionEvaluationResult[];
  dodCellResults: Record<string, ConditionEvaluationResult[]>;
}

function isRuleScopedToClient(rule: ConditionRule, client: ClientRecord) {
  if (rule.scopeType === "global") return true;
  if (rule.scopeType === "client") return rule.clientId === client.id;
  if (rule.scopeType === "manager") return rule.managerId === client.manager_id;
  return false;
}

function getRulesBySurface(rules: ConditionRule[], surface: string, client: ClientRecord) {
  return rules.filter((rule) => rule.enabled && rule.surface === surface && isRuleScopedToClient(rule, client));
}

function makeDodCellKey(bucket: string, kind: "schedule" | "sent") {
  return `dod:${bucket}:${kind}`;
}

function evaluateDodCells(
  context: ClientConditionContext,
  rules: ConditionRule[],
  metrics: ClientMetricsPack,
): Record<string, ConditionEvaluationResult[]> {
  const results: Record<string, ConditionEvaluationResult[]> = {};
  const dodRules = rules.filter((rule) => rule.surface === "clients_dod");
  if (dodRules.length === 0) return results;

  for (const row of metrics.dodRows) {
    if (row.schedule !== null && row.schedule !== undefined) {
      const cellKey = makeDodCellKey(row.bucket, "schedule");
      const cellContext = { ...context, value: row.schedule };
      const cellMatches = dodRules
        .map((rule) => {
          const threshold = typeof context.min_sent === "number" ? context.min_sent : undefined;
          return evaluateSingleRule(cellContext, rule, {
            targetId: context.target_id,
            columnKey: cellKey,
            applyTo: "cell",
            value: row.schedule,
            threshold,
          });
        })
        .filter((item): item is ConditionEvaluationResult => Boolean(item));
      if (cellMatches.length > 0) {
        results[cellKey] = cellMatches;
      }
    }

    if (row.sent !== null && row.sent !== undefined) {
      const cellKey = makeDodCellKey(row.bucket, "sent");
      const cellContext = { ...context, value: row.sent };
      const cellMatches = dodRules
        .map((rule) => {
          const threshold = typeof context.min_sent === "number" ? context.min_sent : undefined;
          return evaluateSingleRule(cellContext, rule, {
            targetId: context.target_id,
            columnKey: cellKey,
            applyTo: "cell",
            value: row.sent,
            threshold,
          });
        })
        .filter((item): item is ConditionEvaluationResult => Boolean(item));
      if (cellMatches.length > 0) {
        results[cellKey] = cellMatches;
      }
    }
  }

  return results;
}

export function evaluateClientConditions(
  context: ClientConditionContext,
  rules: ConditionRule[],
  metrics: ClientMetricsPack,
  client: ClientRecord,
): ClientConditionPack {
  const targetId = context.target_id;

  const overviewResults = evaluateConditionRules(
    context as unknown as Record<string, unknown>,
    getRulesBySurface(rules, "clients_overview", client),
    { targetId },
  );
  const threeDodResults = evaluateConditionRules(
    context as unknown as Record<string, unknown>,
    getRulesBySurface(rules, "clients_3dod", client),
    { targetId },
  );
  const wowResults = evaluateConditionRules(
    context as unknown as Record<string, unknown>,
    getRulesBySurface(rules, "clients_wow", client),
    { targetId },
  );
  const momResults = evaluateConditionRules(
    context as unknown as Record<string, unknown>,
    getRulesBySurface(rules, "clients_mom", client),
    { targetId },
  );
  const setupResults = evaluateConditionRules(
    context as unknown as Record<string, unknown>,
    getRulesBySurface(rules, "clients_setup", client),
    { targetId },
  );

  const dodCellResults = evaluateDodCells(context, getRulesBySurface(rules, "clients_dod", client), metrics);
  const dodResultsFlat = Object.values(dodCellResults).flat();

  const allResults = [
    ...overviewResults,
    ...threeDodResults,
    ...wowResults,
    ...momResults,
    ...setupResults,
    ...dodResultsFlat,
  ];

  return {
    allResults,
    overviewResults,
    threeDodResults,
    wowResults,
    momResults,
    setupResults,
    dodCellResults,
  };
}

export function dodCellKey(bucket: string, kind: "schedule" | "sent") {
  return makeDodCellKey(bucket, kind);
}