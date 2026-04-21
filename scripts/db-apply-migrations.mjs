import postgres from "postgres";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONNECTION =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres.bnetnuzxynmdftiadwef:kinjiz-wygde4-sIxnaz@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url).pathname.replace(/^\//, "");

const sql = postgres(CONNECTION, { prepare: false, ssl: "require", max: 1 });

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
