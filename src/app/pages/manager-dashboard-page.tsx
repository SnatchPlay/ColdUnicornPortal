import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { DateRangeButton, LeadConversation, LeadMetaSection, type LeadDrawerData } from "../components/portal-ui";
import { LeadEditForm } from "../components/lead-edit-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { repository } from "../data/repository";
import { buildLeadPatch, toLeadDraft, type LeadDraft } from "../lib/lead-draft";
import { DASHBOARD_CHART_TOOLTIP, MOMENTUM_CHARTS, formatMomentumSeries, mapDashboardError, pipelineCountsFromGroups } from "../lib/dashboard-momentum";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import { formatDate, formatNumber, getFullName } from "../lib/format";
import { getLeadStage } from "../lib/selectors";
import { createDefaultTimeframe, getTimeframeLabel, resolveTimeframeBounds, type TimeframeValue } from "../lib/timeframe";
import { useLeadDetail } from "../lib/use-leads";
import type { CampaignStatus } from "../types/core";
import type { LeadsListRow, ManagerDashboardOverview } from "../types/view-contracts";
import { useAuth } from "../providers/auth";

/** Format a local Date as YYYY-MM-DD (timezone-safe, unlike toISOString which shifts to UTC). */
function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const ALL_CLIENTS = "__all_clients__";
const ALL_STATUSES = "all";

const CAMPAIGN_STATUS_OPTIONS: Array<{ value: CampaignStatus | typeof ALL_STATUSES; label: string }> = [
  { value: "active", label: "Active" },
  { value: "launching", label: "Launching" },
  { value: "stopped", label: "Stopped" },
  { value: "completed", label: "Completed" },
  { value: "draft", label: "Draft" },
  { value: ALL_STATUSES, label: "All statuses" },
];

function useManagerDashboard(managerId: string, clientId: string, campaignStatus: string, dateFrom?: string, dateTo?: string) {
  const { identity, loading: authLoading } = useAuth();
  const [data, setData] = useState<ManagerDashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Stale-response guard (CLAUDE.md §2.3): discard slow responses superseded by a newer filter.
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!managerId) return;
    const id = ++loadIdRef.current;
    setLoading(true);
    try {
      const result = await repository.loadManagerDashboardOverview(managerId, {
        clientId: clientId === ALL_CLIENTS ? undefined : clientId,
        campaignStatus,
        dateFrom,
        dateTo,
      });
      if (id !== loadIdRef.current) return;
      setData(result);
      setError(null);
    } catch (reason) {
      if (id !== loadIdRef.current) return;
      setError(mapDashboardError(reason));
    } finally {
      if (id === loadIdRef.current) setLoading(false);
    }
  }, [managerId, clientId, campaignStatus, dateFrom, dateTo]);

  useEffect(() => {
    if (authLoading || !identity || !managerId) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
    // On unmount / dep change, bump the load id so any in-flight resolve is discarded as stale.
    return () => { loadIdRef.current += 1; };
  }, [authLoading, identity, managerId, load]);

  return { data, loading, error, refresh: load };
}

// ── Lead detail drawer (editable) — reuses the shared lead form + conversation primitives ───────
const ManagerLeadDrawer = memo(function ManagerLeadDrawer({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadsListRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { replies, loading: loadingReplies } = useLeadDetail(lead?.id ?? null);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(lead ? toLeadDraft(lead) : null);
  }, [lead]);

  useEffect(() => {
    if (!lead) return;
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  const patch = useMemo(() => (lead && draft ? buildLeadPatch(lead, draft) : {}), [lead, draft]);
  const isDirty = Object.keys(patch).length > 0;

  const leadView = useMemo<LeadDrawerData | null>(() => {
    if (!lead) return null;
    const stage = getLeadStage(lead);
    const latestReply = replies[0];
    const inlineReply = lead.reply_text?.trim();
    const fullName = getFullName(lead.first_name, lead.last_name);
    return {
      lead,
      replies,
      name: fullName,
      initials: fullName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      email: lead.email ?? "No email",
      title: lead.job_title ?? "No title",
      company: lead.company_name ?? "No company",
      stage: stage as PipelineStage,
      campaignName: lead.campaignName ?? "No campaign linked",
      step: lead.message_number ?? latestReply?.sequence_step ?? null,
      replyCount: lead.replyCount || (inlineReply ? 1 : 0),
      lastReplyDate: latestReply?.received_at ?? (inlineReply ? lead.updated_at : null),
      addedDate: lead.created_at,
    };
  }, [lead, replies]);

  if (!lead || !draft) return null;

  async function save() {
    if (!lead || !isDirty) return;
    setIsSaving(true);
    try {
      await repository.updateLead(lead.id, patch);
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save lead changes.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${getFullName(lead.first_name, lead.last_name)} details`}
        className="flex h-full w-full max-w-[860px] flex-col border-l border-border bg-[#050505] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div>
            <h2 className="text-xl">{getFullName(lead.first_name, lead.last_name)}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{lead.clientName} · lead detail with editable qualification and reply history.</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-primary/30 hover:text-foreground" aria-label="Close lead details">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link to={`/manager/leads?q=${encodeURIComponent(lead.email ?? getFullName(lead.first_name, lead.last_name))}`} className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30">
              Open in Leads
            </Link>
            <button onClick={() => { void save(); }} disabled={!isDirty || isSaving} className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? "Saving..." : "Save changes"}
            </button>
          </div>

          <LeadEditForm draft={draft} updateDraft={(updater) => setDraft((current) => (current ? updater(current) : current))} readOnly={false} />

          {loadingReplies ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Loading reply history…
            </div>
          ) : leadView ? (
            <div className="-mx-6 border-t border-border">
              <LeadConversation lead={leadView} />
              <LeadMetaSection lead={lead} />
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
});

export function ManagerDashboardPage() {
  const { identity } = useAuth();
  const managerId = identity?.id ?? "";
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [timeframe, setTimeframe] = useState<TimeframeValue>(() => createDefaultTimeframe());
  const { start: tfFrom, end: tfTo } = useMemo(() => resolveTimeframeBounds(timeframe), [timeframe]);
  const dateFrom = tfFrom ? toYmd(tfFrom) : undefined;
  const dateTo = tfTo ? toYmd(tfTo) : undefined;
  const { data, loading, error, refresh } = useManagerDashboard(managerId, clientFilter, statusFilter, dateFrom, dateTo);
  const [selectedLead, setSelectedLead] = useState<LeadsListRow | null>(null);

  const statusLabel = useMemo(
    () => CAMPAIGN_STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "Active",
    [statusFilter],
  );
  const timeframeLabel = useMemo(() => getTimeframeLabel(timeframe), [timeframe]);

  // Pipeline split (shared with AdminDashboardPage): MQL / preMQL / beyond / unqualified buckets.
  const pipelineCounts = useMemo(() => pipelineCountsFromGroups(data?.pipelineGroups), [data]);

  const metrics = useMemo(() => [
    {
      label: "Assigned clients",
      value: formatNumber(data?.metrics.assignedClientsCount ?? 0),
      hint: clientFilter === ALL_CLIENTS ? "Portfolio under manager ownership" : "Filtered to one client",
      tone: "info" as const,
    },
    {
      label: `${statusLabel} campaigns`,
      value: formatNumber(data?.metrics.campaignsCount ?? 0),
      hint: `Campaigns with status: ${statusLabel.toLowerCase()}`,
      tone: "success" as const,
    },
    {
      label: "MQLs",
      value: formatNumber(pipelineCounts.mql),
      hint: `${formatNumber(pipelineCounts.beyondMql)} beyond MQL · ${timeframeLabel}`,
      tone: "neutral" as const,
    },
    {
      label: "preMQLs",
      value: formatNumber(pipelineCounts.preMql),
      hint: `${formatNumber(pipelineCounts.unqualified)} unqualified · ${timeframeLabel}`,
      tone: "neutral" as const,
    },
  ], [data, clientFilter, statusLabel, pipelineCounts, timeframeLabel]);

  const campaignSeries = useMemo(() => formatMomentumSeries(data?.campaignMomentum21d), [data]);

  const clientPortfolio = useMemo(() => {
    return (data?.clientPortfolio ?? []).map((client) => {
      const progress = client.kpiLeads ? (client.mqlCount / client.kpiLeads) * 100 : null;
      return {
        id: client.clientId,
        name: client.clientName,
        status: client.status,
        campaigns: client.campaignsCount,
        mqls: client.mqlCount,
        won: client.wonCount,
        progress,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const campaignWatchlist = useMemo(() => {
    return (data?.campaignWatchlist ?? [])
      .map((row) => ({
        id: row.campaignId,
        name: row.campaignName,
        status: row.status,
        sent: row.sent,
        replies: row.replies,
        replyRate: row.sent > 0 ? (row.replies / row.sent) * 100 : 0,
      }))
      .filter((c) => c.status !== "active" || c.replyRate < 1)
      .sort((a, b) => a.replyRate - b.replyRate)
      .slice(0, 8);
  }, [data]);

  const leadQueue = useMemo(() => data?.leadQueue ?? [], [data]);
  const filterClients = useMemo(() => data?.filterClients ?? [], [data]);

  if (loading && !data) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Manager Dashboard"
          subtitle="Assigned-client operations hub: lead queue, campaign momentum, portfolio status."
        />
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton onClick={() => { void refresh(); }}>Retry data sync</InlineLinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manager Dashboard"
        subtitle="Assigned-client operations hub: lead queue, campaign momentum, portfolio status."
      />

      <Surface
        title="Filters"
        subtitle={`All metrics, charts and the lead queue reflect the selected period · ${timeframeLabel}${loading ? " · Refreshing…" : ""}`}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</span>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger aria-label="Filter dashboard by client" className="h-auto w-full rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_CLIENTS} className="text-white focus:bg-[#1a1a1a] focus:text-white">All clients</SelectItem>
                {filterClients.map((client) => (
                  <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">{client.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campaign status</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter dashboard by campaign status" className="h-auto w-full rounded-md border-[#242424] bg-[#080808] px-4 py-3 text-sm text-white">
                <SelectValue placeholder="Active" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                {CAMPAIGN_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-white focus:bg-[#1a1a1a] focus:text-white">{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col items-start gap-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Date range</span>
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
          </label>
        </div>
      </Surface>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      {/* Charts on the left; lead queue + watchlist + portfolio stacked on the right. */}
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {MOMENTUM_CHARTS.map((chart) => (
            <Surface key={chart.key} title={chart.title} subtitle={chart.subtitle}>
              {campaignSeries.length === 0 ? (
                <EmptyState title="No campaign trend data" description="No campaign trend data is available for the current scope." />
              ) : (
                <>
                  <ChartTextSummary summary={`${chart.title} chart with ${campaignSeries.length} daily points.`} />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={campaignSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip {...DASHBOARD_CHART_TOOLTIP} />
                        <Area type="monotone" dataKey={chart.key} stroke={chart.stroke} fill={chart.fill} strokeWidth={2} />
                        <Line type="monotone" dataKey={`${chart.key}_trend`} stroke={chart.stroke} strokeDasharray="4 2" strokeOpacity={0.55} strokeWidth={1.5} dot={false} activeDot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Surface>
          ))}
        </div>

        <div className="space-y-5">
          <Surface
            title="Lead queue"
            subtitle="Most recent leads in the selected period. Click a lead to review and update it."
            actions={<Link to="/manager/leads" className="text-sm text-sky-300 hover:text-sky-200">Open leads</Link>}
          >
            {leadQueue.length === 0 ? (
              <EmptyState title="No leads in queue" description="No leads were created in the selected period for this scope." />
            ) : (
              <div className="space-y-3">
                {leadQueue.map((lead) => {
                  const stage = getLeadStage(lead) as PipelineStage;
                  const stageMeta = PIPELINE_STAGES.find((s) => s.key === stage);
                  const color = stageMeta?.color ?? "#737373";
                  const label = stageMeta?.label ?? stage;
                  return (
                    <button
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      aria-label={`Open details for ${getFullName(lead.first_name, lead.last_name)}`}
                      className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border bg-black/10 p-4 text-left transition hover:border-[#3a3a3a] hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{getFullName(lead.first_name, lead.last_name)}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{lead.clientName} · {lead.company_name ?? "—"}</p>
                        <p className="mt-2 text-xs text-muted-foreground">Updated {formatDate(lead.updated_at || lead.created_at)}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: `${color}55`, backgroundColor: `${color}18`, color }}>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Surface>

          <Surface
            title="Campaign watchlist"
            subtitle="Stopped/launching campaigns or low-reply performers in your scope."
            actions={<Link to="/manager/campaigns" className="text-sm text-sky-300 hover:text-sky-200">Open campaigns</Link>}
          >
            {campaignWatchlist.length === 0 ? (
              <EmptyState title="No campaign alerts" description="All scoped campaigns look healthy based on current status and reply rate." />
            ) : (
              <div className="space-y-3">
                {campaignWatchlist.map((campaign) => (
                  <div key={campaign.id} className="rounded-2xl border border-border bg-black/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm">{campaign.name}</p>
                      <p className="text-sm text-amber-300">{campaign.replyRate.toFixed(1)}%</p>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{campaign.status}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Sent</p>
                        <p>{formatNumber(campaign.sent)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Replies</p>
                        <p>{formatNumber(campaign.replies)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          <Surface
            title="Assigned client portfolio"
            subtitle="Client-level KPI snapshot for your scoped portfolio."
            actions={<Link to="/manager/clients" className="text-sm text-sky-300 hover:text-sky-200">Open client workspace</Link>}
          >
            {clientPortfolio.length === 0 ? (
              <EmptyState title="No assigned clients" description="Assign clients to this manager account to populate the portfolio." />
            ) : (
              <div className="space-y-3">
                {clientPortfolio.map((client) => (
                  <div key={client.id} className="rounded-2xl border border-border bg-black/10 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm">{client.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">{client.status}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        KPI progress: {client.progress === null ? "n/a" : `${Math.min(999, client.progress).toFixed(1)}%`}
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Campaigns</p>
                        <p>{formatNumber(client.campaigns)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">MQLs</p>
                        <p>{formatNumber(client.mqls)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Won</p>
                        <p>{formatNumber(client.won)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Surface>
        </div>
      </div>

      <ManagerLeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onSaved={refresh} />
    </div>
  );
}
