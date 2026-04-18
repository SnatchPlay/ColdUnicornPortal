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
  InviteRecord,
  InviteRequest,
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
  const maybeHttpStatus =
    typeof reason === "object" && reason !== null && "context" in reason
      ? ((reason as { context?: { status?: number; statusText?: string } }).context ?? null)
      : null;

  if (maybeHttpStatus?.status) {
    const statusText = maybeHttpStatus.statusText ? ` ${maybeHttpStatus.statusText}` : "";
    return `Edge Function request failed with HTTP ${maybeHttpStatus.status}${statusText}.`;
  }

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

async function getSessionAccessToken() {
  const client = ensureSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new RepositoryError({
      table: "auth",
      operation: "select",
      kind: "permission",
      message: "Could not validate your authenticated session. Please sign in again.",
    });
  }

  let session = data.session;

  if (session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000) {
    const refresh = await client.auth.refreshSession();
    if (refresh.error) {
      throw new RepositoryError({
        table: "auth",
        operation: "select",
        kind: "permission",
        message: "Your session expired and could not be refreshed. Please sign in again.",
      });
    }
    session = refresh.data.session;
  }

  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new RepositoryError({
      table: "auth",
      operation: "select",
      kind: "permission",
      message: "Your session is missing an access token. Please sign in again.",
    });
  }

  return accessToken;
}

async function performInviteFunctionRequest(
  functionName: "send-invite" | "manage-invites",
  accessToken: string,
  body: Record<string, unknown>,
) {
  const endpoint = `${runtimeConfig.supabaseUrl}/functions/v1/${functionName}`;

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: runtimeConfig.supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
}

async function invokeInviteEdgeFunction<TResponse>(
  functionName: "send-invite" | "manage-invites",
  body: Record<string, unknown>,
): Promise<TResponse> {
  const client = ensureSupabase();
  const firstToken = await getSessionAccessToken();
  let response = await performInviteFunctionRequest(functionName, firstToken, body);

  if (response.status === 401) {
    const refresh = await client.auth.refreshSession();
    if (!refresh.error && refresh.data.session?.access_token) {
      response = await performInviteFunctionRequest(functionName, refresh.data.session.access_token, body);
    }
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const backendMessage =
      typeof payload.error === "string"
        ? payload.error
        : `Edge Function request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`;

    throw new RepositoryError({
      table: "invites",
      operation: "select",
      kind: classifyErrorKind(backendMessage),
      message: backendMessage,
    });
  }

  return payload as TResponse;
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
  sendInvite(payload: InviteRequest): Promise<{ inviteId: string | null }>;
  listInvites(): Promise<InviteRecord[]>;
  resendInvite(inviteId: string): Promise<InviteRecord>;
  revokeInvite(inviteId: string): Promise<void>;
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
  async sendInvite(payload) {
    ensureSupabase();
    const typedData = await invokeInviteEdgeFunction<{ ok?: boolean; inviteId?: string; error?: string }>(
      "send-invite",
      payload as Record<string, unknown>,
    );
    if (!typedData.ok) {
      throw mapRepositoryError(typedData.error ?? "Invitation request failed.", "invites", "upsert");
    }

    return { inviteId: typedData.inviteId ?? null };
  },
  async listInvites() {
    ensureSupabase();
    const typedData = await invokeInviteEdgeFunction<{ ok?: boolean; invites?: InviteRecord[]; error?: string }>(
      "manage-invites",
      { action: "list" },
    );
    if (!typedData.ok) {
      throw mapRepositoryError(typedData.error ?? "Could not load invitations.", "invites", "select");
    }

    return typedData.invites ?? [];
  },
  async resendInvite(inviteId) {
    ensureSupabase();
    const typedData = await invokeInviteEdgeFunction<{ ok?: boolean; invite?: InviteRecord; error?: string }>(
      "manage-invites",
      { action: "resend", inviteId },
    );
    if (!typedData.ok || !typedData.invite) {
      throw mapRepositoryError(typedData.error ?? "Could not resend invitation.", "invites", "upsert");
    }

    return typedData.invite;
  },
  async revokeInvite(inviteId) {
    ensureSupabase();
    const typedData = await invokeInviteEdgeFunction<{ ok?: boolean; error?: string }>("manage-invites", {
      action: "revoke",
      inviteId,
    });
    if (!typedData.ok) {
      throw mapRepositoryError(typedData.error ?? "Could not revoke invitation.", "invites", "delete");
    }
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
