/**
 * EXPLAIN ANALYZE with RLS context for loadLeadsFilterOptions + loadLeadsList queries.
 * Signs in as admin, gets real JWT sub, then runs queries inside a transaction
 * with JWT context set — same code path as executeAsCaller.
 */
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://bnetnuzxynmdftiadwef.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_6jbWFa2hOX-5U6TWS_KtrQ_5JXYCRG2";
const CONNECTION = process.env.SUPABASE_DB_URL?.trim();
if (!CONNECTION) {
  console.error("SUPABASE_DB_URL is required (no hardcoded credentials).");
  process.exit(1);
}

const sql = postgres(CONNECTION, { prepare: false, ssl: "require", max: 1 });

async function explain(tx, label, query) {
  const t0 = performance.now();
  const rows = await tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`\n=== ${label} (${ms}ms) ===`);
  for (const r of rows) console.log(r["QUERY PLAN"]);
}

async function withRlsContext(adminSub, fn) {
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: adminSub, role: "authenticated" });
    await tx`SELECT
      set_config('request.jwt.claims', ${claims}, true),
      set_config('request.jwt.claim.sub', ${adminSub}, true),
      set_config('request.jwt.claim.role', ${"authenticated"}, true),
      set_config('role', ${"authenticated"}, true)`;
    return fn(tx);
  });
}

async function main() {
  // Sign in as admin to get real UUID
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  const { data, error } = await client.auth.signInWithPassword({
    email: "medaval606@tatefarm.com",
    password: "2336629a",
  });
  if (error) { console.error("Auth failed:", error.message); process.exit(1); }

  const jwt = data.session.access_token;
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  const adminSub = payload.sub;
  console.log(`Signed in as admin sub=${adminSub}`);

  await withRlsContext(adminSub, async (tx) => {
    // Verify role context is set
    const roleCheck = await tx`SELECT current_user, current_setting('request.jwt.claim.sub', true) AS sub_claim`;
    console.log("Role context:", roleCheck[0]);

    await explain(tx, "clientsLite (WITH RLS, admin)", `
      SELECT DISTINCT c.id, c.name FROM clients c
      JOIN leads l ON l.client_id = c.id
      ORDER BY c.name
    `);

    await explain(tx, "campaignsLite (WITH RLS, admin)", `
      SELECT DISTINCT camp.id, camp.name, camp.client_id FROM campaigns camp
      JOIN leads l ON l.campaign_id = camp.id
      ORDER BY camp.name
    `);

    await explain(tx, "stageCount (WITH RLS, no filters)", `
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
    `);

    await explain(tx, "dataPage LIMIT 50 (WITH RLS)", `
      SELECT l.id, l.created_at, c.name AS client_name,
             COALESCE(r.reply_count, 0)::int AS reply_count
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN (SELECT lead_id, COUNT(*)::int reply_count FROM replies GROUP BY lead_id) r ON r.lead_id = l.id
      ORDER BY l.created_at DESC NULLS LAST, l.id ASC
      LIMIT 50 OFFSET 0
    `);

    // Also check can_access_client function timing in isolation
    await explain(tx, "can_access_client call isolation", `
      SELECT private.can_access_client(client_id) FROM leads LIMIT 1
    `);
  });

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
