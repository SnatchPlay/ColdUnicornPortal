import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Banner, ChartTextSummary, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { DomainsSectionTabs } from "../components/domains-tabs";
import { formatDate, formatNumber } from "../lib/format";
import { scopeClients, scopeDomains, scopeEmailAccounts, sortClientsAlpha } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useEmailAccountsPage } from "../lib/use-email-accounts";
import { repository } from "../data/repository";
import { useAuth } from "../providers/auth";
import type {
  ClientRecord,
  DomainRecord,
  EmailAccountRecord,
  EmailAccountWarmingDailyRecord,
} from "../types/core";

const ALL = "all";
const WARMING_UNSET = "__unset_warming_status__";

type SortDirection = "asc" | "desc";
type AccountSortKey = "email" | "domain" | "warming" | "health" | "inbox";

// Stable empty-array fallbacks — prevents new-reference cascades during loading.
const EMPTY_CLIENTS: ClientRecord[] = [];
const EMPTY_DOMAINS: DomainRecord[] = [];
const EMPTY_ACCOUNTS: EmailAccountRecord[] = [];

function compareText(left: string | null | undefined, right: string | null | undefined, direction: SortDirection) {
  const result = (left ?? "").toLowerCase().localeCompare((right ?? "").toLowerCase());
  return direction === "asc" ? result : -result;
}

function compareNumber(left: number | null, right: number | null, direction: SortDirection) {
  // Missing metrics always sort last, regardless of direction — an unsynced mailbox with no
  // health score should never outrank a real one when sorting "worst first" or "best first".
  const leftMissing = left === null || !Number.isFinite(left);
  const rightMissing = right === null || !Number.isFinite(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  const result = left - right;
  return direction === "asc" ? result : -result;
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "sort";
  return direction === "asc" ? "asc" : "desc";
}

// High-contrast status palette — keyed on the free-text warming status from Winnr.
// NOTE: these status literals ('active', 'paused', …) are provisional — Winnr owns the taxonomy
// (see the 20260720e migration). Unrecognised values degrade gracefully to the neutral tone; once
// the n8n → Winnr mapping is confirmed, reconcile these keys (and the view's 'active' filter) to it.
function warmingTone(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "text-emerald-300";
    case "paused":
      return "text-amber-300";
    case "completed":
      return "text-sky-300";
    case "error":
      return "text-rose-300";
    default:
      return "text-neutral-400";
  }
}

const CHART_TOOLTIP = {
  contentStyle: {
    background: "#050505",
    border: "1px solid #242424",
    borderRadius: 12,
    fontSize: 12,
    color: "#fff",
  },
  labelStyle: { color: "rgba(148,163,184,0.9)" },
} as const;

export function EmailAccountsPage() {
  const { identity } = useAuth();
  const { data, loading, error, refresh } = useEmailAccountsPage();
  const clients = data?.clients ?? EMPTY_CLIENTS;
  const domains = data?.domains ?? EMPTY_DOMAINS;
  const emailAccounts = data?.emailAccounts ?? EMPTY_ACCOUNTS;

  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState(ALL);
  const [domainFilter, setDomainFilter] = useState(ALL);
  const [warmingFilter, setWarmingFilter] = useState(ALL);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: AccountSortKey; direction: SortDirection }>({
    key: "email",
    direction: "asc",
  });

  // Lazily-loaded per-mailbox warming history for the trend chart.
  const [history, setHistory] = useState<EmailAccountWarmingDailyRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyIdRef = useRef(0);

  const columns = useResizableColumns({
    storageKey: "table:email-accounts:columns",
    defaultWidths: [360, 260, 160, 140, 140],
    minWidths: [220, 160, 120, 100, 100],
  });
  const tableStyle = useMemo(
    () => ({ "--email-accounts-table-columns": columns.template }) as CSSProperties,
    [columns.template],
  );

  const scopedClients = useMemo(
    () => (identity ? sortClientsAlpha(scopeClients(identity, clients)) : []),
    [clients, identity],
  );
  const scopedDomains = useMemo(
    () => (identity ? scopeDomains(identity, clients, domains) : []),
    [clients, domains, identity],
  );
  const scopedAccounts = useMemo(
    () => (identity ? scopeEmailAccounts(identity, clients, domains, emailAccounts) : []),
    [clients, domains, emailAccounts, identity],
  );

  const domainById = useMemo(() => new Map(scopedDomains.map((item) => [item.id, item])), [scopedDomains]);
  const clientById = useMemo(() => new Map(scopedClients.map((item) => [item.id, item])), [scopedClients]);

  const warmingStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const account of scopedAccounts) {
      if (account.warming_status) set.add(account.warming_status);
    }
    return Array.from(set).sort();
  }, [scopedAccounts]);

  const filteredAccounts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return scopedAccounts.filter((account) => {
      const domain = domainById.get(account.domain_id);
      const matchesQuery =
        search.length === 0 ||
        account.email_address.toLowerCase().includes(search) ||
        (domain?.domain_name ?? "").toLowerCase().includes(search);
      const matchesClient = clientFilter === ALL || domain?.client_id === clientFilter;
      const matchesDomain = domainFilter === ALL || account.domain_id === domainFilter;
      const matchesWarming =
        warmingFilter === ALL ||
        (warmingFilter === WARMING_UNSET ? !account.warming_status : account.warming_status === warmingFilter);
      return matchesQuery && matchesClient && matchesDomain && matchesWarming;
    });
  }, [clientFilter, domainById, domainFilter, query, scopedAccounts, warmingFilter]);

  const sortedAccounts = useMemo(() => {
    return filteredAccounts.slice().sort((left, right) => {
      if (sort.key === "email") return compareText(left.email_address, right.email_address, sort.direction);
      if (sort.key === "domain") {
        return compareText(domainById.get(left.domain_id)?.domain_name, domainById.get(right.domain_id)?.domain_name, sort.direction);
      }
      if (sort.key === "warming") return compareText(left.warming_status, right.warming_status, sort.direction);
      if (sort.key === "health") return compareNumber(left.warming_health_score, right.warming_health_score, sort.direction);
      return compareNumber(left.warming_inbox_rate, right.warming_inbox_rate, sort.direction);
    });
  }, [domainById, filteredAccounts, sort.direction, sort.key]);

  const selectedAccount = sortedAccounts.find((item) => item.id === selectedAccountId) ?? sortedAccounts[0] ?? null;

  // Load warming history whenever the selected mailbox changes. loadIdRef stale guard.
  useEffect(() => {
    if (!selectedAccount) {
      setHistory([]);
      return;
    }
    const id = ++historyIdRef.current;
    setHistoryLoading(true);
    repository
      .loadEmailAccountWarming(selectedAccount.id)
      .then((rows) => {
        if (id !== historyIdRef.current) return;
        setHistory(rows);
      })
      .catch(() => {
        if (id !== historyIdRef.current) return;
        setHistory([]);
      })
      .finally(() => {
        if (id === historyIdRef.current) setHistoryLoading(false);
      });
  }, [selectedAccount?.id]);

  const chartSeries = useMemo(
    () =>
      history.map((row) => ({
        label: formatDate(row.metric_date),
        health: row.health_score,
        inbox: row.inbox_rate,
      })),
    [history],
  );

  if (!identity || identity.role === "client") {
    return (
      <div className="space-y-6">
        <PageHeader title="Email accounts" subtitle="Mailbox warming is available for manager and admin roles only." />
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
        <PageHeader title="Email accounts" subtitle="Mailbox warming health across scoped domains." />
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
      <PageHeader title="Email accounts" subtitle="Mailbox warming health and inbox performance across scoped domains." />

      <DomainsSectionTabs />

      {sortedAccounts.length === 0 ? (
        <EmptyState
          title="No email accounts in current scope"
          description="When mailboxes are synced from Winnr, they will appear here with warming health and inbox rate."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface title="Mailbox list" subtitle={`${sortedAccounts.length} mailboxes in current scope`}>
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search email or domain"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none sm:min-w-[16rem]"
              />
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger aria-label="Filter by client" className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL} className="text-white focus:bg-[#1a1a1a] focus:text-white">All clients</SelectItem>
                  {scopedClients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={warmingFilter} onValueChange={setWarmingFilter}>
                <SelectTrigger aria-label="Filter by warming status" className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white">
                  <SelectValue placeholder="All warming" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={ALL} className="text-white focus:bg-[#1a1a1a] focus:text-white">All warming</SelectItem>
                  {warmingStatuses.map((status) => (
                    <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {status}
                    </SelectItem>
                  ))}
                  <SelectItem value={WARMING_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">unset</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="overflow-x-auto" style={tableStyle}>
                <div className="hidden min-w-[1100px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:[grid-template-columns:var(--email-accounts-table-columns)]">
                  {[
                    { key: "email" as const, label: "Email" },
                    { key: "domain" as const, label: "Domain" },
                    { key: "warming" as const, label: "Warming" },
                    { key: "health" as const, label: "Health" },
                    { key: "inbox" as const, label: "Inbox rate" },
                  ].map((column) => (
                    <div key={column.key} className="relative min-w-0">
                      <button
                        onClick={() =>
                          setSort((current) =>
                            current.key === column.key
                              ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.key, direction: "asc" },
                          )
                        }
                        className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                      >
                        {column.label} ({sortIndicator(sort.key === column.key, sort.direction)})
                      </button>
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-border md:min-w-[1100px]">
                  {sortedAccounts.map((account) => {
                    const active = selectedAccount?.id === account.id;
                    const domain = domainById.get(account.domain_id);
                    return (
                      <button
                        key={account.id}
                        onClick={() => setSelectedAccountId(account.id)}
                        className={`block w-full px-4 py-3 text-left transition ${active ? "bg-white/5" : "hover:bg-white/3"}`}
                      >
                        {/* Mobile card */}
                        <div className="md:hidden">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-white">{account.email_address}</span>
                            <span className={`shrink-0 text-xs uppercase tracking-[0.14em] ${warmingTone(account.warming_status)}`}>
                              {account.warming_status ?? "unset"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-neutral-500">
                            {domain?.domain_name ?? "—"} · health {formatNumber(account.warming_health_score)} · inbox {formatNumber(account.warming_inbox_rate)}
                          </p>
                        </div>
                        {/* Desktop row */}
                        <div className="hidden min-w-[1100px] items-center gap-3 [grid-template-columns:var(--email-accounts-table-columns)] md:grid">
                          <span className="truncate text-sm text-white">{account.email_address}</span>
                          <span className="truncate text-sm text-neutral-300">{domain?.domain_name ?? "—"}</span>
                          <span className={`text-xs uppercase tracking-[0.14em] ${warmingTone(account.warming_status)}`}>
                            {account.warming_status ?? "unset"}
                          </span>
                          <span className="text-sm text-neutral-300">{formatNumber(account.warming_health_score)}</span>
                          <span className="text-sm text-neutral-300">{formatNumber(account.warming_inbox_rate)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Surface>

          <Surface title="Mailbox detail" subtitle="Current warming state and history.">
            {!selectedAccount ? (
              <EmptyState title="Select a mailbox" description="Select a row from the list to inspect warming health and history." />
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</p>
                    <p className="mt-2 break-all text-sm">{selectedAccount.email_address}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Domain / client</p>
                    <p className="mt-2 text-sm">
                      {domainById.get(selectedAccount.domain_id)?.domain_name ?? "—"}
                      <span className="text-neutral-500">
                        {" · "}
                        {clientById.get(domainById.get(selectedAccount.domain_id)?.client_id ?? "")?.name ?? "Unknown client"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Warming status", value: selectedAccount.warming_status ?? "unset", tone: warmingTone(selectedAccount.warming_status) },
                    { label: "Health score", value: formatNumber(selectedAccount.warming_health_score) },
                    { label: "Warm-up progress", value: formatNumber(selectedAccount.warming_progress) },
                    { label: "Inbox rate", value: formatNumber(selectedAccount.warming_inbox_rate) },
                    { label: "Spam rate", value: formatNumber(selectedAccount.warming_spam_rate) },
                    { label: "Daily volume", value: formatNumber(selectedAccount.warming_daily_volume) },
                  ].map((tile) => (
                    <div key={tile.label} className="rounded-2xl border border-border bg-black/10 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{tile.label}</p>
                      <p className={`mt-2 text-lg font-semibold ${tile.tone ?? "text-white"}`}>{tile.value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-border bg-black/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Warming trend</p>
                  {historyLoading ? (
                    <p className="mt-6 text-sm text-neutral-500">Loading history…</p>
                  ) : chartSeries.length === 0 ? (
                    <p className="mt-6 text-sm text-neutral-500">No warming history recorded for this mailbox yet.</p>
                  ) : (
                    <>
                      <ChartTextSummary summary={`Warming trend with ${chartSeries.length} daily points (health score and inbox rate).`} />
                      <div className="mt-3 h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartSeries}>
                            <defs>
                              <linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="inboxFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                            <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip {...CHART_TOOLTIP} />
                            <Area type="monotone" dataKey="health" name="Health" stroke="#22c55e" strokeWidth={2} fill="url(#healthFill)" dot={false} />
                            <Area type="monotone" dataKey="inbox" name="Inbox rate" stroke="#38bdf8" strokeWidth={2} fill="url(#inboxFill)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
