// View contracts for the per-page data architecture (ADR-0009). One payload type per page.
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
  CampaignStatus,
  ClientCustomFieldRecord,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientSequencerRecord,
  WorkspaceSetupStep,
  ClientStatus,
  ColumnOverrideRecord,
  ConditionRuleRecord,
  DomainRecord,
  EmailAccountRecord,
  EmailAccountWarmingDailyRecord,
  LeadCustomFieldRecord,
  LeadRecord,
  ReplyRecord,
  SequencerRecord,
  MeetingStatus,
  OfferStatus,
  ClientOooRoutingRecord,
} from "./core.ts";
import type { BusinessDayConfig } from "../lib/crm/business-days.ts";
// DailyStatInput is the widened parameter accepted by createClientMetrics. Imported here for the
// dailyStats array type in ClientsOverviewPayload (no DailyStatRecord fields are added back in this
// payload — only fields actually consumed by createClientMetrics are shipped).
import type { DailyStatInput } from "../lib/client-metrics.ts";

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
    /** Clients with status = 'Active'. */
    activeClientsCount: number;
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
  /** Per-day count of distinct clients that had at least one new lead created (21d). */
  clientsWithLeads21d: Array<{ date: string; count: number }>;
  /** Per-day count of Active-status clients that had at least one email sent (21d). */
  activeClientsWithSent21d: Array<{ date: string; count: number }>;
  /** Up to 8 admins + managers with their client/campaign/lead load. Sorted by clientsCount DESC. */
  managerCapacity: Array<{
    managerId: string;
    managerName: string;
    managerRole: "admin" | "manager";
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
  /** Sequencer catalog (ADR-0012; 3 rows, no secrets). */
  sequencers: SequencerRecord[];
  /** Per-client sequencer credentials. RLS-scoped: manager-own/admin; empty for client role. */
  clientSequencers: ClientSequencerRecord[];
  /**
   * Derived OOO routing health, one row per client that has at least one ACTIVE routing rule
   * (ADR-0015). A client with no rules is absent from the array, not a zero row — "never configured"
   * and "configured and broken" are different states and the column colours them differently.
   *
   * Counts RULES, not campaigns: `bison-campaign-sync` has no removal path, so a workspace can hold
   * `ooo_followup` rows for campaigns that no longer exist at the vendor (Bent Iron PL has three).
   * Counting campaigns would score those green.
   */
  oooRoutingHealth: OooRoutingHealthRow[];
}

/**
 * One client's OOO routing health, computed server-side as a plain aggregate (the FACTS/INTERPRETATION
 * split at the top of this file: the counts are facts, the tone and the verdict are the table's).
 */
export interface OooRoutingHealthRow {
  client_id: string;
  /** Active rules — 0..3, capped by the partial unique index on (client_id, routing_key). */
  routed: number;
  /** Of those, the ones whose campaign is sending now. */
  live: number;
  /**
   * Of those, the ones whose campaign is routable but not yet sending (`draft` / `launching`).
   * Separated from `live` because it is the expected state right after provisioning and needs a
   * different person than a `stopped` campaign does. `routed - live - awaiting` is the dead count.
   */
  awaiting: number;
  /**
   * Whether the `general` fallback rule is one of them. Carried because the counts cannot express
   * coverage: `resolve_ooo_routing` falls back to `general` for every key without a rule of its own,
   * so one live `general` rule covers a client and one live `male` rule does not — and both are 1/1.
   */
  hasGeneral: boolean;
  /**
   * Of the dead rules, the ones no automation can repair — the campaign is archived at the vendor
   * (`completed` locally) and Bison exposes no way to unarchive it. The rest are merely paused
   * (`stopped` locally) and `bison-ooo-campaign-revive` switches them back on the next morning.
   * The split is the difference between "someone must act today" and "already handled".
   */
  unrecoverable: number;
  /**
   * `max(campaigns.updated_at)` over the routed campaigns — the freshness stamp. It matters because
   * `bison-campaign-sync` only walks clients with `status = 'Active'`, so a client in `Onboarding`
   * carries statuses nobody has refreshed. Null when the timestamp is unreadable.
   */
  campaigns_seen_at: string | null;
}

/**
 * What a provisioning run reported (ADR-0018). Mirrors the two n8n result contracts
 * (`setup-result.schema.json` under each workflow in automation/n8n/workflows/ops), which are the
 * source of truth for the shape.
 *
 * It carries no credential and must never grow one: the gateway derives booleans, the key stays
 * server-side (process doc, invariant 7).
 */
export interface WorkspaceSetupResult {
  /** Null on a `workspace_list` answer — there is no client in that call. */
  client_id: string | null;
  sequencer: string;
  dry_run: boolean;
  /** `workspace_list` is not a verdict: it is the answer to a listing call, which names no client. */
  state:
    | "configured"
    | "partial"
    | "missing"
    | "needs_selection"
    | "client_not_found"
    | "workspace_list"
    | "unknown";
  reason?: string;
  client_name?: string | null;
  resolved?: { workspace_id: string; name: string | null; matched_by: string } | null;
  steps?: Record<string, WorkspaceSetupStep>;
  /** Present only on needs_selection — already filtered of workspaces claimed by other clients. */
  candidates?: Array<{ workspace_id: string; name: string | null }>;
  /** False means the vendor work may have happened while the record of it did not. */
  recorded?: boolean;
  record_error?: string;
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
  /**
   * `prospects_total` (Bison's month-to-date lead count) on the most recent day in the window —
   * the same fact CS PDCA shows as "Prospects Added". Not derived from `prospects_count`, which is
   * a day-delta a single failed fetch can inflate to a whole month.
   */
  latest_prospects_count: number;

  // ── Per-channel lead splits (leads.sequencer_id, ADR-0012) ─────────────────────────────────
  // The blended fields above stay the "Total" series. These add the EmailBison-only (…_eb) and
  // Aimfox-only (…_af) breakdowns for the metrics the manager mega-table splits. Same 5-element
  // bucket shape and window definitions as their blended counterparts — copied verbatim, which is
  // what makes `…_eb[i] + …_af[i] === <blended>[i]` hold exactly (leads.sequencer_id is NOT NULL
  // and only two sequencers exist).
  /** 3-DoD (MQL|preMQL) leads by day, EmailBison sequencer only */
  threedod_total_eb: number[];
  /** 3-DoD (MQL|preMQL) leads by day, Aimfox sequencer only */
  threedod_total_af: number[];
  /** 3-DoD MQL leads by day, EmailBison only */
  threedod_sql_eb: number[];
  /** 3-DoD MQL leads by day, Aimfox only */
  threedod_sql_af: number[];
  /** WoW all-leads by week, EmailBison only */
  wow_leads_eb: number[];
  /** WoW all-leads by week, Aimfox only */
  wow_leads_af: number[];
  /** WoW MQL leads by week, EmailBison only */
  wow_sql_eb: number[];
  /** WoW MQL leads by week, Aimfox only */
  wow_sql_af: number[];
  /** MoM all-leads by month, EmailBison only */
  mom_total_eb: number[];
  /** MoM all-leads by month, Aimfox only */
  mom_total_af: number[];
  /** MoM MQL leads by month, EmailBison only */
  mom_sql_eb: number[];
  /** MoM MQL leads by month, Aimfox only */
  mom_sql_af: number[];
  /** MoM meeting_booked leads by month, EmailBison only */
  mom_meetings_eb: number[];
  /** MoM meeting_booked leads by month, Aimfox only */
  mom_meetings_af: number[];
  /** MoM won leads by month, EmailBison only */
  mom_won_eb: number[];
  /** MoM won leads by month, Aimfox only */
  mom_won_af: number[];

  // ── Aimfox (LinkedIn) daily volume / acceptance / capacity ─────────────────────────────────
  // Sourced from sequencer_daily_stats, summed across the client's enabled LinkedIn profiles.
  // A client with no Aimfox client_sequencers row has no rows here → every field is 0 / null.
  /** Aimfox invites_sent per day: [today, -1d, -2d, -3d, -4d] */
  aimfox_daily_sent: number[];
  /** Aimfox schedule_today from the latest snapshot day (mirrors DoD Schedule bucket "0") */
  aimfox_schedule_today: number;
  /** Aimfox schedule_tomorrow from the latest snapshot day (bucket "+1") */
  aimfox_schedule_tomorrow: number;
  /** Aimfox schedule_day_after from the latest snapshot day (bucket "+2") */
  aimfox_schedule_day_after: number;
  /** Latest-day SUM(invite_limit): the weekly connect-cap snapshot ("~195 per account"). null = unmeasured. */
  aimfox_invite_limit: number | null;
  /**
   * Latest-day SUM(invite_limit_remaining): invites still available today. This — NOT invite_limit —
   * is what the PDCA sheet's column S "Invitations limit" shows (cached values 8/20/8 reconcile with
   * this field, not the ~195 cap). See 20260705 migration + 04-metrics §18.4. null = unmeasured.
   */
  aimfox_invite_limit_remaining: number | null;
  /**
   * Latest-day SUM(remaining_database_size).
   * @deprecated 2026-08-19 — do not read. Derived from Aimfox `audience_size`, a fixed ceiling
   * rather than the loaded audience, so the value runs high by a large factor. Use
   * `aimfox_active_audience - aimfox_active_invites_sent` instead. Still written by n8n.
   */
  aimfox_remaining_database_size: number | null;

  // ── Aimfox ACTIVE-campaign rollup ──────────────────────────────────────────────────────────
  // Sourced from `campaigns` (status='active', sequencer=aimfox), written by aimfox-campaign-sync
  // (identity, audience) and aimfox-daily-metrics (the metrics). These are facts of a campaign,
  // cumulative over its life — not per-day counters, and not comparable to the daily fields above.
  /** How many ACTIVE Aimfox campaigns the client has. 0 → the three fields below mean nothing. */
  aimfox_active_campaigns: number;
  /** SUM(campaigns.database_size) = the loaded audience across active campaigns. */
  aimfox_active_audience: number;
  /** SUM(campaigns.invites_sent), cumulative per campaign. null = never measured. */
  aimfox_active_invites_sent: number | null;
  /** SUM(campaigns.invites_accepted), cumulative per campaign. null = never measured. */
  aimfox_active_invites_accepted: number | null;
  /** How many active campaigns run a message sequence (message_steps > 0). 0 → invitations only. */
  aimfox_active_with_messages: number;
  /**
   * How many active campaigns have `message_steps` measured at all. 0 means "we have not looked",
   * which is NOT the same as "no messages" — without it a never-synced client would read as
   * invitations-only rather than unknown.
   */
  aimfox_active_measured: number;
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
  /** Include archived leads (soft-deleted). Default false — archived rows are hidden everywhere. */
  includeArchived?: boolean;
}

/** Response from loadLeadsList. */
export interface LeadsListResponse {
  rows: LeadsListRow[];
  /** Total matching rows across all stages (sum of all stageCounts values). */
  totalCount: number;
  /** Row counts per stage after applying all filters EXCEPT the stage filter. */
  stageCounts: Partial<Record<LeadStageKey, number>>;
  /** Custom column definitions for the clients owning the returned rows (Batch 4, Task 4F). */
  customFields: LeadCustomFieldRecord[];
  /** Custom values for the returned rows only (compact: lead_id + field_id + value). */
  customValues: Array<{ lead_id: string; field_id: string; value: string | null }>;
}

/** Reply thread for a single lead, loaded lazily when the drawer opens. */
export interface LeadDetailResult {
  replies: ReplyRecord[];
}

// --- Lead CRM view read-model (ADR-0013) ------------------------------------------------------
// Flat projection: one row per lead + the current child records the CRM columns render. Health
// colours + resolved status are FORMULAS the client computes (lib/crm/*), fed the server `asOf`.

/** Displayed intro/summary meeting projection (internal-only fields nulled for the client role). */
export interface LeadCrmMeeting {
  status: MeetingStatus | null;
  scheduled_at: string | null;
  held_at: string | null;
  call_script: string | null;
  transcription_url: string | null;
  pre_meeting_insights: string | null;
  process_score: number | null;
  conversion_insights: string | null;
}
export interface LeadCrmOffer {
  status: OfferStatus | null;
  contracted_send_date: string | null;
}
export interface LeadCrmValueDelivery {
  planned_date: string | null;
  value_items: string[];
  sent_at: string | null;
}

/** Open (planned/in_progress) task, ordered as the "next steps" list (spec col Y). */
export interface LeadCrmOpenTask {
  id: string;
  title: string;
  due_at: string | null;
  status: "planned" | "in_progress";
  position: number;
}

/** One flattened CRM row. Extends the leads-list row (LeadRecord + join fields) with child data. */
export interface LeadCrmRow extends LeadsListRow {
  intro_meeting: LeadCrmMeeting | null;
  summary_meeting: LeadCrmMeeting | null;
  /** Latest non-cancelled offer. */
  current_offer: LeadCrmOffer | null;
  /**
   * Open tasks, ordered (due_at asc nulls last, position, created_at) — the spec col Y "next steps
   * list". `next_task_due_at` / `open_tasks_count` are derived from this in the gateway for the health
   * evaluator; the list itself is what col Y renders.
   */
  open_tasks: LeadCrmOpenTask[];
  /** Earliest open task's due date (contracted next-step date, col X). */
  next_task_due_at: string | null;
  /** Count of open (planned/in_progress) tasks. */
  open_tasks_count: number;
  value_delivery_1: LeadCrmValueDelivery | null;
  value_delivery_2: LeadCrmValueDelivery | null;
  /**
   * Whether the owning client's LinkedIn (Aimfox) integration is connected — an Aimfox
   * `client_sequencers` credential with an api_key. Drives col I: na when disconnected, so a customer
   * without LinkedIn automation is never shown a false "invite overdue" (spec item 5).
   */
  linkedin_integration_connected: boolean;
}

export interface LeadCrmListResponse {
  rows: LeadCrmRow[];
  totalCount: number;
  stageCounts: Partial<Record<LeadStageKey, number>>;
  customFields: LeadCustomFieldRecord[];
  customValues: Array<{ lead_id: string; field_id: string; value: string | null }>;
  /** Authoritative server clock — feed to the health evaluator so deadlines are deterministic. */
  asOf: string;
  /** Working-day config the health deadlines are evaluated against (ADR-0013). */
  businessDays: BusinessDayConfig;
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
 * Drops: min_daily_sent, inboxes_count, sms_phone_numbers, notification_emails,
 * auto_ooo_enabled, prospects_signed, prospects_added, setup_info, bi_setup_done, lost_reason,
 * notes, and audit timestamps. (Sequencer credentials live in client_sequencers — ADR-0012.)
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

/** Payload for DomainsPage — full client rows (scopeClients/scopeDomains need manager_id).
 *  emailAccounts powers the per-domain mailbox panel in the detail view. */
export interface DomainsPagePayload {
  clients: ClientRecord[];
  domains: DomainRecord[];
  emailAccounts: EmailAccountRecord[];
}

/** Payload for EmailAccountsPage — clients + domains for scoping/labels, plus the mailboxes. */
export interface EmailAccountsPagePayload {
  clients: ClientRecord[];
  domains: DomainRecord[];
  emailAccounts: EmailAccountRecord[];
}

/** Lazily-loaded per-mailbox warming history for the trend chart (metric_date asc). */
export type EmailAccountWarmingPayload = EmailAccountWarmingDailyRecord[];

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
  /** Include archived campaigns (soft-deleted). Default false. */
  includeArchived?: boolean;
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

/**
 * Per-user preferences for one table (column widths, filters, sort). Personal to the
 * caller — the gateway keys the row on the JWT subject, so no user id crosses the wire.
 * `preferences` is opaque jsonb: the UI owns its shape and must tolerate a stale or
 * unknown key rather than break the page.
 */
export interface TablePreferencesPayload {
  tableKey: string;
  /** null when the user has never saved preferences for this table. */
  preferences: Record<string, unknown> | null;
  updatedAt: string | null;
}

// --- OOO routing configuration (ADR-0015) -----------------------------------------------------

/**
 * OOO routing configuration for one client (spec §11, BL-2). Returned by the read action AND by both
 * mutations, so the drawer re-renders from one round-trip instead of refetching.
 *
 * `recoveredFollowups` reports how many episodes the change brought back from
 * `skipped/routing_missing` to `pending`. Surfacing it matters: the operator's mental model is "I
 * fixed the config", and the number tells them whether that actually unblocked anything.
 */
export interface ClientOooRoutingPagePayload {
  clientId: string;
  routes: ClientOooRoutingRecord[];
  /**
   * `campaigns.type = 'ooo_followup'` for this client — the only valid routing targets.
   *
   * `status` rides along because a routing rule pointing at a campaign that is not `active` is the
   * agency's most common OOO failure and is invisible from the name alone: 22 of the 25 active
   * rules in production on 2026-08-19 pointed at a `completed` or `stopped` campaign, and every one
   * of them read as correctly configured. The editor renders it; nothing routes on it.
   */
  campaigns: Array<{ id: string; name: string; status: CampaignStatus }>;
  /** `null` on a plain read; a count on a mutation. */
  recoveredFollowups: number | null;
}
