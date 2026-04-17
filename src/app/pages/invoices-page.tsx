import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { scopeClients, scopeInvoices } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { InvoiceRecord } from "../types/core";

const INVOICE_STATUSES = ["pending", "issued", "sent", "paid", "overdue", "vindication"] as const;

interface InvoiceDraft {
  issueDate: string;
  amount: number;
  status: string;
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

  const selectedInvoice =
    filteredInvoices.find((item) => item.id === selectedInvoiceId) ?? filteredInvoices[0] ?? null;

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

  const paidCount = filteredInvoices.filter((item) => item.status === "paid").length;
  const overdueCount = filteredInvoices.filter((item) => item.status === "overdue").length;
  const totalAmount = filteredInvoices.reduce((sum, item) => sum + item.amount, 0);

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
          <p className="mt-2 text-2xl">{formatNumber(filteredInvoices.length)}</p>
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

      {filteredInvoices.length === 0 ? (
        <EmptyState
          title="No invoices in current scope"
          description="When invoices are synced, they will appear here with amount and status details."
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Surface title="Invoice list" subtitle={`${filteredInvoices.length} invoices in current scope`}>
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by client, status, or invoice id"
                className="min-w-[16rem] flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter invoices by status"
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              >
                <option value="all">All statuses</option>
                {INVOICE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
                <option value="">unset</option>
              </select>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border">
              <div className="hidden grid-cols-[1.3fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground md:grid">
                <span>Client</span>
                <span>Issue date</span>
                <span>Amount</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-border">
                {filteredInvoices.map((invoice) => {
                  const active = selectedInvoice?.id === invoice.id;
                  const clientName = scopedClients.find((item) => item.id === invoice.client_id)?.name ?? "Unknown client";
                  return (
                    <button
                      key={invoice.id}
                      onClick={() => setSelectedInvoiceId(invoice.id)}
                      className={`grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition md:grid-cols-[1.3fr_0.9fr_0.8fr_0.8fr] md:items-center md:gap-3 ${
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
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, status: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    >
                      <option value="">unset</option>
                      {INVOICE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
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
