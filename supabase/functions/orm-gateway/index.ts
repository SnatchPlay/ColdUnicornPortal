import { and, asc, desc, eq, gte, sql } from "npm:drizzle-orm@0.45.2";
import { inArray } from "npm:drizzle-orm@0.45.2";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
import postgres from "npm:postgres@3.4.9";
import * as schema from "../../drizzle/schema.ts";
import { extractBearerToken, parseJwtClaims, resolvePassthroughRole } from "./rls-context.ts";
import {
  parseOrmGatewayRequest,
  type OrmGatewayEnvelope,
  type OrmGatewayRequest,
} from "../../../src/app/data/orm-gateway-contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90;
const DAILY_STATS_WINDOW_DAYS = 180;
const REPLIES_WINDOW_DAYS = 180;
const REPLIES_LIMIT = 5_000;
const databaseUrl = Deno.env.get("DATABASE_URL")?.trim() ?? Deno.env.get("SUPABASE_DB_URL")?.trim() ?? "";
const pgClient = databaseUrl
  ? postgres(databaseUrl, {
      prepare: false,
      ssl: "require",
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;
const db = pgClient ? drizzle(pgClient, { schema }) : null;

interface JwtClaims {
  sub?: string;
  role?: string;
  [key: string]: unknown;
}

interface GatewayError {
  status: number;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function jsonResponse<T>(status: number, body: OrmGatewayEnvelope<T>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toGatewayError(reason: unknown, fallbackStatus = 500, fallbackMessage = "ORM gateway request failed."): GatewayError {
  if (isRecord(reason)) {
    const message = typeof reason.message === "string" ? reason.message : fallbackMessage;
    const code = typeof reason.code === "string" ? reason.code : undefined;
    const details = typeof reason.details === "string" ? reason.details : undefined;
    const hint = typeof reason.hint === "string" ? reason.hint : undefined;
    const status = typeof reason.status === "number" ? reason.status : fallbackStatus;
    return {
      status,
      message,
      code,
      details,
      hint,
    };
  }

  if (reason instanceof Error) {
    return {
      status: fallbackStatus,
      message: reason.message || fallbackMessage,
    };
  }

  return {
    status: fallbackStatus,
    message: fallbackMessage,
  };
}

function fail(status: number, message: string, extras?: Partial<GatewayError>): never {
  throw {
    status,
    message,
    code: extras?.code,
    details: extras?.details,
    hint: extras?.hint,
  };
}

function normalizeNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function toUserRecord(row: typeof schema.users.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    role: row.role,
  };
}

function toClientRecord(row: typeof schema.clients.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    name: row.name,
    manager_id: row.managerId,
    kpi_leads: row.kpiLeads,
    kpi_meetings: row.kpiMeetings,
    contracted_amount: normalizeNumeric(row.contractedAmount),
    contract_due_date: row.contractDueDate,
    external_workspace_id: row.externalWorkspaceId,
    status: row.status,
    external_api_key: row.externalApiKey,
    min_daily_sent: row.minDailySent,
    inboxes_count: row.inboxesCount,
    crm_config: row.crmConfig,
    sms_phone_numbers: row.smsPhoneNumbers,
    notification_emails: row.notificationEmails,
    auto_ooo_enabled: row.autoOooEnabled,
    linkedin_api_key: row.linkedinApiKey,
    prospects_signed: row.prospectsSigned,
    prospects_added: row.prospectsAdded,
    setup_info: row.setupInfo,
    bi_setup_done: row.biSetupDone,
    lost_reason: row.lostReason,
    notes: row.notes,
  };
}

function toClientUserRecord(row: typeof schema.clientUsers.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    client_id: row.clientId,
    user_id: row.userId,
  };
}

function toCampaignRecord(row: typeof schema.campaigns.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    client_id: row.clientId,
    external_id: row.externalId,
    type: row.type,
    name: row.name,
    status: row.status,
    database_size: row.databaseSize,
    positive_responses: row.positiveResponses,
    start_date: row.startDate,
    gender_target: row.genderTarget,
  };
}

function toLeadRecord(row: typeof schema.leads.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    client_id: row.clientId,
    campaign_id: row.campaignId,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    job_title: row.jobTitle,
    company_name: row.companyName,
    linkedin_url: row.linkedinUrl,
    gender: row.gender,
    qualification: row.qualification,
    expected_return_date: row.expectedReturnDate,
    external_id: row.externalId,
    phone_number: row.phoneNumber,
    phone_source: row.phoneSource,
    industry: row.industry,
    headcount_range: row.headcountRange,
    website: row.website,
    country: row.country,
    message_title: row.messageTitle,
    message_number: row.messageNumber,
    response_time_hours: normalizeNumeric(row.responseTimeHours),
    response_time_label: row.responseTimeLabel,
    meeting_booked: row.meetingBooked,
    meeting_held: row.meetingHeld,
    offer_sent: row.offerSent,
    won: row.won,
    added_to_ooo_campaign: row.addedToOooCampaign,
    external_blacklist_id: row.externalBlacklistId,
    external_domain_blacklist_id: row.externalDomainBlacklistId,
    source: row.source,
    reply_text: row.replyText,
    comments: row.comments,
  };
}

function toReplyRecord(row: typeof schema.replies.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    lead_id: row.leadId,
    external_id: row.externalId,
    sequence_step: row.sequenceStep,
    message_subject: row.messageSubject,
    message_text: row.messageText,
    received_at: row.receivedAt,
    client_id: row.clientId,
    from_email_address: row.fromEmailAddress,
    is_automated_reply: row.isAutomatedReply,
    classification: row.classification,
    short_reason: row.shortReason,
    language_detected: row.languageDetected,
    is_forwarded: row.isForwarded,
  };
}

// Snapshot DTO — fields trimmed to what the frontend reads. Dropped from the
// wire payload (unused in production source as of payload audit, see
// CampaignDailyStatRecord in src/app/types/core.ts):
//   id, createdAt, inboxesActive
function toCampaignDailyStatRecord(row: typeof schema.campaignDailyStats.$inferSelect) {
  return {
    campaign_id: row.campaignId,
    report_date: row.reportDate,
    sent_count: row.sentCount,
    reply_count: row.replyCount,
    bounce_count: row.bounceCount,
    unique_open_count: row.uniqueOpenCount,
    positive_replies_count: row.positiveRepliesCount,
  };
}

// Snapshot DTO — fields trimmed to what the frontend reads. Dropped from the
// wire payload (unused in production source as of payload audit, see
// DailyStatRecord in src/app/types/core.ts):
//   id, createdAt, meCount, wonCount, prospectsInBase, inboxesCount,
//   weekNumber, monthNumber, year
function toDailyStatRecord(row: typeof schema.dailyStats.$inferSelect) {
  return {
    client_id: row.clientId,
    report_date: row.reportDate,
    emails_sent: row.emailsSent,
    mql_count: row.mqlCount,
    response_count: row.responseCount,
    bounce_count: row.bounceCount,
    negative_count: row.negativeCount,
    ooo_count: row.oooCount,
    human_replies_count: row.humanRepliesCount,
    prospects_count: row.prospectsCount,
    schedule_today: row.scheduleToday,
    schedule_tomorrow: row.scheduleTomorrow,
    schedule_day_after: row.scheduleDayAfter,
  };
}

function toDomainRecord(row: typeof schema.domains.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    client_id: row.clientId,
    domain_name: row.domainName,
    setup_email: row.setupEmail,
    purchase_date: row.purchaseDate,
    exchange_date: row.exchangeDate,
    updated_at: row.updatedAt,
    status: row.status,
    reputation: row.reputation,
    exchange_cost: normalizeNumeric(row.exchangeCost),
    campaign_verified_at: row.campaignVerifiedAt,
    warmup_verified_at: row.warmupVerifiedAt,
  };
}

function toInvoiceRecord(row: typeof schema.invoices.$inferSelect) {
  return {
    id: row.id,
    created_at: row.createdAt,
    client_id: row.clientId,
    issue_date: row.issueDate,
    amount: normalizeNumeric(row.amount) ?? 0,
    status: row.status,
    updated_at: row.updatedAt,
  };
}

function toEmailExcludeRecord(row: typeof schema.emailExcludeList.$inferSelect) {
  return {
    domain: row.domain,
    created_at: row.createdAt,
  };
}

function toConditionRuleRecord(row: typeof schema.conditionRules.$inferSelect) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    target_entity: row.targetEntity,
    surface: row.surface,
    metric_key: row.metricKey,
    source_sheet: row.sourceSheet,
    source_range: row.sourceRange,
    scope_type: row.scopeType,
    client_id: row.clientId,
    manager_id: row.managerId,
    apply_to: row.applyTo,
    column_key: row.columnKey,
    branches: row.branches,
    base_filter: row.baseFilter,
    priority: row.priority,
    enabled: row.enabled,
    notes: row.notes,
    created_by: row.createdBy,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapClientPatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  if ("name" in patch) mapped.name = patch.name;
  if ("manager_id" in patch) mapped.managerId = patch.manager_id;
  if ("kpi_leads" in patch) mapped.kpiLeads = patch.kpi_leads;
  if ("kpi_meetings" in patch) mapped.kpiMeetings = patch.kpi_meetings;
  if ("contracted_amount" in patch) mapped.contractedAmount = patch.contracted_amount;
  if ("contract_due_date" in patch) mapped.contractDueDate = patch.contract_due_date;
  if ("external_workspace_id" in patch) mapped.externalWorkspaceId = patch.external_workspace_id;
  if ("status" in patch) mapped.status = patch.status;
  if ("external_api_key" in patch) mapped.externalApiKey = patch.external_api_key;
  if ("min_daily_sent" in patch) mapped.minDailySent = patch.min_daily_sent;
  if ("inboxes_count" in patch) mapped.inboxesCount = patch.inboxes_count;
  if ("crm_config" in patch) mapped.crmConfig = patch.crm_config;
  if ("sms_phone_numbers" in patch) mapped.smsPhoneNumbers = patch.sms_phone_numbers;
  if ("notification_emails" in patch) mapped.notificationEmails = patch.notification_emails;
  if ("auto_ooo_enabled" in patch) mapped.autoOooEnabled = patch.auto_ooo_enabled;
  if ("linkedin_api_key" in patch) mapped.linkedinApiKey = patch.linkedin_api_key;
  if ("prospects_signed" in patch) mapped.prospectsSigned = patch.prospects_signed;
  if ("prospects_added" in patch) mapped.prospectsAdded = patch.prospects_added;
  if ("setup_info" in patch) mapped.setupInfo = patch.setup_info;
  if ("bi_setup_done" in patch) mapped.biSetupDone = patch.bi_setup_done;
  if ("lost_reason" in patch) mapped.lostReason = patch.lost_reason;
  if ("notes" in patch) mapped.notes = patch.notes;
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapCampaignPatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  if ("name" in patch) mapped.name = patch.name;
  if ("status" in patch) mapped.status = patch.status;
  if ("database_size" in patch) mapped.databaseSize = patch.database_size;
  if ("positive_responses" in patch) mapped.positiveResponses = patch.positive_responses;
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapLeadPatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  // Pipeline state (ADR-0004 original)
  if ("qualification" in patch) mapped.qualification = patch.qualification;
  if ("meeting_booked" in patch) mapped.meetingBooked = patch.meeting_booked;
  if ("meeting_held" in patch) mapped.meetingHeld = patch.meeting_held;
  if ("offer_sent" in patch) mapped.offerSent = patch.offer_sent;
  if ("won" in patch) mapped.won = patch.won;
  if ("comments" in patch) mapped.comments = patch.comments;
  // Identity (ADR-0004 v2: manager/admin may correct enriched data)
  if ("email" in patch) mapped.email = patch.email;
  if ("first_name" in patch) mapped.firstName = patch.first_name;
  if ("last_name" in patch) mapped.lastName = patch.last_name;
  if ("job_title" in patch) mapped.jobTitle = patch.job_title;
  if ("company_name" in patch) mapped.companyName = patch.company_name;
  if ("linkedin_url" in patch) mapped.linkedinUrl = patch.linkedin_url;
  if ("phone_number" in patch) mapped.phoneNumber = patch.phone_number;
  if ("phone_source" in patch) mapped.phoneSource = patch.phone_source;
  if ("gender" in patch) mapped.gender = patch.gender;
  // Firmographics
  if ("country" in patch) mapped.country = patch.country;
  if ("industry" in patch) mapped.industry = patch.industry;
  if ("headcount_range" in patch) mapped.headcountRange = patch.headcount_range;
  if ("website" in patch) mapped.website = patch.website;
  // OOO state
  if ("expected_return_date" in patch) mapped.expectedReturnDate = patch.expected_return_date;
  if ("added_to_ooo_campaign" in patch) mapped.addedToOooCampaign = patch.added_to_ooo_campaign;
  // Bookkeeping
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapDomainPatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  if ("status" in patch) mapped.status = patch.status;
  if ("reputation" in patch) mapped.reputation = patch.reputation;
  if ("exchange_cost" in patch) mapped.exchangeCost = patch.exchange_cost;
  if ("campaign_verified_at" in patch) mapped.campaignVerifiedAt = patch.campaign_verified_at;
  if ("warmup_verified_at" in patch) mapped.warmupVerifiedAt = patch.warmup_verified_at;
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapInvoicePatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  if ("issue_date" in patch) mapped.issueDate = patch.issue_date;
  if ("amount" in patch) mapped.amount = patch.amount;
  if ("status" in patch) mapped.status = patch.status;
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapConditionRulePatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  if ("key" in patch) mapped.key = patch.key;
  if ("name" in patch) mapped.name = patch.name;
  if ("description" in patch) mapped.description = patch.description;
  if ("target_entity" in patch) mapped.targetEntity = patch.target_entity;
  if ("surface" in patch) mapped.surface = patch.surface;
  if ("metric_key" in patch) mapped.metricKey = patch.metric_key;
  if ("source_sheet" in patch) mapped.sourceSheet = patch.source_sheet;
  if ("source_range" in patch) mapped.sourceRange = patch.source_range;
  if ("scope_type" in patch) mapped.scopeType = patch.scope_type;
  if ("client_id" in patch) mapped.clientId = patch.client_id;
  if ("manager_id" in patch) mapped.managerId = patch.manager_id;
  if ("apply_to" in patch) mapped.applyTo = patch.apply_to;
  if ("column_key" in patch) mapped.columnKey = patch.column_key;
  if ("branches" in patch) mapped.branches = patch.branches;
  if ("base_filter" in patch) mapped.baseFilter = patch.base_filter;
  if ("priority" in patch) mapped.priority = patch.priority;
  if ("enabled" in patch) mapped.enabled = patch.enabled;
  if ("notes" in patch) mapped.notes = patch.notes;
  if ("created_by" in patch) mapped.createdBy = patch.created_by;
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

function mapClientInsert(input: Record<string, unknown>) {
  return {
    name: input.name,
    managerId: input.manager_id,
    status: input.status,
    kpiLeads: input.kpi_leads ?? null,
    kpiMeetings: input.kpi_meetings ?? null,
    contractedAmount: input.contracted_amount ?? null,
    contractDueDate: input.contract_due_date ?? null,
    externalWorkspaceId: input.external_workspace_id ?? null,
    externalApiKey: input.external_api_key ?? null,
    minDailySent: input.min_daily_sent ?? 0,
    inboxesCount: input.inboxes_count ?? 0,
    crmConfig: input.crm_config ?? null,
    smsPhoneNumbers: input.sms_phone_numbers ?? null,
    notificationEmails: input.notification_emails ?? null,
    autoOooEnabled: input.auto_ooo_enabled ?? false,
    linkedinApiKey: input.linkedin_api_key ?? null,
    prospectsSigned: input.prospects_signed ?? 0,
    prospectsAdded: input.prospects_added ?? 0,
    setupInfo: input.setup_info ?? null,
    biSetupDone: input.bi_setup_done ?? false,
    lostReason: input.lost_reason ?? null,
    notes: input.notes ?? null,
  };
}

function mapCampaignInsert(input: Record<string, unknown>) {
  return {
    clientId: input.client_id,
    externalId: input.external_id,
    type: input.type,
    name: input.name,
    status: input.status,
    databaseSize: input.database_size ?? null,
    positiveResponses: input.positive_responses ?? 0,
    startDate: input.start_date ?? null,
    genderTarget: input.gender_target ?? null,
  };
}

function mapLeadInsert(input: Record<string, unknown>) {
  return {
    clientId: input.client_id,
    campaignId: input.campaign_id ?? null,
    email: input.email ?? null,
    firstName: input.first_name ?? null,
    lastName: input.last_name ?? null,
    jobTitle: input.job_title ?? null,
    companyName: input.company_name ?? null,
    linkedinUrl: input.linkedin_url ?? null,
    gender: input.gender ?? null,
    qualification: input.qualification ?? null,
    externalId: input.external_id ?? null,
    phoneNumber: input.phone_number ?? null,
    industry: input.industry ?? null,
    headcountRange: input.headcount_range ?? null,
    website: input.website ?? null,
    country: input.country ?? null,
    meetingBooked: input.meeting_booked ?? false,
    meetingHeld: input.meeting_held ?? false,
    offerSent: input.offer_sent ?? false,
    won: input.won ?? false,
    addedToOooCampaign: input.added_to_ooo_campaign ?? false,
    source: input.source ?? "manual",
    comments: input.comments ?? null,
  };
}

function mapDomainInsert(input: Record<string, unknown>) {
  return {
    clientId: input.client_id,
    domainName: input.domain_name,
    setupEmail: input.setup_email,
    purchaseDate: input.purchase_date,
    exchangeDate: input.exchange_date,
    status: input.status ?? null,
    reputation: input.reputation ?? null,
    exchangeCost: input.exchange_cost ?? null,
    campaignVerifiedAt: input.campaign_verified_at ?? null,
    warmupVerifiedAt: input.warmup_verified_at ?? null,
  };
}

function mapConditionRuleInsert(input: Record<string, unknown>) {
  return {
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    targetEntity: input.target_entity,
    surface: input.surface,
    metricKey: input.metric_key,
    sourceSheet: input.source_sheet ?? null,
    sourceRange: input.source_range ?? null,
    scopeType: input.scope_type,
    clientId: input.client_id ?? null,
    managerId: input.manager_id ?? null,
    applyTo: input.apply_to,
    columnKey: input.column_key ?? null,
    branches: input.branches,
    baseFilter: input.base_filter ?? null,
    priority: input.priority,
    enabled: input.enabled,
    notes: input.notes ?? null,
    createdBy: input.created_by ?? null,
  };
}

// Raw-SQL helpers for tables not yet introspected into drizzle/schema.ts.
// Phase 3 tables: client_table_column_overrides, client_custom_fields,
// client_custom_field_values. Returns rows mapped to the client-side
// snake_case TS record shape.

function toColumnOverrideRecord(row: Record<string, unknown>) {
  return {
    column_key: String(row.column_key),
    label_override: row.label_override === null ? null : (row.label_override as string),
    hidden: Boolean(row.hidden),
    position:
      row.position === null || row.position === undefined
        ? null
        : Number(row.position),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ""),
    updated_by: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
  };
}

function toClientCustomFieldRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    field_type: String(row.field_type) as "text" | "checkbox" | "droplist",
    options: row.options === null || row.options === undefined ? null : (row.options as string[]),
    position: Number(row.position ?? 0),
    editable_by: Array.isArray(row.editable_by) ? (row.editable_by as string[]) : ["master_admin"],
    created_by: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
  };
}

function toClientCustomFieldValueRecord(row: Record<string, unknown>) {
  return {
    client_id: String(row.client_id),
    field_id: String(row.field_id),
    value: row.value === null || row.value === undefined ? null : String(row.value),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ""),
    updated_by: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
  };
}

async function safeRawSelect(tx: any, query: any): Promise<any[]> {
  // Returns [] if the underlying table does not exist yet (migration not applied),
  // so the snapshot endpoint never hard-fails for new admins running against an
  // older schema.
  try {
    const result = await tx.execute(query);
    return Array.isArray(result) ? result : result.rows ?? [];
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/does not exist|undefined_table|42P01/i.test(message)) {
      console.warn(`[orm-gateway] customization table not present yet: ${message}`);
      return [];
    }
    throw reason;
  }
}

async function executeAsCaller(request: Request, operation: (tx: any) => Promise<unknown>) {
  if (!db) fail(500, "ORM gateway is missing DATABASE_URL.");

  let claims: JwtClaims;
  try {
    const token = extractBearerToken(request);
    claims = parseJwtClaims(token) as JwtClaims;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Missing bearer token.";
    fail(401, message);
  }

  const claimsJson = JSON.stringify(claims);
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const role = resolvePassthroughRole(claims.role);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT
        set_config('request.jwt.claims', ${claimsJson}, true),
        set_config('request.jwt.claim.sub', ${sub}, true),
        set_config('request.jwt.claim.role', ${role}, true)`,
    );
    await tx.execute(sql.raw(`set local role ${role}`));
    return operation(tx);
  });
}

function classifyAuthErrorCode(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("denied") ||
    normalized.includes("policy") ||
    normalized.includes("42501")
  ) {
    return "permission" as const;
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("503") ||
    normalized.includes("502") ||
    normalized.includes("504")
  ) {
    return "network" as const;
  }
  return "unknown" as const;
}

// [TEMP PERF] wrap a query promise to log its row count and resolution time.
// Resolution time approximates DB time when queries are kicked off in Promise.all.
function timedQuery<T>(name: string, promise: Promise<T[]>): Promise<T[]> {
  const t0 = performance.now();
  return promise.then((rows) => {
    const dur = performance.now() - t0;
    console.log(`[TEMP PERF][orm-gateway] ${name}: ${dur.toFixed(1)}ms, ${rows.length} rows`);
    return rows;
  });
}
// [TEMP PERF] /end

async function handleAction(tx: any, payload: OrmGatewayRequest) {
  if (payload.action === "loadSnapshot") {
    const includeDailyStats = payload.includeDailyStats ?? true;
    const leadsLimit = payload.leadsLimit;
    // [TEMP PERF] mark start of loadSnapshot handler (after RLS context is set)
    const tHandlerStart = performance.now();
    console.log(`[TEMP PERF][orm-gateway] loadSnapshot start (includeDailyStats=${includeDailyStats}, leadsLimit=${leadsLimit ?? "unbounded"})`);
    // [TEMP PERF] /end

    const campaignStatsSince = isoDaysAgo(CAMPAIGN_DAILY_STATS_WINDOW_DAYS);
    const dailyStatsSince = isoDaysAgo(DAILY_STATS_WINDOW_DAYS);

    const usersQuery = tx.select().from(schema.users).orderBy(desc(schema.users.createdAt));
    const clientsQuery = tx.select().from(schema.clients).orderBy(desc(schema.clients.createdAt));
    const clientUsersQuery = tx.select().from(schema.clientUsers).orderBy(desc(schema.clientUsers.createdAt));
    const campaignsQuery = tx.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt));

    let leadsQuery = tx.select().from(schema.leads).orderBy(desc(schema.leads.updatedAt));
    if (typeof leadsLimit === "number") {
      leadsQuery = leadsQuery.limit(Math.max(1, Math.trunc(leadsLimit)));
    }

    const repliesQuery = tx
      .select()
      .from(schema.replies)
      .where(gte(schema.replies.receivedAt, isoDaysAgo(REPLIES_WINDOW_DAYS)))
      .orderBy(desc(schema.replies.receivedAt))
      .limit(REPLIES_LIMIT);
    const campaignStatsQuery = tx
      .select()
      .from(schema.campaignDailyStats)
      .where(gte(schema.campaignDailyStats.reportDate, campaignStatsSince))
      .orderBy(desc(schema.campaignDailyStats.reportDate));

    const dailyStatsQuery = includeDailyStats
      ? tx
          .select()
          .from(schema.dailyStats)
          .where(gte(schema.dailyStats.reportDate, dailyStatsSince))
          .orderBy(desc(schema.dailyStats.reportDate))
      : Promise.resolve([]);

    const domainsQuery = tx.select().from(schema.domains).orderBy(desc(schema.domains.updatedAt));
    const invoicesQuery = tx.select().from(schema.invoices).orderBy(desc(schema.invoices.issueDate));
    const emailExcludeQuery = tx.select().from(schema.emailExcludeList).orderBy(desc(schema.emailExcludeList.createdAt));

    const columnOverridesQuery = safeRawSelect(
      tx,
      sql`select column_key, label_override, hidden, position, updated_at, updated_by from public.client_table_column_overrides`,
    );
    const clientCustomFieldsQuery = safeRawSelect(
      tx,
      sql`select id, name, field_type, options, position, editable_by, created_by, created_at
          from public.client_custom_fields
          order by position asc, created_at asc`,
    );
    const clientCustomFieldValuesQuery = safeRawSelect(
      tx,
      sql`select client_id, field_id, value, updated_at, updated_by from public.client_custom_field_values`,
    );

    const [users, clients, clientUsers, campaigns, leads, replies, campaignDailyStats, dailyStats, domains, invoices, emailExcludeList, columnOverrides, clientCustomFields, clientCustomFieldValues] =
      // [TEMP PERF] wrap each query for per-table duration + row count
      await Promise.all([
        timedQuery("users", usersQuery),
        timedQuery("clients", clientsQuery),
        timedQuery("clientUsers", clientUsersQuery),
        timedQuery("campaigns", campaignsQuery),
        timedQuery("leads", leadsQuery),
        timedQuery("replies", repliesQuery),
        timedQuery("campaignDailyStats", campaignStatsQuery),
        timedQuery("dailyStats", dailyStatsQuery as Promise<any[]>),
        timedQuery("domains", domainsQuery),
        timedQuery("invoices", invoicesQuery),
        timedQuery("emailExcludeList", emailExcludeQuery),
        timedQuery("columnOverrides", columnOverridesQuery),
        timedQuery("clientCustomFields", clientCustomFieldsQuery),
        timedQuery("clientCustomFieldValues", clientCustomFieldValuesQuery),
      ]);
      // [TEMP PERF] /end

    const usersById = new Map(users.map((user) => [user.id, user] as const));
    const missingManagerIds = Array.from(
      new Set(
        clients
          .map((client) => client.managerId)
          .filter((managerId): managerId is string => Boolean(managerId) && !usersById.has(managerId)),
      ),
    );
    if (missingManagerIds.length > 0) {
      const managerRows = await timedQuery(
        "managerUsersFallback",
        tx.select().from(schema.users).where(inArray(schema.users.id, missingManagerIds)),
      );
      for (const manager of managerRows) {
        usersById.set(manager.id, manager);
      }
    }
    const snapshotUsers = Array.from(usersById.values());

    // [TEMP PERF] log total handler duration (excludes auth + RLS setup)
    console.log(`[TEMP PERF][orm-gateway] loadSnapshot handler total: ${(performance.now() - tHandlerStart).toFixed(1)}ms`);
    // [TEMP PERF] /end

    return {
      users: snapshotUsers.map(toUserRecord),
      clients: clients.map(toClientRecord),
      clientUsers: clientUsers.map(toClientUserRecord),
      campaigns: campaigns.map(toCampaignRecord),
      leads: leads.map(toLeadRecord),
      replies: replies.map(toReplyRecord),
      campaignDailyStats: campaignDailyStats.map(toCampaignDailyStatRecord),
      dailyStats: (dailyStats as Array<typeof schema.dailyStats.$inferSelect>).map(toDailyStatRecord),
      domains: domains.map(toDomainRecord),
      invoices: invoices.map(toInvoiceRecord),
      emailExcludeList: emailExcludeList.map(toEmailExcludeRecord),
      conditionRules: [],
      columnOverrides: (columnOverrides as Record<string, unknown>[]).map(toColumnOverrideRecord),
      clientCustomFields: (clientCustomFields as Record<string, unknown>[]).map(toClientCustomFieldRecord),
      clientCustomFieldValues: (clientCustomFieldValues as Record<string, unknown>[]).map(toClientCustomFieldValueRecord),
    };
  }

  if (payload.action === "loadConditionRules") {
    const rows = await tx
      .select()
      .from(schema.conditionRules)
      .orderBy(asc(schema.conditionRules.priority), asc(schema.conditionRules.createdAt));
    return rows.map(toConditionRuleRecord);
  }

  if (payload.action === "updateClient") {
    const patch = mapClientPatch(payload.patch as Record<string, unknown>);
    const rows = await tx.update(schema.clients).set(patch).where(eq(schema.clients.id, payload.clientId)).returning();
    if (!rows[0]) fail(404, "Client record was not found.");
    return toClientRecord(rows[0]);
  }

  if (payload.action === "updateCampaign") {
    const patch = mapCampaignPatch(payload.patch as Record<string, unknown>);
    const rows = await tx.update(schema.campaigns).set(patch).where(eq(schema.campaigns.id, payload.campaignId)).returning();
    if (!rows[0]) fail(404, "Campaign record was not found.");
    return toCampaignRecord(rows[0]);
  }

  if (payload.action === "updateLead") {
    const patch = mapLeadPatch(payload.patch as Record<string, unknown>);
    const rows = await tx.update(schema.leads).set(patch).where(eq(schema.leads.id, payload.leadId)).returning();
    if (!rows[0]) fail(404, "Lead record was not found.");
    return toLeadRecord(rows[0]);
  }

  if (payload.action === "updateDomain") {
    const patch = mapDomainPatch(payload.patch as Record<string, unknown>);
    const rows = await tx.update(schema.domains).set(patch).where(eq(schema.domains.id, payload.domainId)).returning();
    if (!rows[0]) fail(404, "Domain record was not found.");
    return toDomainRecord(rows[0]);
  }

  if (payload.action === "updateInvoice") {
    const patch = mapInvoicePatch(payload.patch as Record<string, unknown>);
    const rows = await tx.update(schema.invoices).set(patch).where(eq(schema.invoices.id, payload.invoiceId)).returning();
    if (!rows[0]) fail(404, "Invoice record was not found.");
    return toInvoiceRecord(rows[0]);
  }

  if (payload.action === "createClient") {
    const now = new Date().toISOString();
    const rows = await tx
      .insert(schema.clients)
      .values({ id: crypto.randomUUID(), ...mapClientInsert(payload.input as Record<string, unknown>), createdAt: now, updatedAt: now })
      .returning();
    if (!rows[0]) fail(500, "Client could not be created.");
    return toClientRecord(rows[0]);
  }

  if (payload.action === "createCampaign") {
    const now = new Date().toISOString();
    const rows = await tx
      .insert(schema.campaigns)
      .values({ id: crypto.randomUUID(), ...mapCampaignInsert(payload.input as Record<string, unknown>), createdAt: now, updatedAt: now })
      .returning();
    if (!rows[0]) fail(500, "Campaign could not be created.");
    return toCampaignRecord(rows[0]);
  }

  if (payload.action === "createLead") {
    const now = new Date().toISOString();
    const rows = await tx
      .insert(schema.leads)
      .values({ id: crypto.randomUUID(), ...mapLeadInsert(payload.input as Record<string, unknown>), createdAt: now, updatedAt: now })
      .returning();
    if (!rows[0]) fail(500, "Lead could not be created.");
    return toLeadRecord(rows[0]);
  }

  if (payload.action === "createDomain") {
    const now = new Date().toISOString();
    const rows = await tx
      .insert(schema.domains)
      .values({ id: crypto.randomUUID(), ...mapDomainInsert(payload.input as Record<string, unknown>), createdAt: now, updatedAt: now })
      .returning();
    if (!rows[0]) fail(500, "Domain could not be created.");
    return toDomainRecord(rows[0]);
  }

  if (payload.action === "createConditionRule") {
    const rows = await tx.insert(schema.conditionRules).values(mapConditionRuleInsert(payload.input as Record<string, unknown>)).returning();
    if (!rows[0]) fail(500, "Condition rule could not be created.");
    return toConditionRuleRecord(rows[0]);
  }

  if (payload.action === "updateConditionRule") {
    const patch = mapConditionRulePatch(payload.patch as Record<string, unknown>);
    const rows = await tx
      .update(schema.conditionRules)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(schema.conditionRules.id, payload.ruleId))
      .returning();
    if (!rows[0]) fail(404, "Condition rule was not found.");
    return toConditionRuleRecord(rows[0]);
  }

  if (payload.action === "deleteConditionRule") {
    await tx.delete(schema.conditionRules).where(eq(schema.conditionRules.id, payload.ruleId));
    return { ok: true };
  }

  if (payload.action === "upsertClientUserMapping") {
    const rows = await tx
      .insert(schema.clientUsers)
      .values({ userId: payload.userId, clientId: payload.clientId })
      .onConflictDoUpdate({
        target: schema.clientUsers.userId,
        set: {
          clientId: payload.clientId,
        },
      })
      .returning();
    if (!rows[0]) fail(500, "Client mapping upsert failed.");
    return toClientUserRecord(rows[0]);
  }

  if (payload.action === "deleteClientUserMapping") {
    await tx.delete(schema.clientUsers).where(eq(schema.clientUsers.id, payload.mappingId));
    return { ok: true };
  }

  if (payload.action === "upsertEmailExcludeDomain") {
    const normalized = payload.domain.trim().toLowerCase();
    const rows = await tx
      .insert(schema.emailExcludeList)
      .values({ domain: normalized })
      .onConflictDoUpdate({
        target: schema.emailExcludeList.domain,
        set: {
          domain: normalized,
        },
      })
      .returning();
    if (!rows[0]) fail(500, "Email exclude domain upsert failed.");
    return toEmailExcludeRecord(rows[0]);
  }

  if (payload.action === "deleteEmailExcludeDomain") {
    await tx.delete(schema.emailExcludeList).where(eq(schema.emailExcludeList.domain, payload.domain.trim().toLowerCase()));
    return { ok: true };
  }

  if (payload.action === "upsertColumnOverride") {
    const patch = payload.patch ?? {};
    const labelProvided = "label_override" in patch;
    const hiddenProvided = "hidden" in patch;
    const positionProvided = "position" in patch;
    const positionValue =
      patch.position === null || patch.position === undefined
        ? null
        : Number(patch.position);
    const rows = await tx.execute(sql`
      insert into public.client_table_column_overrides (column_key, label_override, hidden, position, updated_at, updated_by)
      values (
        ${payload.columnKey},
        ${labelProvided ? patch.label_override ?? null : null},
        ${hiddenProvided ? Boolean(patch.hidden) : false},
        ${positionProvided ? positionValue : null},
        now(),
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      )
      on conflict (column_key) do update set
        label_override = case when ${labelProvided} then excluded.label_override else public.client_table_column_overrides.label_override end,
        hidden = case when ${hiddenProvided} then excluded.hidden else public.client_table_column_overrides.hidden end,
        position = case when ${positionProvided} then excluded.position else public.client_table_column_overrides.position end,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      returning column_key, label_override, hidden, position, updated_at, updated_by
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(500, "Column override upsert failed.");
    return toColumnOverrideRecord(result[0]);
  }

  if (payload.action === "setColumnOrder") {
    // Bulk-assign sequential positions to all listed column keys. One row
    // per key: insert if missing, else update the position only.
    const all: Record<string, unknown>[] = [];
    for (let i = 0; i < payload.orderedKeys.length; i++) {
      const key = payload.orderedKeys[i];
      const rows = await tx.execute(sql`
        insert into public.client_table_column_overrides (column_key, label_override, hidden, position, updated_at, updated_by)
        values (
          ${key},
          null,
          false,
          ${i},
          now(),
          nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        )
        on conflict (column_key) do update set
          position = excluded.position,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
        returning column_key, label_override, hidden, position, updated_at, updated_by
      `);
      const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
      if (result[0]) all.push(result[0]);
    }
    return all.map(toColumnOverrideRecord);
  }

  if (payload.action === "createClientCustomField") {
    const input = payload.input;
    const optionsJson = input.options ?? null;
    const editableBy = JSON.stringify(input.editable_by ?? ["master_admin"]);
    const rows = await tx.execute(sql`
      insert into public.client_custom_fields (name, field_type, options, position, editable_by, created_by)
      values (
        ${input.name},
        ${input.field_type},
        ${optionsJson === null ? null : JSON.stringify(optionsJson)}::jsonb,
        ${input.position ?? 0},
        ${editableBy}::jsonb,
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      )
      returning id, name, field_type, options, position, editable_by, created_by, created_at
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(500, "Client custom field could not be created.");
    return toClientCustomFieldRecord(result[0]);
  }

  if (payload.action === "updateClientCustomField") {
    const patch = payload.patch ?? {};
    const setName = "name" in patch;
    const setType = "field_type" in patch;
    const setOptions = "options" in patch;
    const setPosition = "position" in patch;
    const setEditableBy = "editable_by" in patch;
    const rows = await tx.execute(sql`
      update public.client_custom_fields set
        name = case when ${setName} then ${patch.name ?? null} else name end,
        field_type = case when ${setType} then ${patch.field_type ?? null} else field_type end,
        options = case when ${setOptions} then ${patch.options === undefined || patch.options === null ? null : JSON.stringify(patch.options)}::jsonb else options end,
        position = case when ${setPosition} then ${patch.position ?? 0} else position end,
        editable_by = case when ${setEditableBy} then ${patch.editable_by === undefined ? JSON.stringify(["master_admin"]) : JSON.stringify(patch.editable_by)}::jsonb else editable_by end
      where id = ${payload.fieldId}
      returning id, name, field_type, options, position, editable_by, created_by, created_at
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(404, "Client custom field was not found.");
    return toClientCustomFieldRecord(result[0]);
  }

  if (payload.action === "deleteClientCustomField") {
    await tx.execute(sql`delete from public.client_custom_fields where id = ${payload.fieldId}`);
    return { ok: true };
  }

  if (payload.action === "upsertClientCustomFieldValue") {
    const rows = await tx.execute(sql`
      insert into public.client_custom_field_values (client_id, field_id, value, updated_at, updated_by)
      values (
        ${payload.clientId},
        ${payload.fieldId},
        ${payload.value},
        now(),
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      )
      on conflict (client_id, field_id) do update set
        value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      returning client_id, field_id, value, updated_at, updated_by
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(500, "Client custom field value upsert failed.");
    return toClientCustomFieldValueRecord(result[0]);
  }

  if (payload.action === "loadIdentity") {
    try {
      const usersRows = await tx.select().from(schema.users).where(eq(schema.users.id, payload.sessionUserId)).limit(1);
      const publicUser = usersRows[0] ?? null;

      if (!publicUser) {
        return {
          identity: null,
          error: "Your account is authenticated, but the portal profile is not provisioned yet.",
          errorCode: "profile_missing",
        };
      }

      const identity = {
        id: publicUser.id,
        fullName: `${publicUser.firstName} ${publicUser.lastName}`.trim(),
        email: publicUser.email,
        role: publicUser.role,
      } as Record<string, unknown>;

      if (publicUser.role === "client") {
        const mappingRows = await tx
          .select({ clientId: schema.clientUsers.clientId })
          .from(schema.clientUsers)
          .where(eq(schema.clientUsers.userId, payload.sessionUserId))
          .limit(1);

        const clientId = mappingRows[0]?.clientId;
        if (!clientId) {
          return {
            identity,
            error: "Your client account is authenticated, but no client access mapping is assigned yet.",
            errorCode: "client_mapping_missing",
          };
        }

        return {
          identity: {
            ...identity,
            clientId,
          },
          error: null,
          errorCode: null,
        };
      }

      return {
        identity,
        error: null,
        errorCode: null,
      };
    } catch (reason) {
      const mapped = toGatewayError(reason, 500, "Identity loading failed.");
      const errorCode = classifyAuthErrorCode(mapped.message);
      return {
        identity: null,
        error:
          errorCode === "permission"
            ? "Your authenticated session does not have permission to load the workspace profile."
            : "Your account profile could not be loaded right now. Please try again.",
        errorCode,
      };
    }
  }

  if (payload.action === "updateProfileName") {
    const trimmed = payload.fullName.trim().replace(/\s+/g, " ");
    if (!trimmed) fail(400, "Enter a valid full name before saving.");

    const [firstName, ...lastNameParts] = trimmed.split(" ");
    const lastName = lastNameParts.join(" ");

    const rows = await tx
      .update(schema.users)
      .set({
        firstName,
        lastName: lastName || "",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, payload.sessionUserId))
      .returning();

    if (!rows[0]) fail(404, "User profile was not found.");

    return {
      user: toUserRecord(rows[0]),
    };
  }

  fail(400, `Unsupported action: ${payload.action}`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: {
        message: "Method not allowed.",
      },
    });
  }

  try {
    const rawPayload = await request.json().catch(() => null);
    const parsed = parseOrmGatewayRequest(rawPayload);
    if (!parsed.ok) {
      return jsonResponse(400, {
        ok: false,
        error: {
          message: parsed.error,
        },
      });
    }

    const data = await executeAsCaller(request, (tx) => handleAction(tx, parsed.value));
    return jsonResponse(200, { ok: true, data });
  } catch (reason) {
    const mapped = toGatewayError(reason);
    return jsonResponse(mapped.status, {
      ok: false,
      error: {
        message: mapped.message,
        code: mapped.code,
        details: mapped.details,
        hint: mapped.hint,
      },
    });
  }
});
