export type AppRole = "super_admin" | "admin" | "master_admin" | "manager" | "client";
export type InviteRole = "admin" | "manager" | "client";
export type InviteStatus = "pending" | "accepted" | "expired";
// Display order of the client lifecycle. This tuple — not the Postgres enum, whose label order
// cannot be changed in place — is what orders every status dropdown and the filter chips.
export const CLIENT_STATUSES = [
  "Onboarding",
  "Active",
  "On hold",
  "Offboarding",
  "Inactive",
  "Subscription",
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

// Manual customer-satisfaction rating ("hearts"). null = not rated yet.
export const SATISFACTION_LEVELS = [1, 2, 3] as const;
export type SatisfactionLevel = (typeof SATISFACTION_LEVELS)[number];
export type CampaignType = "outreach" | "ooo" | "nurture" | "ooo_followup";
export type CampaignStatus = "draft" | "launching" | "active" | "stopped" | "completed";
export type LeadGender = "male" | "female";
export type LeadQualification =
  | "preMQL"
  | "MQL"
  | "meeting_scheduled"
  | "meeting_held"
  | "offer_sent"
  | "won"
  | "rejected";
/** Mirrors the `reply_classification` Postgres enum. `negative`/`neutral` were added by 20260722b
 *  so outreach analytics can count them separately — keep this union in step with the DB enum and
 *  with `replyClassification` in supabase/drizzle/schema.ts. */
export type ReplyClassification =
  | "OOO"
  | "Interested"
  | "NRR"
  | "Left_Company"
  | "Spam_Inbound"
  | "other"
  | "negative"
  | "neutral";
export type DomainStatus = "active" | "warmup" | "blocked" | "retired";
/** Manual report row highlight colour (Batch 4). `null` = no highlight. */
export type LeadHighlight = "green" | "yellow" | "red";

// --- Lead CRM view (Cold CRM / PDCA spec, ADR-0013 split status model) -------------------------
/** Non-terminal funnel position — DERIVED on read from activity facts, never stored. */
export type CrmStage = "preMQL" | "MQL" | "SQL";
/** Explicit terminal decision — STORED on `leads.final_outcome` with `conclusion` + `concluded_at`. */
/** Single source for terminal-outcome values — shared by the gateway validator and the editor select. */
export const FINAL_OUTCOME_VALUES = ["won", "lost", "lost_premql"] as const;
export type FinalOutcome = (typeof FINAL_OUTCOME_VALUES)[number];
/** The resolved single display/health status (a `CrmStage` or a `FinalOutcome`). */
export type LeadCrmStatus = CrmStage | FinalOutcome;
export type ContactMethod = "phone" | "email";
/** `intro`/`summary` are the one-per-lead meetings the CRM view renders. `general` is RESERVED for a
 *  future repeatable meeting type (spec item 9): the enum value exists, but it has NO CRUD and is
 *  intentionally rejected by `upsertLeadMeeting` (which is intro|summary only), because that path relies
 *  on the partial-unique `(lead_id, meeting_type)` index that must not apply to a repeatable type. */
export type MeetingType = "intro" | "summary" | "general";
/** Single source for the meeting-status values — shared by the gateway validator and the editor select. */
export const MEETING_STATUS_VALUES = ["planned", "scheduled", "held", "cancelled", "no_show"] as const;
export type MeetingStatus = (typeof MEETING_STATUS_VALUES)[number];
/** Single source for offer-status values — shared by the gateway validator and the editor select. */
export const OFFER_STATUS_VALUES = ["planned", "sent", "accepted", "rejected", "cancelled"] as const;
export type OfferStatus = (typeof OFFER_STATUS_VALUES)[number];
/** Single source for task-status values — shared by the gateway validator and the editor select. */
export const TASK_STATUS_VALUES = ["planned", "in_progress", "completed", "cancelled", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type ConditionTargetEntity = "client" | "campaign" | "lead";
export type ConditionScopeType = "global" | "client" | "manager";
export type ConditionApplyTo = "row" | "cell" | "badge" | "section";

export interface UserRecord {
  id: string;
  created_at: string;
  updated_at: string | null;
  email: string;
  first_name: string;
  last_name: string;
  role: AppRole;
  /** Supabase Storage object path in the user-avatars bucket; null when no photo. */
  avatar_path: string | null;
}

// Full user row for the admin User Management page (includes soft-deactivate status).
// Returned by the SECURITY DEFINER RPC public.admin_list_users() and the
// admin_update_user_role / admin_set_user_active mutations.
export interface ManagedUserRecord extends UserRecord {
  is_active: boolean;
  deactivated_at: string | null;
  deactivated_by: string | null;
}

export interface ClientRecord {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  /** Assigned owner (CS Manager or admin). `null` when the client is unassigned. */
  manager_id: string | null;
  kpi_leads: number | null;
  kpi_meetings: number | null;
  contracted_amount: number | null;
  contract_due_date: string | null;
  status: ClientStatus;
  min_daily_sent: number;
  inboxes_count: number;
  sms_phone_numbers: string[] | null;
  notification_emails: string[] | null;
  auto_ooo_enabled: boolean;
  prospects_signed: number;
  prospects_added: number;
  setup_info: string | null;
  bi_setup_done: boolean;
  lost_reason: string | null;
  notes: string | null;
  satisfaction: SatisfactionLevel | null;
  /**
   * Soft-delete tombstone (migration `20260813_entity_archival`). Non-null = archived: the row is
   * hidden from every list, picker and aggregate, and only comes back through `includeArchived`.
   * Optional on the type so the `create*` payloads (`Omit<Record, "id" | …>`) stay constructible —
   * the gateway always sends it on reads.
   */
  archived_at?: string | null;
}

export interface ClientUserRecord {
  id: string;
  created_at: string;
  client_id: string;
  user_id: string;
}

// ── Sequencers (ADR-0012) ─────────────────────────────────────────────────────
// External sending tools (EmailBison / Aimfox). Catalog rows carry
// fixed load-bearing UUIDs (column defaults + n8n constants); per-client
// credentials live in client_sequencers (replaced clients.external_api_key /
// external_workspace_id / linkedin_api_key).

export type SequencerChannel = "email" | "linkedin";

export interface SequencerRecord {
  id: string;
  /** Stable machine key: 'emailbison' | 'aimfox' | future additions. */
  key: string;
  name: string;
  channel: SequencerChannel;
  enabled: boolean;
  created_at: string;
}

/** One element of the canonical set, as the provisioning workflows report it. */
export type WorkspaceSetupOutcome = "ok" | "created" | "missing" | "skipped" | "failed";

export interface WorkspaceSetupStep {
  outcome: WorkspaceSetupOutcome;
  present?: string[];
  missing?: string[];
  created?: string[];
  error?: string | null;
}

/**
 * Last provisioning verdict for one client+sequencer — `client_sequencers.setup_state`, written
 * only by the workspace-setup workflows (ADR-0018 §6; migration 20260807).
 *
 * `{}` means never checked. Tell that apart from "checked and found empty" via `setup_checked_at`,
 * never by inspecting this. It holds no secret by contract: `steps` says what is present, not what
 * it is.
 */
export interface WorkspaceSetupState {
  state?: "configured" | "partial" | "missing" | "needs_selection" | "client_not_found";
  dry_run?: boolean;
  resolved?: { workspace_id: string; name: string | null; matched_by: string } | null;
  steps?: Record<string, WorkspaceSetupStep>;
}

export interface ClientSequencerRecord {
  id: string;
  client_id: string;
  sequencer_id: string;
  api_key: string | null;
  /** Text on purpose — workspace id formats differ per platform. */
  external_workspace_id: string | null;
  settings: Record<string, unknown>;
  enabled: boolean;
  /** `{}` until provisioning has run at least once. See WorkspaceSetupState. */
  setup_state: WorkspaceSetupState;
  /**
   * When provisioning last ran, dry-run or not. NULL = never. There is no scheduled drift check by
   * design, so this value ages and is meant to: a six-week-old "configured" is still just a
   * six-week-old observation, and the UI shows the date so nobody mistakes it for a live one.
   */
  setup_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRecord {
  id: string;
  created_at: string;
  updated_at: string;
  client_id: string;
  external_id: string;
  type: CampaignType;
  name: string;
  status: CampaignStatus;
  database_size: number | null;
  positive_responses: number;
  start_date: string | null;
  gender_target: string | null;
  /** ADR-0012: owning sequencer. Set at creation (DB default = EmailBison); immutable via portal. */
  sequencer_id: string;
  /** Soft-delete tombstone — see {@link ClientRecord.archived_at}. */
  archived_at?: string | null;
}

export interface LeadRecord {
  id: string;
  created_at: string;
  updated_at: string;
  client_id: string;
  campaign_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  linkedin_url: string | null;
  gender: LeadGender | null;
  qualification: LeadQualification | null;
  external_id: string | null;
  phone_number: string | null;
  phone_source: string | null;
  industry: string | null;
  headcount_range: string | null;
  website: string | null;
  country: string | null;
  message_title: string | null;
  message_number: number | null;
  response_time_hours: number | null;
  response_time_label: string | null;
  meeting_booked: boolean;
  meeting_held: boolean;
  offer_sent: boolean;
  won: boolean;
  external_blacklist_id: number | null;
  external_domain_blacklist_id: number | null;
  source: string;
  reply_text: string | null;
  /** Client-facing note (renamed from the legacy `comments` column in Batch 4). */
  client_note: string | null;
  /** Internal note — never returned to the client role by the gateway. */
  coldunicorn_note: string | null;
  /** Manual report row highlight; `null` when unset. */
  highlight: LeadHighlight | null;
  /** Sequencer attribution (ADR-0012); DEFAULT EmailBison. */
  sequencer_id: string;
  // Lead CRM columns (ADR-0013).
  linkedin_invitation_sent_at: string | null;
  contact_made_at: string | null;
  contact_method: ContactMethod | null;
  negotiation_started_at: string | null;
  /** Free-text conclusion recorded with a terminal `final_outcome`. */
  conclusion: string | null;
  concluded_at: string | null;
  /** Explicit terminal outcome; `null` = non-terminal (funnel stage is derived). */
  final_outcome: FinalOutcome | null;
  // NOTE: the ADR-0015 provenance columns (`source_sequencer_contact_id`, `origin_reply_id`) exist
  // in the database and in the drizzle schema but are deliberately NOT projected here — no portal
  // surface reads them, and the OOO view resolves the linked lead from the contact side instead.
  /** Soft-delete tombstone — see {@link ClientRecord.archived_at}. */
  archived_at?: string | null;
}

// --- OOO model (ADR-0015, migrations 20260722*) ------------------------------------------------
// OOO/NRR are OUTREACH states of an external contact, not CRM lead states. A CRM lead exists only
// after a positive reply, so none of these types belong on `LeadRecord`.

/** Explicit routing category. `general` is a value, never an implicit NULL (spec §11). */
export const ROUTING_KEYS = ["male", "female", "general"] as const;
export type RoutingKey = (typeof ROUTING_KEYS)[number];

/** Per-client OOO routing configuration (spec §11). At most one active row per (client, key). */
export interface ClientOooRoutingRecord {
  id: string;
  client_id: string;
  routing_key: RoutingKey;
  campaign_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Meeting attached to a lead (spec §8.2). Intro/summary are one-per-lead; general repeats. */
export interface LeadMeetingRecord {
  id: string;
  lead_id: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  call_script: string | null;
  scheduled_at: string | null;
  held_at: string | null;
  meeting_url: string | null;
  calendar_event_id: string | null;
  transcription_url: string | null;
  pre_meeting_insights: string | null;
  pre_meeting_insights_generated_at: string | null;
  process_score: number | null;
  conversion_insights: string | null;
  post_meeting_analysis_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Offer attached to a lead (spec §8.3). Multiple offers/revisions allowed. */
export interface LeadOfferRecord {
  id: string;
  lead_id: string;
  status: OfferStatus;
  contracted_send_date: string | null;
  sent_at: string | null;
  offer_url: string | null;
  notes: string | null;
  source_meeting_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Next-step task attached to a lead (spec §8.4). No `task_type` in MVP. */
export interface LeadTaskRecord {
  id: string;
  lead_id: string;
  title: string;
  due_at: string | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  source_meeting_id: string | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Additional-value delivery attached to a lead (spec §8.5). `sequence_number` 1/2 shown in the view. */
export interface LeadValueDeliveryRecord {
  id: string;
  lead_id: string;
  sequence_number: number;
  planned_date: string | null;
  value_items: string[];
  sent_at: string | null;
  source_meeting_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReplyRecord {
  id: string;
  created_at: string;
  lead_id: string | null;
  external_id: string;
  sequence_step: number | null;
  message_subject: string | null;
  message_text: string | null;
  received_at: string;
  client_id: string | null;
  from_email_address: string | null;
  is_automated_reply: boolean;
  classification: ReplyClassification | null;
  short_reason: string | null;
  language_detected: string | null;
  is_forwarded: boolean;
}

// Snapshot DTO — fields are pruned to what the frontend actually reads.
// Fields dropped from the wire format vs. the underlying DB row (no consumer
// in production source as of payload audit): id, created_at, inboxes_active.
export interface CampaignDailyStatRecord {
  campaign_id: string;
  report_date: string;
  sent_count: number | null;
  reply_count: number | null;
  bounce_count: number | null;
  unique_open_count: number | null;
  positive_replies_count: number;
}

// Snapshot DTO — fields are pruned to what the frontend actually reads.
// Fields dropped from the wire format vs. the underlying DB row (no consumer
// in production source as of payload audit): id, created_at, me_count,
// won_count, prospects_in_base, inboxes_count, week_number, month_number,
// year.
export interface DailyStatRecord {
  client_id: string;
  report_date: string;
  emails_sent: number;
  mql_count: number;
  response_count: number;
  bounce_count: number;
  negative_count: number;
  ooo_count: number;
  human_replies_count: number;
  prospects_count: number;
  schedule_today: number | null;
  schedule_tomorrow: number | null;
  schedule_day_after: number | null;
}

export interface DomainRecord {
  id: string;
  created_at: string;
  /** Null for Winnr-synced domains not yet linked to a client (no linking UI yet). */
  client_id: string | null;
  domain_name: string;
  /** Null on Winnr-synced domains; only portal-created domains require it. */
  setup_email: string | null;
  /** Null on Winnr-synced domains; only portal-created domains require it. */
  purchase_date: string | null;
  updated_at: string;
  /** Local, portal-editable lifecycle status. */
  status: DomainStatus | null;
  /** Winnr sync fields (ingestion-only, read-only in the portal). Separate from local `status`. */
  winnr_status: string | null;
  dns_provider: string | null;
  winnr_tags: string[] | null;
  winnr_email_user_count: number | null;
  winnr_created_at: string | null;
  last_synced_at: string | null;
  missing_since: string | null;
  /** Soft-delete tombstone — see {@link ClientRecord.archived_at}. The Winnr sync keeps refreshing
   *  an archived domain; archiving only hides it from the portal. */
  archived_at?: string | null;
}

export interface InvoiceRecord {
  id: string;
  created_at: string;
  client_id: string;
  issue_date: string;
  amount: number;
  status: string | null;
  updated_at: string | null;
  /** Soft-delete tombstone — see {@link ClientRecord.archived_at}. Admin tier only (RLS). */
  archived_at?: string | null;
}

/**
 * A Winnr mailbox and its current warming snapshot. Ingestion-only: n8n populates this from
 * Winnr (/v1/email-users + /v1/warming); the portal only reads. Warming statuses are free `text`
 * because the taxonomy is owned by the external API. History lives in EmailAccountWarmingDailyRecord.
 */
export interface EmailAccountRecord {
  id: string;
  domain_id: string;
  winnr_email_user_id: string;
  email_address: string;
  username: string | null;
  display_name: string | null;
  status: string | null;
  warming_status: string | null;
  warming_health_score: number | null;
  warming_inbox_rate: number | null;
  warming_spam_rate: number | null;
  warming_daily_volume: number | null;
  warming_progress: number | null;
  winnr_created_at: string | null;
  last_seen_at: string;
  last_synced_at: string | null;
  missing_since: string | null;
  created_at: string;
  updated_at: string;
  /** Soft-delete tombstone — see {@link ClientRecord.archived_at}. The Winnr sync keeps refreshing
   *  an archived mailbox; archiving only hides it from the portal. */
  archived_at?: string | null;
}

/** One day of a mailbox's warming history (from /v1/warming/{id}/metrics). Ingestion-only. */
export interface EmailAccountWarmingDailyRecord {
  email_account_id: string;
  metric_date: string;
  warming_status: string | null;
  emails_sent: number | null;
  health_score: number | null;
  inbox_rate: number | null;
  spam_rate: number | null;
  daily_volume: number | null;
  warmup_progress: number | null;
  synced_at: string;
}

/** Domain-level warming aggregate from the domain_warming_summary view. */
export interface DomainWarmingSummaryRecord {
  domain_id: string;
  email_accounts_count: number;
  active_warming_accounts_count: number;
  average_health_score: number | null;
  lowest_inbox_rate: number | null;
  highest_spam_rate: number | null;
}

export interface EmailExcludeRecord {
  domain: string;
  created_at: string;
}

export interface ConditionRuleRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  target_entity: ConditionTargetEntity;
  surface: string;
  metric_key: string;
  source_sheet: string | null;
  source_range: string | null;
  scope_type: ConditionScopeType;
  client_id: string | null;
  manager_id: string | null;
  apply_to: ConditionApplyTo;
  column_key: string | null;
  branches: unknown;
  base_filter: unknown | null;
  priority: number;
  enabled: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Identity {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  clientId?: string;
  /** Storage object path in the user-avatars bucket; null/undefined when no photo. */
  avatarPath?: string | null;
}

export interface InviteRequest {
  email: string;
  role: InviteRole;
  clientId?: string;
  /** Typed by the inviter. Blank falls back to the email local part (`send-invite`). */
  firstName?: string;
  lastName?: string;
}

export interface InviteRecord {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  invitedAt: string | null;
  acceptedAt: string | null;
  expiresAt: string | null;
  clientId: string | null;
  clientName: string | null;
  invitedById: string | null;
  invitedByName: string | null;
  canResend: boolean;
  canRevoke: boolean;
}

export type ClientCustomFieldType = "text" | "checkbox" | "droplist" | "link" | "number" | "currency";

export interface ColumnOverrideRecord {
  column_key: string;
  label_override: string | null;
  hidden: boolean;
  /**
   * Explicit position in the mega-table column order. `null` means
   * "use MEGA_COLUMNS default order". Columns with explicit positions
   * are rendered first (ascending), then the rest in default order.
   */
  position: number | null;
  updated_at: string;
  updated_by: string | null;
}

export interface ClientCustomFieldRecord {
  id: string;
  name: string;
  field_type: ClientCustomFieldType;
  options: string[] | null;
  position: number;
  /** Roles that may write values for this field (e.g. ['master_admin', 'manager']). */
  editable_by: string[];
  created_by: string | null;
  created_at: string;
}

export interface ClientCustomFieldValueRecord {
  client_id: string;
  field_id: string;
  value: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Per-client custom column on the Leads report (Batch 4, Task 4F). */
export interface LeadCustomFieldRecord {
  id: string;
  /** Owning client — custom columns never leak across clients. */
  client_id: string;
  name: string;
  field_type: ClientCustomFieldType;
  options: string[] | null;
  position: number;
  /** Roles that may write values for this field (default ['admin','master_admin']). */
  editable_by: string[];
  created_by: string | null;
  created_at: string;
}

/** Per-lead value for a LeadCustomFieldRecord. */
export interface LeadCustomFieldValueRecord {
  lead_id: string;
  field_id: string;
  value: string | null;
  updated_at: string;
  updated_by: string | null;
}

