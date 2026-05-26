import { useEffect, useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  DateRangeButton,
  LeadConversation,
  LeadMetaSection,
  type LeadDrawerData,
} from "../components/portal-ui";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
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
import { getLeadStage, isInternalAdmin, scopeCampaigns, scopeClients, scopeLeads, scopeReplies, sortClientsAlpha } from "../lib/selectors";
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
import type { LeadRecord, LeadQualification, LeadGender } from "../types/core";
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
type LeadSortKey = "lead" | "client" | "company" | "status" | "updated";

interface LeadDraft {
  qualification: LeadQualification | "";
  comments: string;
  meetingBooked: boolean;
  meetingHeld: boolean;
  offerSent: boolean;
  won: boolean;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  linkedinUrl: string;
  phoneNumber: string;
  phoneSource: string;
  gender: LeadGender | "";
  country: string;
  industry: string;
  headcountRange: string;
  website: string;
  expectedReturnDate: string;
  addedToOooCampaign: boolean;
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
    email: lead.email ?? "",
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    jobTitle: lead.job_title ?? "",
    companyName: lead.company_name ?? "",
    linkedinUrl: lead.linkedin_url ?? "",
    phoneNumber: lead.phone_number ?? "",
    phoneSource: lead.phone_source ?? "",
    gender: lead.gender ?? "",
    country: lead.country ?? "",
    industry: lead.industry ?? "",
    headcountRange: lead.headcount_range ?? "",
    website: lead.website ?? "",
    expectedReturnDate: lead.expected_return_date ?? "",
    addedToOooCampaign: lead.added_to_ooo_campaign,
  };
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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
  if (lead.meeting_booked !== draft.meetingBooked) patch.meeting_booked = draft.meetingBooked;
  if (lead.meeting_held !== draft.meetingHeld) patch.meeting_held = draft.meetingHeld;
  if (lead.offer_sent !== draft.offerSent) patch.offer_sent = draft.offerSent;
  if (lead.won !== draft.won) patch.won = draft.won;

  const nextEmail = nullableString(draft.email);
  if ((lead.email ?? null) !== nextEmail) patch.email = nextEmail;

  const nextFirst = nullableString(draft.firstName);
  if ((lead.first_name ?? null) !== nextFirst) patch.first_name = nextFirst;

  const nextLast = nullableString(draft.lastName);
  if ((lead.last_name ?? null) !== nextLast) patch.last_name = nextLast;

  const nextJob = nullableString(draft.jobTitle);
  if ((lead.job_title ?? null) !== nextJob) patch.job_title = nextJob;

  const nextCompany = nullableString(draft.companyName);
  if ((lead.company_name ?? null) !== nextCompany) patch.company_name = nextCompany;

  const nextLinkedIn = nullableString(draft.linkedinUrl);
  if ((lead.linkedin_url ?? null) !== nextLinkedIn) patch.linkedin_url = nextLinkedIn;

  const nextPhone = nullableString(draft.phoneNumber);
  if ((lead.phone_number ?? null) !== nextPhone) patch.phone_number = nextPhone;

  const nextPhoneSource = nullableString(draft.phoneSource);
  if ((lead.phone_source ?? null) !== nextPhoneSource) patch.phone_source = nextPhoneSource;

  const nextGender = (draft.gender || null) as LeadGender | null;
  if ((lead.gender ?? null) !== nextGender) patch.gender = nextGender;

  const nextCountry = nullableString(draft.country);
  if ((lead.country ?? null) !== nextCountry) patch.country = nextCountry;

  const nextIndustry = nullableString(draft.industry);
  if ((lead.industry ?? null) !== nextIndustry) patch.industry = nextIndustry;

  const nextHeadcount = nullableString(draft.headcountRange);
  if ((lead.headcount_range ?? null) !== nextHeadcount) patch.headcount_range = nextHeadcount;

  const nextWebsite = nullableString(draft.website);
  if ((lead.website ?? null) !== nextWebsite) patch.website = nextWebsite;

  const nextOooDate = nullableString(draft.expectedReturnDate);
  if ((lead.expected_return_date ?? null) !== nextOooDate) patch.expected_return_date = nextOooDate;

  if (lead.added_to_ooo_campaign !== draft.addedToOooCampaign) {
    patch.added_to_ooo_campaign = draft.addedToOooCampaign;
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
  const { clients, leads, replies, campaigns, createLead, updateLead, loading, error, refresh } = useCoreData();
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [createLeadDraft, setCreateLeadDraft] = useState<CreateLeadDraft | null>(null);
  const [isSubmittingCreateLead, setIsSubmittingCreateLead] = useState(false);
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const deferredQuery = useDeferredValue(query);
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

  const showClientColumn = identity ? isInternalAdmin(identity.role) : false;
  const leadColumns = useResizableColumns({
    storageKey: showClientColumn ? "table:leads:columns:v2:admin" : "table:leads:columns:v2",
    defaultWidths: showClientColumn ? [340, 200, 280, 200, 180] : [380, 300, 220, 200],
    minWidths: showClientColumn ? [220, 140, 180, 140, 120] : [240, 200, 150, 140],
  });

  const leadTableStyle = useMemo(
    () =>
      ({
        "--leads-table-columns": leadColumns.template,
      }) as CSSProperties,
    [leadColumns.template],
  );

  const scopedClients = useMemo(
    () => (identity ? sortClientsAlpha(scopeClients(identity, clients)) : []),
    [clients, identity],
  );
  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const clientFilteredCampaigns = useMemo(
    () =>
      clientFilter === ALL_FILTER_VALUE
        ? scopedCampaigns
        : scopedCampaigns.filter((c) => c.client_id === clientFilter),
    [clientFilter, scopedCampaigns],
  );
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedReplies = useMemo(() => (identity ? scopeReplies(identity, clients, replies) : []), [clients, identity, replies]);
  const timeframeLeads = useMemo(
    () => filterByTimeframe(scopedLeads, (lead) => lead.created_at, timeframe),
    [scopedLeads, timeframe],
  );

  const leadHaystacks = useMemo(
    () =>
      timeframeLeads.map((lead) =>
        [getFullName(lead.first_name, lead.last_name), lead.email, lead.company_name, lead.job_title, lead.country]
          .join(" ")
          .toLowerCase(),
      ),
    [timeframeLeads],
  );

  const baseFilteredLeads = useMemo(() => {
    const needle = deferredQuery.toLowerCase();
    return timeframeLeads.filter((lead, i) => {
      if (needle && !leadHaystacks[i].includes(needle)) return false;
      if (clientFilter !== ALL_FILTER_VALUE && lead.client_id !== clientFilter) return false;
      if (campaignFilter !== ALL_FILTER_VALUE && lead.campaign_id !== campaignFilter) return false;
      if (replyScope === "ooo" && lead.qualification !== "OOO") return false;
      if (replyScope === "active" && lead.qualification === "OOO") return false;
      return true;
    });
  }, [campaignFilter, clientFilter, deferredQuery, leadHaystacks, replyScope, timeframeLeads]);

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
  const clientById = useMemo(() => new Map(scopedClients.map((client) => [client.id, client])), [scopedClients]);

  const sortedLeads = useMemo(() => {
    return filteredLeads.slice().sort((left, right) => {
      if (leadSort.key === "lead") {
        return compareText(getFullName(left.first_name, left.last_name), getFullName(right.first_name, right.last_name), leadSort.direction);
      }
      if (leadSort.key === "client") {
        return compareText(clientById.get(left.client_id)?.name ?? "", clientById.get(right.client_id)?.name ?? "", leadSort.direction);
      }
      if (leadSort.key === "company") {
        return compareText(left.company_name, right.company_name, leadSort.direction);
      }
      if (leadSort.key === "status") {
        return compareText(getLeadStage(left), getLeadStage(right), leadSort.direction);
      }
      return compareText(left.updated_at, right.updated_at, leadSort.direction);
    });
  }, [filteredLeads, leadSort.direction, leadSort.key, clientById]);

  const totalPages = Math.max(1, Math.ceil(sortedLeads.length / PAGE_SIZE));
  const safeCurrentPage = clampPage(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * PAGE_SIZE;
  const visibleLeads = useMemo(() => sortedLeads.slice(pageStart, pageStart + PAGE_SIZE), [pageStart, sortedLeads]);
  const pageWindow = useMemo(() => buildPageWindow(safeCurrentPage, totalPages), [safeCurrentPage, totalPages]);
  const timeframeLabel = getTimeframeLabel(timeframe);

  const selectedLead = useMemo(
    () => sortedLeads.find((item) => item.id === selectedLeadId) ?? null,
    [selectedLeadId, sortedLeads],
  );
  const selectedReplies = useMemo(
    () =>
      scopedReplies
        .filter((item) => item.lead_id === selectedLead?.id)
        .sort((a, b) => b.received_at.localeCompare(a.received_at)),
    [scopedReplies, selectedLead],
  );
  const selectedLeadView = useMemo<LeadDrawerData | null>(() => {
    if (!selectedLead) return null;
    const campaign = campaignById.get(selectedLead.campaign_id ?? "");
    const stage = getLeadStage(selectedLead);
    const latestReply = selectedReplies[0];
    const inlineReply = selectedLead.reply_text?.trim();
    const fullName = getFullName(selectedLead.first_name, selectedLead.last_name);
    return {
      lead: selectedLead,
      replies: selectedReplies,
      name: fullName,
      initials: fullName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      email: selectedLead.email ?? "No email",
      title: selectedLead.job_title ?? "No title",
      company: selectedLead.company_name ?? "No company",
      stage,
      campaignName: campaign?.name ?? "No campaign linked",
      step: selectedLead.message_number ?? latestReply?.sequence_step ?? null,
      replyCount: selectedReplies.length || (inlineReply ? 1 : 0),
      lastReplyDate: latestReply?.received_at ?? (inlineReply ? selectedLead.updated_at : null),
      addedDate: selectedLead.created_at,
    };
  }, [campaignById, selectedLead, selectedReplies]);

  function openCreateLead() {
    setCreateLeadDraft({
      clientId: scopedClients[0]?.id ?? "",
      campaignId: "",
      firstName: "",
      lastName: "",
      email: "",
      companyName: "",
      jobTitle: "",
    });
    setIsCreatingLead(true);
  }

  async function handleCreateLead() {
    if (!createLeadDraft || !createLeadDraft.clientId) return;
    setIsSubmittingCreateLead(true);
    try {
      await createLead({
        client_id: createLeadDraft.clientId,
        campaign_id: createLeadDraft.campaignId || null,
        first_name: createLeadDraft.firstName.trim() || null,
        last_name: createLeadDraft.lastName.trim() || null,
        email: createLeadDraft.email.trim() || null,
        company_name: createLeadDraft.companyName.trim() || null,
        job_title: createLeadDraft.jobTitle.trim() || null,
        source: "manual",
        qualification: null,
        comments: null,
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
      setIsCreatingLead(false);
      setCreateLeadDraft(null);
    } catch {
      // error shown via toast from core-data
    } finally {
      setIsSubmittingCreateLead(false);
    }
  }

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
    if (campaignFilter === ALL_FILTER_VALUE) return;
    if (!clientFilteredCampaigns.some((c) => c.id === campaignFilter)) {
      setCampaignFilter(ALL_FILTER_VALUE);
    }
  }, [campaignFilter, clientFilteredCampaigns]);

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

    if (clientFilter !== ALL_FILTER_VALUE) {
      nextParams.set("client", clientFilter);
    } else {
      nextParams.delete("client");
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
    clientFilter,
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

  function handleClientFilterChange(value: string) {
    setClientFilter(value);
    setCampaignFilter(ALL_FILTER_VALUE);
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
        actions={
          <div className="flex items-center gap-3">
            <DateRangeButton value={timeframe} onChange={handleTimeframeChange} />
            <button
              onClick={openCreateLead}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20"
            >
              New lead
            </button>
          </div>
        }
      />

      <Surface title="Lead filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="space-y-4">
          <div className={`grid gap-4 ${scopedClients.length > 1 ? "xl:grid-cols-[1fr_180px_220px_180px]" : "xl:grid-cols-[1fr_260px_220px]"}`}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search by name, email, company, title, country"
                className="w-full rounded-md border border-[#242424] bg-[#080808] px-11 py-3 text-sm text-white outline-none transition placeholder:text-neutral-400 focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
              />
            </div>
            {scopedClients.length > 1 ? (
              <Select value={clientFilter} onValueChange={handleClientFilterChange}>
                <SelectTrigger
                  aria-label="Filter leads by client"
                  className="h-auto rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white"
                >
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All clients
                  </SelectItem>
                  {scopedClients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
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
                {clientFilteredCampaigns.map((campaign) => (
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
                {([
                  { key: "lead" as const, label: "Lead", lgOnly: false },
                  ...(showClientColumn ? [{ key: "client" as const, label: "Client", lgOnly: true }] : []),
                  { key: "company" as const, label: "Company", lgOnly: false },
                  { key: "status" as const, label: "Status", lgOnly: false },
                  { key: "updated" as const, label: "Updated", lgOnly: true },
                ]).map((column, index, collection) => (
                  <div key={column.key} className={cn("relative min-w-0", column.lgOnly ? "hidden lg:block" : "")}>
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
                        {showClientColumn ? (
                          <div className="hidden text-sm text-neutral-300 lg:block">
                            {clientById.get(lead.client_id)?.name ?? "—"}
                          </div>
                        ) : null}
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

      <Sheet open={isCreatingLead} onOpenChange={setIsCreatingLead}>
        <SheetContent className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle className="text-white">New lead</SheetTitle>
            <SheetDescription>Fill in the required fields to create a new lead manually.</SheetDescription>
          </SheetHeader>
          {createLeadDraft && (
            <div className="space-y-4 px-6 pb-6">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client *</span>
                <Select
                  value={createLeadDraft.clientId}
                  onValueChange={(v) => setCreateLeadDraft((d) => d ? { ...d, clientId: v, campaignId: "" } : d)}
                >
                  <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    {scopedClients.map((client) => (
                      <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campaign</span>
                <Select
                  value={createLeadDraft.campaignId || "__none__"}
                  onValueChange={(v) => setCreateLeadDraft((d) => d ? { ...d, campaignId: v === "__none__" ? "" : v } : d)}
                >
                  <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="No campaign" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    <SelectItem value="__none__" className="text-white focus:bg-[#1a1a1a] focus:text-white">No campaign</SelectItem>
                    {scopedCampaigns
                      .filter((c) => c.client_id === createLeadDraft.clientId)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">First name</span>
                  <input
                    value={createLeadDraft.firstName}
                    onChange={(e) => setCreateLeadDraft((d) => d ? { ...d, firstName: e.target.value } : d)}
                    placeholder="Optional"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last name</span>
                  <input
                    value={createLeadDraft.lastName}
                    onChange={(e) => setCreateLeadDraft((d) => d ? { ...d, lastName: e.target.value } : d)}
                    placeholder="Optional"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</span>
                <input
                  type="email"
                  value={createLeadDraft.email}
                  onChange={(e) => setCreateLeadDraft((d) => d ? { ...d, email: e.target.value } : d)}
                  placeholder="Optional"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Company</span>
                <input
                  value={createLeadDraft.companyName}
                  onChange={(e) => setCreateLeadDraft((d) => d ? { ...d, companyName: e.target.value } : d)}
                  placeholder="Optional"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Job title</span>
                <input
                  value={createLeadDraft.jobTitle}
                  onChange={(e) => setCreateLeadDraft((d) => d ? { ...d, jobTitle: e.target.value } : d)}
                  placeholder="Optional"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <p className="text-xs text-muted-foreground">Source will be set to <span className="text-white">manual</span>.</p>

              <button
                onClick={() => { void handleCreateLead(); }}
                disabled={isSubmittingCreateLead || !createLeadDraft.clientId}
                className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingCreateLead ? "Creating..." : "Create lead"}
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

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

              <LeadEditForm
                draft={draft}
                updateDraft={(updater) => setDraft((current) => (current ? updater(current) : current))}
                readOnly={identity?.role === "client"}
              />

              {selectedLeadView && (
                <div className="-mx-6 border-t border-border">
                  <LeadConversation lead={selectedLeadView} />
                  <LeadMetaSection lead={selectedLeadView.lead} />
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function EditLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{children}</span>
  );
}

function EditInput({
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-sky-400/40 disabled:opacity-60"
    />
  );
}

const LEAD_GENDER_UNSET = "__lead_gender_unset__";

function LeadEditForm({
  draft,
  updateDraft,
  readOnly,
}: {
  draft: LeadDraft;
  updateDraft: (updater: (current: LeadDraft) => LeadDraft) => void;
  readOnly: boolean;
}) {
  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    updateDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Identity</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>First name</EditLabel>
            <EditInput value={draft.firstName} onChange={(v) => set("firstName", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>Last name</EditLabel>
            <EditInput value={draft.lastName} onChange={(v) => set("lastName", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>Email</EditLabel>
            <EditInput value={draft.email} onChange={(v) => set("email", v)} disabled={readOnly} type="email" />
          </label>
          <label className="space-y-2">
            <EditLabel>Job title</EditLabel>
            <EditInput value={draft.jobTitle} onChange={(v) => set("jobTitle", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2 md:col-span-2">
            <EditLabel>Company</EditLabel>
            <EditInput value={draft.companyName} onChange={(v) => set("companyName", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>LinkedIn URL</EditLabel>
            <EditInput
              value={draft.linkedinUrl}
              onChange={(v) => set("linkedinUrl", v)}
              disabled={readOnly}
              placeholder="https://linkedin.com/in/…"
            />
          </label>
          <label className="space-y-2">
            <EditLabel>Website</EditLabel>
            <EditInput value={draft.website} onChange={(v) => set("website", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>Phone</EditLabel>
            <EditInput value={draft.phoneNumber} onChange={(v) => set("phoneNumber", v)} disabled={readOnly} type="tel" />
          </label>
          <label className="space-y-2">
            <EditLabel>Phone source</EditLabel>
            <EditInput
              value={draft.phoneSource}
              onChange={(v) => set("phoneSource", v)}
              disabled={readOnly}
              placeholder="manual, enrichment, …"
            />
          </label>
          <label className="space-y-2">
            <EditLabel>Gender</EditLabel>
            <Select
              value={draft.gender === "" ? LEAD_GENDER_UNSET : draft.gender}
              disabled={readOnly}
              onValueChange={(value) =>
                set("gender", value === LEAD_GENDER_UNSET ? "" : (value as LeadGender))
              }
            >
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60">
                <SelectValue placeholder="Unknown" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={LEAD_GENDER_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  Unknown
                </SelectItem>
                <SelectItem value="male" className="text-white focus:bg-[#1a1a1a] focus:text-white">male</SelectItem>
                <SelectItem value="female" className="text-white focus:bg-[#1a1a1a] focus:text-white">female</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2">
            <EditLabel>Country</EditLabel>
            <EditInput value={draft.country} onChange={(v) => set("country", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>Industry</EditLabel>
            <EditInput value={draft.industry} onChange={(v) => set("industry", v)} disabled={readOnly} />
          </label>
          <label className="space-y-2">
            <EditLabel>Headcount</EditLabel>
            <EditInput
              value={draft.headcountRange}
              onChange={(v) => set("headcountRange", v)}
              disabled={readOnly}
              placeholder="e.g. 51-200"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pipeline</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>Qualification</EditLabel>
            <Select
              value={draft.qualification === "" ? LEAD_QUALIFICATION_UNSET : draft.qualification}
              disabled={readOnly}
              onValueChange={(value) =>
                set("qualification", value === LEAD_QUALIFICATION_UNSET ? "" : (value as LeadQualification))
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
            <EditLabel>Comments</EditLabel>
            <textarea
              value={draft.comments}
              onChange={(event) => set("comments", event.target.value)}
              disabled={readOnly}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none disabled:opacity-60"
            />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { label: "Meeting booked", key: "meetingBooked" as const, value: draft.meetingBooked },
            { label: "Meeting held", key: "meetingHeld" as const, value: draft.meetingHeld },
            { label: "Offer sent", key: "offerSent" as const, value: draft.offerSent },
            { label: "Won", key: "won" as const, value: draft.won },
          ].map((item) => (
            <label key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <EditLabel>{item.label}</EditLabel>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm">{item.value ? "Yes" : "No"}</span>
                <Checkbox
                  checked={item.value}
                  disabled={readOnly}
                  onCheckedChange={(checked) => set(item.key, checked === true)}
                />
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">OOO</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>Expected return date</EditLabel>
            <EditInput
              value={draft.expectedReturnDate}
              onChange={(v) => set("expectedReturnDate", v)}
              disabled={readOnly}
              type="date"
            />
          </label>
          <label className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <EditLabel>In OOO campaign</EditLabel>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm">{draft.addedToOooCampaign ? "Yes" : "No"}</span>
              <Checkbox
                checked={draft.addedToOooCampaign}
                disabled={readOnly}
                onCheckedChange={(checked) => set("addedToOooCampaign", checked === true)}
              />
            </div>
          </label>
        </div>
      </section>
    </div>
  );
}
