/**
 * Backfill `leads.linkedin_url` and `leads.country` for Aimfox leads from the Aimfox lead profile.
 *
 * Why this exists. `aimfox-premql-to-pdca` branch S fetched the whole Aimfox profile and passed
 * seven of the fourteen fields `promote_contact_to_lead` accepts; `linkedin_url` and `country` were
 * fetched and dropped. The workflow was fixed on 2026-08-05, but the RPC sets those columns on
 * INSERT only, so the rows written before that keep their NULLs and a replay does not repair them.
 * Measured that day: 0 of 60 branch-S leads had a LinkedIn URL, against 30 of 30 for the Aimfox
 * leads that came in from Sheets.
 *
 * Nothing is inferred. The two values are derived by the SAME rules the workflow uses:
 *   linkedin_url = https://www.linkedin.com/in/{lead.public_identifier}
 *   country      = lead.location.name, last comma segment (the whole string when it has no comma —
 *                  branch L's own rule, so real rows can read "Warsaw Metropolitan Area")
 * A lead whose profile Aimfox no longer returns is reported and skipped, never guessed. Existing
 * non-NULL values are never overwritten.
 *
 * Usage:
 *   pnpm aimfox:backfill-profile-fields [--client "<name>"] [--limit N] [--apply]
 *
 * Without --apply the UPDATEs run inside `begin … rollback`: the real statements, none of the
 * consequences. Requires SUPABASE_DB_URL (see docs/reference/local-supabase.md); the per-client
 * Aimfox token comes from `client_sequencers.api_key`.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const AIMFOX_SEQUENCER = "00000000-0000-4000-a000-000000000003";
const AIMFOX_API = "https://api.aimfox.com/api/v2";

function loadEnv() {
  if (process.env.SUPABASE_DB_URL) return;
  try {
    for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (m) process.env[m[1]] ??= m[2].trim();
    }
  } catch {
    /* env file is optional — the variable may come from the shell */
  }
}

function parseArgs(argv) {
  const opts = { apply: false, client: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") opts.apply = true;
    else if (argv[i] === "--client") opts.client = argv[(i += 1)];
    else if (argv[i] === "--limit") opts.limit = Number(argv[(i += 1)]);
  }
  return opts;
}

/** The workflow's rule, verbatim: last comma segment, or the whole string when there is no comma. */
function countryFrom(lead) {
  const loc = String(lead?.location?.name ?? "").trim();
  if (!loc) return null;
  return loc.includes(",") ? loc.split(",").pop().trim() : loc;
}

function linkedinFrom(lead) {
  const id = lead?.public_identifier;
  return id ? `https://www.linkedin.com/in/${id}` : null;
}

async function fetchLead(token, externalId) {
  const res = await fetch(`${AIMFOX_API}/leads/${externalId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const body = await res.json();
  return body?.lead ? { lead: body.lead } : { error: "no lead in response" };
}

async function main() {
  loadEnv();
  const { apply, client, limit } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required");

  const sql = postgres(process.env.SUPABASE_DB_URL, { prepare: false, ssl: "require" });
  try {
    const rows = await sql`
      select l.id, l.external_id, l.linkedin_url, l.country, c.name as client_name,
             cs.api_key
        from public.leads l
        join public.clients c on c.id = l.client_id
        left join public.client_sequencers cs
               on cs.client_id = l.client_id
              and cs.sequencer_id = ${AIMFOX_SEQUENCER}
              and cs.enabled
       where l.sequencer_id = ${AIMFOX_SEQUENCER}
         and (l.linkedin_url is null or l.country is null)
         and coalesce(l.external_id, '') <> ''
         and (${client}::text is null or c.name = ${client})
       order by l.created_at
       ${limit ? sql`limit ${limit}` : sql``}`;

    console.log(`${rows.length} Aimfox lead(s) missing linkedin_url and/or country`
      + (client ? ` for client "${client}"` : "") + ".\n");

    const plan = [];
    const skipped = [];
    for (const row of rows) {
      if (!row.api_key) { skipped.push({ id: row.id, why: "client has no enabled Aimfox api_key" }); continue; }
      const { lead, error } = await fetchLead(row.api_key, row.external_id);
      if (error) { skipped.push({ id: row.id, why: `Aimfox ${row.external_id}: ${error}` }); continue; }

      // Never overwrite a value that is already there.
      const linkedin = row.linkedin_url ?? linkedinFrom(lead);
      const country = row.country ?? countryFrom(lead);
      if (linkedin === row.linkedin_url && country === row.country) {
        skipped.push({ id: row.id, why: "profile carries neither field" });
        continue;
      }
      plan.push({ id: row.id, client: row.client_name, external_id: row.external_id, linkedin, country });
      console.log(`${row.client_name.padEnd(18)} ${row.external_id.padEnd(12)} `
        + `linkedin=${linkedin ?? "—"}  country=${country ?? "—"}`);
    }

    if (skipped.length) {
      console.log(`\n${skipped.length} skipped:`);
      for (const s of skipped) console.log(`  ${s.id}  ${s.why}`);
    }
    if (!plan.length) { console.log("\nNothing to write."); return; }

    await sql.begin(async (tx) => {
      for (const p of plan) {
        await tx`update public.leads
                    set linkedin_url = coalesce(linkedin_url, ${p.linkedin}),
                        country      = coalesce(country,      ${p.country}),
                        updated_at   = now()
                  where id = ${p.id}`;
      }
      const [check] = await tx`select count(*)::int as n from public.leads
                                where id = any(${plan.map((p) => p.id)})
                                  and linkedin_url is null`;
      console.log(`\n${plan.length} row(s) updated; ${check.n} still without a LinkedIn URL.`);
      if (!apply) throw new Error("ROLLBACK");
    }).catch((e) => {
      if (e.message === "ROLLBACK") console.log("DRY RUN — rolled back. Re-run with --apply to keep it.");
      else throw e;
    });

    if (apply) console.log("Applied.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
