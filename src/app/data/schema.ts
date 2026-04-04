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
export type LeadQualification =
  | 'unprocessed' | 'unqualified' | 'preMQL' | 'MQL'
  | 'meeting_scheduled' | 'meeting_held' | 'offer_sent' | 'won' | 'rejected';
export type CampaignType = 'outreach' | 'ooo' | 'nurture';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type CrmPlatform = 'livespace' | 'pipedrive' | 'zoho' | 'salesforce' | 'none';

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
  status: string | null; // TEXT in DB (active, paused, completed, draft)
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
  is_ooo: boolean;
  expected_return_date: string | null;
  latest_reply_at: string | null;
  replied_at_step: number | null;
  total_replies_count: number;
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
  ai_confidence: number | null; // 0.00–1.00 (numeric 3,2)
  extracted_date: string | null;
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
}

export interface ClientDailySnapshot {
  id: string;
  client_id: string;
  snapshot_date: string; // DATE
  inboxes_active: number;
  prospects_count: number;
  emails_sent_total: number; // cumulative
  bounce_count: number;
  mql_diff: number;   // delta for this day
  me_diff: number;    // meetings scheduled delta
  won_diff: number;   // won delta
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
  created_at: string;
}

export interface Invoice {
  id: string;
  client_id: string;
  issue_date: string;
  amount: number;
  status: InvoiceStatus;
  vindication_stage: string | null;
  created_at: string;
}

export interface EmailExcludeItem {
  domain: string;
  added_by: string | null;
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
