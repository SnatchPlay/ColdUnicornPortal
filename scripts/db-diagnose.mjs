import postgres from "postgres";

const CONNECTION =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres.bnetnuzxynmdftiadwef:kinjiz-wygde4-sIxnaz@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

const sql = postgres(CONNECTION, {
  prepare: false,
  ssl: "require",
  idle_timeout: 5,
  max: 1,
});

async function header(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  try {
    await header("DB version");
    const v = await sql`select version()`;
    console.log(v[0].version);

    await header("campaign_daily_stats columns");
    const cols = await sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema='public' and table_name='campaign_daily_stats'
      order by ordinal_position
    `;
    console.table(cols);

    await header("campaign_daily_stats indexes");
    const idx = await sql`
      select indexname, indexdef
      from pg_indexes
      where schemaname='public' and tablename='campaign_daily_stats'
    `;
    console.table(idx);

    await header("row count");
    const cnt = await sql`select count(*)::int as n from public.campaign_daily_stats`;
    console.log(cnt[0]);

    await header("min/max report_date");
    const mm = await sql`select min(report_date), max(report_date) from public.campaign_daily_stats`;
    console.log(mm[0]);

    await header("RLS policies");
    const pol = await sql`
      select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
      from pg_policy where polrelid = 'public.campaign_daily_stats'::regclass
    `;
    console.table(pol);

    await header("RLS enabled flag");
    const rls = await sql`select relrowsecurity, relforcerowsecurity from pg_class where oid='public.campaign_daily_stats'::regclass`;
    console.log(rls[0]);

    await header("sample rows (5)");
    const sample = await sql`select * from public.campaign_daily_stats order by report_date desc limit 5`;
    console.table(sample);

    await header("sibling tables row counts");
    const sibs = await sql`
      select
        (select count(*) from public.leads)::int as leads,
        (select count(*) from public.replies)::int as replies,
        (select count(*) from public.campaigns)::int as campaigns,
        (select count(*) from public.daily_stats)::int as daily_stats,
        (select count(*) from public.clients)::int as clients
    `;
    console.log(sibs[0]);

    await header("EXPLAIN ANALYZE select campaign_daily_stats ordered by report_date desc");
    const plan = await sql.unsafe(
      `explain (analyze, buffers, format text) select * from public.campaign_daily_stats order by report_date desc`,
    );
    for (const line of plan) console.log(line["QUERY PLAN"]);

    await header("check can_access_client helper");
    const helper = await sql`
      select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='can_access_client'
    `;
    if (helper.length === 0) console.log("can_access_client NOT FOUND");
    else console.log(helper[0].def);
  } catch (err) {
    console.error("DIAG FAILED:", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
