import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, getFullName } from "../lib/format";
import { getLeadStage, scopeClients, scopeLeads, scopeReplies } from "../lib/selectors";
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

const PAGE_SIZE = 50;

interface LeadDraft {
  qualification: LeadQualification | "";
  comments: string;
  meetingBooked: boolean;
  meetingHeld: boolean;
  offerSent: boolean;
  won: boolean;
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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedLeads = useMemo(() => (identity ? scopeLeads(identity, clients, leads) : []), [clients, identity, leads]);
  const scopedReplies = useMemo(() => (identity ? scopeReplies(identity, clients, replies) : []), [clients, identity, replies]);

  const filteredLeads = useMemo(() => {
    return scopedLeads.filter((lead) => {
      const haystack = [
        getFullName(lead.first_name, lead.last_name),
        lead.email,
        lead.company_name,
        lead.job_title,
        lead.country,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [query, scopedLeads]);

  const visibleLeads = useMemo(() => filteredLeads.slice(0, visibleRowsCount), [filteredLeads, visibleRowsCount]);
  const hasMoreLeads = visibleRowsCount < filteredLeads.length;

  const selectedLead = visibleLeads.find((item) => item.id === selectedLeadId) ?? visibleLeads[0] ?? null;
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
  }, [query, scopedLeads.length]);

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
      />

      <Surface>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, company, title, country"
            className="w-full rounded-2xl border border-white/10 bg-black/20 px-11 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
          />
        </div>
      </Surface>

      {filteredLeads.length === 0 ? (
        <EmptyState title="No leads match the current filters" description="Leads are scoped by role and searchable across core enrichment fields." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Surface title="Lead list" subtitle={`${visibleLeads.length} of ${filteredLeads.length} leads in current scope`}>
            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="hidden grid-cols-[1.3fr_1fr_0.9fr_0.8fr] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid">
                <span>Lead</span>
                <span>Company</span>
                <span>Status</span>
                <span>Updated</span>
              </div>
              <div className="divide-y divide-border">
                {visibleLeads.map((lead) => {
                  const active = selectedLead?.id === lead.id;
                  const campaign = campaigns.find((item) => item.id === lead.campaign_id);
                  return (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`grid w-full gap-3 px-4 py-4 text-left transition md:grid-cols-[1.3fr_1fr_0.9fr_0.8fr] ${
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

          <Surface title="Lead detail" subtitle="Context drawer replacement built into the page layout.">
            {!selectedLead ? (
              <EmptyState title="Select a lead" description="Lead detail becomes available when you choose a row from the list." />
            ) : (
              <div className="space-y-5">
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
                  <p className="text-xl">{getFullName(selectedLead.first_name, selectedLead.last_name)}</p>
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
                      value={(draft?.qualification ?? "") === "" ? LEAD_QUALIFICATION_UNSET : (draft?.qualification ?? "")}
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
                      value={draft?.comments ?? ""}
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
                    { label: "Meeting booked", key: "meeting_booked" as const, value: draft?.meetingBooked ?? false },
                    { label: "Meeting held", key: "meeting_held" as const, value: draft?.meetingHeld ?? false },
                    { label: "Offer sent", key: "offer_sent" as const, value: draft?.offerSent ?? false },
                    { label: "Won", key: "won" as const, value: draft?.won ?? false },
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
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
