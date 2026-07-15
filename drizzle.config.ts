import type { Config } from "drizzle-kit";

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error("SUPABASE_DB_URL is required for drizzle-kit (no hardcoded credentials).");
}

export default {
  schema: "./supabase/drizzle/schema.ts",
  out: "./supabase/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
  schemaFilter: ["public"],
  casing: "snake_case",
} satisfies Config;
