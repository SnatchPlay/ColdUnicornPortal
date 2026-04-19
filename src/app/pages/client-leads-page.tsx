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
} from "../components/portal-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { getClientLeadRows, PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaigns, scopeClients, scopeLeads, scopeReplies } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

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

export function ClientLeadsPage() {
  const { identity } = useAuth();
  const { clients, leads, replies, campaigns, loading, error, refresh } = useCoreData();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [replyScope, setReplyScope] = useState<ReplyScope>("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [leadSort, setLeadSort] = useState<{ key: ClientLeadSortKey; direction: SortDirection }>({
    key: "added",
    direction: "desc",
  });
  const clientLeadColumns = useResizableColumns({
    storageKey: "table:client-leads:columns",
    defaultWidths: [340, 290, 300, 340, 150, 170, 220, 220],
    minWidths: [220, 200, 200, 220, 120, 120, 160, 160],
  });
  const clientLeadTableStyle = useMemo(
    () =>
      ({
        "--client-leads-table-columns": clientLeadColumns.template,
      }) as CSSProperties,
    [clientLeadColumns.template],
  );

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedReplies = useMemo(() => (identity ? scopeReplies(identity, clients, replies) : []), [clients, identity, replies]);
  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (lead) => lead.created_at, timeframe),
    [scopedLeads, timeframe],
  );
  const timeframeReplies = useMemo(
    () => filterByTimeframe(scopedReplies, (reply) => reply.received_at, timeframe),
    [scopedReplies, timeframe],
  );
  const rows = useMemo(
    () => getClientLeadRows(timeframeLeads, scopedCampaigns, timeframeReplies),
    [scopedCampaigns, timeframeLeads, timeframeReplies],
  );
  const stageCounts = useMemo(() => {
    const counts = new Map<PipelineStage, number>();
    for (const row of rows) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = [row.name, row.email, row.company, row.title, row.campaignName].join(" ").toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
      if (stageFilter !== "all" && row.stage !== stageFilter) return false;
      if (campaignFilter !== "all" && row.campaign?.id !== campaignFilter) return false;
      if (replyScope === "ooo" && row.lead.qualification !== "OOO") return false;
      if (replyScope === "active" && row.lead.qualification === "OOO") return false;
      return true;
    });
  }, [campaignFilter, query, replyScope, rows, stageFilter]);

  const sortedRows = useMemo(() => {
    return filteredRows.slice().sort((left, right) => {
      if (leadSort.key === "lead") {
        return compareText(left.name, right.name, leadSort.direction);
      }
      if (leadSort.key === "company") {
        return compareText(left.company, right.company, leadSort.direction);
      }
      if (leadSort.key === "status") {
        return compareText(left.stage, right.stage, leadSort.direction);
      }
      if (leadSort.key === "campaign") {
        return compareText(left.campaignName, right.campaignName, leadSort.direction);
      }
      if (leadSort.key === "step") {
        return compareNumber(left.step, right.step, leadSort.direction);
      }
      if (leadSort.key === "replies") {
        return compareNumber(left.replyCount, right.replyCount, leadSort.direction);
      }
      if (leadSort.key === "lastReply") {
        return compareText(left.lastReplyDate, right.lastReplyDate, leadSort.direction);
      }
      return compareText(left.addedDate, right.addedDate, leadSort.direction);
    });
  }, [filteredRows, leadSort.direction, leadSort.key]);

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
  }, [campaignFilter, query, replyScope, stageFilter, timeframe]);

  const visibleRows = useMemo(() => sortedRows.slice(0, visibleRowsCount), [sortedRows, visibleRowsCount]);

  const hasMoreRows = visibleRowsCount < sortedRows.length;

  function handleExportCsv() {
    if (sortedRows.length === 0) return;

    const header = [
      "Lead",
      "Email",
      "Company",
      "Status",
      "Campaign",
      "Step",
      "Replies",
      "Last Reply",
      "Added",
    ];

    const lines = sortedRows.map((row) => [
      row.name,
      row.email,
      row.company,
      row.stage,
      row.campaignName,
      row.step ?? "",
      row.replyCount,
      row.lastReplyDate ? formatDate(row.lastReplyDate, { day: "numeric", month: "short", year: "2-digit" }) : "",
      formatDate(row.addedDate, { day: "numeric", month: "short", year: "2-digit" }),
    ]);

    const csvContent = [header, ...lines].map((line) => line.map((cell) => toCsvCell(cell)).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const suffix = timeframeLabel.toLowerCase().replace(/\s+/g, "-");
    link.href = url;
    link.download = `client-leads-${suffix}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  const selectedRow = sortedRows.find((row) => row.id === selectedLeadId) ?? null;
  const clientName = scopedClients[0]?.name ?? "Client";
  const timeframeLabel = getTimeframeLabel(timeframe);

  if (loading) {
    return <PortalLoadingState title="Loading leads" description="Syncing leads, replies, and campaign context." />;
  }

  if (error) {
    return (
      <PortalErrorState
        title="Leads data is unavailable"
        description={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-7">
      <PortalPageHeader
        title="My Pipeline"
        subtitle={`${formatNumber(sortedRows.length)} leads · ${timeframeLabel.toLowerCase()} · click a row to open details`}
        actions={
          <div className="flex flex-wrap gap-3">
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
            <button
              onClick={handleExportCsv}
              disabled={sortedRows.length === 0}
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
          All <span className="ml-1 text-neutral-500">{rows.length}</span>
        </FilterChip>
        {PIPELINE_STAGES.map((stage) => (
          <FilterChip key={stage.key} active={stageFilter === stage.key} onClick={() => setStageFilter(stage.key)}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
            {stage.label} <span className="ml-1 text-neutral-500">{stageCounts.get(stage.key) ?? 0}</span>
          </FilterChip>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_250px_220px]">
        <PortalSearch value={query} onChange={setQuery} placeholder="Search by name, company or email..." />
        <Select value={campaignFilter} onValueChange={setCampaignFilter}>
          <SelectTrigger
            aria-label="Filter leads by campaign"
            className="h-[52px] rounded-2xl border-[#242424] bg-[#050505] px-5 text-base text-neutral-300"
          >
            <SelectValue placeholder="All Campaigns" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">
              All Campaigns
            </SelectItem>
            {scopedCampaigns.map((campaign) => (
              <SelectItem
                key={campaign.id}
                value={campaign.id}
                className="text-white focus:bg-[#1a1a1a] focus:text-white"
              >
                {campaign.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={replyScope} onValueChange={(value) => setReplyScope(value as ReplyScope)}>
          <SelectTrigger
            aria-label="Filter leads by reply type"
            className="h-[52px] rounded-2xl border-[#242424] bg-[#050505] px-5 text-base text-neutral-300"
          >
            <SelectValue placeholder="All (OOO + Active)" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">
              All (OOO + Active)
            </SelectItem>
            <SelectItem value="active" className="text-white focus:bg-[#1a1a1a] focus:text-white">
              Active only
            </SelectItem>
            <SelectItem value="ooo" className="text-white focus:bg-[#1a1a1a] focus:text-white">
              OOO only
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sortedRows.length === 0 ? (
        <EmptyPortalState title="No leads match the current filters" description={`${clientName} has no leads in this view.`} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#242424] bg-[#050505]">
          <div className="space-y-3 p-3 xl:hidden">
            {visibleRows.map((row) => (
              <button
                key={row.id}
                onClick={() => setSelectedLeadId(row.id)}
                aria-label={`Open lead details for ${row.name}`}
                aria-haspopup="dialog"
                aria-controls="lead-drawer"
                aria-expanded={selectedLeadId === row.id}
                className="w-full rounded-2xl border border-[#1f1f1f] bg-[#0b0b0b] p-4 text-left transition hover:border-[#313131]"
              >
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500 text-sm text-white">
                      {row.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base text-white">{row.name}</p>
                      <p className="truncate text-sm text-neutral-400">{row.email}</p>
                    </div>
                  </div>
                  <PipelineBadge stage={row.stage} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-neutral-500">Company</p>
                    <p className="truncate text-neutral-100">{row.company}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Campaign</p>
                    <p className="truncate text-neutral-100">{row.campaignName}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Step</p>
                    <p className="text-neutral-100">{row.step ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Replies</p>
                    <p className="text-neutral-100">{row.replyCount}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-sm text-neutral-400">
                  <span>
                    Last reply: {row.lastReplyDate ? formatDate(row.lastReplyDate, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                  </span>
                  <span>Added: {formatDate(row.addedDate, { day: "numeric", month: "short", year: "2-digit" })}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="hidden overflow-x-auto xl:block" style={clientLeadTableStyle}>
            <div className="min-w-[1900px] gap-5 border-b border-[#1f1f1f] px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 [grid-template-columns:var(--client-leads-table-columns)] xl:grid">
              {[
                { key: "lead" as const, label: "Lead" },
                { key: "company" as const, label: "Company" },
                { key: "status" as const, label: "Status" },
                { key: "campaign" as const, label: "Campaign" },
                { key: "step" as const, label: "Step #" },
                { key: "replies" as const, label: "Replies" },
                { key: "lastReply" as const, label: "Last Reply" },
                { key: "added" as const, label: "Added" },
              ].map((column, index, collection) => (
                <div key={column.key} className="relative min-w-0">
                  <button
                    onClick={() =>
                      setLeadSort((current) =>
                        current.key === column.key
                          ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                          : { key: column.key, direction: column.key === "added" || column.key === "lastReply" ? "desc" : "asc" },
                      )
                    }
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
              {visibleRows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setSelectedLeadId(row.id)}
                  aria-label={`Open lead details for ${row.name}`}
                  aria-haspopup="dialog"
                  aria-controls="lead-drawer"
                  aria-expanded={selectedLeadId === row.id}
                  className="grid min-w-[1900px] w-full [grid-template-columns:var(--client-leads-table-columns)] gap-5 px-5 py-4 text-left transition hover:bg-[#0d0d0d]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500 text-sm text-white">
                      {row.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base text-white">{row.name}</p>
                      <p className="truncate text-sm text-neutral-400">{row.email}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base text-white">{row.company}</p>
                    <p className="truncate text-sm text-neutral-400">{row.title}</p>
                  </div>
                  <div>
                    <PipelineBadge stage={row.stage} />
                  </div>
                  <p className="truncate text-sm text-neutral-300">{row.campaignName}</p>
                  <span className="w-fit rounded-xl bg-[#202020] px-3 py-2 text-sm text-white">{row.step ?? "—"}</span>
                  <div className="flex items-center gap-2 text-sm text-white">
                    <MessageSquare className="h-4 w-4 text-neutral-400" />
                    {row.replyCount}
                  </div>
                  <p className="text-sm text-neutral-300">
                    {row.lastReplyDate ? formatDate(row.lastReplyDate, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                  </p>
                  <p className="text-sm text-neutral-300">{formatDate(row.addedDate, { day: "numeric", month: "short", year: "2-digit" })}</p>
                </button>
              ))}
            </div>
          </div>

          {hasMoreRows && (
            <div className="border-t border-[#1f1f1f] px-5 py-4">
              <button
                onClick={() => setVisibleRowsCount((current) => current + PAGE_SIZE)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2d2d2d] px-4 py-2 text-sm text-neutral-200 transition hover:border-[#3f3f3f]"
              >
                Load more ({formatNumber(sortedRows.length - visibleRowsCount)} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      <LeadDrawer open={Boolean(selectedRow)} onClose={() => setSelectedLeadId(null)} lead={selectedRow} />
    </div>
  );
}

