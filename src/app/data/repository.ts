import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type {
  CampaignDailyStatRecord,
  CampaignRecord,
  ClientRecord,
  CoreSnapshot,
  DailyStatRecord,
  LeadRecord,
  ReplyRecord,
  UserRecord,
} from "../types/core";

export interface Repository {
  loadSnapshot(): Promise<CoreSnapshot>;
  updateClient(clientId: string, patch: Partial<ClientRecord>): Promise<ClientRecord>;
  updateCampaign(campaignId: string, patch: Partial<CampaignRecord>): Promise<CampaignRecord>;
  updateLead(leadId: string, patch: Partial<LeadRecord>): Promise<LeadRecord>;
}

async function selectTable<T>(table: string, orderBy = "created_at"): Promise<T[]> {
  if (!supabase) {
    throw new Error(runtimeConfig.error ?? "Supabase is not configured.");
  }
  const { data, error } = await supabase.from(table).select("*").order(orderBy, { ascending: false });
  if (error) throw error;
  return (data ?? []) as T[];
}

export const repository: Repository = {
  async loadSnapshot() {
    const [users, clients, campaigns, leads, replies, campaignDailyStats, dailyStats] =
      await Promise.all([
        selectTable<UserRecord>("users"),
        selectTable<ClientRecord>("clients"),
        selectTable<CampaignRecord>("campaigns"),
        selectTable<LeadRecord>("leads"),
        selectTable<ReplyRecord>("replies", "received_at"),
        selectTable<CampaignDailyStatRecord>("campaign_daily_stats", "report_date"),
        selectTable<DailyStatRecord>("daily_stats", "report_date"),
      ]);

    return {
      users,
      clients,
      campaigns,
      leads,
      replies,
      campaignDailyStats,
      dailyStats,
    };
  },
  async updateClient(clientId, patch) {
    if (!supabase) {
      throw new Error(runtimeConfig.error ?? "Supabase is not configured.");
    }
    const { data, error } = await supabase
      .from("clients")
      .update(patch)
      .eq("id", clientId)
      .select("*")
      .single();
    if (error) throw error;
    return data as ClientRecord;
  },
  async updateCampaign(campaignId, patch) {
    if (!supabase) {
      throw new Error(runtimeConfig.error ?? "Supabase is not configured.");
    }
    const { data, error } = await supabase
      .from("campaigns")
      .update(patch)
      .eq("id", campaignId)
      .select("*")
      .single();
    if (error) throw error;
    return data as CampaignRecord;
  },
  async updateLead(leadId, patch) {
    if (!supabase) {
      throw new Error(runtimeConfig.error ?? "Supabase is not configured.");
    }
    const { data, error } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", leadId)
      .select("*")
      .single();
    if (error) throw error;
    return data as LeadRecord;
  },
};
