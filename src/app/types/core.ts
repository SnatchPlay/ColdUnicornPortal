export type AppRole = "super_admin" | "admin" | "manager" | "client";
export type InviteRole = "admin" | "manager" | "client";
export type InviteStatus = "pending" | "accepted" | "expired";
export type ClientStatus = "Active" | "Abo" | "On hold" | "Offboarding" | "Inactive" | "Sales";
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

export interface UserRecord {
  id: string;
  created_at: string;
  updated_at: string | null;
  email: string;
  first_name: string;
  last_name: string;
  role: AppRole;
}

export interface ClientRecord {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  manager_id: string;
  kpi_leads: number | null;
  kpi_meetings: number | null;
  contracted_amount: number | null;
  contract_due_date: string | null;
  external_workspace_id: number | null;
  status: ClientStatus;
  external_api_key: string | null;
  min_daily_sent: number;
  inboxes_count: number;
  crm_config: Record<string, unknown> | null;
  sms_phone_numbers: string[] | null;
  notification_emails: string[] | null;
  auto_ooo_enabled: boolean;
  linkedin_api_key: string | null;
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
  comments: string | null;
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

export interface CampaignDailyStatRecord {
  id: string;
  created_at: string;
  campaign_id: string;
  report_date: string;
  sent_count: number | null;
  reply_count: number | null;
  bounce_count: number | null;
  unique_open_count: number | null;
  inboxes_active: number;
  positive_replies_count: number;
}

export interface DailyStatRecord {
  id: string;
  client_id: string;
  report_date: string;
  emails_sent: number;
  prospects_in_base: number;
  mql_count: number;
  me_count: number;
  response_count: number;
  bounce_count: number;
  won_count: number;
  negative_count: number;
  ooo_count: number;
  human_replies_count: number;
  inboxes_count: number;
  prospects_count: number;
  schedule_today: number | null;
  schedule_tomorrow: number | null;
  schedule_day_after: number | null;
  week_number: number | null;
  month_number: number | null;
  year: number | null;
  created_at: string;
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

export interface Identity {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  clientId?: string;
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

export interface CoreSnapshot {
  users: UserRecord[];
  clients: ClientRecord[];
  clientUsers: ClientUserRecord[];
  campaigns: CampaignRecord[];
  leads: LeadRecord[];
  replies: ReplyRecord[];
  campaignDailyStats: CampaignDailyStatRecord[];
  dailyStats: DailyStatRecord[];
  domains: DomainRecord[];
  invoices: InvoiceRecord[];
  emailExcludeList: EmailExcludeRecord[];
}
