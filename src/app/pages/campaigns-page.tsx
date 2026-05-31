import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DateRangeButton } from "../components/portal-ui";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { repository } from "../data/repository";
import { formatDate, formatNumber } from "../lib/format";
import { useCampaignsList, useCampaignStats } from "../lib/use-campaigns";
import { createDefaultTimeframe, filterByTimeframe, getTimeframeLabel, type TimeframeValue } from "../lib/timeframe";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useAuth } from "../providers/auth";
import { useShellData } from "../providers/shell-data";
import type { CampaignRecord } from "../types/core";
import type { CampaignListRow, CampaignSortKey, CampaignsListParams } from "../types/view-contracts";
import { ClientCampaignsPage } from "./client-campaigns-page";

const PAGE_SIZE = 50;
const ALL_FILTER_VALUE = "__all__";

const CAMPAIGN_TYPES: CampaignRecord["type"][] = ["outreach", "ooo", "nurture", "ooo_followup"];
const CAMPAIGN_STATUSES: CampaignRecord["status"][] = ["draft", "launching", "active", "stopped", "completed"];

interface CreateCampaignDraft {
  clientId: string;
  externalId: string;
  name: string;
  type: CampaignRecord["type"] | "";
  status: CampaignRecord["status"] | "";
  databaseSize: number | null;
  startDate: string;
}

interface CampaignDraft {
  name: string;
  status: CampaignRecord["status"];
  databaseSize: number;
  positiveResponses: number;
}

type SortDirection = "asc" | "desc";

function getCampaignStatusColor(status: CampaignRecord["status"]): string {
  switch (status) {
    case "active": return "#22c55e";
    case "draft": return "#737373";
    case "launching": return "#38bdf8";
    case "stopped": return "#ef4444";
    case "completed": return "#14b8a6";
    default: return "#737373";
  }
}

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

function toCampaignDraft(campaign: CampaignRecord): CampaignDraft {
  return {
    name: campaign.name,
    status: campaign.status,
    databaseSize: campaign.database_size ?? 0,
    positiveResponses: campaign.positive_responses,
  };
}

function buildCampaignPatch(campaign: CampaignRecord, draft: CampaignDraft): Partial<CampaignRecord> {
  const patch: Partial<CampaignRecord> = {};

  if (campaign.name !== draft.name) {
    patch.name = draft.name;
  }
  if (campaign.status !== draft.status) {
    patch.status = draft.status;
  }
  if ((campaign.database_size ?? 0) !== draft.databaseSize) {
    patch.database_size = draft.databaseSize;
  }
  if (campaign.positive_responses !== draft.positiveResponses) {
    patch.positive_responses = draft.positiveResponses;
  }

  return patch;
}

export function CampaignsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientCampaignsPage />;
  return <InternalCampaignsPage />;
}

function InternalCampaignsPage() {
  const { identity } = useAuth();
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [createCampaignDraft, setCreateCampaignDraft] = useState<CreateCampaignDraft | null>(null);
  const [isSubmittingCreateCampaign, setIsSubmittingCreateCampaign] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [query, setQuery] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL_FILTER_VALUE);
  const [clientFilterId, setClientFilterId] = useState<string>(ALL_FILTER_VALUE);
  const [timeframe, setTimeframe] = useState(() => createDefaultTimeframe());
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [drawerTimeframe, setDrawerTimeframe] = useState<TimeframeValue>(() => createDefaultTimeframe());
  const [campaignSort, setCampaignSort] = useState<{ key: CampaignSortKey; direction: SortDirection }>({
    key: "start",
    direction: "desc",
  });

  // 400ms debounce for search
  useEffect(() => {
    const timer = setTimeout(() => setCommittedSearch(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const listParams = useMemo<CampaignsListParams>(() => ({
    clientId: clientFilterId === ALL_FILTER_VALUE ? undefined : clientFilterId,
    status: statusFilter === ALL_FILTER_VALUE ? undefined : statusFilter,
    search: committedSearch || undefined,
    sortField: campaignSort.key,
    sortDir: campaignSort.direction,
    page: 1,
    pageSize: 1000,
  }), [clientFilterId, statusFilter, committedSearch, campaignSort.key, campaignSort.direction]);

  const { data, loading, error, refresh } = useCampaignsList(listParams);
  // clientsLite comes from ShellDataProvider (already loaded on app boot) — no extra request needed.
  const { clientsLite: shellClientsLite } = useShellData();

  const rows: CampaignListRow[] = data?.rows ?? [];
  const clientsLite = shellClientsLite;

  const { data: statsData } = useCampaignStats(selectedCampaignId);

  const selectedCampaign = useMemo(
    () => rows.find((item) => item.id === selectedCampaignId) ?? null,
    [rows, selectedCampaignId],
  );

  const campaignColumns = useResizableColumns({
    storageKey: "table:campaigns:columns",
    defaultWidths: [420, 210, 190, 200, 180],
    minWidths: [260, 150, 140, 140, 140],
  });
  const campaignTableStyle = useMemo(
    () =>
      ({
        "--campaign-table-columns": campaignColumns.template,
      }) as CSSProperties,
    [campaignColumns.template],
  );

  const visibleCampaigns = useMemo(() => rows.slice(0, visibleRowsCount), [rows, visibleRowsCount]);
  const hasMoreCampaigns = visibleRowsCount < rows.length;

  const drawerStats = useMemo(
    () => filterByTimeframe(statsData?.rows ?? [], (item) => item.report_date, drawerTimeframe),
    [statsData?.rows, drawerTimeframe],
  );

  const selectedCampaignStats = useMemo(
    () =>
      drawerStats
        .filter((item) => item.campaign_id === selectedCampaign?.id)
        .sort((a, b) => a.report_date.localeCompare(b.report_date))
        .map((item) => ({
          label: formatDate(item.report_date, { day: "2-digit", month: "short" }),
          sent: item.sent_count ?? 0,
          replies: item.reply_count ?? 0,
          bounces: item.bounce_count ?? 0,
        })),
    [drawerStats, selectedCampaign?.id],
  );

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedCampaignId && !rows.some((item) => item.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [rows, selectedCampaignId]);

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
  }, [clientFilterId, query, statusFilter, timeframe]);

  useEffect(() => {
    if (!selectedCampaign) {
      setDraft(null);
      return;
    }

    setDraft(toCampaignDraft(selectedCampaign));
    setDrawerTimeframe(createDefaultTimeframe());
  }, [selectedCampaign]);

  useEffect(() => {
    if (!selectedCampaign) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedCampaignId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCampaign]);

  const draftPatch = useMemo(() => {
    if (!selectedCampaign || !draft) return {};
    return buildCampaignPatch(selectedCampaign, draft);
  }, [draft, selectedCampaign]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  const timeframeLabel = getTimeframeLabel(timeframe);

  function openCreateCampaign() {
    setCreateCampaignDraft({
      clientId: clientsLite[0]?.id ?? "",
      externalId: "",
      name: "",
      type: "",
      status: "draft",
      databaseSize: null,
      startDate: "",
    });
    setIsCreatingCampaign(true);
  }

  async function handleCreateCampaign() {
    if (!createCampaignDraft || !createCampaignDraft.clientId || !createCampaignDraft.externalId.trim() || !createCampaignDraft.name.trim() || !createCampaignDraft.type || !createCampaignDraft.status) return;
    setIsSubmittingCreateCampaign(true);
    try {
      await repository.createCampaign({
        client_id: createCampaignDraft.clientId,
        external_id: createCampaignDraft.externalId.trim(),
        name: createCampaignDraft.name.trim(),
        type: createCampaignDraft.type as CampaignRecord["type"],
        status: createCampaignDraft.status as CampaignRecord["status"],
        database_size: createCampaignDraft.databaseSize,
        start_date: createCampaignDraft.startDate || null,
        positive_responses: 0,
        gender_target: null,
      });
      refresh();
      setIsCreatingCampaign(false);
      setCreateCampaignDraft(null);
    } catch {
      // error shown via toast from repository
    } finally {
      setIsSubmittingCreateCampaign(false);
    }
  }

  async function saveDraft() {
    if (!selectedCampaign || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await repository.updateCampaign(selectedCampaign.id, draftPatch);
      refresh();
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedCampaign) return;
    setDraft(toCampaignDraft(selectedCampaign));
  }

  if (loading && !data) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Campaigns"
          subtitle="Shared campaign workspace with client-safe visibility and internal edit controls."
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
        title="Campaigns"
        subtitle="Shared campaign workspace with table overview and drawer-based campaign details."
        actions={
          <div className="flex items-center gap-3">
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
            <button
              onClick={openCreateCampaign}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20"
            >
              New campaign
            </button>
          </div>
        }
      />

      {rows.length === 0 && !loading ? (
        <EmptyState title="No campaigns in scope" description="Role-based campaign scoping is active. Client users only see outreach campaigns." />
      ) : (
        <Surface title="Campaign filters" subtitle={`Timeframe: ${timeframeLabel}`}>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search campaign name or external id"
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-400 focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15 xl:col-span-2"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                aria-label="Filter campaigns by status"
                className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
              >
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  All statuses
                </SelectItem>
                {["draft", "launching", "active", "stopped", "completed"].map((status) => (
                  <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clientsLite.length > 1 ? (
              <Select value={clientFilterId} onValueChange={setClientFilterId}>
                <SelectTrigger
                  aria-label="Filter campaigns by client"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white"
                >
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL_FILTER_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All clients
                  </SelectItem>
                  {clientsLite.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-2xl border border-border bg-black/10 px-4 py-3 text-sm text-muted-foreground">
                Client scope: {clientsLite[0]?.name ?? "n/a"}
              </div>
            )}
          </div>
        </Surface>
      )}

      {rows.length > 0 && visibleCampaigns.length === 0 ? (
        <EmptyState
          title="No campaigns match the current filters"
          description="Try broadening status/client/search filters to reveal campaigns."
        />
      ) : null}

      {rows.length > 0 ? (
        <Surface title="Campaign portfolio" subtitle={`${visibleCampaigns.length} of ${rows.length} campaigns visible`}>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto" style={campaignTableStyle}>
              <div className="hidden min-w-[1200px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:[grid-template-columns:var(--campaign-table-columns)]">
                {[
                  { key: "name" as const, label: "Campaign" },
                  { key: "type" as const, label: "Type" },
                  { key: "status" as const, label: "Status" },
                  { key: "positive" as const, label: "Positive" },
                  { key: "start" as const, label: "Start" },
                ].map((column, index, collection) => (
                  <div key={column.key} className="relative min-w-0">
                    <button
                      onClick={() =>
                        setCampaignSort((current) =>
                          current.key === column.key
                            ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                            : { key: column.key, direction: column.key === "start" ? "desc" : "asc" },
                        )
                      }
                      className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                    >
                      {column.label} ({sortIndicator(campaignSort.key === column.key, campaignSort.direction)})
                    </button>
                    {index < collection.length - 1 && (
                      <div onMouseDown={campaignColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                    )}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border md:min-w-[1200px]">
                {visibleCampaigns.map((campaign) => {
                  const isActive = selectedCampaign?.id === campaign.id;
                  return (
                    <button
                      key={campaign.id}
                      onClick={() => setSelectedCampaignId(campaign.id)}
                      aria-label={`Open details for ${campaign.name}`}
                      className={`grid w-full gap-3 px-4 py-4 text-left transition md:min-w-[1200px] md:[grid-template-columns:var(--campaign-table-columns)] ${
                        isActive ? "bg-sky-500/10" : "hover:bg-white/5"
                      }`}
                    >
                      <div>
                        <p className="text-sm">{campaign.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{campaign.external_id}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">{campaign.type}</p>
                      <div>
                        {(() => {
                          const color = getCampaignStatusColor(campaign.status);
                          return (
                            <span
                              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                              style={{ borderColor: `${color}55`, backgroundColor: `${color}18`, color }}
                            >
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                              {campaign.status}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-sm text-muted-foreground">{formatNumber(campaign.positive_responses)}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(campaign.start_date)}</p>
                  </button>
                );
              })}
              </div>
            </div>
          </div>

          {hasMoreCampaigns && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisibleRowsCount((current) => current + PAGE_SIZE)}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
              >
                Load more campaigns
              </button>
            </div>
          )}
        </Surface>
      ) : null}

      <Sheet open={isCreatingCampaign} onOpenChange={setIsCreatingCampaign}>
        <SheetContent className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle className="text-white">New campaign</SheetTitle>
            <SheetDescription>Fill in the required fields to create a new campaign.</SheetDescription>
          </SheetHeader>
          {createCampaignDraft && (
            <div className="space-y-4 px-6 pb-6">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client *</span>
                <Select value={createCampaignDraft.clientId} onValueChange={(v) => setCreateCampaignDraft((d) => d ? { ...d, clientId: v } : d)}>
                  <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    {clientsLite.map((client) => (
                      <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">External ID (Smartlead/Bison) *</span>
                <input
                  value={createCampaignDraft.externalId}
                  onChange={(e) => setCreateCampaignDraft((d) => d ? { ...d, externalId: e.target.value } : d)}
                  placeholder="e.g. 12345"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name *</span>
                <input
                  value={createCampaignDraft.name}
                  onChange={(e) => setCreateCampaignDraft((d) => d ? { ...d, name: e.target.value } : d)}
                  placeholder="Campaign name"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Type *</span>
                <Select value={createCampaignDraft.type} onValueChange={(v) => setCreateCampaignDraft((d) => d ? { ...d, type: v as CampaignRecord["type"] } : d)}>
                  <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    {CAMPAIGN_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-white focus:bg-[#1a1a1a] focus:text-white">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status *</span>
                <Select value={createCampaignDraft.status} onValueChange={(v) => setCreateCampaignDraft((d) => d ? { ...d, status: v as CampaignRecord["status"] } : d)}>
                  <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    {CAMPAIGN_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database size</span>
                <input
                  type="number"
                  min={0}
                  value={createCampaignDraft.databaseSize ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setCreateCampaignDraft((d) => d ? { ...d, databaseSize: Number.isFinite(v) && e.target.value !== "" ? Math.max(0, v) : null } : d);
                  }}
                  placeholder="Optional"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Start date</span>
                <input
                  type="date"
                  value={createCampaignDraft.startDate}
                  onChange={(e) => setCreateCampaignDraft((d) => d ? { ...d, startDate: e.target.value } : d)}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/40"
                />
              </label>

              <button
                onClick={() => { void handleCreateCampaign(); }}
                disabled={
                  isSubmittingCreateCampaign ||
                  !createCampaignDraft.clientId ||
                  !createCampaignDraft.externalId.trim() ||
                  !createCampaignDraft.name.trim() ||
                  !createCampaignDraft.type ||
                  !createCampaignDraft.status
                }
                className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingCreateCampaign ? "Creating..." : "Create campaign"}
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {selectedCampaign && draft && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => setSelectedCampaignId(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedCampaign.name} details`}
            className="flex h-full w-full max-w-[860px] flex-col border-l border-border bg-[#050505] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-6">
              <div>
                <h2 className="text-xl">{selectedCampaign.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Campaign operations drawer with editable settings and performance context.
                </p>
              </div>
              <button
                onClick={() => setSelectedCampaignId(null)}
                className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                aria-label="Close campaign details"
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

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name</span>
                  <input
                    value={draft.name}
                    disabled={identity?.role === "client"}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                  <Select
                    value={draft.status}
                    disabled={identity?.role === "client"}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              status: value as CampaignRecord["status"],
                            }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                      {(["draft", "launching", "active", "stopped", "completed"] as CampaignRecord["status"][]).map((status) => {
                        const color = getCampaignStatusColor(status);
                        return (
                          <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                              {status}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database size</span>
                  <input
                    type="number"
                    value={draft.databaseSize}
                    disabled={identity?.role === "client"}
                    onChange={(event) =>
                      setDraft((current) => {
                        if (!current) return current;
                        const value = Number(event.target.value);
                        return {
                          ...current,
                          databaseSize: Number.isFinite(value) ? Math.max(0, value) : 0,
                        };
                      })
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Positive responses</span>
                  <input
                    type="number"
                    value={draft.positiveResponses}
                    disabled={identity?.role === "client"}
                    onChange={(event) =>
                      setDraft((current) => {
                        if (!current) return current;
                        const value = Number(event.target.value);
                        return {
                          ...current,
                          positiveResponses: Number.isFinite(value) ? Math.max(0, value) : 0,
                        };
                      })
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Type</p>
                  <p className="mt-2 text-sm">{selectedCampaign.type}</p>
                </div>
                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Start date</p>
                  <p className="mt-2 text-sm">{formatDate(selectedCampaign.start_date)}</p>
                </div>
                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">External id</p>
                  <p className="mt-2 break-all text-sm">{selectedCampaign.external_id}</p>
                </div>
                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Gender target</p>
                  <p className="mt-2 text-sm">{selectedCampaign.gender_target ?? "—"}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Daily activity</p>
                <DateRangeButton value={drawerTimeframe} onChange={setDrawerTimeframe} />
              </div>

              {selectedCampaignStats.length === 0 ? (
                <EmptyState title="No daily metrics yet" description="Adjust the date range or wait for campaign activity data to appear." />
              ) : (
                <div className="h-72 rounded-2xl border border-border bg-black/10 p-3">
                  <ChartTextSummary
                    summary={`Campaign daily chart with ${selectedCampaignStats.length} points for sent, replies, and bounces.`}
                  />
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedCampaignStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={false}
                        contentStyle={{
                          backgroundColor: "rgba(2,6,23,0.98)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          borderRadius: "16px",
                          color: "#fff",
                        }}
                        labelStyle={{ color: "rgba(226,232,240,0.92)" }}
                        itemStyle={{ color: "#f8fafc" }}
                      />
                      <Bar dataKey="sent" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="replies" fill="#22c55e" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="bounces" fill="#f97316" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
