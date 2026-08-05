/**
 * Merge a duplicate lead into the one the pipeline owns, then delete the redundant row.
 *
 * Why merge rather than delete. In every pair measured on 2026-08-05 the redundant row carried
 * enrichment the surviving row lacked — company, job title, industry, website, phone source. It was
 * written by the 2026-07-22 sheet import, which enriched generously but never attached a reply; the
 * survivor came from `promote_contact_to_lead` and carries `origin_reply_id` and a sequencer contact
 * but almost no profile. Deleting outright would have thrown away the better half of the record.
 *
 * Which row survives is not a judgement call: it is the one holding `origin_reply_id`, because that
 * is what ties a lead to the reply that created it (ADR-0015) and what `uq_leads_origin_reply`
 * protects. Everything else is copied onto it.
 *
 * What is copied, and what deliberately is not:
 *
 *   contact attributes — name, job title, company, industry, headcount, website, country, phone,
 *     e-mail, LinkedIn. These describe a person and a company; they do not change meaning with time,
 *     so taking them from whichever row has them is always safe.
 *
 *   reply-scoped fields — message title, message number, response time, reply text. These describe
 *     ONE reply. The redundant row's copy belongs to a different reply, sometimes a year earlier, so
 *     they are refilled from the survivor's OWN reply instead of copied across.
 *
 *   campaign_id, external_id, external_blacklist_id — never copied. Campaign attribution feeds the
 *     metrics; carrying a 2025 campaign onto a 2026 lead would silently misattribute it.
 *
 *   outcome flags — OR'd, never overwritten. If either row records a meeting or a win, the merged
 *     lead keeps it.
 *
 * Usage:
 *   node scripts/sheets/merge-duplicate-leads.mjs --pairs <pairs.json> [--apply]
 *
 * pairs.json: [{ "client": "…", "keep": "<uuid>", "drop": "<uuid>" }]
 *
 * Without --apply everything runs inside `begin … rollback`. Requires SUPABASE_DB_URL.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

/** Safe to take from whichever row has a value: they describe the contact, not an engagement. */
const CONTACT_FIELDS = [
  "email", "first_name", "last_name", "job_title", "company_name", "linkedin_url",
  "gender", "phone_number", "phone_source", "industry", "headcount_range", "website", "country",
];

/** Set from the survivor's own reply, never copied from the row being dropped. */
const REPLY_FIELDS = ["message_title", "message_number", "reply_text"];

const OUTCOME_FLAGS = ["meeting_booked", "meeting_held", "offer_sent", "won"];

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
  let pairs = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--pairs") pairs = argv[i + 1], (i += 1);
  }
  if (!pairs) throw new Error("Pass --pairs <pairs.json>.");
  return { pairs, apply };
}

const empty = (v) => v === null || v === undefined || String(v).trim() === "";

async function main() {
  loadEnv();
  const { pairs: pairsPath, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not set.");
  const pairs = JSON.parse(readFileSync(pairsPath, "utf8"));

  const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: "require", max: 1 });
  try {
    await sql.begin(async (tx) => {
      let merged = 0;
      let skipped = 0;

      for (const { client, keep: keepId, drop: dropId } of pairs) {
        const [keep] = await tx`SELECT * FROM public.leads WHERE id = ${keepId}::uuid`;
        const [drop] = await tx`SELECT * FROM public.leads WHERE id = ${dropId}::uuid`;
        if (!keep || !drop) {
          console.log(`  SKIP  ${client}: one of the rows is already gone`);
          skipped += 1;
          continue;
        }
        // The survivor must be the row the RPC owns. If that is not true the pair was chosen wrong,
        // and guessing here would delete the only row tied to a reply.
        if (!keep.origin_reply_id) {
          console.log(`  SKIP  ${client}: the row marked keep has no origin_reply_id`);
          skipped += 1;
          continue;
        }
        // Children of the dropped row would vanish on delete (all cascade except replies, which
        // blocks). Refuse rather than discover it afterwards.
        const [{ blocking }] = await tx`
          SELECT (
            (SELECT count(*) FROM public.replies                 WHERE lead_id = ${dropId}::uuid) +
            (SELECT count(*) FROM public.lead_meetings           WHERE lead_id = ${dropId}::uuid) +
            (SELECT count(*) FROM public.lead_offers             WHERE lead_id = ${dropId}::uuid) +
            (SELECT count(*) FROM public.lead_tasks              WHERE lead_id = ${dropId}::uuid) +
            (SELECT count(*) FROM public.lead_custom_field_values WHERE lead_id = ${dropId}::uuid) +
            (SELECT count(*) FROM public.lead_value_deliveries   WHERE lead_id = ${dropId}::uuid)
          )::int AS blocking`;
        if (blocking > 0) {
          console.log(`  SKIP  ${client}: the row marked drop still has ${blocking} child record(s)`);
          skipped += 1;
          continue;
        }

        const patch = {};
        const moved = [];
        for (const f of CONTACT_FIELDS) {
          if (empty(keep[f]) && !empty(drop[f])) { patch[f] = drop[f]; moved.push(f); }
        }
        for (const f of OUTCOME_FLAGS) {
          if (!keep[f] && drop[f]) { patch[f] = true; moved.push(f); }
        }
        const notes = [keep.coldunicorn_note, drop.coldunicorn_note].filter((n) => !empty(n));
        if (notes.length > 1) { patch.coldunicorn_note = notes.join("\n---\n"); moved.push("coldunicorn_note"); }
        else if (empty(keep.coldunicorn_note) && notes.length === 1) { patch.coldunicorn_note = notes[0]; moved.push("coldunicorn_note"); }

        // Reply-scoped fields come from the survivor's own reply — the redundant row's copy belongs
        // to a different reply and would date the record wrong.
        const [own] = await tx`
          SELECT message_subject, sequence_step, message_text
            FROM public.replies WHERE id = ${keep.origin_reply_id}::uuid`;
        if (own) {
          if (empty(keep.message_title) && !empty(own.message_subject)) { patch.message_title = own.message_subject; moved.push("message_title←reply"); }
          if (empty(keep.message_number) && own.sequence_step != null) { patch.message_number = own.sequence_step; moved.push("message_number←reply"); }
          if (empty(keep.reply_text) && !empty(own.message_text)) { patch.reply_text = own.message_text; moved.push("reply_text←reply"); }
        }

        const keys = Object.keys(patch);
        console.log(`  ${client}: keep ${keepId.slice(0, 8)} · drop ${dropId.slice(0, 8)} · ${keys.length} field(s) — ${moved.join(", ") || "nothing to carry"}`);

        if (keys.length) {
          const sets = keys.map((k) => sql`${sql(k)} = ${patch[k]}`);
          let assignment = sets[0];
          for (let i = 1; i < sets.length; i += 1) assignment = sql`${assignment}, ${sets[i]}`;
          await tx`UPDATE public.leads SET ${assignment}, updated_at = now() WHERE id = ${keepId}::uuid`;
        }
        await tx`DELETE FROM public.leads WHERE id = ${dropId}::uuid`;
        merged += 1;
      }

      console.log(`\nmerged ${merged}, skipped ${skipped}`);
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
