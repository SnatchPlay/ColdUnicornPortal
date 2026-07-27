/**
 * Print `public.data_invariants()` and exit non-zero when something is broken.
 *
 * The alert channel for invariant violations is, for now, a row in the database — decided
 * 2026-07-27. That is the same shape that let the 2026-07-23 lead-loss run for four days, so the
 * mitigation is that *checking* has to be one command rather than a query somebody has to remember.
 *
 * Exit codes are chosen so this can become a CI step or a cron probe later without being rewritten:
 *   0  every invariant satisfied
 *   1  a `critical` invariant is violated — data is being lost right now
 *   2  only `warning` invariants are violated
 *   3  the function is missing, or the database could not be reached
 *
 * Usage:
 *   pnpm db:invariants              # SUPABASE_DB_URL from the environment
 *   pnpm db:invariants --json       # machine-readable, for a probe
 */
import postgres from "postgres";

const CONNECTION = process.env.SUPABASE_DB_URL?.trim();
if (!CONNECTION) {
  console.error("SUPABASE_DB_URL is required (local: postgresql://postgres:postgres@127.0.0.1:54322/postgres).");
  process.exit(3);
}

const asJson = process.argv.includes("--json");
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db)[:/]/.test(CONNECTION);
const sslEnv = process.env.SUPABASE_DB_SSL?.trim().toLowerCase();
const ssl = sslEnv === "disable" ? false : sslEnv === "require" ? "require" : isLocal ? false : "require";

const sql = postgres(CONNECTION, { prepare: false, ssl, idle_timeout: 5, max: 1 });

try {
  const rows = await sql`select name, severity, violations, detail from public.data_invariants()`;
  const results = rows
    .map((r) => ({ ...r, violations: Number(r.violations) }))
    // Broken first, then critical before warning, then by name — the top line is the one that matters.
    .sort((a, b) =>
      (b.violations > 0) - (a.violations > 0) ||
      (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) ||
      a.name.localeCompare(b.name));

  const broken = results.filter((r) => r.violations > 0);
  const critical = broken.filter((r) => r.severity === "critical");

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.violations === 0 ? "ok  " : r.severity === "critical" ? "FAIL" : "warn";
      console.log(`${mark}  ${r.name.padEnd(34)} ${String(r.violations).padStart(5)}`);
      if (r.violations > 0) {
        for (const sample of (r.detail ?? []).slice(0, 5)) console.log(`        ${JSON.stringify(sample)}`);
        const hidden = (r.detail?.length ?? 0) - 5;
        if (hidden > 0) console.log(`        … ${hidden} more in the sample, ${r.violations} total`);
      }
    }
    console.log(
      broken.length === 0
        ? `\n${results.length} invariants, all satisfied.`
        : `\n${broken.length} of ${results.length} violated — ${critical.length} critical.`,
    );
  }

  process.exitCode = critical.length > 0 ? 1 : broken.length > 0 ? 2 : 0;
} catch (err) {
  // A missing function is not "no violations" — it is "not checked", which is the distinction the
  // whole mechanism exists to preserve. Never exit 0 here.
  console.error(
    err.code === "42883"
      ? "public.data_invariants() is missing — apply supabase/migrations/20260727c_data_invariants.sql."
      : `INVARIANT CHECK FAILED: ${err.message}`,
  );
  process.exitCode = 3;
} finally {
  await sql.end();
}
