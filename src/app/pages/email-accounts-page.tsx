import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { DomainsSectionTabs } from "../components/domains-tabs";
import { ArchiveButton, ArchivedBadge, ShowArchivedToggle } from "../components/archive-controls";
import { formatDate } from "../lib/format";
import { scopeDomains, scopeEmailAccounts } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useEmailAccountsPage } from "../lib/use-email-accounts";
import { useAuth } from "../providers/auth";
import type { ClientRecord, DomainRecord, EmailAccountRecord } from "../types/core";

type SortDirection = "asc" | "desc";
type AccountSortKey = "email" | "username" | "display" | "status" | "domain";

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const result = (left ?? "").toLowerCase().localeCompare((right ?? "").toLowerCase());
  return direction === "asc" ? result : -result;
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "sort";
  return direction === "asc" ? "asc" : "desc";
}

// Stable empty-array fallbacks — prevents new-reference cascades during loading.
const EMPTY_CLIENTS: ClientRecord[] = [];
const EMPTY_DOMAINS: DomainRecord[] = [];
const EMPTY_ACCOUNTS: EmailAccountRecord[] = [];

// Columns shown in the wide read-only table. Only fields the Winnr sync actually populates —
// the warming metrics (health / inbox / spam / progress) are empty for synced mailboxes and omitted
// until the warming sync runs.
const ACCOUNT_COLUMNS: {
  key: string;
  label: string;
  sortKey?: AccountSortKey;
  width: number;
  minWidth: number;
  render: (account: EmailAccountRecord, domainName: string) => ReactNode;
}[] = [
  { key: "email", label: "Email", sortKey: "email", width: 320, minWidth: 200, render: (a) => a.email_address },
  { key: "username", label: "Username", sortKey: "username", width: 170, minWidth: 120, render: (a) => a.username ?? "—" },
  { key: "display", label: "Display name", sortKey: "display", width: 200, minWidth: 130, render: (a) => a.display_name ?? "—" },
  { key: "status", label: "Status", sortKey: "status", width: 120, minWidth: 90, render: (a) => a.status ?? "—" },
  { key: "domain", label: "Domain", sortKey: "domain", width: 240, minWidth: 160, render: (_a, d) => d },
  { key: "created", label: "Created", width: 120, minWidth: 100, render: (a) => formatDate(a.winnr_created_at) },
  { key: "synced", label: "Last synced", width: 130, minWidth: 100, render: (a) => formatDate(a.last_synced_at) },
  // Row action — rendered by the body, which owns the refresh callback this registry cannot see.
  { key: "actions", label: "", width: 96, minWidth: 88, render: () => null },
];

export function EmailAccountsPage() {
  const { identity } = useAuth();
  // Archived mailboxes are hidden by default (migration 20260813). Archiving a mailbox is a
  // portal-side hide: the Winnr sync keeps refreshing the row, it just never clears the tombstone.
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, refresh } = useEmailAccountsPage({ includeArchived: showArchived });
  const clients = data?.clients ?? EMPTY_CLIENTS;
  const domains = data?.domains ?? EMPTY_DOMAINS;
  const emailAccounts = data?.emailAccounts ?? EMPTY_ACCOUNTS;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: AccountSortKey; direction: SortDirection }>({ key: "email", direction: "asc" });

  const columns = useResizableColumns({
    // v5: the actions column changed the column count, so stored v4 widths no longer line up.
    storageKey: "table:email-accounts:columns:v5",
    defaultWidths: ACCOUNT_COLUMNS.map((c) => c.width),
    minWidths: ACCOUNT_COLUMNS.map((c) => c.minWidth),
  });
  const tableStyle = useMemo(
    () => ({ "--email-accounts-table-columns": columns.template }) as CSSProperties,
    [columns.template],
  );

  const scopedDomains = useMemo(() => (identity ? scopeDomains(identity, clients, domains) : []), [clients, domains, identity]);
  const scopedAccounts = useMemo(
    () => (identity ? scopeEmailAccounts(identity, clients, domains, emailAccounts) : []),
    [clients, domains, emailAccounts, identity],
  );
  const domainNameById = useMemo(() => new Map(scopedDomains.map((d) => [d.id, d.domain_name])), [scopedDomains]);
  const domainName = useCallback((account: EmailAccountRecord) => domainNameById.get(account.domain_id) ?? "—", [domainNameById]);

  const filteredAccounts = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return scopedAccounts;
    return scopedAccounts.filter(
      (account) =>
        account.email_address.toLowerCase().includes(search) ||
        (account.display_name ?? "").toLowerCase().includes(search) ||
        domainName(account).toLowerCase().includes(search),
    );
  }, [domainName, query, scopedAccounts]);

  const sortedAccounts = useMemo(() => {
    return filteredAccounts.slice().sort((left, right) => {
      if (sort.key === "username") return compareText(left.username, right.username, sort.direction);
      if (sort.key === "display") return compareText(left.display_name, right.display_name, sort.direction);
      if (sort.key === "status") return compareText(left.status, right.status, sort.direction);
      if (sort.key === "domain") return compareText(domainName(left), domainName(right), sort.direction);
      return compareText(left.email_address, right.email_address, sort.direction);
    });
  }, [domainName, filteredAccounts, sort.direction, sort.key]);

  if (!identity || identity.role === "client") {
    return (
      <div className="space-y-6">
        <PageHeader title="Email accounts" subtitle="Mailboxes are available for manager and admin roles only." />
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
        <PageHeader title="Email accounts" subtitle="Winnr mailbox inventory across scoped domains." />
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
      <PageHeader title="Email accounts" subtitle="Winnr mailbox inventory across scoped domains." />

      <DomainsSectionTabs />

      {sortedAccounts.length === 0 ? (
        <EmptyState
          title="No email accounts in current scope"
          description="When mailboxes are synced from Winnr, they will appear here."
        />
      ) : (
        <Surface title="Mailbox list" subtitle={`${sortedAccounts.length} mailboxes in current scope`}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search email, name, or domain"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none sm:max-w-md"
            />
            <ShowArchivedToggle value={showArchived} onChange={setShowArchived} disabled={loading} />
          </div>

          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto" style={tableStyle}>
              <div className="grid gap-3 border-b border-border bg-black/20 px-4 py-3 [grid-template-columns:var(--email-accounts-table-columns)]">
                {ACCOUNT_COLUMNS.map((column, index) => (
                  <div key={column.key} className="relative min-w-0">
                    {column.sortKey ? (
                      <button
                        onClick={() =>
                          setSort((current) =>
                            current.key === column.sortKey
                              ? { key: column.sortKey!, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.sortKey!, direction: "asc" },
                          )
                        }
                        className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                      >
                        {column.label} ({sortIndicator(sort.key === column.sortKey, sort.direction)})
                      </button>
                    ) : (
                      <span className="block text-xs uppercase tracking-[0.16em] text-muted-foreground">{column.label}</span>
                    )}
                    {index < ACCOUNT_COLUMNS.length - 1 && (
                      <div onMouseDown={columns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                    )}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border">
                {sortedAccounts.map((account) => (
                  <div key={account.id} className="grid items-center gap-3 px-4 py-3 [grid-template-columns:var(--email-accounts-table-columns)]">
                    {ACCOUNT_COLUMNS.map((column) => (
                      <span
                        key={column.key}
                        className={`truncate text-sm ${column.key === "email" ? "text-white" : "text-neutral-300"}`}
                      >
                        {column.key === "actions" ? (
                          <ArchiveButton
                            entity="emailAccount"
                            id={account.id}
                            name={account.email_address}
                            archivedAt={account.archived_at}
                            onDone={refresh}
                            variant="icon"
                          />
                        ) : column.key === "email" ? (
                          <span className="inline-flex min-w-0 items-center">
                            <span className="truncate">{account.email_address}</span>
                            <ArchivedBadge archivedAt={account.archived_at} />
                          </span>
                        ) : (
                          column.render(account, domainName(account))
                        )}
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
