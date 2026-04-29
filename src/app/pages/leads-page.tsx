import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DateRangeButton } from "../components/portal-ui";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { useIsMobile } from "../components/ui/use-mobile";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { formatDate, getFullName } from "../lib/format";
import { getLeadStage, scopeCampaigns, scopeLeads, scopeReplies } from "../lib/selectors";
import {
  TIMEFRAME_PRESETS,
  createDefaultTimeframe,
  filterByTimeframe,
  getTimeframeLabel,
  type TimeframePreset,
  type TimeframeValue,
} from "../lib/timeframe";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { cn } from "../components/ui/utils";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { LeadRecord, LeadQualification } from "../types/core";
import { ClientLeadsPage } from "./client-leads-page";

const EDITABLE_QUALIFICATIONS: LeadQualification[] = [
  "preMQL",
  "MQL",
  "meeting_scheduled",
  "meeting_held",
  "offer_sent",
  "won",
  "rejected",
];
const LEAD_QUALIFICATION_UNSET = "__lead_unqualified__";
const ALL_FILTER_VALUE = "__all__";
const PAGE_SIZE = 50;
const MAX_PAGE_LINKS = 5;

type ReplyScope = "all" | "active" | "ooo";
type SortDirection = "asc" | "desc";
type LeadSortKey = "lead" | "company" | "status" | "updated";

interface LeadDraft {
  qualification: LeadQualification | "";
  comments: string;
  meetingBooked: boolean;
  meetingHeld: boolean;
  offerSent: boolean;
  won: boolean;
}

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const safeLeft = (left ?? "").toLowerCase();
  const safeRight = (right ?? "").toLowerCase();
  const result = safeLeft.localeCompare(safeRight);
  return direction === "asc" ? result : -result;
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "sort";
  return direction === "asc" ? "asc" : "desc";
}

function toLeadDraft(lead: LeadRecord): LeadDraft {
  return {
    qualification: lead.qualification ?? "",
    comments: lead.comments ?? "",
    meetingBooked: lead.meeting_booked,
    meetingHeld: lead.meeting_held,
    offerSent: lead.offer_sent,
    won: lead.won,
  };
}

function buildLeadPatch(lead: LeadRecord, draft: LeadDraft): Partial<LeadRecord> {
  const patch: Partial<LeadRecord> = {};

  const nextQualification = draft.qualification || null;
  if ((lead.qualification ?? null) !== nextQualification) {
    patch.qualification = nextQualification;
  }
  if ((lead.comments ?? "") !== draft.comments) {
    patch.comments = draft.comments;
  }
  if (lead.meeting_booked !== draft.meetingBooked) {
    patch.meeting_booked = draft.meetingBooked;
  }
  if (lead.meeting_held !== draft.meetingHeld) {
    patch.meeting_held = draft.meetingHeld;
  }
  if (lead.offer_sent !== draft.offerSent) {
    patch.offer_sent = draft.offerSent;
  }
  if (lead.won !== draft.won) {
    patch.won = draft.won;
  }

  return patch;
}

function getStageLabel(stage: PipelineStage) {
  return PIPELINE_STAGES.find((item) => item.key === stage)?.label ?? stage;
}

function getStageColor(stage: PipelineStage) {
  return PIPELINE_STAGES.find((item) => item.key === stage)?.color ?? "#737373";
}

function clampPage(page: number, totalPages: number) {
  if (totalPages <= 0) return 1;
  return Math.min(Math.max(page, 1), totalPages);
}

function parsePage(value: string | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

function buildPageWindow(currentPage: number, totalPages: number) {
  if (totalPages <= MAX_PAGE_LINKS) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const radius = Math.floor(MAX_PAGE_LINKS / 2);
  let start = Math.max(1, currentPage - radius);
  let end = Math.min(totalPages, start + MAX_PAGE_LINKS - 1);
  start = Math.max(1, end - MAX_PAGE_LINKS + 1);

  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}

function isValidTimeframePreset(value: string | null): value is TimeframePreset {
  if (!value) return false;
  if (value === "custom") return true;
  return TIMEFRAME_PRESETS.some((preset) => preset.key === value);
}

function parseTimeframeFromParams(searchParams: URLSearchParams): TimeframeValue {
  const range = searchParams.get("range");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (isValidTimeframePreset(range)) {
    if (range === "custom") {
      return {
        preset: "custom",
        customStart: from,
        customEnd: to,
      };
    }

    return {
      preset: range,
      customStart: null,
      customEnd: null,
    };
  }

  return createDefaultTimeframe();
}

function writeTimeframeToParams(params: URLSearchParams, timeframe: TimeframeValue) {
  params.set("range", timeframe.preset);
  if (timeframe.preset !== "custom") {
    params.delete("from");
    params.delete("to");
    return;
  }

  if (timeframe.customStart) {
    params.set("from", timeframe.customStart);
  } else {
    params.delete("from");
  }

  if (timeframe.customEnd) {
    params.set("to", timeframe.customEnd);
  } else {
    params.delete("to");
  }
}

export function LeadsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientLeadsPage />;
  return <InternalLeadsPage />;
}

function InternalLeadsPage() {
  const { identity } = useAuth();
  const { clients, leads, replies, campaigns, updateLead, loading, error, refresh } = useCoreData();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">(() => {
    const stage = searchParams.get("stage");
    if (stage === "all") return "all";
    if (PIPELINE_STAGES.some((item) => item.key === stage)) return stage as PipelineStage;
    return "all";
  });
  const [campaignFilter, setCampaignFilter] = useState(searchParams.get("campaign") ?? ALL_FILTER_VALUE);
  const [replyScope, setReplyScope] = useState<ReplyScope>(() => {
    const value = searchParams.get("replyScope");
    if (value === "active" || value === "ooo") return value;
    return "all";
  });
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => parseTimeframeFromParams(searchParams));
  const [currentPage, setCurrentPage] = useState(() => parsePage(searchParams.get("page")));
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [leadSort, setLeadSort] = useState<{ key: LeadSortKey; direction: SortDirection }>(() => {
    const sortKey = searchParams.get("sort");
    const sortDirection = searchParams.get("dir");
    const key: LeadSortKey =
      sortKey === "lead" || sortKey === "company" || sortKey === "status" || sortKey === "updated"
        ? sortKey
        : "updated";
    const direction: SortDirection = sortDirection === "asc" || sortDirection === "desc" ? sortDirection : "desc";
    return { key, direction };
  });

  const leadColumns = useResizableColumns({
    storageKey: "table:leads:columns",
    defaultWidths: [380, 300, 220, 200],
    minWidths: [240, 200, 150, 140],
  });

  const leadTableStyle = useMemo(
    () =>
      ({
        "--leads-table-columns": leadColumns.template,
      }) as CSSProperties,
    [leadColumns.template],
  );

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

  const baseFilteredLeads = useMemo(() => {
    return timeframeLeads.filter((lead) => {
      const haystack = [
        getFullName(lead.first_name, lead.last_name),
        lead.email,
        lead.company_name,
        lead.job_title,
        lead.country,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
      if (campaignFilter !== ALL_FILTER_VALUE && lead.campaign_id !== campaignFilter) return false;
      if (replyScope === "ooo" && lead.qualification !== "OOO") return false;
      if (replyScope === "active" && lead.qualification === "OOO") return false;
      return true;
    });
  }, [campaignFilter, query, replyScope, timeframeLeads]);

  const stageCounts = useMemo(() => {
    const counts = new Map<PipelineStage, number>();
    for (const lead of baseFilteredLeads) {
      const stage = getLeadStage(lead);
      counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return counts;
  }, [baseFilteredLeads]);

  const filteredLeads = useMemo(
    () =>
      baseFilteredLeads.filter((lead) => {
        if (stageFilter === "all") return true;
        return getLeadStage(lead) === stageFilter;
      }),
    [baseFilteredLeads, stageFilter],
  );

  const campaignById = useMemo(() => new Map(scopedCampaigns.map((campaign) => [campaign.id, campaign])), [scopedCampaigns]);

  const sortedLeads = useMemo(() => {
    return filteredLeads.slice().sort((left, right) => {
      if (leadSort.key === "lead") {
        return compareText(getFullName(left.first_name, left.last_name), getFullName(right.first_name, right.last_name), leadSort.direction);
      }
      if (leadSort.key === "company") {
        return compareText(left.company_name, right.company_name, leadSort.direction);
      }
      if (leadSort.key === "status") {
        return compareText(getLeadStage(left), getLeadStage(right), leadSort.direction);
      }
      return compareText(left.updated_at, right.updated_at, leadSort.direction);
    });
  }, [filteredLeads, leadSort.direction, leadSort.key]);

  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / PAGE_SIZE));
  const safeCurrentPage = clampPage(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * PAGE_SIZE;
  const visibleLeads = useMemo(() => sortedLeads.slice(pageStart, pageStart + PAGE_SIZE), [pageStart, sortedLeads]);
  const pageWindow = useMemo(() => buildPageWindow(safeCurrentPage, totalPages), [safeCurrentPage, totalPages]);
  const timeframeLabel = getTimeframeLabel(timeframe);

  const selectedLead = sortedLeads.find((item) => item.id === selectedLeadId) ?? null;
  const selectedReplies = scopedReplies
    .filter((item) => item.lead_id === selectedLead?.id)
    .sort((a, b) => b.received_at.localeCompare(a.received_at));

  async function patchLead(lead: LeadRecord, patch: Partial<LeadRecord>) {
    await updateLead(lead.id, patch);
  }

  useEffect(() => {
    if (!selectedLead) {
      setDraft(null);
      return;
    }

    setDraft(toLeadDraft(selectedLead));
  }, [selectedLead]);

  useEffect(() => {
    if (safeCurrentPage !== currentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  useEffect(() => {
    if (selectedLeadId && !sortedLeads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(null);
    }
  }, [selectedLeadId, sortedLeads]);

  useEffect(() => {
    if (!selectedLead) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedLeadId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLead]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);

    if (query.trim()) {
      nextParams.set("q", query.trim());
    } else {
      nextParams.delete("q");
    }

    if (stageFilter !== "all") {
      nextParams.set("stage", stageFilter);
    } else {
      nextParams.delete("stage");
    }

    if (campaignFilter !== ALL_FILTER_VALUE) {
      nextParams.set("campaign", campaignFilter);
    } else {
      nextParams.delete("campaign");
    }

    if (replyScope !== "all") {
      nextParams.set("replyScope", replyScope);
    } else {
      nextParams.delete("replyScope");
    }

    nextParams.set("sort", leadSort.key);
    nextParams.set("dir", leadSort.direction);
    nextParams.set("page", String(safeCurrentPage));
    writeTimeframeToParams(nextParams, timeframe);

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    campaignFilter,
    leadSort.direction,
    leadSort.key,
    query,
    replyScope,
    safeCurrentPage,
    searchParams,
    setSearchParams,
    stageFilter,
    timeframe,
  ]);

  const draftPatch = useMemo(() => {
    if (!selectedLead || !draft) return {};
    return buildLeadPatch(selectedLead, draft);
  }, [draft, selectedLead]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  async function saveDraft() {
    if (!selectedLead || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await patchLead(selectedLead, draftPatch);
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedLead) return;
    setDraft(toLeadDraft(selectedLead));
  }

  function handleStageFilterChange(value: string) {
    const next =
      value === "all" || PIPELINE_STAGES.some((item) => item.key === value) ? (value as PipelineStage | "all") : "all";
    setStageFilter(next);
    setCurrentPage(1);
  }

  function handleCampaignFilterChange(value: string) {
    setCampaignFilter(value);
    setCurrentPage(1);
  }

  function handleReplyScopeChange(value: ReplyScope) {
    setReplyScope(value);
    setCurrentPage(1);
  }

  function handleTimeframeChange(value: TimeframeValue) {
    setTimeframe(value);
    setCurrentPage(1);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    setCurrentPage(1);
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Leads"
          subtitle="One shared lead workspace with role-aware visibility. Admin and managers can update operational lead state directly."
        />
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton
          onClick={() => {
            void refresh();
          }}
        >
          Retry data sync
        </InlineLinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        subtitle="One shared lead workspace with role-aware visibility. Admin and managers can update operational lead state directly."
        actions={<DateRangeButton value={timeframe} onChange={handleTimeframeChange} />}
      />

      <Surface title="Lead filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_260px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search by name, email, company, title, country"
                className="w-full rounded-md border border-[#242424] bg-[#080808] px-11 py-3 text-sm text-white outline-none transition placeholder:text-neutral-400 focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
              />
            </div>
            <Select value={campaignFilter} onValueChange={handleCampaignFilterChange}>
              <SelectTrigger
                aria-label="Filter leads by campaign"
                className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white"
              >
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  All campaigns
                </SelectItem>
                {scopedCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={replyScope} onValueChange={(value) => handleReplyScopeChange(value as ReplyScope)}>
              <SelectTrigger
                aria-label="Filter leads by OOO qualification"
                className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white"
              >
                <SelectValue placeholder="All leads" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  All leads
                </SelectItem>
                <SelectItem value="active" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  Non-OOO only
                </SelectItem>
                <SelectItem value="ooo" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  OOO only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Stage</p>
            <ToggleGroup
              type="single"
              value={stageFilter}
              onValueChange={handleStageFilterChange}
              variant="outline"
              className="w-full flex-wrap rounded-xl border border-border bg-black/10 p-1 md:flex-nowrap"
            >
              <ToggleGroupItem value="all" className="h-9 flex-1 text-xs md:text-sm">
                All ({baseFilteredLeads.length})
              </ToggleGroupItem>
              {PIPELINE_STAGES.map((stage) => (
                <ToggleGroupItem key={stage.key} value={stage.key} className="h-9 flex-1 text-xs md:text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                    <span className="truncate">
                      {stage.label} ({stageCounts.get(stage.key) ?? 0})
                    </span>
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </Surface>

      {filteredLeads.length === 0 ? (
        <EmptyState title="No leads match the current filters" description="Leads are scoped by role and searchable across core enrichment fields." />
      ) : (
        <Surface title="Lead list" subtitle={`${visibleLeads.length} of ${sortedLeads.length} leads in current scope`}>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto" style={leadTableStyle}>
              <div className="hidden min-w-[980px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:grid-cols-[1.2fr_1fr_auto] lg:[grid-template-columns:var(--leads-table-columns)]">
                {[
                  { key: "lead" as const, label: "Lead" },
                  { key: "company" as const, label: "Company" },
                  { key: "status" as const, label: "Status" },
                  { key: "updated" as const, label: "Updated" },
                ].map((column, index, collection) => (
                  <div key={column.key} className={cn("relative min-w-0", column.key === "updated" ? "hidden lg:block" : "")}>
                    <button
                      onClick={() => {
                        setCurrentPage(1);
                        setLeadSort((current) =>
                          current.key === column.key
                            ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                            : { key: column.key, direction: column.key === "updated" ? "desc" : "asc" },
                        );
                      }}
                      className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                    >
                      {column.label} ({sortIndicator(leadSort.key === column.key, leadSort.direction)})
                    </button>
                    {column.key !== "updated" && index < collection.length - 1 ? (
                      <div
                        onMouseDown={leadColumns.getResizeMouseDown(index)}
                        className="absolute -right-1 top-0 hidden h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20 lg:block"
                      />
                    ) : null}
                  </div>
                ))}
              </div>

              {isMobile ? (
                <div className="space-y-3 p-3">
                  {visibleLeads.map((lead) => {
                    const stage = getLeadStage(lead);
                    const color = getStageColor(stage);
                    const campaign = campaignById.get(lead.campaign_id ?? "");
                    return (
                      <button
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        aria-label={`Open details for ${getFullName(lead.first_name, lead.last_name)}`}
                        className="w-full rounded-2xl border border-border bg-black/20 p-4 text-left transition hover:border-[#3a3a3a]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-white">{getFullName(lead.first_name, lead.last_name)}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{lead.email ?? "No email"}</p>
                          </div>
                          <span
                            className="inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
                            style={{ borderColor: `${color}55`, backgroundColor: `${color}18`, color }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                            {getStageLabel(stage)}
                          </span>
                        </div>
                        <p className="mt-3 truncate text-xs text-neutral-300">{lead.company_name ?? "—"}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{campaign?.name ?? "No campaign linked"}</p>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Updated {formatDate(lead.updated_at, { day: "2-digit", month: "short" })}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="divide-y divide-border md:min-w-[980px]">
                  {visibleLeads.map((lead) => {
                    const active = selectedLead?.id === lead.id;
                    const campaign = campaignById.get(lead.campaign_id ?? "");
                    const stage = getLeadStage(lead);
                    const stageColor = getStageColor(stage);
                    return (
                      <button
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        aria-label={`Open details for ${getFullName(lead.first_name, lead.last_name)}`}
                        className={`grid w-full gap-3 px-4 py-4 text-left transition md:grid-cols-[1.2fr_1fr_auto] lg:[grid-template-columns:var(--leads-table-columns)] ${
                          active ? "bg-sky-500/10" : "hover:bg-white/5"
                        }`}
                      >
                        <div>
                          <p className="text-sm">{getFullName(lead.first_name, lead.last_name)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{lead.email ?? "No email"}</p>
                        </div>
                        <div>
                          <p className="text-sm">{lead.company_name ?? "—"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{campaign?.name ?? "No campaign linked"}</p>
                          <p className="mt-1 text-xs text-muted-foreground lg:hidden">
                            Updated {formatDate(lead.updated_at, { day: "2-digit", month: "short" })}
                          </p>
                        </div>
                        <div>
                          <span
                            className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
                            style={{ borderColor: `${stageColor}55`, backgroundColor: `${stageColor}18`, color: stageColor }}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor }} />
                            {getStageLabel(stage)}
                          </span>
                        </div>
                        <div className="hidden text-sm text-muted-foreground lg:block">
                          {formatDate(lead.updated_at, { day: "2-digit", month: "short" })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Page {safeCurrentPage} of {totalPages}
            </p>
            <Pagination className="mx-0 w-auto justify-start">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (safeCurrentPage > 1) setCurrentPage(safeCurrentPage - 1);
                    }}
                    className={safeCurrentPage <= 1 ? "pointer-events-none opacity-40" : ""}
                  />
                </PaginationItem>

                {pageWindow[0] && pageWindow[0] > 1 ? (
                  <>
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage(1);
                        }}
                      >
                        1
                      </PaginationLink>
                    </PaginationItem>
                    {pageWindow[0] > 2 ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
                  </>
                ) : null}

                {pageWindow.map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      href="#"
                      isActive={page === safeCurrentPage}
                      onClick={(event) => {
                        event.preventDefault();
                        setCurrentPage(page);
                      }}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}

                {pageWindow[pageWindow.length - 1] && pageWindow[pageWindow.length - 1] < totalPages ? (
                  <>
                    {pageWindow[pageWindow.length - 1] < totalPages - 1 ? (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : null}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          setCurrentPage(totalPages);
                        }}
                      >
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  </>
                ) : null}

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (safeCurrentPage < totalPages) setCurrentPage(safeCurrentPage + 1);
                    }}
                    className={safeCurrentPage >= totalPages ? "pointer-events-none opacity-40" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </Surface>
      )}

      {selectedLead && draft && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => setSelectedLeadId(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${getFullName(selectedLead.first_name, selectedLead.last_name)} details`}
            className="flex h-full w-full max-w-[860px] flex-col border-l border-border bg-[#050505] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-6">
              <div>
                <h2 className="text-xl">{getFullName(selectedLead.first_name, selectedLead.last_name)}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Lead detail drawer with editable qualification and reply history.
                </p>
              </div>
              <button
                onClick={() => setSelectedLeadId(null)}
                className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                aria-label="Close lead details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => cancelDraft()}
                  disabled={!isDraftDirty || isSavingDraft}
                  className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel changes
                </button>
                <button
                  onClick={() => {
                    void saveDraft();
                  }}
                  disabled={!isDraftDirty || isSavingDraft}
                  className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingDraft ? "Saving..." : "Save changes"}
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {selectedLead.job_title ?? "No title"} · {selectedLead.company_name ?? "No company"}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{selectedLead.email ?? "No email"}</span>
                  <span>{selectedLead.country ?? "Country unavailable"}</span>
                  <span>{selectedLead.response_time_label ?? "Response label missing"}</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Qualification</span>
                  <Select
                    value={(draft.qualification ?? "") === "" ? LEAD_QUALIFICATION_UNSET : (draft.qualification ?? "")}
                    disabled={identity?.role === "client"}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              qualification: value === LEAD_QUALIFICATION_UNSET ? "" : (value as LeadQualification),
                            }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60">
                      <SelectValue placeholder="unqualified" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                      <SelectItem value={LEAD_QUALIFICATION_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        unqualified
                      </SelectItem>
                      {EDITABLE_QUALIFICATIONS.map((qualification) => (
                        <SelectItem
                          key={qualification}
                          value={qualification}
                          className="text-white focus:bg-[#1a1a1a] focus:text-white"
                        >
                          {qualification}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Comments</span>
                  <textarea
                    value={draft.comments}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, comments: event.target.value } : current))
                    }
                    disabled={identity?.role === "client"}
                    rows={4}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                {[
                  { label: "Meeting booked", key: "meeting_booked" as const, value: draft.meetingBooked },
                  { label: "Meeting held", key: "meeting_held" as const, value: draft.meetingHeld },
                  { label: "Offer sent", key: "offer_sent" as const, value: draft.offerSent },
                  { label: "Won", key: "won" as const, value: draft.won },
                ].map((item) => (
                  <label key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</span>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm">{item.value ? "Yes" : "No"}</span>
                      <Checkbox
                        checked={item.value}
                        disabled={identity?.role === "client"}
                        onCheckedChange={(checked) =>
                          setDraft((current) => {
                            if (!current) return current;
                            const nextChecked = checked === true;
                            if (item.key === "meeting_booked") {
                              return { ...current, meetingBooked: nextChecked };
                            }
                            if (item.key === "meeting_held") {
                              return { ...current, meetingHeld: nextChecked };
                            }
                            if (item.key === "offer_sent") {
                              return { ...current, offerSent: nextChecked };
                            }
                            return { ...current, won: nextChecked };
                          })
                        }
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-sky-300" />
                  <p className="text-sm">Replies</p>
                </div>
                {selectedReplies.length === 0 ? (
                  <EmptyState title="No reply history" description="No reply history is available for this lead yet." />
                ) : (
                  <div className="space-y-3">
                    {selectedReplies.map((reply) => (
                      <div key={reply.id} className="rounded-2xl border border-border bg-black/10 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm">{reply.message_subject ?? "No subject"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {reply.classification ?? "unclassified"} · {reply.language_detected ?? "lang n/a"}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">{formatDate(reply.received_at)}</p>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground">{reply.message_text ?? "No message text"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
