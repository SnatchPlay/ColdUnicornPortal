import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { scopeClients, scopeInvoices } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { InvoiceRecord } from "../types/core";

const INVOICE_STATUSES = ["pending", "issued", "sent", "paid", "overdue", "vindication"] as const;
const INVOICE_UNSET_VALUE = "__unset_invoice_status__";

type SortDirection = "asc" | "desc";
type InvoiceSortKey = "client" | "issueDate" | "amount" | "status";

interface InvoiceDraft {
  issueDate: string;
  amount: number;
  status: string;
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

function toInvoiceDraft(invoice: InvoiceRecord): InvoiceDraft {
  return {
    issueDate: invoice.issue_date,
    amount: invoice.amount,
    status: invoice.status ?? "",
  };
}

function buildInvoicePatch(invoice: InvoiceRecord, draft: InvoiceDraft): Partial<InvoiceRecord> {
  const patch: Partial<InvoiceRecord> = {};
  const nextStatus = draft.status.trim() || null;

  if (invoice.issue_date !== draft.issueDate) {
    patch.issue_date = draft.issueDate;
  }
  if (invoice.amount !== draft.amount) {
    patch.amount = draft.amount;
  }
  if ((invoice.status ?? null) !== nextStatus) {
    patch.status = nextStatus;
  }

  return patch;
}

export function InvoicesPage() {
  const { identity } = useAuth();
  const { clients, invoices, updateInvoice, loading, error, refresh } = useCoreData();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [invoiceSort, setInvoiceSort] = useState<{ key: InvoiceSortKey; direction: SortDirection }>({
    key: "issueDate",
    direction: "desc",
  });
  const invoiceColumns = useResizableColumns({
    storageKey: "table:invoices:columns",
    defaultWidths: [360, 250, 220, 220],
    minWidths: [220, 170, 140, 140],
  });
  const invoiceTableStyle = useMemo(
    () =>
      ({
        "--invoices-table-columns": invoiceColumns.template,
      }) as CSSProperties,
    [invoiceColumns.template],
  );

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const scopedInvoices = useMemo(
    () => (identity ? scopeInvoices(identity, clients, invoices) : []),
    [clients, identity, invoices],
  );

  const filteredInvoices = useMemo(() => {
    return scopedInvoices.filter((item) => {
      const clientName = scopedClients.find((client) => client.id === item.client_id)?.name ?? "";
      const search = query.trim().toLowerCase();
      const matchesQuery =
        search.length === 0 ||
        clientName.toLowerCase().includes(search) ||
        item.status?.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search);
      const matchesStatus = statusFilter === "all" || (item.status ?? "") === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, scopedClients, scopedInvoices, statusFilter]);

  const sortedInvoices = useMemo(() => {
    return filteredInvoices.slice().sort((left, right) => {
      if (invoiceSort.key === "client") {
        const leftClient = scopedClients.find((item) => item.id === left.client_id)?.name ?? "";
        const rightClient = scopedClients.find((item) => item.id === right.client_id)?.name ?? "";
        return compareText(leftClient, rightClient, invoiceSort.direction);
      }
      if (invoiceSort.key === "issueDate") {
        return compareText(left.issue_date, right.issue_date, invoiceSort.direction);
      }
      if (invoiceSort.key === "amount") {
        return compareNumber(left.amount, right.amount, invoiceSort.direction);
      }
      return compareText(left.status, right.status, invoiceSort.direction);
    });
  }, [filteredInvoices, invoiceSort.direction, invoiceSort.key, scopedClients]);

  const selectedInvoice =
    sortedInvoices.find((item) => item.id === selectedInvoiceId) ?? sortedInvoices[0] ?? null;

  useEffect(() => {
    if (!selectedInvoice) {
      setDraft(null);
      return;
    }
    setDraft(toInvoiceDraft(selectedInvoice));
  }, [selectedInvoice?.id]);

  const draftPatch = useMemo(() => {
    if (!selectedInvoice || !draft) return {};
    return buildInvoicePatch(selectedInvoice, draft);
  }, [draft, selectedInvoice]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  const paidCount = sortedInvoices.filter((item) => item.status === "paid").length;
  const overdueCount = sortedInvoices.filter((item) => item.status === "overdue").length;
  const totalAmount = sortedInvoices.reduce((sum, item) => sum + item.amount, 0);

  async function saveDraft() {
    if (!selectedInvoice || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await updateInvoice(selectedInvoice.id, draftPatch);
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedInvoice) return;
    setDraft(toInvoiceDraft(selectedInvoice));
  }

  if (!identity || identity.role === "client") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Invoices"
          subtitle="Invoice operations are available for manager and admin roles only."
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
          title="Invoices"
          subtitle="Invoice lifecycle and amount tracking in the current role scope."
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
        title="Invoices"
        subtitle="Operational invoice ledger for scoped clients with controlled status updates."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Invoices</p>
          <p className="mt-2 text-2xl">{formatNumber(sortedInvoices.length)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
          <p className="mt-2 text-2xl">{formatNumber(paidCount)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Overdue</p>
          <p className="mt-2 text-2xl">{formatNumber(overdueCount)}</p>
          <p className="mt-2 text-xs text-muted-foreground">Scope total: {formatMoney(totalAmount)}</p>
        </div>
      </div>

      {sortedInvoices.length === 0 ? (
        <EmptyState
          title="No invoices in current scope"
          description="When invoices are synced, they will appear here with amount and status details."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface title="Invoice list" subtitle={`${sortedInvoices.length} invoices in current scope`}>
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by client, status, or invoice id"
                className="min-w-[16rem] flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              />
              <Select
                value={statusFilter === "" ? INVOICE_UNSET_VALUE : statusFilter}
                onValueChange={(value) => setStatusFilter(value === INVOICE_UNSET_VALUE ? "" : value)}
              >
                <SelectTrigger
                  aria-label="Filter invoices by status"
                  className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white"
                >
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value="all" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    All statuses
                  </SelectItem>
                  {INVOICE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {status}
                    </SelectItem>
                  ))}
                  <SelectItem value={INVOICE_UNSET_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                    unset
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="overflow-x-auto" style={invoiceTableStyle}>
                <div className="hidden min-w-[1100px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid md:[grid-template-columns:var(--invoices-table-columns)]">
                  {[
                    { key: "client" as const, label: "Client" },
                    { key: "issueDate" as const, label: "Issue date" },
                    { key: "amount" as const, label: "Amount" },
                    { key: "status" as const, label: "Status" },
                  ].map((column, index, collection) => (
                    <div key={column.key} className="relative min-w-0">
                      <button
                        onClick={() =>
                          setInvoiceSort((current) =>
                            current.key === column.key
                              ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                              : { key: column.key, direction: column.key === "issueDate" ? "desc" : "asc" },
                          )
                        }
                        className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                      >
                        {column.label} ({sortIndicator(invoiceSort.key === column.key, invoiceSort.direction)})
                      </button>
                      {index < collection.length - 1 && (
                        <div onMouseDown={invoiceColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-border">
                  {sortedInvoices.map((invoice) => {
                    const active = selectedInvoice?.id === invoice.id;
                    const clientName = scopedClients.find((item) => item.id === invoice.client_id)?.name ?? "Unknown client";
                    return (
                      <button
                        key={invoice.id}
                        onClick={() => setSelectedInvoiceId(invoice.id)}
                        className={`grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition md:min-w-[1100px] md:[grid-template-columns:var(--invoices-table-columns)] md:items-center md:gap-3 ${
                          active ? "bg-white/5" : "hover:bg-white/3"
                        }`}
                      >
                        <span className="truncate text-sm text-white">{clientName}</span>
                        <span className="text-sm text-neutral-300">{formatDate(invoice.issue_date)}</span>
                        <span className="text-sm text-neutral-300">{formatMoney(invoice.amount)}</span>
                        <span className="text-xs uppercase tracking-[0.14em] text-neutral-400">{invoice.status ?? "unset"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Surface>

          <Surface title="Invoice detail" subtitle="Review and update invoice status and amount.">
            {!selectedInvoice || !draft ? (
              <EmptyState
                title="Select an invoice"
                description="Select a row from the list to inspect and update invoice metadata."
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
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Invoice ID</p>
                    <p className="mt-2 truncate text-sm">{selectedInvoice.id}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</p>
                    <p className="mt-2 text-sm">
                      {scopedClients.find((item) => item.id === selectedInvoice.client_id)?.name ?? "Unknown client"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Issue date</span>
                    <input
                      type="date"
                      value={draft.issueDate}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, issueDate: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Amount</span>
                    <input
                      type="number"
                      value={draft.amount}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const next = Number(event.target.value);
                          return {
                            ...current,
                            amount: Number.isFinite(next) ? Math.max(0, next) : 0,
                          };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2 md:col-span-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <Select
                      value={draft.status === "" ? INVOICE_UNSET_VALUE : draft.status}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          current ? { ...current, status: value === INVOICE_UNSET_VALUE ? "" : value } : current,
                        )
                      }
                    >
                      <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                        <SelectItem value={INVOICE_UNSET_VALUE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          unset
                        </SelectItem>
                        {INVOICE_STATUSES.map((status) => (
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
              </div>
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}

