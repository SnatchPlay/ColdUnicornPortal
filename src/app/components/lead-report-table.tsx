import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { LeadHighlight } from "../types/core";
import type { LeadsListRow } from "../types/view-contracts";
import {
  type LeadReportColumn,
  LEAD_HIGHLIGHT_COLORS,
  LEAD_HIGHLIGHT_ORDER,
  leadHighlightBackground,
} from "../lib/lead-report-columns";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "./ui/utils";

/**
 * Dense, spreadsheet-style table for the Leads report (Client Feedback Batch 4). Renders from the
 * shared column registry: small font, narrow resizable columns, sticky header, horizontal scroll,
 * truncated cells with native tooltips, and semi-transparent row highlights. Used by both the
 * internal Leads page and the client portal report so they stay visually identical.
 */

export interface LeadReportSort {
  key: string;
  direction: "asc" | "desc";
}

interface LeadReportTableProps {
  rows: LeadsListRow[];
  columns: LeadReportColumn[];
  /** CSS grid template from useResizableColumns (column widths). */
  template: string;
  getResizeMouseDown: (index: number) => (event: React.MouseEvent<HTMLElement>) => void;
  sort: LeadReportSort;
  /** Called with the column's serverSortField when a sortable header is clicked. */
  onSortChange: (serverSortField: string) => void;
  onRowClick: (row: LeadsListRow) => void;
  selectedId?: string | null;
  rowAriaLabel: (row: LeadsListRow) => string;
  /** When set, renders a trailing highlight-colour menu per row and persists via this callback. */
  onHighlightChange?: (row: LeadsListRow, value: LeadHighlight | null) => Promise<void> | void;
}

function sortGlyph(active: boolean, direction: "asc" | "desc"): string {
  if (!active) return "↕";
  return direction === "asc" ? "↑" : "↓";
}

function alignClass(align: LeadReportColumn["align"]): string {
  if (align === "right") return "justify-end text-right";
  if (align === "center") return "justify-center text-center";
  return "justify-start text-left";
}

export function LeadReportTable({
  rows,
  columns,
  template,
  getResizeMouseDown,
  sort,
  onSortChange,
  onRowClick,
  selectedId,
  rowAriaLabel,
  onHighlightChange,
}: LeadReportTableProps) {
  const showActions = Boolean(onHighlightChange);
  // Optimistic highlight overrides so the row recolours instantly before the server round-trip.
  const [highlightOverrides, setHighlightOverrides] = useState<Map<string, LeadHighlight | null>>(new Map());
  const gridTemplate = showActions ? `${template} 44px` : template;
  const style = useMemo(() => ({ "--lead-report-columns": gridTemplate }) as CSSProperties, [gridTemplate]);

  async function applyHighlight(row: LeadsListRow, value: LeadHighlight | null) {
    if (!onHighlightChange) return;
    const previous = highlightOverrides.has(row.id) ? highlightOverrides.get(row.id)! : row.highlight;
    setHighlightOverrides((current) => new Map(current).set(row.id, value));
    try {
      await onHighlightChange(row, value);
    } catch {
      // Roll back to the prior value on failure.
      setHighlightOverrides((current) => new Map(current).set(row.id, previous));
    }
  }

  function effectiveHighlight(row: LeadsListRow): LeadHighlight | null {
    return highlightOverrides.has(row.id) ? highlightOverrides.get(row.id)! : row.highlight;
  }

  return (
    <div className="overflow-x-auto" style={style}>
      <div className="w-max min-w-full">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 grid [grid-template-columns:var(--lead-report-columns)] border-b border-border bg-[#0d0d0d] text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {columns.map((column, index) => {
            const sortable = Boolean(column.serverSortField);
            const active = sortable && sort.key === column.serverSortField;
            return (
              <div key={column.id} className={cn("relative flex min-w-0 items-center px-2.5 py-2", alignClass(column.align))}>
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(column.serverSortField!)}
                    className="truncate text-left transition hover:text-white"
                    title={column.label}
                  >
                    {column.label} <span className="text-[10px]">{sortGlyph(active, sort.direction)}</span>
                  </button>
                ) : (
                  <span className="truncate" title={column.label}>{column.label}</span>
                )}
                {index < columns.length - 1 ? (
                  <div
                    onMouseDown={getResizeMouseDown(index)}
                    className="absolute -right-1 top-0 hidden h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20 lg:block"
                  />
                ) : null}
              </div>
            );
          })}
          {showActions ? <div className="px-2.5 py-2" /> : null}
        </div>

        {/* Rows — the whole row is one button (role=button div so link/menu children remain valid). */}
        <div className="divide-y divide-[#151515]">
          {rows.map((row) => {
            const active = selectedId === row.id;
            const highlight = effectiveHighlight(row);
            const highlightBg = leadHighlightBackground(highlight);
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                aria-label={rowAriaLabel(row)}
                onClick={() => onRowClick(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(
                  "grid cursor-pointer [grid-template-columns:var(--lead-report-columns)] text-xs transition",
                  active ? "bg-sky-500/10" : "hover:bg-white/[0.04]",
                )}
                style={highlightBg ? { backgroundColor: highlightBg } : undefined}
              >
                {columns.map((column) => {
                  const raw = column.value(row);
                  const title = typeof raw === "string" ? raw : undefined;
                  return (
                    <div key={column.id} className={cn("flex min-w-0 items-center px-2.5 py-2", alignClass(column.align))}>
                      {column.render ? (
                        <div className="min-w-0 w-full">{column.render(row)}</div>
                      ) : (
                        <span className="min-w-0 truncate text-neutral-200" title={title}>{textCell(raw)}</span>
                      )}
                    </div>
                  );
                })}
                {showActions ? (
                  <div className="flex items-center justify-center px-1.5 py-1" onClick={(event) => event.stopPropagation()}>
                    <HighlightMenu value={highlight} onChange={(value) => void applyHighlight(row, value)} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function textCell(value: string | number | null): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  return String(value);
}

/** Per-row colour picker for the manual report highlight (Task 4E). */
function HighlightMenu({ value, onChange }: { value: LeadHighlight | null; onChange: (value: LeadHighlight | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Set row highlight"
          className="h-4 w-4 rounded-full border border-white/25"
          style={value ? { backgroundColor: LEAD_HIGHLIGHT_COLORS[value] } : undefined}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto rounded-xl border-[#242424] bg-[#0d0d0d] p-2">
        <div className="flex items-center gap-2">
          {LEAD_HIGHLIGHT_ORDER.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Highlight ${color}`}
              onClick={() => { onChange(color); setOpen(false); }}
              className={cn("h-5 w-5 rounded-full border transition", value === color ? "border-white" : "border-white/25 hover:border-white/60")}
              style={{ backgroundColor: LEAD_HIGHLIGHT_COLORS[color] }}
            />
          ))}
          <button
            type="button"
            aria-label="Clear highlight"
            onClick={() => { onChange(null); setOpen(false); }}
            className="h-5 w-5 rounded-full border border-white/25 text-[10px] text-muted-foreground transition hover:border-white/60"
          >
            ✕
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
