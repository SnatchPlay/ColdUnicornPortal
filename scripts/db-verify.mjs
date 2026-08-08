import postgres from "postgres";

const CONNECTION = process.env.SUPABASE_DB_URL?.trim();
if (!CONNECTION) {
  console.error("SUPABASE_DB_URL is required (no hardcoded credentials).");
  process.exit(1);
}

// The local stack speaks plaintext, and `rls-migration` requires every migration to be verified
// there before the cloud. Same detection as scripts/db-invariants.mjs.
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|db)[:/]/.test(CONNECTION);
const sslEnv = process.env.SUPABASE_DB_SSL?.trim().toLowerCase();
const ssl = sslEnv === "disable" ? false : sslEnv === "require" ? "require" : isLocal ? false : "require";

const sql = postgres(CONNECTION, { prepare: false, ssl, max: 1 });
const superAdminId = "a46b2eaa-be36-4b8c-8559-82c74db778ac";

async function h(t) { console.log(`\n=== ${t} ===`); }

try {
  await sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: superAdminId, role: "authenticated" });
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);
    await tx.unsafe(`set local "request.jwt.claim.sub" = '${superAdminId}'`);

    await h("post-migration: SELECT * campaign_daily_stats ORDER BY report_date DESC");
    let p = await tx.unsafe(
      `explain (analyze, buffers) select * from public.campaign_daily_stats order by report_date desc`,
    );
    for (const r of p) console.log(r["QUERY PLAN"]);

    await h("post-migration: last 21 days filter");
    p = await tx.unsafe(
      `explain (analyze, buffers) select * from public.campaign_daily_stats where report_date >= current_date - interval '21 days' order by report_date desc`,
    );
    for (const r of p) console.log(r["QUERY PLAN"]);

    await h("admin_dashboard_daily view");
    p = await tx.unsafe(`explain (analyze, buffers) select * from public.admin_dashboard_daily`);
    for (const r of p) console.log(r["QUERY PLAN"]);

    const rows = await tx`select * from public.admin_dashboard_daily order by report_date desc limit 5`;
    console.log("sample:", rows);
  });
} catch (err) {
  console.error("FAIL", err.code, err.message);
} finally {
  await sql.end();
}
