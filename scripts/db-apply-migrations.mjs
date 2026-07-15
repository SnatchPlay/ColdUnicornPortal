import postgres from "postgres";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Connection is REQUIRED via env — no hardcoded credentials. Point it at the cloud pooler
// in CI (GitHub secret) or at the local stack for development:
//   local:  postgresql://postgres:postgres@127.0.0.1:54322/postgres
//   cloud:  the pooler URL from the Supabase dashboard (kept as a secret, never committed)
const CONNECTION = process.env.SUPABASE_DB_URL?.trim();
if (!CONNECTION) {
  console.error(
    "SUPABASE_DB_URL is required. Example (local): " +
      "SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:migrate",
  );
  process.exit(1);
}

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url).pathname;

// Managed Supabase requires TLS; a local Postgres has none. Default to TLS and turn it off for
// localhost, or force it explicitly with SUPABASE_DB_SSL=require|disable.
const sslEnv = process.env.SUPABASE_DB_SSL?.trim().toLowerCase();
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db)[:/]/.test(CONNECTION);
const ssl = sslEnv === "disable" ? false : sslEnv === "require" ? "require" : isLocal ? false : "require";

const sql = postgres(CONNECTION, { prepare: false, ssl, max: 1 });

async function ensureTable() {
  await sql`
    create schema if not exists private;
    create table if not exists private.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `.simple();
}

async function main() {
  try {
    await ensureTable();

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && statSync(join(MIGRATIONS_DIR, f)).isFile())
      .sort();

    const applied = new Set(
      (await sql`select filename from private.schema_migrations`).map((r) => r.filename),
    );

    const target = process.argv[2];
    for (const file of files) {
      if (target && file !== target) continue;
      if (applied.has(file)) {
        console.log(`↷ skip (applied) ${file}`);
        continue;
      }
      const path = join(MIGRATIONS_DIR, file);
      const body = readFileSync(path, "utf8");
      console.log(`▶ applying ${file}`);
      await sql.unsafe(body);
      await sql`insert into private.schema_migrations(filename) values (${file})`;
      console.log(`✓ applied ${file}`);
    }
  } catch (err) {
    console.error("MIGRATION FAILED:", err.code, err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
