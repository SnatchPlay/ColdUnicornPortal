import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { useDeferredMount } from "../lib/use-deferred-mount";
import { logAfterRaf2, markInteractionStart, measureAfterRaf2 } from "../lib/perf-mark";
import { DevProfiler, useDevRenderCount } from "../lib/react-profiler-dev";
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
import { LightweightSheet } from "../components/ui/lightweight-sheet";
import { ArchiveButton, ArchivedBadge, ShowArchivedToggle } from "../components/archive-controls";
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

// ── CreateCampaignSheetHost ────────────────────────────────────────────────────────────────────
// Owns the "is sheet open" boolean so that opening/closing New Campaign does NOT re-render
// InternalCampaignsPage or the campaign list. Receives only stable props.

interface CreateCampaignSheetHostProps {
  clientsLite: Array<{ id: string; name: string }>;
  onCreateCampaign: (draft: CreateCampaignDraft) => Promise<void>;
}

const CreateCampaignSheetHost = memo(function CreateCampaignSheetHost({
  clientsLite,
  onCreateCampaign,
}: CreateCampaignSheetHostProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<CreateCampaignDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shell timing: measure from click mark to 2 rAFs after open state commits.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      measureAfterRaf2("new-campaign:click", "[perf][sheet] new-campaign shell click→raf2");
      logAfterRaf2("[perf][sheet] lightweight-new-campaign open state→raf2");
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
    markInteractionStart("new-campaign:click");
    setDraft({
      clientId: clientsLite[0]?.id ?? "",
      externalId: "",
      name: "",
      type: "",
      status: "draft",
      databaseSize: null,
      startDate: "",
    });
    setIsOpen(true);
  }

  async function handleSubmit() {
    if (
      !draft ||
      !draft.clientId ||
      !draft.externalId.trim() ||
      !draft.name.trim() ||
      !draft.type ||
      !draft.status
    ) return;
    setIsSubmitting(true);
    try {
      await onCreateCampaign(draft);
      handleOpenChange(false);
    } catch {
      // error propagated / shown via toast in onCreateCampaign
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
        New campaign
      </button>
      <LightweightSheet
        open={isOpen}
        onOpenChange={handleOpenChange}
        title={<span className="text-white">New campaign</span>}
        description="Fill in the required fields to create a new campaign."
        className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md"
      >
        {draft && (
          <div className="space-y-4 px-6 pb-6">
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client *</span>
              <Select value={draft.clientId} onValueChange={(v) => setDraft((d) => d ? { ...d, clientId: v } : d)}>
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
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">External ID (Bison) *</span>
              <input
                value={draft.externalId}
                onChange={(e) => setDraft((d) => d ? { ...d, externalId: e.target.value } : d)}
                placeholder="e.g. 12345"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name *</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => d ? { ...d, name: e.target.value } : d)}
                placeholder="Campaign name"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Type *</span>
              <Select value={draft.type} onValueChange={(v) => setDraft((d) => d ? { ...d, type: v as CampaignRecord["type"] } : d)}>
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
              <Select value={draft.status} onValueChange={(v) => setDraft((d) => d ? { ...d, status: v as CampaignRecord["status"] } : d)}>
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
                value={draft.databaseSize ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDraft((d) => d ? { ...d, databaseSize: Number.isFinite(v) && e.target.value !== "" ? Math.max(0, v) : null } : d);
                }}
                placeholder="Optional"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Start date</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((d) => d ? { ...d, startDate: e.target.value } : d)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/40"
              />
            </label>

            <button
              onClick={() => { void handleSubmit(); }}
              disabled={
                isSubmitting ||
                !draft.clientId ||
                !draft.externalId.trim() ||
                !draft.name.trim() ||
                !draft.type ||
                !draft.status
              }
              className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create campaign"}
            </button>
          </div>
        )}
      </LightweightSheet>
    </>
  );
});

export function CampaignsPage() {
  const { identity } = useAuth();
  if (identity?.role === "client") return <ClientCampaignsPage />;
  return (
    <DevProfiler id="InternalCampaignsPage">
      <InternalCampaignsPage />
    </DevProfiler>
  );
}

function InternalCampaignsPage() {
  useDevRenderCount("InternalCampaignsPage");
  const { identity } = useAuth();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  // Archived campaigns are hidden by default (migration 20260813).
  const [showArchived, setShowArchived] = useState(false);
  // campaigns_update_scoped = can_manage_client(client_id) — admin tier + the assigned manager.
  const canArchive = identity ? identity.role !== "client" : false;
  const [loadPage, setLoadPage] = useState(1);
  const [accumulatedRows, setAccumulatedRows] = useState<CampaignListRow[]>([]);
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
    page: loadPage,
    pageSize: 200,
    includeArchived: showArchived,
  }), [clientFilterId, statusFilter, committedSearch, campaignSort.key, campaignSort.direction, loadPage, showArchived]);

  const { data, loading, error, refresh } = useCampaignsList(listParams);
  // clientsLite comes from ShellDataProvider (already loaded on app boot) — no extra request needed.
  const { clientsLite: shellClientsLite } = useShellData();

  const rows: CampaignListRow[] = data?.rows ?? [];
  const clientsLite = shellClientsLite;

  const { data: statsData } = useCampaignStats(selectedCampaignId);

  const selectedCampaign = useMemo(
    () => accumulatedRows.find((item) => item.id === selectedCampaignId) ?? null,
    [accumulatedRows, selectedCampaignId],
  );
  // Two-phase drawer: overlay + header paint first, form + chart deferred.
  const campaignBodyReady = useDeferredMount(!!selectedCampaign && !!draft);

  // Shell timing: measure on false→true transition of drawerOpen.
  const campaignDrawerWasOpenRef = useRef(false);
  const campaignDrawerOpen = !!selectedCampaign && !!draft;
  useEffect(() => {
    if (campaignDrawerOpen && !campaignDrawerWasOpenRef.current) {
      measureAfterRaf2("campaign-drawer:click", "[perf][drawer] campaign shell click→raf2");
    }
    campaignDrawerWasOpenRef.current = campaignDrawerOpen;
  }, [campaignDrawerOpen]);

  // Content timing: deferred form + chart visible.
  useEffect(() => {
    if (!campaignBodyReady) return;
    measureAfterRaf2("campaign-drawer:click", "[perf][drawer] campaign content deferred→raf2");
  }, [campaignBodyReady]);

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

  // Accumulate rows across pages; reset on filter/sort change.
  // `showArchived` belongs here with the other filters: it changes what page 1 contains, so without
  // it the toggle would append an archived-inclusive page N onto the existing accumulation.
  const filterKey = JSON.stringify({ clientFilterId, statusFilter, committedSearch, campaignSort, showArchived });
  useEffect(() => {
    if (!data) return;
    if (loadPage === 1) setAccumulatedRows(data.rows);
    else setAccumulatedRows((prev) => [...prev, ...data.rows]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const totalCount = data?.totalCount ?? 0;
  const hasMoreCampaigns = data ? accumulatedRows.length < totalCount : false;

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

  // Reset to page 1 + clear accumulation when filter/sort changes.
  useEffect(() => {
    setLoadPage(1);
    setAccumulatedRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Close drawer if selected campaign is no longer in accumulated rows.
  useEffect(() => {
    if (selectedCampaignId && !accumulatedRows.some((item) => item.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accumulatedRows, selectedCampaignId]);

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

  // Stable callback passed to CreateCampaignSheetHost — only recreates when refresh changes.
  const handleCreateCampaignStable = useCallback(
    async (d: CreateCampaignDraft) => {
      await repository.createCampaign({
        client_id: d.clientId,
        external_id: d.externalId.trim(),
        name: d.name.trim(),
        type: d.type as CampaignRecord["type"],
        status: d.status as CampaignRecord["status"],
        database_size: d.databaseSize,
        start_date: d.startDate || null,
        positive_responses: 0,
        gender_target: null,
      });
      refresh();
    },
    [refresh],
  );

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
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeButton value={timeframe} onChange={setTimeframe} />
            <CreateCampaignSheetHost
              clientsLite={clientsLite}
              onCreateCampaign={handleCreateCampaignStable}
            />
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
          {canArchive ? (
            <div className="mt-3 flex justify-end">
              <ShowArchivedToggle value={showArchived} onChange={setShowArchived} disabled={loading} />
            </div>
          ) : null}
        </Surface>
      )}

      {totalCount > 0 && accumulatedRows.length === 0 && !loading ? (
        <EmptyState
          title="No campaigns match the current filters"
          description="Try broadening status/client/search filters to reveal campaigns."
        />
      ) : null}

      {accumulatedRows.length > 0 ? (
        <Surface title="Campaign portfolio" subtitle={`${accumulatedRows.length} of ${totalCount} campaigns`}>
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
                {accumulatedRows.map((campaign) => {
                  const isActive = selectedCampaign?.id === campaign.id;
                  const statusColor = getCampaignStatusColor(campaign.status);
                  const statusBadge = (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                      style={{ borderColor: `${statusColor}55`, backgroundColor: `${statusColor}18`, color: statusColor }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                      {campaign.status}
                    </span>
                  );
                  return (
                    <button
                      key={campaign.id}
                      onClick={() => { markInteractionStart("campaign-drawer:click"); setSelectedCampaignId(campaign.id); }}
                      aria-label={`Open details for ${campaign.name}`}
                      className={`block w-full px-4 py-4 text-left transition ${
                        isActive ? "bg-sky-500/10" : "hover:bg-white/5"
                      }`}
                    >
                      {/* Mobile card */}
                      <div className="md:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{campaign.name}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.external_id}</p>
                          </div>
                          {statusBadge}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{campaign.type}</span>
                          <span>·</span>
                          <span>{formatNumber(campaign.positive_responses)} positive</span>
                          <span>·</span>
                          <span>{formatDate(campaign.start_date)}</span>
                        </div>
                      </div>
                      {/* Desktop table row */}
                      <div className="hidden min-w-[1200px] items-center gap-3 [grid-template-columns:var(--campaign-table-columns)] md:grid">
                        <div>
                          <p className="text-sm">
                            {campaign.name}
                            <ArchivedBadge archivedAt={campaign.archived_at} />
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{campaign.external_id}</p>
                        </div>
                        <p className="text-sm text-muted-foreground">{campaign.type}</p>
                        <div>{statusBadge}</div>
                        <p className="text-sm text-muted-foreground">{formatNumber(campaign.positive_responses)}</p>
                        <p className="text-sm text-muted-foreground">{formatDate(campaign.start_date)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {hasMoreCampaigns && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setLoadPage((p) => p + 1)}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
              >
                Load more campaigns
              </button>
            </div>
          )}
        </Surface>
      ) : null}

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
                {canArchive ? (
                  <div className="ml-auto">
                    <ArchiveButton
                      entity="campaign"
                      id={selectedCampaign.id}
                      name={selectedCampaign.name}
                      archivedAt={selectedCampaign.archived_at}
                      onDone={() => { setSelectedCampaignId(null); refresh(); }}
                      disabled={isSavingDraft}
                    />
                  </div>
                ) : null}
              </div>

              {/* Phase 2: deferred form + chart */}
              {campaignBodyReady ? (<>
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
              </>) : (
                <div className="mt-2 space-y-4" aria-hidden="true">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
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
