import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MessageSquare, Search, X } from "lucide-react";
import { DateRangeButton, FilterChip } from "../components/portal-ui";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { formatDate, getFullName } from "../lib/format";
import { getLeadStage, scopeCampaigns, scopeLeads, scopeReplies } from "../lib/selectors";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { useResizableColumns } from "../lib/use-resizable-columns";
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

export function LeadsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientLeadsPage />;
  return <InternalLeadsPage />;
}

function InternalLeadsPage() {
  const { identity } = useAuth();
  const { clients, leads, replies, campaigns, updateLead, loading, error, refresh } = useCoreData();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState(ALL_FILTER_VALUE);
  const [replyScope, setReplyScope] = useState<ReplyScope>("all");
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [leadSort, setLeadSort] = useState<{ key: LeadSortKey; direction: SortDirection }>({
    key: "updated",
    direction: "desc",
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

  const visibleLeads = useMemo(() => sortedLeads.slice(0, visibleRowsCount), [sortedLeads, visibleRowsCount]);
  const hasMoreLeads = visibleRowsCount < sortedLeads.length;
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
  }, [selectedLead?.id]);

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    setSelectedLeadId(null);
  }, [campaignFilter, query, replyScope, scopedLeads.length, stageFilter, timeframe]);

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
        actions={<DateRangeButton value={timeframe} onChange={setTimeframe} />}
      />

      <Surface title="Lead filters" subtitle={`Current timeframe: ${timeframeLabel}`}>
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_260px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, email, company, title, country"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-11 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
              />
            </div>
            <Select value={campaignFilter} onValueChange={setCampaignFilter}>
              <SelectTrigger
                aria-label="Filter leads by campaign"
                className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
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
            <Select value={replyScope} onValueChange={(value) => setReplyScope(value as ReplyScope)}>
              <SelectTrigger
                aria-label="Filter leads by reply scope"
                className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
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

          <div className="flex flex-wrap gap-2">
            <FilterChip active={stageFilter === "all"} onClick={() => setStageFilter("all")}>
              All <span className="ml-1 text-neutral-500">{baseFilteredLeads.length}</span>
            </FilterChip>
            {PIPELINE_STAGES.map((stage) => (
              <FilterChip key={stage.key} active={stageFilter === stage.key} onClick={() => setStageFilter(stage.key)}>
                <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                {stage.label}
                <span className="ml-1 text-neutral-500">{stageCounts.get(stage.key) ?? 0}</span>
              </FilterChip>
            ))}
          </div>
        </div>
      </Surface>

      {filteredLeads.length === 0 ? (
        <EmptyState title="No leads match the current filters" description="Leads are scoped by role and searchable across core enrichment fields." />
      ) : (
        <Surface title="Lead list" subtitle={`${visibleLeads.length} of ${sortedLeads.length} leads in current scope`}>
            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="overflow-x-auto" style={leadTableStyle}>
                <div className="hidden min-w-[1100px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:[grid-template-columns:var(--leads-table-columns)]">
                  {[
                    { key: "lead" as const, label: "Lead" },
                    { key: "company" as const, label: "Company" },
                    { key: "status" as const, label: "Status" },
                    { key: "updated" as const, label: "Updated" },
                  ].map((column, index, collection) => (
                    <div key={column.key} className="relative min-w-0">
                      <button
                        onClick={() =>
                          setLeadSort((current) =>
                            current.key === column.key
                              ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.key, direction: column.key === "updated" ? "desc" : "asc" },
                          )
                        }
                        className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                      >
                        {column.label} ({sortIndicator(leadSort.key === column.key, leadSort.direction)})
                      </button>
                      {index < collection.length - 1 && (
                        <div onMouseDown={leadColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="min-w-[1100px] divide-y divide-border">
                  {visibleLeads.map((lead) => {
                    const active = selectedLead?.id === lead.id;
                    const campaign = campaignById.get(lead.campaign_id ?? "");
                    return (
                      <button
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        aria-label={`Open details for ${getFullName(lead.first_name, lead.last_name)}`}
                        className={`grid w-full gap-3 px-4 py-4 text-left transition md:min-w-[1100px] md:[grid-template-columns:var(--leads-table-columns)] ${
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
                        </div>
                        <div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">
                            {getLeadStage(lead)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">{formatDate(lead.updated_at, { day: "2-digit", month: "short" })}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {hasMoreLeads && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setVisibleRowsCount((current) => current + PAGE_SIZE)}
                  className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
                >
                  Load more leads
                </button>
              </div>
            )}
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
                  {selectedLead.job_title ?? "No title"} - {selectedLead.company_name ?? "No company"}
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
                              {reply.classification ?? "unclassified"} - {reply.language_detected ?? "lang n/a"}
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

