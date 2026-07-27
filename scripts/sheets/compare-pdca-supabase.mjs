/**
 * Diff a `🤖Daily stats` extract against Supabase `daily_stats`, cell by cell.
 *
 * ADR-0017 requires a dual-write to declare its reconciliation. This is the per-cell half of it:
 * the sheet's Apps Script and the n8n `bison-daily-stats-process` worker call the *same* Bison
 * endpoints independently, so a disagreement is evidence about *when* each snapshot was taken,
 * not about which store is authoritative.
 *
 * Usage:
 *   pnpm sheets:compare [--snapshot 2026-07-27] [--client UniTalk] [--from 2026-07-01] [--to 2026-07-27]
 *
 * Requires SUPABASE_DB_URL (read-only queries; see docs/reference/local-supabase.md).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXTRACTS = resolve(REPO_ROOT, "automation/sheets/pdca/extracts");

/**
 * Sheet header -> `daily_stats` column. Deliberately partial: only the columns both stores claim
 * to hold the same fact about.
 *
 * `Prospects Count` maps to `prospects_total`, not `prospects_count`. Both are the *cumulative*
 * month-to-date Bison lead count; `daily_stats.prospects_count` is a derived day-delta the sheet
 * has no counterpart for. `Out of Office` maps to `ooo_count`, which — in both stores — holds an
 * automated-replies delta and not OOO at all (see the FORMULAS.md defect table).
 */
const FIELD_MAP = [
  ["E-DMS", "emails_sent"],
  ["Response Count", "response_count"],
  ["Bounce count", "bounce_count"],
  ["Inboxes", "inboxes_count"],
  ["Prospects Count", "prospects_total"],
  ["Human Replies", "human_replies_count"],
  ["Human Replies Accumulated", "human_replies_total"],
  ["Out of Office", "ooo_count"],
  ["Out of Office Accumulated", "automated_replies_total"],
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function latestSnapshot() {
  const dirs = readdirSync(EXTRACTS).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dirs.length) throw new Error(`No extracts in ${EXTRACTS} — run pnpm sheets:extract first.`);
  return dirs[dirs.length - 1];
}

/** Minimal RFC-4180 reader: the extractor is the only writer, and it quotes with doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

function loadSheetRows(snapshot) {
  const raw = parseCsv(readFileSync(resolve(EXTRACTS, snapshot, "daily-stats.csv"), "utf8"));
  const header = raw[0];
  const idx = (name) => header.indexOf(name);
  return raw.slice(1).map((r) => {
    const rec = {
      workspace: String(r[idx("Client")] ?? "").trim(),
      date: String(r[idx("Date")] ?? "").slice(0, 10),
      sequencer: String(r[idx("Sequencer")] ?? "").trim(),
    };
    for (const [sheetCol] of FIELD_MAP) rec[sheetCol] = num(r[idx(sheetCol)]);
    return rec;
  }).filter((r) => r.workspace && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.sequencer === "Bizon");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = args.snapshot ?? latestSnapshot();
  const from = args.from ?? "2026-01-01";
  const to = args.to ?? snapshot;

  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    console.error("SUPABASE_DB_URL is required.");
    process.exit(1);
  }
  const sql = postgres(url, { prepare: false, ssl: /@(localhost|127\.0\.0\.1)/.test(url) ? false : "require", max: 1 });

  try {
    const db = await sql`
      SELECT cs.external_workspace_id AS workspace,
             to_char(d.report_date, 'YYYY-MM-DD') AS date,
             d.emails_sent, d.response_count, d.bounce_count, d.inboxes_count,
             d.prospects_total, d.human_replies_count, d.human_replies_total,
             d.ooo_count, d.automated_replies_total,
             c.name AS client
        FROM daily_stats d
        JOIN clients c ON c.id = d.client_id
        JOIN client_sequencers cs ON cs.client_id = d.client_id
        JOIN sequencers s ON s.id = cs.sequencer_id AND s.key = 'emailbison'
       WHERE d.report_date BETWEEN ${from}::date AND ${to}::date
    `;

    const dbByKey = new Map(db.map((r) => [`${r.workspace}__${r.date}`, r]));
    const nameByWorkspace = new Map(db.map((r) => [r.workspace, r.client]));

    const sheet = loadSheetRows(snapshot)
      .filter((r) => r.date >= from && r.date <= to)
      .filter((r) => !args.client || (nameByWorkspace.get(r.workspace) ?? "").toLowerCase().includes(args.client.toLowerCase()));

    const diffs = [];
    let compared = 0;
    let sheetOnly = 0;
    for (const s of sheet) {
      const d = dbByKey.get(`${s.workspace}__${s.date}`);
      if (!d) { sheetOnly += 1; continue; }
      compared += 1;
      for (const [sheetCol, dbCol] of FIELD_MAP) {
        const a = s[sheetCol];
        const b = d[dbCol] === null ? null : Number(d[dbCol]);
        if (a === null || b === null || a === b) continue;
        diffs.push({ client: d.client, date: s.date, field: dbCol, sheet: a, supabase: b, delta: b - a });
      }
    }

    console.log(`snapshot ${snapshot} · window ${from}..${to}${args.client ? ` · client ~${args.client}` : ""}`);
    console.log(`compared ${compared} (workspace, date) pairs · ${sheetOnly} sheet rows with no Supabase row · ${diffs.length} cell disagreements\n`);

    const byField = new Map();
    for (const d of diffs) byField.set(d.field, (byField.get(d.field) ?? 0) + 1);
    console.log("disagreements by field:");
    for (const [f, n] of [...byField].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${f.padEnd(24)} ${n}`);
    }

    const shown = diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, Number(args.top ?? 25));
    if (shown.length) {
      console.log(`\ntop ${shown.length} by magnitude:`);
      console.log(`${"client".padEnd(18)}${"date".padEnd(12)}${"field".padEnd(24)}${"sheet".padStart(9)}${"supabase".padStart(10)}${"delta".padStart(8)}`);
      for (const d of shown) {
        console.log(
          d.client.slice(0, 17).padEnd(18) + d.date.padEnd(12) + d.field.padEnd(24) +
          String(d.sheet).padStart(9) + String(d.supabase).padStart(10) + String(d.delta > 0 ? `+${d.delta}` : d.delta).padStart(8),
        );
      }
    }
  } finally {
    await sql.end();
  }
}

await main();
