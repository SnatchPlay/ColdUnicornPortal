import { type CSSProperties, type ReactNode, useMemo } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { LeadCrmRow } from "../types/view-contracts";
import { type LeadCrmColumn, CRM_STAGES, type CrmStage } from "../lib/lead-crm-columns";
import { computeStageBands, stickyLeftOffsets } from "../lib/grid/table-grid";
import {
  evaluateLeadHealth,
  processIssuesCount,
  type CellHealth,
  type HealthContext,
  type HealthState,
} from "../lib/crm/lead-health";
import { resolveCrmStatus } from "../lib/crm/lead-status";
import { formatDate } from "../lib/format";
import { TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./ui/utils";

/**
 * Dense, banded CRM table (ADR-0013, spec Appendix B). Renders a grouped stage strip over the column
 * headers, sticky-left identity columns, and horizontal scroll across the wide CRM column set. When
 * `showHealth` is on (CRM mode), each column carrying a `healthId` is wrapped in a colour shell whose
 * state + reason/deadline tooltip come from the shared health evaluator, fed the server `asOf`. The
 * combined PDCA+CRM mode leaves `showHealth` off for a calmer union (spec B.3).
 *
 * All tooltips share ONE `TooltipProvider` at the table root and use the raw Radix `Root` per cell —
 * the ui `<Tooltip>` self-wraps a provider, which on a 50×30 grid would mean hundreds of redundant
 * provider contexts.
 */

const STAGE_LABEL: Record<CrmStage, string> = Object.fromEntries(CRM_STAGES.map((s) => [s.key, s.label])) as Record<CrmStage, string>;

const HEALTH_CLASS: Partial<Record<HealthState, string>> = {
  green: "crm-cell-green",
  yellow: "crm-cell-yellow",
  orange: "crm-cell-orange",
  red: "crm-cell-red",
  pending: "crm-cell-pending",
};

/** Only these states paint a cell — `neutral`/`not_applicable` render plain. */
function isColorable(state: HealthState): boolean {
  return state in HEALTH_CLASS;
}

interface LeadCrmTableProps {
  rows: LeadCrmRow[];
  columns: LeadCrmColumn[];
  onRowClick: (row: LeadCrmRow) => void;
  selectedId?: string | null;
  rowAriaLabel: (row: LeadCrmRow) => string;
  /** Show the grouped stage strip (CRM mode). Off in combined PDCA+CRM mode for a calmer view. */
  showStageStrip?: boolean;
  /** Paint per-cell health colours. Off in combined mode; requires `healthContext`. */
  showHealth?: boolean;
  /** Server clock + working-day config the health deadlines are evaluated against (deterministic). */
  healthContext?: HealthContext;
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

/** Format a health deadline in the SLA's own timezone (not the viewer's) so the wall-clock matches. */
function formatDeadline(iso: string, timeZone: string): string {
  return formatDate(iso, { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone });
}

/** Colour shell + reason/deadline tooltip around a coloured cell (mirrors mega-table's condition cell). */
function CellHealthShell({ cell, align, timeZone, children }: { cell: CellHealth; align: string; timeZone: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipTrigger asChild>
        <div className={cn("crm-cell", HEALTH_CLASS[cell.state], align)}>
          <span className="min-w-0 w-full truncate">{children}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 bg-[#111] text-xs text-white" sideOffset={8}>
        <p>{cell.reason}</p>
        {cell.deadlineAt ? <p className="text-neutral-400">Deadline: {formatDeadline(cell.deadlineAt, timeZone)}</p> : null}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}

export function LeadCrmTable({
  rows,
  columns,
  onRowClick,
  selectedId,
  rowAriaLabel,
  showStageStrip = true,
  showHealth = false,
  healthContext,
  stickyLeftCount = 1,
}: LeadCrmTableProps) {
  const widths = useMemo(() => columns.map((c) => c.width), [columns]);
  const gridTemplate = useMemo(() => widths.map((w) => `${w}px`).join(" "), [widths]);
  const stickyOffsets = useMemo(() => stickyLeftOffsets(widths, stickyLeftCount), [widths, stickyLeftCount]);
  const bands = useMemo(() => computeStageBands(columns, (s) => STAGE_LABEL[s]), [columns]);
  const style = useMemo(() => ({ "--crm-columns": gridTemplate }) as CSSProperties, [gridTemplate]);
  // Deadlines render in the SLA timezone; only ever read when a coloured cell exists (health present).
  const tz = healthContext?.businessDays.timezone ?? "UTC";

  // One health map per lead, computed once (AO needs the full map). `status` is resolved here — the
  // row carries final_outcome/booleans, not the CRM status the evaluator's prerequisite gating reads.
  const rowHealth = useMemo(() => {
    if (!showHealth || !healthContext) return null;
    const map = new Map<string, Record<string, CellHealth>>();
    for (const row of rows) {
      map.set(row.id, evaluateLeadHealth({ ...row, status: resolveCrmStatus(row) }, healthContext));
    }
    return map;
  }, [rows, showHealth, healthContext]);

  const stickyStyle = (index: number, base: string): CSSProperties | undefined =>
    index < stickyLeftCount ? { position: "sticky", left: stickyOffsets[index], zIndex: 2, background: base } : undefined;

  return (
    <TooltipProvider delayDuration={0}>
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
                  {column.headerHelp ? (
                    <TooltipPrimitive.Root>
                      <TooltipTrigger asChild><span className="min-w-0 cursor-help truncate underline decoration-dotted decoration-neutral-600 underline-offset-4">{column.label}</span></TooltipTrigger>
                      <TooltipContent className="max-w-xs space-y-1 bg-[#111] text-xs text-white" sideOffset={8}>
                        <p className="font-medium normal-case tracking-normal text-white">{column.label}</p>
                        <p className="normal-case tracking-normal text-neutral-300">{column.headerHelp}</p>
                      </TooltipContent>
                    </TooltipPrimitive.Root>
                  ) : (
                    <span className="truncate" title={column.label}>{column.label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[#151515]">
            {rows.map((row) => {
              const active = selectedId === row.id;
              const rowBg = active ? "#0b1a24" : "#050505";
              const health = rowHealth?.get(row.id);
              const issues = health ? processIssuesCount(health) : undefined;
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
                    const cell = health && column.healthId ? health[column.healthId] : undefined;
                    // AO's value is derived from the health map, not the row projection.
                    const content: ReactNode =
                      column.healthId === "AO" && issues !== undefined
                        ? issues
                        : column.render
                          ? column.render(row)
                          : textCell(raw);
                    return (
                      <div
                        key={column.id}
                        className={cn("flex min-w-0 items-center px-2.5 py-2", alignClass(column.align))}
                        style={stickyStyle(index, rowBg)}
                      >
                        {cell && isColorable(cell.state) ? (
                          <CellHealthShell cell={cell} align={alignClass(column.align)} timeZone={tz}>{content}</CellHealthShell>
                        ) : column.render ? (
                          <div className="min-w-0 w-full">{content}</div>
                        ) : (
                          <span className="min-w-0 truncate text-neutral-200" title={title}>{content}</span>
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
    </TooltipProvider>
  );
}
