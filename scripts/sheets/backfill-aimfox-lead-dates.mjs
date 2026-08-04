/**
 * Re-date Aimfox leads from the client workbook's `Leads!LEAD RECEIVED`.
 *
 * Why this exists. `aimfox-premql-to-pdca` wrote two different facts: the client sheet got the
 * date of the prospect's own conversation message, Supabase got `body.event.timestamp` — the
 * moment Aimfox delivered the webhook. Label events arrive in batches, so several unrelated
 * contacts share one `received_at` to the minute and a lead can land days after it answered.
 * `leads.created_at` is cut from that value ([20260727] promote_contact_to_lead), so every
 * DoD/WoW/MoM bucket inherited the drift. The workflow now takes the message date on both
 * branches; this script repairs the rows written before that.
 *
 * The sheet is the source of truth here — the decision was to converge on what the spreadsheets
 * already hold, not to re-derive dates from Aimfox. Nothing is inferred: a lead the sheet does
 * not contain is reported and skipped, never guessed.
 *
 * Usage:
 *   pnpm sheets:backfill-aimfox-dates --client "Bent Iron PL" --file ~/Downloads/BentIron.xlsx \
 *                                     [--client "Kaizen rent" --file ~/Downloads/Kaizen.xlsx] [--apply]
 *
 * Without --apply the UPDATEs run inside `begin … rollback`: the real statements, none of the
 * consequences. Requires SUPABASE_DB_URL (see docs/reference/local-supabase.md).
 */
import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import postgres from "postgres";

const AIMFOX_SEQUENCER = "00000000-0000-4000-a000-000000000003";

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
  const workbooks = [];
  let apply = false;
  let pendingClient = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--client") pendingClient = argv[(i += 1)];
    else if (argv[i] === "--file") {
      if (!pendingClient) throw new Error("--file must follow a --client");
      workbooks.push({ client: pendingClient, file: argv[(i += 1)].replace(/^~/, process.env.HOME ?? "~") });
      pendingClient = null;
    }
  }
  if (!workbooks.length) throw new Error('nothing to do: pass --client "<name>" --file <workbook.xlsx>');
  return { workbooks, apply };
}

/** Google serials and the several text shapes the client workbooks use, to a UTC calendar day. */
function toISODate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
  const text = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return text.slice(0, 10);
  // The workbooks are US-formatted (mm/dd/yyyy); a value above 12 in the first slot settles it.
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) {
    const [, a, b, y] = m;
    const [month, day] = Number(a) > 12 ? [b, a] : [a, b];
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function readSheetLeads(file) {
  const wb = XLSX.readFile(file);
  if (!wb.SheetNames.includes("Leads")) throw new Error(`${file}: no "Leads" tab`);
  return XLSX.utils
    .sheet_to_json(wb.Sheets.Leads, { defval: null, raw: true })
    .map((row, index) => ({
      row: index + 3,
      name: norm(row["FULL NAME"]),
      email: norm(row["E-MAIL"]),
      company: norm(row["COMPANY NAME"]),
      date: toISODate(row["LEAD RECEIVED"]),
    }))
    .filter((row) => row.name || row.email || row.company);
}

/** email → full name + company → full name alone. Ambiguity is reported, never resolved by guessing. */
function matchSheetRow(lead, sheetRows) {
  const candidates = (predicate) => sheetRows.filter(predicate);
  if (lead.email) {
    const byEmail = candidates((r) => r.email && r.email === lead.email);
    if (byEmail.length === 1) return { row: byEmail[0], via: "email" };
    if (byEmail.length > 1) return { ambiguous: byEmail.length, via: "email" };
  }
  const byNameCompany = candidates((r) => r.name && r.name === lead.name && r.company === lead.company);
  if (byNameCompany.length === 1) return { row: byNameCompany[0], via: "name+company" };
  if (byNameCompany.length > 1) return { ambiguous: byNameCompany.length, via: "name+company" };

  const byName = candidates((r) => r.name && r.name === lead.name);
  if (byName.length === 1) return { row: byName[0], via: "name" };
  if (byName.length > 1) return { ambiguous: byName.length, via: "name" };
  return { row: null };
}

async function main() {
  loadEnv();
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required (no hardcoded credentials).");
  const { workbooks, apply } = parseArgs(process.argv.slice(2));

  const sql = postgres(process.env.SUPABASE_DB_URL, { prepare: false, ssl: "require", max: 1, idle_timeout: 10 });
  const planned = [];
  const problems = [];

  try {
    for (const { client, file } of workbooks) {
      const [clientRow] = await sql`select id, name from clients where name = ${client}`;
      if (!clientRow) {
        problems.push({ client, kind: "unknown client", detail: "no clients row with that exact name" });
        continue;
      }
      const sheetRows = readSheetLeads(file);
      const leads = await sql`
        select l.id, l.created_at, l.first_name, l.last_name, l.company_name, l.email,
               r.id as reply_id, r.received_at
          from public.leads l
          join public.replies r on r.id = l.origin_reply_id
         where l.client_id = ${clientRow.id}
           and l.sequencer_id = ${AIMFOX_SEQUENCER}
         order by l.created_at`;

      for (const lead of leads) {
        const key = {
          email: norm(lead.email),
          name: norm([lead.first_name, lead.last_name].filter(Boolean).join(" ")),
          company: norm(lead.company_name),
        };
        const match = matchSheetRow(key, sheetRows);
        const label = `${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"} · ${lead.company_name ?? "—"}`;
        if (match.ambiguous) {
          problems.push({ client, kind: `ambiguous (${match.ambiguous} rows via ${match.via})`, detail: label });
          continue;
        }
        if (!match.row) {
          problems.push({ client, kind: "not in sheet", detail: label });
          continue;
        }
        if (!match.row.date) {
          problems.push({ client, kind: "sheet row has no LEAD RECEIVED", detail: label });
          continue;
        }
        const currentDay = lead.created_at.toISOString().slice(0, 10);
        if (currentDay === match.row.date) continue;
        planned.push({
          client,
          label,
          leadId: lead.id,
          replyId: lead.reply_id,
          from: currentDay,
          to: match.row.date,
          sheetRow: match.row.row,
          days: Math.round((Date.parse(`${currentDay}T00:00:00Z`) - Date.parse(`${match.row.date}T00:00:00Z`)) / 86400000),
        });
      }
    }

    console.log(`\n${planned.length} lead(s) to re-date, ${problems.length} row(s) to look at by hand.\n`);
    if (planned.length) {
      console.log("client          | supabase   -> sheet      | drift | lead");
      console.log("-".repeat(96));
      for (const p of planned) {
        console.log(
          `${p.client.padEnd(15)} | ${p.from} -> ${p.to} | ${String(p.days).padStart(4)}d | ${p.label} (sheet row ${p.sheetRow})`,
        );
      }
    }
    if (problems.length) {
      console.log("\nnot touched:");
      for (const p of problems) console.log(`  ${p.client.padEnd(15)} ${p.kind.padEnd(34)} ${p.detail}`);
    }

    if (!planned.length) return;

    // `created_at` and `received_at` move together: leaving them apart would let the next
    // re-derivation reintroduce the drift. The sheet carries a day, not a time — 00:00 UTC is the
    // neutral reading of it, and it is the same convention the 2026-07-22 lead import used.
    await sql.begin(async (tx) => {
      for (const p of planned) {
        await tx`update public.replies set received_at = ${`${p.to}T00:00:00Z`} where id = ${p.replyId}`;
        await tx`update public.leads   set created_at  = ${`${p.to}T00:00:00Z`} where id = ${p.leadId}`;
      }
      const [check] = await tx`
        select count(*)::int as still_off
          from public.leads l join public.replies r on r.id = l.origin_reply_id
         where l.id = any(${planned.map((p) => p.leadId)})
           and l.created_at::date <> r.received_at::date`;
      console.log(`\nin-transaction check: ${check.still_off} row(s) where lead and reply still disagree`);
      if (!apply) {
        console.log("dry run — rolling back. Re-run with --apply to keep it.");
        throw new ROLLBACK();
      }
      console.log(`applied: ${planned.length} lead(s) and their replies re-dated.`);
    });
  } catch (error) {
    if (!(error instanceof ROLLBACK)) throw error;
  } finally {
    await sql.end();
  }
}

class ROLLBACK extends Error {}

await main();
