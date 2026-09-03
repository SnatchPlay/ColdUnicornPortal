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
import { LeadCrmTable } from "../components/lead-crm-table";
import { LeadViewModeSwitcher } from "../components/lead-view-mode-switcher";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { buildLeadReportColumns } from "../lib/lead-report-columns";
import { buildLeadColumnsForViewMode, type LeadCrmColumn } from "../lib/lead-crm-columns";
import { isCrmViewMode, type LeadViewMode } from "../lib/crm/lead-view-mode";
import { useLeadCustomColumns } from "../lib/use-lead-custom-columns";
import { downloadLeadReport } from "../lib/lead-report-export";
import { createDefaultTimeframe, getTimeframeLabel, LEADS_DEFAULT_TIMEFRAME_PRESET, resolveTimeframeBounds } from "../lib/timeframe";
import { formatNumber, getFullName } from "../lib/format";
import { getLeadStage } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useLeadDetail, useLeadsFilterOptions } from "../lib/use-leads";
import { useLeadViewModeList } from "../lib/use-lead-crm";
import { useAuth } from "../providers/auth";
import type { LeadCrmRow, LeadsListParams, LeadsListRow } from "../types/view-contracts";
import type { TimeframeValue } from "../lib/timeframe";

type SortDirection = "asc" | "desc";

const PAGE_SIZE = 50;

/** Stable empties: a fresh `[]` per render would churn every memo downstream of the buffer. */
const EMPTY_ROWS: LeadsListRow[] = [];
const EMPTY_CUSTOM_VALUES: Array<{ lead_id: string; field_id: string; value: string | null }> = [];

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
  // Which of the three lead tables is on screen (ADR-0013) — the same switcher the internal Leads
  // page carries. Local state, not part of any URL contract.
  const [viewMode, setViewMode] = useState<LeadViewMode>("pdca");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // All time, not the app-wide current-month default: the leads list is a working CRM surface, so an
  // older lead must not be hidden behind a filter the client never set (LEADS_DEFAULT_TIMEFRAME_PRESET).
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => createDefaultTimeframe(LEADS_DEFAULT_TIMEFRAME_PRESET));
  const [loadPage, setLoadPage] = useState(1);
  const [leadSort, setLeadSort] = useState<{ key: string; direction: SortDirection }>({ key: "created", direction: "desc" });

  // resolveTimeframeBounds returns { start, end } (end is end-of-day); send full ISO so the
  // final day is included inclusively.
  const { start: timeframeFrom, end: timeframeTo } = useMemo(() => resolveTimeframeBounds(timeframe), [timeframe]);

  // The identity of the current result set. `isCrmViewMode`, not `viewMode`: CRM and Combined render
  // the SAME response through different columns, so switching between them must not discard rows.
  const isCrmView = isCrmViewMode(viewMode);
  const filterKey = JSON.stringify({ campaignFilter, timeframeFrom, timeframeTo, committedSearch, leadSort, isCrmView });

  // Load-more pagination. The buffer carries the `filterKey` that produced it, so a stale buffer is
  // never rendered through the new mode's table and never counted as a loaded page: on the render that
  // changes the key the reset effect has not run yet, and rows of the other shape would paint a screen
  // of em-dashes (and re-fetch the old page number) before it does.
  const [accumulated, setAccumulated] = useState<{
    key: string;
    rows: LeadsListRow[];
    customValues: Array<{ lead_id: string; field_id: string; value: string | null }>;
  }>(() => ({ key: filterKey, rows: [], customValues: [] }));
  const isBufferCurrent = accumulated.key === filterKey;
  const accumulatedRows = isBufferCurrent ? accumulated.rows : EMPTY_ROWS;
  const accumulatedCustomValues = isBufferCurrent ? accumulated.customValues : EMPTY_CUSTOM_VALUES;
  // A dropped buffer is back at page 1 — never re-request the page number the previous result set was
  // paginated to (`loadLeadCrmList` is the heaviest query in the app).
  const page = isBufferCurrent ? loadPage : 1;

  const listParams = useMemo<LeadsListParams>(() => ({
    campaignId: campaignFilter !== "all" ? campaignFilter : undefined,
    dateFrom: timeframeFrom?.toISOString(),
    dateTo: timeframeTo?.toISOString(),
    search: committedSearch || undefined,
    sortField: leadSort.key,
    sortDir: leadSort.direction,
    page,
    pageSize: PAGE_SIZE,
  }), [campaignFilter, timeframeFrom, timeframeTo, committedSearch, leadSort, page]);

  // View switcher (ADR-0013), same loader as the internal page: PDCA = the report table; CRM = the
  // banded CRM table; combined = the calm union. Only the active mode's action is fetched. The gateway
  // nulls internal-only CRM fields for the client role, and the column builder drops those columns.
  const { data, isDataCurrent, loading, error, refresh, asOf: crmAsOf, businessDays: crmBusinessDays, healthContext: crmHealthContext } =
    useLeadViewModeList(listParams, viewMode);
  const { data: filterOptions } = useLeadsFilterOptions();

  useEffect(() => {
    setLoadPage(1);
    setAccumulated({ key: filterKey, rows: [], customValues: [] });
  }, [filterKey]);

  // Append the new page to the buffer (or seed it on page 1), stamped with the key it belongs to.
  // `isDataCurrent` is the guard that makes the stamp trustworthy: this effect runs after the render
  // that changed the filters or the mode, when the loader may still be holding the previous response.
  useEffect(() => {
    if (!data || !isDataCurrent) return;
    setAccumulated((prev) => (page === 1 || prev.key !== filterKey
      ? { key: filterKey, rows: data.rows, customValues: data.customValues ?? [] }
      : { key: filterKey, rows: [...prev.rows, ...data.rows], customValues: [...prev.customValues, ...(data.customValues ?? [])] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isDataCurrent]);

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

  // CRM view columns (none in PDCA mode). The builder already omits the internal-only columns for the
  // client role — the gateway nulls those fields too — and the process-issue rollup is internal-only.
  const crmColumns = useMemo<LeadCrmColumn[]>(() => buildLeadColumnsForViewMode({
    viewMode,
    reportColumns: columns,
    role: identity?.role,
    showClient: false,
    asOf: crmAsOf,
    businessDays: crmBusinessDays,
  }), [identity?.role, viewMode, columns, crmAsOf, crmBusinessDays]);
  // Stage strip + health colours are the CRM mode's chrome; combined is deliberately calm (spec B.3).
  const showCrmChrome = viewMode === "crm";

  // Stage filter applied client-side to accumulated rows.
  const stageFilteredRows = useMemo(
    () => stageFilter === "all" ? accumulatedRows : accumulatedRows.filter((r) => getLeadStage(r) === stageFilter),
    [accumulatedRows, stageFilter],
  );

  const hasMoreRows = data && isBufferCurrent ? (page * PAGE_SIZE) < totalCount : false;

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

      <div className="flex flex-wrap items-center gap-2">
        <LeadViewModeSwitcher value={viewMode} onChange={setViewMode} />
        <span aria-hidden className="hidden h-5 w-px bg-white/10 sm:block" />
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

      {/* States render INSIDE the layout, never as an early return: the switcher has to stay on screen
          or a failing mode would strand the client with no way back. They also only replace the table
          when there is nothing to replace — a failed `Load more` must not blow away the loaded rows. */}
      {stageFilteredRows.length > 0 ? null : loading ? (
        <PortalLoadingState title="Loading leads" description="Syncing leads, replies, and campaign context." />
      ) : error ? (
        <PortalErrorState title="Leads data is unavailable" description={error} onRetry={() => void refresh()} />
      ) : (
        <EmptyPortalState title="No leads match the current filters" description={`${clientName} has no leads in this view.`} />
      )}

      {stageFilteredRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#242424] bg-[#050505]">
          {isCrmView ? (
            <LeadCrmTable
              rows={stageFilteredRows as LeadCrmRow[]}
              columns={crmColumns}
              onRowClick={(row) => setSelectedLeadId(row.id)}
              selectedId={selectedLeadId}
              rowAriaLabel={(row) => `Open lead details for ${getFullName(row.first_name, row.last_name)}`}
              showStageStrip={showCrmChrome}
              showHealth={showCrmChrome}
              healthContext={crmHealthContext}
            />
          ) : (
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
          )}

          {hasMoreRows && (
            <div className="border-t border-[#1f1f1f] px-5 py-4">
              <button
                onClick={() => setLoadPage((p) => p + 1)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2d2d2d] px-4 py-2 text-sm text-neutral-200 transition hover:border-[#3f3f3f] disabled:opacity-50"
              >
                {loading ? "Loading…" : `Load more (${formatNumber(totalCount - (page * PAGE_SIZE))} remaining)`}
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
