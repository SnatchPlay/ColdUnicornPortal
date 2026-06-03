import { RepositoryError } from "../data/repository";
import { formatDate } from "./format";
import { getLeadStage } from "./selectors";

/**
 * Shared building blocks for the Admin + Manager dashboards. Both surfaces render the same
 * campaign-momentum AreaCharts and derive the same MQL / preMQL pipeline split, so the chart
 * config, error mapper, and reducers live here rather than being copy-pasted per page.
 */

/** Internal (slate-tinted) recharts tooltip style used by admin/manager dashboards. */
export const DASHBOARD_CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "rgba(2,6,23,0.98)",
    border: "1px solid rgba(148,163,184,0.2)",
    borderRadius: "16px",
    color: "#fff",
  },
  labelStyle: { color: "rgba(226,232,240,0.92)" },
  itemStyle: { color: "#f8fafc" },
  cursor: false,
} as const;

/**
 * The three campaign-momentum AreaChart definitions (Sent / Replies / Positive).
 * Subtitles are window-agnostic: the Admin dashboard renders a fixed 21-day series, the Manager
 * dashboard renders the series for its selected timeframe.
 */
export const MOMENTUM_CHARTS = [
  { key: "sent" as const, title: "Campaign momentum: Sent", subtitle: "Daily sent trend.", stroke: "#38bdf8", fill: "#38bdf822" },
  { key: "replies" as const, title: "Campaign momentum: Replies", subtitle: "Daily replies trend.", stroke: "#22c55e", fill: "#22c55e22" },
  { key: "positive" as const, title: "Campaign momentum: Positive", subtitle: "Daily positive replies trend.", stroke: "#f59e0b", fill: "#f59e0b22" },
];

export function mapDashboardError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return `Loading timed out. A database performance issue may be affecting this view.`;
    if (reason.kind === "permission") return `Access to dashboard data is blocked by your current permissions.`;
    if (reason.kind === "network") return `Dashboard data could not be loaded due to a network error. Try again.`;
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load dashboard data.";
}

interface PipelineGroup {
  qualification: string | null;
  meeting_booked: boolean | null;
  meeting_held: boolean | null;
  offer_sent: boolean | null;
  won: boolean | null;
  count: number;
}

/** Accumulates raw pipeline groups into MQL / preMQL / beyond-MQL / unqualified buckets. */
export function pipelineCountsFromGroups(groups: PipelineGroup[] | undefined) {
  let mql = 0, preMql = 0, beyondMql = 0, unqualified = 0;
  for (const group of groups ?? []) {
    const stage = getLeadStage(group);
    if (stage === "MQL") mql += group.count;
    else if (stage === "preMQL") preMql += group.count;
    else if (stage === "unqualified") unqualified += group.count;
    else beyondMql += group.count;
  }
  return { mql, preMql, beyondMql, unqualified };
}

interface MomentumPoint {
  date: string;
  sent: number;
  replies: number;
  positive: number;
}

/** Appends a short day/month `label` to each 21-day momentum point for the chart X axis. */
export function formatMomentumSeries(series: MomentumPoint[] | undefined) {
  return (series ?? []).map((item) => ({
    ...item,
    label: formatDate(item.date, { day: "2-digit", month: "short" }),
  }));
}
