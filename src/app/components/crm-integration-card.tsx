import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Surface } from "./app-ui";
import { cn } from "./ui/utils";
import {
  exchangeZohoTokens,
  fetchCrmProviders,
  initSalesforceOAuth,
  submitCrmApiKeyCredentials,
  type CrmProvider,
} from "../lib/crm-integration";
import { runtimeConfig } from "../lib/env";
import type { ClientRecord } from "../types/core";

/**
 * The client-facing "connect your CRM" card. It forwards credentials to the legacy CRM Supabase
 * project (ADR-0010), which posts them onward to the connect webhook.
 *
 * IT NO LONGER MIRRORS STATUS INTO OUR DATABASE. It used to write `clients.crm_config` on every
 * connect, disconnect and failure — a full-object replace. That column turned out to hold PDCA /
 * Sheets metadata for 46 of 63 clients, so the mirror was doing two wrong things at once: the badge
 * never rendered (the shape it required was never there), and the first successful connect would
 * have destroyed that client's spreadsheet_id, report_link and growth_head. The column is gone
 * (ADR-0019); the record of a CRM connection now lives in `client_crm_connections`, written by n8n
 * from the webhook, and the portal does not read it.
 *
 * Consequence, stated plainly: there is no connected/disconnect UI here any more. Submitting
 * credentials still works and is still the only way a client connects a CRM. A status badge can
 * come back when a credential-free view over client_crm_connections exists.
 */
interface CrmIntegrationCardProps {
  client: ClientRecord | null;
}

interface ProvidersState {
  data: CrmProvider[];
  loading: boolean;
  error: string | null;
}

const ZOHO_OAUTH_STORAGE_KEY = "crm_oauth_data";




export function CrmIntegrationCard({ client }: CrmIntegrationCardProps) {
  const [providersState, setProvidersState] = useState<ProvidersState>({
    data: [],
    loading: true,
    error: null,
  });
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [salesforceEnv, setSalesforceEnv] = useState<"production" | "sandbox">("production");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProcessingOAuth, setIsProcessingOAuth] = useState(false);

  const legacyConfigured = runtimeConfig.legacyCrmConfigured;

  useEffect(() => {
    if (!legacyConfigured) {
      setProvidersState({ data: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setProvidersState((prev) => ({ ...prev, loading: true, error: null }));
    fetchCrmProviders()
      .then((data) => {
        if (cancelled) return;
        setProvidersState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load providers";
        setProvidersState({ data: [], loading: false, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [legacyConfigured]);

  const selectedProvider = useMemo(
    () => providersState.data.find((provider) => provider.id === selectedProviderId) ?? null,
    [providersState.data, selectedProviderId],
  );

  // Reset form values when provider changes; auto-fill redirect URI for OAuth.
  useEffect(() => {
    if (!selectedProvider) {
      setFormValues({});
      return;
    }
    const next: Record<string, string> = {};
    selectedProvider.fields_config.forEach((field) => {
      if (field.name === "redirectUri" && selectedProvider.auth_type === "oauth2") {
        next[field.name] =
          selectedProvider.name === "salesforce"
            ? `${runtimeConfig.legacyCrmSupabaseUrl}/functions/v1/salesforce-oauth/callback`
            : window.location.origin + window.location.pathname;
      } else {
        next[field.name] = "";
      }
    });
    setFormValues(next);
  }, [selectedProvider]);

  // OAuth callback handling — Salesforce server-side and Zoho client-side.
  useEffect(() => {
    if (!client) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const provider = params.get("provider");
    const message = params.get("message");
    const code = params.get("code");

    if (status === "connected" && provider) {
      const providerName = decodeURIComponent(provider);
      toast.success(`Connected to ${providerName}. You can close this tab if it was opened in a new window.`);
      cleanOAuthParams();
    } else if (status === "error" && provider) {
      const providerName = decodeURIComponent(provider);
      const errorMessage = message ? decodeURIComponent(message) : "OAuth failed";
      toast.error(`${providerName}: ${errorMessage}`);
      cleanOAuthParams();
    }

    // Zoho client-side OAuth callback (we only act if a Zoho session was queued).
    const zohoSession = window.localStorage.getItem(ZOHO_OAUTH_STORAGE_KEY);
    if (code && !provider && zohoSession) {
      void handleZohoCallback(code, zohoSession);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);


  function cleanOAuthParams() {
    const url = new URL(window.location.href);
    ["status", "provider", "message", "code", "state", "clientName"].forEach((key) =>
      url.searchParams.delete(key),
    );
    window.history.replaceState({}, document.title, url.pathname + (url.search || ""));
  }

  async function handleZohoCallback(code: string, sessionRaw: string) {
    setIsProcessingOAuth(true);
    try {
      const session = JSON.parse(sessionRaw) as {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        region?: string;
        clientName: string;
        webhookUrl: string;
        providerId: string;
      };
      await exchangeZohoTokens({
        code,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        redirectUri: session.redirectUri,
        region: session.region ?? "com",
        clientName: session.clientName,
        webhookUrl: session.webhookUrl,
        providerId: session.providerId,
      });
      toast.success("Zoho CRM connected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zoho OAuth failed";
      toast.error(message);
    } finally {
      window.localStorage.removeItem(ZOHO_OAUTH_STORAGE_KEY);
      cleanOAuthParams();
      setIsProcessingOAuth(false);
    }
  }

  function setField(name: string, value: string) {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }

  const validationError = useMemo(() => {
    if (!selectedProvider) return null;
    for (const field of selectedProvider.fields_config) {
      if (selectedProvider.name === "salesforce" && field.name === "env") continue;
      if (field.required && !(formValues[field.name] ?? "").trim()) {
        return `${field.label} is required`;
      }
    }
    return null;
  }, [selectedProvider, formValues]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !selectedProvider) return;
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setIsSubmitting(true);
    try {
      if (selectedProvider.auth_type === "oauth2") {
        if (selectedProvider.name === "salesforce") {
          const { authorizeUrl } = await initSalesforceOAuth({
            clientName: client.name,
            env: salesforceEnv,
            frontendUrl: window.location.origin + window.location.pathname,
          });
          window.location.href = authorizeUrl;
          return;
        }

        // Zoho — store session locally, redirect to Zoho consent screen.
        const region = (formValues.region || "com").toLowerCase();
        const session = {
          clientId: formValues.clientId,
          clientSecret: formValues.clientSecret,
          redirectUri: formValues.redirectUri,
          region,
          clientName: client.name,
          webhookUrl: selectedProvider.webhook_url,
          providerId: selectedProvider.id,
        };
        window.localStorage.setItem(ZOHO_OAUTH_STORAGE_KEY, JSON.stringify(session));
        const authUrl = new URL(`https://accounts.zoho.${region}/oauth/v2/auth`);
        authUrl.searchParams.append("response_type", "code");
        authUrl.searchParams.append("client_id", formValues.clientId);
        authUrl.searchParams.append("scope", "ZohoCRM.modules.ALL");
        authUrl.searchParams.append("redirect_uri", formValues.redirectUri);
        authUrl.searchParams.append("access_type", "offline");
        authUrl.searchParams.append("prompt", "consent");
        window.location.href = authUrl.toString();
        return;
      }

      // API-key flow.
      await submitCrmApiKeyCredentials({
        clientName: client.name,
        provider: selectedProvider,
        values: formValues,
      });
      toast.success(`${selectedProvider.display_name} credentials submitted.`);
      setSelectedProviderId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed";
      if (selectedProvider) {
      }
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }


  if (!legacyConfigured) {
    return (
      <Surface
        title="CRM integration"
        subtitle="Connect your CRM so we can sync replies and meetings into your pipeline."
      >
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4 text-sm text-amber-100">
          CRM integration is not configured for this environment. Please contact your account manager.
        </div>
      </Surface>
    );
  }

  if (!client) {
    return (
      <Surface
        title="CRM integration"
        subtitle="Connect your CRM so we can sync replies and meetings into your pipeline."
      >
        <p className="text-sm text-muted-foreground">
          We could not match your account to a client workspace. Refresh the page or sign in again.
        </p>
      </Surface>
    );
  }

  return (
    <Surface
      title="CRM integration"
      subtitle="Authorize your CRM so meetings, replies, and won deals can be synced automatically."
    >
      <div className="space-y-5">
        <form className="space-y-4 rounded-2xl border border-border bg-black/10 p-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <p className="text-sm">Connect a CRM provider</p>
            <p className="text-xs text-muted-foreground">
              We forward credentials securely to our automation backend; nothing is stored in plain text in your portal.
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">CRM provider</span>
            <select
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
              disabled={providersState.loading || providersState.data.length === 0 || isSubmitting}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
            >
              <option value="">
                {providersState.loading
                  ? "Loading providers..."
                  : providersState.data.length === 0
                    ? "No providers available"
                    : "Choose a CRM system..."}
              </option>
              {providersState.data.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name} ({provider.auth_type === "oauth2" ? "OAuth 2.0" : "API key"})
                </option>
              ))}
            </select>
          </label>

          {providersState.error ? (
            <p className="text-xs text-red-300">Failed to load providers: {providersState.error}</p>
          ) : null}

          {selectedProvider && selectedProvider.name === "salesforce" ? (
            <div className="space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Environment</span>
              <div className="flex gap-2">
                {(["production", "sandbox"] as const).map((envValue) => (
                  <button
                    key={envValue}
                    type="button"
                    onClick={() => setSalesforceEnv(envValue)}
                    className={cn(
                      "flex-1 rounded-full border px-4 py-2 text-sm transition",
                      salesforceEnv === envValue
                        ? "border-sky-400/40 bg-sky-500/10 text-sky-100"
                        : "border-border bg-black/20 text-muted-foreground hover:border-sky-400/30",
                    )}
                  >
                    {envValue === "production" ? "Production" : "Sandbox"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {selectedProvider
            ? selectedProvider.fields_config
                .filter((field) => !(selectedProvider.name === "salesforce" && field.name === "env"))
                .map((field) => {
                  const isReadOnlyRedirect =
                    field.name === "redirectUri" && selectedProvider.auth_type === "oauth2";
                  return (
                    <label key={field.name} className="block space-y-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {field.label}
                        {field.required ? " *" : ""}
                      </span>
                      {field.type === "select" ? (
                        <select
                          value={formValues[field.name] ?? ""}
                          onChange={(event) => setField(field.name, event.target.value)}
                          disabled={isSubmitting}
                          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                        >
                          <option value="">Select {field.label.toLowerCase()}</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option.toLowerCase()}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          value={formValues[field.name] ?? ""}
                          onChange={(event) => setField(field.name, event.target.value)}
                          readOnly={isReadOnlyRedirect}
                          disabled={isSubmitting}
                          placeholder={`Enter ${field.label.toLowerCase()}`}
                          className={cn(
                            "w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15",
                            isReadOnlyRedirect && "text-muted-foreground",
                          )}
                        />
                      )}
                    </label>
                  );
                })
            : null}

          {selectedProvider && selectedProvider.name === "salesforce" ? (
            <p className="text-xs text-muted-foreground">
              You will be redirected to Salesforce to authorize access. No client credentials are needed.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!selectedProvider || isSubmitting || isProcessingOAuth || Boolean(validationError)}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProcessingOAuth
              ? "Processing OAuth..."
              : isSubmitting
                ? "Submitting..."
                : selectedProvider?.auth_type === "oauth2"
                  ? "Connect with OAuth"
                  : "Submit credentials"}
          </button>
        </form>
      </div>
    </Surface>
  );
}
