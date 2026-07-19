import { type CSSProperties, type ReactNode, useMemo } from "react";
import type { LeadCrmRow } from "../types/view-contracts";
import { type LeadCrmColumn, CRM_STAGES, type CrmStage } from "../lib/lead-crm-columns";
import { computeStageBands, stickyLeftOffsets } from "../lib/grid/table-grid";
import { cn } from "./ui/utils";

/**
 * Dense, banded CRM table (ADR-0013, spec Appendix B). Renders a grouped stage strip over the column
 * headers, sticky-left identity columns, and horizontal scroll across the wide CRM column set. Phase 3
 * is value-only — per-cell health colours + tooltips land in Phase 4 (hence `showStageStrip`, which the
 * combined PDCA+CRM mode turns off for a calmer view, spec B.3).
 */

const STAGE_LABEL: Record<CrmStage, string> = Object.fromEntries(CRM_STAGES.map((s) => [s.key, s.label])) as Record<CrmStage, string>;

interface LeadCrmTableProps {
  rows: LeadCrmRow[];
  columns: LeadCrmColumn[];
  onRowClick: (row: LeadCrmRow) => void;
  selectedId?: string | null;
  rowAriaLabel: (row: LeadCrmRow) => string;
  /** Show the grouped stage strip (CRM mode). Off in combined PDCA+CRM mode for a calmer view. */
  showStageStrip?: boolean;
  /** Number of identity columns pinned to the left. Default 1. */
  stickyLeftCount?: number;
}

function alignClass(align: LeadCrmColumn["align"]): string {
  if (align === "right") return "justify-end text-right";
  if (align === "center") return "justify-center text-center";
  return "justify-start text-left";
}

function textCell(value: string | number | null): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  return String(value);
}

export function LeadCrmTable({
  rows,
  columns,
  onRowClick,
  selectedId,
  rowAriaLabel,
  showStageStrip = true,
  stickyLeftCount = 1,
}: LeadCrmTableProps) {
  const widths = useMemo(() => columns.map((c) => c.width), [columns]);
  const gridTemplate = useMemo(() => widths.map((w) => `${w}px`).join(" "), [widths]);
  const stickyOffsets = useMemo(() => stickyLeftOffsets(widths, stickyLeftCount), [widths, stickyLeftCount]);
  const bands = useMemo(() => computeStageBands(columns, (s) => STAGE_LABEL[s]), [columns]);
  const style = useMemo(() => ({ "--crm-columns": gridTemplate }) as CSSProperties, [gridTemplate]);

  const stickyStyle = (index: number, base: string): CSSProperties | undefined =>
    index < stickyLeftCount ? { position: "sticky", left: stickyOffsets[index], zIndex: 2, background: base } : undefined;

  return (
    <div className="overflow-x-auto" style={style}>
      <div className="w-max min-w-full">
        {/* Sticky header block — the stage strip + the column labels scroll together vertically, so
            the column header does not need a magic pixel offset for the strip's height. */}
        <div className="sticky top-0 z-20">
          {showStageStrip ? (
            <div className="grid [grid-template-columns:var(--crm-columns)] border-b border-[#242424] bg-[#0d0d0d]">
              {bands.map((band) => (
                <div
                  key={`${band.stage}-${band.startIndex}`}
                  style={{ gridColumn: `span ${band.span}` }}
                  className="truncate border-r border-[#1c1c1c] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300/80"
                >
                  {band.label}
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid [grid-template-columns:var(--crm-columns)] border-b border-border bg-[#0d0d0d] text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {columns.map((column, index) => (
              <div
                key={column.id}
                className={cn("flex min-w-0 items-center px-2.5 py-2", alignClass(column.align))}
                style={stickyStyle(index, "#0d0d0d")}
              >
                <span className="truncate" title={column.label}>{column.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-[#151515]">
          {rows.map((row) => {
            const active = selectedId === row.id;
            const rowBg = active ? "#0b1a24" : "#050505";
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
                  "grid cursor-pointer [grid-template-columns:var(--crm-columns)] text-xs transition",
                  active ? "bg-sky-500/10" : "hover:bg-white/[0.04]",
                )}
              >
                {columns.map((column, index) => {
                  const raw = column.value(row);
                  const title = typeof raw === "string" ? raw : undefined;
                  return (
                    <div
                      key={column.id}
                      className={cn("flex min-w-0 items-center px-2.5 py-2", alignClass(column.align))}
                      style={stickyStyle(index, rowBg)}
                    >
                      {column.render ? (
                        <div className="min-w-0 w-full">{column.render(row)}</div>
                      ) : (
                        <span className="min-w-0 truncate text-neutral-200" title={title}>{textCell(raw)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
