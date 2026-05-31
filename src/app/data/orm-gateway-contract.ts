import type {
  CampaignRecord,
  ClientCustomFieldRecord,
  ClientCustomFieldType,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientUserRecord,
  ColumnOverrideRecord,
  ConditionRuleRecord,
  CoreSnapshot,
  DomainRecord,
  EmailExcludeRecord,
  Identity,
  InvoiceRecord,
  LeadRecord,
  UserRecord,
} from "../types/core";
import type {
  AdminDashboardOverview,
  ClientDashboardPayload,
  ClientsOverviewPayload,
  LeadDetailResult,
  LeadsFilterOptions,
  LeadsListParams,
  LeadsListResponse,
  ManagerDashboardOverview,
  ShellData,
} from "../types/view-contracts";

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

export interface LoadSnapshotPayload {
  action: "loadSnapshot";
  includeDailyStats?: boolean;
  leadsLimit?: number;
}

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
}

export interface LoadClientDashboardPayload {
  action: "loadClientDashboard";
  /** Effective client ID (post-impersonation from identity.clientId). */
  clientId: string;
}

export interface LoadClientsOverviewPayload {
  action: "loadClientsOverview";
}

export interface LoadLeadsListPayload {
  action: "loadLeadsList";
  params: LeadsListParams;
}

export interface LoadLeadDetailPayload {
  action: "loadLeadDetail";
  leadId: string;
}

export interface LoadLeadsFilterOptionsPayload {
  action: "loadLeadsFilterOptions";
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

export interface CreateClientPayload {
  action: "createClient";
  input: Omit<ClientRecord, "id" | "created_at" | "updated_at">;
}

export interface CreateCampaignPayload {
  action: "createCampaign";
  input: Omit<CampaignRecord, "id" | "created_at" | "updated_at">;
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

export type OrmGatewayRequest =
  | LoadSnapshotPayload
  | LoadConditionRulesPayload
  | LoadShellDataPayload
  | LoadAdminDashboardPayload
  | LoadManagerDashboardPayload
  | LoadClientDashboardPayload
  | LoadClientsOverviewPayload
  | LoadLeadsListPayload
  | LoadLeadDetailPayload
  | LoadLeadsFilterOptionsPayload
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
  | UpsertColumnOverridePayload
  | SetColumnOrderPayload
  | CreateClientCustomFieldPayload
  | UpdateClientCustomFieldPayload
  | DeleteClientCustomFieldPayload
  | UpsertClientCustomFieldValuePayload;

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
  loadSnapshot: CoreSnapshot;
  loadShellData: ShellData;
  loadAdminDashboardOverview: AdminDashboardOverview;
  loadManagerDashboardOverview: ManagerDashboardOverview;
  loadClientDashboard: ClientDashboardPayload;
  loadClientsOverview: ClientsOverviewPayload;
  loadLeadsList: LeadsListResponse;
  loadLeadDetail: LeadDetailResult;
  loadLeadsFilterOptions: LeadsFilterOptions;
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
  upsertColumnOverride: ColumnOverrideRecord;
  setColumnOrder: ColumnOverrideRecord[];
  createClientCustomField: ClientCustomFieldRecord;
  updateClientCustomField: ClientCustomFieldRecord;
  deleteClientCustomField: { ok: true };
  upsertClientCustomFieldValue: ClientCustomFieldValueRecord;
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

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
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

  if (action === "loadSnapshot") {
    if (!isOptionalBoolean(payload.includeDailyStats)) {
      return { ok: false, error: "loadSnapshot.includeDailyStats must be a boolean when provided." };
    }
    if (!isOptionalNumber(payload.leadsLimit)) {
      return { ok: false, error: "loadSnapshot.leadsLimit must be a number when provided." };
    }
    return {
      ok: true,
      value: {
        action,
        includeDailyStats: payload.includeDailyStats,
        leadsLimit: payload.leadsLimit,
      },
    };
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
    return { ok: true, value: { action, managerId: String(payload.managerId) } };
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

  if (action === "loadLeadDetail") {
    if (!hasStringField(payload, "leadId")) {
      return { ok: false, error: "loadLeadDetail requires leadId." };
    }
    return { ok: true, value: { action, leadId: String(payload.leadId) } };
  }

  if (action === "loadLeadsFilterOptions") {
    return { ok: true, value: { action } };
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
    return { ok: true, value: { action, input: payload.input as CreateClientPayload["input"] } };
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

  return { ok: false, error: `Unsupported action: ${action}` };
}
