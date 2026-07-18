import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { useDevRenderCount, useWhyDidYouRender } from "../../lib/react-profiler-dev";
import type { SelectionStore } from "./selection-store";
import { Badge } from "../../components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import type { ClientMetricsPack, DodRow, MomRow, ThreeDodRow, WowRow } from "../../lib/client-metrics";
import type { evaluateClientConditions } from "../../lib/conditions/client-condition-results";
import { dodCellKey, momCellKey, threeDodCellKey, wowCellKey } from "../../lib/conditions/client-condition-results";
import { getCellCondition, getSeverityClassName } from "../../lib/conditions/evaluator";
import type { ConditionEvaluationResult, ConditionSeverity } from "../../lib/conditions/types";
import { formatNumber } from "../../lib/format";
import { getCustomFieldSortValue } from "../../lib/custom-field-sort";
import { useResizableColumns } from "../../lib/use-resizable-columns";
import { CLIENT_STATUSES } from "../../types/core";
import type {
  ClientCustomFieldRecord,
  ClientRecord,
  ClientStatus,
  ColumnOverrideRecord,
} from "../../types/core";

export type SortDirection = "asc" | "desc";

export interface ClientMegaRow {
  client: ClientRecord;
  managerName: string;
  metrics: ClientMetricsPack;
  highestSeverity: ConditionSeverity | null;
  healthScore: number;
  rollupCause: string;
  conditionPack: ReturnType<typeof evaluateClientConditions> | null;
}

export interface MegaSortState {
  key: string;
  direction: SortDirection;
}

type Align = "left" | "center" | "right";
type Group = "cs" | "basic" | "dodSched" | "dodSent" | "td3" | "wow" | "mom" | "custom";

interface MegaColumn {
  id: string;
  group: Group;
  sub: string;
  label: string;
  width: number;
  minWidth: number;
  align: Align;
  sticky?: boolean;
  /** Render the cell content (without condition wrapper). */
  render: (row: ClientMegaRow) => ReactNode;
  /** Sort comparator key — string or number. */
  sortValue?: (row: ClientMegaRow) => string | number | null;
  /** When true, renders the 1-based row index instead of col.render(). */
  ordinal?: boolean;
  /** Optional explicit condition column key (matches `column_key` on condition rules). */
  conditionKey?: string;
  /** Condition cell key for DoD per-bucket lookup (overrides conditionKey). */
  dodBucket?: string;
  dodKind?: "schedule" | "sent";
  /** Condition cell key for WoW per-bucket lookup (overrides conditionKey). */
  wowBucket?: string;
  wowMetricKey?: string;
  /** Condition cell key for 3-DoD per-bucket lookup (overrides conditionKey). */
  td3Bucket?: string;
  td3MetricKey?: string;
  /** Condition cell key for MoM per-bucket lookup (overrides conditionKey). */
  momBucket?: string;
  momMetricKey?: string;
  defaultDirection?: SortDirection;
}

const DOD_SCHED_BUCKETS = ["+2", "+1", "0"] as const;
const DOD_SENT_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const TD3_TOTAL_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const TD3_SQL_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const WOW_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const MOM_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatNumber(value);
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function calcMinSent(prospectsSignedRaw: number | null | undefined): number | null {
  if (prospectsSignedRaw == null) return null;
  return Math.ceil((prospectsSignedRaw * 3) / 20);
}

function bucketMap<T extends { bucket: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.bucket, r);
  return m;
}

function dodLookup(row: ClientMegaRow, bucket: string): DodRow | undefined {
  return bucketMap(row.metrics.dodRows).get(bucket);
}
function td3Lookup(row: ClientMegaRow, bucket: string): ThreeDodRow | undefined {
  return bucketMap(row.metrics.threeDodRows).get(bucket);
}
function wowLookup(row: ClientMegaRow, bucket: string): WowRow | undefined {
  return bucketMap(row.metrics.wowRows).get(bucket);
}
function momLookup(row: ClientMegaRow, bucket: string): MomRow | undefined {
  return bucketMap(row.metrics.momRows).get(bucket);
}

function buildColumns(): MegaColumn[] {
  const out: MegaColumn[] = [];

  // --- Ordinal # -----------------------------------------------------------
  out.push({
    id: "ordinal",
    group: "cs",
    sub: "Customer Success",
    label: "#",
    width: 30,
    minWidth: 26,
    align: "center",
    ordinal: true,
    render: () => "",
  });

  // --- Sticky (Customer Success) -----------------------------------------
  out.push({
    id: "name",
    group: "cs",
    sub: "Customer Success",
    label: "Client",
    width: 160,
    minWidth: 120,
    align: "left",
    sticky: true,
    defaultDirection: "asc",
    render: (row) => {
      const sev = row.highestSeverity;
      const sevForBadge =
        sev === "critical_over" || sev === "danger" || sev === "warning" ? sev : null;
      return (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm text-foreground">{row.client.name}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            {sevForBadge ? (
              <Badge className={cn("shrink-0 text-[9px] px-1 py-0", getSeverityClassName(sevForBadge))}>
                {sevForBadge === "critical_over" ? "Critical" : sevForBadge === "danger" ? "Danger" : "Warning"}
              </Badge>
            ) : (
              <Badge className="shrink-0 border-emerald-400/60 bg-emerald-500/20 text-[9px] text-emerald-200 px-1 py-0">
                Healthy
              </Badge>
            )}
            {row.rollupCause && row.rollupCause !== "All KPIs on target" ? (
              <span className="truncate text-[9px] text-muted-foreground">{row.rollupCause}</span>
            ) : (
              <span className="truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
                {row.client.status}
              </span>
            )}
          </div>
        </div>
      );
    },
    sortValue: (row) => row.client.name.toLowerCase(),
  });

  out.push({
    id: "manager",
    group: "cs",
    sub: "Customer Success",
    label: "Manager",
    width: 100,
    minWidth: 80,
    align: "left",
    sticky: false,
    defaultDirection: "asc",
    render: (row) => <span className="truncate text-xs text-muted-foreground">{row.managerName}</span>,
    sortValue: (row) => row.managerName.toLowerCase(),
  });

  // --- Basic --------------------------------------------------------------
  out.push({
    id: "status",
    group: "basic",
    sub: "Basic",
    label: "Status",
    width: 64,
    minWidth: 52,
    align: "center",
    defaultDirection: "asc",
    render: (row) => {
      const s = row.client.status ?? "—";
      return (
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusBadgeClass(s))}>
          {s}
        </span>
      );
    },
    sortValue: (row) => row.client.status ?? "",
  });
  out.push({
    id: "inboxes",
    group: "basic",
    sub: "Basic",
    label: "Inboxes",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "inboxes",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.inboxes_count),
    sortValue: (row) => row.client.inboxes_count ?? null,
  });
  out.push({
    id: "prospects_signed",
    group: "basic",
    sub: "Basic",
    label: "Signed",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "prospects_signed",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.prospects_signed),
    sortValue: (row) => row.client.prospects_signed ?? null,
  });
  out.push({
    id: "prospects_added",
    group: "basic",
    sub: "Basic",
    label: "Added",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "prospects_added",
    defaultDirection: "desc",
    render: (row) => formatNum(row.metrics.overview.latestProspectsCount || row.client.prospects_added),
    sortValue: (row) => row.metrics.overview.latestProspectsCount || (row.client.prospects_added ?? null),
  });
  out.push({
    id: "min_sent",
    group: "basic",
    sub: "Basic",
    label: "Min sent",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "min_sent",
    defaultDirection: "desc",
    render: (row) => formatNum(calcMinSent(row.client.prospects_signed)),
    sortValue: (row) => calcMinSent(row.client.prospects_signed),
  });
  out.push({
    id: "min_mailboxes",
    group: "basic",
    sub: "Basic",
    label: "Min MBX",
    width: 56,
    minWidth: 44,
    align: "center",
    defaultDirection: "desc",
    render: (row) => {
      const ms = calcMinSent(row.client.prospects_signed);
      return formatNum(ms === null ? null : Math.ceil(ms / 10));
    },
    sortValue: (row) => {
      const ms = calcMinSent(row.client.prospects_signed);
      return ms === null ? null : Math.ceil(ms / 10);
    },
  });
  out.push({
    id: "kpi_leads",
    group: "basic",
    sub: "Basic",
    label: "KPI L",
    width: 40,
    minWidth: 34,
    align: "center",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.kpi_leads),
    sortValue: (row) => row.client.kpi_leads ?? null,
  });
  out.push({
    id: "kpi_meetings",
    group: "basic",
    sub: "Basic",
    label: "KPI M",
    width: 40,
    minWidth: 34,
    align: "center",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.kpi_meetings),
    sortValue: (row) => row.client.kpi_meetings ?? null,
  });
  out.push({
    id: "notes",
    group: "basic",
    sub: "Basic",
    label: "Notes",
    width: 160,
    minWidth: 80,
    align: "left",
    defaultDirection: "asc",
    render: (row) => {
      const text = row.client.notes;
      if (!text) return <span className="text-neutral-600">—</span>;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-xs text-neutral-300 cursor-default">{text}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">{text}</TooltipContent>
        </Tooltip>
      );
    },
    sortValue: (row) => row.client.notes ?? "",
  });

  // --- DoD Schedule -------------------------------------------------------
  for (const b of DOD_SCHED_BUCKETS) {
    out.push({
      id: `dod-sched-${b}`,
      group: "dodSched",
      sub: "Schedule",
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "schedule",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.schedule ?? null),
      sortValue: (row) => dodLookup(row, b)?.schedule ?? null,
    });
  }

  // --- DoD Daily sent -----------------------------------------------------
  for (const b of DOD_SENT_BUCKETS) {
    out.push({
      id: `dod-sent-${b}`,
      group: "dodSent",
      sub: "Daily sent",
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "sent",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.sent ?? null),
      sortValue: (row) => dodLookup(row, b)?.sent ?? null,
    });
  }

  // --- 3-DoD --------------------------------------------------------------
  for (const b of TD3_TOTAL_BUCKETS) {
    out.push({
      id: `td3-total-${b}`,
      group: "td3",
      sub: "3-DoD TOTAL leads",
      label: b,
      width: 32,
      minWidth: 28,
      align: "center",
      td3Bucket: b,
      td3MetricKey: "three_dod_total",
      defaultDirection: "desc",
      render: (row) => formatNum(td3Lookup(row, b)?.totalLeads ?? null),
      sortValue: (row) => td3Lookup(row, b)?.totalLeads ?? null,
    });
  }
  for (const b of TD3_SQL_BUCKETS) {
    out.push({
      id: `td3-sql-${b}`,
      group: "td3",
      sub: "3-DoD SQL leads",
      label: b,
      width: 32,
      minWidth: 28,
      align: "center",
      td3Bucket: b,
      td3MetricKey: "three_dod_sql",
      defaultDirection: "desc",
      render: (row) => formatNum(td3Lookup(row, b)?.sqlLeads ?? null),
      sortValue: (row) => td3Lookup(row, b)?.sqlLeads ?? null,
    });
  }

  // --- WoW (Response / Human / Bounce / OOO rates, plus SQL counts) ------
  const wowMetrics: Array<{
    key: string;
    label: string;
    conditionKey: string;
    format: "rate" | "num";
    pick: (row: WowRow) => number | null;
  }> = [
    {
      key: "total",
      label: "Total",
      conditionKey: "wow_total_leads",
      format: "num",
      pick: (r) => r.totalLeads,
    },
    {
      key: "sql",
      label: "SQL",
      conditionKey: "wow_sql",
      format: "num",
      pick: (r) => r.sqlLeads,
    },
    {
      key: "resp",
      label: "Resp",
      conditionKey: "wow_total_response_rate",
      format: "rate",
      pick: (r) => r.responseRate,
    },
    {
      key: "human",
      label: "Human",
      conditionKey: "wow_human_response_rate",
      format: "rate",
      pick: (r) => r.humanRate,
    },
    {
      key: "bnc",
      label: "Bnc",
      conditionKey: "wow_bounce_rate",
      format: "rate",
      pick: (r) => r.bounceRate,
    },
    {
      key: "ooo",
      label: "OOO",
      conditionKey: "wow_ooo_rate",
      format: "rate",
      pick: (r) => r.oooRate,
    },
  ];

  for (const m of wowMetrics) {
    for (const b of WOW_BUCKETS) {
      out.push({
        id: `wow-${m.key}-${b}`,
        group: "wow",
        sub: `WoW ${m.label}`,
        label: b,
        width: m.format === "rate" ? 40 : 32,
        minWidth: 28,
        align: "center",
        wowBucket: b,
        wowMetricKey: m.conditionKey,
        defaultDirection: "desc",
        render: (row) => {
          const v = m.pick(wowLookup(row, b) as WowRow);
          return m.format === "rate" ? formatRate(v ?? null) : formatNum(v ?? null);
        },
        sortValue: (row) => m.pick(wowLookup(row, b) as WowRow) ?? null,
      });
    }
  }

  // --- MoM ----------------------------------------------------------------
  const momMetrics: Array<{
    key: string;
    label: string;
    conditionKey: string;
    pick: (row: MomRow) => number | null;
  }> = [
    { key: "total", label: "Total", conditionKey: "mom_total_leads", pick: (r) => r.totalLeads },
    { key: "sql", label: "SQL", conditionKey: "mom_sql", pick: (r) => r.sqlLeads },
    { key: "mtg", label: "Mtg", conditionKey: "mom_meetings", pick: (r) => r.meetings },
    { key: "won", label: "Won", conditionKey: "mom_won", pick: (r) => r.won },
  ];
  for (const m of momMetrics) {
    for (const b of MOM_BUCKETS) {
      out.push({
        id: `mom-${m.key}-${b}`,
        group: "mom",
        sub: `MoM ${m.label}`,
        label: b,
        width: 32,
        minWidth: 28,
        align: "center",
        momBucket: b,
        momMetricKey: m.conditionKey,
        defaultDirection: "desc",
        render: (row) => formatNum(m.pick(momLookup(row, b) as MomRow) ?? null),
        sortValue: (row) => m.pick(momLookup(row, b) as MomRow) ?? null,
      });
    }
  }

  return out;
}

export const MEGA_COLUMNS = buildColumns();
export const MEGA_COLUMN_COUNT = MEGA_COLUMNS.length;
/** Distinct built-in section (sub-band) names, in display order. Used by the
 * master-admin customization panel to offer per-section name overrides. */
export const MEGA_SECTIONS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of MEGA_COLUMNS) {
    if (!seen.has(col.sub)) {
      seen.add(col.sub);
      out.push(col.sub);
    }
  }
  return out;
})();

/** Section (sub) → group lookup. Each built-in section maps to exactly one
 * group; the synthetic "Custom" section maps to the custom group. Used when a
 * column is reassigned to another section so its group band stays consistent. */
const SECTION_TO_GROUP = new Map<string, Group>(MEGA_COLUMNS.map((c) => [c.sub, c.group]));
SECTION_TO_GROUP.set("Custom", "custom");

/** Re-home a column into another section when a `colsection:<id>` override is
 * set. Keeps `group` in sync so the thick group separators match the new band. */
function applySectionAssignment(col: MegaColumn, overrideMap: Map<string, ColumnOverrideRecord>): MegaColumn {
  const assigned = overrideMap.get(`colsection:${col.id}`)?.label_override;
  if (!assigned || assigned === col.sub) return col;
  return { ...col, sub: assigned, group: SECTION_TO_GROUP.get(assigned) ?? col.group };
}
const STICKY_INDICES = MEGA_COLUMNS.map((c, i) => (c.sticky ? i : -1)).filter((i) => i >= 0);

function computeStickyOffsets(widths: number[]): Map<number, number> {
  const m = new Map<number, number>();
  let cum = 0;
  for (const i of STICKY_INDICES) {
    m.set(i, cum);
    cum += widths[i] ?? 0;
  }
  return m;
}

function cellCondition(row: ClientMegaRow, col: MegaColumn): ConditionEvaluationResult | undefined {
  if (!row.conditionPack) return undefined;
  if (col.dodBucket && col.dodKind) {
    const key = dodCellKey(col.dodBucket, col.dodKind);
    return getCellCondition(row.conditionPack.dodCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.td3Bucket && col.td3MetricKey) {
    const key = threeDodCellKey(col.td3Bucket, col.td3MetricKey);
    return getCellCondition(row.conditionPack.threeDodCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.wowBucket && col.wowMetricKey) {
    const key = wowCellKey(col.wowBucket, col.wowMetricKey);
    return getCellCondition(row.conditionPack.wowCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.momBucket && col.momMetricKey) {
    const key = momCellKey(col.momBucket, col.momMetricKey);
    return getCellCondition(row.conditionPack.momCellResults[key] ?? [], key) ?? undefined;
  }
  if (!col.conditionKey) return undefined;
  return (
    getCellCondition(row.conditionPack.allResults, col.conditionKey) ??
    getCellCondition(row.conditionPack.overviewResults, col.conditionKey)
  );
}

function severityLabel(severity: ConditionSeverity): string {
  if (severity === "critical_over") return "Critical";
  if (severity === "danger") return "Danger";
  if (severity === "warning") return "Warning";
  if (severity === "info") return "Info";
  return "Good";
}

function conditionCellWrapperClass(severity: ConditionSeverity): string {
  if (severity === "critical_over") return "cond-cell cond-cell-critical";
  if (severity === "danger") return "cond-cell cond-cell-danger";
  if (severity === "warning") return "cond-cell cond-cell-warning";
  if (severity === "good") return "cond-cell cond-cell-good";
  return "rounded";
}

function renderCellWithCondition(
  content: ReactNode,
  condition: ConditionEvaluationResult | undefined,
  isCellSelected: boolean,
): ReactNode {
  if (!condition) return <span className="text-white">{content}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* ring-inset on the inner div because .cond-cell fills 100%+margin,
            completely covering any ring placed on the outer cell div */}
        <div className={cn(
          conditionCellWrapperClass(condition.severity),
          isCellSelected && "ring-2 ring-inset ring-sky-400/90",
        )}>{content}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 bg-[#111] text-xs text-white" sideOffset={8}>
        <p>
          <span className="text-neutral-400">Rule:</span> {condition.ruleName}
        </p>
        <p>
          <span className="text-neutral-400">Value:</span> {String(condition.value ?? "-")}
        </p>
        {condition.threshold !== undefined && (
          <p>
            <span className="text-neutral-400">Threshold:</span> {String(condition.threshold)}
          </p>
        )}
        <p>
          <span className="text-neutral-400">Message:</span> {condition.message}
        </p>
        <p>
          <span className="text-neutral-400">{severityLabel(condition.severity)}</span>
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export interface ClientsMegaTableProps {
  rows: ClientMegaRow[];
  sort: MegaSortState;
  onSortChange: (next: MegaSortState) => void;
  onRowClick: (clientId: string) => void;
  onHighlight: (clientId: string, colId: string) => void;
  selectionStore: SelectionStore;
  /** Parent ref that receives the ordered visible column id array after each render. */
  colsRef?: MutableRefObject<string[]>;
  storageKey?: string;
  /**
   * Column widths from the caller's per-user preferences (`user_table_preferences`). When
   * supplied, the table renders these instead of its own localStorage copy and reports a
   * resize back through `onWidthsChange` — see `useTablePreferences`.
   */
  savedWidths?: Record<string, number> | null;
  onWidthsChange?: (widthsById: Record<string, number>) => void;
  /** Master-admin label/visibility overrides keyed by column id. */
  columnOverrides?: ColumnOverrideRecord[];
  /** Master-admin custom columns (text / checkbox / droplist). */
  customFields?: ClientCustomFieldRecord[];
  /** Map<clientId, Map<fieldId, value>>. */
  customFieldValuesByClient?: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
  /** Returns true when the current user may edit the given field's values. */
  canEditCustomField?: (fieldId: string) => boolean;
  /** Called when a custom-field cell value changes. */
  onCustomFieldValueChange?: (clientId: string, fieldId: string, value: string | null) => void;
  /** Called when the inline Notes cell is edited (blur-to-save). Read-only when omitted. */
  onNotesChange?: (clientId: string, value: string | null) => void;
  /** True when the Status cell may be edited inline. Falls back to a read-only badge otherwise. */
  canEditStatus?: boolean;
  /** Called when the inline Status cell is changed. */
  onStatusChange?: (clientId: string, status: ClientStatus) => void;
}

function parseSafeHref(raw: string | null | undefined): string | null {
  const href = raw?.trim();
  if (!href) return null;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function LinkCell({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave?: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const safe = parseSafeHref(value);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(value ?? "");
    setOpen(true);
  }

  function handleSave() {
    const next = draft.trim() || null;
    if (next !== (value ?? null)) onSave?.(next);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <span className="group/link inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {safe ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-sky-400 hover:text-sky-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs break-all text-xs">
            {value}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-neutral-600">—</span>
      )}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={handleOpen}
              className="inline-flex items-center text-neutral-500 hover:text-neutral-300 transition-colors"
              tabIndex={-1}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-80 p-3">
            <p className="mb-2 text-xs font-medium text-neutral-300">Edit link</p>
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://…"
              className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-500/50"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded bg-sky-600/20 px-3 py-1 text-xs text-sky-300 hover:bg-sky-600/30"
              >
                Save
              </button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

// Shared by the read-only badge and the inline editable Status cell so both stay in sync.
function statusBadgeClass(s: string): string {
  return s === "Active"     ? "status-badge-active" :
         s === "Inactive"   ? "status-badge-inactive" :
         s === "Abo"        ? "status-badge-abo" :
         s === "Sales"      ? "status-badge-sales" :
         s === "On hold"    ? "status-badge-onhold" :
         s === "Offboarding"? "status-badge-offboard" :
         "border-border bg-white/5 text-white";
}

// Inline Status editor: a native <select> wearing the same badge colours as the read-only cell.
// Mirrors the droplist custom-field cell (stopPropagation so picking a value doesn't open the row).
function statusCellRender(onChange: (clientId: string, status: ClientStatus) => void) {
  return (row: ClientMegaRow) => {
    const s = row.client.status;
    return (
      <select
        value={s ?? ""}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = event.target.value as ClientStatus;
          if (next && next !== s) onChange(row.client.id, next);
        }}
        className={cn(
          "w-full cursor-pointer rounded border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none",
          statusBadgeClass(s ?? "—"),
        )}
      >
        {CLIENT_STATUSES.map((opt) => (
          <option key={opt} value={opt} className="bg-[#0d0d0d] text-neutral-200">
            {opt}
          </option>
        ))}
      </select>
    );
  };
}

function notesCellRender(onChange: (clientId: string, value: string | null) => void) {
  return (row: ClientMegaRow) => {
    const text = row.client.notes;
    return (
      <input
        type="text"
        defaultValue={text ?? ""}
        title={text ?? undefined}
        onClick={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next === (text ?? "")) return;
          onChange(row.client.id, next || null);
        }}
        className="w-full bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
        placeholder="—"
      />
    );
  };
}

function customFieldColumn(
  field: ClientCustomFieldRecord,
  valuesByClient: ReadonlyMap<string, ReadonlyMap<string, string | null>>,
  canEdit: boolean,
  onChange?: (clientId: string, fieldId: string, value: string | null) => void,
): MegaColumn {
  const lookup = (row: ClientMegaRow): string | null =>
    valuesByClient.get(row.client.id)?.get(field.id) ?? null;
  const isNumeric = field.field_type === "number" || field.field_type === "currency";
  return {
    id: `cf:${field.id}`,
    group: "custom",
    sub: "Custom",
    label: field.name,
    width: field.field_type === "checkbox" ? 90 : field.field_type === "droplist" ? 120 : 140,
    minWidth: field.field_type === "checkbox" ? 50 : 60,
    align: isNumeric ? "right" : "left",
    // Lets condition rules with `column_key: "cf:<id>"` and surface
    // `clients_overview` colour this cell via cellCondition().
    conditionKey: `cf:${field.id}`,
    render: (row) => {
      const value = lookup(row);
      if (field.field_type === "checkbox") {
        const checked = value === "true";
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={!canEdit}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              onChange?.(row.client.id, field.id, event.target.checked ? "true" : "false");
            }}
            className="h-3.5 w-3.5 cursor-pointer accent-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
        );
      }
      if (field.field_type === "droplist") {
        const options = field.options ?? [];
        if (!canEdit) {
          return <span className="truncate text-xs text-current">{value ?? "—"}</span>;
        }
        return (
          // text-current, not a fixed neutral: a <select> does not inherit the colour of
          // its container, so on a coloured condition cell (.cond-cell-good is black-on-
          // bright-green in the contrast palette) a hard-coded light grey is unreadable.
          <select
            value={value ?? ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChange?.(row.client.id, field.id, event.target.value || null)}
            className="w-full bg-transparent text-xs text-current outline-none"
          >
            {/* The options render in the native popup, not on the coloured cell, so they
                need their own dark-panel colours — inheriting text-current would paint
                them black on the dark popup. */}
            <option value="" className="bg-[#0d0d0d] text-neutral-200">—</option>
            {options.map((opt) => (
              <option key={opt} value={opt} className="bg-[#0d0d0d] text-neutral-200">{opt}</option>
            ))}
          </select>
        );
      }
      if (field.field_type === "link") {
        return (
          <LinkCell
            value={value}
            canEdit={canEdit}
            onSave={(next) => onChange?.(row.client.id, field.id, next)}
          />
        );
      }
      if (!canEdit) {
        return (
          <span className={cn("truncate text-xs text-current", isNumeric && "block text-right")}>
            {value ?? "—"}
          </span>
        );
      }
      return (
        <input
          type="text"
          inputMode={isNumeric ? "decimal" : undefined}
          defaultValue={value ?? ""}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            const next = event.target.value;
            if (next === (value ?? "")) return;
            onChange?.(row.client.id, field.id, next || null);
          }}
          className={cn(
            "w-full bg-transparent text-xs text-current outline-none placeholder:text-neutral-500",
            isNumeric && "text-right",
          )}
          placeholder={field.field_type === "currency" ? "e.g. 8000 zł" : "—"}
        />
      );
    },
    sortValue: (row) => getCustomFieldSortValue(field, lookup(row)),
  };
}

interface MegaRowProps {
  row: ClientMegaRow;
  rIdx: number;
  cols: MegaColumn[];
  widths: number[];
  stickyOffsets: Map<number, number>;
  colBorderClasses: string[];
  onRowClick: (clientId: string) => void;
  onHighlight: (clientId: string, colId: string) => void;
  selectionStore: SelectionStore;
}

const MegaRow = memo(function MegaRow({
  row,
  rIdx,
  cols,
  widths,
  stickyOffsets,
  colBorderClasses,
  onRowClick,
  onHighlight,
  selectionStore,
}: MegaRowProps) {
  const isSelected = useSyncExternalStore(
    selectionStore.subscribe,
    () => selectionStore.get().clientId === row.client.id,
    () => false,
  );
  // Returns colId only for the selected row; null for all others → snapshot is
  // primitive-stable so non-selected rows never re-render on column changes.
  const selectedColId = useSyncExternalStore(
    selectionStore.subscribe,
    () => (selectionStore.get().clientId === row.client.id ? selectionStore.get().colId : null),
    () => null,
  );
  const rowTint = rIdx % 2 ? "bg-black/20" : "bg-transparent";

  return (
    <div
      aria-label={`Row for ${row.client.name}`}
      className={cn(
        "flex h-10 w-full",
        rowTint,
        isSelected ? "outline outline-1 outline-sky-400/60" : "hover:bg-white/5",
      )}
    >
      {cols.map((col, i) => {
        const w = widths[i] ?? col.width;
        const style: CSSProperties = { width: w, minWidth: w };
        if (col.sticky) {
          style.position = "sticky";
          style.left = stickyOffsets.get(i) ?? 0;
          style.zIndex = 5;
          style.background = isSelected
            ? rIdx % 2 ? "#0d1518" : "#0a1216"
            : rIdx % 2
            ? "#0a0a0a"
            : "#070707";
        }

        const condition = cellCondition(row, col);
        const content = col.ordinal ? String(rIdx + 1) : col.render(row);
        const opensDrawer = col.id === "name";
        const isCellSelected = selectedColId !== null && col.id === selectedColId;

        return (
          <div
            key={col.id}
            style={style}
            role={opensDrawer ? "button" : undefined}
            aria-label={opensDrawer ? `Open details for ${row.client.name}` : undefined}
            onClick={() => opensDrawer ? onRowClick(row.client.id) : onHighlight(row.client.id, col.id)}
            className={cn(
              "flex cursor-pointer items-center px-1.5 text-xs",
              colBorderClasses[i],
              col.align === "left"
                ? "justify-start"
                : col.align === "right"
                ? "justify-end"
                : "justify-center",
              col.sticky ? "shadow-[inset_-2px_0_0_rgba(255,255,255,0.07)]" : "",
              isCellSelected ? "bg-sky-500/15 ring-2 ring-inset ring-sky-400/90" : "",
            )}
          >
            {col.sticky || col.ordinal ? content : renderCellWithCondition(content, condition, isCellSelected)}
          </div>
        );
      })}
    </div>
  );
});

function ClientsMegaTableImpl(props: ClientsMegaTableProps) {
  const {
    rows,
    sort,
    onSortChange,
    onRowClick,
    onHighlight,
    selectionStore,
    storageKey = "table:clients:mega-columns",
    savedWidths,
    onWidthsChange,
    columnOverrides,
    customFields,
    customFieldValuesByClient,
    canEditCustomField,
    onCustomFieldValueChange,
    onNotesChange,
    canEditStatus,
    onStatusChange,
    colsRef,
  } = props;
  useWhyDidYouRender("ClientsMegaTable", props as Record<string, unknown>);
  useDevRenderCount("ClientsMegaTable", () => `rows=${rows.length}`);
  const cols = useMemo(() => {
    const overrideMap = new Map<string, ColumnOverrideRecord>();
    for (const override of columnOverrides ?? []) overrideMap.set(override.column_key, override);

    const emptyValues = new Map<string, ReadonlyMap<string, string | null>>();
    const valueMap = customFieldValuesByClient ?? emptyValues;

    // Built-in entries: apply label override + section reassignment + hidden filter.
    const builtInEntries = MEGA_COLUMNS.flatMap((col, defaultIdx) => {
      const override = overrideMap.get(col.id);
      if (override?.hidden) return [];
      const withNotes = col.id === "notes" && onNotesChange ? { ...col, render: notesCellRender(onNotesChange) } : col;
      const editable =
        withNotes.id === "status" && canEditStatus && onStatusChange
          ? { ...withNotes, render: statusCellRender(onStatusChange) }
          : withNotes;
      const labelled = override?.label_override ? { ...editable, label: override.label_override } : editable;
      const homed = applySectionAssignment(labelled, overrideMap);
      return [{ col: homed as MegaColumn, position: override?.position ?? null, naturalOrder: defaultIdx }];
    });

    // Custom field entries: position from column_overrides (key "cf:{id}") when set,
    // otherwise fall after all built-ins using field.position as tie-breaker.
    const sortedCustom = (customFields ?? []).slice().sort((l, r) => l.position - r.position);
    const customEntries = sortedCustom.map((field, i) => {
      const cfOverride = overrideMap.get(`cf:${field.id}`);
      const col = customFieldColumn(field, valueMap, Boolean(canEditCustomField?.(field.id)), onCustomFieldValueChange);
      return {
        col: applySectionAssignment(col, overrideMap),
        position: cfOverride?.position ?? null,
        naturalOrder: MEGA_COLUMNS.length + i,
      };
    });

    // Unified sort: explicit position first (ascending), then natural order.
    const ordered = [...builtInEntries, ...customEntries]
      .sort((a, b) => {
        const ap = a.position, bp = b.position;
        if (ap !== null && bp !== null) return ap - bp;
        if (ap !== null) return -1;
        if (bp !== null) return 1;
        return a.naturalOrder - b.naturalOrder;
      })
      .map((e) => e.col);

    // Apply section (sub-band) name overrides. Stored under the synthetic key
    // `section:<original sub>`; every column sharing that sub maps to the same
    // new name, so the band stays contiguous in the boundary/segment logic.
    return ordered.map((col) => {
      const sectionLabel = overrideMap.get(`section:${col.sub}`)?.label_override;
      return sectionLabel ? { ...col, sub: sectionLabel } : col;
    });
  }, [columnOverrides, customFields, customFieldValuesByClient, canEditCustomField, onCustomFieldValueChange, onNotesChange, canEditStatus, onStatusChange]);

  const defaultWidths = useMemo(() => cols.map((c) => c.width), [cols]);
  const minWidths = useMemo(() => cols.map((c) => c.minWidth), [cols]);

  // Recompute sticky indices based on the derived `cols` (hidden columns may
  // have removed some entries between MEGA_COLUMNS and `cols`).
  const stickyIndicesDerived = useMemo(
    () => cols.map((c, i) => (c.sticky ? i : -1)).filter((i) => i >= 0),
    [cols],
  );

  // Widths persist per column id, not per position: this table's column set is dynamic
  // (custom fields, hidden columns, master-admin reordering), and a positional array
  // would hand a saved width to whichever column happens to sit at that index.
  const columnIds = useMemo(() => cols.map((c) => c.id), [cols]);

  const resizable = useResizableColumns({
    storageKey,
    defaultWidths,
    minWidths,
    columnIds,
    savedWidths,
    onWidthsCommit: onWidthsChange,
  });

  const widths = useMemo(() => {
    // useResizableColumns returns a template string; parse it back to numbers.
    return resizable.template
      .split(" ")
      .map((seg) => Number.parseInt(seg.replace("px", ""), 10) || 0);
  }, [resizable.template]);

  const stickyOffsets = useMemo(() => {
    const m = new Map<number, number>();
    let cum = 0;
    for (const i of stickyIndicesDerived) {
      m.set(i, cum);
      cum += widths[i] ?? 0;
    }
    return m;
  }, [stickyIndicesDerived, widths]);
  const totalWidth = useMemo(() => widths.reduce((a, b) => a + b, 0), [widths]);

  // Indices of the last column within each group band — gets a thick separator border.
  const groupBoundarySet = useMemo(() => {
    const s = new Set<number>();
    cols.forEach((col, i) => {
      if (i === cols.length - 1 || cols[i + 1].group !== col.group) s.add(i);
    });
    return s;
  }, [cols]);

  // Indices of the last column within each sub-band — gets a medium separator border.
  const subBoundarySet = useMemo(() => {
    const s = new Set<number>();
    cols.forEach((col, i) => {
      if (i === cols.length - 1 || cols[i + 1].sub !== col.sub) s.add(i);
    });
    return s;
  }, [cols]);

  const subSegments = useMemo(() => {
    const segs: Array<{ sub: string; group: Group; from: number; lastIdx: number; width: number }> = [];
    let cur: { sub: string; group: Group; from: number; lastIdx: number; width: number } | null = null;
    cols.forEach((col, idx) => {
      const w = widths[idx] ?? col.width;
      if (!cur || cur.sub !== col.sub) {
        if (cur) segs.push(cur);
        cur = { sub: col.sub, group: col.group, from: idx, lastIdx: idx, width: w };
      } else {
        cur.width += w;
        cur.lastIdx = idx;
      }
    });
    if (cur) segs.push(cur);
    return segs;
  }, [cols, widths]);

  function colBorderClass(i: number) {
    if (groupBoundarySet.has(i)) return "border-r-2 border-r-white/70";
    if (subBoundarySet.has(i)) return "border-r-2 border-r-white/35";
    return "border-r border-white/10";
  }

  // Precompute per-column border class once so MegaRow gets a referentially
  // stable string[] prop and its memo bails out across renders.
  const colBorderClasses = useMemo(
    () => cols.map((_, i) => colBorderClass(i)),
    // colBorderClass depends on the boundary sets, which depend on cols.
    // cols is module-level; boundary sets are useMemo'd with [cols] deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cols, groupBoundarySet, subBoundarySet],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Keep the parent's colsRef up-to-date so the keyboard handler knows visible col order.
  useEffect(() => {
    if (colsRef) colsRef.current = cols.map((c) => c.id);
  }, [cols, colsRef]);

  // Scroll the table horizontally so the keyboard-selected cell stays visible.
  useEffect(() => {
    const unsubscribe = selectionStore.subscribe(() => {
      const state = selectionStore.get();
      if (!state.colId || !scrollContainerRef.current) return;
      const colIdx = cols.findIndex((c) => c.id === state.colId);
      if (colIdx === -1) return;
      let left = 0;
      for (let i = 0; i < colIdx; i++) left += widths[i] ?? 0;
      const w = widths[colIdx] ?? 0;
      const container = scrollContainerRef.current;
      const scrollLeft = container.scrollLeft;
      const visible = container.clientWidth;
      if (left < scrollLeft) {
        container.scrollLeft = left;
      } else if (left + w > scrollLeft + visible) {
        container.scrollLeft = left + w - visible;
      }
    });
    return unsubscribe;
  }, [selectionStore, cols, widths]);

  function toggleSort(col: MegaColumn) {
    if (sort.key === col.id) {
      onSortChange({ key: col.id, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key: col.id, direction: col.defaultDirection ?? "desc" });
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/20">
      <div ref={scrollContainerRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 20rem)" }}>
        <div style={{ width: totalWidth, minWidth: totalWidth }}>
          {/* Sticky header — three rows stay pinned on vertical scroll */}
          <div className="sticky top-0 z-20 bg-[#080808]">
          {/* Sub bands */}
          <div className="flex h-8 border-b border-white/15 bg-black/30 text-[10px] font-bold tracking-[0.14em] text-foreground">
            {subSegments.map((seg, i) => (
              <div
                key={`s-${seg.from}-${i}`}
                style={{ width: seg.width, minWidth: seg.width }}
                className={cn(
                  "flex items-center justify-center px-2",
                  groupBoundarySet.has(seg.lastIdx) ? "border-r-2 border-r-white/70" : "border-r-2 border-r-white/35",
                )}
              >
                {seg.sub}
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div className="flex h-8 border-b border-white/20 bg-[#080808]">
            {cols.map((col, i) => {
              const isActive = sort.key === col.id;
              const w = widths[i] ?? col.width;
              const isLast = i === cols.length - 1;
              const style: CSSProperties = { width: w, minWidth: w };
              if (col.sticky) {
                style.position = "sticky";
                style.left = stickyOffsets.get(i) ?? 0;
                style.zIndex = 6;
              }
              return (
                <div
                  key={col.id}
                  style={style}
                  className={cn(
                    "group relative flex items-end px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    colBorderClass(i),
                    isActive ? "bg-[#161616] text-foreground" : "bg-[#080808] text-muted-foreground",
                    col.align === "left"
                      ? "justify-start"
                      : col.align === "right"
                      ? "justify-end"
                      : "justify-center",
                    col.sticky ? "shadow-[inset_-2px_0_0_rgba(255,255,255,0.10)]" : "",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        // A <button> does not inherit the header's font, so the size,
                        // weight and uppercase have to be restated here — otherwise the
                        // label falls back to the UA default (16px, mixed case) and the
                        // column-header row reads larger than the sub-band row above it.
                        className="truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-foreground"
                        aria-label={`Sort by ${col.sub} ${col.label}`.trim()}
                      >
                        {col.label}
                        {isActive ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#111] text-xs text-white" sideOffset={6}>
                      {col.sub ? <span className="text-neutral-400">{col.sub} · </span> : null}
                      {col.label}
                    </TooltipContent>
                  </Tooltip>
                  {/* z-10 ensures this handle wins pointer events over the adjacent
                      column header div, which would otherwise paint on top of the
                      -4px overflow zone. Last column gets a left-anchored handle
                      so it is always resizable. */}
                  <div
                    onMouseDown={resizable.getResizeMouseDown(i)}
                    className={cn(
                      "absolute top-0 h-full w-2 cursor-col-resize bg-transparent transition hover:bg-white/15 z-10",
                      isLast ? "-left-1" : "-right-1",
                    )}
                  />
                </div>
              );
            })}
          </div>
          </div>{/* /sticky header */}

          {/* Rows */}
          <div className="divide-y divide-white/10">
            {rows.map((row, rIdx) => (
              <MegaRow
                key={row.client.id}
                row={row}
                rIdx={rIdx}
                cols={cols}
                widths={widths}
                stickyOffsets={stickyOffsets}
                colBorderClasses={colBorderClasses}
                onRowClick={onRowClick}
                onHighlight={onHighlight}
                selectionStore={selectionStore}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ClientsMegaTable = memo(ClientsMegaTableImpl);
