import { useEffect, useMemo, useState } from "react";
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
import { formatDate, formatNumber } from "../lib/format";
import { scopeCampaignStats, scopeCampaigns } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { CampaignRecord } from "../types/core";
import { ClientCampaignsPage } from "./client-campaigns-page";

interface CampaignDraft {
  name: string;
  status: CampaignRecord["status"];
  databaseSize: number;
  positiveResponses: number;
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
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const scopedCampaigns = useMemo(
    () => (identity ? scopeCampaigns(identity, clients, campaigns) : []),
    [campaigns, clients, identity],
  );
  const scopedStats = useMemo(
    () => (identity ? scopeCampaignStats(identity, clients, campaigns, campaignDailyStats) : []),
    [campaignDailyStats, campaigns, clients, identity],
  );

  const selectedCampaign =
    scopedCampaigns.find((item) => item.id === selectedCampaignId) ?? scopedCampaigns[0] ?? null;

  useEffect(() => {
    if (!selectedCampaign) {
      setDraft(null);
      return;
    }

    setDraft(toCampaignDraft(selectedCampaign));
  }, [selectedCampaign?.id]);

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
        subtitle="Shared campaign workspace with client-safe visibility and internal edit controls."
      />

      {scopedCampaigns.length === 0 ? (
        <EmptyState title="No campaigns in scope" description="Role-based campaign scoping is active. Client users only see outreach campaigns." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface
            title="Campaign portfolio"
            subtitle={`${scopedCampaigns.length} campaigns visible`}
            className="flex h-[34rem] max-h-[68vh] min-h-0 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {scopedCampaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  onClick={() => setSelectedCampaignId(campaign.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedCampaign?.id === campaign.id
                      ? "border-sky-400/30 bg-sky-500/10"
                      : "border-border bg-black/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm">{campaign.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {campaign.type} · {campaign.status}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{formatNumber(campaign.positive_responses)}</p>
                      <p className="text-xs text-muted-foreground">positive</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Surface>

          <Surface title="Campaign detail" subtitle="Editable internal fields backed by the live schema.">
            {!selectedCampaign ? (
              <EmptyState title="Select a campaign" description="Campaign details appear once a row is selected." />
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

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name</span>
                    <input
                      value={draft?.name ?? ""}
                      disabled={identity?.role === "client"}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <select
                      value={draft?.status ?? "draft"}
                      disabled={identity?.role === "client"}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                status: event.target.value as CampaignRecord["status"],
                              }
                            : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60"
                    >
                      {["draft", "launching", "active", "stopped", "completed"].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Database size</span>
                    <input
                      type="number"
                      value={draft?.databaseSize ?? 0}
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
                      value={draft?.positiveResponses ?? 0}
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
                  <EmptyState title="No daily metrics yet" description="Once campaign_daily_stats exists for this campaign, the chart appears here." />
                ) : (
                  <div className="h-72">
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
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
