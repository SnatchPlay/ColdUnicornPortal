import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type {
  CampaignDailyStatRecord,
  CampaignRecord,
  ClientUserRecord,
  ClientRecord,
  CoreSnapshot,
  DailyStatRecord,
  DomainRecord,
  EmailExcludeRecord,
  InvoiceRecord,
  LeadRecord,
  ReplyRecord,
  UserRecord,
} from "../types/core";

type RepositoryOperation = "select" | "update" | "upsert" | "delete";
type RepositoryErrorKind = "permission" | "network" | "unknown";

const SNAPSHOT_RETRY_DELAYS_MS = [250, 600] as const;

export class RepositoryError extends Error {
  readonly table: string;
  readonly operation: RepositoryOperation;
  readonly kind: RepositoryErrorKind;

  constructor({
    table,
    operation,
    kind,
    message,
  }: {
    table: string;
    operation: RepositoryOperation;
    kind: RepositoryErrorKind;
    message: string;
  }) {
    super(message);
    this.name = "RepositoryError";
    this.table = table;
    this.operation = operation;
    this.kind = kind;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getReasonMessage(reason: unknown) {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "Unknown repository failure.";
}

function classifyErrorKind(message: string): RepositoryErrorKind {
  const lower = message.toLowerCase();
  if (
    lower.includes("permission") ||
    lower.includes("denied") ||
    lower.includes("forbidden") ||
    lower.includes("policy") ||
    lower.includes("rls") ||
    lower.includes("42501")
  ) {
    return "permission";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("timeout") ||
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("504")
  ) {
    return "network";
  }
  return "unknown";
}

function mapRepositoryError(reason: unknown, table: string, operation: RepositoryOperation): RepositoryError {
  if (reason instanceof RepositoryError) {
    return reason;
  }
  const message = getReasonMessage(reason);
  const kind = classifyErrorKind(message);
  return new RepositoryError({
    table,
    operation,
    kind,
    message,
  });
}

function isRetryable(error: RepositoryError) {
  return error.operation === "select" && error.kind === "network";
}

function ensureSupabase() {
  if (!supabase) {
    throw new RepositoryError({
      table: "runtime",
      operation: "select",
      kind: "unknown",
      message: runtimeConfig.error ?? "Supabase is not configured.",
    });
  }
  return supabase;
}

export interface Repository {
  loadSnapshot(options?: {
    includeDailyStats?: boolean;
    leadsLimit?: number;
  }): Promise<CoreSnapshot>;
  updateClient(clientId: string, patch: Partial<ClientRecord>): Promise<ClientRecord>;
  updateCampaign(campaignId: string, patch: Partial<CampaignRecord>): Promise<CampaignRecord>;
  updateLead(leadId: string, patch: Partial<LeadRecord>): Promise<LeadRecord>;
  updateDomain(domainId: string, patch: Partial<DomainRecord>): Promise<DomainRecord>;
  updateInvoice(invoiceId: string, patch: Partial<InvoiceRecord>): Promise<InvoiceRecord>;
  upsertClientUserMapping(userId: string, clientId: string): Promise<ClientUserRecord>;
  deleteClientUserMapping(mappingId: string): Promise<void>;
  upsertEmailExcludeDomain(domain: string): Promise<EmailExcludeRecord>;
  deleteEmailExcludeDomain(domain: string): Promise<void>;
}

async function selectTable<T>(table: string, orderBy = "created_at", limit?: number): Promise<T[]> {
  const client = ensureSupabase();

  for (let attempt = 0; attempt <= SNAPSHOT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      let query = client.from(table).select("*").order(orderBy, { ascending: false });
      if (typeof limit === "number") {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) {
        throw mapRepositoryError(error, table, "select");
      }
      return (data ?? []) as T[];
    } catch (reason) {
      const mapped = mapRepositoryError(reason, table, "select");
      const isLastAttempt = attempt === SNAPSHOT_RETRY_DELAYS_MS.length;
      if (isLastAttempt || !isRetryable(mapped)) {
        throw mapped;
      }
      await sleep(SNAPSHOT_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new RepositoryError({
    table,
    operation: "select",
    kind: "unknown",
    message: "Failed to load table after retries.",
  });
}

export const repository: Repository = {
  async loadSnapshot(options) {
    const includeDailyStats = options?.includeDailyStats ?? true;
    const leadsLimit = options?.leadsLimit;

    const [users, clients, clientUsers, campaigns, leads, replies, campaignDailyStats, dailyStats, domains, invoices, emailExcludeList] =
      await Promise.all([
        selectTable<UserRecord>("users"),
        selectTable<ClientRecord>("clients"),
        selectTable<ClientUserRecord>("client_users"),
        selectTable<CampaignRecord>("campaigns"),
        selectTable<LeadRecord>("leads", "updated_at", leadsLimit),
        selectTable<ReplyRecord>("replies", "received_at"),
        selectTable<CampaignDailyStatRecord>("campaign_daily_stats", "report_date"),
        includeDailyStats ? selectTable<DailyStatRecord>("daily_stats", "report_date") : Promise.resolve([]),
        selectTable<DomainRecord>("domains", "updated_at"),
        selectTable<InvoiceRecord>("invoices", "issue_date"),
        selectTable<EmailExcludeRecord>("email_exclude_list", "created_at"),
      ]);

    return {
      users,
      clients,
      clientUsers,
      campaigns,
      leads,
      replies,
      campaignDailyStats,
      dailyStats,
      domains,
      invoices,
      emailExcludeList,
    };
  },
  async updateClient(clientId, patch) {
    const client = ensureSupabase();
    const { data, error } = await client.from("clients").update(patch).eq("id", clientId).select("*").single();
    if (error) throw mapRepositoryError(error, "clients", "update");
    return data as ClientRecord;
  },
  async updateCampaign(campaignId, patch) {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("campaigns")
      .update(patch)
      .eq("id", campaignId)
      .select("*")
      .single();
    if (error) throw mapRepositoryError(error, "campaigns", "update");
    return data as CampaignRecord;
  },
  async updateLead(leadId, patch) {
    const client = ensureSupabase();
    const { data, error } = await client.from("leads").update(patch).eq("id", leadId).select("*").single();
    if (error) throw mapRepositoryError(error, "leads", "update");
    return data as LeadRecord;
  },
  async updateDomain(domainId, patch) {
    const client = ensureSupabase();
    const { data, error } = await client.from("domains").update(patch).eq("id", domainId).select("*").single();
    if (error) throw mapRepositoryError(error, "domains", "update");
    return data as DomainRecord;
  },
  async updateInvoice(invoiceId, patch) {
    const client = ensureSupabase();
    const { data, error } = await client.from("invoices").update(patch).eq("id", invoiceId).select("*").single();
    if (error) throw mapRepositoryError(error, "invoices", "update");
    return data as InvoiceRecord;
  },
  async upsertClientUserMapping(userId, clientId) {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("client_users")
      .upsert({ user_id: userId, client_id: clientId }, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw mapRepositoryError(error, "client_users", "upsert");
    return data as ClientUserRecord;
  },
  async deleteClientUserMapping(mappingId) {
    const client = ensureSupabase();
    const { error } = await client.from("client_users").delete().eq("id", mappingId);
    if (error) throw mapRepositoryError(error, "client_users", "delete");
  },
  async upsertEmailExcludeDomain(domain) {
    const client = ensureSupabase();
    const { data, error } = await client
      .from("email_exclude_list")
      .upsert({ domain }, { onConflict: "domain" })
      .select("*")
      .single();
    if (error) throw mapRepositoryError(error, "email_exclude_list", "upsert");
    return data as EmailExcludeRecord;
  },
  async deleteEmailExcludeDomain(domain) {
    const client = ensureSupabase();
    const { error } = await client.from("email_exclude_list").delete().eq("domain", domain);
    if (error) throw mapRepositoryError(error, "email_exclude_list", "delete");
  },
};
