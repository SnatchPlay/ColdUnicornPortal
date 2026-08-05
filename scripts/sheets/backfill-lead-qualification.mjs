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
  let align = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--align") align = true;
    else if (argv[i] === "--plan") plan = argv[i + 1], (i += 1);
  }
  if (!plan) throw new Error("Pass --plan <report.json> from the reconciliation probe.");
  return { plan, apply, align };
}

/**
 * Which clients may be written from.
 *
 * This used to skip any tab whose column I was not headed `LEAD RECEIVED`, on the theory that such
 * a tab held its data somewhere else. That was wrong, and it excluded RevOpsi and Spiree from every
 * repair for no reason. Their DATA sits in the standard positions — column I really is the date,
 * column N really is the qualification — but their HEADER row is missing `Phone Number` and
 * `Phone Source`, so every label is two columns left of what it names. The probe reads raw values
 * by position now, exactly as `COUNTIFS` does, so the header label is a diagnostic and never a gate.
 *
 * What does disqualify a client is having produced no rows at all — an unreadable tab must not be
 * read as "this client has nothing", and the probe reports those separately.
 */
function comparableClients(report) {
  const skipped = [];
  const usable = [];
  for (const c of report.per_client) {
    if (c.read_error) skipped.push(`${c.client} (${c.read_error})`);
    else usable.push(c);
  }
  return { usable, skipped };
}

/**
 * Two kinds of row, and they are not the same decision.
 *
 * `fill` — Supabase holds NULL, the sheet holds a value. Nothing is being overruled; a value that
 * was always meant to be there is being restored.
 *
 * `align` — both sides hold a value and they differ. Writing one over the other says the sheet is
 * the source of truth for a lead's stage, which is a business call (ADR-0017 phase A: the agency
 * still runs on the workbooks). It is opt-in behind --align for that reason.
 *
 * Only MQL <-> preMQL is ever aligned. A lead that reached meeting_scheduled, offer_sent, won or
 * rejected is left alone: those stages come from the portal, not from a sequencer tag, and the
 * sheet has no business demoting them. Same guard the 20260805 migration puts in the RPC.
 */
const ALIGNABLE = new Set(["MQL", "preMQL"]);

function buildPlan(report, align) {
  const { usable, skipped } = comparableClients(report);
  const write = [];
  const blocked = [];
  const heldBack = [];
  for (const client of usable) {
    for (const row of client.qual_differs ?? []) {
      if (!row.lead_id) continue;
      const label = ENUM.get(String(row.sheet_q ?? "").trim().toLowerCase());
      const target = { client: client.client, ...row, set: label ?? null, kind: row.db_q === null ? "fill" : "align" };
      if (!label) {
        blocked.push(target);
        continue;
      }
      if (target.kind === "align") {
        if (!align) continue;
        if (!ALIGNABLE.has(row.db_q) || !ALIGNABLE.has(label)) {
          heldBack.push(target);
          continue;
        }
      }
      write.push(target);
    }
  }
  return { write, blocked, heldBack, skipped };
}

async function main() {
  loadEnv();
  const { plan: planPath, apply, align } = parseArgs(process.argv.slice(2));
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not set.");

  const report = JSON.parse(readFileSync(planPath, "utf8"));
  const { write, blocked, heldBack, skipped } = buildPlan(report, align);
  const fills = write.filter((w) => w.kind === "fill");
  const aligns = write.filter((w) => w.kind === "align");

  console.log(`plan: ${fills.length} to fill, ${aligns.length} to align${align ? "" : " (--align not passed)"}, `
    + `${blocked.length} blocked, ${skipped.length} clients skipped`);
  if (skipped.length) console.log(`  skipped (tab layout differs): ${skipped.join(", ")}`);
  for (const b of blocked) {
    console.log(`  BLOCKED  ${b.client} · ${b.name ?? "—"} · sheet says "${b.sheet_q}" — no such enum label`);
  }
  for (const h of heldBack) {
    console.log(`  HELD     ${h.client} · ${h.name ?? "—"} · ${h.db_q} here vs "${h.sheet_q}" in the sheet `
      + `— past the MQL/preMQL stage, not the sheet's to change`);
  }
  if (!write.length) {
    console.log("nothing to do.");
    return;
  }

  const byMove = new Map();
  for (const w of write) {
    const key = w.kind === "fill" ? `(empty) → ${w.set}` : `${w.db_q} → ${w.set}`;
    byMove.set(key, (byMove.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...byMove].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)} × ${k}`);

  const sql = postgres(process.env.SUPABASE_DB_URL, { ssl: "require", max: 1 });
  try {
    await sql.begin(async (tx) => {
      let written = 0;
      let stale = 0; // the row moved between the probe and this run — left alone, reported
      for (const w of write) {
        // The predicate is the whole safety story. It makes each write idempotent and refuses to
        // act on a row that changed since the probe read it: a fill only touches a still-empty
        // field, an align only moves a lead still sitting on the value the probe saw.
        const done = w.kind === "fill"
          ? await tx`
              UPDATE public.leads
                 SET qualification = ${w.set}::public.lead_qualification, updated_at = now()
               WHERE id = ${w.lead_id}::uuid AND qualification IS NULL
              RETURNING id`
          : await tx`
              UPDATE public.leads
                 SET qualification = ${w.set}::public.lead_qualification, updated_at = now()
               WHERE id = ${w.lead_id}::uuid AND qualification::text = ${w.db_q}
              RETURNING id`;
        if (done.length) written += 1;
        else stale += 1;
      }
      console.log(`\nwritten ${written}, skipped as stale ${stale}`);
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
