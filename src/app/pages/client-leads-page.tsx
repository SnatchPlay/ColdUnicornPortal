import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Download, MessageSquare } from "lucide-react";
import {
  DateRangeButton,
  EmptyPortalState,
  FilterChip,
  LeadDrawer,
  PipelineBadge,
  PortalErrorState,
  PortalLoadingState,
  PortalPageHeader,
  PortalSearch,
  type LeadDrawerData,
} from "../components/portal-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { createDefaultTimeframe, getTimeframeLabel, resolveTimeframeBounds } from "../lib/timeframe";
import { formatDate, formatNumber, getFullName } from "../lib/format";
import { getLeadStage } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useLeadsList, useLeadDetail, useLeadsFilterOptions } from "../lib/use-leads";
import { useAuth } from "../providers/auth";
import type { LeadsListParams, LeadsListRow } from "../types/view-contracts";
import type { TimeframeValue } from "../lib/timeframe";

type ReplyScope = "all" | "active" | "ooo";
type SortDirection = "asc" | "desc";
type ClientLeadSortKey = "lead" | "company" | "status" | "campaign" | "step" | "replies" | "lastReply" | "added";

const PAGE_SIZE = 50;

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const safeLeft = (left ?? "").toLowerCase();
  const safeRight = (right ?? "").toLowerCase();
  const result = safeLeft.localeCompare(safeRight);
  return direction === "asc" ? result : -result;
}

function compareNumber(left: number | null | undefined, right: number | null | undefined, direction: SortDirection) {
  const safeLeft = left ?? Number.NEGATIVE_INFINITY;
  const safeRight = right ?? Number.NEGATIVE_INFINITY;
  const result = safeLeft - safeRight;
  return direction === "asc" ? result : -result;
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "sort";
  return direction === "asc" ? "asc" : "desc";
}

function toCsvCell(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(/"/g, '""');
  return `"${normalized}"`;
}

/** Derive a LeadDrawerData-compatible row from a LeadsListRow + lazy replies. */
function toDrawerData(row: LeadsListRow, replies: ReturnType<typeof useLeadDetail>["replies"]): LeadDrawerData {
  const stage = getLeadStage(row) as PipelineStage;
  const fullName = getFullName(row.first_name, row.last_name);
  return {
    lead: row,
    replies,
    name: fullName,
    initials: fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase(),
    email: row.email ?? "No email",
    title: row.job_title ?? "No title",
    company: row.company_name ?? "No company",
    stage,
    campaignName: row.campaignName ?? "No campaign linked",
    step: row.message_number ?? (replies[0]?.sequence_step ?? null),
    replyCount: row.replyCount || (row.reply_text?.trim() ? 1 : 0),
    lastReplyDate: row.lastReplyAt ?? (row.reply_text?.trim() ? row.updated_at : null),
    addedDate: row.created_at,
  };
}

export function ClientLeadsPage() {
  const { identity } = useAuth();
  const [query, setQuery] = useState("");
  // Debounce search: send to server only after 400ms idle — LIKE scan has no trigram index.
  const [committedSearch, setCommittedSearch] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setCommittedSearch(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [replyScope, setReplyScope] = useState<ReplyScope>("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => createDefaultTimeframe());
  // Load-more pagination: accumulates rows across pages.
  const [loadPage, setLoadPage] = useState(1);
  const [accumulatedRows, setAccumulatedRows] = useState<LeadsListRow[]>([]);
  const [leadSort, setLeadSort] = useState<{ key: ClientLeadSortKey; direction: SortDirection }>({ key: "added", direction: "desc" });

  const clientLeadColumns = useResizableColumns({
    storageKey: "table:client-leads:columns",
    defaultWidths: [340, 290, 300, 340, 150, 170, 220, 220],
    minWidths: [220, 200, 200, 220, 120, 120, 160, 160],
  });
  const clientLeadTableStyle = useMemo(
    () => ({ "--client-leads-table-columns": clientLeadColumns.template }) as CSSProperties,
    [clientLeadColumns.template],
  );

  const { from: timeframeFrom, to: timeframeTo } = useMemo(() => resolveTimeframeBounds(timeframe), [timeframe]);

  const listParams = useMemo<LeadsListParams>(() => ({
    campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
    replyScope,
    dateFrom: timeframeFrom?.toISOString().slice(0, 10),
    dateTo: timeframeTo?.toISOString().slice(0, 10),
    search: committedSearch || undefined,
    sortField: leadSort.key,
    sortDir: leadSort.direction,
    page: loadPage,
    pageSize: PAGE_SIZE,
  }), [campaignFilter, replyScope, timeframeFrom, timeframeTo, committedSearch, leadSort, loadPage]);

  const { data, loading, error, refresh } = useLeadsList(listParams);
  const { data: filterOptions } = useLeadsFilterOptions();

  // Reset accumulation when any filter changes (loadPage goes back to 1).
  const filterKey = JSON.stringify({ campaignFilter, replyScope, timeframeFrom, timeframeTo, committedSearch, leadSort });
  useEffect(() => {
    setLoadPage(1);
    setAccumulatedRows([]);
  }, [filterKey]);

  // Append new rows to accumulation (or reset on page 1).
  useEffect(() => {
    if (!data) return;
    if (loadPage === 1) {
      setAccumulatedRows(data.rows);
    } else {
      setAccumulatedRows((prev) => [...prev, ...data.rows]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const stageCounts = data?.stageCounts ?? {};
  const totalCount = data?.totalCount ?? 0;
  const campaignsLite = useMemo(() => filterOptions?.campaignsLite ?? [], [filterOptions]);
  const clientName = filterOptions?.clientsLite[0]?.name ?? identity?.fullName ?? "Client";
  const timeframeLabel = getTimeframeLabel(timeframe);

  // Stage filter applied client-side to accumulated rows.
  const stageFilteredRows = useMemo(
    () => stageFilter === "all" ? accumulatedRows : accumulatedRows.filter((r) => getLeadStage(r) === stageFilter),
    [accumulatedRows, stageFilter],
  );

  const hasMoreRows = data ? (loadPage * PAGE_SIZE) < totalCount : false;

  const selectedRow = stageFilteredRows.find((r) => r.id === selectedLeadId) ?? null;
  const { replies: selectedReplies } = useLeadDetail(selectedLeadId);

  const drawerLead = useMemo<LeadDrawerData | null>(
    () => (selectedRow ? toDrawerData(selectedRow, selectedReplies) : null),
    [selectedRow, selectedReplies],
  );

  function handleExportCsv() {
    if (stageFilteredRows.length === 0) return;
    const header = ["Lead", "Email", "Company", "Status", "Campaign", "Step", "Replies", "Last Reply", "Added"];
    const lines = stageFilteredRows.map((row) => [
      getFullName(row.first_name, row.last_name),
      row.email,
      row.company_name,
      getLeadStage(row),
      row.campaignName,
      row.message_number ?? "",
      row.replyCount,
      row.lastReplyAt ? formatDate(row.lastReplyAt, { day: "numeric", month: "short", year: "2-digit" }) : "",
      formatDate(row.created_at, { day: "numeric", month: "short", year: "2-digit" }),
    ]);
    const csvContent = [header, ...lines].map((line) => line.map((cell) => toCsvCell(cell)).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `client-leads-${timeframeLabel.toLowerCase().replace(/\s+/g, "-")}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  if (loading && accumulatedRows.length === 0) {
    return <PortalLoadingState title="Loading leads" description="Syncing leads, replies, and campaign context." />;
  }

  if (error && accumulatedRows.length === 0) {
    return <PortalErrorState title="Leads data is unavailable" description={error} onRetry={() => void refresh()} />;
  }

  return (
    <div className="space-y-7">
      <PortalPageHeader
        title="My Pipeline"
        subtitle={`${formatNumber(totalCount)} leads · ${timeframeLabel.toLowerCase()} · click a row to open details`}
        actions={
          <div className="flex flex-wrap gap-3">
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
            <button
              onClick={handleExportCsv}
              disabled={stageFilteredRows.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-[#242424] px-4 py-2.5 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <FilterChip active={stageFilter === "all"} onClick={() => setStageFilter("all")}>
          All <span className="ml-1 text-neutral-500">{totalCount}</span>
        </FilterChip>
        {PIPELINE_STAGES.map((stage) => (
          <FilterChip key={stage.key} active={stageFilter === stage.key} onClick={() => setStageFilter(stage.key)}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
            {stage.label} <span className="ml-1 text-neutral-500">{stageCounts[stage.key] ?? 0}</span>
          </FilterChip>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_250px_220px]">
        <PortalSearch value={query} onChange={setQuery} placeholder="Search by name, company or email..." />
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger aria-label="Filter leads by campaign" className="h-[52px] rounded-2xl border-[#242424] bg-[#050505] px-5 text-base text-neutral-300">
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">All Campaigns</SelectItem>
            {campaignsLite.map((campaign) => (
              <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{campaign.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={replyScope} onValueChange={(value) => setReplyScope(value as ReplyScope)}>
          <SelectTrigger aria-label="Filter leads by reply type" className="h-[52px] rounded-2xl border-[#242424] bg-[#050505] px-5 text-base text-neutral-300">
            <SelectValue placeholder="All (OOO + Active)" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">All (OOO + Active)</SelectItem>
            <SelectItem value="active" className="text-white focus:bg-[#1a1a1a] focus:text-white">Active only</SelectItem>
            <SelectItem value="ooo" className="text-white focus:bg-[#1a1a1a] focus:text-white">OOO only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {stageFilteredRows.length === 0 && !loading ? (
        <EmptyPortalState title="No leads match the current filters" description={`${clientName} has no leads in this view.`} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#242424] bg-[#050505]">
          {/* Mobile cards */}
          <div className="space-y-3 p-3 xl:hidden">
            {stageFilteredRows.map((row) => {
              const stage = getLeadStage(row) as PipelineStage;
              const fullName = getFullName(row.first_name, row.last_name);
              const initials = fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
              return (
                <button
                  key={row.id}
                  onClick={() => setSelectedLeadId(row.id)}
                  aria-label={`Open lead details for ${fullName}`}
                  aria-haspopup="dialog"
                  aria-controls="lead-drawer"
                  aria-expanded={selectedLeadId === row.id}
                  className="w-full rounded-2xl border border-[#1f1f1f] bg-[#0b0b0b] p-4 text-left transition hover:border-[#313131]"
                >
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500 text-sm text-white">{initials}</div>
                      <div className="min-w-0">
                        <p className="truncate text-base text-white">{fullName}</p>
                        <p className="truncate text-sm text-neutral-400">{row.email}</p>
                      </div>
                    </div>
                    <PipelineBadge stage={stage} />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-neutral-500">Company</p><p className="truncate text-neutral-100">{row.company_name ?? "—"}</p></div>
                    <div><p className="text-neutral-500">Campaign</p><p className="truncate text-neutral-100">{row.campaignName ?? "—"}</p></div>
                    <div><p className="text-neutral-500">Step</p><p className="text-neutral-100">{row.message_number ?? "—"}</p></div>
                    <div><p className="text-neutral-500">Replies</p><p className="text-neutral-100">{row.replyCount}</p></div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-neutral-400">
                    <span>Last reply: {row.lastReplyAt ? formatDate(row.lastReplyAt, { day: "numeric", month: "short", year: "2-digit" }) : "—"}</span>
                    <span>Added: {formatDate(row.created_at, { day: "numeric", month: "short", year: "2-digit" })}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto xl:block" style={clientLeadTableStyle}>
            <div className="min-w-[1900px] gap-5 border-b border-[#1f1f1f] px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 [grid-template-columns:var(--client-leads-table-columns)] xl:grid">
              {([
                { key: "lead" as const, label: "Lead" },
                { key: "company" as const, label: "Company" },
                { key: "status" as const, label: "Status" },
                { key: "campaign" as const, label: "Campaign" },
                { key: "step" as const, label: "Step #" },
                { key: "replies" as const, label: "Replies" },
                { key: "lastReply" as const, label: "Last Reply" },
                { key: "added" as const, label: "Added" },
              ] as const).map((column, index, collection) => (
                <div key={column.key} className="relative min-w-0">
                  <button
                    onClick={() => setLeadSort((current) =>
                      current.key === column.key
                        ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                        : { key: column.key, direction: column.key === "added" || column.key === "lastReply" ? "desc" : "asc" },
                    )}
                    className="w-full pr-3 text-left text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 transition hover:text-white"
                  >
                    {column.label} ({sortIndicator(leadSort.key === column.key, leadSort.direction)})
                  </button>
                  {index < collection.length - 1 && (
                    <div onMouseDown={clientLeadColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                  )}
                </div>
              ))}
            </div>
            <div className="divide-y divide-[#151515]">
              {stageFilteredRows.map((row) => {
                const stage = getLeadStage(row) as PipelineStage;
                const fullName = getFullName(row.first_name, row.last_name);
                const initials = fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <button
                    key={row.id}
                    onClick={() => setSelectedLeadId(row.id)}
                    aria-label={`Open lead details for ${fullName}`}
                    aria-haspopup="dialog"
                    aria-controls="lead-drawer"
                    aria-expanded={selectedLeadId === row.id}
                    className="grid min-w-[1900px] w-full [grid-template-columns:var(--client-leads-table-columns)] gap-5 px-5 py-4 text-left transition hover:bg-[#0d0d0d]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500 text-sm text-white">{initials}</div>
                      <div className="min-w-0">
                        <p className="truncate text-base text-white">{fullName}</p>
                        <p className="truncate text-sm text-neutral-400">{row.email}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base text-white">{row.company_name ?? "—"}</p>
                      <p className="truncate text-sm text-neutral-400">{row.job_title ?? "—"}</p>
                    </div>
                    <div><PipelineBadge stage={stage} /></div>
                    <p className="truncate text-sm text-neutral-300">{row.campaignName ?? "—"}</p>
                    <span className="w-fit rounded-xl bg-[#202020] px-3 py-2 text-sm text-white">{row.message_number ?? "—"}</span>
                    <div className="flex items-center gap-2 text-sm text-white">
                      <MessageSquare className="h-4 w-4 text-neutral-400" />
                      {row.replyCount}
                    </div>
                    <p className="text-sm text-neutral-300">
                      {row.lastReplyAt ? formatDate(row.lastReplyAt, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                    </p>
                    <p className="text-sm text-neutral-300">{formatDate(row.created_at, { day: "numeric", month: "short", year: "2-digit" })}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {hasMoreRows && (
            <div className="border-t border-[#1f1f1f] px-5 py-4">
              <button
                onClick={() => setLoadPage((p) => p + 1)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2d2d2d] px-4 py-2 text-sm text-neutral-200 transition hover:border-[#3f3f3f] disabled:opacity-50"
              >
                {loading ? "Loading…" : `Load more (${formatNumber(totalCount - (loadPage * PAGE_SIZE))} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Drawer — replies populate lazily via useLeadDetail; drawerLead recomputes when they arrive */}
      <LeadDrawer
        open={Boolean(drawerLead)}
        onClose={() => setSelectedLeadId(null)}
        lead={drawerLead}
      />
    </div>
  );
}
