import type { ClientRecord } from "../../types/core";
import type { ClientMetricsPack, MomRow, ThreeDodRow, WowRow } from "../client-metrics";
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
  wowCellResults: Record<string, ConditionEvaluationResult[]>;
  threeDodCellResults: Record<string, ConditionEvaluationResult[]>;
  momCellResults: Record<string, ConditionEvaluationResult[]>;
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

function makeThreeDodCellKey(bucket: string, metricKey: string) {
  return `td3:${bucket}:${metricKey}`;
}

export function threeDodCellKey(bucket: string, metricKey: string) {
  return makeThreeDodCellKey(bucket, metricKey);
}

const THREE_DOD_METRIC_PICKS: Array<{ metricKey: string; pick: (row: ThreeDodRow) => number }> = [
  { metricKey: "three_dod_total", pick: (r) => r.totalLeads },
  { metricKey: "three_dod_sql", pick: (r) => r.sqlLeads },
];

function evaluateThreeDodCells(
  context: ClientConditionContext,
  rules: ConditionRule[],
  metrics: ClientMetricsPack,
): Record<string, ConditionEvaluationResult[]> {
  const results: Record<string, ConditionEvaluationResult[]> = {};
  const td3Rules = rules.filter((rule) => rule.surface === "clients_3dod");
  if (td3Rules.length === 0) return results;

  for (const row of metrics.threeDodRows) {
    // Sibling metrics of the *same* day, so a rule on one 3-DoD column can compare
    // itself against the other one in its own bucket (`cell.sql_leads`) instead of
    // the row-level rolling sums (`three_dod_sql`), which are equal for all buckets.
    const cell = {
      bucket: row.bucket,
      total_leads: row.totalLeads,
      sql_leads: row.sqlLeads,
    };

    for (const { metricKey, pick } of THREE_DOD_METRIC_PICKS) {
      const value = pick(row);
      const metricRules = td3Rules.filter((rule) => rule.metricKey === metricKey);
      if (metricRules.length === 0) continue;

      const cellKey = makeThreeDodCellKey(row.bucket, metricKey);
      const cellMatches = metricRules
        .map((rule) =>
          evaluateSingleRule({ ...context, cell, value }, rule, {
            targetId: context.target_id,
            columnKey: cellKey,
            applyTo: "cell",
            value,
          }),
        )
        .filter((item): item is ConditionEvaluationResult => Boolean(item));

      if (cellMatches.length > 0) {
        results[cellKey] = cellMatches;
      }
    }
  }

  return results;
}

function makeMomCellKey(bucket: string, metricKey: string) {
  return `mom:${bucket}:${metricKey}`;
}

export function momCellKey(bucket: string, metricKey: string) {
  return makeMomCellKey(bucket, metricKey);
}

const MOM_METRIC_PICKS: Array<{ metricKey: string; pick: (row: MomRow) => number }> = [
  { metricKey: "mom_total_leads", pick: (r) => r.totalLeads },
  { metricKey: "mom_sql", pick: (r) => r.sqlLeads },
  { metricKey: "mom_meetings", pick: (r) => r.meetings },
  { metricKey: "mom_won", pick: (r) => r.won },
];

function evaluateMomCells(
  context: ClientConditionContext,
  rules: ConditionRule[],
  metrics: ClientMetricsPack,
): Record<string, ConditionEvaluationResult[]> {
  const results: Record<string, ConditionEvaluationResult[]> = {};
  const momRules = rules.filter((rule) => rule.surface === "clients_mom");
  if (momRules.length === 0) return results;

  for (const row of metrics.momRows) {
    for (const { metricKey, pick } of MOM_METRIC_PICKS) {
      const value = pick(row);
      const metricRules = momRules.filter((rule) => rule.metricKey === metricKey);
      if (metricRules.length === 0) continue;

      const cellKey = makeMomCellKey(row.bucket, metricKey);
      const cellMatches = metricRules
        .map((rule) =>
          evaluateSingleRule({ ...context, value }, rule, {
            targetId: context.target_id,
            columnKey: cellKey,
            applyTo: "cell",
            value,
          }),
        )
        .filter((item): item is ConditionEvaluationResult => Boolean(item));

      if (cellMatches.length > 0) {
        results[cellKey] = cellMatches;
      }
    }
  }

  return results;
}

function makeWowCellKey(bucket: string, metricKey: string) {
  return `wow:${bucket}:${metricKey}`;
}

export function wowCellKey(bucket: string, metricKey: string) {
  return makeWowCellKey(bucket, metricKey);
}

const WOW_METRIC_PICKS: Array<{ metricKey: string; pick: (row: WowRow) => number | null }> = [
  { metricKey: "wow_total_response_rate", pick: (r) => r.responseRate },
  { metricKey: "wow_human_response_rate", pick: (r) => r.humanRate },
  { metricKey: "wow_bounce_rate", pick: (r) => r.bounceRate },
  { metricKey: "wow_ooo_rate", pick: (r) => r.oooRate },
  { metricKey: "wow_sql", pick: (r) => r.sqlLeads },
  { metricKey: "wow_total_leads", pick: (r) => r.totalLeads },
];

function evaluateWowCells(
  context: ClientConditionContext,
  rules: ConditionRule[],
  metrics: ClientMetricsPack,
): Record<string, ConditionEvaluationResult[]> {
  const results: Record<string, ConditionEvaluationResult[]> = {};
  const wowRules = rules.filter((rule) => rule.surface === "clients_wow");
  if (wowRules.length === 0) return results;

  for (const row of metrics.wowRows) {
    for (const { metricKey, pick } of WOW_METRIC_PICKS) {
      const value = pick(row);
      if (value === null || value === undefined) continue;

      const metricRules = wowRules.filter((rule) => rule.metricKey === metricKey);
      if (metricRules.length === 0) continue;

      const cellKey = makeWowCellKey(row.bucket, metricKey);
      const cellMatches = metricRules
        .map((rule) =>
          evaluateSingleRule({ ...context, value }, rule, {
            targetId: context.target_id,
            columnKey: cellKey,
            applyTo: "cell",
            value,
          }),
        )
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

  const threeDodCellResults = evaluateThreeDodCells(context, getRulesBySurface(rules, "clients_3dod", client), metrics);
  const threeDodCellResultsFlat = Object.values(threeDodCellResults).flat();

  const wowCellResults = evaluateWowCells(context, getRulesBySurface(rules, "clients_wow", client), metrics);
  const wowCellResultsFlat = Object.values(wowCellResults).flat();

  const momCellResults = evaluateMomCells(context, getRulesBySurface(rules, "clients_mom", client), metrics);
  const momCellResultsFlat = Object.values(momCellResults).flat();

  const allResults = [
    ...overviewResults,
    ...threeDodCellResultsFlat,
    ...wowCellResultsFlat,
    ...momCellResultsFlat,
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
    wowCellResults,
    threeDodCellResults,
    momCellResults,
  };
}

export function dodCellKey(bucket: string, kind: "schedule" | "sent") {
  return makeDodCellKey(bucket, kind);
}