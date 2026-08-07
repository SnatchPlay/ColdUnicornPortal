import { and, asc, desc, eq, gte, ne, sql } from "npm:drizzle-orm@0.45.2";
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
import { DEFAULT_BUSINESS_DAY_CONFIG } from "../../../src/app/lib/crm/business-days.ts";
import { MEETING_STATUS_VALUES, OFFER_STATUS_VALUES, TASK_STATUS_VALUES } from "../../../src/app/types/core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90;
const DAILY_STATS_WINDOW_DAYS = 180;
const databaseUrl = Deno.env.get("DATABASE_URL")?.trim() ?? Deno.env.get("SUPABASE_DB_URL")?.trim() ?? "";
// Managed Supabase (the pooler) requires TLS; a local stack has none. Detect a local target and
// turn TLS off there — production keeps `require` because its host is the pooler.
const dbIsLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|supabase_db|db)[:/]/.test(databaseUrl) || /sslmode=disable/.test(databaseUrl);
const pgClient = databaseUrl
  ? postgres(databaseUrl, {
      prepare: false,
      ssl: dbIsLocal ? false : "require",
      max: 3,
      idle_timeout: 60,  // keep connections alive longer — cold reconnect costs ~1s
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
    // Drizzle-orm wraps the postgres.js error in `cause`; prefer that message so the
    // real Postgres error code (e.g. 42703 undefined_column) surfaces to the client.
    const causeRecord = isRecord(reason.cause) ? reason.cause : null;
    const causeMessage = causeRecord && typeof causeRecord.message === "string" ? causeRecord.message : null;
    const message = causeMessage ?? (typeof reason.message === "string" ? reason.message : fallbackMessage);
    const code = (causeRecord && typeof causeRecord.code === "string" ? causeRecord.code : null)
      ?? (typeof reason.code === "string" ? reason.code : undefined);
    const details = (causeRecord && typeof causeRecord.detail === "string" ? causeRecord.detail : null)
      ?? (typeof reason.details === "string" ? reason.details : undefined);
    const hint = (causeRecord && typeof causeRecord.hint === "string" ? causeRecord.hint : null)
      ?? (typeof reason.hint === "string" ? reason.hint : undefined);
    const status = typeof reason.status === "number" ? reason.status : fallbackStatus;
    return { status, message, code, details, hint };
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
    avatar_path: row.avatarPath ?? null,
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
    status: row.status,
    min_daily_sent: row.minDailySent,
    inboxes_count: row.inboxesCount,
    crm_config: row.crmConfig,
    sms_phone_numbers: row.smsPhoneNumbers,
    notification_emails: row.notificationEmails,
    auto_ooo_enabled: row.autoOooEnabled,
    prospects_signed: row.prospectsSigned,
    prospects_added: row.prospectsAdded,
    setup_info: row.setupInfo,
    bi_setup_done: row.biSetupDone,
    lost_reason: row.lostReason,
    notes: row.notes,
    satisfaction: row.satisfaction,
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
    sequencer_id: row.sequencerId,
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
    external_blacklist_id: row.externalBlacklistId,
    external_domain_blacklist_id: row.externalDomainBlacklistId,
    source: row.source,
    reply_text: row.replyText,
    client_note: row.clientNote,
    coldunicorn_note: row.coldunicornNote,
    highlight: row.highlight,
    // Lead CRM columns (ADR-0013). Mapped so mutation returns (updateLead/concludeLead) are authoritative.
    linkedin_invitation_sent_at: row.linkedinInvitationSentAt,
    contact_made_at: row.contactMadeAt,
    contact_method: row.contactMethod,
    negotiation_started_at: row.negotiationStartedAt,
    conclusion: row.conclusion,
    concluded_at: row.concludedAt,
    final_outcome: row.finalOutcome,
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
    updated_at: row.updatedAt,
    status: row.status,
    winnr_status: row.winnrStatus,
    dns_provider: row.dnsProvider,
    winnr_tags: row.winnrTags,
    winnr_email_user_count: row.winnrEmailUserCount,
    winnr_created_at: row.winnrCreatedAt,
    last_synced_at: row.lastSyncedAt,
    missing_since: row.missingSince,
  };
}

function toEmailAccountRecord(row: typeof schema.emailAccounts.$inferSelect) {
  return {
    id: row.id,
    domain_id: row.domainId,
    winnr_email_user_id: row.winnrEmailUserId,
    email_address: row.emailAddress,
    username: row.username,
    display_name: row.displayName,
    status: row.status,
    warming_status: row.warmingStatus,
    warming_health_score: normalizeNumeric(row.warmingHealthScore),
    warming_inbox_rate: normalizeNumeric(row.warmingInboxRate),
    warming_spam_rate: normalizeNumeric(row.warmingSpamRate),
    warming_daily_volume: row.warmingDailyVolume,
    warming_progress: normalizeNumeric(row.warmingProgress),
    winnr_created_at: row.winnrCreatedAt,
    last_seen_at: row.lastSeenAt,
    last_synced_at: row.lastSyncedAt,
    missing_since: row.missingSince,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toEmailAccountWarmingRecord(row: typeof schema.emailAccountWarmingDaily.$inferSelect) {
  return {
    email_account_id: row.emailAccountId,
    metric_date: row.metricDate,
    warming_status: row.warmingStatus,
    emails_sent: row.emailsSent,
    health_score: normalizeNumeric(row.healthScore),
    inbox_rate: normalizeNumeric(row.inboxRate),
    spam_rate: normalizeNumeric(row.spamRate),
    daily_volume: row.dailyVolume,
    warmup_progress: normalizeNumeric(row.warmupProgress),
    synced_at: row.syncedAt,
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
  if ("status" in patch) mapped.status = patch.status;
  if ("min_daily_sent" in patch) mapped.minDailySent = patch.min_daily_sent;
  if ("inboxes_count" in patch) mapped.inboxesCount = patch.inboxes_count;
  if ("crm_config" in patch) mapped.crmConfig = patch.crm_config;
  if ("sms_phone_numbers" in patch) mapped.smsPhoneNumbers = patch.sms_phone_numbers;
  if ("notification_emails" in patch) mapped.notificationEmails = patch.notification_emails;
  if ("auto_ooo_enabled" in patch) mapped.autoOooEnabled = patch.auto_ooo_enabled;
  if ("prospects_signed" in patch) mapped.prospectsSigned = patch.prospects_signed;
  if ("prospects_added" in patch) mapped.prospectsAdded = patch.prospects_added;
  if ("setup_info" in patch) mapped.setupInfo = patch.setup_info;
  if ("bi_setup_done" in patch) mapped.biSetupDone = patch.bi_setup_done;
  if ("lost_reason" in patch) mapped.lostReason = patch.lost_reason;
  if ("notes" in patch) mapped.notes = patch.notes;
  if ("satisfaction" in patch) mapped.satisfaction = patch.satisfaction;
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

/** Acceptable value for a timestamptz/date column edited via a date input: null or a `YYYY-MM-DD…`
 *  string. Guards direct-date writes so a malformed value is skipped rather than reaching Postgres. */
function isDateish(v: unknown): v is string | null {
  return v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
}

/** Empty patch → return the existing row unchanged (avoids an invalid empty `SET`); else update by id.
 *  Shared by the keyed lead-child upserts (meeting / value delivery / current offer). */
// deno-lint-ignore no-explicit-any
async function updateOrKeep(tx: any, table: { id: unknown }, existingRow: { id: string }, input: Record<string, unknown>) {
  if (Object.keys(input).length === 0) return existingRow;
  // deno-lint-ignore no-explicit-any
  return (await (tx as any).update(table).set(input).where(eq((table as any).id, existingRow.id)).returning())[0];
}

function mapLeadPatch(patch: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  // Pipeline state (ADR-0004 original)
  if ("qualification" in patch) mapped.qualification = patch.qualification;
  if ("meeting_booked" in patch) mapped.meetingBooked = patch.meeting_booked;
  if ("meeting_held" in patch) mapped.meetingHeld = patch.meeting_held;
  if ("offer_sent" in patch) mapped.offerSent = patch.offer_sent;
  if ("won" in patch) mapped.won = patch.won;
  // Report notes + manual row highlight (Batch 4). client_note is the renamed legacy
  // `comments` field (client-facing); coldunicorn_note is internal-only.
  if ("client_note" in patch) mapped.clientNote = patch.client_note;
  if ("coldunicorn_note" in patch) mapped.coldunicornNote = patch.coldunicorn_note;
  if ("highlight" in patch) mapped.highlight = patch.highlight;
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
  // OOO state is not a lead field (ADR-0015): the columns were dropped by migration 20260722z and
  // `expected_return_date` / `added_to_ooo_campaign` / `contact_disposition` no longer exist on
  // `LeadRecord`, so `Partial<LeadRecord>` can no longer carry them — no reject guard is needed.
  // Lead CRM operational state (ADR-0013, Phase 5.2). Editable dates/method that drive the CRM health
  // columns. Terminal-status columns (final_outcome/conclusion/concluded_at) are NOT here — only the
  // atomic concludeLead action writes them. Dates are validated (null or a YYYY-MM-DD... string) so a
  // malformed value is skipped rather than reaching Postgres as a 500.
  const setDate = (key: string, drizzleKey: string) => {
    if (key in patch && isDateish(patch[key])) mapped[drizzleKey] = patch[key];
  };
  setDate("linkedin_invitation_sent_at", "linkedinInvitationSentAt");
  setDate("contact_made_at", "contactMadeAt");
  setDate("negotiation_started_at", "negotiationStartedAt");
  // contact_method has a DB CHECK (phone|email); coerce anything else to NULL rather than 500 on write.
  if ("contact_method" in patch) mapped.contactMethod = patch.contact_method === "phone" || patch.contact_method === "email" ? patch.contact_method : null;
  // Bookkeeping
  if ("updated_at" in patch) mapped.updatedAt = patch.updated_at;
  return mapped;
}

const MEETING_STATUSES = new Set<string>(MEETING_STATUS_VALUES);

/** Whitelist the CS-manager-owned meeting fields (ADR-0013, Phase 5.3). AI-generated fields
 *  (transcription/insights/score) are NOT writable here — n8n owns them. Every field is validated so
 *  a malformed value is dropped rather than reaching Postgres as a 500. */
function mapLeadMeetingInput(patch: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  if ("status" in patch && typeof patch.status === "string" && MEETING_STATUSES.has(patch.status)) m.status = patch.status;
  if ("scheduled_at" in patch && isDateish(patch.scheduled_at)) m.scheduledAt = patch.scheduled_at;
  if ("held_at" in patch && isDateish(patch.held_at)) m.heldAt = patch.held_at;
  if ("call_script" in patch && (patch.call_script === null || typeof patch.call_script === "string")) m.callScript = patch.call_script;
  return m;
}

function toLeadMeetingRecord(row: typeof schema.leadMeetings.$inferSelect) {
  return {
    id: row.id,
    lead_id: row.leadId,
    meeting_type: row.meetingType,
    status: row.status,
    call_script: row.callScript,
    scheduled_at: row.scheduledAt,
    held_at: row.heldAt,
    meeting_url: row.meetingUrl,
    calendar_event_id: row.calendarEventId,
    transcription_url: row.transcriptionUrl,
    pre_meeting_insights: row.preMeetingInsights,
    pre_meeting_insights_generated_at: row.preMeetingInsightsGeneratedAt,
    process_score: normalizeNumeric(row.processScore),
    conversion_insights: row.conversionInsights,
    post_meeting_analysis_generated_at: row.postMeetingAnalysisGeneratedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

const OFFER_STATUSES = new Set<string>(OFFER_STATUS_VALUES);

/** Whitelist the CS-manager-owned offer fields (ADR-0013, Phase 5.3). Validated so a malformed value
 *  is dropped rather than 500. */
function mapLeadOfferInput(patch: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  if ("status" in patch && typeof patch.status === "string" && OFFER_STATUSES.has(patch.status)) m.status = patch.status;
  if ("contracted_send_date" in patch && isDateish(patch.contracted_send_date)) m.contractedSendDate = patch.contracted_send_date;
  return m;
}

function toLeadOfferRecord(row: typeof schema.leadOffers.$inferSelect) {
  return {
    id: row.id,
    lead_id: row.leadId,
    status: row.status,
    contracted_send_date: row.contractedSendDate,
    sent_at: row.sentAt,
    offer_url: row.offerUrl,
    notes: row.notes,
    source_meeting_id: row.sourceMeetingId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/** Whitelist the CS-manager-owned value-delivery fields (ADR-0013, Phase 5.3). Validated so malformed
 *  values are dropped rather than 500. planned_date is a DATE; sent_at a timestamptz. */
function mapLeadValueDeliveryInput(patch: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  if ("planned_date" in patch && isDateish(patch.planned_date)) m.plannedDate = patch.planned_date;
  if ("sent_at" in patch && isDateish(patch.sent_at)) m.sentAt = patch.sent_at;
  if ("value_items" in patch && Array.isArray(patch.value_items) && patch.value_items.every((x) => typeof x === "string")) {
    m.valueItems = patch.value_items;
  }
  return m;
}

function toLeadValueDeliveryRecord(row: typeof schema.leadValueDeliveries.$inferSelect) {
  return {
    id: row.id,
    lead_id: row.leadId,
    sequence_number: row.sequenceNumber,
    planned_date: row.plannedDate,
    value_items: row.valueItems ?? [],
    sent_at: row.sentAt,
    source_meeting_id: row.sourceMeetingId,
    notes: row.notes,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

const TASK_STATUSES = new Set<string>(TASK_STATUS_VALUES);

/** Whitelist the CS-manager-owned task fields (ADR-0013, Phase 5.3). Validated so malformed values are
 *  dropped rather than 500. */
function mapLeadTaskInput(patch: Record<string, unknown>) {
  const m: Record<string, unknown> = {};
  if ("title" in patch && typeof patch.title === "string") m.title = patch.title;
  if ("due_at" in patch && isDateish(patch.due_at)) m.dueAt = patch.due_at;
  if ("status" in patch && typeof patch.status === "string" && TASK_STATUSES.has(patch.status)) m.status = patch.status;
  if ("notes" in patch && (patch.notes === null || typeof patch.notes === "string")) m.notes = patch.notes;
  return m;
}

function toLeadTaskRecord(row: typeof schema.leadTasks.$inferSelect) {
  return {
    id: row.id,
    lead_id: row.leadId,
    title: row.title,
    due_at: row.dueAt,
    status: row.status,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    source_meeting_id: row.sourceMeetingId,
    notes: row.notes,
    position: row.position,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function mapDomainPatch(patch: Record<string, unknown>) {
  // Portal-editable: the local domain_status enum and client_id (linking a Winnr-synced domain to a
  // client). RLS still gates the write — domains_update_scoped USING/​WITH CHECK = can_manage_client,
  // so only admin-tier callers can link an unlinked domain. winnr_status and the other Winnr sync
  // columns are ingestion-only (n8n via service_role) — never accept them from a portal patch.
  const mapped: Record<string, unknown> = {};
  if ("status" in patch) mapped.status = patch.status;
  if ("client_id" in patch) mapped.clientId = patch.client_id;
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
    managerId: input.manager_id ?? null,
    status: input.status,
    kpiLeads: input.kpi_leads ?? null,
    kpiMeetings: input.kpi_meetings ?? null,
    contractedAmount: input.contracted_amount ?? null,
    contractDueDate: input.contract_due_date ?? null,
    minDailySent: input.min_daily_sent ?? 0,
    inboxesCount: input.inboxes_count ?? 0,
    crmConfig: input.crm_config ?? null,
    smsPhoneNumbers: input.sms_phone_numbers ?? null,
    notificationEmails: input.notification_emails ?? null,
    autoOooEnabled: input.auto_ooo_enabled ?? false,
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
    // ADR-0012: omit when not provided → DB default (EmailBison) applies.
    sequencerId: (input.sequencer_id as string | null | undefined) ?? undefined,
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
    source: input.source ?? "manual",
    clientNote: input.client_note ?? null,
  };
}

function mapDomainInsert(input: Record<string, unknown>) {
  return {
    clientId: input.client_id,
    domainName: input.domain_name,
    setupEmail: input.setup_email,
    purchaseDate: input.purchase_date,
    status: input.status ?? null,
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
    field_type: String(row.field_type) as "text" | "checkbox" | "droplist" | "link",
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

function toLeadCustomFieldRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    name: String(row.name),
    field_type: String(row.field_type) as "text" | "checkbox" | "droplist" | "link" | "number" | "currency",
    options: row.options === null || row.options === undefined ? null : (row.options as string[]),
    position: Number(row.position ?? 0),
    editable_by: Array.isArray(row.editable_by) ? (row.editable_by as string[]) : ["admin", "master_admin"],
    created_by: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  };
}

function toLeadCustomFieldValueRecord(row: Record<string, unknown>) {
  return {
    lead_id: String(row.lead_id),
    field_id: String(row.field_id),
    value: row.value === null || row.value === undefined ? null : String(row.value),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
    updated_by: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
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

// ADR-0012 sequencer tables (raw SQL — not in drizzle schema).

function toSequencerRecord(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    channel: String(row.channel) as "email" | "linkedin",
    enabled: Boolean(row.enabled),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
  };
}

// `setup` is the row from the separate provisioning-status query, or undefined when that query
// degraded (pre-20260807 schema). Undefined must read as "never checked", never as "not configured".
function toClientSequencerRecord(row: Record<string, unknown>, setup?: Record<string, unknown>) {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    sequencer_id: String(row.sequencer_id),
    api_key: row.api_key === null || row.api_key === undefined ? null : String(row.api_key),
    external_workspace_id:
      row.external_workspace_id === null || row.external_workspace_id === undefined
        ? null
        : String(row.external_workspace_id),
    settings: (row.settings ?? {}) as Record<string, unknown>,
    enabled: Boolean(row.enabled),
    // Written only by the workspace-setup workflows, never by the portal. `{}` = never checked;
    // `setup_checked_at` is what distinguishes that from "checked and found empty".
    setup_state: (setup?.setup_state ?? {}) as Record<string, unknown>,
    setup_checked_at:
      setup?.setup_checked_at instanceof Date
        ? setup.setup_checked_at.toISOString()
        : setup?.setup_checked_at
          ? String(setup.setup_checked_at)
          : null,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
  };
}

// Upsert one client↔sequencer settings row, resolving the sequencer by catalog key.
// Only fields present in `patch` overwrite existing values (upsertColumnOverride pattern).
async function upsertClientSequencerRow(
  tx: any,
  clientId: string,
  sequencerKey: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const apiKeyProvided = "api_key" in patch;
  const workspaceProvided = "external_workspace_id" in patch;
  const settingsProvided = "settings" in patch;
  const enabledProvided = "enabled" in patch;
  const rows = await tx.execute(sql`
    insert into public.client_sequencers (client_id, sequencer_id, api_key, external_workspace_id, settings, enabled, updated_at)
    select
      ${clientId},
      s.id,
      ${apiKeyProvided ? (patch.api_key as string | null) ?? null : null},
      ${workspaceProvided ? (patch.external_workspace_id as string | null) ?? null : null},
      ${settingsProvided ? JSON.stringify(patch.settings ?? {}) : "{}"}::jsonb,
      ${enabledProvided ? Boolean(patch.enabled) : true},
      now()
    from public.sequencers s
    where s.key = ${sequencerKey}
    on conflict (client_id, sequencer_id) do update set
      api_key = case when ${apiKeyProvided} then excluded.api_key else public.client_sequencers.api_key end,
      external_workspace_id = case when ${workspaceProvided} then excluded.external_workspace_id else public.client_sequencers.external_workspace_id end,
      settings = case when ${settingsProvided} then excluded.settings else public.client_sequencers.settings end,
      enabled = case when ${enabledProvided} then excluded.enabled else public.client_sequencers.enabled end,
      updated_at = excluded.updated_at
    returning id, client_id, sequencer_id, api_key, external_workspace_id, settings, enabled, created_at, updated_at
  `);
  const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
  if (!result[0]) fail(400, `Unknown sequencer key "${sequencerKey}" or upsert rejected by RLS.`);
  return result[0];
}

// Generic typed raw-SQL executor. Rows are returned as plain objects; caller is responsible for
// typing the generic parameter to match the SELECT projection.
async function rawQuery<T>(tx: any, query: any): Promise<T[]> {
  const result = await tx.execute(query);
  return (Array.isArray(result) ? result : result.rows ?? []) as T[];
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
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

interface CallerResult {
  data: unknown;
  setupMs: number;
  handlerMs: number;
}

async function executeAsCaller(request: Request, operation: (tx: any) => Promise<unknown>): Promise<CallerResult> {
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
    // Combined setup: set JWT context + switch role in ONE round-trip.
    // set_config('role', ...) is equivalent to SET LOCAL ROLE — PostgreSQL docs §9.27.
    // Previously two separate round-trips; eliminating one saves ~100ms of pooler latency.
    const tSetup = performance.now();
    await tx.execute(sql`SELECT
      set_config('request.jwt.claims', ${claimsJson}, true),
      set_config('request.jwt.claim.sub', ${sub}, true),
      set_config('request.jwt.claim.role', ${role}, true),
      set_config('role', ${role}, true)`);
    const setupMs = performance.now() - tSetup;

    const tHandler = performance.now();
    const data = await operation(tx);
    const handlerMs = performance.now() - tHandler;

    return { data, setupMs, handlerMs };
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

/** Mutable perf context threaded from Deno.serve → handleAction for per-query timing. */
interface PerfContext {
  queryMs: Record<string, number>;
}

async function handleAction(tx: any, payload: OrmGatewayRequest, perf?: PerfContext) {

  if (payload.action === "loadShellData") {
    // Tiny global boot payload: projected lite columns only. No leads/replies/stats/etc.
    const tShellStart = performance.now();
    const [usersLite, clientsLite, clientUsers] = await Promise.all([
      timedQuery(
        "shell.usersLite",
        tx
          .select({
            id: schema.users.id,
            first_name: schema.users.firstName,
            last_name: schema.users.lastName,
            email: schema.users.email,
            role: schema.users.role,
          })
          .from(schema.users)
          .orderBy(desc(schema.users.createdAt)),
      ),
      timedQuery(
        "shell.clientsLite",
        tx
          .select({
            id: schema.clients.id,
            name: schema.clients.name,
            manager_id: schema.clients.managerId,
            status: schema.clients.status,
            kpi_leads: schema.clients.kpiLeads,
            kpi_meetings: schema.clients.kpiMeetings,
            notification_emails: schema.clients.notificationEmails,
          })
          .from(schema.clients)
          .orderBy(desc(schema.clients.createdAt)),
      ),
      timedQuery(
        "shell.clientUsers",
        tx
          .select({
            id: schema.clientUsers.id,
            client_id: schema.clientUsers.clientId,
            user_id: schema.clientUsers.userId,
          })
          .from(schema.clientUsers),
      ),
    ]);
    console.log(
      `[PERF][orm-gateway] loadShellData total: ${(performance.now() - tShellStart).toFixed(1)}ms ` +
        `(usersLite=${usersLite.length}, clientsLite=${clientsLite.length}, clientUsers=${clientUsers.length})`,
    );
    return { usersLite, clientsLite, clientUsers };
  }

  // ── Phase 2A: per-page dashboard loaders ────────────────────────────────────────────────────

  if (payload.action === "loadAdminDashboardOverview") {
    const t0 = performance.now();
    const since21d = isoDaysAgo(21);

    const [clientCountRows, activeCampaignCountRows, noManagerCountRows, pipelineGroupRows, momentumRows, managerCapacityRows, latestDateRows, clientsWithLeadsRows, activeClientsWithSentRows] =
      await Promise.all([
        rawQuery<{ count: number; active_count: number }>(tx, sql`SELECT COUNT(*)::int AS count, COUNT(CASE WHEN status = 'Active' THEN 1 END)::int AS active_count FROM clients`),
        rawQuery<{ count: number }>(tx, sql`SELECT COUNT(*)::int AS count FROM campaigns WHERE status = 'active'`),
        rawQuery<{ count: number }>(tx, sql`
          SELECT COUNT(*)::int AS count FROM clients
          WHERE manager_id IS NULL
          OR manager_id NOT IN (SELECT id FROM users WHERE role = 'manager')
        `),
        rawQuery<{
          qualification: string | null;
          meeting_booked: boolean | null;
          meeting_held: boolean | null;
          offer_sent: boolean | null;
          won: boolean | null;
          count: number;
        }>(tx, sql`
          SELECT qualification, meeting_booked, meeting_held, offer_sent, won, COUNT(*)::int AS count
          FROM leads
          WHERE created_at >= ${since21d}
          GROUP BY qualification, meeting_booked, meeting_held, offer_sent, won
        `),
        rawQuery<{ date: string; sent: number; replies: number; positive: number }>(tx, sql`
          SELECT
            gs.d::text AS date,
            COALESCE(SUM(ds.emails_sent), 0)::int AS sent,
            COALESCE(SUM(ds.response_count), 0)::int AS replies,
            COALESCE(SUM(ds.human_replies_count), 0)::int AS positive
          FROM generate_series(${since21d}::date, CURRENT_DATE, '1 day'::interval) AS gs(d)
          LEFT JOIN daily_stats ds ON ds.report_date = gs.d
          GROUP BY gs.d
          ORDER BY gs.d ASC
        `),
        rawQuery<{ manager_id: string; manager_name: string; manager_role: string; clients_count: number; active_campaigns_count: number; leads_count: number }>(tx, sql`
          SELECT
            u.id AS manager_id,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS manager_name,
            u.role AS manager_role,
            COUNT(DISTINCT c.id)::int AS clients_count,
            COUNT(DISTINCT CASE WHEN camp.status = 'active' THEN camp.id END)::int AS active_campaigns_count,
            COUNT(DISTINCT l.id)::int AS leads_count
          FROM users u
          LEFT JOIN clients c ON c.manager_id = u.id
          LEFT JOIN campaigns camp ON camp.client_id = c.id
          LEFT JOIN leads l ON l.client_id = c.id
          WHERE u.role IN ('manager', 'admin')
          GROUP BY u.id, u.first_name, u.last_name, u.role
          ORDER BY clients_count DESC
          LIMIT 8
        `),
        rawQuery<{ latest: string | null }>(tx, sql`SELECT MAX(report_date) AS latest FROM daily_stats`),
        rawQuery<{ date: string; count: number }>(tx, sql`
          SELECT
            gs.d::text AS date,
            COUNT(DISTINCT l.client_id)::int AS count
          FROM generate_series(${since21d}::date, CURRENT_DATE, '1 day'::interval) AS gs(d)
          LEFT JOIN leads l ON DATE(l.created_at) = gs.d
          GROUP BY gs.d
          ORDER BY gs.d ASC
        `),
        rawQuery<{ date: string; count: number }>(tx, sql`
          SELECT
            gs.d::text AS date,
            COUNT(DISTINCT ds.client_id)::int AS count
          FROM generate_series(${since21d}::date, CURRENT_DATE, '1 day'::interval) AS gs(d)
          LEFT JOIN daily_stats ds ON ds.report_date = gs.d AND ds.emails_sent > 0
          LEFT JOIN clients c ON c.id = ds.client_id AND c.status = 'Active'
          GROUP BY gs.d
          ORDER BY gs.d ASC
        `),
      ]);

    console.log(`[PERF][orm-gateway] loadAdminDashboardOverview: ${(performance.now() - t0).toFixed(1)}ms`);

    return {
      metrics: {
        clientsCount: clientCountRows[0]?.count ?? 0,
        clientsWithoutManager: noManagerCountRows[0]?.count ?? 0,
        activeCampaignsCount: activeCampaignCountRows[0]?.count ?? 0,
        activeClientsCount: clientCountRows[0]?.active_count ?? 0,
      },
      pipelineGroups: pipelineGroupRows,
      campaignMomentum21d: momentumRows,
      clientsWithLeads21d: clientsWithLeadsRows,
      activeClientsWithSent21d: activeClientsWithSentRows,
      managerCapacity: managerCapacityRows.map((row) => ({
        managerId: String(row.manager_id),
        managerName: String(row.manager_name),
        managerRole: (row.manager_role === "admin" ? "admin" : "manager") as "admin" | "manager",
        clientsCount: row.clients_count ?? 0,
        activeCampaignsCount: row.active_campaigns_count ?? 0,
        leadsCount: row.leads_count ?? 0,
      })),
      latestSnapshotDate: latestDateRows[0]?.latest ? String(latestDateRows[0].latest) : null,
    };
  }

  if (payload.action === "loadManagerDashboardOverview") {
    const managerId = payload.managerId;
    const clientFilter = payload.clientId ?? null;
    const statusFilterRaw = payload.campaignStatus ?? "active";
    const statusFilter = statusFilterRaw === "all" ? null : statusFilterRaw;
    const dateFrom = payload.dateFrom ?? null; // 'YYYY-MM-DD' inclusive lower bound
    const dateTo = payload.dateTo ?? null; // 'YYYY-MM-DD' inclusive upper bound
    const t0 = performance.now();
    const since21d = isoDaysAgo(21);

    // Scoped client IDs subquery: the manager's clients, optionally narrowed to one client.
    // Factories (fresh fragment per call) so the same subquery/condition can be embedded repeatedly.
    const scopedClientIds = () => clientFilter
      ? sql`SELECT id FROM clients WHERE manager_id = ${managerId} AND id = ${clientFilter}`
      : sql`SELECT id FROM clients WHERE manager_id = ${managerId}`;
    const campStatusCond = () => statusFilter ? sql`AND camp.status = ${statusFilter}` : sql``;
    // Date-range conditions. `column` is the timestamp/date expression to compare (e.g. created_at, cds.report_date).
    const dateCond = (column: string) => {
      let f = sql``;
      if (dateFrom) f = sql`${f} AND ${sql.raw(column)} >= ${dateFrom}`;
      if (dateTo) f = sql`${f} AND ${sql.raw(column)} <= ${dateTo}`;
      return f;
    };
    // For COUNT(CASE) on a LEFT JOINed leads row, the date bound goes inside the CASE so clients with
    // zero in-range leads are still returned (the LEFT JOIN row is not filtered out by a WHERE clause).
    const leadDateCaseCond = () => {
      let f = sql``;
      if (dateFrom) f = sql`${f} AND l.created_at >= ${dateFrom}`;
      if (dateTo) f = sql`${f} AND l.created_at <= ${dateTo}`;
      return f;
    };

    const [metricsRows, pipelineGroupRows, momentumRows, portfolioRows, watchlistRows, queueRows, filterClientRows] =
      await Promise.all([
        rawQuery<{ assigned_clients_count: number; campaigns_count: number }>(tx, sql`
          SELECT
            (SELECT COUNT(*)::int FROM (${scopedClientIds()}) AS sc) AS assigned_clients_count,
            (SELECT COUNT(*)::int FROM campaigns camp WHERE camp.client_id IN (${scopedClientIds()})${campStatusCond()}) AS campaigns_count
        `),
        rawQuery<{
          qualification: string | null;
          meeting_booked: boolean | null;
          meeting_held: boolean | null;
          offer_sent: boolean | null;
          won: boolean | null;
          count: number;
        }>(tx, sql`
          SELECT qualification, meeting_booked, meeting_held, offer_sent, won, COUNT(*)::int AS count
          FROM leads
          WHERE client_id IN (${scopedClientIds()})${dateCond("created_at")}
          GROUP BY qualification, meeting_booked, meeting_held, offer_sent, won
        `),
        rawQuery<{ date: string; sent: number; replies: number; positive: number }>(tx, sql`
          SELECT
            gs.d::text AS date,
            COALESCE(SUM(ds.emails_sent), 0)::int AS sent,
            COALESCE(SUM(ds.response_count), 0)::int AS replies,
            COALESCE(SUM(ds.human_replies_count), 0)::int AS positive
          FROM generate_series(
            ${dateFrom ? sql`${dateFrom}::date` : sql`(CURRENT_DATE - INTERVAL '20 days')::date`},
            ${dateTo ? sql`${dateTo}::date` : sql`CURRENT_DATE`},
            '1 day'::interval
          ) AS gs(d)
          LEFT JOIN daily_stats ds
            ON ds.report_date = gs.d
            AND ds.client_id IN (${scopedClientIds()})
          GROUP BY gs.d
          ORDER BY gs.d ASC
        `),
        rawQuery<{
          client_id: string;
          client_name: string;
          status: string | null;
          kpi_leads: number | null;
          kpi_meetings: number | null;
          campaigns_count: number;
          mql_count: number;
          won_count: number;
        }>(tx, sql`
          SELECT
            c.id AS client_id,
            c.name AS client_name,
            c.status,
            c.kpi_leads,
            c.kpi_meetings,
            COUNT(DISTINCT camp.id)::int AS campaigns_count,
            COUNT(DISTINCT CASE WHEN l.qualification = 'MQL'${leadDateCaseCond()} THEN l.id END)::int AS mql_count,
            COUNT(DISTINCT CASE WHEN l.won = true${leadDateCaseCond()} THEN l.id END)::int AS won_count
          FROM clients c
          LEFT JOIN campaigns camp ON camp.client_id = c.id
          LEFT JOIN leads l ON l.client_id = c.id
          WHERE c.id IN (${scopedClientIds()})
          GROUP BY c.id, c.name, c.status, c.kpi_leads, c.kpi_meetings
          ORDER BY c.name
        `),
        rawQuery<{ campaign_id: string; campaign_name: string; client_id: string; status: string | null; sent: number; replies: number }>(tx, sql`
          SELECT
            camp.id AS campaign_id,
            camp.name AS campaign_name,
            camp.client_id,
            camp.status,
            COALESCE(SUM(cds.sent_count), 0)::int AS sent,
            COALESCE(SUM(cds.reply_count), 0)::int AS replies
          FROM campaigns camp
          LEFT JOIN campaign_daily_stats cds ON cds.campaign_id = camp.id${dateCond("cds.report_date")}
          WHERE camp.client_id IN (${scopedClientIds()})${campStatusCond()}
          GROUP BY camp.id, camp.name, camp.client_id, camp.status
        `),
        rawQuery<Record<string, unknown>>(tx, sql`
          SELECT
            l.id, l.created_at, l.updated_at, l.client_id,
            l.campaign_id, l.email, l.first_name, l.last_name, l.job_title,
            l.company_name, l.linkedin_url, l.gender, l.qualification,
            l.external_id, l.phone_number, l.phone_source,
            l.industry, l.headcount_range, l.website, l.country,
            l.message_title, l.message_number, l.response_time_hours, l.response_time_label,
            l.meeting_booked, l.meeting_held, l.offer_sent, l.won,
            l.external_blacklist_id, l.external_domain_blacklist_id,
            l.source, l.reply_text, l.client_note, l.coldunicorn_note, l.highlight,
            c.name AS client_name,
            camp.name AS campaign_name,
            COALESCE(r.reply_count, 0)::int AS reply_count,
            r.last_reply_at
          FROM leads l
          JOIN clients c ON c.id = l.client_id
          LEFT JOIN campaigns camp ON camp.id = l.campaign_id
          LEFT JOIN (
            SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
            FROM replies GROUP BY lead_id
          ) r ON r.lead_id = l.id
          WHERE l.client_id IN (${scopedClientIds()})${dateCond("l.created_at")}
          ORDER BY COALESCE(l.updated_at, l.created_at) DESC
          LIMIT 10
        `),
        rawQuery<{ id: string; name: string }>(tx, sql`
          SELECT id, name FROM clients WHERE manager_id = ${managerId} ORDER BY name
        `),
      ]);

    const m = metricsRows[0];
    console.log(`[PERF][orm-gateway] loadManagerDashboardOverview: ${(performance.now() - t0).toFixed(1)}ms`);

    return {
      metrics: {
        assignedClientsCount: m?.assigned_clients_count ?? 0,
        campaignsCount: m?.campaigns_count ?? 0,
      },
      pipelineGroups: pipelineGroupRows,
      campaignMomentum21d: momentumRows,
      filterClients: filterClientRows.map((row) => ({ id: String(row.id), name: String(row.name) })),
      clientPortfolio: portfolioRows.map((row) => ({
        clientId: String(row.client_id),
        clientName: String(row.client_name),
        status: row.status ?? null,
        campaignsCount: row.campaigns_count ?? 0,
        mqlCount: row.mql_count ?? 0,
        wonCount: row.won_count ?? 0,
        kpiLeads: row.kpi_leads != null ? Number(row.kpi_leads) : null,
        kpiMeetings: row.kpi_meetings != null ? Number(row.kpi_meetings) : null,
      })),
      campaignWatchlist: watchlistRows.map((row) => ({
        campaignId: String(row.campaign_id),
        campaignName: String(row.campaign_name),
        clientId: String(row.client_id),
        status: row.status ?? null,
        sent: row.sent ?? 0,
        replies: row.replies ?? 0,
      })),
      leadQueue: queueRows.map((r) => ({
        id: String(r.id),
        created_at: r.created_at ? toIsoString(r.created_at) ?? "" : "",
        updated_at: r.updated_at ? toIsoString(r.updated_at) ?? "" : "",
        client_id: String(r.client_id),
        campaign_id: r.campaign_id ? String(r.campaign_id) : null,
        email: r.email ? String(r.email) : null,
        first_name: r.first_name ? String(r.first_name) : null,
        last_name: r.last_name ? String(r.last_name) : null,
        job_title: r.job_title ? String(r.job_title) : null,
        company_name: r.company_name ? String(r.company_name) : null,
        linkedin_url: r.linkedin_url ? String(r.linkedin_url) : null,
        gender: r.gender ? String(r.gender) : null,
        qualification: r.qualification ? String(r.qualification) : null,
        external_id: r.external_id ? String(r.external_id) : null,
        phone_number: r.phone_number ? String(r.phone_number) : null,
        phone_source: r.phone_source ? String(r.phone_source) : null,
        industry: r.industry ? String(r.industry) : null,
        headcount_range: r.headcount_range ? String(r.headcount_range) : null,
        website: r.website ? String(r.website) : null,
        country: r.country ? String(r.country) : null,
        message_title: r.message_title ? String(r.message_title) : null,
        message_number: r.message_number != null ? Number(r.message_number) : null,
        response_time_hours: r.response_time_hours != null ? Number(r.response_time_hours) : null,
        response_time_label: r.response_time_label ? String(r.response_time_label) : null,
        meeting_booked: Boolean(r.meeting_booked),
        meeting_held: Boolean(r.meeting_held),
        offer_sent: Boolean(r.offer_sent),
        won: Boolean(r.won),
        external_blacklist_id: r.external_blacklist_id != null ? Number(r.external_blacklist_id) : null,
        external_domain_blacklist_id: r.external_domain_blacklist_id != null ? Number(r.external_domain_blacklist_id) : null,
        source: r.source ? String(r.source) : "cold_email",
        reply_text: r.reply_text ? String(r.reply_text) : null,
        client_note: r.client_note ? String(r.client_note) : null,
        coldunicorn_note: r.coldunicorn_note ? String(r.coldunicorn_note) : null,
        highlight: r.highlight ? String(r.highlight) : null,
        clientName: String(r.client_name ?? ""),
        campaignName: r.campaign_name ? String(r.campaign_name) : null,
        replyCount: Number(r.reply_count ?? 0),
        lastReplyAt: r.last_reply_at ? toIsoString(r.last_reply_at) : null,
      })),
    };
  }

  if (payload.action === "loadClientDashboard") {
    const clientId = payload.clientId;
    const t0 = performance.now();
    const campaignStatsSince = isoDaysAgo(CAMPAIGN_DAILY_STATS_WINDOW_DAYS);
    const dailyStatsSince = isoDaysAgo(DAILY_STATS_WINDOW_DAYS);

    const [clientRows, campaignRows, leadRows, campaignStatRows, dailyStatRows] = await Promise.all([
      tx.select({
        id: schema.clients.id,
        name: schema.clients.name,
        status: schema.clients.status,
        kpi_leads: schema.clients.kpiLeads,
        kpi_meetings: schema.clients.kpiMeetings,
        prospects_added: schema.clients.prospectsAdded,
      }).from(schema.clients).where(eq(schema.clients.id, clientId)),

      tx.select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        status: schema.campaigns.status,
        database_size: schema.campaigns.databaseSize,
      }).from(schema.campaigns).where(
        and(eq(schema.campaigns.clientId, clientId), eq(schema.campaigns.type, "outreach"))
      ).orderBy(desc(schema.campaigns.createdAt)),

      tx.select({
        id: schema.leads.id,
        client_id: schema.leads.clientId,
        campaign_id: schema.leads.campaignId,
        created_at: schema.leads.createdAt,
        qualification: schema.leads.qualification,
        meeting_booked: schema.leads.meetingBooked,
        meeting_held: schema.leads.meetingHeld,
        offer_sent: schema.leads.offerSent,
        won: schema.leads.won,
      }).from(schema.leads).where(eq(schema.leads.clientId, clientId)).orderBy(desc(schema.leads.createdAt)),

      rawQuery<{
        campaign_id: string;
        report_date: string;
        sent_count: number | null;
        reply_count: number | null;
        bounce_count: number | null;
        unique_open_count: number | null;
        positive_replies_count: number | null;
      }>(tx, sql`
        SELECT cds.campaign_id, cds.report_date, cds.sent_count, cds.reply_count,
               cds.bounce_count, cds.unique_open_count, cds.positive_replies_count
        FROM campaign_daily_stats cds
        JOIN campaigns c ON c.id = cds.campaign_id
        WHERE c.client_id = ${clientId}
        AND cds.report_date >= ${campaignStatsSince}
        ORDER BY cds.report_date DESC
      `),

      tx.select({
        client_id: schema.dailyStats.clientId,
        report_date: schema.dailyStats.reportDate,
        emails_sent: schema.dailyStats.emailsSent,
        mql_count: schema.dailyStats.mqlCount,
        response_count: schema.dailyStats.responseCount,
        bounce_count: schema.dailyStats.bounceCount,
        negative_count: schema.dailyStats.negativeCount,
        ooo_count: schema.dailyStats.oooCount,
        human_replies_count: schema.dailyStats.humanRepliesCount,
        prospects_count: schema.dailyStats.prospectsCount,
        schedule_today: schema.dailyStats.scheduleToday,
        schedule_tomorrow: schema.dailyStats.scheduleTomorrow,
        schedule_day_after: schema.dailyStats.scheduleDayAfter,
      }).from(schema.dailyStats).where(
        and(eq(schema.dailyStats.clientId, clientId), gte(schema.dailyStats.reportDate, dailyStatsSince))
      ).orderBy(desc(schema.dailyStats.reportDate)),
    ]);

    if (!clientRows[0]) fail(404, "Client not found or not accessible.");

    const client = clientRows[0];
    console.log(`[PERF][orm-gateway] loadClientDashboard: ${(performance.now() - t0).toFixed(1)}ms ` +
      `(leads=${leadRows.length}, campaignStats=${campaignStatRows.length}, dailyStats=${dailyStatRows.length})`);

    return {
      client: {
        id: client.id,
        name: client.name,
        status: client.status ?? null,
        kpi_leads: client.kpi_leads != null ? Number(client.kpi_leads) : null,
        kpi_meetings: client.kpi_meetings != null ? Number(client.kpi_meetings) : null,
        prospects_added: client.prospects_added != null ? Number(client.prospects_added) : null,
      },
      campaigns: campaignRows.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status ?? null,
        database_size: c.database_size != null ? Number(c.database_size) : null,
      })),
      leadProjections: leadRows.map((l) => ({
        id: l.id,
        client_id: l.client_id,
        campaign_id: l.campaign_id ?? null,
        created_at: l.created_at ? toIsoString(l.created_at) : null,
        qualification: l.qualification ?? null,
        meeting_booked: l.meeting_booked ?? null,
        meeting_held: l.meeting_held ?? null,
        offer_sent: l.offer_sent ?? null,
        won: l.won ?? null,
      })),
      campaignDailyStats: campaignStatRows,
      dailyStats: dailyStatRows,
    };
  }

  if (payload.action === "loadClientsOverview") {
    // Phase 5B shell: lightweight clients page data — config only, no time-series stats.
    // leadProjections + dailyStats are fetched separately by loadClientsStats after first paint.
    // Target payload: ~85 KB (vs ~1.4 MB for the combined load).
    const t0 = performance.now();

    const [clientRows, usersLiteRows, clientUsersRows, conditionRuleRows, columnOverrideRows, customFieldRows, customFieldValueRows, sequencerRows, clientSequencerRows, setupStateRows] =
      await Promise.all([
        // Full client rows for the mega-table and drawer.
        tx.select().from(schema.clients).orderBy(desc(schema.clients.createdAt)),

        // User lites — same projection as shell.
        tx.select({
          id: schema.users.id,
          first_name: schema.users.firstName,
          last_name: schema.users.lastName,
          email: schema.users.email,
          role: schema.users.role,
        }).from(schema.users).orderBy(desc(schema.users.createdAt)),

        // Client↔user mappings.
        tx.select({
          id: schema.clientUsers.id,
          client_id: schema.clientUsers.clientId,
          user_id: schema.clientUsers.userId,
        }).from(schema.clientUsers),

        // Condition rules for health evaluation.
        tx.select().from(schema.conditionRules).orderBy(asc(schema.conditionRules.priority), asc(schema.conditionRules.createdAt)),

        // Column overrides (raw SQL — table not in drizzle schema yet).
        safeRawSelect(tx, sql`
          SELECT column_key, label_override, hidden, position, updated_at, updated_by
          FROM public.client_table_column_overrides
        `),

        // Custom field definitions.
        safeRawSelect(tx, sql`
          SELECT id, name, field_type, options, position, editable_by, created_by, created_at
          FROM public.client_custom_fields
          ORDER BY position ASC, created_at ASC
        `),

        // Custom field values.
        safeRawSelect(tx, sql`
          SELECT client_id, field_id, value, updated_at, updated_by
          FROM public.client_custom_field_values
        `),

        // Sequencer catalog (ADR-0012; 3 rows, no secrets).
        safeRawSelect(tx, sql`
          SELECT id, key, name, channel, enabled, created_at
          FROM public.sequencers
          ORDER BY key ASC
        `),

        // Per-client sequencer credentials — RLS (can_manage_client) already scopes
        // rows to manager-own/admin; the client role gets zero rows.
        safeRawSelect(tx, sql`
          SELECT id, client_id, sequencer_id, api_key, external_workspace_id, settings, enabled, created_at, updated_at
          FROM public.client_sequencers
        `),

        // Provisioning status (ADR-0018 §6) — a plain read, deliberately in its OWN query.
        //
        // safeRawSelect swallows "does not exist" and returns [], which is the right degradation
        // for a whole table but the wrong one for two columns: folded into the query above, a
        // schema that predates migration 20260807 would return zero connector rows, and a manager
        // would open a client to find no API keys at all and quite reasonably re-enter them. Split
        // out, the same failure costs only the status, which then reads "never checked" — true, and
        // harmless. The edge function and the migration deploy from the same push but not in a
        // guaranteed order, so this window is real, not hypothetical.
        safeRawSelect(tx, sql`
          SELECT id, setup_state, setup_checked_at FROM public.client_sequencers
        `),
      ]);

    const durationMs = performance.now() - t0;
    console.log(
      `[PERF][orm-gateway] loadClientsOverview (shell): ${durationMs.toFixed(1)}ms ` +
        `(clients=${clientRows.length}, usersLite=${usersLiteRows.length}, clientUsers=${clientUsersRows.length}, ` +
        `conditionRules=${conditionRuleRows.length}, columnOverrides=${columnOverrideRows.length}, ` +
        `customFields=${customFieldRows.length}, customFieldValues=${customFieldValueRows.length}, ` +
        `sequencers=${sequencerRows.length}, clientSequencers=${clientSequencerRows.length}, ` +
        `setupState=${setupStateRows.length})`,
    );

    return {
      clients: clientRows.map(toClientRecord),
      usersLite: usersLiteRows,
      clientUsers: clientUsersRows,
      conditionRules: conditionRuleRows.map(toConditionRuleRecord),
      columnOverrides: (columnOverrideRows as Record<string, unknown>[]).map(toColumnOverrideRecord),
      clientCustomFields: (customFieldRows as Record<string, unknown>[]).map(toClientCustomFieldRecord),
      clientCustomFieldValues: (customFieldValueRows as Record<string, unknown>[]).map(toClientCustomFieldValueRecord),
      sequencers: (sequencerRows as Record<string, unknown>[]).map(toSequencerRecord),
      clientSequencers: (() => {
        const setupById = new Map(
          (setupStateRows as Record<string, unknown>[]).map((row) => [String(row.id), row]),
        );
        return (clientSequencerRows as Record<string, unknown>[]).map((row) =>
          toClientSequencerRecord(row, setupById.get(String(row.id))),
        );
      })(),
    };
  }

  if (payload.action === "loadClientsStats") {
    // Phase 5B stats: heavy time-series data deferred until after shell paints.
    // leadProjections ~583 KB + dailyStats ~799 KB = ~1.4 MB total.
    const t0 = performance.now();
    const dailyStatsSince = isoDaysAgo(DAILY_STATS_WINDOW_DAYS);

    const [leadProjectionRows, dailyStatRows] = await Promise.all([
      // ClientsLeadInput — only the 5 fields createClientMetrics reads.
      tx.select({
        client_id: schema.leads.clientId,
        created_at: schema.leads.createdAt,
        qualification: schema.leads.qualification,
        meeting_booked: schema.leads.meetingBooked,
        won: schema.leads.won,
      }).from(schema.leads).orderBy(desc(schema.leads.createdAt)),

      // 180-day daily stats — only the 10 DailyStatInput fields.
      tx.select({
        client_id: schema.dailyStats.clientId,
        report_date: schema.dailyStats.reportDate,
        emails_sent: schema.dailyStats.emailsSent,
        response_count: schema.dailyStats.responseCount,
        bounce_count: schema.dailyStats.bounceCount,
        negative_count: schema.dailyStats.negativeCount,
        ooo_count: schema.dailyStats.oooCount,
        human_replies_count: schema.dailyStats.humanRepliesCount,
        schedule_today: schema.dailyStats.scheduleToday,
        schedule_tomorrow: schema.dailyStats.scheduleTomorrow,
        schedule_day_after: schema.dailyStats.scheduleDayAfter,
      }).from(schema.dailyStats).where(gte(schema.dailyStats.reportDate, dailyStatsSince)).orderBy(desc(schema.dailyStats.reportDate)),
    ]);

    const durationMs = performance.now() - t0;
    console.log(
      `[PERF][orm-gateway] loadClientsStats: ${durationMs.toFixed(1)}ms ` +
        `(leadProjections=${leadProjectionRows.length}, dailyStats=${dailyStatRows.length})`,
    );

    return {
      leadProjections: leadProjectionRows.map((l) => ({
        client_id: l.client_id,
        created_at: l.created_at ? toIsoString(l.created_at) : null,
        qualification: l.qualification ?? null,
        meeting_booked: l.meeting_booked ?? null,
        won: l.won ?? null,
      })),
      dailyStats: dailyStatRows,
    };
  }

  if (payload.action === "loadClientsMetricsSummary") {
    // Phase 5C: compact per-client aggregate facts replacing raw ~1.4 MB stats transfer.
    // Two GROUP BY queries (daily_stats + leads) return one row per client with pre-bucketed
    // sums/counts for DoD/WoW/MoM windows. No raw rows are sent to the frontend.
    const t0 = performance.now();

    // Helper: parse a raw SQL result value into a safe integer (postgres.js may return
    // bigint COUNT results as strings on some configurations).
    function toInt(v: unknown): number {
      if (typeof v === "number") return Math.round(v);
      if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }
      return 0;
    }

    // Like toInt but preserves NULL (unmeasured) as null instead of collapsing it to 0. Used for
    // Aimfox invites_accepted / invite_limit / remaining_database_size, where a real 0 and "the
    // source did not report it" must stay distinguishable (20260722h migration invariant).
    function toIntOrNull(v: unknown): number | null {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Math.round(v);
      if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
      return null;
    }
    const EMAILBISON_SEQ = "00000000-0000-4000-a000-000000000002";
    const AIMFOX_SEQ = "00000000-0000-4000-a000-000000000003";

    // Daily-stats aggregation: one row per client_id.
    // Week boundaries use date_trunc('week', CURRENT_DATE) which is Monday-based in PostgreSQL,
    // matching the JS startOfWeek() function in client-metrics.ts.
    // Month boundaries use date_trunc('month', ...) matching JS startOfMonth().
    const dailySummaryRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        client_id,
        -- DoD: individual day sums (d0=today .. d4=4 days ago)
        COALESCE(SUM(emails_sent) FILTER (WHERE report_date = CURRENT_DATE), 0)::int                   AS sent_d0,
        COALESCE(SUM(emails_sent) FILTER (WHERE report_date = CURRENT_DATE - 1), 0)::int               AS sent_d1,
        COALESCE(SUM(emails_sent) FILTER (WHERE report_date = CURRENT_DATE - 2), 0)::int               AS sent_d2,
        COALESCE(SUM(emails_sent) FILTER (WHERE report_date = CURRENT_DATE - 3), 0)::int               AS sent_d3,
        COALESCE(SUM(emails_sent) FILTER (WHERE report_date = CURRENT_DATE - 4), 0)::int               AS sent_d4,
        -- Schedule fields from today's rows only
        COALESCE(SUM(schedule_today)     FILTER (WHERE report_date = CURRENT_DATE), 0)::int            AS sched_today,
        COALESCE(SUM(schedule_tomorrow)  FILTER (WHERE report_date = CURRENT_DATE), 0)::int            AS sched_tomorrow,
        COALESCE(SUM(schedule_day_after) FILTER (WHERE report_date = CURRENT_DATE), 0)::int            AS sched_day_after,
        -- WoW week 0 (current ISO week Mon..Sun)
        COALESCE(SUM(emails_sent)           FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date     AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS wow_sent_w0,
        COALESCE(SUM(human_replies_count)   FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date     AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS wow_human_w0,
        COALESCE(SUM(bounce_count)          FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date     AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS wow_bounce_w0,
        COALESCE(SUM(ooo_count)             FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date     AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS wow_ooo_w0,
        COALESCE(SUM(negative_count)        FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date     AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS wow_neg_w0,
        -- WoW week 1
        COALESCE(SUM(emails_sent)           FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS wow_sent_w1,
        COALESCE(SUM(human_replies_count)   FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS wow_human_w1,
        COALESCE(SUM(bounce_count)          FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS wow_bounce_w1,
        COALESCE(SUM(ooo_count)             FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS wow_ooo_w1,
        COALESCE(SUM(negative_count)        FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS wow_neg_w1,
        -- WoW week 2
        COALESCE(SUM(emails_sent)           FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS wow_sent_w2,
        COALESCE(SUM(human_replies_count)   FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS wow_human_w2,
        COALESCE(SUM(bounce_count)          FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS wow_bounce_w2,
        COALESCE(SUM(ooo_count)             FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS wow_ooo_w2,
        COALESCE(SUM(negative_count)        FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS wow_neg_w2,
        -- WoW week 3
        COALESCE(SUM(emails_sent)           FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS wow_sent_w3,
        COALESCE(SUM(human_replies_count)   FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS wow_human_w3,
        COALESCE(SUM(bounce_count)          FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS wow_bounce_w3,
        COALESCE(SUM(ooo_count)             FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS wow_ooo_w3,
        COALESCE(SUM(negative_count)        FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS wow_neg_w3,
        -- WoW week 4
        COALESCE(SUM(emails_sent)           FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS wow_sent_w4,
        COALESCE(SUM(human_replies_count)   FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS wow_human_w4,
        COALESCE(SUM(bounce_count)          FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS wow_bounce_w4,
        COALESCE(SUM(ooo_count)             FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS wow_ooo_w4,
        COALESCE(SUM(negative_count)        FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS wow_neg_w4,
        -- Prospects added: the month-to-date cumulative on the most recent day we have.
        --
        -- NOT MAX(prospects_count): prospects_count is a DERIVED day-delta of this cumulative, so a
        -- single failed Bison leads fetch — which writes 0 rather than erroring — makes the next day's
        -- delta equal the whole month, and MAX() then pinned that spike for 180 days. UniTalk rendered
        -- 5388 from one such row on 2026-06-08 while the true figure was 3195; ColdUnicorn PL 8905 vs
        -- 1331. prospects_total is the raw counter and carries no delta arithmetic, so it cannot be
        -- poisoned that way. This reproduces CS PDCA column P (SUMIFS over K for TODAY()) exactly
        -- on all 15 active clients, zeros included.
        -- NOTE: no backticks in this comment — it lives inside a JS template literal.
        -- → automation/sheets/pdca/FORMULAS.md §4, defects 5-6
        COALESCE((array_agg(prospects_total ORDER BY report_date DESC)
                  FILTER (WHERE prospects_total IS NOT NULL))[1], 0)::int                              AS latest_prospects
      FROM daily_stats
      WHERE report_date >= CURRENT_DATE - 180
      GROUP BY client_id
    `);

    // Leads aggregation: one row per client_id. Uses created_at::date for temporal bucketing,
    // consistent with JS aggregateLeads() which uses parseDate(lead.created_at).
    // Qualification enum values: 'MQL', 'preMQL' (exact case from schema).
    const leadSummaryRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        client_id,
        -- 3-DoD: per-day counts of (MQL | preMQL) and MQL-only leads
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE))::int           AS td_total_d0,
        (COUNT(*) FILTER (WHERE  qualification::text = 'MQL'                                    AND created_at::date = CURRENT_DATE))::int           AS td_sql_d0,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 1))::int        AS td_total_d1,
        (COUNT(*) FILTER (WHERE  qualification::text = 'MQL'                                    AND created_at::date = CURRENT_DATE - 1))::int        AS td_sql_d1,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 2))::int        AS td_total_d2,
        (COUNT(*) FILTER (WHERE  qualification::text = 'MQL'                                    AND created_at::date = CURRENT_DATE - 2))::int        AS td_sql_d2,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 3))::int        AS td_total_d3,
        (COUNT(*) FILTER (WHERE  qualification::text = 'MQL'                                    AND created_at::date = CURRENT_DATE - 3))::int        AS td_sql_d3,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 4))::int        AS td_total_d4,
        (COUNT(*) FILTER (WHERE  qualification::text = 'MQL'                                    AND created_at::date = CURRENT_DATE - 4))::int        AS td_sql_d4,
        -- WoW: per-week total and MQL lead counts
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date      AND created_at::date <= date_trunc('week', CURRENT_DATE)::date + 6))::int AS wow_leads_w0,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date      AND created_at::date <= date_trunc('week', CURRENT_DATE)::date + 6))::int AS wow_sql_w0,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 7  AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 1))::int  AS wow_leads_w1,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 7  AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 1))::int  AS wow_sql_w1,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 14 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 8))::int   AS wow_leads_w2,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 14 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 8))::int   AS wow_sql_w2,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 21 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 15))::int  AS wow_leads_w3,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 21 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 15))::int  AS wow_sql_w3,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 28 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 22))::int  AS wow_leads_w4,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 28 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 22))::int  AS wow_sql_w4,
        -- MoM: per-calendar-month counts (total / MQL / meeting_booked / won)
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('month', CURRENT_DATE)::date                                AND created_at::date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))::int AS mom_total_m0,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE)::date AND created_at::date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))::int AS mom_sql_m0,
        (COUNT(*) FILTER (WHERE meeting_booked = true        AND created_at::date >= date_trunc('month', CURRENT_DATE)::date AND created_at::date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))::int AS mom_mtg_m0,
        (COUNT(*) FILTER (WHERE won = true                   AND created_at::date >= date_trunc('month', CURRENT_DATE)::date AND created_at::date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))::int AS mom_won_m0,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date            AND created_at::date <  date_trunc('month', CURRENT_DATE)::date))::int                                           AS mom_total_m1,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AND created_at::date <  date_trunc('month', CURRENT_DATE)::date))::int                      AS mom_sql_m1,
        (COUNT(*) FILTER (WHERE meeting_booked = true        AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AND created_at::date <  date_trunc('month', CURRENT_DATE)::date))::int                      AS mom_mtg_m1,
        (COUNT(*) FILTER (WHERE won = true                   AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date AND created_at::date <  date_trunc('month', CURRENT_DATE)::date))::int                      AS mom_won_m1,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date))::int                      AS mom_total_m2,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date))::int AS mom_sql_m2,
        (COUNT(*) FILTER (WHERE meeting_booked = true        AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date))::int AS mom_mtg_m2,
        (COUNT(*) FILTER (WHERE won = true                   AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date))::int AS mom_won_m2,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date))::int                     AS mom_total_m3,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date))::int AS mom_sql_m3,
        (COUNT(*) FILTER (WHERE meeting_booked = true        AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date))::int AS mom_mtg_m3,
        (COUNT(*) FILTER (WHERE won = true                   AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date))::int AS mom_won_m3,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date))::int                     AS mom_total_m4,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date))::int AS mom_sql_m4,
        (COUNT(*) FILTER (WHERE meeting_booked = true        AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date))::int AS mom_mtg_m4,
        (COUNT(*) FILTER (WHERE won = true                   AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')::date AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date))::int AS mom_won_m4
      FROM leads
      GROUP BY client_id
    `);

    // Per-channel lead split (ADR-0012 sequencer ids). One row per (client, sequencer) for the
    // two channels the mega-table splits; the blended Total stays in leadSummaryRows above. Only
    // the metrics the team asked to split are computed here (3-DoD total+sql, WoW leads+sql, MoM
    // sql) — MoM total/meetings/won stay blended by design. Windows copy leadSummaryRows exactly.
    const leadChannelRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        client_id,
        sequencer_id::text AS sequencer_id,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE))::int     AS td_total_d0,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 1))::int AS td_total_d1,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 2))::int AS td_total_d2,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 3))::int AS td_total_d3,
        (COUNT(*) FILTER (WHERE (qualification::text = 'MQL' OR qualification::text = 'preMQL') AND created_at::date = CURRENT_DATE - 4))::int AS td_total_d4,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date = CURRENT_DATE))::int     AS td_sql_d0,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date = CURRENT_DATE - 1))::int AS td_sql_d1,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date = CURRENT_DATE - 2))::int AS td_sql_d2,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date = CURRENT_DATE - 3))::int AS td_sql_d3,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date = CURRENT_DATE - 4))::int AS td_sql_d4,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date      AND created_at::date <= date_trunc('week', CURRENT_DATE)::date + 6))::int AS wow_leads_w0,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 7  AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 1))::int  AS wow_leads_w1,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 14 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 8))::int   AS wow_leads_w2,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 21 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 15))::int  AS wow_leads_w3,
        (COUNT(*) FILTER (WHERE created_at::date >= date_trunc('week', CURRENT_DATE)::date - 28 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 22))::int  AS wow_leads_w4,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date      AND created_at::date <= date_trunc('week', CURRENT_DATE)::date + 6))::int AS wow_sql_w0,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 7  AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 1))::int  AS wow_sql_w1,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 14 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 8))::int   AS wow_sql_w2,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 21 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 15))::int  AS wow_sql_w3,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('week', CURRENT_DATE)::date - 28 AND created_at::date <= date_trunc('week', CURRENT_DATE)::date - 22))::int  AS wow_sql_w4,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE)::date                                AND created_at::date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date))::int AS mom_sql_m0,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date            AND created_at::date <  date_trunc('month', CURRENT_DATE)::date))::int                                           AS mom_sql_m1,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '1 month')::date))::int                      AS mom_sql_m2,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '2 months')::date))::int                      AS mom_sql_m3,
        (COUNT(*) FILTER (WHERE qualification::text = 'MQL' AND created_at::date >= date_trunc('month', CURRENT_DATE - INTERVAL '4 months')::date           AND created_at::date <  date_trunc('month', CURRENT_DATE - INTERVAL '3 months')::date))::int                      AS mom_sql_m4
      FROM leads
      WHERE sequencer_id = '00000000-0000-4000-a000-000000000002'::uuid
         OR sequencer_id = '00000000-0000-4000-a000-000000000003'::uuid
      GROUP BY client_id, sequencer_id
    `);

    // Aimfox daily sequencer stats (sequencer_daily_stats, ADR-0012), summed across the client's
    // enabled LinkedIn profiles. The '__workspace_total__' sentinel is excluded so a Sheets-backfill
    // workspace row never double-counts against per-profile rows (see 20260722h migration). Daily
    // sent buckets use fixed CURRENT_DATE offsets to line up with the Bison daily_sent columns;
    // schedule + capacity are read from each client's LATEST report_date (the 2-hourly snapshot),
    // so a client whose today-row has not landed yet still shows its most recent capacity.
    const aimfoxSummaryRows = await rawQuery<Record<string, unknown>>(tx, sql`
      WITH af AS (
        SELECT sds.client_id, sds.report_date,
               sds.invites_sent, sds.invites_accepted,
               sds.schedule_today, sds.schedule_tomorrow, sds.schedule_day_after,
               sds.invite_limit, sds.invite_limit_remaining, sds.remaining_database_size
        FROM sequencer_daily_stats sds
        JOIN sequencers s ON s.id = sds.sequencer_id AND s.key = 'aimfox'
        WHERE sds.profile_id <> '__workspace_total__'
          AND sds.report_date >= CURRENT_DATE - 45
      ),
      latest AS (SELECT client_id, MAX(report_date) AS d FROM af GROUP BY client_id)
      SELECT
        af.client_id,
        COALESCE(SUM(invites_sent) FILTER (WHERE report_date = CURRENT_DATE), 0)::int     AS af_sent_d0,
        COALESCE(SUM(invites_sent) FILTER (WHERE report_date = CURRENT_DATE - 1), 0)::int AS af_sent_d1,
        COALESCE(SUM(invites_sent) FILTER (WHERE report_date = CURRENT_DATE - 2), 0)::int AS af_sent_d2,
        COALESCE(SUM(invites_sent) FILTER (WHERE report_date = CURRENT_DATE - 3), 0)::int AS af_sent_d3,
        COALESCE(SUM(invites_sent) FILTER (WHERE report_date = CURRENT_DATE - 4), 0)::int AS af_sent_d4,
        COALESCE(SUM(invites_sent)     FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date      AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6), 0)::int AS af_sent_w0,
        COALESCE(SUM(invites_sent)     FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1), 0)::int  AS af_sent_w1,
        COALESCE(SUM(invites_sent)     FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8),  0)::int  AS af_sent_w2,
        COALESCE(SUM(invites_sent)     FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15), 0)::int  AS af_sent_w3,
        COALESCE(SUM(invites_sent)     FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22), 0)::int  AS af_sent_w4,
        (SUM(invites_accepted) FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date      AND report_date <= date_trunc('week', CURRENT_DATE)::date + 6))::int  AS af_acc_w0,
        (SUM(invites_accepted) FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 7  AND report_date <= date_trunc('week', CURRENT_DATE)::date - 1))::int   AS af_acc_w1,
        (SUM(invites_accepted) FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 14 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 8))::int    AS af_acc_w2,
        (SUM(invites_accepted) FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 21 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 15))::int   AS af_acc_w3,
        (SUM(invites_accepted) FILTER (WHERE report_date >= date_trunc('week', CURRENT_DATE)::date - 28 AND report_date <= date_trunc('week', CURRENT_DATE)::date - 22))::int   AS af_acc_w4,
        COALESCE(SUM(schedule_today)     FILTER (WHERE report_date = lt.d), 0)::int AS af_sched_today,
        COALESCE(SUM(schedule_tomorrow)  FILTER (WHERE report_date = lt.d), 0)::int AS af_sched_tomorrow,
        COALESCE(SUM(schedule_day_after) FILTER (WHERE report_date = lt.d), 0)::int AS af_sched_day_after,
        (SUM(invite_limit)            FILTER (WHERE report_date = lt.d))::int AS af_invite_limit,
        (SUM(invite_limit_remaining)  FILTER (WHERE report_date = lt.d))::int AS af_invite_limit_remaining,
        (SUM(remaining_database_size) FILTER (WHERE report_date = lt.d))::int AS af_remaining_db
      FROM af
      JOIN latest lt ON lt.client_id = af.client_id
      GROUP BY af.client_id, lt.d
    `);

    const durationMs = performance.now() - t0;
    console.log(
      `[PERF][orm-gateway] loadClientsMetricsSummary: ${durationMs.toFixed(1)}ms ` +
        `(dailyStatClients=${dailySummaryRows.length}, leadClients=${leadSummaryRows.length}, ` +
        `leadChannelRows=${leadChannelRows.length}, aimfoxClients=${aimfoxSummaryRows.length})`,
    );

    // Merge daily-stats and leads summaries by client_id into compact per-client objects.
    const dailyByClient = new Map<string, Record<string, unknown>>();
    for (const row of dailySummaryRows) {
      if (typeof row.client_id === "string") dailyByClient.set(row.client_id, row);
    }
    const leadByClient = new Map<string, Record<string, unknown>>();
    for (const row of leadSummaryRows) {
      if (typeof row.client_id === "string") leadByClient.set(row.client_id, row);
    }
    // Per-channel lead rows pivot to one map per channel (up to one row per client each).
    const ebByClient = new Map<string, Record<string, unknown>>();
    const afLeadByClient = new Map<string, Record<string, unknown>>();
    for (const row of leadChannelRows) {
      if (typeof row.client_id !== "string") continue;
      if (row.sequencer_id === EMAILBISON_SEQ) ebByClient.set(row.client_id, row);
      else if (row.sequencer_id === AIMFOX_SEQ) afLeadByClient.set(row.client_id, row);
    }
    const aimfoxByClient = new Map<string, Record<string, unknown>>();
    for (const row of aimfoxSummaryRows) {
      if (typeof row.client_id === "string") aimfoxByClient.set(row.client_id, row);
    }

    const allClientIds = new Set([
      ...dailyByClient.keys(),
      ...leadByClient.keys(),
      ...aimfoxByClient.keys(),
    ]);
    const summaries = Array.from(allClientIds).map((clientId) => {
      const d = dailyByClient.get(clientId) ?? {};
      const l = leadByClient.get(clientId) ?? {};
      const eb = ebByClient.get(clientId) ?? {};
      const af = afLeadByClient.get(clientId) ?? {};
      const ax = aimfoxByClient.get(clientId) ?? {};
      return {
        client_id: clientId,
        daily_sent:         [toInt(d.sent_d0),    toInt(d.sent_d1),    toInt(d.sent_d2),    toInt(d.sent_d3),    toInt(d.sent_d4)],
        schedule_today:      toInt(d.sched_today),
        schedule_tomorrow:   toInt(d.sched_tomorrow),
        schedule_day_after:  toInt(d.sched_day_after),
        wow_sent:           [toInt(d.wow_sent_w0),   toInt(d.wow_sent_w1),   toInt(d.wow_sent_w2),   toInt(d.wow_sent_w3),   toInt(d.wow_sent_w4)],
        wow_human:          [toInt(d.wow_human_w0),  toInt(d.wow_human_w1),  toInt(d.wow_human_w2),  toInt(d.wow_human_w3),  toInt(d.wow_human_w4)],
        wow_bounce:         [toInt(d.wow_bounce_w0), toInt(d.wow_bounce_w1), toInt(d.wow_bounce_w2), toInt(d.wow_bounce_w3), toInt(d.wow_bounce_w4)],
        wow_ooo:            [toInt(d.wow_ooo_w0),    toInt(d.wow_ooo_w1),    toInt(d.wow_ooo_w2),    toInt(d.wow_ooo_w3),    toInt(d.wow_ooo_w4)],
        wow_negative:       [toInt(d.wow_neg_w0),    toInt(d.wow_neg_w1),    toInt(d.wow_neg_w2),    toInt(d.wow_neg_w3),    toInt(d.wow_neg_w4)],
        wow_leads:          [toInt(l.wow_leads_w0),  toInt(l.wow_leads_w1),  toInt(l.wow_leads_w2),  toInt(l.wow_leads_w3),  toInt(l.wow_leads_w4)],
        wow_sql:            [toInt(l.wow_sql_w0),    toInt(l.wow_sql_w1),    toInt(l.wow_sql_w2),    toInt(l.wow_sql_w3),    toInt(l.wow_sql_w4)],
        mom_total:          [toInt(l.mom_total_m0),  toInt(l.mom_total_m1),  toInt(l.mom_total_m2),  toInt(l.mom_total_m3),  toInt(l.mom_total_m4)],
        mom_sql:            [toInt(l.mom_sql_m0),    toInt(l.mom_sql_m1),    toInt(l.mom_sql_m2),    toInt(l.mom_sql_m3),    toInt(l.mom_sql_m4)],
        mom_meetings:       [toInt(l.mom_mtg_m0),    toInt(l.mom_mtg_m1),    toInt(l.mom_mtg_m2),    toInt(l.mom_mtg_m3),    toInt(l.mom_mtg_m4)],
        mom_won:            [toInt(l.mom_won_m0),    toInt(l.mom_won_m1),    toInt(l.mom_won_m2),    toInt(l.mom_won_m3),    toInt(l.mom_won_m4)],
        threedod_total:     [toInt(l.td_total_d0),   toInt(l.td_total_d1),   toInt(l.td_total_d2),   toInt(l.td_total_d3),   toInt(l.td_total_d4)],
        threedod_sql:       [toInt(l.td_sql_d0),     toInt(l.td_sql_d1),     toInt(l.td_sql_d2),     toInt(l.td_sql_d3),     toInt(l.td_sql_d4)],
        latest_prospects_count: toInt(d.latest_prospects),
        // ── Per-channel lead splits (Total above stays blended) ──────────────────────────────
        threedod_total_eb:  [toInt(eb.td_total_d0),  toInt(eb.td_total_d1),  toInt(eb.td_total_d2),  toInt(eb.td_total_d3),  toInt(eb.td_total_d4)],
        threedod_total_af:  [toInt(af.td_total_d0),  toInt(af.td_total_d1),  toInt(af.td_total_d2),  toInt(af.td_total_d3),  toInt(af.td_total_d4)],
        threedod_sql_eb:    [toInt(eb.td_sql_d0),    toInt(eb.td_sql_d1),    toInt(eb.td_sql_d2),    toInt(eb.td_sql_d3),    toInt(eb.td_sql_d4)],
        threedod_sql_af:    [toInt(af.td_sql_d0),    toInt(af.td_sql_d1),    toInt(af.td_sql_d2),    toInt(af.td_sql_d3),    toInt(af.td_sql_d4)],
        wow_leads_eb:       [toInt(eb.wow_leads_w0), toInt(eb.wow_leads_w1), toInt(eb.wow_leads_w2), toInt(eb.wow_leads_w3), toInt(eb.wow_leads_w4)],
        wow_leads_af:       [toInt(af.wow_leads_w0), toInt(af.wow_leads_w1), toInt(af.wow_leads_w2), toInt(af.wow_leads_w3), toInt(af.wow_leads_w4)],
        wow_sql_eb:         [toInt(eb.wow_sql_w0),   toInt(eb.wow_sql_w1),   toInt(eb.wow_sql_w2),   toInt(eb.wow_sql_w3),   toInt(eb.wow_sql_w4)],
        wow_sql_af:         [toInt(af.wow_sql_w0),   toInt(af.wow_sql_w1),   toInt(af.wow_sql_w2),   toInt(af.wow_sql_w3),   toInt(af.wow_sql_w4)],
        mom_sql_eb:         [toInt(eb.mom_sql_m0),   toInt(eb.mom_sql_m1),   toInt(eb.mom_sql_m2),   toInt(eb.mom_sql_m3),   toInt(eb.mom_sql_m4)],
        mom_sql_af:         [toInt(af.mom_sql_m0),   toInt(af.mom_sql_m1),   toInt(af.mom_sql_m2),   toInt(af.mom_sql_m3),   toInt(af.mom_sql_m4)],
        // ── Aimfox daily volume / acceptance / capacity (summed across profiles) ─────────────
        aimfox_daily_sent:  [toInt(ax.af_sent_d0),   toInt(ax.af_sent_d1),   toInt(ax.af_sent_d2),   toInt(ax.af_sent_d3),   toInt(ax.af_sent_d4)],
        aimfox_schedule_today:     toInt(ax.af_sched_today),
        aimfox_schedule_tomorrow:  toInt(ax.af_sched_tomorrow),
        aimfox_schedule_day_after: toInt(ax.af_sched_day_after),
        aimfox_wow_sent:    [toInt(ax.af_sent_w0),   toInt(ax.af_sent_w1),   toInt(ax.af_sent_w2),   toInt(ax.af_sent_w3),   toInt(ax.af_sent_w4)],
        aimfox_wow_accepted: [toIntOrNull(ax.af_acc_w0), toIntOrNull(ax.af_acc_w1), toIntOrNull(ax.af_acc_w2), toIntOrNull(ax.af_acc_w3), toIntOrNull(ax.af_acc_w4)],
        aimfox_invite_limit:            toIntOrNull(ax.af_invite_limit),
        aimfox_invite_limit_remaining:  toIntOrNull(ax.af_invite_limit_remaining),
        aimfox_remaining_database_size: toIntOrNull(ax.af_remaining_db),
      };
    });

    const estimatedBytes = JSON.stringify(summaries).length;
    console.log(
      `[PERF][orm-gateway] loadClientsMetricsSummary payload: clients=${summaries.length} ` +
        `estimatedBytes=${estimatedBytes} (${(estimatedBytes / 1024).toFixed(1)} KB) ` +
        `durationMs=${durationMs.toFixed(1)}`,
    );

    return {
      summaries,
      _meta: {
        clientsCount: summaries.length,
        dailyStatsRowsRead: dailySummaryRows.length,
        leadRowsRead: leadSummaryRows.length,
        computedAt: new Date().toISOString(),
      },
    };
  }

  // ── Phase 4: server-side leads pagination ───────────────────────────────────────────────────

  if (payload.action === "loadLeadsList") {
    const p = payload.params;
    const t0 = performance.now();
    const pageSize = Math.min(Math.max(1, p.pageSize ?? 50), 100);
    const offset = (Math.max(1, p.page ?? 1) - 1) * pageSize;

    // Log SQL shape for per-query profiling in edge function logs.
    console.log(
      `[PERF][orm-gateway] loadLeadsList shape: ` +
        `hasSearch=${!!p.search} hasClientFilter=${!!p.clientId} hasCampaignFilter=${!!p.campaignId} ` +
        `hasStageFilter=${!!p.stage} ` +
        `sortField=${p.sortField} page=${p.page} pageSize=${pageSize}`,
    );

    // Shared SQL stage CASE expression — mirrors getLeadStage in selectors.ts.
    // ::text cast on the ELSE branch forces the whole expression to resolve as text,
    // preventing Postgres from inferring the return type as lead_qualification enum
    // (which would reject 'unqualified' and 'meeting_scheduled' as invalid members).
    const stageExpr = sql`
      CASE
        WHEN l.won = true THEN 'won'
        WHEN l.offer_sent = true THEN 'offer_sent'
        WHEN l.meeting_held = true THEN 'meeting_held'
        WHEN l.meeting_booked = true THEN 'meeting_scheduled'
        WHEN l.qualification IS NULL THEN 'unqualified'
        ELSE l.qualification::text
      END
    `;

    // Build dynamic WHERE fragments (applied in both count and data queries).
    const baseWhereParts: ReturnType<typeof sql>[] = [];
    if (p.clientId) baseWhereParts.push(sql`l.client_id = ${p.clientId}`);
    if (p.campaignId) baseWhereParts.push(sql`l.campaign_id = ${p.campaignId}`);
    if (p.dateFrom) baseWhereParts.push(sql`l.created_at >= ${p.dateFrom}`);
    if (p.dateTo) baseWhereParts.push(sql`l.created_at <= ${p.dateTo}`);
    if (p.search) {
      const needle = `%${p.search.toLowerCase()}%`;
      baseWhereParts.push(sql`(
        LOWER(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.email, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.company_name, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.job_title, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.country, '')) LIKE ${needle}
      )`);
    }

    const baseWhereClause = baseWhereParts.length > 0
      ? sql`WHERE ${sql.join(baseWhereParts, sql` AND `)}`
      : sql``;

    // Stage filter applied to data query only (not stage count — counts reflect all stages).
    // Build a combined WHERE clause that safely merges base conditions with the stage predicate.
    // If baseWhereParts is empty and a stage is set, we must emit WHERE (not AND) to avoid
    // generating "AND (...) = '...' " without a preceding WHERE — which is invalid SQL and
    // causes the gateway to error when a manager filters by MQL/preMQL without other filters.
    const dataWhereParts = p.stage
      ? [...baseWhereParts, sql`(${stageExpr}) = ${p.stage}`]
      : baseWhereParts;
    const dataWhereClause = dataWhereParts.length > 0
      ? sql`WHERE ${sql.join(dataWhereParts, sql` AND `)}`
      : sql``;

    // Sort ORDER BY clause.
    const dirSql = p.sortDir === "asc" ? sql`ASC` : sql`DESC`;
    const dirSqlTie = sql`ASC`; // tie-breaker always ASC for stability
    let orderClause: ReturnType<typeof sql>;
    if (p.sortField === "lead") {
      orderClause = sql`ORDER BY LOWER(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "client") {
      orderClause = sql`ORDER BY LOWER(c.name) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "company") {
      orderClause = sql`ORDER BY LOWER(COALESCE(l.company_name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "status") {
      orderClause = sql`ORDER BY (${stageExpr}) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "campaign") {
      orderClause = sql`ORDER BY LOWER(COALESCE(camp.name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "step") {
      orderClause = sql`ORDER BY l.message_number ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    } else if (p.sortField === "replies") {
      orderClause = sql`ORDER BY reply_count ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "lastReply") {
      orderClause = sql`ORDER BY last_reply_at ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    } else {
      // "created" and any unknown field defaults to created_at
      orderClause = sql`ORDER BY l.created_at ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    }

    // Stage count — clients JOIN for RLS; campaigns JOIN removed (unused in stage CASE).
    // GROUP BY 1 references the first SELECT column by ordinal — avoids the non-portable
    // "GROUP BY <alias>" form rejected by the Supabase Postgres version.
    const tStage0 = performance.now();
    const stageCountRows = await rawQuery<{ stage: string; count: number }>(tx, sql`
      SELECT (${stageExpr}) AS stage, COUNT(*)::int AS count
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      ${baseWhereClause}
      GROUP BY 1
    `);
    const stageCountMs = performance.now() - tStage0;

    // Data page — set-based reply aggregation via lateral subquery avoids per-row correlation.
    const tData0 = performance.now();
    const dataRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        l.id, l.created_at, l.updated_at, l.client_id,
        l.campaign_id, l.email, l.first_name, l.last_name, l.job_title,
        l.company_name, l.linkedin_url, l.gender, l.qualification,
        l.external_id, l.phone_number, l.phone_source,
        l.industry, l.headcount_range, l.website, l.country,
        l.message_title, l.message_number, l.response_time_hours, l.response_time_label,
        l.meeting_booked, l.meeting_held, l.offer_sent, l.won,
        l.external_blacklist_id, l.external_domain_blacklist_id,
        l.source, l.reply_text, l.client_note, l.highlight,
        -- coldunicorn_note is internal-only: never expose it to the client role. We resolve the
        -- caller role via a public.users self-lookup (RLS returns only the caller own row).
        -- NOTE: do NOT call private.current_app_role() here - the authenticated role has no USAGE
        -- on the private schema for direct (non-RLS-predicate) calls, which throws 42501.
        CASE WHEN (
          SELECT u.role FROM public.users u
          WHERE u.id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        ) = 'client' THEN NULL ELSE l.coldunicorn_note END AS coldunicorn_note,
        c.name AS client_name,
        camp.name AS campaign_name,
        COALESCE(r.reply_count, 0)::int AS reply_count,
        r.last_reply_at
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN (
        SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
        FROM replies GROUP BY lead_id
      ) r ON r.lead_id = l.id
      ${dataWhereClause}
      ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    const dataMs = performance.now() - tData0;

    const stageCounts: Record<string, number> = {};
    let totalCount = 0;
    for (const row of stageCountRows) {
      stageCounts[String(row.stage)] = row.count ?? 0;
      totalCount += row.count ?? 0;
    }

    const rows = dataRows.map((r) => ({
      id: String(r.id),
      created_at: r.created_at ? toIsoString(r.created_at) ?? "" : "",
      updated_at: r.updated_at ? toIsoString(r.updated_at) ?? "" : "",
      client_id: String(r.client_id),
      campaign_id: r.campaign_id ? String(r.campaign_id) : null,
      email: r.email ? String(r.email) : null,
      first_name: r.first_name ? String(r.first_name) : null,
      last_name: r.last_name ? String(r.last_name) : null,
      job_title: r.job_title ? String(r.job_title) : null,
      company_name: r.company_name ? String(r.company_name) : null,
      linkedin_url: r.linkedin_url ? String(r.linkedin_url) : null,
      gender: r.gender ? String(r.gender) : null,
      qualification: r.qualification ? String(r.qualification) : null,
      external_id: r.external_id ? String(r.external_id) : null,
      phone_number: r.phone_number ? String(r.phone_number) : null,
      phone_source: r.phone_source ? String(r.phone_source) : null,
      industry: r.industry ? String(r.industry) : null,
      headcount_range: r.headcount_range ? String(r.headcount_range) : null,
      website: r.website ? String(r.website) : null,
      country: r.country ? String(r.country) : null,
      message_title: r.message_title ? String(r.message_title) : null,
      message_number: r.message_number != null ? Number(r.message_number) : null,
      response_time_hours: r.response_time_hours != null ? Number(r.response_time_hours) : null,
      response_time_label: r.response_time_label ? String(r.response_time_label) : null,
      meeting_booked: Boolean(r.meeting_booked),
      meeting_held: Boolean(r.meeting_held),
      offer_sent: Boolean(r.offer_sent),
      won: Boolean(r.won),
      external_blacklist_id: r.external_blacklist_id != null ? Number(r.external_blacklist_id) : null,
      external_domain_blacklist_id: r.external_domain_blacklist_id != null ? Number(r.external_domain_blacklist_id) : null,
      source: r.source ? String(r.source) : "cold_email",
      reply_text: r.reply_text ? String(r.reply_text) : null,
      client_note: r.client_note ? String(r.client_note) : null,
      coldunicorn_note: r.coldunicorn_note ? String(r.coldunicorn_note) : null,
      highlight: r.highlight ? String(r.highlight) : null,
      // JOINed fields
      clientName: String(r.client_name ?? ""),
      campaignName: r.campaign_name ? String(r.campaign_name) : null,
      replyCount: Number(r.reply_count ?? 0),
      lastReplyAt: r.last_reply_at ? toIsoString(r.last_reply_at) : null,
    }));

    // Custom columns (Batch 4, Task 4F): definitions for the clients owning the returned rows,
    // and values for the returned leads only — keeps the payload scoped to what is on screen.
    const pageClientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const pageLeadIds = rows.map((r) => r.id);
    let customFields: Record<string, unknown>[] = [];
    let customValues: Record<string, unknown>[] = [];
    if (pageClientIds.length > 0) {
      customFields = await safeRawSelect(
        tx,
        sql`select id, client_id, name, field_type, options, position, editable_by, created_by, created_at
            from public.lead_custom_fields
            where client_id in (${sql.join(pageClientIds.map((id) => sql`${id}`), sql`, `)})
            order by position asc, created_at asc`,
      );
    }
    if (pageLeadIds.length > 0) {
      customValues = await safeRawSelect(
        tx,
        sql`select lead_id, field_id, value from public.lead_custom_field_values
            where lead_id in (${sql.join(pageLeadIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    }

    const totalHandlerMs = performance.now() - t0;
    console.log(
      `[PERF][orm-gateway] loadLeadsList: totalHandlerMs=${totalHandlerMs.toFixed(1)} ` +
        `stageCountsQueryMs=${stageCountMs.toFixed(1)} dataPageQueryMs=${dataMs.toFixed(1)} ` +
        `rows=${rows.length} totalCount=${totalCount} stageBuckets=${stageCountRows.length} ` +
        `customFields=${customFields.length} customValues=${customValues.length} ` +
        `page=${p.page} pageSize=${pageSize}`,
    );

    return {
      rows,
      totalCount,
      stageCounts,
      customFields: customFields.map(toLeadCustomFieldRecord),
      customValues: customValues.map((r) => ({
        lead_id: String(r.lead_id),
        field_id: String(r.field_id),
        value: r.value === null || r.value === undefined ? null : String(r.value),
      })),
    };
  }

  if (payload.action === "loadLeadCrmList") {
    // CRM view read-model (ADR-0013): loadLeadsList's filter/sort/pagination + joined child records.
    // Health colours + resolved status are FORMULAS the client computes from these facts + `asOf`.
    const p = payload.params;
    const t0 = performance.now();
    const pageSize = Math.min(Math.max(1, p.pageSize ?? 50), 100);
    const offset = (Math.max(1, p.page ?? 1) - 1) * pageSize;

    // Resolve the caller's app role AND the server clock ONCE. The role lets us null internal-only CRM
    // fields for the client role in the TS mapping (ADR-0013 §6) instead of an inline CASE per column
    // (private.current_app_role() is unusable here — authenticated lacks USAGE). `now()` is the DB
    // transaction clock: asOf must share the clock that wrote the child timestamps so health deadline
    // math is not thrown off by edge-runtime clock skew.
    const ctxRows = await rawQuery<{ role: string | null; server_now: unknown }>(tx, sql`
      SELECT
        (SELECT u.role FROM public.users u WHERE u.id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid) AS role,
        now() AS server_now
    `);
    const isClient = ctxRows[0]?.role === "client";
    // Normalize the DB clock to strict ISO — postgres.js may hand back `now()` as a raw
    // "YYYY-MM-DD HH:MM:SS+00" string (toIsoString only ISO-formats Date instances), and the health
    // evaluator's contract is an ISO `asOf`.
    const parsedNow = ctxRows[0]?.server_now ? new Date(String(ctxRows[0].server_now)) : null;
    const asOf = parsedNow && !Number.isNaN(parsedNow.getTime()) ? parsedNow.toISOString() : new Date().toISOString();

    const stageExpr = sql`
      CASE
        WHEN l.won = true THEN 'won'
        WHEN l.offer_sent = true THEN 'offer_sent'
        WHEN l.meeting_held = true THEN 'meeting_held'
        WHEN l.meeting_booked = true THEN 'meeting_scheduled'
        WHEN l.qualification IS NULL THEN 'unqualified'
        ELSE l.qualification::text
      END
    `;

    const baseWhereParts: ReturnType<typeof sql>[] = [];
    if (p.clientId) baseWhereParts.push(sql`l.client_id = ${p.clientId}`);
    if (p.campaignId) baseWhereParts.push(sql`l.campaign_id = ${p.campaignId}`);
    if (p.dateFrom) baseWhereParts.push(sql`l.created_at >= ${p.dateFrom}`);
    if (p.dateTo) baseWhereParts.push(sql`l.created_at <= ${p.dateTo}`);
    if (p.search) {
      const needle = `%${p.search.toLowerCase()}%`;
      baseWhereParts.push(sql`(
        LOWER(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.email, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.company_name, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.job_title, '')) LIKE ${needle}
        OR LOWER(COALESCE(l.country, '')) LIKE ${needle}
      )`);
    }
    const baseWhereClause = baseWhereParts.length > 0 ? sql`WHERE ${sql.join(baseWhereParts, sql` AND `)}` : sql``;
    const dataWhereParts = p.stage ? [...baseWhereParts, sql`(${stageExpr}) = ${p.stage}`] : baseWhereParts;
    const dataWhereClause = dataWhereParts.length > 0 ? sql`WHERE ${sql.join(dataWhereParts, sql` AND `)}` : sql``;

    const dirSql = p.sortDir === "asc" ? sql`ASC` : sql`DESC`;
    const dirSqlTie = sql`ASC`;
    let orderClause: ReturnType<typeof sql>;
    if (p.sortField === "lead") {
      orderClause = sql`ORDER BY LOWER(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "client") {
      orderClause = sql`ORDER BY LOWER(c.name) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "company") {
      orderClause = sql`ORDER BY LOWER(COALESCE(l.company_name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "status") {
      orderClause = sql`ORDER BY (${stageExpr}) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "campaign") {
      orderClause = sql`ORDER BY LOWER(COALESCE(camp.name, '')) ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "step") {
      orderClause = sql`ORDER BY l.message_number ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    } else if (p.sortField === "replies") {
      orderClause = sql`ORDER BY reply_count ${dirSql}, l.id ${dirSqlTie}`;
    } else if (p.sortField === "lastReply") {
      orderClause = sql`ORDER BY last_reply_at ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    } else {
      orderClause = sql`ORDER BY l.created_at ${dirSql} NULLS LAST, l.id ${dirSqlTie}`;
    }

    const stageCountRows = await rawQuery<{ stage: string; count: number }>(tx, sql`
      SELECT (${stageExpr}) AS stage, COUNT(*)::int AS count
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      ${baseWhereClause}
      GROUP BY 1
    `);

    // One flat data query. Child cardinality is bounded (intro/summary unique per lead; LATERAL
    // LIMIT 1 for current offer / next task; deliveries unique per sequence) → no N+1, no row fan-out.
    const dataRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        l.id, l.created_at, l.updated_at, l.client_id,
        l.campaign_id, l.email, l.first_name, l.last_name, l.job_title,
        l.company_name, l.linkedin_url, l.gender, l.qualification,
        l.external_id, l.phone_number, l.phone_source,
        l.industry, l.headcount_range, l.website, l.country,
        l.message_title, l.message_number, l.response_time_hours, l.response_time_label,
        l.meeting_booked, l.meeting_held, l.offer_sent, l.won,
        l.external_blacklist_id, l.external_domain_blacklist_id,
        l.source, l.reply_text, l.client_note, l.highlight, l.sequencer_id,
        l.linkedin_invitation_sent_at, l.contact_made_at, l.contact_method,
        l.negotiation_started_at, l.concluded_at, l.final_outcome,
        -- coldunicorn_note + conclusion are internal-only; nulled for the client role in TS via isClient.
        l.coldunicorn_note, l.conclusion,
        c.name AS client_name,
        camp.name AS campaign_name,
        COALESCE(r.reply_count, 0)::int AS reply_count,
        r.last_reply_at,
        im.status AS intro_status, im.scheduled_at AS intro_scheduled_at, im.held_at AS intro_held_at,
        im.call_script AS intro_call_script, im.transcription_url AS intro_transcription_url,
        im.pre_meeting_insights AS intro_pre_meeting_insights, im.process_score AS intro_process_score,
        im.conversion_insights AS intro_conversion_insights,
        sm.status AS summary_status, sm.scheduled_at AS summary_scheduled_at, sm.held_at AS summary_held_at,
        sm.call_script AS summary_call_script, sm.transcription_url AS summary_transcription_url,
        sm.pre_meeting_insights AS summary_pre_meeting_insights, sm.process_score AS summary_process_score,
        sm.conversion_insights AS summary_conversion_insights,
        co.status AS offer_status, co.contracted_send_date AS offer_contracted_send_date,
        ot.open_tasks,
        d1.planned_date AS d1_planned_date, d1.value_items AS d1_value_items, d1.sent_at AS d1_sent_at,
        d2.planned_date AS d2_planned_date, d2.value_items AS d2_value_items, d2.sent_at AS d2_sent_at,
        -- LinkedIn (Aimfox) integration applicability for col I (spec item 5): an Aimfox credential with
        -- an api_key on the owning client. RLS-scoped like every other read in this transaction.
        EXISTS (
          SELECT 1 FROM client_sequencers cs
          WHERE cs.client_id = l.client_id
            AND cs.sequencer_id = '00000000-0000-4000-a000-000000000003'
            AND cs.api_key IS NOT NULL
        ) AS linkedin_integration_connected
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN (
        SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
        FROM replies GROUP BY lead_id
      ) r ON r.lead_id = l.id
      LEFT JOIN lead_meetings im ON im.lead_id = l.id AND im.meeting_type = 'intro'
      LEFT JOIN lead_meetings sm ON sm.lead_id = l.id AND sm.meeting_type = 'summary'
      LEFT JOIN LATERAL (
        SELECT o.status, o.contracted_send_date FROM lead_offers o
        WHERE o.lead_id = l.id AND o.status <> 'cancelled'
        ORDER BY o.created_at DESC LIMIT 1
      ) co ON TRUE
      LEFT JOIN LATERAL (
        -- Open tasks as an ordered list (spec col Y). next_task_due_at + open_tasks_count are derived
        -- from the first element / length in TS, so the ordering here is the single source of truth.
        SELECT COALESCE(
          json_agg(
            json_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'status', t.status, 'position', t.position)
            ORDER BY t.due_at ASC NULLS LAST, t.position ASC, t.created_at ASC
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::json
        ) AS open_tasks
        FROM lead_tasks t
        WHERE t.lead_id = l.id AND t.status IN ('planned', 'in_progress')
      ) ot ON TRUE
      LEFT JOIN lead_value_deliveries d1 ON d1.lead_id = l.id AND d1.sequence_number = 1
      LEFT JOIN lead_value_deliveries d2 ON d2.lead_id = l.id AND d2.sequence_number = 2
      ${dataWhereClause}
      ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const stageCounts: Record<string, number> = {};
    let totalCount = 0;
    for (const row of stageCountRows) {
      stageCounts[String(row.stage)] = row.count ?? 0;
      totalCount += row.count ?? 0;
    }

    const str = (v: unknown): string | null => (v ? String(v) : null);
    const num = (v: unknown): number | null => (v != null ? Number(v) : null);
    const mapMeeting = (r: Record<string, unknown>, prefix: string) => {
      const status = r[`${prefix}_status`];
      const scheduled = r[`${prefix}_scheduled_at`];
      const held = r[`${prefix}_held_at`];
      if (!status && !scheduled && !held) return null; // no meeting row joined
      return {
        status: status ? String(status) : null,
        scheduled_at: scheduled ? toIsoString(scheduled) : null,
        held_at: held ? toIsoString(held) : null,
        // Internal-only fields (ADR-0013 §6): nulled for the client role.
        call_script: isClient ? null : str(r[`${prefix}_call_script`]),
        transcription_url: isClient ? null : str(r[`${prefix}_transcription_url`]),
        pre_meeting_insights: isClient ? null : str(r[`${prefix}_pre_meeting_insights`]),
        process_score: isClient ? null : num(r[`${prefix}_process_score`]),
        conversion_insights: isClient ? null : str(r[`${prefix}_conversion_insights`]),
      };
    };
    const mapOpenTasks = (r: Record<string, unknown>) => {
      const raw = r.open_tasks;
      let list: unknown[] = [];
      if (Array.isArray(raw)) {
        list = raw;
      } else if (typeof raw === "string") {
        // postgres.js normally returns json as a parsed array; the string path is a defensive fallback
        // for a driver/config that hands back raw text. Never let a malformed blob crash the whole page.
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = [];
        }
      }
      return list
        .map((t) => t as Record<string, unknown>)
        .map((t) => ({
          id: String(t.id),
          title: t.title == null ? "" : String(t.title),
          due_at: t.due_at ? toIsoString(t.due_at) : null,
          status: (t.status === "in_progress" ? "in_progress" : "planned") as "planned" | "in_progress",
          position: Number(t.position ?? 0),
        }));
    };
    const mapDelivery = (r: Record<string, unknown>, prefix: string) => {
      const planned = r[`${prefix}_planned_date`];
      const items = r[`${prefix}_value_items`];
      const sent = r[`${prefix}_sent_at`];
      if (!planned && !sent && !(Array.isArray(items) && items.length > 0)) return null;
      return {
        planned_date: planned ? String(planned) : null,
        value_items: Array.isArray(items) ? items.map((x) => String(x)) : [],
        sent_at: sent ? toIsoString(sent) : null,
      };
    };

    const rows = dataRows.map((r) => {
      // Ordered open-tasks list; next_task_due_at + open_tasks_count derive from it so the SQL ordering
      // is the single source of truth (col X/Y).
      const openTasks = mapOpenTasks(r);
      return {
      id: String(r.id),
      created_at: r.created_at ? toIsoString(r.created_at) ?? "" : "",
      updated_at: r.updated_at ? toIsoString(r.updated_at) ?? "" : "",
      client_id: String(r.client_id),
      campaign_id: str(r.campaign_id),
      email: str(r.email),
      first_name: str(r.first_name),
      last_name: str(r.last_name),
      job_title: str(r.job_title),
      company_name: str(r.company_name),
      linkedin_url: str(r.linkedin_url),
      gender: str(r.gender),
      qualification: str(r.qualification),
      external_id: str(r.external_id),
      phone_number: str(r.phone_number),
      phone_source: str(r.phone_source),
      industry: str(r.industry),
      headcount_range: str(r.headcount_range),
      website: str(r.website),
      country: str(r.country),
      message_title: str(r.message_title),
      message_number: num(r.message_number),
      response_time_hours: num(r.response_time_hours),
      response_time_label: str(r.response_time_label),
      meeting_booked: Boolean(r.meeting_booked),
      meeting_held: Boolean(r.meeting_held),
      offer_sent: Boolean(r.offer_sent),
      won: Boolean(r.won),
      external_blacklist_id: num(r.external_blacklist_id),
      external_domain_blacklist_id: num(r.external_domain_blacklist_id),
      source: r.source ? String(r.source) : "cold_email",
      reply_text: str(r.reply_text),
      client_note: str(r.client_note),
      coldunicorn_note: isClient ? null : str(r.coldunicorn_note),
      highlight: str(r.highlight),
      sequencer_id: String(r.sequencer_id),
      linkedin_invitation_sent_at: r.linkedin_invitation_sent_at ? toIsoString(r.linkedin_invitation_sent_at) : null,
      contact_made_at: r.contact_made_at ? toIsoString(r.contact_made_at) : null,
      contact_method: str(r.contact_method),
      negotiation_started_at: r.negotiation_started_at ? toIsoString(r.negotiation_started_at) : null,
      conclusion: isClient ? null : str(r.conclusion),
      concluded_at: r.concluded_at ? toIsoString(r.concluded_at) : null,
      final_outcome: str(r.final_outcome),
      clientName: String(r.client_name ?? ""),
      campaignName: str(r.campaign_name),
      replyCount: Number(r.reply_count ?? 0),
      lastReplyAt: r.last_reply_at ? toIsoString(r.last_reply_at) : null,
      intro_meeting: mapMeeting(r, "intro"),
      summary_meeting: mapMeeting(r, "summary"),
      current_offer: r.offer_status || r.offer_contracted_send_date
        ? { status: str(r.offer_status), contracted_send_date: str(r.offer_contracted_send_date) }
        : null,
      value_delivery_1: mapDelivery(r, "d1"),
      value_delivery_2: mapDelivery(r, "d2"),
      linkedin_integration_connected: Boolean(r.linkedin_integration_connected),
      open_tasks: openTasks,
      next_task_due_at: openTasks[0]?.due_at ?? null,
      open_tasks_count: openTasks.length,
      };
    });

    const pageClientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const pageLeadIds = rows.map((r) => r.id);
    let customFields: Record<string, unknown>[] = [];
    let customValues: Record<string, unknown>[] = [];
    if (pageClientIds.length > 0) {
      customFields = await safeRawSelect(
        tx,
        sql`select id, client_id, name, field_type, options, position, editable_by, created_by, created_at
            from public.lead_custom_fields
            where client_id in (${sql.join(pageClientIds.map((id) => sql`${id}`), sql`, `)})
            order by position asc, created_at asc`,
      );
    }
    if (pageLeadIds.length > 0) {
      customValues = await safeRawSelect(
        tx,
        sql`select lead_id, field_id, value from public.lead_custom_field_values
            where lead_id in (${sql.join(pageLeadIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    }

    console.log(
      `[PERF][orm-gateway] loadLeadCrmList: totalHandlerMs=${(performance.now() - t0).toFixed(1)} ` +
        `rows=${rows.length} totalCount=${totalCount} isClient=${isClient} page=${p.page} pageSize=${pageSize}`,
    );

    return {
      rows,
      totalCount,
      stageCounts,
      customFields: customFields.map(toLeadCustomFieldRecord),
      customValues: customValues.map((r) => ({
        lead_id: String(r.lead_id),
        field_id: String(r.field_id),
        value: r.value === null || r.value === undefined ? null : String(r.value),
      })),
      asOf,
      businessDays: DEFAULT_BUSINESS_DAY_CONFIG,
    };
  }

  if (payload.action === "loadLeadsFilterOptions") {
    // Static filter option lists — loaded once on leads page mount, not on every filter/paginate.
    // Both lists are scoped by RLS via the JOIN through leads (only accessible leads are visible).
    const t0 = performance.now();

    const tClients0 = performance.now();
    const clientsLiteRows = await rawQuery<{ id: string; name: string }>(tx, sql`
      SELECT DISTINCT c.id, c.name FROM clients c
      JOIN leads l ON l.client_id = c.id
      ORDER BY c.name
    `);
    const clientsMs = performance.now() - tClients0;

    const tCampaigns0 = performance.now();
    const campaignsLiteRows = await rawQuery<{ id: string; name: string; client_id: string }>(tx, sql`
      SELECT DISTINCT camp.id, camp.name, camp.client_id FROM campaigns camp
      JOIN leads l ON l.campaign_id = camp.id
      ORDER BY camp.name
    `);
    const campaignsMs = performance.now() - tCampaigns0;

    console.log(
      `[PERF][orm-gateway] loadLeadsFilterOptions: totalMs=${(performance.now() - t0).toFixed(1)} ` +
        `clientsMs=${clientsMs.toFixed(1)} campaignsMs=${campaignsMs.toFixed(1)} ` +
        `(clients=${clientsLiteRows.length}, campaigns=${campaignsLiteRows.length})`,
    );

    return {
      clientsLite: clientsLiteRows,
      campaignsLite: campaignsLiteRows.map((r) => ({ id: r.id, name: r.name, clientId: r.client_id })),
    };
  }

  if (payload.action === "loadLeadDetail") {
    const leadId = payload.leadId;
    const t0 = performance.now();

    const replyRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT id, lead_id, external_id, sequence_step, message_subject, message_text,
             received_at, client_id, from_email_address, is_automated_reply,
             classification, short_reason, language_detected, is_forwarded
      FROM replies
      WHERE lead_id = ${leadId}
      ORDER BY received_at DESC
    `);

    console.log(`[PERF][orm-gateway] loadLeadDetail: ${(performance.now() - t0).toFixed(1)}ms (replies=${replyRows.length})`);

    return {
      replies: replyRows.map((r) => ({
        id: String(r.id ?? ""),
        created_at: r.received_at ? toIsoString(r.received_at) ?? "" : "",
        lead_id: r.lead_id ? String(r.lead_id) : null,
        external_id: r.external_id ? String(r.external_id) : "",
        sequence_step: r.sequence_step != null ? Number(r.sequence_step) : null,
        message_subject: r.message_subject ? String(r.message_subject) : null,
        message_text: r.message_text ? String(r.message_text) : null,
        received_at: r.received_at ? toIsoString(r.received_at) ?? "" : "",
        client_id: r.client_id ? String(r.client_id) : null,
        from_email_address: r.from_email_address ? String(r.from_email_address) : null,
        is_automated_reply: Boolean(r.is_automated_reply),
        classification: r.classification ? String(r.classification) : null,
        short_reason: r.short_reason ? String(r.short_reason) : null,
        language_detected: r.language_detected ? String(r.language_detected) : null,
        is_forwarded: Boolean(r.is_forwarded),
      })),
    };
  }

  // ── Phase 5: campaigns list + lazy stats ────────────────────────────────────────────────────

  if (payload.action === "loadCampaignsList") {
    const p = payload.params;
    const t0 = performance.now();
    const pageSize = Math.min(Math.max(1, p.pageSize ?? 200), 500);
    const offset = (Math.max(1, p.page ?? 1) - 1) * pageSize;

    console.log(
      `[PERF][orm-gateway] loadCampaignsList shape: ` +
        `hasClientFilter=${!!p.clientId} hasStatus=${!!p.status} hasSearch=${!!p.search} ` +
        `sortField=${p.sortField} sortDir=${p.sortDir} page=${p.page} pageSize=${pageSize}`,
    );

    const whereParts: ReturnType<typeof sql>[] = [];
    if (p.clientId) whereParts.push(sql`camp.client_id = ${p.clientId}`);
    if (p.status) whereParts.push(sql`camp.status = ${p.status}`);
    if (p.search) {
      const needle = `%${p.search.toLowerCase()}%`;
      whereParts.push(sql`(LOWER(camp.name) LIKE ${needle} OR LOWER(COALESCE(camp.external_id, '')) LIKE ${needle})`);
    }
    const whereClause = whereParts.length > 0 ? sql`WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;

    const dirSql = p.sortDir === "asc" ? sql`ASC` : sql`DESC`;
    const dirTie = sql`ASC`;
    let orderClause: ReturnType<typeof sql>;
    if (p.sortField === "name") orderClause = sql`ORDER BY LOWER(camp.name) ${dirSql}, camp.id ${dirTie}`;
    else if (p.sortField === "type") orderClause = sql`ORDER BY camp.type ${dirSql}, camp.id ${dirTie}`;
    else if (p.sortField === "status") orderClause = sql`ORDER BY camp.status ${dirSql}, camp.id ${dirTie}`;
    else if (p.sortField === "positive") orderClause = sql`ORDER BY COALESCE(camp.positive_responses, 0) ${dirSql}, camp.id ${dirTie}`;
    else orderClause = sql`ORDER BY camp.start_date ${dirSql} NULLS LAST, camp.id ${dirTie}`; // "start"

    const tCount0 = performance.now();
    const countRows = await rawQuery<{ n: number }>(tx, sql`
      SELECT COUNT(*)::int AS n
      FROM campaigns camp
      ${whereClause}
    `);
    const countMs = performance.now() - tCount0;

    const tData0 = performance.now();
    const dataRows = await rawQuery<Record<string, unknown>>(tx, sql`
      SELECT
        camp.id, camp.created_at, camp.updated_at, camp.client_id,
        camp.external_id, camp.type, camp.name, camp.status,
        camp.database_size, camp.positive_responses, camp.start_date,
        camp.gender_target, camp.sequencer_id,
        c.name AS client_name
      FROM campaigns camp
      JOIN clients c ON c.id = camp.client_id
      ${whereClause}
      ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    const dataMs = performance.now() - tData0;
    // filterOptions removed — caller uses ShellDataProvider.clientsLite for the client dropdown.

    const totalCount = countRows[0]?.n ?? 0;
    // Manual mapping from snake_case raw SQL result (rawQuery returns raw column names).
    // toCampaignRecord expects drizzle camelCase and cannot be used here.
    const rows = dataRows.map((r) => ({
      id: String(r.id ?? ""),
      created_at: r.created_at ? (toIsoString(r.created_at) ?? "") : "",
      updated_at: r.updated_at ? (toIsoString(r.updated_at) ?? "") : "",
      client_id: String(r.client_id ?? ""),
      external_id: String(r.external_id ?? ""),
      type: String(r.type ?? ""),
      name: String(r.name ?? ""),
      status: r.status ? String(r.status) : null,
      database_size: r.database_size != null ? Number(r.database_size) : null,
      positive_responses: r.positive_responses != null ? Number(r.positive_responses) : 0,
      start_date: r.start_date ? String(r.start_date) : null,
      gender_target: r.gender_target ? String(r.gender_target) : null,
      sequencer_id: String(r.sequencer_id ?? ""),
      clientName: String(r.client_name ?? ""),
    }));

    const totalHandlerMs = performance.now() - t0;
    if (perf) { perf.queryMs.countMs = countMs; perf.queryMs.rowsMs = dataMs; }
    console.log(
      `[PERF][orm-gateway] loadCampaignsList: totalHandlerMs=${totalHandlerMs.toFixed(1)} ` +
        `countMs=${countMs.toFixed(1)} dataMs=${dataMs.toFixed(1)} ` +
        `rows=${rows.length} totalCount=${totalCount}`,
    );

    return { rows, totalCount, _qms: { countMs: Math.round(countMs), rowsMs: Math.round(dataMs) } };
  }

  if (payload.action === "loadCampaignStats") {
    const t0 = performance.now();
    const since90d = isoDaysAgo(CAMPAIGN_DAILY_STATS_WINDOW_DAYS);

    let statsRows: Record<string, unknown>[];
    if (payload.campaignId) {
      statsRows = await rawQuery<Record<string, unknown>>(tx, sql`
        SELECT campaign_id, report_date, sent_count, reply_count, bounce_count,
               unique_open_count, positive_replies_count
        FROM campaign_daily_stats
        WHERE campaign_id = ${payload.campaignId} AND report_date >= ${since90d}
        ORDER BY report_date ASC
      `);
    } else {
      // No campaignId: load all accessible campaign stats (client page — RLS scopes to their data).
      statsRows = await rawQuery<Record<string, unknown>>(tx, sql`
        SELECT campaign_id, report_date, sent_count, reply_count, bounce_count,
               unique_open_count, positive_replies_count
        FROM campaign_daily_stats
        WHERE report_date >= ${since90d}
        ORDER BY campaign_id, report_date ASC
      `);
    }

    const statsMs = performance.now() - t0;
    if (perf) perf.queryMs.statsMs = statsMs;
    console.log(
      `[PERF][orm-gateway] loadCampaignStats: ${statsMs.toFixed(1)}ms ` +
        `(campaignId=${payload.campaignId ?? "all"} rows=${statsRows.length})`,
    );

    return {
      rows: statsRows.map((r) => ({
        campaign_id: String(r.campaign_id ?? ""),
        report_date: String(r.report_date ?? ""),
        sent_count: r.sent_count != null ? Number(r.sent_count) : null,
        reply_count: r.reply_count != null ? Number(r.reply_count) : null,
        bounce_count: r.bounce_count != null ? Number(r.bounce_count) : null,
        unique_open_count: r.unique_open_count != null ? Number(r.unique_open_count) : null,
        positive_replies_count: r.positive_replies_count != null ? Number(r.positive_replies_count) : null,
      })),
      _qms: { statsMs: Math.round(statsMs) },
    };
  }

  // ── Phase 6: analytics overview ─────────────────────────────────────────────────────────────

  if (payload.action === "loadAnalyticsOverview") {
    const t0 = performance.now();
    const dailyStatsSince = isoDaysAgo(DAILY_STATS_WINDOW_DAYS); // 180d

    const leadsSince = isoDaysAgo(DAILY_STATS_WINDOW_DAYS); // 180d — same window as dailyStats

    const [usersRows, clientRows, campaignRows, leadGroupRows, dailyStatRows] = await Promise.all([
      // User lites — same projection as shell.
      tx.select({
        id: schema.users.id,
        first_name: schema.users.firstName,
        last_name: schema.users.lastName,
        email: schema.users.email,
        role: schema.users.role,
      }).from(schema.users).orderBy(desc(schema.users.createdAt)),

      // Client lite — only the 7 fields read by InternalStatisticsPage.
      // Full ClientRecord (25+ fields including crm_config, notes, etc.) is not needed.
      tx.select({
        id: schema.clients.id,
        name: schema.clients.name,
        manager_id: schema.clients.managerId,
        status: schema.clients.status,
        kpi_leads: schema.clients.kpiLeads,
        kpi_meetings: schema.clients.kpiMeetings,
        contracted_amount: schema.clients.contractedAmount,
      }).from(schema.clients).orderBy(asc(schema.clients.name)),

      // Full campaign rows (all 12 campaign fields are used in the portfolio + filter dropdown).
      tx.select().from(schema.campaigns).orderBy(asc(schema.campaigns.name)),

      // Lead GROUPS — server-side aggregate instead of row-level projections.
      // Replaces 3973 × 9-field rows (~1108KB) with ~200–400 × 5-field groups (~15–25KB).
      // InternalStatisticsPage only needs qualification breakdowns + per-client/manager counts;
      // pipeline booleans (meeting_booked/held/offer_sent/won) and lead ids are never read.
      // RLS still applies (authenticated role sees only scoped clients' leads).
      safeRawSelect(tx, sql`
        SELECT
          l.client_id::text        AS client_id,
          l.campaign_id::text      AS campaign_id,
          l.qualification::text    AS qualification,
          (l.created_at AT TIME ZONE 'UTC')::date::text AS date,
          COUNT(*)::int            AS count
        FROM leads l
        WHERE l.created_at >= ${leadsSince}::timestamptz
        GROUP BY l.client_id, l.campaign_id, l.qualification,
                 (l.created_at AT TIME ZONE 'UTC')::date
        ORDER BY date DESC
      `),

      // 180-day daily stats — MINIMAL 5-field projection (AnalyticsDailyStatInput).
      // Drops: human_replies_count, ooo_count, negative_count, schedule_today/tomorrow/day_after
      // — these are NOT rendered anywhere in InternalStatisticsPage.
      // Saves ~54% per row vs DailyStatInput (5 vs 11 fields).
      tx.select({
        client_id: schema.dailyStats.clientId,
        report_date: schema.dailyStats.reportDate,
        emails_sent: schema.dailyStats.emailsSent,
        response_count: schema.dailyStats.responseCount,
        bounce_count: schema.dailyStats.bounceCount,
      }).from(schema.dailyStats).where(gte(schema.dailyStats.reportDate, dailyStatsSince)).orderBy(desc(schema.dailyStats.reportDate)),
    ]);

    const totalMs = performance.now() - t0;
    if (perf) perf.queryMs.analyticsMs = totalMs;
    console.log(
      `[PERF][orm-gateway] loadAnalyticsOverview: ${totalMs.toFixed(1)}ms ` +
        `(users=${usersRows.length} clients=${clientRows.length} campaigns=${campaignRows.length} ` +
        `leadGroups=${leadGroupRows.length} dailyStats=${dailyStatRows.length})`,
    );

    return {
      users: usersRows,
      clients: clientRows.map((c) => ({
        id: c.id,
        name: c.name,
        manager_id: c.manager_id ?? null,
        status: c.status ?? null,
        kpi_leads: c.kpi_leads != null ? Number(c.kpi_leads) : null,
        kpi_meetings: c.kpi_meetings != null ? Number(c.kpi_meetings) : null,
        contracted_amount: normalizeNumeric(c.contracted_amount),
      })),
      campaigns: campaignRows.map(toCampaignRecord),
      leadGroups: leadGroupRows.map((r) => ({
        client_id: String(r.client_id ?? ""),
        campaign_id: r.campaign_id != null ? String(r.campaign_id) : null,
        qualification: r.qualification != null ? String(r.qualification) : null,
        date: String(r.date ?? ""),
        count: Number(r.count ?? 0),
      })),
      dailyStats: dailyStatRows.map((r) => ({
        client_id: String(r.client_id),
        report_date: String(r.report_date ?? ""),
        emails_sent: r.emails_sent != null ? Number(r.emails_sent) : null,
        response_count: r.response_count != null ? Number(r.response_count) : null,
        bounce_count: r.bounce_count != null ? Number(r.bounce_count) : null,
      })),
    };
  }

  // ── Phase 7 (partial): admin settings ───────────────────────────────────────────────────────

  if (payload.action === "loadAdminSettings") {
    const t0 = performance.now();

    const [clientRows, conditionRuleRows, columnOverrideRows, customFieldRows] = await Promise.all([
      // Full client rows — needed by ConditionRuleBuilder client-selector.
      tx.select().from(schema.clients).orderBy(asc(schema.clients.name)),

      // Condition rules — full records for the rule editor.
      tx.select().from(schema.conditionRules).orderBy(asc(schema.conditionRules.priority), asc(schema.conditionRules.createdAt)),

      // Column overrides (raw SQL — table not in drizzle schema yet).
      safeRawSelect(tx, sql`
        SELECT column_key, label_override, hidden, position, updated_at, updated_by
        FROM public.client_table_column_overrides
      `),

      // Custom field definitions.
      safeRawSelect(tx, sql`
        SELECT id, name, field_type, options, position, editable_by, created_by, created_at
        FROM public.client_custom_fields
        ORDER BY position ASC, created_at ASC
      `),
    ]);

    console.log(
      `[PERF][orm-gateway] loadAdminSettings: ${(performance.now() - t0).toFixed(1)}ms ` +
        `(clients=${clientRows.length} conditionRules=${conditionRuleRows.length} ` +
        `columnOverrides=${columnOverrideRows.length} customFields=${customFieldRows.length})`,
    );

    return {
      clients: clientRows.map(toClientRecord),
      conditionRules: conditionRuleRows.map(toConditionRuleRecord),
      columnOverrides: (columnOverrideRows as Record<string, unknown>[]).map(toColumnOverrideRecord),
      clientCustomFields: (customFieldRows as Record<string, unknown>[]).map(toClientCustomFieldRecord),
    };
  }

  // ── Phase 7 remaining: domains / invoices / blacklist per-page loaders ─────────────────────────

  if (payload.action === "loadDomainsPage" || payload.action === "loadEmailAccountsPage") {
    const t0 = performance.now();
    const [clientRows, domainRows, emailAccountRows] = await Promise.all([
      tx.select().from(schema.clients).orderBy(asc(schema.clients.name)),
      tx.select().from(schema.domains).orderBy(desc(schema.domains.updatedAt)),
      tx.select().from(schema.emailAccounts).orderBy(asc(schema.emailAccounts.emailAddress)),
    ]);
    console.log(
      `[PERF][orm-gateway] ${payload.action}: ${(performance.now() - t0).toFixed(1)}ms ` +
        `(clients=${clientRows.length} domains=${domainRows.length} mailboxes=${emailAccountRows.length})`,
    );
    return {
      clients: clientRows.map(toClientRecord),
      domains: domainRows.map(toDomainRecord),
      emailAccounts: emailAccountRows.map(toEmailAccountRecord),
    };
  }

  if (payload.action === "loadEmailAccountWarming") {
    const rows = await tx
      .select()
      .from(schema.emailAccountWarmingDaily)
      .where(eq(schema.emailAccountWarmingDaily.emailAccountId, payload.emailAccountId))
      .orderBy(asc(schema.emailAccountWarmingDaily.metricDate));
    return rows.map(toEmailAccountWarmingRecord);
  }

  if (payload.action === "loadInvoicesPage") {
    const t0 = performance.now();
    const [clientRows, invoiceRows] = await Promise.all([
      tx.select().from(schema.clients).orderBy(asc(schema.clients.name)),
      tx.select().from(schema.invoices).orderBy(desc(schema.invoices.issueDate)),
    ]);
    console.log(
      `[PERF][orm-gateway] loadInvoicesPage: ${(performance.now() - t0).toFixed(1)}ms ` +
        `(clients=${clientRows.length} invoices=${invoiceRows.length})`,
    );
    return {
      clients: clientRows.map(toClientRecord),
      invoices: invoiceRows.map(toInvoiceRecord),
    };
  }

  if (payload.action === "loadBlacklistPage") {
    const t0 = performance.now();
    const rows = await tx.select().from(schema.emailExcludeList).orderBy(desc(schema.emailExcludeList.createdAt));
    console.log(
      `[PERF][orm-gateway] loadBlacklistPage: ${(performance.now() - t0).toFixed(1)}ms ` +
        `(entries=${rows.length})`,
    );
    return {
      emailExcludeList: rows.map(toEmailExcludeRecord),
    };
  }

  // ── OOO routing configuration (ADR-0015) ────────────────────────────────────────────────────
  // The only OOO surface the portal has. There is deliberately no operational list or follow-up
  // editor: episodes are driven end-to-end by n8n through the service_role RPCs in 20260722e.
  // These run under the caller's role, so client_ooo_routing / ooo_followups RLS does the scoping.

  if (
    payload.action === "loadClientOooRouting" ||
    payload.action === "upsertClientOooRouting" ||
    payload.action === "deactivateClientOooRouting"
  ) {
    let clientId = payload.action === "deactivateClientOooRouting" ? "" : payload.clientId;
    let recovered: number | null = null;

    if (payload.action === "upsertClientOooRouting") {
      // The type check is NOT redundant with the UI dropdown: this is the contract boundary, and
      // `client_ooo_routing.campaign_id` has only an FK to campaigns(id) with no type constraint.
      // Without it a request could route returning OOO contacts into the main outreach sequence.
      const owned = await safeRawSelect(tx, sql`
        SELECT 1 FROM campaigns
        WHERE id = ${payload.campaignId} AND client_id = ${payload.clientId} AND type = 'ooo_followup'
      `);
      if (!owned[0]) {
        fail(400, "That campaign is not an OOO follow-up campaign for this client.");
      }

      // (7) Idempotency: re-saving the campaign that is already active would deactivate the current
      // row and insert an identical replacement, growing a history of rows that explain nothing.
      const unchanged = await safeRawSelect(tx, sql`
        SELECT 1 FROM client_ooo_routing
        WHERE client_id = ${payload.clientId} AND routing_key = ${payload.routingKey}
          AND campaign_id = ${payload.campaignId} AND is_active
      `);
      if (unchanged[0]) {
        recovered = 0;
      } else {

        // Deactivate rather than delete: a past episode must stay explainable by the configuration
        // that produced it. The partial unique index allows only one active row per (client, key),
        // so the old one has to step down before the new one lands.
        await tx.execute(sql`
          UPDATE client_ooo_routing SET is_active = false
          WHERE client_id = ${payload.clientId} AND routing_key = ${payload.routingKey} AND is_active
        `);
        const inserted = await rawQuery<{ id: string }>(tx, sql`
          INSERT INTO client_ooo_routing (client_id, routing_key, campaign_id, is_active)
          VALUES (${payload.clientId}, ${payload.routingKey}, ${payload.campaignId}, true)
          RETURNING id
        `);
        if (!inserted[0]) fail(403, "You do not have permission to configure OOO routing for this client.");

        // §10: the configuration that was missing now exists, so episodes parked as
        // skipped/routing_missing become actionable again. Runs under the caller's role, so RLS
        // limits it to their clients.
        // (1) Recover across ALL routing keys, not just the one saved. `general` is the FALLBACK for
        // every unmatched key, so adding it must revive episodes parked as male/female too — filtering
        // by the saved key would leave exactly those stuck, silently, reporting 0 recovered. The
        // function re-resolves each episode individually and only revives ones that now route, so
        // passing NULL is correct rather than merely broader.
        const recoveredRows = await rawQuery<{ n: number }>(tx, sql`
          SELECT public.recover_skipped_ooo_followups(${payload.clientId}::uuid, NULL) AS n
        `);
        recovered = Number(recoveredRows[0]?.n ?? 0);
      }
    }

    if (payload.action === "deactivateClientOooRouting") {
      const rows = await rawQuery<{ client_id: string }>(tx, sql`
        UPDATE client_ooo_routing SET is_active = false
        WHERE id = ${payload.routingId} AND is_active
        RETURNING client_id::text AS client_id
      `);
      // Empty RETURNING is this action's only failure signal, so it must not also mean "already
      // inactive" — otherwise a stale second click reports a change that never happened.
      if (!rows[0]) {
        const exists = await safeRawSelect(tx, sql`
          SELECT 1 FROM client_ooo_routing WHERE id = ${payload.routingId}
        `);
        fail(
          exists[0] ? 409 : 403,
          exists[0]
            ? "That OOO routing rule is already inactive — reload to see the current configuration."
            : "You do not have permission to change this OOO routing rule.",
        );
      }
      clientId = String(rows[0].client_id);
    }

    const [routeRows, campaignRows] = await Promise.all([
      safeRawSelect(tx, sql`
        SELECT id::text, client_id::text, routing_key, campaign_id::text, is_active,
               created_at, updated_at
        FROM client_ooo_routing
        WHERE client_id = ${clientId}
        ORDER BY is_active DESC, routing_key ASC, created_at DESC
      `),
      tx.select({ id: schema.campaigns.id, name: schema.campaigns.name })
        .from(schema.campaigns)
        .where(and(eq(schema.campaigns.clientId, clientId), eq(schema.campaigns.type, "ooo_followup")))
        .orderBy(asc(schema.campaigns.name)),
    ]);

    return {
      clientId,
      routes: routeRows.map((r) => ({
        id: String(r.id),
        client_id: String(r.client_id),
        routing_key: String(r.routing_key),
        campaign_id: String(r.campaign_id),
        is_active: Boolean(r.is_active),
        created_at: toIsoString(r.created_at) ?? "",
        updated_at: toIsoString(r.updated_at) ?? "",
      })),
      campaigns: campaignRows.map((c) => ({ id: String(c.id), name: String(c.name) })),
      recoveredFollowups: recovered,
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

  if (payload.action === "concludeLead") {
    // Atomic terminal write (ADR-0013 §Phase 5). The two-sided DB CHECK
    // (leads_conclusion_consistency_check) requires the three terminal columns to be ALL-null or
    // ALL-set; `won` is synced here because the meeting/offer recompute triggers never touch it.
    // Un-concluding (finalOutcome=null) MUST clear conclusion + concluded_at too (all three null),
    // else the two-sided check rejects the write.
    const outcome = payload.finalOutcome;
    // Invariant (spec item 3): a terminal outcome requires a non-empty conclusion. Enforced here, in the
    // contract validator, AND by the DB CHECK as the backstop.
    if (outcome !== null && !(typeof payload.conclusion === "string" && payload.conclusion.trim() !== "")) {
      fail(400, "A conclusion is required to record a final outcome.");
    }
    const set = outcome === null
      // Un-conclude: clear all three canonical terminal fields (no draft conclusion survives) + won.
      ? { finalOutcome: null, concludedAt: null, conclusion: null, won: false }
      // `coalesce(concluded_at, now())` preserves the FIRST conclusion time across later note/outcome
      // edits (only un-concluding clears it); it must not drift forward when just the note changes.
      : { finalOutcome: outcome, concludedAt: sql`coalesce(${schema.leads.concludedAt}, now())`, conclusion: payload.conclusion, won: outcome === "won" };
    const rows = await tx.update(schema.leads).set(set).where(eq(schema.leads.id, payload.leadId)).returning();
    if (!rows[0]) fail(404, "Lead record was not found.");
    return toLeadRecord(rows[0]);
  }

  if (payload.action === "upsertLeadMeeting") {
    // One intro + one summary per lead (partial unique index). Select-then-write on (lead_id,
    // meeting_type) rather than ON CONFLICT — drizzle can't target a partial unique index. RLS gates
    // both the read and the write to manager/admin of the lead's client. A scheduled/held status fires
    // the boolean-recompute trigger (leads.meeting_booked / meeting_held).
    const input = mapLeadMeetingInput(payload.patch as Record<string, unknown>);
    const existing = await tx
      .select()
      .from(schema.leadMeetings)
      .where(and(eq(schema.leadMeetings.leadId, payload.leadId), eq(schema.leadMeetings.meetingType, payload.meetingType)))
      .limit(1);
    let row;
    if (existing[0]) {
      row = await updateOrKeep(tx, schema.leadMeetings, existing[0], input);
    } else {
      row = (await tx
        .insert(schema.leadMeetings)
        .values({ id: crypto.randomUUID(), leadId: payload.leadId, meetingType: payload.meetingType, ...input })
        .returning())[0];
    }
    if (!row) fail(500, "Meeting could not be saved.");
    return toLeadMeetingRecord(row);
  }

  if (payload.action === "upsertLeadOffer") {
    // Offers are not unique per lead; operate on the "current offer" the CRM view shows — the latest
    // non-cancelled one. Update it if present, else insert. A sent/accepted status fires the
    // offer_sent recompute trigger. RLS gates read + write to manager/admin of the lead's client.
    const input = mapLeadOfferInput(payload.patch as Record<string, unknown>);
    const existing = await tx
      .select()
      .from(schema.leadOffers)
      .where(and(eq(schema.leadOffers.leadId, payload.leadId), ne(schema.leadOffers.status, "cancelled")))
      .orderBy(desc(schema.leadOffers.createdAt))
      .limit(1);
    let row;
    if (existing[0] && input.status === "cancelled") {
      // Cancelling retracts the offer, so cancel EVERY non-cancelled offer — otherwise offer_sent could
      // linger true on an older parallel offer (e.g. one n8n created). Return the one the UI was editing.
      const rows = await tx
        .update(schema.leadOffers)
        .set(input)
        .where(and(eq(schema.leadOffers.leadId, payload.leadId), ne(schema.leadOffers.status, "cancelled")))
        .returning();
      row = rows.find((r: { id: string }) => r.id === existing[0].id) ?? rows[0];
    } else if (existing[0]) {
      row = await updateOrKeep(tx, schema.leadOffers, existing[0], input);
    } else {
      row = (await tx
        .insert(schema.leadOffers)
        .values({ id: crypto.randomUUID(), leadId: payload.leadId, ...input })
        .returning())[0];
    }
    if (!row) fail(500, "Offer could not be saved.");
    return toLeadOfferRecord(row);
  }

  if (payload.action === "upsertLeadValueDelivery") {
    // Keyed on (lead_id, sequence_number) — unique, sequence 1 or 2 (same select-then-write shape as
    // meetings; no boolean trigger — value deliveries feed only the CRM columns). RLS gates read+write.
    const input = mapLeadValueDeliveryInput(payload.patch as Record<string, unknown>);
    const existing = await tx
      .select()
      .from(schema.leadValueDeliveries)
      .where(and(eq(schema.leadValueDeliveries.leadId, payload.leadId), eq(schema.leadValueDeliveries.sequenceNumber, payload.sequenceNumber)))
      .limit(1);
    let row;
    if (existing[0]) {
      row = await updateOrKeep(tx, schema.leadValueDeliveries, existing[0], input);
    } else {
      row = (await tx
        .insert(schema.leadValueDeliveries)
        .values({ id: crypto.randomUUID(), leadId: payload.leadId, sequenceNumber: payload.sequenceNumber, ...input })
        .returning())[0];
    }
    if (!row) fail(500, "Value delivery could not be saved.");
    return toLeadValueDeliveryRecord(row);
  }

  if (payload.action === "loadLeadTasks") {
    // Lazy per-lead task list (RLS-scoped read). Ordered by manual position then creation.
    const rows = await tx
      .select()
      .from(schema.leadTasks)
      .where(eq(schema.leadTasks.leadId, payload.leadId))
      .orderBy(asc(schema.leadTasks.position), asc(schema.leadTasks.createdAt));
    return rows.map(toLeadTaskRecord);
  }

  if (payload.action === "upsertLeadTask") {
    // Create (no id) or update (id set, scoped to the lead so a mismatched id/leadId can't cross leads).
    // RLS gates read+write to manager/admin. A completed/cancelled/skipped status drops the task out of
    // the CRM open-task count + next-due date (recomputed by the read-model on the next refresh).
    const input = mapLeadTaskInput(payload.patch as Record<string, unknown>);
    let row;
    if (payload.id) {
      if (Object.keys(input).length === 0) {
        row = (await tx.select().from(schema.leadTasks)
          .where(and(eq(schema.leadTasks.id, payload.id), eq(schema.leadTasks.leadId, payload.leadId))).limit(1))[0];
      } else {
        row = (await tx.update(schema.leadTasks).set(input)
          .where(and(eq(schema.leadTasks.id, payload.id), eq(schema.leadTasks.leadId, payload.leadId))).returning())[0];
      }
    } else {
      if (typeof input.title !== "string" || !(input.title as string).trim()) fail(400, "A task title is required.");
      row = (await tx.insert(schema.leadTasks)
        .values({ id: crypto.randomUUID(), leadId: payload.leadId, ...input, title: input.title as string })
        .returning())[0];
    }
    if (!row) fail(404, "Task could not be saved.");
    return toLeadTaskRecord(row);
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
    const client = toClientRecord(rows[0]);
    // ADR-0012: optional per-sequencer credentials created alongside the client
    // (new-client sheet sends EmailBison workspace/key + Aimfox key here).
    for (const cred of payload.sequencerCredentials ?? []) {
      await upsertClientSequencerRow(tx, client.id, cred.sequencer_key, cred);
    }
    return client;
  }

  if (payload.action === "upsertClientSequencer") {
    const row = await upsertClientSequencerRow(
      tx,
      payload.clientId,
      payload.sequencerKey,
      payload.patch as Record<string, unknown>,
    );
    return toClientSequencerRecord(row);
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

  // --- Per-user table preferences (column widths, filters, sort) ---------------
  //
  // The row is keyed on the JWT subject, never on a caller-supplied id: RLS only lets a
  // user touch `user_id = auth.uid()`, and passing the id in the payload would just be a
  // second place to get it wrong. Impersonation is client-side only, so the subject is
  // always the real person doing the dragging.

  if (payload.action === "loadTablePreferences") {
    const rows = await rawQuery<{ preferences: unknown; updated_at: unknown }>(
      tx,
      sql`
        select preferences, updated_at
        from public.user_table_preferences
        where table_key = ${payload.tableKey}
          and user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      `,
    );

    const row = rows[0];
    return {
      tableKey: payload.tableKey,
      preferences: (row?.preferences as Record<string, unknown> | undefined) ?? null,
      updatedAt: toIsoString(row?.updated_at),
    };
  }

  if (payload.action === "saveTablePreferences") {
    const rows = await rawQuery<{ preferences: unknown; updated_at: unknown }>(
      tx,
      sql`
        insert into public.user_table_preferences (user_id, table_key, preferences, updated_at)
        values (
          nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
          ${payload.tableKey},
          ${JSON.stringify(payload.preferences)}::jsonb,
          now()
        )
        on conflict (user_id, table_key) do update set
          preferences = excluded.preferences,
          updated_at = excluded.updated_at
        returning preferences, updated_at
      `,
    );

    const row = rows[0];
    if (!row) fail(500, "Table preferences upsert failed.");
    return {
      tableKey: payload.tableKey,
      preferences: (row.preferences as Record<string, unknown> | null) ?? null,
      updatedAt: toIsoString(row.updated_at),
    };
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
        array(select jsonb_array_elements_text(${editableBy}::jsonb)),
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
        editable_by = case when ${setEditableBy} then array(select jsonb_array_elements_text(${patch.editable_by === undefined ? JSON.stringify(["master_admin"]) : JSON.stringify(patch.editable_by)}::jsonb)) else editable_by end
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

  // --- Lead custom fields (Batch 4, Task 4F) — per-client report columns. RLS enforces scope. ---
  if (payload.action === "loadLeadCustomFields") {
    const rows = payload.clientId
      ? await safeRawSelect(tx, sql`
          select id, client_id, name, field_type, options, position, editable_by, created_by, created_at
          from public.lead_custom_fields where client_id = ${payload.clientId}
          order by position asc, created_at asc`)
      : await safeRawSelect(tx, sql`
          select id, client_id, name, field_type, options, position, editable_by, created_by, created_at
          from public.lead_custom_fields order by position asc, created_at asc`);
    return rows.map(toLeadCustomFieldRecord);
  }

  if (payload.action === "createLeadCustomField") {
    const input = payload.input;
    const optionsJson = input.options ?? null;
    const editableBy = JSON.stringify(input.editable_by ?? ["admin", "master_admin"]);
    const rows = await tx.execute(sql`
      insert into public.lead_custom_fields (client_id, name, field_type, options, position, editable_by, created_by)
      values (
        ${input.client_id},
        ${input.name},
        ${input.field_type},
        ${optionsJson === null ? null : JSON.stringify(optionsJson)}::jsonb,
        ${input.position ?? 0},
        array(select jsonb_array_elements_text(${editableBy}::jsonb)),
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      )
      returning id, client_id, name, field_type, options, position, editable_by, created_by, created_at
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(500, "Lead custom field could not be created.");
    return toLeadCustomFieldRecord(result[0]);
  }

  if (payload.action === "updateLeadCustomField") {
    const patch = payload.patch ?? {};
    const setName = "name" in patch;
    const setType = "field_type" in patch;
    const setOptions = "options" in patch;
    const setPosition = "position" in patch;
    const setEditableBy = "editable_by" in patch;
    const rows = await tx.execute(sql`
      update public.lead_custom_fields set
        name = case when ${setName} then ${patch.name ?? null} else name end,
        field_type = case when ${setType} then ${patch.field_type ?? null} else field_type end,
        options = case when ${setOptions} then ${patch.options === undefined || patch.options === null ? null : JSON.stringify(patch.options)}::jsonb else options end,
        position = case when ${setPosition} then ${patch.position ?? 0} else position end,
        editable_by = case when ${setEditableBy} then array(select jsonb_array_elements_text(${patch.editable_by === undefined ? JSON.stringify(["admin", "master_admin"]) : JSON.stringify(patch.editable_by)}::jsonb)) else editable_by end
      where id = ${payload.fieldId}
      returning id, client_id, name, field_type, options, position, editable_by, created_by, created_at
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(404, "Lead custom field was not found.");
    return toLeadCustomFieldRecord(result[0]);
  }

  if (payload.action === "deleteLeadCustomField") {
    await tx.execute(sql`delete from public.lead_custom_fields where id = ${payload.fieldId}`);
    return { ok: true };
  }

  if (payload.action === "upsertLeadCustomFieldValue") {
    const rows = await tx.execute(sql`
      insert into public.lead_custom_field_values (lead_id, field_id, value, updated_at, updated_by)
      values (
        ${payload.leadId},
        ${payload.fieldId},
        ${payload.value},
        now(),
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      )
      on conflict (lead_id, field_id) do update set
        value = excluded.value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
      returning lead_id, field_id, value, updated_at, updated_by
    `);
    const result = (Array.isArray(rows) ? rows : rows.rows ?? []) as Record<string, unknown>[];
    if (!result[0]) fail(500, "Lead custom field value upsert failed.");
    return toLeadCustomFieldValueRecord(result[0]);
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
        avatarPath: publicUser.avatarPath ?? null,
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

  if (payload.action === "updateProfileAvatar") {
    const nextPath = payload.avatarPath === null ? null : payload.avatarPath.trim() || null;

    const rows = await tx
      .update(schema.users)
      .set({
        avatarPath: nextPath,
        avatarUpdatedAt: new Date().toISOString(),
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
    // Extract requestId before parsing so it's available for diagnostics even on parse error.
    const requestId = isRecord(rawPayload) && typeof rawPayload._requestId === "string"
      ? rawPayload._requestId
      : "no-id";
    const parsed = parseOrmGatewayRequest(rawPayload);
    if (!parsed.ok) {
      return jsonResponse(400, {
        ok: false,
        error: { message: parsed.error },
        _requestId: requestId,
      });
    }

    const perfCtx: PerfContext = { queryMs: {} };
    const tTotal = performance.now();
    const { data, setupMs, handlerMs } = await executeAsCaller(request, (tx) => handleAction(tx, parsed.value, perfCtx));
    const totalMs = performance.now() - tTotal;
    console.log(
      `[PERF][orm-gateway] ${parsed.value.action} requestId=${requestId}: totalMs=${totalMs.toFixed(1)} ` +
        `setupMs=${setupMs.toFixed(1)} handlerMs=${handlerMs.toFixed(1)}` +
        (Object.keys(perfCtx.queryMs).length > 0 ? ` ${JSON.stringify(perfCtx.queryMs)}` : ""),
    );
    return jsonResponse(200, {
      ok: true,
      data,
      _serverMs: {
        total: Math.round(totalMs),
        setup: Math.round(setupMs),
        handler: Math.round(handlerMs),
        ...Object.fromEntries(Object.entries(perfCtx.queryMs).map(([k, v]) => [k, Math.round(v)])),
      },
      _requestId: requestId,
    });
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
