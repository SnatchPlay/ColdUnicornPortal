import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  DateRangeButton,
  EmptyPortalState,
  FilterChip,
  LeadDrawer,
  PortalErrorState,
  PortalLoadingState,
  PortalPageHeader,
  PortalSearch,
  type LeadDrawerData,
} from "../components/portal-ui";
import { LeadReportTable } from "../components/lead-report-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { buildLeadReportColumns } from "../lib/lead-report-columns";
import { useLeadCustomColumns } from "../lib/use-lead-custom-columns";
import { downloadLeadReport } from "../lib/lead-report-export";
import { createDefaultTimeframe, getTimeframeLabel, resolveTimeframeBounds } from "../lib/timeframe";
import { formatNumber, getFullName } from "../lib/format";
import { getLeadStage } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useLeadsList, useLeadDetail, useLeadsFilterOptions } from "../lib/use-leads";
import { useAuth } from "../providers/auth";
import type { LeadsListParams, LeadsListRow } from "../types/view-contracts";
import type { TimeframeValue } from "../lib/timeframe";

type SortDirection = "asc" | "desc";

const PAGE_SIZE = 50;

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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => createDefaultTimeframe());
  // Load-more pagination: accumulates rows across pages.
  const [loadPage, setLoadPage] = useState(1);
  const [accumulatedRows, setAccumulatedRows] = useState<LeadsListRow[]>([]);
  const [accumulatedCustomValues, setAccumulatedCustomValues] = useState<Array<{ lead_id: string; field_id: string; value: string | null }>>([]);
  const [leadSort, setLeadSort] = useState<{ key: string; direction: SortDirection }>({ key: "created", direction: "desc" });

  // resolveTimeframeBounds returns { start, end } (end is end-of-day); send full ISO so the
  // final day is included inclusively.
  const { start: timeframeFrom, end: timeframeTo } = useMemo(() => resolveTimeframeBounds(timeframe), [timeframe]);

  const listParams = useMemo<LeadsListParams>(() => ({
    campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
    dateFrom: timeframeFrom?.toISOString(),
    dateTo: timeframeTo?.toISOString(),
    search: committedSearch || undefined,
    sortField: leadSort.key,
    sortDir: leadSort.direction,
    page: loadPage,
    pageSize: PAGE_SIZE,
  }), [campaignFilter, timeframeFrom, timeframeTo, committedSearch, leadSort, loadPage]);

  const { data, loading, error, refresh } = useLeadsList(listParams);
  const { data: filterOptions } = useLeadsFilterOptions();

  // Reset accumulation when any filter changes (loadPage goes back to 1).
  const filterKey = JSON.stringify({ campaignFilter, timeframeFrom, timeframeTo, committedSearch, leadSort });
  useEffect(() => {
    setLoadPage(1);
    setAccumulatedRows([]);
    setAccumulatedCustomValues([]);
  }, [filterKey]);

  // Append new rows + custom values to accumulation (or reset on page 1).
  useEffect(() => {
    if (!data) return;
    if (loadPage === 1) {
      setAccumulatedRows(data.rows);
      setAccumulatedCustomValues(data.customValues ?? []);
    } else {
      setAccumulatedRows((prev) => [...prev, ...data.rows]);
      setAccumulatedCustomValues((prev) => [...prev, ...(data.customValues ?? [])]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const stageCounts = data?.stageCounts ?? {};
  const totalCount = data?.totalCount ?? 0;
  const campaignsLite = useMemo(() => filterOptions?.campaignsLite ?? [], [filterOptions]);
  const clientName = filterOptions?.clientsLite[0]?.name ?? identity?.fullName ?? "Client";
  const timeframeLabel = getTimeframeLabel(timeframe);

  // Report columns = base columns + per-client custom columns (Task 4F).
  const baseColumns = useMemo(
    () => buildLeadReportColumns({ role: identity?.role, showClient: false }),
    [identity?.role],
  );
  const customFields = useMemo(() => data?.customFields ?? [], [data]);
  const customColumns = useLeadCustomColumns({ role: identity?.role, fields: customFields, values: accumulatedCustomValues });
  const columns = useMemo(() => [...baseColumns, ...customColumns], [baseColumns, customColumns]);
  const defaultWidths = useMemo(() => columns.map((c) => c.width), [columns]);
  const minWidths = useMemo(() => columns.map((c) => c.minWidth), [columns]);
  const leadColumns = useResizableColumns({
    storageKey: `table:client-leads-report:columns:${columns.length}`,
    defaultWidths,
    minWidths,
  });

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

  function handleSortChange(serverField: string) {
    setLeadSort((current) =>
      current.key === serverField
        ? { key: serverField, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: serverField, direction: serverField === "created" || serverField === "lastReply" ? "desc" : "asc" },
    );
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport(format: "csv" | "xlsx") {
    setExporting(true);
    try {
      const { page: _page, pageSize: _pageSize, ...base } = listParams;
      void _page; void _pageSize;
      await downloadLeadReport(columns, base, format, `client-leads-${timeframeLabel.toLowerCase().replace(/\s+/g, "-")}`);
    } catch {
      // Surfaced via the disabled state; client portal has no toast host on this surface.
    } finally {
      setExporting(false);
    }
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
              onClick={() => void handleExport("csv")}
              disabled={totalCount === 0 || exporting}
              className="inline-flex items-center gap-2 rounded-xl border border-[#242424] bg-[#0f0f0f] px-4 py-2.5 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting…" : "CSV"}
            </button>
            <button
              onClick={() => void handleExport("xlsx")}
              disabled={totalCount === 0 || exporting}
              className="inline-flex items-center gap-2 rounded-xl border border-[#242424] bg-[#0f0f0f] px-4 py-2.5 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Download className="h-4 w-4" />
              XLSX
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
      </div>

      {stageFilteredRows.length === 0 && !loading ? (
        <EmptyPortalState title="No leads match the current filters" description={`${clientName} has no leads in this view.`} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#242424] bg-[#050505]">
          <LeadReportTable
            rows={stageFilteredRows}
            columns={columns}
            template={leadColumns.template}
            getResizeMouseDown={leadColumns.getResizeMouseDown}
            sort={leadSort}
            onSortChange={handleSortChange}
            onRowClick={(row) => setSelectedLeadId(row.id)}
            selectedId={selectedLeadId}
            rowAriaLabel={(row) => `Open lead details for ${getFullName(row.first_name, row.last_name)}`}
          />

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
