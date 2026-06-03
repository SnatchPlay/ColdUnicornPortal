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
  CampaignRecord,
  ClientCustomFieldRecord,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientStatus,
  ColumnOverrideRecord,
  ConditionRuleRecord,
  LeadRecord,
  ReplyRecord,
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

/**
 * Optional server-side filters for the manager dashboard. When `clientId` is set the whole
 * dashboard is scoped to that single client; `campaignStatus` restricts the campaign-based
 * surfaces (watchlist + momentum + the campaigns metric). `campaignStatus` defaults to "active"
 * server-side; pass "all" to disable the status restriction.
 */
export interface ManagerDashboardParams {
  clientId?: string;
  campaignStatus?: string;
  /** ISO date (YYYY-MM-DD) inclusive bounds. Drives lead/stat-based metrics, momentum, watchlist, portfolio. */
  dateFrom?: string;
  dateTo?: string;
}

/** Manager dashboard aggregate payload. Scoped to the manager's assigned clients. */
export interface ManagerDashboardOverview {
  metrics: {
    assignedClientsCount: number;
    /** Campaigns matching the active campaignStatus filter within the scoped clients. */
    campaignsCount: number;
  };
  /**
   * Raw lead field combinations with row count for the scoped leads. Mirrors the admin payload:
   * frontend applies `getLeadStage` to each group and accumulates MQL / preMQL / beyond-MQL /
   * unqualified buckets. Server must NOT pre-apply stage logic.
   */
  pipelineGroups: Array<{
    qualification: string | null;
    meeting_booked: boolean | null;
    meeting_held: boolean | null;
    offer_sent: boolean | null;
    won: boolean | null;
    count: number;
  }>;
  /** 21-day campaign activity series (sent/replies/positive) for the scope. Sorted ascending by date. */
  campaignMomentum21d: Array<{
    date: string;
    sent: number;
    replies: number;
    positive: number;
  }>;
  /** All manager clients (unfiltered by the clientId param) for the filter dropdown. */
  filterClients: Array<{ id: string; name: string }>;
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
   * Scoped campaigns (status-filtered) with total sent/replies (not windowed). Frontend applies the
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
  /**
   * 10 most recently updated leads in the manager's scope, as full lead rows so the dashboard can
   * open the editable lead drawer directly (toLeadDraft / buildLeadPatch) without a second request.
   */
  leadQueue: LeadsListRow[];
}

// --- Clients overview (Phase 5B split) ------------------------------------------------------------
// loadClientsOverview returns lightweight shell (~85 KB): client rows + config.
// loadClientsStats   returns heavy stats  (~1.4 MB): leadProjections + dailyStats.
// The frontend defers the stats request until after the shell paints so the table and
// drawer are interactive without waiting for 1.4 MB of time-series data.

/**
 * Lightweight shell payload for the Clients page — returned by loadClientsOverview.
 * Contains everything needed to render the table structure, drawer, and mutations.
 * Does NOT include time-series stats; those arrive via loadClientsStats.
 * Target payload: ~85 KB.
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
}

/**
 * Heavy stats payload for the Clients page — returned by loadClientsStats.
 * Loaded after the shell paints. Merged into ClientsOverviewPayload in useClientsOverview.
 * Target payload: ~1.4 MB (leadProjections ~583 KB + dailyStats ~799 KB).
 */
export interface ClientsStatsPayload {
  /**
   * Minimal lead projections for ALL visible clients. Only 5 fields — exactly what
   * createClientMetrics consumes for DoD/WoW/MoM aggregates.
   */
  leadProjections: ClientsLeadInput[];
  /**
   * 180-day daily stats for ALL visible clients. Includes client_id for per-client partitioning.
   * Only the 10 fields consumed by createClientMetrics.
   */
  dailyStats: Array<DailyStatInput & { client_id: string }>;
}

/**
 * Full merged shape held in useClientsOverview state after both loads complete.
 * Before stats arrive, leadProjections and dailyStats are empty arrays.
 */
export type ClientsFullPayload = ClientsOverviewPayload & ClientsStatsPayload;

/**
 * Compact per-client metrics summary — returned by loadClientsMetricsSummary.
 * Contains pre-bucketed aggregate facts only; no raw rows. The frontend
 * applies createClientMetricsFromSummary to produce the full ClientMetricsPack.
 *
 * Arrays are always length 5. Index 0 = current period (today / this week / this month).
 * daily_sent[0..4]: today, yesterday, -2d, -3d, -4d.
 * wow_*[0..4]:  current week (Mon–Sun), last week, ..., -4 weeks.
 * mom_*[0..4]:  current month, last month, ..., -4 months.
 * threedod_*[0..4]: today, yesterday, -2d, -3d, -4d.
 */
export interface ClientMetricsSummary {
  client_id: string;
  /** emails_sent per day: [today, -1d, -2d, -3d, -4d] */
  daily_sent: number[];
  schedule_today: number;
  schedule_tomorrow: number;
  schedule_day_after: number;
  /** SUM(emails_sent) per ISO week: [current, -1w, -2w, -3w, -4w] */
  wow_sent: number[];
  /** SUM(human_replies_count) per week */
  wow_human: number[];
  /** SUM(bounce_count) per week */
  wow_bounce: number[];
  /** SUM(ooo_count) per week */
  wow_ooo: number[];
  /** SUM(negative_count) per week */
  wow_negative: number[];
  /** COUNT(*) leads by created_at week */
  wow_leads: number[];
  /** COUNT(*) leads with qualification='MQL' by created_at week */
  wow_sql: number[];
  /** COUNT(*) leads by created_at month: [current, -1m, -2m, -3m, -4m] */
  mom_total: number[];
  /** COUNT(*) MQL leads by month */
  mom_sql: number[];
  /** COUNT(*) meeting_booked=true leads by month */
  mom_meetings: number[];
  /** COUNT(*) won=true leads by month */
  mom_won: number[];
  /** COUNT(*) (MQL or preMQL) leads by created_at day: [today, -1d, -2d, -3d, -4d] */
  threedod_total: number[];
  /** COUNT(*) MQL leads by day */
  threedod_sql: number[];
  /** MAX(prospects_count) filtered to rows where prospects_count > 0 */
  latest_prospects_count: number;
}

/** Payload returned by loadClientsMetricsSummary. */
export interface ClientsMetricsSummaryPayload {
  summaries: ClientMetricsSummary[];
  _meta: {
    clientsCount: number;
    dailyStatsRowsRead: number;
    leadRowsRead: number;
    computedAt: string;
  };
}

/**
 * Full merged shape used by useClientsOverview after migrating to the compact
 * metrics-summary path. Replaces ClientsFullPayload for the ClientsPage state.
 * Before summaries arrive, metricsSummaries is an empty array.
 */
export type ClientsMetricsFullPayload = ClientsOverviewPayload & {
  metricsSummaries: ClientMetricsSummary[];
};

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

// --- Leads list + detail (Phase 4) ---------------------------------------------------------------
// Server handles all filtering, sorting, and pagination. Frontend keeps all form/edit logic and
// stage computation (getLeadStage). The list row extends LeadRecord so the drawer can use it
// directly without a separate full-lead fetch — only replies are loaded lazily.

/** Stage keys produced by the SQL stage CASE expression (mirrors getLeadStage logic). */
export type LeadStageKey =
  | "preMQL"
  | "MQL"
  | "meeting_scheduled"
  | "meeting_held"
  | "offer_sent"
  | "won"
  | "rejected"
  | "unqualified";

/**
 * A single row in the leads list. Extends LeadRecord so the drawer can use it directly for
 * toLeadDraft / buildLeadPatch without a separate network request. JOINed display fields appended.
 */
export interface LeadsListRow extends LeadRecord {
  clientName: string;
  campaignName: string | null;
  /** COUNT(replies) for this lead. Used in the client-leads table and sort. */
  replyCount: number;
  /** MAX(received_at) of replies. Used in client-leads table sort. */
  lastReplyAt: string | null;
}

/** Server-side filter / sort / pagination params for loadLeadsList. */
export interface LeadsListParams {
  clientId?: string;
  campaignId?: string;
  /** PIPELINE_STAGES key, or undefined for "all" stages. */
  stage?: string;
  replyScope?: "all" | "active" | "ooo";
  /** ISO date string (inclusive). Resolved from TimeframeValue on the frontend. */
  dateFrom?: string;
  dateTo?: string;
  /** Free-text search across name, email, company, job title, country. */
  search?: string;
  sortField: string;
  sortDir: "asc" | "desc";
  /** 1-indexed page number. */
  page: number;
  /** Default 50, max 100. */
  pageSize: number;
}

/** Response from loadLeadsList. */
export interface LeadsListResponse {
  rows: LeadsListRow[];
  /** Total matching rows across all stages (sum of all stageCounts values). */
  totalCount: number;
  /** Row counts per stage after applying all filters EXCEPT the stage filter. */
  stageCounts: Partial<Record<LeadStageKey, number>>;
}

/** Reply thread for a single lead, loaded lazily when the drawer opens. */
export interface LeadDetailResult {
  replies: ReplyRecord[];
}

// --- Analytics overview (Phase 6) ---------------------------------------------------------------
// InternalStatisticsPage: server returns scoped daily_stats + lead groups + entity lists.
// campaignDailyStats are NOT included — the page uses daily_stats for the default time series
// (it already has a smart fallback: uses daily_stats when no campaign filter is active). When a
// campaign filter IS applied, loadCampaignStats(campaignId) lazy-loads the campaign series.
// ClientStatisticsPage reuses loadClientDashboard (same data, single-client scope).
//
// Payload estimate for admin (48 clients, 609 campaigns, 3972 leads → ~300 groups):
//   users(lite) ~1KB + clients(lite) ~7KB + campaigns(full) ~183KB
//   + dailyStats(180d) ~413KB + leadGroups ~10-25KB ≈ ~640KB < 800KB target.

/**
 * Minimal daily-stat projection for the InternalStatisticsPage.
 * Only the 3 value fields actually rendered + report_date for filtering + client_id for scope.
 * Schedule/human-replies/ooo/negative fields are NOT rendered by the analytics page and are omitted.
 * Reduces per-row JSON from ~200 bytes to ~130 bytes (8640 rows → ~1.1MB savings over full DailyStatInput).
 */
export interface AnalyticsDailyStatInput {
  client_id: string;
  report_date: string | null;
  emails_sent: number | null;
  response_count: number | null;
  bounce_count: number | null;
}

/**
 * Lite client shape for the Analytics overview — only what InternalStatisticsPage reads.
 * Drops: external_workspace_id, external_api_key, min_daily_sent, inboxes_count, crm_config,
 * sms_phone_numbers, notification_emails, auto_ooo_enabled, linkedin_api_key, prospects_signed,
 * prospects_added, setup_info, bi_setup_done, lost_reason, notes, and audit timestamps.
 */
export interface AnalyticsClientLite {
  id: string;
  name: string;
  manager_id: string | null;
  status: string | null;
  kpi_leads: number | null;
  kpi_meetings: number | null;
  contracted_amount: number | null;
}

// --- Domains / Invoices / Blacklist (Phase 7 remaining legacy routes) ---------------------------
// Per-page focused payloads replacing the 16MB global loadSnapshot for these three routes.
// Mutations go through repository.X() directly; refresh() re-runs the loader.

/** Payload for DomainsPage — full client rows (scopeClients/scopeDomains need manager_id). */
export interface DomainsPagePayload {
  clients: ClientRecord[];
  domains: DomainRecord[];
}

/** Payload for InvoicesPage — full client rows (scopeClients/scopeInvoices need manager_id). */
export interface InvoicesPagePayload {
  clients: ClientRecord[];
  invoices: InvoiceRecord[];
}

/** Payload for BlacklistPage — no client context needed. */
export interface BlacklistPagePayload {
  emailExcludeList: EmailExcludeRecord[];
}

// --- Admin settings (Phase 7 partial) ---------------------------------------------------------------
// loadAdminSettings returns the three settings-specific tables plus full client rows for the
// ConditionRuleBuilder client-selector. users come from useShellData().usersLite (already loaded).
// All mutations go through repository.X() directly.

export interface AdminSettingsPayload {
  clients: ClientRecord[];
  conditionRules: ConditionRuleRecord[];
  columnOverrides: ColumnOverrideRecord[];
  clientCustomFields: ClientCustomFieldRecord[];
}

/**
 * Server-side lead aggregate for the analytics overview. Replaces the row-level
 * LeadMetricProjection (9 fields × 3973 rows = 1108KB) with pre-grouped counts
 * (5 fields × ~200–400 groups = ~15–25KB).
 *
 * The page only needs qualification breakdown and per-client/manager counts;
 * individual lead ids, pipeline booleans (meeting_booked / held / offer_sent / won)
 * are never read by InternalStatisticsPage. Timeframe filtering is preserved via
 * the `date` (YYYY-MM-DD) bucket — filterByTimeframe handles this format.
 */
export interface AnalyticsLeadGroup {
  client_id: string;
  campaign_id: string | null;
  qualification: string | null; // null = "unqualified"
  date: string;                 // YYYY-MM-DD (created_at date, UTC-bucketed)
  count: number;
}

// --- Analytics overview (Phase 6) ---------------------------------------------------------------
/** Complete data contract for the Internal Statistics page. */
export interface AnalyticsOverviewPayload {
  /** All accessible users (lite) — for the manager filter dropdown. */
  users: UserLite[];
  /**
   * All accessible clients — lite projection (7 fields only).
   * Full ClientRecord is NOT needed; the statistics page reads name/manager_id/status/kpis only.
   */
  clients: AnalyticsClientLite[];
  /** All accessible campaigns (full) — for campaign filter dropdown + per-campaign breakdown. */
  campaigns: CampaignRecord[];
  /**
   * 180-day daily stats per-client — minimal 5-field projection.
   * Schedule/human-replies/ooo/negative fields are not rendered by the page and are omitted.
   * When a campaign filter is applied, loadCampaignStats(campaignId) provides the campaign series.
   */
  dailyStats: AnalyticsDailyStatInput[];
  /**
   * Lead counts pre-aggregated by (client_id, campaign_id, qualification, date).
   * Replaces row-level leadProjections — ~200–400 groups instead of 3973 rows.
   * Window: same 180 days as dailyStats. Do NOT cast to LeadMetricProjection.
   */
  leadGroups: AnalyticsLeadGroup[];
}

// --- Campaigns list + stats (Phase 5) -----------------------------------------------------------
// Server handles filter/sort/pagination for the campaigns table. Stats are lazy-loaded per campaign
// (internal drawer) or all-at-once (client page). Frontend keeps getCampaignPerformance formula.

/** Sort keys matching the campaigns table columns. */
export type CampaignSortKey = "name" | "type" | "status" | "positive" | "start";

/**
 * A single row in the campaigns list. Extends CampaignRecord so the drawer can use it directly.
 * clientName is JOIN-resolved server-side.
 */
export interface CampaignListRow extends CampaignRecord {
  clientName: string;
}

/** Server-side filter / sort / pagination params for loadCampaignsList. */
export interface CampaignsListParams {
  clientId?: string;
  /** Campaign status value, or undefined for all. */
  status?: string;
  /** Free-text search over campaign name and external_id. */
  search?: string;
  sortField: CampaignSortKey;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Response from loadCampaignsList. */
export interface CampaignsListResponse {
  rows: CampaignListRow[];
  totalCount: number;
  /** Per-query DB timing in ms — included for latency diagnosis. */
  _qms?: { countMs: number; rowsMs: number };
}

/** A single row in the campaign daily stats series. */
export interface CampaignDailyStat {
  campaign_id: string;
  report_date: string;
  sent_count: number | null;
  reply_count: number | null;
  bounce_count: number | null;
  unique_open_count: number | null;
  positive_replies_count: number | null;
}

/**
 * Response from loadCampaignStats.
 * - With campaignId: 90-day series for one campaign (internal page drawer).
 * - Without campaignId: 90-day series for all accessible campaigns (client page, scoped by RLS).
 */
export interface CampaignStatsResponse {
  rows: CampaignDailyStat[];
  /** Per-query DB timing in ms — included for latency diagnosis. */
  _qms?: { statsMs: number };
}

/**
 * Static filter option lists for the leads page. Loaded once on mount via loadLeadsFilterOptions
 * and cached for the session — not re-fetched on every paginate/filter change.
 * Both lists are scoped by RLS to the caller's accessible leads.
 */
export interface LeadsFilterOptions {
  /** Distinct clients that have at least one visible lead. Sorted by name. */
  clientsLite: Array<{ id: string; name: string }>;
  /** Distinct campaigns that have at least one visible lead. Sorted by name. */
  campaignsLite: Array<{ id: string; name: string; clientId: string }>;
}
