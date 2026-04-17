import type {
  AppRole,
  CampaignDailyStatRecord,
  CampaignRecord,
  ClientRecord,
  DailyStatRecord,
  DomainRecord,
  Identity,
  InvoiceRecord,
  LeadQualification,
  LeadRecord,
  ReplyRecord,
} from "../types/core";

export function getRoleLabel(role: AppRole) {
  return role === "manager" ? "CS Manager" : role.replace("_", " ");
}

export function scopeClients(identity: Identity, clients: ClientRecord[]) {
  if (identity.role === "admin" || identity.role === "super_admin") return clients;
  if (identity.role === "manager") return clients.filter((item) => item.manager_id === identity.id);
  if (identity.role === "client" && identity.clientId) {
    return clients.filter((item) => item.id === identity.clientId);
  }
  return [];
}

export function scopeCampaigns(identity: Identity, clients: ClientRecord[], campaigns: CampaignRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  const base = campaigns.filter((item) => clientIds.has(item.client_id));
  if (identity.role === "client") return base.filter((item) => item.type === "outreach");
  return base;
}

export function scopeLeads(identity: Identity, clients: ClientRecord[], leads: LeadRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  return leads.filter((item) => clientIds.has(item.client_id));
}

export function scopeReplies(identity: Identity, clients: ClientRecord[], replies: ReplyRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  return replies.filter((item) => !item.client_id || clientIds.has(item.client_id));
}

export function scopeCampaignStats(
  identity: Identity,
  clients: ClientRecord[],
  campaigns: CampaignRecord[],
  stats: CampaignDailyStatRecord[],
) {
  const campaignIds = new Set(scopeCampaigns(identity, clients, campaigns).map((item) => item.id));
  return stats.filter((item) => campaignIds.has(item.campaign_id));
}

export function scopeDailyStats(identity: Identity, clients: ClientRecord[], stats: DailyStatRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  return stats.filter((item) => clientIds.has(item.client_id));
}

export function scopeDomains(identity: Identity, clients: ClientRecord[], domains: DomainRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  return domains.filter((item) => clientIds.has(item.client_id));
}

export function scopeInvoices(identity: Identity, clients: ClientRecord[], invoices: InvoiceRecord[]) {
  const clientIds = new Set(scopeClients(identity, clients).map((item) => item.id));
  return invoices.filter((item) => clientIds.has(item.client_id));
}

export function getLeadStage(lead: LeadRecord): LeadQualification | "unqualified" {
  if (lead.won) return "won";
  if (lead.offer_sent) return "offer_sent";
  if (lead.meeting_held) return "meeting_held";
  if (lead.meeting_booked) return "meeting_scheduled";
  if (!lead.qualification) return "unqualified";
  return lead.qualification;
}
