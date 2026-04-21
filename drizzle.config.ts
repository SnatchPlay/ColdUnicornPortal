import type { Config } from "drizzle-kit";

const connectionString =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres.bnetnuzxynmdftiadwef:kinjiz-wygde4-sIxnaz@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

export default {
  schema: "./supabase/drizzle/schema.ts",
  out: "./supabase/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
  schemaFilter: ["public"],
  casing: "snake_case",
} satisfies Config;
