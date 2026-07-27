/**
 * Extract redacted artifacts from a `GHEADS | PDCA` workbook export.
 *
 * The workbook is the agency's operational source of truth during the Sheets->Supabase
 * transition (ADR-0017). It may NEVER be committed: `CS PDCA` column F holds a live Bison
 * API key per client. This script emits only what a reviewer needs to reason about the
 * formulas -- values and formula templates, never column F.
 *
 * Usage:
 *   pnpm sheets:extract "~/Downloads/GHEADS _ PDCA.xlsx" [--snapshot 2026-07-27]
 *
 * Writes automation/sheets/pdca/extracts/<snapshot>/{cs-pdca.csv,daily-stats.csv,formulas.md}.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * CS PDCA is an **allowlist**, never a denylist: the tab carries a live Bison bearer token per
 * client (F), a CRM webhook URL with an embedded token (CY), a LinkedIn API key (DA), and
 * contact phone numbers and e-mail addresses (CV, CW, DM, DO). Enumerating secrets to drop is
 * how one leaks the next column somebody adds. We emit only the identity and metric columns:
 *
 *   A  Customer Name        C  Smartlead ID       E  Bison Workspace ID   G  Client Status
 *   N..CU  Inboxes, the prospects block, and the DoD / 3-DoD / WoW / MoM metric blocks
 *
 * Everything else — D (spreadsheet id), F, and CV onward — never leaves this script.
 */
const CS_KEEP_COLUMNS = ["A", "C", "E", "G"];
const CS_KEEP_RANGE = { from: "N", to: "CU" };

const SHEET_CS = "CS PDCA";
const SHEET_DAILY = "\u{1F916}Daily stats";

/** Header rows in CS PDCA: 1 = group, 2 = label, 3 = bucket. Client rows start at 4. */
const CS_HEADER_ROWS = 3;

function parseArgs(argv) {
  const positional = [];
  let snapshot = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--snapshot") {
      snapshot = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  return { input: positional[0], snapshot };
}

function colLetter(index) {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/**
 * Google-Sheets-only functions (FILTER, IMPORTRANGE, LET, ...) survive an .xlsx export wrapped
 * in `__xludf.DUMMYFUNCTION("...")` with the real formula as a string literal, split across
 * `"&"` concatenations and with `""` for every quote. Unwrap back to the Apps-Script-visible form.
 */
function unwrapDummyFunction(formula) {
  if (!formula || !formula.includes("__xludf.DUMMYFUNCTION")) return formula ?? "";
  const start = formula.indexOf('DUMMYFUNCTION("');
  if (start === -1) return formula;
  let i = start + 'DUMMYFUNCTION("'.length;
  let out = "";
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      if (formula[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      // End of a literal. `"&"` splices the next chunk; anything else ends the wrapper.
      const rest = formula.slice(i + 1);
      const splice = rest.match(/^\s*&\s*"/);
      if (splice) {
        i += 1 + splice[0].length;
        continue;
      }
      break;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function colIndex(letter) {
  return letter.split("").reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

/** Column indices the CS PDCA extract is allowed to emit. */
function csAllowedColumns() {
  const allowed = new Set(CS_KEEP_COLUMNS.map(colIndex));
  for (let c = colIndex(CS_KEEP_RANGE.from); c <= colIndex(CS_KEEP_RANGE.to); c += 1) allowed.add(c);
  return allowed;
}

function cellsOf(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  return { range, at: (r, c) => sheet[XLSX.utils.encode_cell({ r, c })] };
}

function toCsv(rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

/**
 * A sheet date is a whole-day serial, but SheetJS converts it through a float and lands a few
 * seconds off local midnight — `2026-07-02` materialises as `Jul 01 2026 23:59:56 GMT+0300`.
 * Reading the local (or worse, the UTC) components off that Date silently shifts the whole
 * extract back one day. Shift to a UTC-midnight frame, round to the nearest whole day, format.
 */
function formatSheetDate(d) {
  const localMs = d.getTime() - d.getTimezoneOffset() * 60_000;
  const midnight = new Date(Math.round(localMs / 86_400_000) * 86_400_000);
  return midnight.toISOString().slice(0, 10);
}

function formatValue(cell) {
  if (!cell) return "";
  if (cell.t === "d" && cell.v instanceof Date) return formatSheetDate(cell.v);
  return cell.v ?? "";
}

/** Values-only dump of a sheet. `allowed`, when given, restricts which columns are emitted. */
function dumpSheet(sheet, { allowed = null } = {}) {
  const { range, at } = cellsOf(sheet);
  const columns = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    if (!allowed || allowed.has(c)) columns.push(c);
  }
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = columns.map((c) => formatValue(at(r, c)));
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return { rows, header: columns.map(colLetter) };
}

/**
 * One formula template per column. Every client row carries the same formula modulo its row
 * number, so the first data row that has one is representative — emitting 40 near-identical
 * copies would bury the signal.
 */
function extractFormulas(sheet, firstDataRow, allowed) {
  const { range, at } = cellsOf(sheet);
  const out = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const letter = colLetter(c);
    if (!allowed.has(c)) continue;
    for (let r = firstDataRow - 1; r <= Math.min(range.e.r, firstDataRow + 40); r += 1) {
      const cell = at(r, c);
      if (!cell?.f) continue;
      out.push({
        column: letter,
        row: r + 1,
        group: formatValue(at(0, c)) || "",
        label: formatValue(at(1, c)) || "",
        bucket: formatValue(at(2, c)) || "",
        formula: unwrapDummyFunction(cell.f).trim(),
      });
      break;
    }
  }
  return out;
}

function renderFormulasDoc(snapshot, formulas) {
  const lines = [
    `# CS PDCA — formula templates (snapshot ${snapshot})`,
    "",
    "Generated by `pnpm sheets:extract`. **Do not hand-edit.**",
    "",
    "One entry per column, taken from the first client row that carries a formula; every other",
    "client row is the same formula with its own row number. Google-Sheets-only functions are",
    "unwrapped from the `__xludf.DUMMYFUNCTION` envelope the .xlsx export puts them in.",
    "",
  ];
  for (const f of formulas) {
    const heading = [f.group, f.label, f.bucket].filter(Boolean).join(" · ") || "(unlabelled)";
    lines.push(`## ${f.column} — ${heading}`, "", "```", f.formula, "```", "");
  }
  return lines.join("\n");
}

function main() {
  const { input, snapshot: snapshotArg } = parseArgs(process.argv.slice(2));
  if (!input) {
    console.error('Usage: pnpm sheets:extract "<path to GHEADS _ PDCA.xlsx>" [--snapshot YYYY-MM-DD]');
    process.exit(1);
  }
  const inputPath = input.replace(/^~/, process.env.HOME ?? "~");
  const snapshot = snapshotArg ?? new Date().toISOString().slice(0, 10);

  const wb = XLSX.readFile(inputPath, { cellFormula: true, cellDates: true });
  for (const name of [SHEET_CS, SHEET_DAILY]) {
    if (!wb.Sheets[name]) {
      console.error(`Workbook has no "${name}" tab. Found: ${wb.SheetNames.join(", ")}`);
      process.exit(1);
    }
  }

  const outDir = resolve(REPO_ROOT, "automation/sheets/pdca/extracts", snapshot);
  mkdirSync(outDir, { recursive: true });

  const allowed = csAllowedColumns();
  const cs = dumpSheet(wb.Sheets[SHEET_CS], { allowed });
  writeFileSync(resolve(outDir, "cs-pdca.csv"), toCsv([cs.header, ...cs.rows]));

  const daily = dumpSheet(wb.Sheets[SHEET_DAILY]);
  writeFileSync(resolve(outDir, "daily-stats.csv"), toCsv(daily.rows));

  const formulas = extractFormulas(wb.Sheets[SHEET_CS], CS_HEADER_ROWS + 1, allowed);
  writeFileSync(resolve(outDir, "formulas.md"), renderFormulasDoc(snapshot, formulas));

  console.log(`snapshot ${snapshot} -> automation/sheets/pdca/extracts/${snapshot}/`);
  console.log(`  cs-pdca.csv      ${cs.rows.length} rows x ${cs.header.length} allowed columns`);
  console.log(`  daily-stats.csv  ${daily.rows.length} rows`);
  console.log(`  formulas.md      ${formulas.length} columns`);
}

main();
