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
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaignStats, scopeCampaigns } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { CampaignRecord } from "../types/core";
import { ClientCampaignsPage } from "./client-campaigns-page";

const PAGE_SIZE = 50;

interface CampaignDraft {
  name: string;
  status: CampaignRecord["status"];
  databaseSize: number;
  positiveResponses: number;
}

type SortDirection = "asc" | "desc";
type CampaignSortKey = "name" | "type" | "status" | "positive" | "start";

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
  const { clients, campaigns, campaignDailyStats, updateCampaign, loading, error, refresh } = useCoreData();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [campaignSort, setCampaignSort] = useState<{ key: CampaignSortKey; direction: SortDirection }>({
    key: "start",
    direction: "desc",
  });
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

  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );
  const selectedCampaign = useMemo(
    () => scopedCampaigns.find((item) => item.id === selectedCampaignId) ?? null,
    [scopedCampaigns, selectedCampaignId],
  );

  const sortedCampaigns = useMemo(() => {
    return scopedCampaigns.slice().sort((left, right) => {
      if (campaignSort.key === "name") {
        return compareText(left.name, right.name, campaignSort.direction);
      }
      if (campaignSort.key === "type") {
        return compareText(left.type, right.type, campaignSort.direction);
      }
      if (campaignSort.key === "status") {
        return compareText(left.status, right.status, campaignSort.direction);
      }
      if (campaignSort.key === "positive") {
        return compareNumber(left.positive_responses, right.positive_responses, campaignSort.direction);
      }
      return compareText(left.start_date, right.start_date, campaignSort.direction);
    });
  }, [campaignSort.direction, campaignSort.key, scopedCampaigns]);

  const visibleCampaigns = useMemo(() => sortedCampaigns.slice(0, visibleRowsCount), [sortedCampaigns, visibleRowsCount]);
  const hasMoreCampaigns = visibleRowsCount < sortedCampaigns.length;

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedCampaignId && !scopedCampaigns.some((item) => item.id === selectedCampaignId)) {
      setSelectedCampaignId(null);
    }
  }, [scopedCampaigns, selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaign) {
      setDraft(null);
      return;
    }

    setDraft(toCampaignDraft(selectedCampaign));
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

  const selectedCampaignStats = scopedStats
    .filter((item) => item.campaign_id === selectedCampaign?.id)
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map((item) => ({
      label: formatDate(item.report_date, { day: "2-digit", month: "short" }),
      sent: item.sent_count ?? 0,
      replies: item.reply_count ?? 0,
      bounces: item.bounce_count ?? 0,
    }));

  async function patchCampaign(campaign: CampaignRecord, patch: Partial<CampaignRecord>) {
    await updateCampaign(campaign.id, patch);
  }

  async function saveDraft() {
    if (!selectedCampaign || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await patchCampaign(selectedCampaign, draftPatch);
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedCampaign) return;
    setDraft(toCampaignDraft(selectedCampaign));
  }

  if (loading) {
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
      />

      {scopedCampaigns.length === 0 ? (
        <EmptyState title="No campaigns in scope" description="Role-based campaign scoping is active. Client users only see outreach campaigns." />
      ) : (
        <Surface title="Campaign table" subtitle={`${visibleCampaigns.length} of ${sortedCampaigns.length} campaigns visible`}>
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
              <div className="divide-y divide-border">
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
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">{campaign.status}</span>
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
      )}

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
                      {["draft", "launching", "active", "stopped", "completed"].map((status) => (
                        <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          {status}
                        </SelectItem>
                      ))}
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

              {selectedCampaignStats.length === 0 ? (
                <EmptyState title="No daily metrics yet" description="This chart will appear when campaign activity data becomes available." />
              ) : (
                <div className="h-72 rounded-2xl border border-border bg-black/10 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedCampaignStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(2,6,23,0.98)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          borderRadius: "16px",
                          color: "#fff",
                        }}
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

