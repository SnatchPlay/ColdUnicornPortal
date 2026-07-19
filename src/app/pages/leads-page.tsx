import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeferredMount } from "../lib/use-deferred-mount";
import { logAfterRaf2, markInteractionStart, measureAfterRaf2 } from "../lib/perf-mark";
import { DevProfiler, useDevRenderCount } from "../lib/react-profiler-dev";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  DateRangeButton,
  LeadConversation,
  LeadMetaSection,
  type LeadDrawerData,
} from "../components/portal-ui";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { LeadEditForm } from "../components/lead-edit-form";
import { LeadConclusionEditor } from "../components/lead-conclusion-editor";
import { LeadMeetingsEditor } from "../components/lead-meetings-editor";
import { LeadOfferEditor } from "../components/lead-offer-editor";
import { LeadValueDeliveriesEditor } from "../components/lead-value-deliveries-editor";
import { LightweightSheet } from "../components/ui/lightweight-sheet";
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
import { repository } from "../data/repository";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { useLeadsList, useLeadDetail, useLeadsFilterOptions } from "../lib/use-leads";
import { useLeadCrmList } from "../lib/use-lead-crm";
import { getFullName } from "../lib/format";
import { buildLeadReportColumns, type LeadReportColumn } from "../lib/lead-report-columns";
import { buildLeadCrmColumns, type LeadCrmColumn } from "../lib/lead-crm-columns";
import { useLeadCustomColumns } from "../lib/use-lead-custom-columns";
import { LeadReportTable } from "../components/lead-report-table";
import { LeadCrmTable } from "../components/lead-crm-table";
import type { LeadCrmRow } from "../types/view-contracts";
import { LeadCustomColumnsManager } from "../components/lead-custom-columns-manager";
import { fetchAllLeadRows, downloadLeadReport } from "../lib/lead-report-export";
import { getLeadStage, isInternalAdmin } from "../lib/selectors";
import {
  TIMEFRAME_PRESETS,
  createDefaultTimeframe,
  getTimeframeLabel,
  resolveTimeframeBounds,
  type TimeframePreset,
  type TimeframeValue,
} from "../lib/timeframe";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { buildLeadPatch, toLeadDraft, type LeadDraft } from "../lib/lead-draft";
import { cn } from "../components/ui/utils";
import { useAuth } from "../providers/auth";
import type { LeadsListParams, LeadsListRow } from "../types/view-contracts";
import type { FinalOutcome } from "../types/core";
import type { LeadMeetingInput, LeadOfferInput, LeadValueDeliveryInput } from "../data/orm-gateway-contract";
import { ClientLeadsPage } from "./client-leads-page";

interface CreateLeadDraft {
  clientId: string;
  campaignId: string;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  jobTitle: string;
}

const ALL_FILTER_VALUE = "__all__";
const PAGE_SIZE = 50;
const MAX_PAGE_LINKS = 5;

type ReplyScope = "all" | "active" | "ooo";
type SortDirection = "asc" | "desc";
// Server sort fields supported by loadLeadsList (see orm-gateway orderClause).
const LEAD_SORT_KEYS = ["lead", "client", "company", "campaign", "step", "status", "replies", "lastReply", "created"] as const;
type LeadSortKey = (typeof LEAD_SORT_KEYS)[number];

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
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const radius = Math.floor(MAX_PAGE_LINKS / 2);
  let start = Math.max(1, currentPage - radius);
  let end = Math.min(totalPages, start + MAX_PAGE_LINKS - 1);
  start = Math.max(1, end - MAX_PAGE_LINKS + 1);
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
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
    if (range === "custom") return { preset: "custom", customStart: from, customEnd: to };
    return { preset: range, customStart: null, customEnd: null };
  }
  return createDefaultTimeframe();
}

function writeTimeframeToParams(params: URLSearchParams, timeframe: TimeframeValue) {
  params.set("range", timeframe.preset);
  if (timeframe.preset !== "custom") { params.delete("from"); params.delete("to"); return; }
  if (timeframe.customStart) params.set("from", timeframe.customStart); else params.delete("from");
  if (timeframe.customEnd) params.set("to", timeframe.customEnd); else params.delete("to");
}


// ── CreateLeadSheetHost ────────────────────────────────────────────────────────────────────────
// Owns the "is sheet open" boolean so that opening/closing New Lead does NOT re-render
// InternalLeadsPage or the lead list. Receives only stable props.

interface CreateLeadSheetHostProps {
  clientsLite: Array<{ id: string; name: string }>;
  campaignsLite: Array<{ id: string; name: string; clientId: string }>;
  onCreateLead: (draft: CreateLeadDraft) => Promise<void>;
}

const CreateLeadSheetHost = memo(function CreateLeadSheetHost({
  clientsLite,
  campaignsLite,
  onCreateLead,
}: CreateLeadSheetHostProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<CreateLeadDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shell timing: measure from click mark to 2 rAFs after open state commits.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      measureAfterRaf2("new-lead:click", "[perf][sheet] new-lead shell click→raf2");
      logAfterRaf2("[perf][sheet] lightweight-new-lead open state→raf2");
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setDraft(null);
      setIsSubmitting(false);
    }
    setIsOpen(open);
  }

  function openSheet() {
    markInteractionStart("new-lead:click");
    setDraft({
      clientId: clientsLite[0]?.id ?? "",
      campaignId: "",
      firstName: "",
      lastName: "",
      email: "",
      companyName: "",
      jobTitle: "",
    });
    setIsOpen(true);
  }

  async function handleSubmit() {
    if (!draft || !draft.clientId) return;
    setIsSubmitting(true);
    try {
      await onCreateLead(draft);
      handleOpenChange(false);
    } catch {
      toast.error("Failed to create lead. Check permissions and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={openSheet}
        className="rounded-full border border-emerald-500/40 bg-[#06120d] px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20"
      >
        New lead
      </button>
      <LightweightSheet
        open={isOpen}
        onOpenChange={handleOpenChange}
        title={<span className="text-white">New lead</span>}
        description="Fill in the required fields to create a new lead manually."
        className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md"
      >
        {draft && (
          <div className="space-y-4 px-6 pb-6">
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client *</span>
              <Select value={draft.clientId} onValueChange={(v) => setDraft((d) => d ? { ...d, clientId: v, campaignId: "" } : d)}>
                <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  {clientsLite.map((client) => <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campaign</span>
              <Select value={draft.campaignId || "__none__"} onValueChange={(v) => setDraft((d) => d ? { ...d, campaignId: v === "__none__" ? "" : v } : d)}>
                <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"><SelectValue placeholder="No campaign" /></SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value="__none__" className="text-white focus:bg-[#1a1a1a] focus:text-white">No campaign</SelectItem>
                  {campaignsLite.filter((c) => c.clientId === draft.clientId).map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">First name</span>
                <input value={draft.firstName} onChange={(e) => setDraft((d) => d ? { ...d, firstName: e.target.value } : d)} placeholder="Optional" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40" />
              </label>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last name</span>
                <input value={draft.lastName} onChange={(e) => setDraft((d) => d ? { ...d, lastName: e.target.value } : d)} placeholder="Optional" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40" />
              </label>
            </div>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</span>
              <input type="email" value={draft.email} onChange={(e) => setDraft((d) => d ? { ...d, email: e.target.value } : d)} placeholder="Optional" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40" />
            </label>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Company</span>
              <input value={draft.companyName} onChange={(e) => setDraft((d) => d ? { ...d, companyName: e.target.value } : d)} placeholder="Optional" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40" />
            </label>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Job title</span>
              <input value={draft.jobTitle} onChange={(e) => setDraft((d) => d ? { ...d, jobTitle: e.target.value } : d)} placeholder="Optional" className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40" />
            </label>
            <p className="text-xs text-muted-foreground">Source will be set to <span className="text-white">manual</span>.</p>
            <button
              onClick={() => { void handleSubmit(); }}
              disabled={isSubmitting || !draft.clientId}
              className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create lead"}
            </button>
          </div>
        )}
      </LightweightSheet>
    </>
  );
});

// ── Page dispatcher ────────────────────────────────────────────────────────────────────────────

export function LeadsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientLeadsPage />;
  return (
    <DevProfiler id="InternalLeadsPage">
      <InternalLeadsPage />
    </DevProfiler>
  );
}

function InternalLeadsPage() {
  useDevRenderCount("InternalLeadsPage");
  const { identity } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  // Debounce search: send to server only after 400ms idle — LIKE scan has no trigram index.
  const [committedSearch, setCommittedSearch] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setCommittedSearch(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">(() => {
    const stage = searchParams.get("stage");
    if (stage === "all") return "all";
    if (PIPELINE_STAGES.some((item) => item.key === stage)) return stage as PipelineStage;
    return "all";
  });
  const [clientFilter, setClientFilter] = useState(searchParams.get("client") ?? ALL_FILTER_VALUE);
  const [campaignFilter, setCampaignFilter] = useState(searchParams.get("campaign") ?? ALL_FILTER_VALUE);
  const [replyScope, setReplyScope] = useState<ReplyScope>(() => {
    const value = searchParams.get("replyScope");
    if (value === "active" || value === "ooo") return value;
    return "all";
  });
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => parseTimeframeFromParams(searchParams));
  const [currentPage, setCurrentPage] = useState(() => parsePage(searchParams.get("page")));
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"pdca" | "crm" | "combined">("pdca");
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isConcluding, setIsConcluding] = useState(false);
  const [savingMeeting, setSavingMeeting] = useState<"intro" | "summary" | null>(null);
  const [savingOffer, setSavingOffer] = useState(false);
  const [savingValueSeq, setSavingValueSeq] = useState<1 | 2 | null>(null);
  const [leadSort, setLeadSort] = useState<{ key: LeadSortKey; direction: SortDirection }>(() => {
    const sortKey = searchParams.get("sort");
    const key: LeadSortKey = LEAD_SORT_KEYS.includes(sortKey as LeadSortKey) ? (sortKey as LeadSortKey) : "created";
    const sortDirection = searchParams.get("dir");
    const direction: SortDirection = sortDirection === "asc" || sortDirection === "desc" ? sortDirection : "desc";
    return { key, direction };
  });

  // Resolve timeframe bounds for the server. resolveTimeframeBounds returns { start, end }
  // (end is end-of-day); send full ISO so the final day is included inclusively.
  const { start: timeframeFrom, end: timeframeTo } = useMemo(() => resolveTimeframeBounds(timeframe), [timeframe]);

  const listParams = useMemo<LeadsListParams>(() => ({
    clientId: clientFilter !== ALL_FILTER_VALUE ? clientFilter : undefined,
    campaignId: campaignFilter !== ALL_FILTER_VALUE ? campaignFilter : undefined,
    stage: stageFilter !== "all" ? stageFilter : undefined,
    replyScope,
    dateFrom: timeframeFrom?.toISOString(),
    dateTo: timeframeTo?.toISOString(),
    search: committedSearch || undefined,
    sortField: leadSort.key,
    sortDir: leadSort.direction,
    page: currentPage,
    pageSize: PAGE_SIZE,
  }), [clientFilter, campaignFilter, stageFilter, replyScope, timeframeFrom, timeframeTo, committedSearch, leadSort, currentPage]);

  // View switcher (ADR-0013): PDCA = existing report; CRM = banded CRM table; combined = union, calm.
  const isCrmView = viewMode !== "pdca";
  const pdca = useLeadsList(listParams, { enabled: !isCrmView });
  const crmView = useLeadCrmList(listParams, { enabled: isCrmView });
  // Re-bind the shared names to the active mode so all downstream derivations work unchanged.
  const data = isCrmView ? crmView.data : pdca.data;
  const loading = isCrmView ? crmView.loading : pdca.loading;
  const error = isCrmView ? crmView.error : pdca.error;
  const refresh = isCrmView ? crmView.refresh : pdca.refresh;
  const { data: filterOptions } = useLeadsFilterOptions();
  const { replies: selectedReplies, loading: loadingDetail } = useLeadDetail(selectedLeadId);

  const showClientColumn = identity ? isInternalAdmin(identity.role) : false;
  const baseReportColumns = useMemo(
    () => buildLeadReportColumns({ role: identity?.role, showClient: showClientColumn }),
    [identity?.role, showClientColumn],
  );
  const customFields = useMemo(() => data?.customFields ?? [], [data]);
  const customValues = useMemo(() => data?.customValues ?? [], [data]);
  const customColumns = useLeadCustomColumns({ role: identity?.role, fields: customFields, values: customValues });
  const reportColumns = useMemo(() => [...baseReportColumns, ...customColumns], [baseReportColumns, customColumns]);
  // CRM view columns. Combined mode unions the PDCA report columns (as the Lead band) with the CRM
  // stage columns, dropping the CRM lead-stage duplicates (spec B.3 — a calm union).
  const crmAsOf = crmView.data?.asOf;
  // Per-cell health colours (CRM mode only). The context object is memoised so LeadCrmTable's
  // per-row evaluation memo stays stable across unrelated re-renders.
  const crmHealthContext = useMemo(
    () => (crmView.data ? { asOf: crmView.data.asOf, businessDays: crmView.data.businessDays } : undefined),
    [crmView.data],
  );
  const crmColumns = useMemo<LeadCrmColumn[]>(() => {
    const base = buildLeadCrmColumns({
      role: identity?.role,
      showClient: showClientColumn,
      asOf: crmAsOf,
      includeProcessIssues: viewMode === "crm",
    });
    if (viewMode !== "combined") return base;
    const pdcaAsCrm: LeadCrmColumn[] = reportColumns.map((c: LeadReportColumn) => ({
      id: `pdca:${c.id}`, label: c.label, stage: "lead", width: c.width, minWidth: c.minWidth, align: c.align,
      value: c.value, render: c.render,
    }));
    // Drop the PDCA (getLeadStage) Status and keep the CRM (resolveCrmStatus) Status so the taxonomy is
    // consistent across CRM and combined modes.
    return [
      ...pdcaAsCrm.filter((c) => c.id !== "pdca:status"),
      ...base.filter((c) => c.stage !== "lead" || c.id === "status"),
    ];
  }, [identity?.role, showClientColumn, viewMode, reportColumns, crmAsOf]);
  const defaultColumnWidths = useMemo(() => reportColumns.map((c) => c.width), [reportColumns]);
  const minColumnWidths = useMemo(() => reportColumns.map((c) => c.minWidth), [reportColumns]);
  const leadColumns = useResizableColumns({
    storageKey: `table:leads-report:columns:${showClientColumn ? "admin" : "internal"}:${reportColumns.length}`,
    defaultWidths: defaultColumnWidths,
    minWidths: minColumnWidths,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const totalCount = data?.totalCount ?? 0;
  const stageCounts = data?.stageCounts ?? {};
  // When a stage filter is active, the visible scope is that stage's count, not the grand total.
  // totalCount always reflects all stages (the count query ignores the stage filter intentionally).
  const scopedCount = stageFilter !== "all" ? (stageCounts[stageFilter] ?? 0) : totalCount;
  const clientsLite = useMemo(() => filterOptions?.clientsLite ?? [], [filterOptions]);
  const campaignsLite = useMemo(() => filterOptions?.campaignsLite ?? [], [filterOptions]);

  const clientFilteredCampaigns = useMemo(
    () => clientFilter === ALL_FILTER_VALUE
      ? campaignsLite
      : campaignsLite.filter((c) => c.clientId === clientFilter),
    [campaignsLite, clientFilter],
  );

  const totalPages = Math.max(1, Math.ceil(scopedCount / PAGE_SIZE));
  const safeCurrentPage = clampPage(currentPage, totalPages);
  const pageWindow = useMemo(() => buildPageWindow(safeCurrentPage, totalPages), [safeCurrentPage, totalPages]);
  const timeframeLabel = getTimeframeLabel(timeframe);

  const selectedLead = useMemo(() => rows.find((r) => r.id === selectedLeadId) ?? null, [rows, selectedLeadId]);
  // Two-phase drawer: overlay + header paint first, heavy form/conversation deferred.
  const leadBodyReady = useDeferredMount(!!selectedLead && !!draft);

  // Shell timing: measure on false→true transition of drawerOpen.
  const leadDrawerWasOpenRef = useRef(false);
  const leadDrawerOpen = !!selectedLead && !!draft;
  useEffect(() => {
    if (leadDrawerOpen && !leadDrawerWasOpenRef.current) {
      measureAfterRaf2("lead-drawer:click", "[perf][drawer] lead shell click→raf2");
    }
    leadDrawerWasOpenRef.current = leadDrawerOpen;
  }, [leadDrawerOpen]);

  // Content timing: deferred form + conversation visible.
  useEffect(() => {
    if (!leadBodyReady) return;
    measureAfterRaf2("lead-drawer:click", "[perf][drawer] lead content deferred→raf2");
  }, [leadBodyReady]);

  const selectedLeadView = useMemo<LeadDrawerData | null>(() => {
    if (!selectedLead) return null;
    const stage = getLeadStage(selectedLead);
    const latestReply = selectedReplies[0];
    const inlineReply = selectedLead.reply_text?.trim();
    const fullName = getFullName(selectedLead.first_name, selectedLead.last_name);
    return {
      lead: selectedLead,
      replies: selectedReplies,
      name: fullName,
      initials: fullName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      email: selectedLead.email ?? "No email",
      title: selectedLead.job_title ?? "No title",
      company: selectedLead.company_name ?? "No company",
      stage: stage as PipelineStage,
      campaignName: selectedLead.campaignName ?? "No campaign linked",
      step: selectedLead.message_number ?? latestReply?.sequence_step ?? null,
      replyCount: selectedLead.replyCount || (inlineReply ? 1 : 0),
      lastReplyDate: latestReply?.received_at ?? (inlineReply ? selectedLead.updated_at : null),
      addedDate: selectedLead.created_at,
    };
  }, [selectedLead, selectedReplies]);

  // Stable callback for CreateLeadSheetHost — only recreates when refresh changes.
  const handleCreateLeadStable = useCallback(
    async (d: CreateLeadDraft) => {
      await repository.createLead({
        client_id: d.clientId,
        campaign_id: d.campaignId || null,
        first_name: d.firstName.trim() || null,
        last_name: d.lastName.trim() || null,
        email: d.email.trim() || null,
        company_name: d.companyName.trim() || null,
        job_title: d.jobTitle.trim() || null,
        source: "manual",
        qualification: null,
        client_note: null,
        coldunicorn_note: null,
        highlight: null,
        meeting_booked: false,
        meeting_held: false,
        offer_sent: false,
        won: false,
        country: null,
        city: null,
        linkedin_url: null,
        response_time_label: null,
        gender: null,
      });
      refresh();
    },
    [refresh],
  );

  const [exporting, setExporting] = useState(false);
  const handleExportReport = useCallback(
    async (format: "csv" | "xlsx") => {
      setExporting(true);
      try {
        const { page: _page, pageSize: _pageSize, ...base } = listParams;
        void _page; void _pageSize;
        await downloadLeadReport(reportColumns, base, format, `leads-${timeframeLabel.toLowerCase().replace(/\s+/g, "-")}`);
      } catch {
        toast.error("Export failed. Try narrowing the filters and retry.");
      } finally {
        setExporting(false);
      }
    },
    [listParams, reportColumns, timeframeLabel],
  );

  useEffect(() => {
    if (!selectedLead) { setDraft(null); return; }
    setDraft(toLeadDraft(selectedLead));
  }, [selectedLead]);

  // Close drawer if selected lead is no longer in current page.
  useEffect(() => {
    if (selectedLeadId && !rows.some((r) => r.id === selectedLeadId)) setSelectedLeadId(null);
  }, [rows, selectedLeadId]);

  // Campaign filter: reset if chosen campaign not in current filter set.
  useEffect(() => {
    if (campaignFilter === ALL_FILTER_VALUE) return;
    if (!clientFilteredCampaigns.some((c) => c.id === campaignFilter)) setCampaignFilter(ALL_FILTER_VALUE);
  }, [campaignFilter, clientFilteredCampaigns]);

  // Esc closes drawer.
  useEffect(() => {
    if (!selectedLead) return;
    function handleKeyDown(event: KeyboardEvent) { if (event.key === "Escape") setSelectedLeadId(null); }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLead]);

  // Sync URL params.
  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (query.trim()) nextParams.set("q", query.trim()); else nextParams.delete("q");
    if (stageFilter !== "all") nextParams.set("stage", stageFilter); else nextParams.delete("stage");
    if (clientFilter !== ALL_FILTER_VALUE) nextParams.set("client", clientFilter); else nextParams.delete("client");
    if (campaignFilter !== ALL_FILTER_VALUE) nextParams.set("campaign", campaignFilter); else nextParams.delete("campaign");
    if (replyScope !== "all") nextParams.set("replyScope", replyScope); else nextParams.delete("replyScope");
    nextParams.set("sort", leadSort.key);
    nextParams.set("dir", leadSort.direction);
    nextParams.set("page", String(safeCurrentPage));
    writeTimeframeToParams(nextParams, timeframe);
    if (nextParams.toString() !== searchParams.toString()) setSearchParams(nextParams, { replace: true });
  }, [campaignFilter, clientFilter, leadSort.direction, leadSort.key, query, replyScope, safeCurrentPage, searchParams, setSearchParams, stageFilter, timeframe]);

  const draftPatch = useMemo(() => {
    if (!selectedLead || !draft) return {};
    return buildLeadPatch(selectedLead, draft);
  }, [draft, selectedLead]);
  const isDraftDirty = Object.keys(draftPatch).length > 0;

  async function saveDraft() {
    if (!selectedLead || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await repository.updateLead(selectedLead.id, draftPatch);
      refresh();
    } catch {
      toast.error("Failed to save lead changes.");
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedLead) return;
    setDraft(toLeadDraft(selectedLead));
  }

  // Atomic terminal conclusion (ADR-0013) — separate from the draft flow so it can sync `won`.
  const handleConclude = useCallback(
    async (finalOutcome: FinalOutcome | null, conclusion: string | null) => {
      if (!selectedLead) return;
      setIsConcluding(true);
      try {
        await repository.concludeLead(selectedLead.id, finalOutcome, conclusion);
        toast.success(finalOutcome ? "Lead conclusion saved." : "Conclusion cleared.");
        refresh();
      } catch {
        toast.error("Failed to save conclusion.");
      } finally {
        setIsConcluding(false);
      }
    },
    [selectedLead, refresh],
  );

  // Upsert intro/summary meeting (ADR-0013, Phase 5.3). A scheduled/held status fires the DB trigger
  // that recomputes meeting_booked/meeting_held, so refresh() re-reads the synced booleans.
  const handleSaveMeeting = useCallback(
    async (meetingType: "intro" | "summary", patch: LeadMeetingInput) => {
      if (!selectedLead) return;
      setSavingMeeting(meetingType);
      try {
        await repository.upsertLeadMeeting(selectedLead.id, meetingType, patch);
        toast.success(`${meetingType === "intro" ? "Intro" : "Summary"} meeting saved.`);
        refresh();
      } catch {
        toast.error("Failed to save meeting.");
      } finally {
        setSavingMeeting(null);
      }
    },
    [selectedLead, refresh],
  );

  // Upsert the current offer (ADR-0013, Phase 5.3). A sent/accepted status fires the offer_sent trigger.
  const handleSaveOffer = useCallback(
    async (patch: LeadOfferInput) => {
      if (!selectedLead) return;
      setSavingOffer(true);
      try {
        await repository.upsertLeadOffer(selectedLead.id, patch);
        toast.success("Offer saved.");
        refresh();
      } catch {
        toast.error("Failed to save offer.");
      } finally {
        setSavingOffer(false);
      }
    },
    [selectedLead, refresh],
  );

  // Upsert value delivery 1 or 2 (ADR-0013, Phase 5.3). No boolean trigger — feeds the CRM columns only.
  const handleSaveValueDelivery = useCallback(
    async (sequenceNumber: 1 | 2, patch: LeadValueDeliveryInput) => {
      if (!selectedLead) return;
      setSavingValueSeq(sequenceNumber);
      try {
        await repository.upsertLeadValueDelivery(selectedLead.id, sequenceNumber, patch);
        toast.success(`${sequenceNumber === 1 ? "1st" : "2nd"} value delivery saved.`);
        refresh();
      } catch {
        toast.error("Failed to save value delivery.");
      } finally {
        setSavingValueSeq(null);
      }
    },
    [selectedLead, refresh],
  );

  function handleStageFilterChange(value: string) {
    const next = value === "all" || PIPELINE_STAGES.some((item) => item.key === value) ? (value as PipelineStage | "all") : "all";
    setStageFilter(next);
    setCurrentPage(1);
  }
  function handleClientFilterChange(value: string) { setClientFilter(value); setCampaignFilter(ALL_FILTER_VALUE); setCurrentPage(1); }
  function handleCampaignFilterChange(value: string) { setCampaignFilter(value); setCurrentPage(1); }
  function handleReplyScopeChange(value: ReplyScope) { setReplyScope(value); setCurrentPage(1); }
  function handleTimeframeChange(value: TimeframeValue) { setTimeframe(value); setCurrentPage(1); }
  function handleQueryChange(value: string) { setQuery(value); setCurrentPage(1); }

  if (loading && !data) return <LoadingState />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Leads" subtitle="One shared lead workspace with role-aware visibility. Admin and managers can update operational lead state directly." />
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton onClick={() => void refresh()}>Retry data sync</InlineLinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        subtitle="One shared lead workspace with role-aware visibility. Admin and managers can update operational lead state directly."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeButton value={timeframe} onChange={handleTimeframeChange} />
            <button
              onClick={() => void handleExportReport("csv")}
              disabled={rows.length === 0 || exporting}
              className="rounded-full border border-[#242424] bg-[#0f0f0f] px-4 py-2 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
            <button
              onClick={() => void handleExportReport("xlsx")}
              disabled={rows.length === 0 || exporting}
              className="rounded-full border border-[#242424] bg-[#0f0f0f] px-4 py-2 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Export XLSX
            </button>
            {showClientColumn ? (
              <LeadCustomColumnsManager
                clientsLite={clientsLite}
                defaultClientId={clientFilter !== ALL_FILTER_VALUE ? clientFilter : undefined}
                onChanged={() => void refresh()}
              />
            ) : null}
            <CreateLeadSheetHost
              clientsLite={clientsLite}
              campaignsLite={campaignsLite}
              onCreateLead={handleCreateLeadStable}
            />
          </div>
        }
      />

      <Surface title="Lead filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="space-y-4">
          <div className={`grid gap-4 ${clientsLite.length > 1 ? "xl:grid-cols-[1fr_180px_220px_180px]" : "xl:grid-cols-[1fr_260px_220px]"}`}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search by name, email, company, title, country"
                className="w-full rounded-md border border-[#242424] bg-[#080808] px-11 py-3 text-sm text-white outline-none transition placeholder:text-neutral-400 focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
              />
            </div>
            {clientsLite.length > 1 ? (
              <Select value={clientFilter} onValueChange={handleClientFilterChange}>
                <SelectTrigger aria-label="Filter leads by client" className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">All clients</SelectItem>
                  {clientsLite.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={campaignFilter} onValueChange={handleCampaignFilterChange}>
              <SelectTrigger aria-label="Filter leads by campaign" className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">All campaigns</SelectItem>
                {clientFilteredCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{campaign.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={replyScope} onValueChange={(value) => handleReplyScopeChange(value as ReplyScope)}>
              <SelectTrigger aria-label="Filter leads by OOO qualification" className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white">
                <SelectValue placeholder="All leads" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">All leads</SelectItem>
                <SelectItem value="active" className="text-white focus:bg-[#1a1a1a] focus:text-white">Non-OOO only</SelectItem>
                <SelectItem value="ooo" className="text-white focus:bg-[#1a1a1a] focus:text-white">OOO only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Stage</p>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => handleStageFilterChange("all")}
                className={cn(
                  "h-8 whitespace-nowrap rounded-md border px-3 text-xs transition-colors",
                  stageFilter === "all"
                    ? "border-border bg-[#2a2a2a] text-white"
                    : "border-border bg-transparent text-muted-foreground hover:bg-[#1a1a1a] hover:text-white",
                )}
              >
                All ({totalCount})
              </button>
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage.key}
                  onClick={() => handleStageFilterChange(stage.key)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs transition-colors",
                    stageFilter === stage.key
                      ? "border-border bg-[#2a2a2a] text-white"
                      : "border-border bg-transparent text-muted-foreground hover:bg-[#1a1a1a] hover:text-white",
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                  {stage.label} ({stageCounts[stage.key] ?? 0})
                </button>
              ))}
            </div>
          </div>
        </div>
      </Surface>

      <div className="flex items-center gap-1 rounded-xl border border-border bg-[#0b0b0b] p-1 text-xs w-fit">
        {([["pdca", "PDCA"], ["crm", "CRM"], ["combined", "PDCA + CRM"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            aria-pressed={viewMode === mode}
            className={cn(
              "rounded-lg px-3 py-1.5 transition",
              viewMode === mode ? "bg-sky-500/15 text-sky-200" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState title="No leads match the current filters" description="Leads are scoped by role and searchable across core enrichment fields." />
      ) : (
        <Surface title="Lead list" subtitle={`${rows.length} of ${scopedCount} leads in current scope`}>
          {loading && (
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Refreshing…
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-border">
            {viewMode !== "pdca" ? (
              <LeadCrmTable
                rows={rows as LeadCrmRow[]}
                columns={crmColumns}
                onRowClick={(lead) => { markInteractionStart("lead-drawer:click"); setSelectedLeadId(lead.id); }}
                selectedId={selectedLead?.id ?? null}
                rowAriaLabel={(lead) => `Open details for ${getFullName(lead.first_name, lead.last_name)}`}
                showStageStrip={viewMode === "crm"}
                showHealth={viewMode === "crm"}
                healthContext={crmHealthContext}
              />
            ) : (
            <LeadReportTable
              rows={rows}
              columns={reportColumns}
              template={leadColumns.template}
              getResizeMouseDown={leadColumns.getResizeMouseDown}
              sort={leadSort}
              onSortChange={(serverField) => {
                setCurrentPage(1);
                setLeadSort((current) =>
                  current.key === serverField
                    ? { key: serverField as LeadSortKey, direction: current.direction === "asc" ? "desc" : "asc" }
                    : { key: serverField as LeadSortKey, direction: serverField === "created" || serverField === "lastReply" ? "desc" : "asc" },
                );
              }}
              onRowClick={(lead) => { markInteractionStart("lead-drawer:click"); setSelectedLeadId(lead.id); }}
              selectedId={selectedLead?.id ?? null}
              rowAriaLabel={(lead) => `Open details for ${getFullName(lead.first_name, lead.last_name)}`}
              onHighlightChange={async (lead, value) => {
                try {
                  await repository.updateLead(lead.id, { highlight: value });
                } catch (reason) {
                  toast.error(reason instanceof Error ? reason.message : "Could not update highlight.");
                  throw reason; // let the table roll back its optimistic colour
                }
              }}
            />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Page {safeCurrentPage} of {totalPages}</p>
            <Pagination className="mx-0 w-auto justify-start">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); if (safeCurrentPage > 1) setCurrentPage(safeCurrentPage - 1); }} className={safeCurrentPage <= 1 ? "pointer-events-none opacity-40" : ""} />
                </PaginationItem>
                {pageWindow[0] && pageWindow[0] > 1 ? (
                  <>
                    <PaginationItem><PaginationLink href="#" onClick={(e) => { e.preventDefault(); setCurrentPage(1); }}>1</PaginationLink></PaginationItem>
                    {pageWindow[0] > 2 ? <PaginationItem><PaginationEllipsis /></PaginationItem> : null}
                  </>
                ) : null}
                {pageWindow.map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink href="#" isActive={page === safeCurrentPage} onClick={(e) => { e.preventDefault(); setCurrentPage(page); }}>{page}</PaginationLink>
                  </PaginationItem>
                ))}
                {pageWindow[pageWindow.length - 1] && pageWindow[pageWindow.length - 1] < totalPages ? (
                  <>
                    {pageWindow[pageWindow.length - 1] < totalPages - 1 ? <PaginationItem><PaginationEllipsis /></PaginationItem> : null}
                    <PaginationItem><PaginationLink href="#" onClick={(e) => { e.preventDefault(); setCurrentPage(totalPages); }}>{totalPages}</PaginationLink></PaginationItem>
                  </>
                ) : null}
                <PaginationItem>
                  <PaginationNext href="#" onClick={(e) => { e.preventDefault(); if (safeCurrentPage < totalPages) setCurrentPage(safeCurrentPage + 1); }} className={safeCurrentPage >= totalPages ? "pointer-events-none opacity-40" : ""} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </Surface>
      )}

      {/* Lead detail drawer */}
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
                <p className="mt-2 text-sm text-muted-foreground">Lead detail drawer with editable qualification and reply history.</p>
              </div>
              <button onClick={() => setSelectedLeadId(null)} className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-primary/30 hover:text-foreground" aria-label="Close lead details">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => cancelDraft()} disabled={!isDraftDirty || isSavingDraft} className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50">Cancel changes</button>
                <button onClick={() => { void saveDraft(); }} disabled={!isDraftDirty || isSavingDraft} className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSavingDraft ? "Saving..." : "Save changes"}
                </button>
              </div>

              {/* Phase 2: deferred heavy content */}
              {leadBodyReady ? (
                <>
                  <LeadEditForm
                    draft={draft}
                    updateDraft={(updater) => setDraft((current) => (current ? updater(current) : current))}
                    readOnly={identity?.role === "client"}
                    hideWon={viewMode === "crm"}
                    showCrmFields={isCrmView}
                  />

                  {/* Terminal conclusion (ADR-0013, Phase 5) — pure CRM view only; owns `won` (so the
                      legacy pipeline toggle above is hidden there) to avoid two write paths racing. */}
                  {viewMode === "crm" ? (
                    <LeadConclusionEditor
                      key={selectedLead.id}
                      lead={selectedLead}
                      readOnly={identity?.role === "client"}
                      saving={isConcluding}
                      onSave={handleConclude}
                    />
                  ) : null}

                  {/* Meeting editors (ADR-0013, Phase 5.3) — CRM view only; upsert drives the boolean sync. */}
                  {viewMode === "crm" ? (
                    <LeadMeetingsEditor
                      key={`meetings:${selectedLead.id}`}
                      intro={(selectedLead as LeadCrmRow).intro_meeting}
                      summary={(selectedLead as LeadCrmRow).summary_meeting}
                      readOnly={identity?.role === "client"}
                      savingType={savingMeeting}
                      onSave={handleSaveMeeting}
                    />
                  ) : null}

                  {/* Offer editor (ADR-0013, Phase 5.3) — CRM view only; upsert drives the offer_sent sync. */}
                  {viewMode === "crm" ? (
                    <LeadOfferEditor
                      key={`offer:${selectedLead.id}`}
                      offer={(selectedLead as LeadCrmRow).current_offer}
                      readOnly={identity?.role === "client"}
                      saving={savingOffer}
                      onSave={handleSaveOffer}
                    />
                  ) : null}

                  {/* Value deliveries (ADR-0013, Phase 5.3) — CRM view only; feeds the expert-brand columns. */}
                  {viewMode === "crm" ? (
                    <LeadValueDeliveriesEditor
                      key={`values:${selectedLead.id}`}
                      first={(selectedLead as LeadCrmRow).value_delivery_1}
                      second={(selectedLead as LeadCrmRow).value_delivery_2}
                      readOnly={identity?.role === "client"}
                      savingSeq={savingValueSeq}
                      onSave={handleSaveValueDelivery}
                    />
                  ) : null}

                  {loadingDetail ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                      Loading reply history…
                    </div>
                  ) : selectedLeadView ? (
                    <div className="-mx-6 border-t border-border">
                      <LeadConversation lead={selectedLeadView} />
                      <LeadMetaSection lead={selectedLead} />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-2 space-y-4" aria-hidden="true">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

