import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeConfig } from "./env";

export type CrmFieldType = "text" | "password" | "select";
export type CrmAuthType = "oauth2" | "api_key";

export interface CrmFieldConfig {
  name: string;
  label: string;
  type: CrmFieldType;
  required: boolean;
  options?: string[];
}

export interface CrmProvider {
  id: string;
  name: string;
  display_name: string;
  auth_type: CrmAuthType;
  webhook_url: string;
  is_active: boolean;
  fields_config: CrmFieldConfig[];
}

let cachedClient: SupabaseClient | null = null;

function getLegacyClient(): SupabaseClient | null {
  if (!runtimeConfig.legacyCrmConfigured) return null;
  if (cachedClient) return cachedClient;
  cachedClient = createClient(runtimeConfig.legacyCrmSupabaseUrl, runtimeConfig.legacyCrmPublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

interface ProviderRow {
  id: string;
  name: string;
  display_name: string;
  auth_type: string;
  webhook_url: string;
  is_active: boolean;
}

interface ProviderFieldRow {
  provider_id: string;
  field_name: string;
  field_label: string;
  field_type: string;
  field_options: unknown;
  is_required: boolean;
  field_order: number;
}

export async function fetchCrmProviders(): Promise<CrmProvider[]> {
  const client = getLegacyClient();
  if (!client) return [];

  const [providersRes, fieldsRes] = await Promise.all([
    client.from("crm_providers").select("*").eq("is_active", true).order("display_name"),
    client.from("crm_provider_fields").select("*").order("field_order"),
  ]);

  if (providersRes.error) throw providersRes.error;
  if (fieldsRes.error) throw fieldsRes.error;

  const providers = (providersRes.data ?? []) as ProviderRow[];
  const fields = (fieldsRes.data ?? []) as ProviderFieldRow[];

  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    display_name: provider.display_name,
    auth_type: provider.auth_type as CrmAuthType,
    webhook_url: provider.webhook_url,
    is_active: provider.is_active,
    fields_config: fields
      .filter((field) => field.provider_id === provider.id)
      .map((field) => ({
        name: field.field_name,
        label: field.field_label,
        type: field.field_type as CrmFieldType,
        required: field.is_required,
        options: Array.isArray(field.field_options) ? (field.field_options as string[]) : undefined,
      })),
  }));
}

interface LegacyEdgeRequestInit {
  path: string;
  body: Record<string, unknown>;
}

async function callLegacyEdge<TResponse>({ path, body }: LegacyEdgeRequestInit): Promise<TResponse> {
  if (!runtimeConfig.legacyCrmConfigured) {
    throw new Error("Legacy CRM project is not configured.");
  }
  const endpoint = `${runtimeConfig.legacyCrmSupabaseUrl}/functions/v1/${path}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: runtimeConfig.legacyCrmPublishableKey,
      Authorization: `Bearer ${runtimeConfig.legacyCrmPublishableKey}`,
    },
    body: JSON.stringify(body),
  });
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
    const message =
      typeof payload.error === "string" ? payload.error : `Edge Function failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload as TResponse;
}

export interface SubmitApiKeyArgs {
  clientName: string;
  provider: CrmProvider;
  values: Record<string, string>;
}

export function submitCrmApiKeyCredentials({ clientName, provider, values }: SubmitApiKeyArgs) {
  return callLegacyEdge<{ success: boolean; webhookStatus?: number; error?: string }>({
    path: "submit-crm-credentials",
    body: {
      clientName,
      crmProvider: provider.name,
      credentials: values,
      webhookUrl: provider.webhook_url,
    },
  });
}

export interface InitSalesforceArgs {
  clientName: string;
  env: "production" | "sandbox";
  frontendUrl: string;
}

export function initSalesforceOAuth({ clientName, env, frontendUrl }: InitSalesforceArgs) {
  return callLegacyEdge<{ authorizeUrl: string }>({
    path: "salesforce-oauth/init",
    body: { clientName, env, frontendUrl },
  });
}

export interface ZohoTokenExchangeArgs {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  region: string;
  clientName: string;
  webhookUrl: string;
  providerId: string;
}

export function exchangeZohoTokens(args: ZohoTokenExchangeArgs) {
  return callLegacyEdge<{ success: boolean; error?: string }>({
    path: "zoho-token-exchange",
    body: args,
  });
}
