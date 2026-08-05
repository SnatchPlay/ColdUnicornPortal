/**
 * Fill `leads.qualification` from the client workbook's `Leads!QUALIFICATION`, for leads where
 * Supabase holds NULL and the sheet holds a value the enum accepts.
 *
 * Why these rows are empty at all. `qualification` is an enum — `preMQL`, `MQL`,
 * `meeting_scheduled`, `meeting_held`, `offer_sent`, `won`, `rejected` — and the workbooks write
 * `PreMQL`, with a capital P. The 2026-07-22 sheet import could not cast that label, wrote NULL and
 * did not say so. A lead with a NULL qualification still counts in WoW and MoM Total (those are
 * `COUNT(*)`), but disappears from 3-DoD Total, which requires `MQL` or `preMQL`, and can never be
 * counted as SQL. So the row is half-visible: present in one metric, absent from the next.
 *
 * The sheet is the source of truth here — the value existed, only the cast failed.
 *
 * The plan comes from the read-only reconciliation probe, not from Google: this script never talks
 * to Sheets, so it can be re-run and reviewed without credentials. Feed it the probe's report.
 *
 * Usage:
 *   node scripts/sheets/backfill-lead-qualification.mjs --plan <report.json> [--apply]
 *
 * Without --apply the UPDATEs run inside `begin … rollback`: the real statements, none of the
 * consequences. Requires SUPABASE_DB_URL (see docs/reference/local-supabase.md).
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

/** The exact labels `lead_qualification` accepts. Anything else is reported, never coerced. */
const ENUM = new Map([
  ["premql", "preMQL"],
  ["mql", "MQL"],
  ["meeting_scheduled", "meeting_scheduled"],
  ["meeting_held", "meeting_held"],
  ["offer_sent", "offer_sent"],
  ["won", "won"],
  ["rejected", "rejected"],
]);

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
  let plan = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--plan") plan = argv[i + 1], (i += 1);
  }
  if (!plan) throw new Error("Pass --plan <report.json> from the reconciliation probe.");
  return { plan, apply };
}

/**
 * A tab whose column I is not LEAD RECEIVED has a different layout, and CS PDCA reads that column
 * positionally — so for those clients the sheet's own numbers come from the wrong field. Their
 * QUALIFICATION column cannot be trusted either, and they are skipped rather than written from.
 */
function comparableClients(report) {
  const skipped = [];
  const usable = [];
  for (const c of report.per_client) {
    if (c.col_i === "LEAD RECEIVED" && c.col_n === "QUALIFICATION") usable.push(c);
    else skipped.push(c.client);
  }
  return { usable, skipped };
}

function buildPlan(report) {
  const { usable, skipped } = comparableClients(report);
  const write = [];
  const blocked = [];
  for (const client of usable) {
    for (const row of client.qual_differs ?? []) {
      if (row.db_q !== null) continue; // a disagreement, not an empty field — out of scope here
      if (!row.lead_id) continue;
      const label = ENUM.get(String(row.sheet_q ?? "").trim().toLowerCase());
      const target = { client: client.client, ...row, set: label ?? null };
      if (label) write.push(target);
      else blocked.push(target);
    }
  }
  return { write, blocked, skipped };
}

async function main() {
  loadEnv();
  const { plan: planPath, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not set.");

  const report = JSON.parse(readFileSync(planPath, "utf8"));
  const { write, blocked, skipped } = buildPlan(report);

  console.log(`plan: ${write.length} leads to fill, ${blocked.length} blocked, ${skipped.length} clients skipped`);
  if (skipped.length) console.log(`  skipped (tab layout differs): ${skipped.join(", ")}`);
  for (const b of blocked) {
    console.log(`  BLOCKED  ${b.client} · ${b.name ?? "—"} · sheet says "${b.sheet_q}" — no such enum label`);
  }
  if (!write.length) {
    console.log("nothing to do.");
    return;
  }

  const byLabel = new Map();
  for (const w of write) byLabel.set(w.set, (byLabel.get(w.set) ?? 0) + 1);
  console.log(`  writing: ${[...byLabel].map(([k, v]) => `${v} × ${k}`).join(", ")}`);

  const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: "require", max: 1 });
  try {
    await sql.begin(async (tx) => {
      let filled = 0;
      let moved = 0; // a lead whose qualification stopped being NULL since the probe ran
      for (const w of write) {
        // The NULL guard is the whole safety story: it makes the write idempotent AND refuses to
        // overwrite a value somebody set between the probe and this run.
        const done = await tx`
          UPDATE public.leads
             SET qualification = ${w.set}::public.lead_qualification, updated_at = now()
           WHERE id = ${w.lead_id}::uuid AND qualification IS NULL
          RETURNING id`;
        if (done.length) filled += 1;
        else moved += 1;
      }
      const remaining = await tx`
        SELECT count(*)::int AS n FROM public.leads
         WHERE id = ANY(${write.map((w) => w.lead_id)}::uuid[]) AND qualification IS NULL`;

      console.log(`\nfilled ${filled}, already set ${moved}, still NULL ${remaining[0].n}`);
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
