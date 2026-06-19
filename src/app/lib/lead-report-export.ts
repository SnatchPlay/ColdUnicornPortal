import { repository } from "../data/repository";
import type { LeadsListParams, LeadsListRow } from "../types/view-contracts";
import type { LeadReportColumn } from "./lead-report-columns";

/**
 * Leads report export (Task 4G). Fetches ALL rows matching the current filters/sort (not just the
 * visible page) by paging through loadLeadsList server-side — so RLS scope and ordering are
 * preserved — then serialises the visible column set (including custom columns) to CSV or XLSX.
 */

const EXPORT_PAGE_SIZE = 100;
const DEFAULT_ROW_CAP = 5000;

export interface ExportDataset {
  rows: LeadsListRow[];
  /** Combined custom value lookup keyed `${lead_id}:${field_id}`. */
  customValues: Map<string, string | null>;
}

export async function fetchAllLeadRows(
  baseParams: Omit<LeadsListParams, "page" | "pageSize">,
  cap: number = DEFAULT_ROW_CAP,
): Promise<ExportDataset> {
  const rows: LeadsListRow[] = [];
  const customValues = new Map<string, string | null>();
  let page = 1;

  // Hard page ceiling as a safety net independent of the row cap.
  const maxPages = Math.ceil(cap / EXPORT_PAGE_SIZE) + 1;
  while (page <= maxPages) {
    const res = await repository.loadLeadsList({ ...baseParams, page, pageSize: EXPORT_PAGE_SIZE });
    rows.push(...res.rows);
    for (const v of res.customValues ?? []) customValues.set(`${v.lead_id}:${v.field_id}`, v.value);
    if (res.rows.length < EXPORT_PAGE_SIZE) break; // last page reached
    if (rows.length >= res.totalCount || rows.length >= cap) break;
    page += 1;
  }

  return { rows: rows.slice(0, cap), customValues };
}

/** Resolve a column's export cell value, sourcing custom (`cf:*`) columns from the export map. */
function cellValue(column: LeadReportColumn, row: LeadsListRow, customValues: Map<string, string | null>): string {
  if (column.id.startsWith("cf:")) {
    const fieldId = column.id.slice(3);
    return customValues.get(`${row.id}:${fieldId}`) ?? "";
  }
  const value = column.value(row);
  return value === null || value === undefined ? "" : String(value);
}

/** Build a header + body matrix from the visible columns plus a trailing Highlight column. */
export function buildExportMatrix(
  columns: LeadReportColumn[],
  rows: LeadsListRow[],
  customValues: Map<string, string | null>,
): string[][] {
  const header = [...columns.map((c) => c.label), "Highlight"];
  const body = rows.map((row) => [
    ...columns.map((column) => cellValue(column, row, customValues)),
    row.highlight ?? "",
  ]);
  return [header, ...body];
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function exportLeadsCsv(matrix: string[][], filename: string): void {
  const content = matrix.map((line) => line.map(csvEscape).join(",")).join("\r\n");
  // UTF-8 BOM so Excel/Sheets read diacritics correctly.
  triggerDownload(new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" }), filename);
}

export async function exportLeadsXlsx(matrix: string[][], filename: string): Promise<void> {
  // Lazy-load SheetJS so the ~300 KB library only ships when a user actually exports XLSX.
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Leads");
  XLSX.writeFile(book, filename);
}

/** Fetch all matching rows and download the report in the requested format. */
export async function downloadLeadReport(
  columns: LeadReportColumn[],
  baseParams: Omit<LeadsListParams, "page" | "pageSize">,
  format: "csv" | "xlsx",
  filenameBase: string,
): Promise<void> {
  const { rows, customValues } = await fetchAllLeadRows(baseParams);
  const matrix = buildExportMatrix(columns, rows, customValues);
  const filename = `${filenameBase}.${format}`;
  if (format === "csv") exportLeadsCsv(matrix, filename);
  else await exportLeadsXlsx(matrix, filename);
}
