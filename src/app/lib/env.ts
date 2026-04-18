function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
const configuredBaseUrl = trimTrailingSlash(import.meta.env.VITE_APP_BASE_URL?.trim() ?? "");
const appEnv =
  import.meta.env.VITE_APP_ENV?.trim().toLowerCase() ??
  (import.meta.env.PROD ? "production" : import.meta.env.MODE ?? "development");
const isProduction = appEnv === "production";
const appBaseUrl =
  configuredBaseUrl || (!isProduction && typeof window !== "undefined" ? trimTrailingSlash(window.location.origin) : "");

const authInviteOnly = parseBooleanFlag(import.meta.env.VITE_AUTH_INVITE_ONLY, true);
const authAllowSelfSignup = parseBooleanFlag(import.meta.env.VITE_AUTH_ALLOW_SELF_SIGNUP, false) && !authInviteOnly;
const authAllowMagicLink = parseBooleanFlag(import.meta.env.VITE_AUTH_ALLOW_MAGIC_LINK, true);
const allowInternalImpersonation = !isProduction;

const missingVars = [
  !supabaseUrl ? "VITE_SUPABASE_URL" : null,
  !supabasePublishableKey ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
  isProduction && !configuredBaseUrl ? "VITE_APP_BASE_URL" : null,
].filter(Boolean) as string[];

export const runtimeConfig = {
  supabaseUrl,
  supabasePublishableKey,
  appBaseUrl,
  appEnv,
  isProduction,
  authInviteOnly,
  authAllowSelfSignup,
  authAllowMagicLink,
  allowInternalImpersonation,
  isConfigured: missingVars.length === 0,
  error:
    missingVars.length === 0
      ? null
      : `Missing runtime config: ${missingVars.join(", ")}. Copy .env.example to .env before running the app.`,
} as const;
