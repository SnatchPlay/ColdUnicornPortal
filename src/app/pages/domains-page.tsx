import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatMoney } from "../lib/format";
import { scopeClients, scopeDomains } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { DomainRecord, DomainStatus } from "../types/core";

const DOMAIN_STATUSES: DomainStatus[] = ["active", "warmup", "blocked", "retired"];

interface DomainDraft {
  status: DomainStatus | "";
  reputation: string;
  exchangeCost: number | null;
  campaignVerifiedAt: string;
  warmupVerifiedAt: string;
}

function toDomainDraft(domain: DomainRecord): DomainDraft {
  return {
    status: domain.status ?? "",
    reputation: domain.reputation ?? "",
    exchangeCost: domain.exchange_cost,
    campaignVerifiedAt: domain.campaign_verified_at ?? "",
    warmupVerifiedAt: domain.warmup_verified_at ?? "",
  };
}

function buildDomainPatch(domain: DomainRecord, draft: DomainDraft): Partial<DomainRecord> {
  const patch: Partial<DomainRecord> = {};
  const nextStatus = draft.status || null;
  const nextReputation = draft.reputation.trim() || null;
  const nextCampaignDate = draft.campaignVerifiedAt.trim() || null;
  const nextWarmupDate = draft.warmupVerifiedAt.trim() || null;

  if ((domain.status ?? null) !== nextStatus) {
    patch.status = nextStatus;
  }
  if ((domain.reputation ?? null) !== nextReputation) {
    patch.reputation = nextReputation;
  }
  if (domain.exchange_cost !== draft.exchangeCost) {
    patch.exchange_cost = draft.exchangeCost;
  }
  if ((domain.campaign_verified_at ?? null) !== nextCampaignDate) {
    patch.campaign_verified_at = nextCampaignDate;
  }
  if ((domain.warmup_verified_at ?? null) !== nextWarmupDate) {
    patch.warmup_verified_at = nextWarmupDate;
  }

  return patch;
}

export function DomainsPage() {
  const { identity } = useAuth();
  const { clients, domains, updateDomain, loading, error, refresh } = useCoreData();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DomainDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedDomains = useMemo(() => (identity ? scopeDomains(identity, clients, domains) : []), [clients, domains, identity]);

  const filteredDomains = useMemo(() => {
    return scopedDomains.filter((item) => {
      const search = query.trim().toLowerCase();
      const matchesQuery =
        search.length === 0 ||
        item.domain_name.toLowerCase().includes(search) ||
        item.setup_email.toLowerCase().includes(search);
      const matchesStatus = statusFilter === "all" || (item.status ?? "") === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, scopedDomains, statusFilter]);

  const selectedDomain =
    filteredDomains.find((item) => item.id === selectedDomainId) ?? filteredDomains[0] ?? null;

  const selectedClientName = useMemo(() => {
    if (!selectedDomain) return "Unknown client";
    return scopedClients.find((item) => item.id === selectedDomain.client_id)?.name ?? "Unknown client";
  }, [scopedClients, selectedDomain]);

  useEffect(() => {
    if (!selectedDomain) {
      setDraft(null);
      return;
    }
    setDraft(toDomainDraft(selectedDomain));
  }, [selectedDomain?.id]);

  const draftPatch = useMemo(() => {
    if (!selectedDomain || !draft) return {};
    return buildDomainPatch(selectedDomain, draft);
  }, [draft, selectedDomain]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  async function saveDraft() {
    if (!selectedDomain || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await updateDomain(selectedDomain.id, draftPatch);
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedDomain) return;
    setDraft(toDomainDraft(selectedDomain));
  }

  if (!identity || identity.role === "client") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Domains"
          subtitle="Domain operations are available for manager and admin roles only."
        />
        <Banner tone="warning">This module is not available in client shell.</Banner>
      </div>
    );
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Domains"
          subtitle="Domain inventory and verification status across scoped clients."
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
        title="Domains"
        subtitle="Domain inventory with warmup and campaign verification controls for scoped clients."
      />

      {filteredDomains.length === 0 ? (
        <EmptyState
          title="No domains in current scope"
          description="When domains are synced, they will appear here with health and verification details."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface title="Domain list" subtitle={`${filteredDomains.length} domains in current scope`}>
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search domain or setup email"
                className="min-w-[16rem] flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter domains by status"
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              >
                <option value="all">All statuses</option>
                {DOMAIN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
                <option value="">unset</option>
              </select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="hidden grid-cols-[1.4fr_1.1fr_0.9fr_0.8fr] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid">
                <span>Domain</span>
                <span>Client</span>
                <span>Status</span>
                <span>Reputation</span>
              </div>
              <div className="divide-y divide-border">
                {filteredDomains.map((domain) => {
                  const active = selectedDomain?.id === domain.id;
                  const clientName = scopedClients.find((item) => item.id === domain.client_id)?.name ?? "Unknown client";
                  return (
                    <button
                      key={domain.id}
                      onClick={() => setSelectedDomainId(domain.id)}
                      className={`grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition md:grid-cols-[1.4fr_1.1fr_0.9fr_0.8fr] md:items-center md:gap-3 ${
                        active ? "bg-white/5" : "hover:bg-white/3"
                      }`}
                    >
                      <span className="truncate text-sm text-white">{domain.domain_name}</span>
                      <span className="truncate text-sm text-neutral-300">{clientName}</span>
                      <span className="text-xs uppercase tracking-[0.14em] text-neutral-400">{domain.status ?? "unset"}</span>
                      <span className="truncate text-sm text-neutral-300">{domain.reputation ?? "—"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Surface>

          <Surface title="Domain detail" subtitle="Edit verification and reputation metadata.">
            {!selectedDomain || !draft ? (
              <EmptyState
                title="Select a domain"
                description="Select a row from the list to inspect and update domain metadata."
              />
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
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</p>
                    <p className="mt-2 text-sm">{selectedClientName}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup email</p>
                    <p className="mt-2 text-sm">{selectedDomain.setup_email}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Purchase date</p>
                    <p className="mt-2 text-sm">{formatDate(selectedDomain.purchase_date)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Exchange date</p>
                    <p className="mt-2 text-sm">{formatDate(selectedDomain.exchange_date)}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                status: event.target.value as DomainStatus | "",
                              }
                            : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    >
                      <option value="">unset</option>
                      {DOMAIN_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reputation</span>
                    <input
                      value={draft.reputation}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, reputation: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Exchange cost</span>
                    <input
                      type="number"
                      value={draft.exchangeCost ?? 0}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const next = Number(event.target.value);
                          return {
                            ...current,
                            exchangeCost: Number.isFinite(next) ? Math.max(0, next) : null,
                          };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                    <p className="text-xs text-muted-foreground">Current: {formatMoney(selectedDomain.exchange_cost)}</p>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Campaign verified at</span>
                    <input
                      type="date"
                      value={draft.campaignVerifiedAt}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, campaignVerifiedAt: event.target.value } : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Warmup verified at</span>
                    <input
                      type="date"
                      value={draft.warmupVerifiedAt}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, warmupVerifiedAt: event.target.value } : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                </div>
              </div>
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
