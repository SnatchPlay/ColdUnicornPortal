/**
 * Phase 4B RLS latency diagnostic.
 * Runs as superuser (no RLS) to measure per-query baseline,
 * then as authenticated role to measure with RLS overhead.
 * Separate from the edge function to isolate DB-layer timing from edge overhead.
 */
import postgres from "postgres";

const CONNECTION = process.env.SUPABASE_DB_URL?.trim();
if (!CONNECTION) {
  console.error("SUPABASE_DB_URL is required (no hardcoded credentials).");
  process.exit(1);
}

// Use a pooler-compatible connection that mirrors what the edge function uses.
const sql = postgres(CONNECTION, { prepare: false, ssl: "require", max: 1 });

async function timeQuery(label, queryFn) {
  const t0 = performance.now();
  const result = await queryFn();
  const ms = performance.now() - t0;
  const rows = Array.isArray(result) ? result.length : (result?.rows?.length ?? 0);
  console.log(`  ${label.padEnd(48)} ${ms.toFixed(1).padStart(8)}ms   rows=${rows}`);
  return { ms, rows };
}

async function main() {
  try {
    console.log("\n=== Baseline: superuser (no RLS) ===\n");

    // Measure each query in isolation — same pooler connection as edge function
    await timeQuery("set_config (simulated setup)", () =>
      sql`SELECT
        set_config('request.jwt.claims', '{"sub":"superuser","role":"authenticated"}', true),
        set_config('request.jwt.claim.sub', 'superuser', true),
        set_config('request.jwt.claim.role', 'authenticated', true)`,
    );

    await timeQuery("set local role authenticated", () =>
      sql.unsafe("SET LOCAL ROLE authenticated"),
    );

    await timeQuery("set local role reset (back to superuser)", () =>
      sql.unsafe("RESET ROLE"),
    );

    await timeQuery("clientsLite (DISTINCT JOIN leads)", () =>
      sql`SELECT DISTINCT c.id, c.name FROM clients c JOIN leads l ON l.client_id = c.id ORDER BY c.name`,
    );

    await timeQuery("campaignsLite (DISTINCT JOIN leads)", () =>
      sql`SELECT DISTINCT camp.id, camp.name, camp.client_id FROM campaigns camp JOIN leads l ON l.campaign_id = camp.id ORDER BY camp.name`,
    );

    await timeQuery("stageCount (no filter)", () =>
      sql.unsafe(`
        SELECT (
          CASE
            WHEN l.won = true THEN 'won'
            WHEN l.offer_sent = true THEN 'offer_sent'
            WHEN l.meeting_held = true THEN 'meeting_held'
            WHEN l.meeting_booked = true THEN 'meeting_scheduled'
            WHEN l.qualification IS NULL THEN 'unqualified'
            ELSE l.qualification::text
          END
        ) AS stage, COUNT(*)::int AS count
        FROM leads l
        JOIN clients c ON c.id = l.client_id
        GROUP BY 1
      `),
    );

    await timeQuery("dataPage (no filter, LIMIT 50)", () =>
      sql.unsafe(`
        SELECT l.id, l.created_at, l.client_id, c.name AS client_name,
               COALESCE(r.reply_count, 0)::int AS reply_count
        FROM leads l
        JOIN clients c ON c.id = l.client_id
        LEFT JOIN (SELECT lead_id, COUNT(*)::int reply_count FROM replies GROUP BY lead_id) r ON r.lead_id = l.id
        ORDER BY l.created_at DESC, l.id ASC
        LIMIT 50
      `),
    );

    // ── RLS policies ──────────────────────────────────────────────────────────
    console.log("\n=== RLS policies on hot tables ===\n");
    const policies = await sql`
      SELECT tablename, policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('leads', 'clients', 'campaigns', 'replies')
      ORDER BY tablename, policyname
    `;
    for (const p of policies) {
      console.log(`  [${p.tablename}] ${p.policyname} (${p.cmd})`);
      if (p.qual) console.log(`    USING: ${String(p.qual).slice(0, 200)}`);
    }

    // ── Simulate full executeAsCaller overhead in a transaction ───────────────
    console.log("\n=== executeAsCaller transaction simulation (superuser impersonating authenticated) ===\n");

    const tTx0 = performance.now();
    await sql.begin(async (tx) => {
      const t1 = performance.now();
      await tx`SELECT
        set_config('request.jwt.claims', '{"sub":"admin-sim","role":"authenticated","app_metadata":{"role":"admin"}}', true),
        set_config('request.jwt.claim.sub', 'admin-sim', true),
        set_config('request.jwt.claim.role', 'authenticated', true)`;
      console.log(`  set_config:`.padEnd(52) + `${(performance.now() - t1).toFixed(1)}ms`);

      const t2 = performance.now();
      await tx.unsafe("SET LOCAL ROLE authenticated");
      console.log(`  SET LOCAL ROLE:`.padEnd(52) + `${(performance.now() - t2).toFixed(1)}ms`);

      const t3 = performance.now();
      const r3 = await tx.unsafe(`
        SELECT DISTINCT c.id, c.name FROM clients c JOIN leads l ON l.client_id = c.id ORDER BY c.name
      `);
      console.log(`  clientsLite (WITH RLS):`.padEnd(52) + `${(performance.now() - t3).toFixed(1)}ms  rows=${r3.length}`);

      const t4 = performance.now();
      const r4 = await tx.unsafe(`
        SELECT DISTINCT camp.id, camp.name, camp.client_id FROM campaigns camp
        JOIN leads l ON l.campaign_id = camp.id ORDER BY camp.name
      `);
      console.log(`  campaignsLite (WITH RLS):`.padEnd(52) + `${(performance.now() - t4).toFixed(1)}ms  rows=${r4.length}`);
    });
    console.log(`  TOTAL transaction (simulated filterOptions):`.padEnd(52) + `${(performance.now() - tTx0).toFixed(1)}ms`);

    // ── Test combined set_config trick ────────────────────────────────────────
    console.log("\n=== Combined setup (1 round-trip instead of 2) ===\n");
    const tCombined0 = performance.now();
    await sql`SELECT
      set_config('request.jwt.claims', '{"sub":"admin-sim","role":"authenticated"}', true),
      set_config('request.jwt.claim.sub', 'admin-sim', true),
      set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('role', 'authenticated', true)`;
    console.log(`  set_config + set_config('role') combined:`.padEnd(52) + `${(performance.now() - tCombined0).toFixed(1)}ms`);
    await sql`SELECT current_user, current_setting('role', true) AS role_setting`;
    await sql.unsafe("RESET ROLE");

    // ── Round-trip latency baseline ───────────────────────────────────────────
    console.log("\n=== Raw round-trip cost (SELECT 1) ===\n");
    for (let i = 0; i < 5; i++) {
      await timeQuery(`SELECT 1 (trip ${i + 1})`, () => sql`SELECT 1`);
    }

  } catch (err) {
    console.error("DIAG FAILED:", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
