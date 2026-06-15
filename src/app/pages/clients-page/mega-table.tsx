import { memo, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useDevRenderCount, useWhyDidYouRender } from "../../lib/react-profiler-dev";
import type { SelectionStore } from "./selection-store";
import { Badge } from "../../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import type { ClientMetricsPack, DodRow, MomRow, ThreeDodRow, WowRow } from "../../lib/client-metrics";
import type { evaluateClientConditions } from "../../lib/conditions/client-condition-results";
import { dodCellKey, momCellKey, threeDodCellKey, wowCellKey } from "../../lib/conditions/client-condition-results";
import { getCellCondition, getSeverityClassName } from "../../lib/conditions/evaluator";
import type { ConditionEvaluationResult, ConditionSeverity } from "../../lib/conditions/types";
import { formatNumber } from "../../lib/format";
import { useResizableColumns } from "../../lib/use-resizable-columns";
import type {
  ClientCustomFieldRecord,
  ClientRecord,
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
      const cls =
        s === "Active"     ? "status-badge-active" :
        s === "Inactive"   ? "status-badge-inactive" :
        s === "Abo"        ? "status-badge-abo" :
        s === "Sales"      ? "status-badge-sales" :
        s === "On hold"    ? "status-badge-onhold" :
        s === "Offboarding"? "status-badge-offboard" :
        "border-border bg-white/5 text-white";
      return (
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>
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
    render: (row) => formatNum(row.client.min_daily_sent),
    sortValue: (row) => row.client.min_daily_sent ?? null,
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
    id: "bi_setup",
    group: "basic",
    sub: "Basic",
    label: "Bi",
    width: 34,
    minWidth: 28,
    align: "center",
    conditionKey: "bi_setup",
    defaultDirection: "desc",
    render: (row) => (row.client.bi_setup_done ? "✓" : "—"),
    sortValue: (row) => (row.client.bi_setup_done ? 1 : 0),
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

function renderCellWithCondition(content: ReactNode, condition: ConditionEvaluationResult | undefined): ReactNode {
  if (!condition) return <span className="text-white">{content}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={conditionCellWrapperClass(condition.severity)}>{content}</div>
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
  onHighlight: (clientId: string) => void;
  selectionStore: SelectionStore;
  storageKey?: string;
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
}

function customFieldColumn(
  field: ClientCustomFieldRecord,
  valuesByClient: ReadonlyMap<string, ReadonlyMap<string, string | null>>,
  canEdit: boolean,
  onChange?: (clientId: string, fieldId: string, value: string | null) => void,
): MegaColumn {
  const lookup = (row: ClientMegaRow): string | null =>
    valuesByClient.get(row.client.id)?.get(field.id) ?? null;
  return {
    id: `cf:${field.id}`,
    group: "custom",
    sub: "Custom",
    label: field.name,
    width: field.field_type === "checkbox" ? 90 : 160,
    minWidth: field.field_type === "checkbox" ? 70 : 120,
    align: "left",
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
          return <span className="truncate text-xs text-neutral-300">{value ?? "—"}</span>;
        }
        return (
          <select
            value={value ?? ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChange?.(row.client.id, field.id, event.target.value || null)}
            className="w-full bg-transparent text-xs text-neutral-200 outline-none"
          >
            <option value="">—</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      }
      if (!canEdit) {
        return <span className="truncate text-xs text-neutral-300">{value ?? "—"}</span>;
      }
      return (
        <input
          type="text"
          defaultValue={value ?? ""}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            const next = event.target.value;
            if (next === (value ?? "")) return;
            onChange?.(row.client.id, field.id, next || null);
          }}
          className="w-full bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
          placeholder="—"
        />
      );
    },
    sortValue: (row) => lookup(row) ?? "",
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
  onHighlight: (clientId: string) => void;
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
    () => selectionStore.get() === row.client.id,
    () => false,
  );
  const rowTint = rIdx % 2 ? "bg-black/20" : "bg-transparent";

  return (
    <div
      aria-label={`Row for ${row.client.name}`}
      className={cn(
        "flex h-9 w-full",
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
            ? "rgba(56, 189, 248, 0.06)"
            : rIdx % 2
            ? "#0a0a0a"
            : "#070707";
        }

        const condition = cellCondition(row, col);
        const content = col.ordinal ? String(rIdx + 1) : col.render(row);
        const opensDrawer = col.id === "name";

        return (
          <div
            key={col.id}
            style={style}
            role={opensDrawer ? "button" : undefined}
            aria-label={opensDrawer ? `Open details for ${row.client.name}` : undefined}
            onClick={() => opensDrawer ? onRowClick(row.client.id) : onHighlight(row.client.id)}
            className={cn(
              "flex cursor-pointer items-center px-1.5 text-xs",
              colBorderClasses[i],
              col.align === "left"
                ? "justify-start"
                : col.align === "right"
                ? "justify-end"
                : "justify-center",
              col.sticky ? "shadow-[inset_-2px_0_0_rgba(255,255,255,0.07)]" : "",
            )}
          >
            {col.sticky || col.ordinal ? content : renderCellWithCondition(content, condition)}
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
    columnOverrides,
    customFields,
    customFieldValuesByClient,
    canEditCustomField,
    onCustomFieldValueChange,
  } = props;
  useWhyDidYouRender("ClientsMegaTable", props as Record<string, unknown>);
  useDevRenderCount("ClientsMegaTable", () => `rows=${rows.length}`);
  const cols = useMemo(() => {
    const overrideMap = new Map<string, ColumnOverrideRecord>();
    for (const override of columnOverrides ?? []) overrideMap.set(override.column_key, override);

    const emptyValues = new Map<string, ReadonlyMap<string, string | null>>();
    const valueMap = customFieldValuesByClient ?? emptyValues;

    // Built-in entries: apply label override + hidden filter.
    const builtInEntries = MEGA_COLUMNS.flatMap((col, defaultIdx) => {
      const override = overrideMap.get(col.id);
      if (override?.hidden) return [];
      const labelled = override?.label_override ? { ...col, label: override.label_override } : col;
      return [{ col: labelled as MegaColumn, position: override?.position ?? null, naturalOrder: defaultIdx }];
    });

    // Custom field entries: position from column_overrides (key "cf:{id}") when set,
    // otherwise fall after all built-ins using field.position as tie-breaker.
    const sortedCustom = (customFields ?? []).slice().sort((l, r) => l.position - r.position);
    const customEntries = sortedCustom.map((field, i) => {
      const cfOverride = overrideMap.get(`cf:${field.id}`);
      return {
        col: customFieldColumn(field, valueMap, Boolean(canEditCustomField?.(field.id)), onCustomFieldValueChange),
        position: cfOverride?.position ?? null,
        naturalOrder: MEGA_COLUMNS.length + i,
      };
    });

    // Unified sort: explicit position first (ascending), then natural order.
    return [...builtInEntries, ...customEntries]
      .sort((a, b) => {
        const ap = a.position, bp = b.position;
        if (ap !== null && bp !== null) return ap - bp;
        if (ap !== null) return -1;
        if (bp !== null) return 1;
        return a.naturalOrder - b.naturalOrder;
      })
      .map((e) => e.col);
  }, [columnOverrides, customFields, customFieldValuesByClient, canEditCustomField, onCustomFieldValueChange]);

  const defaultWidths = useMemo(() => cols.map((c) => c.width), [cols]);
  const minWidths = useMemo(() => cols.map((c) => c.minWidth), [cols]);

  // Recompute sticky indices based on the derived `cols` (hidden columns may
  // have removed some entries between MEGA_COLUMNS and `cols`).
  const stickyIndicesDerived = useMemo(
    () => cols.map((c, i) => (c.sticky ? i : -1)).filter((i) => i >= 0),
    [cols],
  );

  // Bump the storage key when the column set changes so resize layouts from a
  // different column count don't get re-used.
  const dynamicStorageKey = `${storageKey}:${cols.length}`;

  const resizable = useResizableColumns({
    storageKey: dynamicStorageKey,
    defaultWidths,
    minWidths,
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
    if (groupBoundarySet.has(i)) return "border-r-2 border-r-white/40";
    if (subBoundarySet.has(i)) return "border-r border-r-white/25";
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

  function toggleSort(col: MegaColumn) {
    if (sort.key === col.id) {
      onSortChange({ key: col.id, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key: col.id, direction: col.defaultDirection ?? "desc" });
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/20">
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 20rem)" }}>
        <div style={{ width: totalWidth, minWidth: totalWidth }}>
          {/* Sticky header — three rows stay pinned on vertical scroll */}
          <div className="sticky top-0 z-20 bg-[#080808]">
          {/* Sub bands */}
          <div className="flex h-6 border-b border-white/15 bg-black/30 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
            {subSegments.map((seg, i) => (
              <div
                key={`s-${seg.from}-${i}`}
                style={{ width: seg.width, minWidth: seg.width }}
                className={cn(
                  "flex items-center justify-center px-2",
                  groupBoundarySet.has(seg.lastIdx) ? "border-r-2 border-r-white/40" : "border-r border-r-white/25",
                )}
              >
                {seg.sub}
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div className="flex h-6 border-b border-white/20 bg-[#080808]">
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
                  <button
                    type="button"
                    onClick={() => toggleSort(col)}
                    className="truncate whitespace-nowrap hover:text-foreground"
                    aria-label={`Sort by ${col.sub} ${col.label}`.trim()}
                  >
                    {col.label}
                    {isActive ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  {!isLast && (
                    <div
                      onMouseDown={resizable.getResizeMouseDown(i)}
                      className="absolute -right-1 top-0 h-full w-2 cursor-col-resize bg-transparent transition hover:bg-white/15"
                    />
                  )}
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
