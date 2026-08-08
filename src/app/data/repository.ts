import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type {
  AppRole,
  CampaignRecord,
  ClientCustomFieldRecord,
  ClientCustomFieldType,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientSequencerRecord,
  ClientUserRecord,
  ColumnOverrideRecord,
  ConditionRuleRecord,
  DomainRecord,
  EmailExcludeRecord,
  FinalOutcome,
  InviteRecord,
  InviteRequest,
  InvoiceRecord,
  LeadCustomFieldRecord,
  LeadCustomFieldValueRecord,
  LeadMeetingRecord,
  LeadOfferRecord,
  LeadRecord,
  LeadTaskRecord,
  LeadValueDeliveryRecord,
  ManagedUserRecord,
  RoutingKey,
  UserRecord,
} from "../types/core";
import type {
  AdminDashboardOverview,
  AdminSettingsPayload,
  AnalyticsOverviewPayload,
  BlacklistPagePayload,
  CampaignStatsResponse,
  CampaignsListParams,
  CampaignsListResponse,
  ClientDashboardPayload,
  ClientsMetricsSummaryPayload,
  ClientsOverviewPayload,
  ClientsStatsPayload,
  DomainsPagePayload,
  EmailAccountsPagePayload,
  EmailAccountWarmingPayload,
  InvoicesPagePayload,
  LeadDetailResult,
  LeadsFilterOptions,
  LeadsListParams,
  LeadsListResponse,
  LeadCrmListResponse,
  ManagerDashboardOverview,
  ManagerDashboardParams,
  ClientOooRoutingPagePayload,
  WorkspaceSetupResult,
  ShellData,
  TablePreferencesPayload,
} from "../types/view-contracts";
import type {
  LeadMeetingInput,
  LeadOfferInput,
  LeadTaskInput,
  LeadValueDeliveryInput,
  LoadIdentityResult,
  OrmGatewayAction,
  OrmGatewayEnvelope,
  OrmGatewayRequest,
  OrmGatewayResponseMap,
  SequencerCredentialInput,
} from "./orm-gateway-contract";

type RepositoryOperation = "select" | "insert" | "update" | "upsert" | "delete";
type RepositoryErrorKind = "permission" | "network" | "timeout" | "unknown";

const SNAPSHOT_RETRY_DELAYS_MS = [250, 600] as const;

const ORM_ACTION_META: Record<OrmGatewayAction, { table: string; operation: RepositoryOperation }> = {
  loadShellData: { table: "shell", operation: "select" },
  loadAdminDashboardOverview: { table: "dashboard", operation: "select" },
  loadManagerDashboardOverview: { table: "dashboard", operation: "select" },
  loadClientDashboard: { table: "dashboard", operation: "select" },
  loadClientsOverview: { table: "clients", operation: "select" },
  loadClientsStats: { table: "clients", operation: "select" },
  loadClientsMetricsSummary: { table: "clients", operation: "select" },
  loadLeadsList: { table: "leads", operation: "select" },
  loadLeadCrmList: { table: "leads", operation: "select" },
  loadLeadDetail: { table: "leads", operation: "select" },
  loadLeadsFilterOptions: { table: "leads", operation: "select" },
  loadAnalyticsOverview: { table: "analytics", operation: "select" },
  loadAdminSettings: { table: "settings", operation: "select" },
  loadDomainsPage: { table: "domains", operation: "select" },
  loadEmailAccountsPage: { table: "email_accounts", operation: "select" },
  loadEmailAccountWarming: { table: "email_account_warming_daily", operation: "select" },
  loadInvoicesPage: { table: "invoices", operation: "select" },
  loadBlacklistPage: { table: "email_exclude_list", operation: "select" },
  loadCampaignsList: { table: "campaigns", operation: "select" },
  loadCampaignStats: { table: "campaign_daily_stats", operation: "select" },
  loadConditionRules: { table: "condition_rules", operation: "select" },
  loadClientOooRouting: { table: "client_ooo_routing", operation: "select" },
  upsertClientOooRouting: { table: "client_ooo_routing", operation: "upsert" },
  deactivateClientOooRouting: { table: "client_ooo_routing", operation: "update" },
  updateClient: { table: "clients", operation: "update" },
  updateCampaign: { table: "campaigns", operation: "update" },
  updateLead: { table: "leads", operation: "update" },
  concludeLead: { table: "leads", operation: "update" },
  upsertLeadMeeting: { table: "lead_meetings", operation: "upsert" },
  upsertLeadOffer: { table: "lead_offers", operation: "upsert" },
  upsertLeadValueDelivery: { table: "lead_value_deliveries", operation: "upsert" },
  loadLeadTasks: { table: "lead_tasks", operation: "select" },
  upsertLeadTask: { table: "lead_tasks", operation: "upsert" },
  updateDomain: { table: "domains", operation: "update" },
  updateInvoice: { table: "invoices", operation: "update" },
  createClient: { table: "clients", operation: "insert" },
  createCampaign: { table: "campaigns", operation: "insert" },
  createLead: { table: "leads", operation: "insert" },
  createDomain: { table: "domains", operation: "insert" },
  createConditionRule: { table: "condition_rules", operation: "insert" },
  updateConditionRule: { table: "condition_rules", operation: "update" },
  deleteConditionRule: { table: "condition_rules", operation: "delete" },
  upsertClientUserMapping: { table: "client_users", operation: "upsert" },
  deleteClientUserMapping: { table: "client_users", operation: "delete" },
  upsertEmailExcludeDomain: { table: "email_exclude_list", operation: "upsert" },
  deleteEmailExcludeDomain: { table: "email_exclude_list", operation: "delete" },
  loadIdentity: { table: "users", operation: "select" },
  updateProfileName: { table: "users", operation: "update" },
  updateProfileAvatar: { table: "users", operation: "update" },
  upsertColumnOverride: { table: "client_table_column_overrides", operation: "upsert" },
  setColumnOrder: { table: "client_table_column_overrides", operation: "update" },
  loadTablePreferences: { table: "user_table_preferences", operation: "select" },
  saveTablePreferences: { table: "user_table_preferences", operation: "upsert" },
  createClientCustomField: { table: "client_custom_fields", operation: "insert" },
  updateClientCustomField: { table: "client_custom_fields", operation: "update" },
  deleteClientCustomField: { table: "client_custom_fields", operation: "delete" },
  upsertClientCustomFieldValue: { table: "client_custom_field_values", operation: "upsert" },
  upsertClientSequencer: { table: "client_sequencers", operation: "upsert" },
  // Not a table write from here — the gateway calls n8n, which writes (ADR-0018). The meta exists
  // for error reporting, and names the table the run ultimately records into.
  requestWorkspaceSetup: { table: "client_sequencers", operation: "upsert" },
  loadLeadCustomFields: { table: "lead_custom_fields", operation: "select" },
  createLeadCustomField: { table: "lead_custom_fields", operation: "insert" },
  updateLeadCustomField: { table: "lead_custom_fields", operation: "update" },
  deleteLeadCustomField: { table: "lead_custom_fields", operation: "delete" },
  upsertLeadCustomFieldValue: { table: "lead_custom_field_values", operation: "upsert" },
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

// Shared envelope for the admin user-management RPCs (SECURITY DEFINER functions
// called directly, not via the gateway). Throws a RepositoryError on failure.
async function invokeUserRpc(
  fn: "admin_list_users" | "admin_update_user_role" | "admin_set_user_active" | "admin_set_user_avatar",
  params: Record<string, unknown>,
  operation: RepositoryOperation,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw mapRepositoryError(error, "users", operation);
  return data;
}

function toManagedUserRecord(row: Record<string, unknown>): ManagedUserRecord {
  return {
    id: String(row.id),
    created_at: String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
    email: String(row.email),
    first_name: String(row.first_name ?? ""),
    last_name: String(row.last_name ?? ""),
    role: row.role as AppRole,
    avatar_path: row.avatar_path == null ? null : String(row.avatar_path),
    is_active: Boolean(row.is_active),
    deactivated_at: row.deactivated_at == null ? null : String(row.deactivated_at),
    deactivated_by: row.deactivated_by == null ? null : String(row.deactivated_by),
  };
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
  functionName: "send-invite" | "manage-invites" | "orm-gateway" | (string & {}),
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
  const requestId = crypto.randomUUID();
  const body = { action, ...payload, _requestId: requestId } as Record<string, unknown>;
  const meta = ORM_ACTION_META[action];

  // Instrument all per-page gateway loaders ([PERF][gateway]).
  const isGatewayTracked =
    action === "loadShellData" ||
    action === "loadAdminDashboardOverview" ||
    action === "loadManagerDashboardOverview" ||
    action === "loadClientDashboard" ||
    action === "loadClientsOverview" ||
    action === "loadClientsStats" ||
    action === "loadClientsMetricsSummary" ||
    action === "loadLeadsList" ||
    action === "loadLeadCrmList" ||
    action === "loadLeadDetail" ||
    action === "loadLeadTasks" ||
    action === "loadLeadsFilterOptions" ||
    action === "loadAnalyticsOverview" ||
    action === "loadAdminSettings" ||
    action === "loadCampaignsList" ||
    action === "loadCampaignStats";
  const isPerfTracked = isGatewayTracked;
  const tFetchStart = isPerfTracked ? performance.now() : 0;

  const gatewayFunction = runtimeConfig.ormGatewayFunction;
  let response = await performEdgeFunctionRequest(gatewayFunction, firstToken, body);

  if (response.status === 401) {
    const refresh = await client.auth.refreshSession();
    if (!refresh.error && refresh.data.session?.access_token) {
      response = await performEdgeFunctionRequest(gatewayFunction, refresh.data.session.access_token, body);
    }
  }

  const tFetchEnd = isPerfTracked ? performance.now() : 0;
  const text = await response.text();
  const tTextEnd = isPerfTracked ? performance.now() : 0;

  if (isPerfTracked) {
    const label = "[PERF][gateway]";
    const fetchMs = tFetchEnd - tFetchStart;
    // Parse _serverMs from the raw text before full JSON parse to get server-side breakdown.
    let serverMsStr = "";
    let serverTotal = 0;
    try {
      const quick = JSON.parse(text) as Record<string, unknown>;
      if (quick._serverMs) { serverMsStr = ` server=${JSON.stringify(quick._serverMs)}`; serverTotal = (quick._serverMs as Record<string, number>).total ?? 0; }
      if (quick._requestId) serverMsStr += ` requestId=${quick._requestId}`;
    } catch { /* non-fatal */ }
    console.log(
      `${label} ${action}: fetch=${fetchMs.toFixed(1)}ms ` +
        `readBody=${(tTextEnd - tFetchEnd).toFixed(1)}ms ` +
        `responseBytes=${text.length} (${(text.length / 1024).toFixed(1)} KB)${serverMsStr}`,
    );
    // Log a warning when the gap between observed fetch time and server processing is abnormally
    // large — indicates cold-start, connection-pool stall, or edge-function scheduling overhead.
    if (serverTotal > 0 && fetchMs - serverTotal > 1500) {
      console.warn(
        `[GATEWAY_OVERHEAD] ${action}: fetchMs=${fetchMs.toFixed(0)} serverTotalMs=${serverTotal} ` +
          `overhead=${(fetchMs - serverTotal).toFixed(0)}ms — likely cold-start or pooler stall`,
      );
    }
  }

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
    if (import.meta.env.DEV) {
      console.error(
        `[PERF][gateway] ${action}: non-2xx status=${response.status} ` +
          `responseBytes=${text.length} pathname=${window.location.pathname}`,
        text.slice(0, 2000),
      );
    }
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
  loadShellData(): Promise<ShellData>;
  loadAdminDashboardOverview(): Promise<AdminDashboardOverview>;
  loadManagerDashboardOverview(managerId: string, params?: ManagerDashboardParams): Promise<ManagerDashboardOverview>;
  loadClientDashboard(clientId: string): Promise<ClientDashboardPayload>;
  loadClientsOverview(): Promise<ClientsOverviewPayload>;
  loadClientsStats(): Promise<ClientsStatsPayload>;
  loadClientsMetricsSummary(): Promise<ClientsMetricsSummaryPayload>;
  loadLeadsList(params: LeadsListParams): Promise<LeadsListResponse>;
  loadLeadCrmList(params: LeadsListParams): Promise<LeadCrmListResponse>;
  loadLeadDetail(leadId: string): Promise<LeadDetailResult>;
  loadLeadsFilterOptions(): Promise<LeadsFilterOptions>;
  loadAnalyticsOverview(): Promise<AnalyticsOverviewPayload>;
  loadAdminSettings(): Promise<AdminSettingsPayload>;
  loadDomainsPage(): Promise<DomainsPagePayload>;
  loadEmailAccountsPage(): Promise<EmailAccountsPagePayload>;
  loadEmailAccountWarming(emailAccountId: string): Promise<EmailAccountWarmingPayload>;
  loadInvoicesPage(): Promise<InvoicesPagePayload>;
  loadBlacklistPage(): Promise<BlacklistPagePayload>;
  loadCampaignsList(params: CampaignsListParams): Promise<CampaignsListResponse>;
  loadCampaignStats(campaignId?: string): Promise<CampaignStatsResponse>;
  loadConditionRules(): Promise<ConditionRuleRecord[]>;
  // --- OOO routing configuration (ADR-0015) ---
  loadClientOooRouting(clientId: string): Promise<ClientOooRoutingPagePayload>;
  upsertClientOooRouting(
    clientId: string,
    routingKey: RoutingKey,
    campaignId: string,
  ): Promise<ClientOooRoutingPagePayload>;
  deactivateClientOooRouting(routingId: string): Promise<ClientOooRoutingPagePayload>;
  createClient(
    input: Omit<ClientRecord, "id" | "created_at" | "updated_at">,
    sequencerCredentials?: SequencerCredentialInput[],
  ): Promise<ClientRecord>;
  /** sequencer_id may be omitted — the DB default (EmailBison, ADR-0012) applies. */
  createCampaign(
    input: Omit<CampaignRecord, "id" | "created_at" | "updated_at" | "sequencer_id"> & { sequencer_id?: string },
  ): Promise<CampaignRecord>;
  createLead(input: Omit<LeadRecord, "id" | "created_at" | "updated_at">): Promise<LeadRecord>;
  createDomain(input: Omit<DomainRecord, "id" | "created_at" | "updated_at">): Promise<DomainRecord>;
  updateClient(clientId: string, patch: Partial<ClientRecord>): Promise<ClientRecord>;
  updateCampaign(campaignId: string, patch: Partial<CampaignRecord>): Promise<CampaignRecord>;
  updateLead(leadId: string, patch: Partial<LeadRecord>): Promise<LeadRecord>;
  /** Atomic terminal conclusion (ADR-0013): sets final_outcome + conclusion + concluded_at + syncs `won`. */
  concludeLead(leadId: string, finalOutcome: FinalOutcome | null, conclusion: string | null): Promise<LeadRecord>;
  /** Upsert the intro/summary meeting for a lead (ADR-0013). Fires the boolean-recompute trigger. */
  upsertLeadMeeting(leadId: string, meetingType: "intro" | "summary", patch: LeadMeetingInput): Promise<LeadMeetingRecord>;
  /** Upsert the current (latest non-cancelled) offer for a lead (ADR-0013). Fires the offer_sent trigger. */
  upsertLeadOffer(leadId: string, patch: LeadOfferInput): Promise<LeadOfferRecord>;
  /** Upsert value delivery 1 or 2 for a lead (ADR-0013). Keyed on (lead_id, sequence_number). */
  upsertLeadValueDelivery(leadId: string, sequenceNumber: 1 | 2, patch: LeadValueDeliveryInput): Promise<LeadValueDeliveryRecord>;
  /** Lazily load a lead's task list (ADR-0013). Ordered by position then creation. */
  loadLeadTasks(leadId: string): Promise<LeadTaskRecord[]>;
  /** Create (no id) or update (id set) a single lead task (ADR-0013). */
  upsertLeadTask(leadId: string, id: string | undefined, patch: LeadTaskInput): Promise<LeadTaskRecord>;
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
  /** Self-service avatar update (all roles); null clears the photo. */
  updateProfileAvatar(sessionUserId: string, avatarPath: string | null): Promise<UserRecord>;
  // Admin user management (2B/2C). Backed by SECURITY DEFINER RPCs that enforce
  // role/deactivation invariants server-side; the publishable key + RLS apply.
  listManagedUsers(): Promise<ManagedUserRecord[]>;
  updateUserRole(userId: string, role: AppRole): Promise<ManagedUserRecord>;
  setUserActive(userId: string, active: boolean): Promise<ManagedUserRecord>;
  /** Admin-tier only: set/clear another user's avatar path (admin_set_user_avatar RPC). */
  setUserAvatar(userId: string, avatarPath: string | null): Promise<ManagedUserRecord>;
  /** True when the *current* signed-in account is still active (not deactivated). */
  isCurrentAccountActive(): Promise<boolean>;
  upsertColumnOverride(
    columnKey: string,
    patch: { label_override?: string | null; hidden?: boolean; position?: number | null },
  ): Promise<ColumnOverrideRecord>;
  setColumnOrder(orderedKeys: string[]): Promise<ColumnOverrideRecord[]>;
  /** The caller's own saved layout for one table. `preferences` is null when never saved. */
  loadTablePreferences(tableKey: string): Promise<TablePreferencesPayload>;
  saveTablePreferences(
    tableKey: string,
    preferences: Record<string, unknown>,
  ): Promise<TablePreferencesPayload>;
  createClientCustomField(input: {
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  }): Promise<ClientCustomFieldRecord>;
  updateClientCustomField(
    fieldId: string,
    patch: {
      name?: string;
      field_type?: ClientCustomFieldType;
      options?: string[] | null;
      position?: number;
      editable_by?: string[];
    },
  ): Promise<ClientCustomFieldRecord>;
  deleteClientCustomField(fieldId: string): Promise<void>;
  upsertClientCustomFieldValue(
    clientId: string,
    fieldId: string,
    value: string | null,
  ): Promise<ClientCustomFieldValueRecord>;
  /** ADR-0012: upsert one client↔sequencer settings row, keyed by sequencers.key. */
  upsertClientSequencer(
    clientId: string,
    sequencerKey: string,
    patch: Omit<SequencerCredentialInput, "sequencer_key">,
  ): Promise<ClientSequencerRecord>;
  /**
   * ADR-0018: ask n8n to provision one client's workspace. `dryRun: true` reads and reports;
   * `false` creates what is missing in the client's sending system. Not retried — see below.
   */
  requestWorkspaceSetup(input: {
    clientId: string;
    sequencerKey: "emailbison" | "aimfox";
    workspaceId?: string | null;
    dryRun: boolean;
  }): Promise<WorkspaceSetupResult>;
  // Lead custom fields (Batch 4, Task 4F) — per-client report columns.
  loadLeadCustomFields(clientId?: string): Promise<LeadCustomFieldRecord[]>;
  createLeadCustomField(input: {
    client_id: string;
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  }): Promise<LeadCustomFieldRecord>;
  updateLeadCustomField(
    fieldId: string,
    patch: {
      name?: string;
      field_type?: ClientCustomFieldType;
      options?: string[] | null;
      position?: number;
      editable_by?: string[];
    },
  ): Promise<LeadCustomFieldRecord>;
  deleteLeadCustomField(fieldId: string): Promise<void>;
  upsertLeadCustomFieldValue(
    leadId: string,
    fieldId: string,
    value: string | null,
  ): Promise<LeadCustomFieldValueRecord>;
}

export const repository: Repository = {
  async loadShellData() {
    return invokeOrmGatewaySelectWithRetry("loadShellData", {});
  },

  async loadAdminDashboardOverview() {
    return invokeOrmGatewaySelectWithRetry("loadAdminDashboardOverview", {});
  },

  async loadManagerDashboardOverview(managerId, params) {
    return invokeOrmGatewaySelectWithRetry("loadManagerDashboardOverview", {
      managerId,
      clientId: params?.clientId,
      campaignStatus: params?.campaignStatus,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
    });
  },

  async loadClientDashboard(clientId) {
    return invokeOrmGatewaySelectWithRetry("loadClientDashboard", { clientId });
  },

  async loadClientsOverview() {
    const result = await invokeOrmGatewaySelectWithRetry("loadClientsOverview", {});
    if (import.meta.env.DEV) {
      const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };
      const sections: Record<string, { bytes: number; rows: number }> = {
        clients:                 { bytes: sizeOf(result.clients),                 rows: result.clients.length },
        usersLite:               { bytes: sizeOf(result.usersLite),               rows: result.usersLite.length },
        clientUsers:             { bytes: sizeOf(result.clientUsers),             rows: result.clientUsers.length },
        conditionRules:          { bytes: sizeOf(result.conditionRules),          rows: result.conditionRules.length },
        columnOverrides:         { bytes: sizeOf(result.columnOverrides),         rows: result.columnOverrides.length },
        clientCustomFields:      { bytes: sizeOf(result.clientCustomFields),      rows: result.clientCustomFields.length },
        clientCustomFieldValues: { bytes: sizeOf(result.clientCustomFieldValues), rows: result.clientCustomFieldValues.length },
      };
      const total = Object.values(sections).reduce((sum, s) => sum + s.bytes, 0);
      const sorted = Object.entries(sections).sort((a, b) => b[1].bytes - a[1].bytes);
      console.group("[PERF][gateway] loadClientsOverview shell payload breakdown");
      for (const [name, { bytes, rows }] of sorted) {
        const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : "0.0";
        console.log(`  ${name.padEnd(24)} ${(bytes / 1024).toFixed(1).padStart(8)} KB  (${pct.padStart(5)}%)  rows=${rows}`);
      }
      console.log(`  ${"TOTAL".padEnd(24)} ${(total / 1024).toFixed(1).padStart(8)} KB`);
      console.groupEnd();
    }
    return result;
  },

  async loadClientsStats() {
    const result = await invokeOrmGatewaySelectWithRetry("loadClientsStats", {});
    if (import.meta.env.DEV) {
      const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };
      const lpBytes = sizeOf(result.leadProjections);
      const dsBytes = sizeOf(result.dailyStats);
      const total = lpBytes + dsBytes;
      console.group("[PERF][gateway] loadClientsStats payload breakdown");
      console.log(`  ${"leadProjections".padEnd(24)} ${(lpBytes / 1024).toFixed(1).padStart(8)} KB  rows=${result.leadProjections.length}`);
      console.log(`  ${"dailyStats".padEnd(24)} ${(dsBytes / 1024).toFixed(1).padStart(8)} KB  rows=${result.dailyStats.length}`);
      console.log(`  ${"TOTAL".padEnd(24)} ${(total / 1024).toFixed(1).padStart(8)} KB`);
      console.groupEnd();
    }
    return result;
  },

  async loadClientsMetricsSummary() {
    const result = await invokeOrmGatewaySelectWithRetry("loadClientsMetricsSummary", {});
    if (import.meta.env.DEV) {
      const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };
      const totalBytes = sizeOf(result.summaries);
      console.group("[PERF][gateway] loadClientsMetricsSummary payload breakdown");
      console.log(`  ${"summaries".padEnd(24)} ${(totalBytes / 1024).toFixed(1).padStart(8)} KB  clients=${result.summaries.length}`);
      console.log(`  ${"_meta".padEnd(24)} ${JSON.stringify(result._meta)}`);
      console.groupEnd();
    }
    return result;
  },

  async loadLeadCrmList(params) {
    return invokeOrmGatewaySelectWithRetry("loadLeadCrmList", { params });
  },
  async loadLeadsList(params) {
    return invokeOrmGatewaySelectWithRetry("loadLeadsList", { params });
  },

  async loadLeadDetail(leadId) {
    return invokeOrmGatewaySelectWithRetry("loadLeadDetail", { leadId });
  },

  async loadLeadsFilterOptions() {
    return invokeOrmGatewaySelectWithRetry("loadLeadsFilterOptions", {});
  },

  async loadAdminSettings() {
    return invokeOrmGatewaySelectWithRetry("loadAdminSettings", {});
  },

  async loadDomainsPage() {
    return invokeOrmGatewaySelectWithRetry("loadDomainsPage", {});
  },

  async loadEmailAccountsPage() {
    return invokeOrmGatewaySelectWithRetry("loadEmailAccountsPage", {});
  },

  async loadEmailAccountWarming(emailAccountId: string) {
    return invokeOrmGatewayAction("loadEmailAccountWarming", { emailAccountId });
  },

  async loadInvoicesPage() {
    return invokeOrmGatewaySelectWithRetry("loadInvoicesPage", {});
  },

  async loadBlacklistPage() {
    return invokeOrmGatewaySelectWithRetry("loadBlacklistPage", {});
  },

  async loadAnalyticsOverview() {
    const result = await invokeOrmGatewaySelectWithRetry("loadAnalyticsOverview", {});
    if (import.meta.env.DEV) {
      const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };
      const sections: Record<string, { bytes: number; rows: number }> = {
        users:      { bytes: sizeOf(result.users),      rows: result.users.length },
        clients:    { bytes: sizeOf(result.clients),    rows: result.clients.length },
        campaigns:  { bytes: sizeOf(result.campaigns),  rows: result.campaigns.length },
        leadGroups: { bytes: sizeOf(result.leadGroups), rows: result.leadGroups.length },
        dailyStats: { bytes: sizeOf(result.dailyStats), rows: result.dailyStats.length },
      };
      const total = Object.values(sections).reduce((s, v) => s + v.bytes, 0);
      console.group("[PERF][gateway] loadAnalyticsOverview breakdown");
      for (const [name, { bytes, rows }] of Object.entries(sections)) {
        console.log(`  ${name.padEnd(20)} ${(bytes / 1024).toFixed(1).padStart(8)} KB  (${rows} rows, ${((bytes / total) * 100).toFixed(1)}%)`);
      }
      console.log(`  ${"TOTAL".padEnd(20)} ${(total / 1024).toFixed(1).padStart(8)} KB`);
      console.groupEnd();
    }
    return result;
  },

  async loadCampaignsList(params) {
    return invokeOrmGatewaySelectWithRetry("loadCampaignsList", { params });
  },

  async loadCampaignStats(campaignId) {
    return invokeOrmGatewaySelectWithRetry("loadCampaignStats", { campaignId });
  },

  async loadConditionRules() {
    return invokeOrmGatewaySelectWithRetry("loadConditionRules", {});
  },

  async createClient(input, sequencerCredentials) {
    return invokeOrmGatewayAction("createClient", { input, sequencerCredentials });
  },

  async createCampaign(input) {
    return invokeOrmGatewayAction("createCampaign", { input });
  },

  async createLead(input) {
    return invokeOrmGatewayAction("createLead", { input });
  },

  async createDomain(input) {
    return invokeOrmGatewayAction("createDomain", { input });
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

  async concludeLead(leadId, finalOutcome, conclusion) {
    return invokeOrmGatewayAction("concludeLead", { leadId, finalOutcome, conclusion });
  },

  async upsertLeadMeeting(leadId, meetingType, patch) {
    return invokeOrmGatewayAction("upsertLeadMeeting", { leadId, meetingType, patch });
  },

  async upsertLeadOffer(leadId, patch) {
    return invokeOrmGatewayAction("upsertLeadOffer", { leadId, patch });
  },

  async upsertLeadValueDelivery(leadId, sequenceNumber, patch) {
    return invokeOrmGatewayAction("upsertLeadValueDelivery", { leadId, sequenceNumber, patch });
  },

  async loadLeadTasks(leadId) {
    return invokeOrmGatewaySelectWithRetry("loadLeadTasks", { leadId });
  },

  async upsertLeadTask(leadId, id, patch) {
    return invokeOrmGatewayAction("upsertLeadTask", { leadId, id, patch });
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

  async loadClientOooRouting(clientId) {
    return invokeOrmGatewaySelectWithRetry("loadClientOooRouting", { clientId });
  },

  async upsertClientOooRouting(clientId, routingKey, campaignId) {
    return invokeOrmGatewayAction("upsertClientOooRouting", { clientId, routingKey, campaignId });
  },

  async deactivateClientOooRouting(routingId) {
    return invokeOrmGatewayAction("deactivateClientOooRouting", { routingId });
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

  async updateProfileAvatar(sessionUserId, avatarPath) {
    const { user } = await invokeOrmGatewayAction("updateProfileAvatar", { sessionUserId, avatarPath });
    return user;
  },

  async listManagedUsers() {
    const data = await invokeUserRpc("admin_list_users", {}, "select");
    return (Array.isArray(data) ? data : []).map((row) => toManagedUserRecord(row as Record<string, unknown>));
  },

  async updateUserRole(userId, role) {
    const data = await invokeUserRpc("admin_update_user_role", { target_user_id: userId, new_role: role }, "update");
    return toManagedUserRecord(data as Record<string, unknown>);
  },

  async setUserActive(userId, active) {
    const data = await invokeUserRpc("admin_set_user_active", { target_user_id: userId, active }, "update");
    return toManagedUserRecord(data as Record<string, unknown>);
  },

  async setUserAvatar(userId, avatarPath) {
    const data = await invokeUserRpc(
      "admin_set_user_avatar",
      { target_user_id: userId, new_avatar_path: avatarPath },
      "update",
    );
    return toManagedUserRecord(data as Record<string, unknown>);
  },

  async isCurrentAccountActive() {
    const { data, error } = await supabase.rpc("current_account_active");
    // Fail open on transient/RPC errors — never lock a user out on a network blip.
    if (error) return true;
    return data !== false;
  },

  async upsertColumnOverride(columnKey, patch) {
    return invokeOrmGatewayAction("upsertColumnOverride", { columnKey, patch });
  },

  async loadTablePreferences(tableKey) {
    return invokeOrmGatewaySelectWithRetry("loadTablePreferences", { tableKey });
  },

  async saveTablePreferences(tableKey, preferences) {
    return invokeOrmGatewayAction("saveTablePreferences", { tableKey, preferences });
  },

  async setColumnOrder(orderedKeys) {
    return invokeOrmGatewayAction("setColumnOrder", { orderedKeys });
  },

  async createClientCustomField(input) {
    return invokeOrmGatewayAction("createClientCustomField", { input });
  },

  async updateClientCustomField(fieldId, patch) {
    return invokeOrmGatewayAction("updateClientCustomField", { fieldId, patch });
  },

  async deleteClientCustomField(fieldId) {
    await invokeOrmGatewayAction("deleteClientCustomField", { fieldId });
  },

  async upsertClientCustomFieldValue(clientId, fieldId, value) {
    return invokeOrmGatewayAction("upsertClientCustomFieldValue", { clientId, fieldId, value });
  },

  async upsertClientSequencer(clientId, sequencerKey, patch) {
    return invokeOrmGatewayAction("upsertClientSequencer", { clientId, sequencerKey, patch });
  },

  // Deliberately on the mutation path, which does NOT retry. A retried provisioning call is a
  // second run against a client's sending system; the workflow is idempotent, but a transport-level
  // retry after a timeout would also start a second concurrent run. "Check again" is the user's
  // recovery, not ours.
  async requestWorkspaceSetup({ clientId, sequencerKey, workspaceId = null, dryRun }) {
    return invokeOrmGatewayAction("requestWorkspaceSetup", { clientId, sequencerKey, workspaceId, dryRun });
  },

  async loadLeadCustomFields(clientId) {
    return invokeOrmGatewaySelectWithRetry("loadLeadCustomFields", { clientId });
  },

  async createLeadCustomField(input) {
    return invokeOrmGatewayAction("createLeadCustomField", { input });
  },

  async updateLeadCustomField(fieldId, patch) {
    return invokeOrmGatewayAction("updateLeadCustomField", { fieldId, patch });
  },

  async deleteLeadCustomField(fieldId) {
    await invokeOrmGatewayAction("deleteLeadCustomField", { fieldId });
  },

  async upsertLeadCustomFieldValue(leadId, fieldId, value) {
    return invokeOrmGatewayAction("upsertLeadCustomFieldValue", { leadId, fieldId, value });
  },
};
