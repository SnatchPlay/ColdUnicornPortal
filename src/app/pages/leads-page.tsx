import { useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { EmptyState, PageHeader, Surface } from "../components/app-ui";
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

export function LeadsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientLeadsPage />;
  return <InternalLeadsPage />;
}

function InternalLeadsPage() {
  const { identity } = useAuth();
  const { clients, leads, replies, campaigns, updateLead } = useCoreData();
  const [query, setQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

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

  const selectedLead = filteredLeads.find((item) => item.id === selectedLeadId) ?? filteredLeads[0] ?? null;
  const selectedReplies = scopedReplies
    .filter((item) => item.lead_id === selectedLead?.id)
    .sort((a, b) => b.received_at.localeCompare(a.received_at));

  async function patchLead(lead: LeadRecord, patch: Partial<LeadRecord>) {
    await updateLead(lead.id, patch);
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
          <Surface title="Lead list" subtitle={`${filteredLeads.length} leads in current scope`}>
            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="hidden grid-cols-[1.3fr_1fr_0.9fr_0.8fr] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid">
                <span>Lead</span>
                <span>Company</span>
                <span>Status</span>
                <span>Updated</span>
              </div>
              <div className="divide-y divide-border">
                {filteredLeads.map((lead) => {
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
          </Surface>

          <Surface title="Lead detail" subtitle="Context drawer replacement built into the page layout.">
            {!selectedLead ? (
              <EmptyState title="Select a lead" description="Lead detail becomes available when you choose a row from the list." />
            ) : (
              <div className="space-y-5">
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
                    <select
                      value={selectedLead.qualification ?? ""}
                      onChange={(event) =>
                        patchLead(selectedLead, { qualification: event.target.value as LeadQualification })
                      }
                      disabled={identity?.role === "client"}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                    >
                      {EDITABLE_QUALIFICATIONS.map((qualification) => (
                        <option key={qualification} value={qualification}>
                          {qualification}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Comments</span>
                    <textarea
                      value={selectedLead.comments ?? ""}
                      onChange={(event) => void patchLead(selectedLead, { comments: event.target.value })}
                      disabled={identity?.role === "client"}
                      rows={4}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  {[
                    { label: "Meeting booked", key: "meeting_booked" as const, value: selectedLead.meeting_booked },
                    { label: "Meeting held", key: "meeting_held" as const, value: selectedLead.meeting_held },
                    { label: "Offer sent", key: "offer_sent" as const, value: selectedLead.offer_sent },
                    { label: "Won", key: "won" as const, value: selectedLead.won },
                  ].map((item) => (
                    <label key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</span>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-sm">{item.value ? "Yes" : "No"}</span>
                        <input
                          type="checkbox"
                          checked={item.value}
                          disabled={identity?.role === "client"}
                          onChange={(event) =>
                            void patchLead(selectedLead, { [item.key]: event.target.checked } as Partial<LeadRecord>)
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
                    <EmptyState title="No reply history" description="The live schema already supports replies, but the current dataset may still be sparse." />
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
