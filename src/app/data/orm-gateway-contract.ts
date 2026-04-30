import type {
  CampaignRecord,
  ClientRecord,
  ClientUserRecord,
  ConditionRuleRecord,
  CoreSnapshot,
  DomainRecord,
  EmailExcludeRecord,
  Identity,
  InvoiceRecord,
  LeadRecord,
  UserRecord,
} from "../types/core";

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

export type OrmGatewayRequest =
  | LoadSnapshotPayload
  | LoadConditionRulesPayload
  | UpdateClientPayload
  | UpdateCampaignPayload
  | UpdateLeadPayload
  | UpdateDomainPayload
  | UpdateInvoicePayload
  | CreateConditionRulePayload
  | UpdateConditionRulePayload
  | DeleteConditionRulePayload
  | UpsertClientUserMappingPayload
  | DeleteClientUserMappingPayload
  | UpsertEmailExcludeDomainPayload
  | DeleteEmailExcludeDomainPayload
  | LoadIdentityPayload
  | UpdateProfileNamePayload;

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
  loadConditionRules: ConditionRuleRecord[];
  updateClient: ClientRecord;
  updateCampaign: CampaignRecord;
  updateLead: LeadRecord;
  updateDomain: DomainRecord;
  updateInvoice: InvoiceRecord;
  createConditionRule: ConditionRuleRecord;
  updateConditionRule: ConditionRuleRecord;
  deleteConditionRule: { ok: true };
  upsertClientUserMapping: ClientUserRecord;
  deleteClientUserMapping: { ok: true };
  upsertEmailExcludeDomain: EmailExcludeRecord;
  deleteEmailExcludeDomain: { ok: true };
  loadIdentity: LoadIdentityResult;
  updateProfileName: UpdateProfileNameResult;
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

  return { ok: false, error: `Unsupported action: ${action}` };
}
