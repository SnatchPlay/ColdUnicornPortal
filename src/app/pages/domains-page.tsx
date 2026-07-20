import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { LightweightSheet } from "../components/ui/lightweight-sheet";
import { logAfterRaf2, markInteractionStart, measureAfterRaf2 } from "../lib/perf-mark";
import { formatDate } from "../lib/format";
import { DomainsSectionTabs } from "../components/domains-tabs";
import { scopeClients, scopeDomains, sortClientsAlpha } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useDomainsPage } from "../lib/use-domains";
import { repository } from "../data/repository";
import { useAuth } from "../providers/auth";
import type { ClientRecord, DomainRecord, DomainStatus } from "../types/core";

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
type DomainSortKey = "domain" | "client" | "mailboxes" | "winnr";

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

// Stable empty-array fallbacks — prevents new-reference cascades during loading.
const EMPTY_CLIENTS: ClientRecord[] = [];
const EMPTY_DOMAINS: DomainRecord[] = [];

// Columns shown in the wide read-only table. Only fields the Winnr sync actually populates —
// client_id / setup_email / purchase_date / local status are empty for synced domains and omitted.
const DOMAIN_COLUMNS: {
  key: string;
  label: string;
  sortKey?: DomainSortKey;
  width: number;
  minWidth: number;
  align?: "right";
  render: (domain: DomainRecord, clientLabel: string) => ReactNode;
}[] = [
  { key: "domain", label: "Domain", sortKey: "domain", width: 280, minWidth: 180, render: (d) => d.domain_name },
  { key: "client", label: "Client", sortKey: "client", width: 130, minWidth: 100, render: (_d, c) => c },
  { key: "mailboxes", label: "Mailboxes", sortKey: "mailboxes", width: 110, minWidth: 90, align: "right", render: (d) => d.winnr_email_user_count ?? "—" },
  { key: "dns", label: "DNS provider", width: 150, minWidth: 110, render: (d) => d.dns_provider ?? "—" },
  { key: "tags", label: "Tags", width: 180, minWidth: 120, render: (d) => (d.winnr_tags?.length ? d.winnr_tags.join(", ") : "—") },
  { key: "winnr", label: "Winnr status", sortKey: "winnr", width: 130, minWidth: 110, render: (d) => d.winnr_status ?? "—" },
  { key: "created", label: "Created", width: 120, minWidth: 100, render: (d) => formatDate(d.winnr_created_at) },
  { key: "synced", label: "Last synced", width: 130, minWidth: 100, render: (d) => formatDate(d.last_synced_at) },
];

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
  const [domainSort, setDomainSort] = useState<{ key: DomainSortKey; direction: SortDirection }>({
    key: "domain",
    direction: "asc",
  });
  const domainColumns = useResizableColumns({
    storageKey: "table:domains:columns:v5",
    defaultWidths: DOMAIN_COLUMNS.map((c) => c.width),
    minWidths: DOMAIN_COLUMNS.map((c) => c.minWidth),
  });
  const domainTableStyle = useMemo(
    () => ({ "--domains-table-columns": domainColumns.template }) as CSSProperties,
    [domainColumns.template],
  );

  const scopedClients = useMemo(
    () => (identity ? sortClientsAlpha(scopeClients(identity, clients)) : []),
    [clients, identity],
  );
  const scopedDomains = useMemo(() => (identity ? scopeDomains(identity, clients, domains) : []), [clients, domains, identity]);
  const clientNameById = useMemo(() => new Map(scopedClients.map((c) => [c.id, c.name])), [scopedClients]);
  const clientLabel = useCallback(
    (d: DomainRecord) => (d.client_id === null ? "Unlinked" : clientNameById.get(d.client_id) ?? "Unknown client"),
    [clientNameById],
  );

  const filteredDomains = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return scopedDomains;
    return scopedDomains.filter(
      (item) =>
        item.domain_name.toLowerCase().includes(search) ||
        (item.dns_provider ?? "").toLowerCase().includes(search) ||
        (item.winnr_tags ?? []).some((tag) => tag.toLowerCase().includes(search)),
    );
  }, [query, scopedDomains]);

  const sortedDomains = useMemo(() => {
    return filteredDomains.slice().sort((left, right) => {
      if (domainSort.key === "client") return compareText(clientLabel(left), clientLabel(right), domainSort.direction);
      if (domainSort.key === "mailboxes") {
        const l = left.winnr_email_user_count ?? -1;
        const r = right.winnr_email_user_count ?? -1;
        return domainSort.direction === "asc" ? l - r : r - l;
      }
      if (domainSort.key === "winnr") return compareText(left.winnr_status, right.winnr_status, domainSort.direction);
      return compareText(left.domain_name, right.domain_name, domainSort.direction);
    });
  }, [clientLabel, domainSort.direction, domainSort.key, filteredDomains]);

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
        <Surface title="Domain list" subtitle={`${sortedDomains.length} domains in current scope`}>
          <div className="mb-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search domain, DNS provider, or tag"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none sm:max-w-md"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto" style={domainTableStyle}>
              <div className="grid gap-3 border-b border-border bg-black/20 px-4 py-3 [grid-template-columns:var(--domains-table-columns)]">
                {DOMAIN_COLUMNS.map((column, index) => (
                  <div key={column.key} className={`relative min-w-0 ${column.align === "right" ? "text-right" : ""}`}>
                    {column.sortKey ? (
                      <button
                        onClick={() =>
                          setDomainSort((current) =>
                            current.key === column.sortKey
                              ? { key: column.sortKey!, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.sortKey!, direction: "asc" },
                          )
                        }
                        className={`text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white ${column.align === "right" ? "w-full text-right" : "w-full pr-3 text-left"}`}
                      >
                        {column.label} ({sortIndicator(domainSort.key === column.sortKey, domainSort.direction)})
                      </button>
                    ) : (
                      <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">{column.label}</span>
                    )}
                    {index < DOMAIN_COLUMNS.length - 1 && (
                      <div onMouseDown={domainColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                    )}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border">
                {sortedDomains.map((domain) => (
                  <div key={domain.id} className="grid items-center gap-3 px-4 py-3 [grid-template-columns:var(--domains-table-columns)]">
                    {DOMAIN_COLUMNS.map((column) => (
                      <span
                        key={column.key}
                        className={`truncate text-sm ${column.key === "domain" ? "text-white" : "text-neutral-300"} ${column.align === "right" ? "text-right" : ""}`}
                      >
                        {column.render(domain, clientLabel(domain))}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Surface>
      )}
    </div>
  );
}

