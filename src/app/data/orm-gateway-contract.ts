import type {
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
  Identity,
  InvoiceRecord,
  LeadCustomFieldRecord,
  LeadCustomFieldValueRecord,
  LeadRecord,
  UserRecord,
} from "../types/core.ts";
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
  InvoicesPagePayload,
  LeadDetailResult,
  LeadsFilterOptions,
  LeadsListParams,
  LeadsListResponse,
  LeadCrmListResponse,
  ManagerDashboardOverview,
  ShellData,
  TablePreferencesPayload,
} from "../types/view-contracts.ts";

export type OrmGatewayAuthErrorCode =
  | "runtime_config"
  | "session_invalid"
  | "profile_missing"
  | "client_mapping_missing"
  | "permission"
  | "network"
  | "unknown";

export interface OrmGatewayError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface OrmGatewaySuccess<T> {
  ok: true;
  data: T;
}

export interface OrmGatewayFailure {
  ok: false;
  error: OrmGatewayError;
}

export type OrmGatewayEnvelope<T> = OrmGatewaySuccess<T> | OrmGatewayFailure;

export interface LoadConditionRulesPayload {
  action: "loadConditionRules";
}

export interface LoadShellDataPayload {
  action: "loadShellData";
}

export interface LoadAdminDashboardPayload {
  action: "loadAdminDashboardOverview";
}

export interface LoadManagerDashboardPayload {
  action: "loadManagerDashboardOverview";
  /** Effective manager ID (post-impersonation from identity.id). */
  managerId: string;
  /** Optional: scope the whole dashboard to a single client. */
  clientId?: string;
  /** Optional: campaign status filter for watchlist/momentum/metrics. Defaults to "active"; "all" disables. */
  campaignStatus?: string;
  /** Optional ISO date (YYYY-MM-DD) inclusive lower bound for leads (created_at) and stats (report_date). */
  dateFrom?: string;
  /** Optional ISO date (YYYY-MM-DD) inclusive upper bound. */
  dateTo?: string;
}

export interface LoadClientDashboardPayload {
  action: "loadClientDashboard";
  /** Effective client ID (post-impersonation from identity.clientId). */
  clientId: string;
}

export interface LoadClientsOverviewPayload {
  action: "loadClientsOverview";
}

/** Separate heavy-stats request — deferred until after shell renders. */
export interface LoadClientsStatsPayload {
  action: "loadClientsStats";
}

/**
 * Compact metrics-summary request — deferred until after shell renders.
 * Returns pre-bucketed aggregate facts per client; replaces raw loadClientsStats
 * for table-metrics purposes. Payload target: ~30–70 KB vs ~1.4 MB for raw stats.
 */
export interface LoadClientsMetricsSummaryPayload {
  action: "loadClientsMetricsSummary";
}

export interface LoadLeadsListPayload {
  action: "loadLeadsList";
  params: LeadsListParams;
}

/** CRM view read-model — same params/filters as loadLeadsList, plus joined child data + asOf. */
export interface LoadLeadCrmListPayload {
  action: "loadLeadCrmList";
  params: LeadsListParams;
}

export interface LoadLeadDetailPayload {
  action: "loadLeadDetail";
  leadId: string;
}

export interface LoadLeadsFilterOptionsPayload {
  action: "loadLeadsFilterOptions";
}

export interface LoadAnalyticsOverviewPayload {
  action: "loadAnalyticsOverview";
}

export interface LoadAdminSettingsPayload {
  action: "loadAdminSettings";
}

export interface LoadDomainsPagePayload {
  action: "loadDomainsPage";
}

export interface LoadInvoicesPagePayload {
  action: "loadInvoicesPage";
}

export interface LoadBlacklistPagePayload {
  action: "loadBlacklistPage";
}

export interface LoadCampaignsListPayload {
  action: "loadCampaignsList";
  params: CampaignsListParams;
}

export interface LoadCampaignStatsPayload {
  action: "loadCampaignStats";
  /** If provided: 90-day series for this campaign. If absent: all accessible campaigns (client page). */
  campaignId?: string;
}

export interface UpdateClientPayload {
  action: "updateClient";
  clientId: string;
  patch: Partial<ClientRecord>;
}

export interface UpdateCampaignPayload {
  action: "updateCampaign";
  campaignId: string;
  patch: Partial<CampaignRecord>;
}

export interface UpdateLeadPayload {
  action: "updateLead";
  leadId: string;
  patch: Partial<LeadRecord>;
}

export interface UpdateDomainPayload {
  action: "updateDomain";
  domainId: string;
  patch: Partial<DomainRecord>;
}

export interface UpdateInvoicePayload {
  action: "updateInvoice";
  invoiceId: string;
  patch: Partial<InvoiceRecord>;
}

/**
 * Per-sequencer credential patch (ADR-0012). Only present fields overwrite;
 * `sequencer_key` is the sequencers catalog key ('smartlead' | 'emailbison' | 'aimfox' | …).
 */
export interface SequencerCredentialInput {
  sequencer_key: string;
  api_key?: string | null;
  external_workspace_id?: string | null;
  settings?: Record<string, unknown>;
  enabled?: boolean;
}

export interface CreateClientPayload {
  action: "createClient";
  input: Omit<ClientRecord, "id" | "created_at" | "updated_at">;
  /** Optional client_sequencers rows created alongside the client (ADR-0012). */
  sequencerCredentials?: SequencerCredentialInput[];
}

export interface CreateCampaignPayload {
  action: "createCampaign";
  /** sequencer_id may be omitted — the DB default (EmailBison, ADR-0012) applies. */
  input: Omit<CampaignRecord, "id" | "created_at" | "updated_at" | "sequencer_id"> & { sequencer_id?: string };
}

export interface CreateLeadPayload {
  action: "createLead";
  input: Omit<LeadRecord, "id" | "created_at" | "updated_at">;
}

export interface CreateDomainPayload {
  action: "createDomain";
  input: Omit<DomainRecord, "id" | "created_at" | "updated_at">;
}

export interface CreateConditionRulePayload {
  action: "createConditionRule";
  input: Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at" | "created_by"> & { created_by?: string | null };
}

export interface UpdateConditionRulePayload {
  action: "updateConditionRule";
  ruleId: string;
  patch: Partial<Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at">>;
}

export interface DeleteConditionRulePayload {
  action: "deleteConditionRule";
  ruleId: string;
}

export interface UpsertClientUserMappingPayload {
  action: "upsertClientUserMapping";
  userId: string;
  clientId: string;
}

export interface DeleteClientUserMappingPayload {
  action: "deleteClientUserMapping";
  mappingId: string;
}

export interface UpsertEmailExcludeDomainPayload {
  action: "upsertEmailExcludeDomain";
  domain: string;
}

export interface DeleteEmailExcludeDomainPayload {
  action: "deleteEmailExcludeDomain";
  domain: string;
}

export interface LoadIdentityPayload {
  action: "loadIdentity";
  sessionUserId: string;
}

export interface UpdateProfileNamePayload {
  action: "updateProfileName";
  sessionUserId: string;
  fullName: string;
}

export interface UpdateProfileAvatarPayload {
  action: "updateProfileAvatar";
  sessionUserId: string;
  /** Storage object path (avatars/{user_id}/{uuid}.{ext}); null clears the avatar. */
  avatarPath: string | null;
}

export interface UpsertColumnOverridePayload {
  action: "upsertColumnOverride";
  columnKey: string;
  patch: { label_override?: string | null; hidden?: boolean; position?: number | null };
}

export interface SetColumnOrderPayload {
  action: "setColumnOrder";
  /** Ordered list of column ids. Index in this list becomes the row's `position`. */
  orderedKeys: string[];
}

/**
 * Per-user table preferences (column widths, filters, sort). Personal — unlike
 * `column_overrides`, which is the global master-admin layout. The row is always the
 * caller's own: the gateway derives `user_id` from the JWT and RLS enforces it, so no
 * user id crosses the wire.
 */
export interface LoadTablePreferencesPayload {
  action: "loadTablePreferences";
  /** Which table, e.g. "clients:mega". */
  tableKey: string;
}

export interface SaveTablePreferencesPayload {
  action: "saveTablePreferences";
  tableKey: string;
  /** Shape is owned by the UI; the gateway stores it as opaque jsonb. */
  preferences: Record<string, unknown>;
}

export interface CreateClientCustomFieldPayload {
  action: "createClientCustomField";
  input: {
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  };
}

export interface UpdateClientCustomFieldPayload {
  action: "updateClientCustomField";
  fieldId: string;
  patch: {
    name?: string;
    field_type?: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  };
}

export interface DeleteClientCustomFieldPayload {
  action: "deleteClientCustomField";
  fieldId: string;
}

export interface UpsertClientCustomFieldValuePayload {
  action: "upsertClientCustomFieldValue";
  clientId: string;
  fieldId: string;
  value: string | null;
}

export interface UpsertClientSequencerPayload {
  action: "upsertClientSequencer";
  clientId: string;
  /** Sequencers catalog key; resolved to sequencer_id server-side. */
  sequencerKey: string;
  patch: Omit<SequencerCredentialInput, "sequencer_key">;
}

export interface LoadLeadCustomFieldsPayload {
  action: "loadLeadCustomFields";
  /** Restrict to a single client; omit to load all accessible clients' definitions. */
  clientId?: string;
}

export interface CreateLeadCustomFieldPayload {
  action: "createLeadCustomField";
  input: {
    client_id: string;
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  };
}

export interface UpdateLeadCustomFieldPayload {
  action: "updateLeadCustomField";
  fieldId: string;
  patch: {
    name?: string;
    field_type?: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  };
}

export interface DeleteLeadCustomFieldPayload {
  action: "deleteLeadCustomField";
  fieldId: string;
}

export interface UpsertLeadCustomFieldValuePayload {
  action: "upsertLeadCustomFieldValue";
  leadId: string;
  fieldId: string;
  value: string | null;
}

export type OrmGatewayRequest =
  | LoadConditionRulesPayload
  | LoadShellDataPayload
  | LoadAdminDashboardPayload
  | LoadManagerDashboardPayload
  | LoadClientDashboardPayload
  | LoadClientsOverviewPayload
  | LoadClientsStatsPayload
  | LoadClientsMetricsSummaryPayload
  | LoadLeadsListPayload
  | LoadLeadCrmListPayload
  | LoadLeadDetailPayload
  | LoadLeadsFilterOptionsPayload
  | LoadAnalyticsOverviewPayload
  | LoadAdminSettingsPayload
  | LoadDomainsPagePayload
  | LoadInvoicesPagePayload
  | LoadBlacklistPagePayload
  | LoadCampaignsListPayload
  | LoadCampaignStatsPayload
  | UpdateClientPayload
  | UpdateCampaignPayload
  | UpdateLeadPayload
  | UpdateDomainPayload
  | UpdateInvoicePayload
  | CreateClientPayload
  | CreateCampaignPayload
  | CreateLeadPayload
  | CreateDomainPayload
  | CreateConditionRulePayload
  | UpdateConditionRulePayload
  | DeleteConditionRulePayload
  | UpsertClientUserMappingPayload
  | DeleteClientUserMappingPayload
  | UpsertEmailExcludeDomainPayload
  | DeleteEmailExcludeDomainPayload
  | LoadIdentityPayload
  | UpdateProfileNamePayload
  | UpdateProfileAvatarPayload
  | UpsertColumnOverridePayload
  | SetColumnOrderPayload
  | LoadTablePreferencesPayload
  | SaveTablePreferencesPayload
  | CreateClientCustomFieldPayload
  | UpdateClientCustomFieldPayload
  | DeleteClientCustomFieldPayload
  | UpsertClientCustomFieldValuePayload
  | UpsertClientSequencerPayload
  | LoadLeadCustomFieldsPayload
  | CreateLeadCustomFieldPayload
  | UpdateLeadCustomFieldPayload
  | DeleteLeadCustomFieldPayload
  | UpsertLeadCustomFieldValuePayload;

export type OrmGatewayAction = OrmGatewayRequest["action"];

export interface LoadIdentityResult {
  identity: Identity | null;
  error: string | null;
  errorCode: OrmGatewayAuthErrorCode | null;
}

export interface UpdateProfileNameResult {
  user: UserRecord;
}

export interface OrmGatewayResponseMap {
  loadShellData: ShellData;
  loadAdminDashboardOverview: AdminDashboardOverview;
  loadManagerDashboardOverview: ManagerDashboardOverview;
  loadClientDashboard: ClientDashboardPayload;
  loadClientsOverview: ClientsOverviewPayload;
  loadClientsStats: ClientsStatsPayload;
  loadClientsMetricsSummary: ClientsMetricsSummaryPayload;
  loadLeadsList: LeadsListResponse;
  loadLeadCrmList: LeadCrmListResponse;
  loadLeadDetail: LeadDetailResult;
  loadLeadsFilterOptions: LeadsFilterOptions;
  loadAnalyticsOverview: AnalyticsOverviewPayload;
  loadAdminSettings: AdminSettingsPayload;
  loadDomainsPage: DomainsPagePayload;
  loadInvoicesPage: InvoicesPagePayload;
  loadBlacklistPage: BlacklistPagePayload;
  loadCampaignsList: CampaignsListResponse;
  loadCampaignStats: CampaignStatsResponse;
  loadConditionRules: ConditionRuleRecord[];
  updateClient: ClientRecord;
  updateCampaign: CampaignRecord;
  updateLead: LeadRecord;
  updateDomain: DomainRecord;
  updateInvoice: InvoiceRecord;
  createClient: ClientRecord;
  createCampaign: CampaignRecord;
  createLead: LeadRecord;
  createDomain: DomainRecord;
  createConditionRule: ConditionRuleRecord;
  updateConditionRule: ConditionRuleRecord;
  deleteConditionRule: { ok: true };
  upsertClientUserMapping: ClientUserRecord;
  deleteClientUserMapping: { ok: true };
  upsertEmailExcludeDomain: EmailExcludeRecord;
  deleteEmailExcludeDomain: { ok: true };
  loadIdentity: LoadIdentityResult;
  updateProfileName: UpdateProfileNameResult;
  updateProfileAvatar: UpdateProfileNameResult;
  upsertColumnOverride: ColumnOverrideRecord;
  setColumnOrder: ColumnOverrideRecord[];
  loadTablePreferences: TablePreferencesPayload;
  saveTablePreferences: TablePreferencesPayload;
  createClientCustomField: ClientCustomFieldRecord;
  updateClientCustomField: ClientCustomFieldRecord;
  deleteClientCustomField: { ok: true };
  upsertClientCustomFieldValue: ClientCustomFieldValueRecord;
  upsertClientSequencer: ClientSequencerRecord;
  loadLeadCustomFields: LeadCustomFieldRecord[];
  createLeadCustomField: LeadCustomFieldRecord;
  updateLeadCustomField: LeadCustomFieldRecord;
  deleteLeadCustomField: { ok: true };
  upsertLeadCustomFieldValue: LeadCustomFieldValueRecord;
}

interface ParseSuccess {
  ok: true;
  value: OrmGatewayRequest;
}

interface ParseFailure {
  ok: false;
  error: string;
}

export type OrmGatewayParseResult = ParseSuccess | ParseFailure;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function hasStringField(obj: Record<string, unknown>, key: string) {
  return isString(obj[key]) && obj[key].trim().length > 0;
}

function hasObjectField(obj: Record<string, unknown>, key: string) {
  return isObject(obj[key]);
}

export function parseOrmGatewayRequest(payload: unknown): OrmGatewayParseResult {
  if (!isObject(payload)) {
    return { ok: false, error: "Request body must be an object." };
  }

  const action = payload.action;
  if (!isString(action) || action.trim().length === 0) {
    return { ok: false, error: "Request action is required." };
  }

  if (action === "loadConditionRules") {
    return { ok: true, value: { action } };
  }

  if (action === "loadShellData") {
    return { ok: true, value: { action } };
  }

  if (action === "loadAdminDashboardOverview") {
    return { ok: true, value: { action } };
  }

  if (action === "loadManagerDashboardOverview") {
    if (!hasStringField(payload, "managerId")) {
      return { ok: false, error: "loadManagerDashboardOverview requires managerId." };
    }
    return {
      ok: true,
      value: {
        action,
        managerId: String(payload.managerId),
        clientId: isString(payload.clientId) ? payload.clientId : undefined,
        campaignStatus: isString(payload.campaignStatus) ? payload.campaignStatus : undefined,
        dateFrom: isString(payload.dateFrom) ? payload.dateFrom : undefined,
        dateTo: isString(payload.dateTo) ? payload.dateTo : undefined,
      },
    };
  }

  if (action === "loadClientDashboard") {
    if (!hasStringField(payload, "clientId")) {
      return { ok: false, error: "loadClientDashboard requires clientId." };
    }
    return { ok: true, value: { action, clientId: String(payload.clientId) } };
  }

  if (action === "loadClientsOverview") {
    return { ok: true, value: { action } };
  }

  if (action === "loadClientsStats") {
    return { ok: true, value: { action } };
  }

  if (action === "loadClientsMetricsSummary") {
    return { ok: true, value: { action } };
  }

  if (action === "loadLeadsList") {
    if (!isObject(payload.params)) {
      return { ok: false, error: "loadLeadsList requires a params object." };
    }
    const p = payload.params as Record<string, unknown>;
    if (!isString(p.sortField) || !isString(p.sortDir)) {
      return { ok: false, error: "loadLeadsList.params requires sortField and sortDir strings." };
    }
    const page = typeof p.page === "number" ? p.page : 1;
    const pageSize = typeof p.pageSize === "number" ? Math.min(Math.max(1, p.pageSize), 100) : 50;
    return {
      ok: true,
      value: {
        action,
        params: {
          clientId: isString(p.clientId) ? p.clientId : undefined,
          campaignId: isString(p.campaignId) ? p.campaignId : undefined,
          stage: isString(p.stage) ? p.stage : undefined,
          replyScope: (p.replyScope === "active" || p.replyScope === "ooo") ? p.replyScope : "all",
          dateFrom: isString(p.dateFrom) ? p.dateFrom : undefined,
          dateTo: isString(p.dateTo) ? p.dateTo : undefined,
          search: isString(p.search) && p.search.trim().length > 0 ? p.search.trim() : undefined,
          sortField: String(p.sortField),
          sortDir: p.sortDir === "asc" ? "asc" : "desc",
          page: Math.max(1, Math.trunc(page)),
          pageSize,
        } as LeadsListParams,
      },
    };
  }

  if (action === "loadLeadCrmList") {
    if (!isObject(payload.params)) {
      return { ok: false, error: "loadLeadCrmList requires a params object." };
    }
    const p = payload.params as Record<string, unknown>;
    if (!isString(p.sortField) || !isString(p.sortDir)) {
      return { ok: false, error: "loadLeadCrmList.params requires sortField and sortDir strings." };
    }
    const page = typeof p.page === "number" ? p.page : 1;
    const pageSize = typeof p.pageSize === "number" ? Math.min(Math.max(1, p.pageSize), 100) : 50;
    return {
      ok: true,
      value: {
        action,
        params: {
          clientId: isString(p.clientId) ? p.clientId : undefined,
          campaignId: isString(p.campaignId) ? p.campaignId : undefined,
          stage: isString(p.stage) ? p.stage : undefined,
          replyScope: (p.replyScope === "active" || p.replyScope === "ooo") ? p.replyScope : "all",
          dateFrom: isString(p.dateFrom) ? p.dateFrom : undefined,
          dateTo: isString(p.dateTo) ? p.dateTo : undefined,
          search: isString(p.search) && p.search.trim().length > 0 ? p.search.trim() : undefined,
          sortField: String(p.sortField),
          sortDir: p.sortDir === "asc" ? "asc" : "desc",
          page: Math.max(1, Math.trunc(page)),
          pageSize,
        } as LeadsListParams,
      },
    };
  }

  if (action === "loadLeadDetail") {
    if (!hasStringField(payload, "leadId")) {
      return { ok: false, error: "loadLeadDetail requires leadId." };
    }
    return { ok: true, value: { action, leadId: String(payload.leadId) } };
  }

  if (action === "loadLeadsFilterOptions") {
    return { ok: true, value: { action } };
  }

  if (action === "loadAnalyticsOverview") {
    return { ok: true, value: { action } };
  }

  if (action === "loadAdminSettings") {
    return { ok: true, value: { action } };
  }

  if (action === "loadDomainsPage") {
    return { ok: true, value: { action } };
  }

  if (action === "loadInvoicesPage") {
    return { ok: true, value: { action } };
  }

  if (action === "loadBlacklistPage") {
    return { ok: true, value: { action } };
  }

  if (action === "loadCampaignsList") {
    if (!isObject(payload.params)) {
      return { ok: false, error: "loadCampaignsList requires a params object." };
    }
    const p = payload.params as Record<string, unknown>;
    if (!isString(p.sortField) || !isString(p.sortDir)) {
      return { ok: false, error: "loadCampaignsList.params requires sortField and sortDir strings." };
    }
    const page = typeof p.page === "number" ? p.page : 1;
    const pageSize = typeof p.pageSize === "number" ? Math.min(Math.max(1, p.pageSize), 500) : 200;
    return {
      ok: true,
      value: {
        action,
        params: {
          clientId: isString(p.clientId) ? p.clientId : undefined,
          status: isString(p.status) && p.status.trim().length > 0 ? p.status.trim() : undefined,
          search: isString(p.search) && p.search.trim().length > 0 ? p.search.trim() : undefined,
          sortField: String(p.sortField) as CampaignsListParams["sortField"],
          sortDir: p.sortDir === "asc" ? "asc" : "desc",
          page: Math.max(1, Math.trunc(page)),
          pageSize,
        } as CampaignsListParams,
      },
    };
  }

  if (action === "loadCampaignStats") {
    const campaignId = isString(payload.campaignId) && payload.campaignId.trim().length > 0
      ? payload.campaignId.trim()
      : undefined;
    return { ok: true, value: { action, campaignId } };
  }

  if (action === "updateClient") {
    if (!hasStringField(payload, "clientId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateClient requires clientId and patch object." };
    }
    return { ok: true, value: { action, clientId: String(payload.clientId), patch: payload.patch as Partial<ClientRecord> } };
  }

  if (action === "updateCampaign") {
    if (!hasStringField(payload, "campaignId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateCampaign requires campaignId and patch object." };
    }
    return { ok: true, value: { action, campaignId: String(payload.campaignId), patch: payload.patch as Partial<CampaignRecord> } };
  }

  if (action === "updateLead") {
    if (!hasStringField(payload, "leadId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateLead requires leadId and patch object." };
    }
    return { ok: true, value: { action, leadId: String(payload.leadId), patch: payload.patch as Partial<LeadRecord> } };
  }

  if (action === "updateDomain") {
    if (!hasStringField(payload, "domainId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateDomain requires domainId and patch object." };
    }
    return { ok: true, value: { action, domainId: String(payload.domainId), patch: payload.patch as Partial<DomainRecord> } };
  }

  if (action === "updateInvoice") {
    if (!hasStringField(payload, "invoiceId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateInvoice requires invoiceId and patch object." };
    }
    return { ok: true, value: { action, invoiceId: String(payload.invoiceId), patch: payload.patch as Partial<InvoiceRecord> } };
  }

  if (action === "createClient") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createClient requires input object." };
    }
    if (payload.sequencerCredentials !== undefined && !Array.isArray(payload.sequencerCredentials)) {
      return { ok: false, error: "createClient.sequencerCredentials must be an array when provided." };
    }
    const credentialObjects = (payload.sequencerCredentials as unknown[] | undefined)?.filter(isObject);
    if (credentialObjects?.some((cred) => !hasStringField(cred, "sequencer_key"))) {
      return { ok: false, error: "createClient.sequencerCredentials entries require sequencer_key." };
    }
    return {
      ok: true,
      value: {
        action,
        input: payload.input as CreateClientPayload["input"],
        sequencerCredentials: credentialObjects as SequencerCredentialInput[] | undefined,
      },
    };
  }

  if (action === "createCampaign") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createCampaign requires input object." };
    }
    return { ok: true, value: { action, input: payload.input as CreateCampaignPayload["input"] } };
  }

  if (action === "createLead") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createLead requires input object." };
    }
    return { ok: true, value: { action, input: payload.input as CreateLeadPayload["input"] } };
  }

  if (action === "createDomain") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createDomain requires input object." };
    }
    return { ok: true, value: { action, input: payload.input as CreateDomainPayload["input"] } };
  }

  if (action === "createConditionRule") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createConditionRule requires input object." };
    }
    return { ok: true, value: { action, input: payload.input as CreateConditionRulePayload["input"] } };
  }

  if (action === "updateConditionRule") {
    if (!hasStringField(payload, "ruleId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateConditionRule requires ruleId and patch object." };
    }
    return { ok: true, value: { action, ruleId: String(payload.ruleId), patch: payload.patch as UpdateConditionRulePayload["patch"] } };
  }

  if (action === "deleteConditionRule") {
    if (!hasStringField(payload, "ruleId")) {
      return { ok: false, error: "deleteConditionRule requires ruleId." };
    }
    return { ok: true, value: { action, ruleId: String(payload.ruleId) } };
  }

  if (action === "upsertClientUserMapping") {
    if (!hasStringField(payload, "userId") || !hasStringField(payload, "clientId")) {
      return { ok: false, error: "upsertClientUserMapping requires userId and clientId." };
    }
    return { ok: true, value: { action, userId: String(payload.userId), clientId: String(payload.clientId) } };
  }

  if (action === "deleteClientUserMapping") {
    if (!hasStringField(payload, "mappingId")) {
      return { ok: false, error: "deleteClientUserMapping requires mappingId." };
    }
    return { ok: true, value: { action, mappingId: String(payload.mappingId) } };
  }

  if (action === "upsertEmailExcludeDomain") {
    if (!hasStringField(payload, "domain")) {
      return { ok: false, error: "upsertEmailExcludeDomain requires domain." };
    }
    return { ok: true, value: { action, domain: String(payload.domain) } };
  }

  if (action === "deleteEmailExcludeDomain") {
    if (!hasStringField(payload, "domain")) {
      return { ok: false, error: "deleteEmailExcludeDomain requires domain." };
    }
    return { ok: true, value: { action, domain: String(payload.domain) } };
  }

  if (action === "loadIdentity") {
    if (!hasStringField(payload, "sessionUserId")) {
      return { ok: false, error: "loadIdentity requires sessionUserId." };
    }
    return { ok: true, value: { action, sessionUserId: String(payload.sessionUserId) } };
  }

  if (action === "updateProfileName") {
    if (!hasStringField(payload, "sessionUserId") || !hasStringField(payload, "fullName")) {
      return { ok: false, error: "updateProfileName requires sessionUserId and fullName." };
    }
    return {
      ok: true,
      value: {
        action,
        sessionUserId: String(payload.sessionUserId),
        fullName: String(payload.fullName),
      },
    };
  }

  if (action === "updateProfileAvatar") {
    const avatarPathRaw = (payload as Record<string, unknown>).avatarPath;
    if (!hasStringField(payload, "sessionUserId") || (avatarPathRaw !== null && typeof avatarPathRaw !== "string")) {
      return { ok: false, error: "updateProfileAvatar requires sessionUserId and avatarPath (string or null)." };
    }
    return {
      ok: true,
      value: {
        action,
        sessionUserId: String(payload.sessionUserId),
        avatarPath: avatarPathRaw === null ? null : String(avatarPathRaw),
      },
    };
  }

  if (action === "upsertColumnOverride") {
    if (!hasStringField(payload, "columnKey") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "upsertColumnOverride requires columnKey and patch object." };
    }
    return {
      ok: true,
      value: {
        action,
        columnKey: String(payload.columnKey),
        patch: payload.patch as UpsertColumnOverridePayload["patch"],
      },
    };
  }

  if (action === "setColumnOrder") {
    if (!Array.isArray(payload.orderedKeys)) {
      return { ok: false, error: "setColumnOrder requires orderedKeys array." };
    }
    const orderedKeys = payload.orderedKeys.filter((k): k is string => typeof k === "string");
    return { ok: true, value: { action, orderedKeys } };
  }

  if (action === "loadTablePreferences" || action === "saveTablePreferences") {
    if (!hasStringField(payload, "tableKey")) {
      return { ok: false, error: `${action} requires tableKey.` };
    }
    const tableKey = String(payload.tableKey).trim();
    if (tableKey.length === 0 || tableKey.length > 64) {
      return { ok: false, error: "tableKey must be 1–64 characters." };
    }

    if (action === "loadTablePreferences") {
      return { ok: true, value: { action, tableKey } };
    }

    if (!hasObjectField(payload, "preferences") || Array.isArray(payload.preferences)) {
      return { ok: false, error: "saveTablePreferences requires a preferences object." };
    }
    // The column matches a 64 KB check constraint; reject early so a runaway client gets a
    // clear error instead of a constraint violation. 32 KB is ~10x any real layout.
    const preferences = payload.preferences as Record<string, unknown>;
    if (JSON.stringify(preferences).length > 32_768) {
      return { ok: false, error: "preferences payload is too large (max 32 KB)." };
    }

    return { ok: true, value: { action, tableKey, preferences } };
  }

  if (action === "createClientCustomField") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createClientCustomField requires input object." };
    }
    return { ok: true, value: { action, input: payload.input as CreateClientCustomFieldPayload["input"] } };
  }

  if (action === "updateClientCustomField") {
    if (!hasStringField(payload, "fieldId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateClientCustomField requires fieldId and patch object." };
    }
    return {
      ok: true,
      value: {
        action,
        fieldId: String(payload.fieldId),
        patch: payload.patch as UpdateClientCustomFieldPayload["patch"],
      },
    };
  }

  if (action === "deleteClientCustomField") {
    if (!hasStringField(payload, "fieldId")) {
      return { ok: false, error: "deleteClientCustomField requires fieldId." };
    }
    return { ok: true, value: { action, fieldId: String(payload.fieldId) } };
  }

  if (action === "upsertClientCustomFieldValue") {
    if (!hasStringField(payload, "clientId") || !hasStringField(payload, "fieldId")) {
      return { ok: false, error: "upsertClientCustomFieldValue requires clientId and fieldId." };
    }
    const value = payload.value;
    if (value !== null && typeof value !== "string") {
      return { ok: false, error: "upsertClientCustomFieldValue.value must be a string or null." };
    }
    return {
      ok: true,
      value: {
        action,
        clientId: String(payload.clientId),
        fieldId: String(payload.fieldId),
        value: value as string | null,
      },
    };
  }

  if (action === "upsertClientSequencer") {
    if (!hasStringField(payload, "clientId") || !hasStringField(payload, "sequencerKey")) {
      return { ok: false, error: "upsertClientSequencer requires clientId and sequencerKey." };
    }
    if (!hasObjectField(payload, "patch")) {
      return { ok: false, error: "upsertClientSequencer requires a patch object." };
    }
    return {
      ok: true,
      value: {
        action,
        clientId: String(payload.clientId),
        sequencerKey: String(payload.sequencerKey),
        patch: payload.patch as UpsertClientSequencerPayload["patch"],
      },
    };
  }

  if (action === "loadLeadCustomFields") {
    return { ok: true, value: { action, clientId: isString(payload.clientId) ? payload.clientId : undefined } };
  }

  if (action === "createLeadCustomField") {
    if (!hasObjectField(payload, "input")) {
      return { ok: false, error: "createLeadCustomField requires input object." };
    }
    const input = payload.input as CreateLeadCustomFieldPayload["input"];
    if (!isString(input.client_id) || !isString(input.name)) {
      return { ok: false, error: "createLeadCustomField input requires client_id and name." };
    }
    return { ok: true, value: { action, input } };
  }

  if (action === "updateLeadCustomField") {
    if (!hasStringField(payload, "fieldId") || !hasObjectField(payload, "patch")) {
      return { ok: false, error: "updateLeadCustomField requires fieldId and patch object." };
    }
    return {
      ok: true,
      value: {
        action,
        fieldId: String(payload.fieldId),
        patch: payload.patch as UpdateLeadCustomFieldPayload["patch"],
      },
    };
  }

  if (action === "deleteLeadCustomField") {
    if (!hasStringField(payload, "fieldId")) {
      return { ok: false, error: "deleteLeadCustomField requires fieldId." };
    }
    return { ok: true, value: { action, fieldId: String(payload.fieldId) } };
  }

  if (action === "upsertLeadCustomFieldValue") {
    if (!hasStringField(payload, "leadId") || !hasStringField(payload, "fieldId")) {
      return { ok: false, error: "upsertLeadCustomFieldValue requires leadId and fieldId." };
    }
    const value = payload.value;
    if (value !== null && typeof value !== "string") {
      return { ok: false, error: "upsertLeadCustomFieldValue.value must be a string or null." };
    }
    return {
      ok: true,
      value: {
        action,
        leadId: String(payload.leadId),
        fieldId: String(payload.fieldId),
        value: value as string | null,
      },
    };
  }

  return { ok: false, error: `Unsupported action: ${action}` };
}
