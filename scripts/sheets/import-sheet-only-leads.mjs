/**
 * Create the leads that exist in a client's `Leads` tab but not in Supabase, by synthesising the
 * `sequencer_contacts` + `replies` pair the RPC contract requires.
 *
 * This is an exception to [ADR-0015](../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md),
 * taken deliberately on 2026-08-05 and recorded rather than hidden. The ADR says a lead is created
 * by a positive reply, at most one per contact. A historical sheet row has no reply to attach, so
 * the reconciliation left these rows alone for weeks. The decision was to place a **placeholder**
 * reply now and pull the real one from the sequencer later.
 *
 * Everything synthetic is therefore marked so it can be found and replaced, never mistaken for
 * ingested truth:
 *
 *   `sequencer_contacts.external_contact_id` = `sheet-import:<client>:<key>`
 *   `replies.external_id`                    = `sheet-import:<client>:<key>`
 *   `replies.message_text`                   = a sentence saying exactly what it is
 *
 * so one predicate finds every one of them:
 *
 *   select * from public.replies where external_id like 'sheet-import:%';
 *
 * The ids are deterministic — e-mail when there is one, otherwise a slug of name and company — so
 * the RPCs' own upsert semantics make a second run a no-op rather than a second lead.
 *
 * `received_at` is the sheet's `LEAD RECEIVED` at noon UTC. Noon, not midnight, so no timezone
 * rounding can move `leads.created_at` — which is cut from `received_at` — into the adjacent day
 * and land the lead in the wrong DoD/WoW bucket.
 *
 * Usage:
 *   node scripts/sheets/import-sheet-only-leads.mjs --plan <report.json> [--apply]
 *
 * Without --apply everything runs inside `begin … rollback`. Requires SUPABASE_DB_URL.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PLACEHOLDER_TEXT =
  "[placeholder] Synthesised on 2026-08-05 so a lead present in the client's Leads tab could exist "
  + "in Supabase. Not an ingested reply. Replace with the real message when it is pulled from the "
  + "sequencer; find these with external_id like 'sheet-import:%'.";

function loadEnv() {
  if (process.env.SUPABASE_DB_URL) return;
  try {
    for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (m) process.env[m[1]] ??= m[2].trim();
    }
  } catch {
    /* env file is optional */
  }
}

function parseArgs(argv) {
  let plan = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--plan") plan = argv[i + 1], (i += 1);
  }
  if (!plan) throw new Error("Pass --plan <report.json> from the reconciliation probe.");
  return { plan, apply };
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** "Anna Maciejczyk-Janik" -> first "Anna", last "Maciejczyk-Janik". A single token is the last name. */
function splitName(full) {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: null, last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function main() {
  loadEnv();
  const { plan: planPath, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not set.");

  const report = JSON.parse(readFileSync(planPath, "utf8"));
  const targets = [];
  for (const client of report.per_client) {
    for (const row of client.only_in_sheet ?? []) {
      if (!row.date) continue; // no date means the sheet does not count it either — nothing to reconcile
      targets.push({ client: client.client, ...row });
    }
  }
  if (!targets.length) {
    console.log("nothing to do.");
    return;
  }

  const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: "require", max: 1 });
  try {
    await sql.begin(async (tx) => {
      let created = 0;
      let existed = 0;
      let skipped = 0;

      for (const t of targets) {
        // Channel: the sheet carries no marker. A Bison lead always has an e-mail, an Aimfox lead
        // usually has none, so a missing e-mail picks Aimfox when the client runs it. The choice is
        // printed for every row because it decides which sequencer the lead is attributed to.
        const wanted = t.email ? "emailbison" : "aimfox";
        const [cs] = await tx`
          SELECT cs.id::text AS id, s.key
            FROM public.client_sequencers cs
            JOIN public.clients c    ON c.id = cs.client_id
            JOIN public.sequencers s ON s.id = cs.sequencer_id
           WHERE c.name = ${t.client}
           ORDER BY (s.key = ${wanted}) DESC, s.key
           LIMIT 1`;
        if (!cs) {
          console.log(`  SKIP  ${t.client} · ${t.raw_name ?? t.name}: no client_sequencer`);
          skipped += 1;
          continue;
        }

        const key = t.email ? slug(t.email) : `${slug(t.raw_name ?? t.name)}-${slug(t.raw_company ?? t.company)}`;
        const externalId = `sheet-import:${slug(t.client)}:${key}`;
        const { first, last } = splitName(t.raw_name ?? t.name);

        const [contact] = await tx`
          SELECT public.upsert_sequencer_contact(
            ${cs.id}::uuid, ${externalId}, ${t.email ?? null}, ${first}, ${last}) AS id`;
        const contactId = contact.id;

        const [reply] = await tx`
          SELECT public.upsert_reply(
            ${externalId}, ${`${t.date}T12:00:00Z`}::timestamptz, ${contactId}::uuid, NULL,
            'Interested', NULL, ${PLACEHOLDER_TEXT}, false, ${t.email ?? null}, NULL) AS id`;
        const replyId = reply.id;

        const [promoted] = await tx`
          SELECT public.promote_contact_to_lead(
            ${contactId}::uuid, ${replyId}::uuid, NULL,
            jsonb_strip_nulls(jsonb_build_object(
              'email',         ${t.email ?? null}::text,
              'first_name',    ${first}::text,
              'last_name',     ${last}::text,
              'company_name',  ${t.raw_company ?? t.company ?? null}::text,
              'qualification', ${t.q ?? null}::text
            ))) AS result`;
        const result = promoted.result;

        console.log(`  ${result.created ? "CREATE" : "exists"}  ${t.client} · ${t.raw_name ?? t.name} · ${t.date} · ${t.q} · ${cs.key}`);
        if (result.created) created += 1;
        else existed += 1;
      }

      console.log(`\ncreated ${created}, already present ${existed}, skipped ${skipped}`);
      if (!apply) {
        console.log("dry run — rolling back. Re-run with --apply to keep it.");
        throw new Error("__rollback__");
      }
      console.log("applied.");
    });
  } catch (error) {
    if (error?.message !== "__rollback__") throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
