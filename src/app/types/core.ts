export type AppRole = "super_admin" | "admin" | "master_admin" | "manager" | "client";
export type InviteRole = "admin" | "manager" | "client";
export type InviteStatus = "pending" | "accepted" | "expired";
export const CLIENT_STATUSES = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
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
  | "rejected"
  | "OOO"
  | "NRR";
export type ReplyClassification =
  | "OOO"
  | "Interested"
  | "NRR"
  | "Left_Company"
  | "Spam_Inbound"
  | "other";
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
/** Contact disposition — a separate dimension DERIVED from the n8n-owned `qualification`. Domain names
 *  are canonical (spec item 10); the legacy `OOO`/`NRR` abbreviations survive only as the qualification
 *  input values mapped in `mapLegacyQualificationToDisposition`. */
export type ContactDisposition = "out_of_office" | "not_right_role";
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

export type CrmIntegrationStatus = "pending" | "connected" | "failed" | "disconnected";

export interface CrmIntegrationConfig {
  provider: string;
  display_name: string;
  auth_type: "oauth2" | "api_key";
  status: CrmIntegrationStatus;
  connected_at: string | null;
  updated_at: string;
  last_error?: string | null;
  metadata?: Record<string, unknown> | null;
}

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
  crm_config: Record<string, unknown> | null;
  sms_phone_numbers: string[] | null;
  notification_emails: string[] | null;
  auto_ooo_enabled: boolean;
  prospects_signed: number;
  prospects_added: number;
  setup_info: string | null;
  bi_setup_done: boolean;
  lost_reason: string | null;
  notes: string | null;
}

export interface ClientUserRecord {
  id: string;
  created_at: string;
  client_id: string;
  user_id: string;
}

// ── Sequencers (ADR-0012) ─────────────────────────────────────────────────────
// External sending tools (Smartlead / EmailBison / Aimfox). Catalog rows carry
// fixed load-bearing UUIDs (column defaults + n8n constants); per-client
// credentials live in client_sequencers (replaced clients.external_api_key /
// external_workspace_id / linkedin_api_key).

export type SequencerChannel = "email" | "linkedin";

export interface SequencerRecord {
  id: string;
  /** Stable machine key: 'smartlead' | 'emailbison' | 'aimfox' | future additions. */
  key: string;
  name: string;
  channel: SequencerChannel;
  enabled: boolean;
  created_at: string;
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
  expected_return_date: string | null;
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
  added_to_ooo_campaign: boolean;
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
  /** Persisted contact disposition (n8n-owned), independent of `qualification`; `null` = active. */
  contact_disposition: ContactDisposition | null;
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
  client_id: string;
  domain_name: string;
  setup_email: string;
  purchase_date: string;
  exchange_date: string;
  updated_at: string;
  status: DomainStatus | null;
  reputation: string | null;
  exchange_cost: number | null;
  campaign_verified_at: string | null;
  warmup_verified_at: string | null;
}

export interface InvoiceRecord {
  id: string;
  created_at: string;
  client_id: string;
  issue_date: string;
  amount: number;
  status: string | null;
  updated_at: string | null;
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

