import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type {
  CampaignRecord,
  ConditionRuleRecord,
  ClientUserRecord,
  ClientRecord,
  CoreSnapshot,
  DomainRecord,
  EmailExcludeRecord,
  InviteRecord,
  InviteRequest,
  InvoiceRecord,
  LeadRecord,
  UserRecord,
} from "../types/core";
import type {
  LoadIdentityResult,
  OrmGatewayAction,
  OrmGatewayEnvelope,
  OrmGatewayRequest,
  OrmGatewayResponseMap,
} from "./orm-gateway-contract";

type RepositoryOperation = "select" | "insert" | "update" | "upsert" | "delete";
type RepositoryErrorKind = "permission" | "network" | "timeout" | "unknown";

const SNAPSHOT_RETRY_DELAYS_MS = [250, 600] as const;

const ORM_ACTION_META: Record<OrmGatewayAction, { table: string; operation: RepositoryOperation }> = {
  loadSnapshot: { table: "snapshot", operation: "select" },
  loadConditionRules: { table: "condition_rules", operation: "select" },
  updateClient: { table: "clients", operation: "update" },
  updateCampaign: { table: "campaigns", operation: "update" },
  updateLead: { table: "leads", operation: "update" },
  updateDomain: { table: "domains", operation: "update" },
  updateInvoice: { table: "invoices", operation: "update" },
  createConditionRule: { table: "condition_rules", operation: "insert" },
  updateConditionRule: { table: "condition_rules", operation: "update" },
  deleteConditionRule: { table: "condition_rules", operation: "delete" },
  upsertClientUserMapping: { table: "client_users", operation: "upsert" },
  deleteClientUserMapping: { table: "client_users", operation: "delete" },
  upsertEmailExcludeDomain: { table: "email_exclude_list", operation: "upsert" },
  deleteEmailExcludeDomain: { table: "email_exclude_list", operation: "delete" },
  loadIdentity: { table: "users", operation: "select" },
  updateProfileName: { table: "users", operation: "update" },
};

export class RepositoryError extends Error {
  readonly table: string;
  readonly operation: RepositoryOperation;
  readonly kind: RepositoryErrorKind;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor({
    table,
    operation,
    kind,
    message,
    code,
    details,
    hint,
  }: {
    table: string;
    operation: RepositoryOperation;
    kind: RepositoryErrorKind;
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  }) {
    super(message);
    this.name = "RepositoryError";
    this.table = table;
    this.operation = operation;
    this.kind = kind;
    this.code = code;
    this.details = details;
    this.hint = hint;
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

function classifyErrorKind(message: string, code?: string): RepositoryErrorKind {
  if (code === "57014") return "timeout";
  if (code === "42501") return "permission";
  const lower = message.toLowerCase();
  if (
    lower.includes("statement timeout") ||
    lower.includes("canceling statement") ||
    lower.includes("57014")
  ) {
    return "timeout";
  }
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
    lower.includes("503") ||
    lower.includes("502") ||
    lower.includes("504") ||
    lower.includes("timeout")
  ) {
    return "network";
  }
  return "unknown";
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function extractPostgrestFields(reason: unknown): PostgrestLikeError {
  if (typeof reason !== "object" || reason === null) return {};
  const r = reason as PostgrestLikeError;
  return {
    code: typeof r.code === "string" ? r.code : undefined,
    message: typeof r.message === "string" ? r.message : undefined,
    details: typeof r.details === "string" ? r.details : undefined,
    hint: typeof r.hint === "string" ? r.hint : undefined,
  };
}

function mapRepositoryError(reason: unknown, table: string, operation: RepositoryOperation): RepositoryError {
  if (reason instanceof RepositoryError) {
    return reason;
  }
  const pg = extractPostgrestFields(reason);
  const message = pg.message ?? getReasonMessage(reason);
  const kind = classifyErrorKind(message, pg.code);
  return new RepositoryError({
    table,
    operation,
    kind,
    message,
    code: pg.code,
    details: pg.details,
    hint: pg.hint,
  });
}

function isRetryable(error: RepositoryError) {
  return error.operation === "select" && (error.kind === "network" || error.kind === "timeout");
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

async function performEdgeFunctionRequest(
  functionName: "send-invite" | "manage-invites" | "orm-gateway",
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
  let response = await performEdgeFunctionRequest(functionName, firstToken, body);

  if (response.status === 401) {
    const refresh = await client.auth.refreshSession();
    if (!refresh.error && refresh.data.session?.access_token) {
      response = await performEdgeFunctionRequest(functionName, refresh.data.session.access_token, body);
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

async function invokeOrmGatewayAction<TAction extends OrmGatewayAction>(
  action: TAction,
  payload: Omit<Extract<OrmGatewayRequest, { action: TAction }>, "action">,
): Promise<OrmGatewayResponseMap[TAction]> {
  const client = ensureSupabase();
  const firstToken = await getSessionAccessToken();
  const body = { action, ...payload } as Record<string, unknown>;
  const meta = ORM_ACTION_META[action];

  let response = await performEdgeFunctionRequest("orm-gateway", firstToken, body);

  if (response.status === 401) {
    const refresh = await client.auth.refreshSession();
    if (!refresh.error && refresh.data.session?.access_token) {
      response = await performEdgeFunctionRequest("orm-gateway", refresh.data.session.access_token, body);
    }
  }

  const text = await response.text();
  let envelope: OrmGatewayEnvelope<OrmGatewayResponseMap[TAction]> | null = null;

  if (text) {
    try {
      envelope = JSON.parse(text) as OrmGatewayEnvelope<OrmGatewayResponseMap[TAction]>;
    } catch {
      envelope = null;
    }
  }

  const fallbackMessage = `ORM gateway request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`;

  if (!response.ok) {
    const errorMessage = envelope && !envelope.ok ? envelope.error.message : fallbackMessage;
    const errorCode = envelope && !envelope.ok ? envelope.error.code : undefined;
    const errorDetails = envelope && !envelope.ok ? envelope.error.details : undefined;
    const errorHint = envelope && !envelope.ok ? envelope.error.hint : undefined;

    throw new RepositoryError({
      table: meta.table,
      operation: meta.operation,
      kind: classifyErrorKind(errorMessage, errorCode),
      message: errorMessage,
      code: errorCode,
      details: errorDetails,
      hint: errorHint,
    });
  }

  if (!envelope) {
    throw new RepositoryError({
      table: meta.table,
      operation: meta.operation,
      kind: "unknown",
      message: "ORM gateway returned an invalid response payload.",
    });
  }

  if (!envelope.ok) {
    throw new RepositoryError({
      table: meta.table,
      operation: meta.operation,
      kind: classifyErrorKind(envelope.error.message, envelope.error.code),
      message: envelope.error.message,
      code: envelope.error.code,
      details: envelope.error.details,
      hint: envelope.error.hint,
    });
  }

  return envelope.data;
}

async function invokeOrmGatewaySelectWithRetry<TAction extends OrmGatewayAction>(
  action: TAction,
  payload: Omit<Extract<OrmGatewayRequest, { action: TAction }>, "action">,
): Promise<OrmGatewayResponseMap[TAction]> {
  const meta = ORM_ACTION_META[action];

  for (let attempt = 0; attempt <= SNAPSHOT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await invokeOrmGatewayAction(action, payload);
    } catch (reason) {
      const mapped = mapRepositoryError(reason, meta.table, meta.operation);
      const isLastAttempt = attempt === SNAPSHOT_RETRY_DELAYS_MS.length;
      if (isLastAttempt || !isRetryable(mapped)) {
        throw mapped;
      }
      await sleep(SNAPSHOT_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new RepositoryError({
    table: meta.table,
    operation: meta.operation,
    kind: "unknown",
    message: "ORM gateway select failed after retries.",
  });
}

export interface Repository {
  loadSnapshot(options?: {
    includeDailyStats?: boolean;
    leadsLimit?: number;
  }): Promise<CoreSnapshot>;
  loadConditionRules(): Promise<ConditionRuleRecord[]>;
  updateClient(clientId: string, patch: Partial<ClientRecord>): Promise<ClientRecord>;
  updateCampaign(campaignId: string, patch: Partial<CampaignRecord>): Promise<CampaignRecord>;
  updateLead(leadId: string, patch: Partial<LeadRecord>): Promise<LeadRecord>;
  updateDomain(domainId: string, patch: Partial<DomainRecord>): Promise<DomainRecord>;
  updateInvoice(invoiceId: string, patch: Partial<InvoiceRecord>): Promise<InvoiceRecord>;
  createConditionRule(
    input: Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at" | "created_by"> & { created_by?: string | null },
  ): Promise<ConditionRuleRecord>;
  updateConditionRule(
    ruleId: string,
    patch: Partial<Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at">>,
  ): Promise<ConditionRuleRecord>;
  deleteConditionRule(ruleId: string): Promise<void>;
  sendInvite(payload: InviteRequest): Promise<{ inviteId: string | null }>;
  listInvites(): Promise<InviteRecord[]>;
  resendInvite(inviteId: string): Promise<InviteRecord>;
  revokeInvite(inviteId: string): Promise<void>;
  upsertClientUserMapping(userId: string, clientId: string): Promise<ClientUserRecord>;
  deleteClientUserMapping(mappingId: string): Promise<void>;
  upsertEmailExcludeDomain(domain: string): Promise<EmailExcludeRecord>;
  deleteEmailExcludeDomain(domain: string): Promise<void>;
  loadIdentity(sessionUserId: string): Promise<LoadIdentityResult>;
  updateProfileName(sessionUserId: string, fullName: string): Promise<UserRecord>;
}

export const repository: Repository = {
  async loadSnapshot(options) {
    const includeDailyStats = options?.includeDailyStats ?? true;
    const leadsLimit = options?.leadsLimit;

    return invokeOrmGatewaySelectWithRetry("loadSnapshot", {
      includeDailyStats,
      leadsLimit,
    });
  },

  async loadConditionRules() {
    return invokeOrmGatewaySelectWithRetry("loadConditionRules", {});
  },

  async updateClient(clientId, patch) {
    return invokeOrmGatewayAction("updateClient", { clientId, patch });
  },

  async updateCampaign(campaignId, patch) {
    return invokeOrmGatewayAction("updateCampaign", { campaignId, patch });
  },

  async updateLead(leadId, patch) {
    return invokeOrmGatewayAction("updateLead", { leadId, patch });
  },

  async updateDomain(domainId, patch) {
    return invokeOrmGatewayAction("updateDomain", { domainId, patch });
  },

  async updateInvoice(invoiceId, patch) {
    return invokeOrmGatewayAction("updateInvoice", { invoiceId, patch });
  },

  async createConditionRule(input) {
    return invokeOrmGatewayAction("createConditionRule", { input });
  },

  async updateConditionRule(ruleId, patch) {
    const payload = {
      ...patch,
      updated_at: new Date().toISOString(),
    };
    return invokeOrmGatewayAction("updateConditionRule", { ruleId, patch: payload });
  },

  async deleteConditionRule(ruleId) {
    await invokeOrmGatewayAction("deleteConditionRule", { ruleId });
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
    return invokeOrmGatewayAction("upsertClientUserMapping", { userId, clientId });
  },

  async deleteClientUserMapping(mappingId) {
    await invokeOrmGatewayAction("deleteClientUserMapping", { mappingId });
  },

  async upsertEmailExcludeDomain(domain) {
    return invokeOrmGatewayAction("upsertEmailExcludeDomain", { domain });
  },

  async deleteEmailExcludeDomain(domain) {
    await invokeOrmGatewayAction("deleteEmailExcludeDomain", { domain });
  },

  async loadIdentity(sessionUserId) {
    return invokeOrmGatewaySelectWithRetry("loadIdentity", { sessionUserId });
  },

  async updateProfileName(sessionUserId, fullName) {
    const { user } = await invokeOrmGatewayAction("updateProfileName", { sessionUserId, fullName });
    return user;
  },
};
