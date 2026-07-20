import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { LightweightSheet } from "../components/ui/lightweight-sheet";
import { logAfterRaf2, markInteractionStart, measureAfterRaf2 } from "../lib/perf-mark";
import { formatDate, formatNumber } from "../lib/format";
import { DomainsSectionTabs } from "../components/domains-tabs";
import { scopeClients, scopeDomains, scopeEmailAccounts, sortClientsAlpha } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useDomainsPage } from "../lib/use-domains";
import { repository } from "../data/repository";
import { useAuth } from "../providers/auth";
import type { ClientRecord, DomainRecord, DomainStatus, EmailAccountRecord } from "../types/core";

const DOMAIN_STATUSES: DomainStatus[] = ["active", "warmup", "blocked", "retired"];
const DOMAIN_UNSET_VALUE = "__unset_domain_status__";

interface CreateDomainDraft {
  clientId: string;
  domainName: string;
  setupEmail: string;
  purchaseDate: string;
  status: DomainStatus | "";
}

type SortDirection = "asc" | "desc";
type DomainSortKey = "domain" | "client" | "status";

// Single status shown in the list: the local lifecycle status when set, otherwise the Winnr
// provider status. Winnr-synced domains have no local status, so this surfaces "complete" etc.
function domainStatusLabel(domain: DomainRecord): string {
  return domain.status ?? domain.winnr_status ?? "unset";
}

interface DomainDraft {
  status: DomainStatus | "";
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

function toDomainDraft(domain: DomainRecord): DomainDraft {
  return {
    status: domain.status ?? "",
  };
}

function buildDomainPatch(domain: DomainRecord, draft: DomainDraft): Partial<DomainRecord> {
  const patch: Partial<DomainRecord> = {};
  const nextStatus = draft.status || null;

  if ((domain.status ?? null) !== nextStatus) {
    patch.status = nextStatus;
  }

  return patch;
}

// Stable empty-array fallbacks — prevents new-reference cascades during loading.
const EMPTY_CLIENTS: ClientRecord[] = [];
const EMPTY_DOMAINS: DomainRecord[] = [];
const EMPTY_ACCOUNTS: EmailAccountRecord[] = [];

// ── CreateDomainSheetHost ──────────────────────────────────────────────────────────────────────
// Owns the "is sheet open" boolean so that opening/closing New Domain does NOT re-render
// DomainsPage or the domain list. Receives only stable props.

interface CreateDomainSheetHostProps {
  scopedClients: Array<{ id: string; name: string }>;
  onCreateDomain: (draft: CreateDomainDraft) => Promise<void>;
}

const CreateDomainSheetHost = memo(function CreateDomainSheetHost({
  scopedClients,
  onCreateDomain,
}: CreateDomainSheetHostProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDomainDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shell timing: measure from click mark to 2 rAFs after open state commits.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      measureAfterRaf2("new-domain:click", "[perf][sheet] new-domain shell click→raf2");
      logAfterRaf2("[perf][sheet] lightweight-new-domain open state→raf2");
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
    markInteractionStart("new-domain:click");
    setDraft({
      clientId: scopedClients[0]?.id ?? "",
      domainName: "",
      setupEmail: "",
      purchaseDate: "",
      status: "",
    });
    setIsOpen(true);
  }

  async function handleSubmit() {
    if (
      !draft ||
      !draft.clientId ||
      !draft.domainName.trim() ||
      !draft.setupEmail.trim() ||
      !draft.purchaseDate
    ) return;
    setIsSubmitting(true);
    try {
      await onCreateDomain(draft);
      handleOpenChange(false);
    } catch {
      // mutations throw RepositoryError on failure; error propagated to onCreateDomain caller
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
        New domain
      </button>
      <LightweightSheet
        open={isOpen}
        onOpenChange={handleOpenChange}
        title={<span className="text-white">New domain</span>}
        description="Fill in the required fields to register a new domain."
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
                  {scopedClients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Domain name *</span>
              <input
                value={draft.domainName}
                onChange={(e) => setDraft((d) => d ? { ...d, domainName: e.target.value } : d)}
                placeholder="e.g. example.com"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup email *</span>
              <input
                type="email"
                value={draft.setupEmail}
                onChange={(e) => setDraft((d) => d ? { ...d, setupEmail: e.target.value } : d)}
                placeholder="e.g. info@example.com"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Purchase date *</span>
              <input
                type="date"
                value={draft.purchaseDate}
                onChange={(e) => setDraft((d) => d ? { ...d, purchaseDate: e.target.value } : d)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-sky-400/40"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
              <Select
                value={draft.status || DOMAIN_UNSET_VALUE}
                onValueChange={(v) => setDraft((d) => d ? { ...d, status: v === DOMAIN_UNSET_VALUE ? "" : (v as DomainStatus) } : d)}
              >
                <SelectTrigger className="h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <SelectValue placeholder="Select status (optional)" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={DOMAIN_UNSET_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">unset</SelectItem>
                  {DOMAIN_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <button
              onClick={() => { void handleSubmit(); }}
              disabled={
                isSubmitting ||
                !draft.clientId ||
                !draft.domainName.trim() ||
                !draft.setupEmail.trim() ||
                !draft.purchaseDate
              }
              className="w-full rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create domain"}
            </button>
          </div>
        )}
      </LightweightSheet>
    </>
  );
});

export function DomainsPage() {
  const { identity } = useAuth();
  const { data, loading, error, refresh } = useDomainsPage();
  const clients = data?.clients ?? EMPTY_CLIENTS;
  const domains = data?.domains ?? EMPTY_DOMAINS;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DomainDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [domainSort, setDomainSort] = useState<{ key: DomainSortKey; direction: SortDirection }>({
    key: "domain",
    direction: "asc",
  });
  const domainColumns = useResizableColumns({
    storageKey: "table:domains:columns:v4",
    defaultWidths: [540, 300, 200],
    minWidths: [260, 180, 140],
  });
  const domainTableStyle = useMemo(
    () =>
      ({
        "--domains-table-columns": domainColumns.template,
      }) as CSSProperties,
    [domainColumns.template],
  );

  const scopedClients = useMemo(
    () => (identity ? sortClientsAlpha(scopeClients(identity, clients)) : []),
    [clients, identity],
  );
  const scopedDomains = useMemo(() => (identity ? scopeDomains(identity, clients, domains) : []), [clients, domains, identity]);
  const emailAccounts = data?.emailAccounts ?? EMPTY_ACCOUNTS;
  const scopedAccounts = useMemo(
    () => (identity ? scopeEmailAccounts(identity, clients, domains, emailAccounts) : []),
    [clients, domains, emailAccounts, identity],
  );

  const filteredDomains = useMemo(() => {
    return scopedDomains.filter((item) => {
      const search = query.trim().toLowerCase();
      const matchesQuery =
        search.length === 0 ||
        item.domain_name.toLowerCase().includes(search) ||
        (item.setup_email ?? "").toLowerCase().includes(search);
      const matchesStatus = statusFilter === "all" || (item.status ?? "") === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, scopedDomains, statusFilter]);

  const sortedDomains = useMemo(() => {
    return filteredDomains.slice().sort((left, right) => {
      if (domainSort.key === "domain") {
        return compareText(left.domain_name, right.domain_name, domainSort.direction);
      }
      if (domainSort.key === "client") {
        const leftClient = scopedClients.find((item) => item.id === left.client_id)?.name ?? "";
        const rightClient = scopedClients.find((item) => item.id === right.client_id)?.name ?? "";
        return compareText(leftClient, rightClient, domainSort.direction);
      }
      return compareText(domainStatusLabel(left), domainStatusLabel(right), domainSort.direction);
    });
  }, [domainSort.direction, domainSort.key, filteredDomains, scopedClients]);

  const selectedDomain =
    sortedDomains.find((item) => item.id === selectedDomainId) ?? sortedDomains[0] ?? null;

  const selectedClientName = useMemo(() => {
    if (!selectedDomain) return "Unknown client";
    if (selectedDomain.client_id === null) return "Unlinked";
    return scopedClients.find((item) => item.id === selectedDomain.client_id)?.name ?? "Unknown client";
  }, [scopedClients, selectedDomain]);

  const domainAccounts = useMemo(
    () => (selectedDomain ? scopedAccounts.filter((item) => item.domain_id === selectedDomain.id) : []),
    [scopedAccounts, selectedDomain],
  );

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

  // Stable callback for CreateDomainSheetHost — only recreates when refresh changes.
  const handleCreateDomainStable = useCallback(
    async (d: CreateDomainDraft) => {
      await repository.createDomain({
        client_id: d.clientId,
        domain_name: d.domainName.trim(),
        setup_email: d.setupEmail.trim(),
        purchase_date: d.purchaseDate,
        status: (d.status as DomainStatus) || null,
      });
      refresh();
    },
    [refresh],
  );

  async function saveDraft() {
    if (!selectedDomain || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await repository.updateDomain(selectedDomain.id, draftPatch);
      refresh();
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
        actions={
          <CreateDomainSheetHost
            scopedClients={scopedClients}
            onCreateDomain={handleCreateDomainStable}
          />
        }
      />

      <DomainsSectionTabs />

      {sortedDomains.length === 0 ? (
        <EmptyState
          title="No domains in current scope"
          description="When domains are synced, they will appear here with health and verification details."
        />
      ) : (
        <>
          <Surface title="Domain list" subtitle={`${sortedDomains.length} domains in current scope`}>
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search domain or setup email"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none sm:min-w-[16rem]"
              />
              <Select
                value={statusFilter === "" ? DOMAIN_UNSET_VALUE : statusFilter}
                onValueChange={(value) => setStatusFilter(value === DOMAIN_UNSET_VALUE ? "" : value)}
              >
                <SelectTrigger
                  aria-label="Filter domains by status"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white"
                >
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All statuses
                  </SelectItem>
                  {DOMAIN_STATUSES.map((status) => (
                    <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {status}
                    </SelectItem>
                  ))}
                  <SelectItem value={DOMAIN_UNSET_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    unset
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="overflow-x-auto" style={domainTableStyle}>
                <div className="hidden min-w-[640px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:[grid-template-columns:var(--domains-table-columns)]">
                  {[
                    { key: "domain" as const, label: "Domain" },
                    { key: "client" as const, label: "Client" },
                    { key: "status" as const, label: "Status" },
                  ].map((column, index, collection) => (
                    <div key={column.key} className="relative min-w-0">
                      <button
                        onClick={() =>
                          setDomainSort((current) =>
                            current.key === column.key
                              ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.key, direction: "asc" },
                          )
                        }
                        className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                      >
                        {column.label} ({sortIndicator(domainSort.key === column.key, domainSort.direction)})
                      </button>
                      {index < collection.length - 1 && (
                        <div onMouseDown={domainColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-border md:min-w-[640px]">
                  {sortedDomains.map((domain) => {
                    const active = selectedDomain?.id === domain.id;
                    const clientName =
                      domain.client_id === null
                        ? "Unlinked"
                        : scopedClients.find((item) => item.id === domain.client_id)?.name ?? "Unknown client";
                    return (
                      <button
                        key={domain.id}
                        onClick={() => {
                          setSelectedDomainId(domain.id);
                          setDetailOpen(true);
                        }}
                        className={`block w-full px-4 py-3 text-left transition ${
                          active ? "bg-white/5" : "hover:bg-white/3"
                        }`}
                      >
                        {/* Mobile card */}
                        <div className="md:hidden">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-white">{domain.domain_name}</span>
                            <span className="shrink-0 text-xs uppercase tracking-[0.14em] text-neutral-400">{domainStatusLabel(domain)}</span>
                          </div>
                          <p className="mt-1 text-xs text-neutral-500">{clientName}</p>
                        </div>
                        {/* Desktop table row */}
                        <div className="hidden min-w-[640px] items-center gap-3 [grid-template-columns:var(--domains-table-columns)] md:grid">
                          <span className="truncate text-sm text-white">{domain.domain_name}</span>
                          <span className="truncate text-sm text-neutral-300">{clientName}</span>
                          <span className="text-xs uppercase tracking-[0.14em] text-neutral-400">{domainStatusLabel(domain)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Surface>

          <LightweightSheet
            open={detailOpen}
            onOpenChange={setDetailOpen}
            title={<span className="text-white">Domain detail</span>}
            description="Edit local status; Winnr data is read-only."
            className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-xl"
          >
            {!selectedDomain || !draft ? (
              <EmptyState
                title="Select a domain"
                description="Select a row from the list to inspect and update domain metadata."
              />
            ) : (
              <div className="space-y-5 px-6 pb-6">
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
                    <p className="mt-2 text-sm">{selectedDomain.setup_email ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Purchase date</p>
                    <p className="mt-2 text-sm">{formatDate(selectedDomain.purchase_date)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Winnr status</p>
                    <p className="mt-2 text-sm">{selectedDomain.winnr_status ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">DNS provider</p>
                    <p className="mt-2 text-sm">{selectedDomain.dns_provider ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Mailboxes (Winnr)</p>
                    <p className="mt-2 text-sm">{selectedDomain.winnr_email_user_count ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Winnr tags</p>
                    <p className="mt-2 text-sm">{selectedDomain.winnr_tags?.length ? selectedDomain.winnr_tags.join(", ") : "—"}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last synced</p>
                    <p className="mt-2 text-sm">{formatDate(selectedDomain.last_synced_at)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Missing since</p>
                    <p className="mt-2 text-sm">{selectedDomain.missing_since ? formatDate(selectedDomain.missing_since) : "—"}</p>
                  </div>
                </div>

                <div className="max-w-sm">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <Select
                      value={draft.status === "" ? DOMAIN_UNSET_VALUE : draft.status}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                status: value === DOMAIN_UNSET_VALUE ? "" : (value as DomainStatus),
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                        <SelectItem value={DOMAIN_UNSET_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          unset
                        </SelectItem>
                        {DOMAIN_STATUSES.map((status) => (
                          <SelectItem
                            key={status}
                            value={status}
                            className="text-white focus:bg-[#1a1a1a] focus:text-white"
                          >
                            {status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email accounts</p>
                    <span className="text-xs text-neutral-500">{domainAccounts.length} mailboxes</span>
                  </div>
                  {domainAccounts.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-500">No mailboxes synced for this domain yet.</p>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded-xl border border-border">
                      <div className="grid grid-cols-[1.6fr_0.8fr_0.6fr_0.6fr] gap-2 border-b border-border bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        <span>Email</span>
                        <span>Warming</span>
                        <span className="text-right">Health</span>
                        <span className="text-right">Inbox</span>
                      </div>
                      <div className="divide-y divide-border">
                        {domainAccounts.map((account) => (
                          <div key={account.id} className="grid grid-cols-[1.6fr_0.8fr_0.6fr_0.6fr] items-center gap-2 px-3 py-2 text-sm">
                            <span className="truncate text-white">{account.email_address}</span>
                            <span className="truncate text-xs uppercase tracking-[0.12em] text-neutral-400">{account.warming_status ?? "unset"}</span>
                            <span className="text-right text-neutral-300">{formatNumber(account.warming_health_score)}</span>
                            <span className="text-right text-neutral-300">{formatNumber(account.warming_inbox_rate)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </LightweightSheet>
        </>
      )}
    </div>
  );
}

