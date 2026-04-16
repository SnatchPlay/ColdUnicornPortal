import { createClient } from "@supabase/supabase-js";
import { runtimeConfig } from "./env";

export const supabase = runtimeConfig.isConfigured
  ? createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
