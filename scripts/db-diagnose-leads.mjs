/**
 * Phase 4B diagnostic — leads query performance.
 * Runs as postgres superuser (bypasses RLS) to get clean query plans.
 * The authenticated-role query adds RLS overhead on top of what we see here.
 */
import postgres from "postgres";

const CONNECTION =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres.bnetnuzxynmdftiadwef:kinjiz-wygde4-sIxnaz@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

const sql = postgres(CONNECTION, { prepare: false, ssl: "require", idle_timeout: 10, max: 1 });

async function header(title) { console.log(`\n${"=".repeat(60)}\n=== ${title}\n${"=".repeat(60)}`); }

async function explain(label, query) {
  header(label);
  const rows = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  for (const r of rows) console.log(r["QUERY PLAN"]);
}

async function main() {
  try {
    // ── Row counts ──────────────────────────────────────────────────────────
    await header("Table row counts");
    const counts = await sql`
      SELECT
        (SELECT count(*)::int FROM leads) AS leads,
        (SELECT count(*)::int FROM replies) AS replies,
        (SELECT count(*)::int FROM campaigns) AS campaigns,
        (SELECT count(*)::int FROM clients) AS clients
    `;
    console.table(counts);

    // ── Existing indexes ─────────────────────────────────────────────────────
    await header("Existing indexes on leads");
    const leadsIdx = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'leads'
      ORDER BY indexname
    `;
    console.table(leadsIdx);

    await header("Existing indexes on replies");
    const repliesIdx = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'replies'
      ORDER BY indexname
    `;
    console.table(repliesIdx);

    await header("Existing indexes on campaigns");
    const campaignsIdx = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'campaigns'
      ORDER BY indexname
    `;
    console.table(campaignsIdx);

    // ── pg_trgm availability ─────────────────────────────────────────────────
    await header("pg_trgm extension");
    const trgm = await sql`SELECT * FROM pg_extension WHERE extname = 'pg_trgm'`;
    console.log(trgm.length ? "pg_trgm INSTALLED" : "pg_trgm NOT INSTALLED");

    // ── EXPLAIN ANALYZE: default load (no filters, created_at DESC) ──────────
    await explain("DEFAULT LOAD — no filters, ORDER BY created_at DESC LIMIT 50", `
      SELECT
        l.id, l.created_at, l.updated_at, l.client_id,
        l.campaign_id, l.email, l.first_name, l.last_name, l.job_title,
        l.company_name, l.linkedin_url, l.gender, l.qualification,
        l.expected_return_date, l.external_id, l.phone_number, l.phone_source,
        l.industry, l.headcount_range, l.website, l.country,
        l.message_title, l.message_number, l.response_time_hours, l.response_time_label,
        l.meeting_booked, l.meeting_held, l.offer_sent, l.won,
        l.added_to_ooo_campaign, l.external_blacklist_id, l.external_domain_blacklist_id,
        l.source, l.reply_text, l.comments,
        c.name AS client_name,
        camp.name AS campaign_name,
        COALESCE(r.reply_count, 0)::int AS reply_count,
        r.last_reply_at
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN (
        SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
        FROM replies GROUP BY lead_id
      ) r ON r.lead_id = l.id
      ORDER BY l.created_at DESC NULLS LAST, l.id ASC
      LIMIT 50 OFFSET 0
    `);

    // ── EXPLAIN ANALYZE: stage count query ────────────────────────────────────
    await explain("STAGE COUNT — no filters, GROUP BY 1", `
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
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      GROUP BY 1
    `);

    // ── EXPLAIN ANALYZE: with campaign filter ────────────────────────────────
    await header("Finding a real campaign_id with leads...");
    const sampleCamp = await sql`
      SELECT campaign_id, count(*) FROM leads WHERE campaign_id IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1
    `;
    if (sampleCamp.length) {
      const campId = sampleCamp[0].campaign_id;
      console.log(`Using campaign_id: ${campId} (${sampleCamp[0].count} leads)`);
      await explain(`CAMPAIGN FILTER — campaign_id = '${campId}'`, `
        SELECT l.id, l.created_at, c.name AS client_name, camp.name AS campaign_name,
               COALESCE(r.reply_count, 0)::int AS reply_count, r.last_reply_at
        FROM leads l
        JOIN clients c ON c.id = l.client_id
        LEFT JOIN campaigns camp ON camp.id = l.campaign_id
        LEFT JOIN (
          SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
          FROM replies GROUP BY lead_id
        ) r ON r.lead_id = l.id
        WHERE l.campaign_id = '${campId}'
        ORDER BY l.created_at DESC NULLS LAST, l.id ASC
        LIMIT 50 OFFSET 0
      `);
    }

    // ── EXPLAIN ANALYZE: free-text search (the expensive path) ───────────────
    await explain("FREE-TEXT SEARCH — LOWER(...) LIKE '%test%'", `
      SELECT l.id, l.created_at, c.name AS client_name
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      WHERE (
        LOWER(COALESCE(l.first_name, '') || ' ' || COALESCE(l.last_name, '')) LIKE '%test%'
        OR LOWER(COALESCE(l.email, '')) LIKE '%test%'
        OR LOWER(COALESCE(l.company_name, '')) LIKE '%test%'
        OR LOWER(COALESCE(l.job_title, '')) LIKE '%test%'
        OR LOWER(COALESCE(l.country, '')) LIKE '%test%'
      )
      ORDER BY l.created_at DESC NULLS LAST, l.id ASC
      LIMIT 50 OFFSET 0
    `);

    // ── EXPLAIN ANALYZE: replyScope=ooo ──────────────────────────────────────
    await explain("REPLY SCOPE OOO — qualification = 'OOO'", `
      SELECT l.id, l.created_at, c.name AS client_name,
             COALESCE(r.reply_count, 0)::int AS reply_count
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      LEFT JOIN campaigns camp ON camp.id = l.campaign_id
      LEFT JOIN (
        SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
        FROM replies GROUP BY lead_id
      ) r ON r.lead_id = l.id
      WHERE l.qualification = 'OOO'
      ORDER BY l.created_at DESC NULLS LAST, l.id ASC
      LIMIT 50 OFFSET 0
    `);

    // ── EXPLAIN ANALYZE: filter options queries ───────────────────────────────
    await explain("FILTER OPTIONS — clientsLite (DISTINCT JOIN leads)", `
      SELECT DISTINCT c.id, c.name FROM clients c
      JOIN leads l ON l.client_id = c.id
      ORDER BY c.name
    `);

    await explain("FILTER OPTIONS — campaignsLite (DISTINCT JOIN leads)", `
      SELECT DISTINCT camp.id, camp.name, camp.client_id FROM campaigns camp
      JOIN leads l ON l.campaign_id = camp.id
      ORDER BY camp.name
    `);

    // ── replies subquery cost in isolation ────────────────────────────────────
    await explain("REPLIES SUBQUERY — GROUP BY lead_id (full scan)", `
      SELECT lead_id, COUNT(*)::int AS reply_count, MAX(received_at) AS last_reply_at
      FROM replies
      GROUP BY lead_id
    `);

  } catch (err) {
    console.error("DIAG FAILED:", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
