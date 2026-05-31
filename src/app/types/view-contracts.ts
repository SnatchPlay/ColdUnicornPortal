// View contracts for the per-page data architecture that replaces the universal CoreSnapshot.
//
// Rule (see memory: snapshot-refactor-no-legacy-fallback): the server computes FACTS — primitive
// aggregates (count/sum/min/max, GROUP BY) and column PROJECTIONS that reduce payload. The frontend
// computes INTERPRETATION (KPI/health/stage/rate formulas in client-metrics.ts, client-view-models.ts,
// selectors.ts). Never duplicate those formulas server-side; never cast a projection to a full record.
//
// Foundational shared shapes live here. Per-page response contracts (dashboard/leads/campaigns/
// analytics overviews) are co-located with their gateway action as each phase lands.

import type {
  AppRole,
  ClientCustomFieldRecord,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientStatus,
  ColumnOverrideRecord,
  ConditionRuleRecord,
} from "./core";
// DailyStatInput is the widened parameter accepted by createClientMetrics. Imported here for the
// dailyStats array type in ClientsOverviewPayload (no DailyStatRecord fields are added back in this
// payload — only fields actually consumed by createClientMetrics are shipped).
import type { DailyStatInput } from "../lib/client-metrics";

// --- Lite shapes (navigation / filter options) ---------------------------------------------------

/** Minimal user identity for impersonation, manager labels, and filter options. */
export interface UserLite {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: AppRole;
}

/** Minimal client shape for the sidebar, client switcher, and filter options. */
export interface ClientLite {
  id: string;
  name: string;
  manager_id: string;
  status: ClientStatus;
  kpi_leads: number | null;
  kpi_meetings: number | null;
  notification_emails: string[] | null;
}

/** Minimal client⇄user mapping (no audit columns). */
export interface ClientUserMappingLite {
  id: string;
  client_id: string;
  user_id: string;
}

/** Minimal campaign shape for filter dropdowns / labels. */
export interface CampaignLite {
  id: string;
  client_id: string;
  name: string;
}

// --- Projections (column subsets consumed by existing frontend formulas) -------------------------

/**
 * The exact lead columns read by `createClientMetrics` (client-metrics.ts) and `getLeadStage`
 * (selectors.ts). Shipping this instead of full `LeadRecord` rows is the core payload win — full
 * lead rows are ~73% of the old snapshot. Formula functions must accept this shape directly; do
 * NOT cast it to `LeadRecord`.
 */
export interface LeadMetricProjection {
  id: string;
  client_id: string;
  campaign_id: string | null;
  created_at: string | null;
  qualification: string | null;
  meeting_booked: boolean | null;
  meeting_held: boolean | null;
  offer_sent: boolean | null;
  won: boolean | null;
}

/**
 * Minimal lead projection for the Clients page (Phase 3). Only the 5 fields that
 * `createClientMetrics` and `useClientsOverview` actually consume — no id, campaign_id,
 * meeting_held, or offer_sent. Reduces lead section payload by ~44% vs LeadMetricProjection.
 * Do NOT cast to LeadRecord or LeadMetricProjection.
 */
export interface ClientsLeadInput {
  client_id: string;
  created_at: string | null;
  qualification: string | null;
  meeting_booked: boolean | null;
  won: boolean | null;
}

// --- Shell -----------------------------------------------------------------------------------------

/**
 * Global boot payload. Target < 500 KB (ideally < 200 KB). No leads/replies/stats/etc.
 *
 * These are server FACTS only. Role/permission context is not part of the shell payload — the
 * effective `AppRole` already comes from `useAuth().identity` (loadIdentity), so duplicating it
 * here would be redundant. Add runtime flags/config to this shape only when they actually exist.
 */
export interface ShellData {
  usersLite: UserLite[];
  clientsLite: ClientLite[];
  clientUsers: ClientUserMappingLite[];
}

// --- Dashboard data contracts (Phase 2A) ---------------------------------------------------------
// Server computes PRIMITIVE aggregates (counts, sums, groups, top-N rows). Frontend applies all
// business interpretation: getLeadStage, KPI progress, watchlist filter, conversion rates, etc.

/** Admin dashboard aggregate payload. Covers all clients/campaigns/leads visible to the admin. */
export interface AdminDashboardOverview {
  metrics: {
    clientsCount: number;
    /** Clients whose manager_id is NULL or does not belong to a manager-role user. */
    clientsWithoutManager: number;
    activeCampaignsCount: number;
  };
  /**
   * Raw lead field combinations with row count. Frontend applies `getLeadStage` to each group and
   * accumulates counts into pipeline stage buckets. Server must NOT pre-apply stage logic.
   */
  pipelineGroups: Array<{
    qualification: string | null;
    meeting_booked: boolean | null;
    meeting_held: boolean | null;
    offer_sent: boolean | null;
    won: boolean | null;
    count: number;
  }>;
  /** 21-day campaign activity series (sent/replies/positive). Sorted ascending by date. */
  campaignMomentum21d: Array<{
    date: string;
    sent: number;
    replies: number;
    positive: number;
  }>;
  /** Up to 8 managers with their client/campaign/lead load. Sorted by clientsCount DESC. */
  managerCapacity: Array<{
    managerId: string;
    managerName: string;
    clientsCount: number;
    activeCampaignsCount: number;
    leadsCount: number;
  }>;
  /** MAX(report_date) from daily_stats visible to the admin. */
  latestSnapshotDate: string | null;
}

/** Manager dashboard aggregate payload. Scoped to the manager's assigned clients. */
export interface ManagerDashboardOverview {
  metrics: {
    assignedClientsCount: number;
    activeCampaignsCount: number;
    leadsInProgressCount: number;
    unclassifiedRepliesCount: number;
    recentRepliesCount14d: number;
  };
  /** Per-client portfolio summary. Frontend computes KPI progress. */
  clientPortfolio: Array<{
    clientId: string;
    clientName: string;
    status: string | null;
    campaignsCount: number;
    mqlCount: number;
    wonCount: number;
    kpiLeads: number | null;
    kpiMeetings: number | null;
  }>;
  /**
   * All manager-scoped campaigns with total sent/replies (not windowed). Frontend applies the
   * watchlist filter (status !== active OR replyRate < 1%) and sorts by reply rate ascending.
   */
  campaignWatchlist: Array<{
    campaignId: string;
    campaignName: string;
    clientId: string;
    status: string | null;
    sent: number;
    replies: number;
  }>;
  /** 10 most recently updated leads in the manager's scope. Frontend applies getLeadStage. */
  leadQueue: Array<{
    leadId: string;
    clientId: string;
    clientName: string;
    campaignId: string | null;
    firstName: string | null;
    lastName: string | null;
    qualification: string | null;
    meeting_booked: boolean | null;
    meeting_held: boolean | null;
    offer_sent: boolean | null;
    won: boolean | null;
    updatedAt: string | null;
    createdAt: string | null;
  }>;
}

// --- Clients overview (Phase 3) -------------------------------------------------------------------
// Server returns full editable client rows + all data slices the clients mega-table and drawer need.
// Lead payload is a projection (not full rows) so the dominant lead-row weight is eliminated.
// campaignDailyStats are NOT included — the clients page only needs createClientMetrics inputs.

/**
 * Complete data contract for the Clients page. Replaces the universal snapshot for that route.
 * Target payload: below 1.5 MB. Full client rows are retained because the drawer edits them.
 * Lead rows are projected to the 5 fields createClientMetrics reads — full rows are not shipped.
 */
export interface ClientsOverviewPayload {
  /** Full editable client rows scoped by RLS. Drawer and mutations require all fields. */
  clients: ClientRecord[];
  /** All users (for manager labels, filter, invite). Same projection as shell. */
  usersLite: UserLite[];
  /** Client↔user mappings (for drawer user assignments). */
  clientUsers: ClientUserMappingLite[];
  /** Condition rules for health evaluation (admin + manager only; [] for client role). */
  conditionRules: ConditionRuleRecord[];
  /** Column visibility / label overrides for the mega-table. */
  columnOverrides: ColumnOverrideRecord[];
  /** Custom field definitions. */
  clientCustomFields: ClientCustomFieldRecord[];
  /** Per-client custom field values. */
  clientCustomFieldValues: ClientCustomFieldValueRecord[];
  /**
   * Minimal lead projections for ALL visible clients. Only 5 fields — exactly what
   * createClientMetrics consumes for DoD/WoW/MoM aggregates. Saves ~44% vs LeadMetricProjection.
   * Do NOT cast to LeadRecord or LeadMetricProjection.
   */
  leadProjections: ClientsLeadInput[];
  /**
   * 180-day daily stats for ALL visible clients. Includes client_id for per-client partitioning.
   * Only the 10 fields consumed by createClientMetrics — mql_count and prospects_count are omitted.
   * Use DailyStatInput (client-metrics.ts) as the consumer interface.
   */
  dailyStats: Array<DailyStatInput & { client_id: string }>;
}

/**
 * Client dashboard projection payload. Contains bounded raw data; ALL KPI/chart logic runs on
 * the frontend using existing formula modules (client-view-models.ts, timeframe.ts, etc.).
 * Windows: campaignDailyStats = 90 days, dailyStats = 180 days.
 */
export interface ClientDashboardPayload {
  client: {
    id: string;
    name: string;
    status: string | null;
    kpi_leads: number | null;
    kpi_meetings: number | null;
    prospects_added: number | null;
  };
  /** Outreach campaigns only (ADR-0003). */
  campaigns: Array<{
    id: string;
    name: string;
    status: string | null;
    database_size: number | null;
  }>;
  /** Projection of the 9 lead fields consumed by formula modules. Never cast to full LeadRecord. */
  leadProjections: LeadMetricProjection[];
  campaignDailyStats: Array<{
    campaign_id: string;
    report_date: string;
    sent_count: number | null;
    reply_count: number | null;
    bounce_count: number | null;
    unique_open_count: number | null;
    positive_replies_count: number | null;
  }>;
  dailyStats: Array<{
    client_id: string;
    report_date: string;
    emails_sent: number | null;
    mql_count: number | null;
    response_count: number | null;
    bounce_count: number | null;
    negative_count: number | null;
    ooo_count: number | null;
    human_replies_count: number | null;
    prospects_count: number | null;
    schedule_today: number | null;
    schedule_tomorrow: number | null;
    schedule_day_after: number | null;
  }>;
}
