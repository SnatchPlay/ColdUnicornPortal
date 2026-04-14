// ============================================================
// GHEADS PDCA Platform — TypeScript types strictly from DB schema
// ============================================================

// --- ENUMs ---
export type UserRole = 'super_admin' | 'admin' | 'cs_manager' | 'client';
export type ClientStatus = 'onboarding' | 'active' | 'paused' | 'churned' | 'lost';
export type ReplyIntent = 'positive' | 'negative' | 'ooo' | 'info_requested' | 'unclassified';
export type LeadGender = 'male' | 'female' | 'general';
export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';
export type CrmPipelineStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type LgPipelineStage = 'new' | 'contacted' | 'demo' | 'proposal' | 'closed_won' | 'closed_lost';
export type LeadQualification =
  | 'unprocessed' | 'unqualified' | 'preMQL' | 'MQL'
  | 'meeting_scheduled' | 'meeting_held' | 'offer_sent' | 'won' | 'rejected';
export type CampaignType = 'outreach' | 'ooo' | 'nurture';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type CrmPlatform = 'livespace' | 'pipedrive' | 'zoho' | 'salesforce' | 'none';
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type PartnershipStatus = 'active' | 'paused' | 'ended';
export type AbsStatus = 'prospect' | 'contacted' | 'engaged' | 'won' | 'lost';
export type AuditEventType =
  | 'classification' | 'ooo_routed' | 'blacklist_added' | 'blacklist_removed'
  | 'lead_updated' | 'export' | 'import' | 'health_assessed' | 'campaign_changed'
  | 'invoice_updated' | 'user_invited';

// --- Tables ---

export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientUser {
  id: string;
  client_id: string;
  user_id: string;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
}

export interface Client {
  id: string;
  organization_id: string | null;
  name: string;
  status: ClientStatus;
  cs_manager_id: string | null;
  kpi_leads: number | null;
  kpi_meetings: number | null;
  contracted_amount: number | null;
  contract_due_date: string | null;
  bison_workspace_id: string | null;
  smartlead_client_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientSetup {
  client_id: string;
  auto_ooo_enabled: boolean;
  min_sent_daily: number;
  crm_platform: CrmPlatform | null;
  crm_credentials: Record<string, string> | null;
  inboxes_count: number;
  prospects_in_base: number;
  look4lead_token: string | null;
  updated_at: string;
}

export interface Domain {
  id: string;
  client_id: string;
  domain_name: string;
  setup_email: string | null;
  purchase_date: string | null;
  exchange_date: string | null;
  warmup_reputation: number | null; // 0–100
  is_active: boolean;
  is_blacklisted: boolean;
  created_at: string;
}

export interface Campaign {
  id: string;
  client_id: string;
  external_id: string | null;
  type: CampaignType;
  name: string;
  status: string | null; // active, paused, completed, draft
  database_size: number;
  created_at: string;
}

export interface ClientOooRouting {
  id: string;
  client_id: string;
  gender: LeadGender;
  campaign_id: string;
  is_active: boolean;
}

export interface Lead {
  id: string;
  client_id: string;
  campaign_id: string | null;
  email: string;
  full_name: string | null;
  job_title: string | null;
  company_name: string | null;
  linkedin_url: string | null;
  gender: LeadGender;
  qualification: LeadQualification;
  client_pipeline_stage: string | null; // client-managed: meeting_scheduled, offer_sent, won, rejected
  is_ooo: boolean;
  expected_return_date: string | null;
  latest_reply_at: string | null;
  replied_at_step: number | null;
  total_replies_count: number;
  blacklist_id: string | null;
  domain_blacklist_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadReply {
  id: string;
  lead_id: string;
  external_reply_id: string;
  direction: string; // 'inbound' | 'outbound'
  sequence_step: number | null;
  message_subject: string | null;
  message_text: string;
  received_at: string;
  ai_classification: ReplyIntent;
  ai_reasoning: string | null;
  ai_confidence: number | null; // 0.00–1.00
  ai_language: string | null;
  extracted_date: string | null;
  is_reviewed: boolean;
  created_at: string;
}

export interface OooLead {
  id: string;
  lead_id: string;
  client_id: string;
  campaign_id: string | null;
  expected_return_date: string | null;
  routed_campaign_id: string | null;
  is_processed: boolean;
  processed_at: string | null;
  created_at: string;
}

export interface CampaignDailyStat {
  id: string;
  campaign_id: string;
  report_date: string; // DATE
  sent_count: number;
  reply_count: number;
  bounce_count: number;
  unique_open_count: number;
  positive_count: number;
  negative_count: number;
  ooo_count: number;
  human_reply_count: number;
}

export interface ClientDailySnapshot {
  id: string;
  client_id: string;
  snapshot_date: string; // DATE
  inboxes_active: number;
  prospects_count: number;
  emails_sent_total: number; // cumulative
  bounce_count: number;
  mql_diff: number;
  me_diff: number;
  won_diff: number;
  ooo_accumulated: number;
  negative_total: number;
  human_replies_total: number;
  created_at: string;
}

export interface ClientHealthAssessment {
  id: string;
  client_id: string;
  assessed_by: string | null;
  assessed_at: string;
  ip_health: HealthStatus;
  domains_health: HealthStatus;
  warmup_health: HealthStatus;
  copy_health: HealthStatus;
  funnel_health: HealthStatus;
  insights: string | null;
}

export interface ClientIssue {
  id: string;
  client_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgencyCrmDeal {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  salesperson_id: string | null;
  stage: CrmPipelineStage;
  stage_updated_at: string;
  estimated_value: number | null;
  win_chance: number | null;
  lesson_learned: string | null;
  notes: string | null;
  next_follow_up: string | null;
  created_at: string;
}

export interface LgPipelineDeal {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  source: string | null;
  stage: LgPipelineStage;
  estimated_value: number | null;
  win_chance: number | null;
  notes: string | null;
  next_follow_up: string | null;
  created_at: string;
  updated_at: string;
}

export interface Partnership {
  id: string;
  partner_name: string;
  contact_name: string | null;
  email: string | null;
  monthly_fee: number | null;
  status: PartnershipStatus;
  notes: string | null;
  created_at: string;
}

export interface AccountBasedSelling {
  id: string;
  client_id: string | null;
  company_name: string;
  score: number; // 0–100
  decision_maker: string | null;
  status: AbsStatus;
  notes: string | null;
  created_at: string;
}

export interface CashFlowProjection {
  id: string;
  month: string; // 'YYYY-MM'
  expected_revenue: number;
  actual_revenue: number | null;
  expected_costs: number;
  actual_costs: number | null;
  notes: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  client_id: string;
  issue_date: string;
  amount: number;
  status: InvoiceStatus;
  vindication_stage: string | null;
  notes: string | null;
  created_at: string;
}

export interface EmailExcludeItem {
  domain: string;
  added_by: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  client_id: string | null;
  lead_id: string | null;
  event_type: AuditEventType;
  description: string;
  metadata: Record<string, unknown> | null;
  triggered_by: string; // 'automation' | user_id
  created_at: string;
}

export interface AbmLostClient {
  id: string;
  client_id: string | null;
  client_name: string;
  documents_link: string | null;
  reason_for_loss: string | null;
  return_probability: string | null;
  created_at: string;
}

export interface ImportJob {
  id: string;
  client_id: string | null;
  imported_by: string;
  entity_type: string; // 'leads' | 'domains' | 'campaigns' | 'prospects'
  file_name: string;
  total_rows: number;
  imported_rows: number;
  failed_rows: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  error_log: string | null;
  created_at: string;
  finished_at: string | null;
}