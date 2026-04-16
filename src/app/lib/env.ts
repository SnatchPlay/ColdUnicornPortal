const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

const missingVars = [
  !supabaseUrl ? "VITE_SUPABASE_URL" : null,
  !supabasePublishableKey ? "VITE_SUPABASE_PUBLISHABLE_KEY" : null,
].filter(Boolean) as string[];

export const runtimeConfig = {
  supabaseUrl,
  supabasePublishableKey,
  isConfigured: missingVars.length === 0,
  error:
    missingVars.length === 0
      ? null
      : `Missing runtime config: ${missingVars.join(", ")}. Copy .env.example to .env before running the app.`,
} as const;
