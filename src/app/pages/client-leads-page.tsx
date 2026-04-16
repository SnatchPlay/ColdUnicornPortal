import { useMemo, useState } from "react";
import { Download, MessageSquare } from "lucide-react";
import {
  DateRangeButton,
  EmptyPortalState,
  FilterChip,
  LeadDrawer,
  PipelineBadge,
  PortalPageHeader,
  PortalSearch,
} from "../components/portal-ui";
import { getClientLeadRows, PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel } from "../lib/timeframe";
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaigns, scopeClients, scopeLeads, scopeReplies } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

type ReplyScope = "all" | "active" | "ooo";

export function ClientLeadsPage() {
  const { identity } = useAuth();
  const { clients, leads, replies, campaigns } = useCoreData();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [replyScope, setReplyScope] = useState<ReplyScope>("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());

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
  const selectedRow = filteredRows.find((row) => row.id === selectedLeadId) ?? null;
  const clientName = scopedClients[0]?.name ?? "Client";
  const timeframeLabel = getTimeframeLabel(timeframe);

  return (
    <div className="space-y-7">
      <PortalPageHeader
        title="My Pipeline"
        subtitle={`${formatNumber(filteredRows.length)} leads · ${timeframeLabel.toLowerCase()} · click a row to open details`}
        actions={
          <div className="flex gap-3">
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
            <button className="inline-flex items-center gap-2 rounded-xl border border-[#242424] px-4 py-2.5 text-sm text-neutral-300 transition hover:border-[#3a3a3a] hover:text-white">
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
        <select
          value={campaignFilter}
          onChange={(event) => setCampaignFilter(event.target.value)}
          className="h-[52px] rounded-2xl border border-[#242424] bg-[#050505] px-5 text-base text-neutral-300 outline-none"
        >
          <option value="all">All Campaigns</option>
          {scopedCampaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <select
          value={replyScope}
          onChange={(event) => setReplyScope(event.target.value as ReplyScope)}
          className="h-[52px] rounded-2xl border border-[#242424] bg-[#050505] px-5 text-base text-neutral-300 outline-none"
        >
          <option value="all">All (OOO + Active)</option>
          <option value="active">Active only</option>
          <option value="ooo">OOO only</option>
        </select>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyPortalState title="No leads match the current filters" description={`${clientName} has no leads in this view.`} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#242424] bg-[#050505]">
          <div className="grid grid-cols-[1.35fr_1.15fr_1.2fr_1.35fr_0.65fr_0.75fr_0.9fr_0.9fr] gap-5 border-b border-[#1f1f1f] px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">
            <span>Lead</span>
            <span>Company</span>
            <span>Status</span>
            <span>Campaign</span>
            <span>Step #</span>
            <span>Replies</span>
            <span>Last Reply</span>
            <span>Added</span>
          </div>
          <div className="divide-y divide-[#151515]">
            {filteredRows.map((row) => (
              <button
                key={row.id}
                onClick={() => setSelectedLeadId(row.id)}
                className="grid w-full grid-cols-[1.35fr_1.15fr_1.2fr_1.35fr_0.65fr_0.75fr_0.9fr_0.9fr] gap-5 px-5 py-4 text-left transition hover:bg-[#0d0d0d]"
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
                  {row.replyCount > 0 && (
                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">
                      {row.replyLabel}
                    </span>
                  )}
                </div>
                <p className="text-sm text-neutral-300">
                  {row.lastReplyDate ? formatDate(row.lastReplyDate, { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                </p>
                <p className="text-sm text-neutral-300">{formatDate(row.addedDate, { day: "numeric", month: "short", year: "2-digit" })}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <LeadDrawer open={Boolean(selectedRow)} onClose={() => setSelectedLeadId(null)} lead={selectedRow} />
    </div>
  );
}
