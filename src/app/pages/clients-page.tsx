import { useMemo, useState } from "react";
import { EmptyState, PageHeader, Surface } from "../components/app-ui";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { scopeClients } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { ClientRecord } from "../types/core";

export function ClientsPage() {
  const { identity } = useAuth();
  const { clients, users, updateClient } = useCoreData();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const selectedClient =
    scopedClients.find((item) => item.id === selectedClientId) ?? scopedClients[0] ?? null;

  async function patchClient(client: ClientRecord, patch: Partial<ClientRecord>) {
    await updateClient(client.id, patch);
  }

  if (!identity || identity.role === "client") {
    return (
      <EmptyState
        title="Clients workspace is internal only"
        description="This route is available to admin and manager roles."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        subtitle="Operational client control surface. Core settings are edited directly against the live clients table contract."
      />

      {scopedClients.length === 0 ? (
        <EmptyState title="No clients assigned" description="The current identity does not have any visible clients." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <Surface title="Client list" subtitle={`${scopedClients.length} clients in current scope`}>
            <div className="space-y-3">
              {scopedClients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedClient?.id === client.id
                      ? "border-sky-400/30 bg-sky-500/10"
                      : "border-border bg-black/10 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm">{client.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {client.status}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{formatNumber(client.kpi_leads)}</p>
                      <p>MQL target</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Surface>

          <Surface title="Client detail" subtitle="Editable fields currently live on public.clients.">
            {!selectedClient ? (
              <EmptyState title="Select a client" description="Client detail appears here once a client is selected." />
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client name</span>
                    <input
                      value={selectedClient.name}
                      onChange={(event) => void patchClient(selectedClient, { name: event.target.value })}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <select
                      value={selectedClient.status}
                      onChange={(event) => void patchClient(selectedClient, { status: event.target.value as ClientRecord["status"] })}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    >
                      {["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Min daily sent</span>
                    <input
                      type="number"
                      value={selectedClient.min_daily_sent}
                      onChange={(event) => void patchClient(selectedClient, { min_daily_sent: Number(event.target.value) })}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Inboxes</span>
                    <input
                      type="number"
                      value={selectedClient.inboxes_count}
                      onChange={(event) => void patchClient(selectedClient, { inboxes_count: Number(event.target.value) })}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Notification emails</span>
                    <textarea
                      rows={3}
                      value={(selectedClient.notification_emails ?? []).join(", ")}
                      onChange={(event) =>
                        void patchClient(selectedClient, {
                          notification_emails: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">SMS phones</span>
                    <textarea
                      rows={3}
                      value={(selectedClient.sms_phone_numbers ?? []).join(", ")}
                      onChange={(event) =>
                        void patchClient(selectedClient, {
                          sms_phone_numbers: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager</p>
                    <p className="mt-2 text-sm">
                      {users.find((item) => item.id === selectedClient.manager_id)?.first_name ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contract</p>
                    <p className="mt-2 text-sm">{formatMoney(selectedClient.contracted_amount)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Due date</p>
                    <p className="mt-2 text-sm">{formatDate(selectedClient.contract_due_date)}</p>
                  </div>
                  <label className="rounded-2xl border border-border bg-black/10 p-4">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auto OOO</span>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm">{selectedClient.auto_ooo_enabled ? "Enabled" : "Disabled"}</span>
                      <input
                        type="checkbox"
                        checked={selectedClient.auto_ooo_enabled}
                        onChange={(event) =>
                          void patchClient(selectedClient, { auto_ooo_enabled: event.target.checked })
                        }
                      />
                    </div>
                  </label>
                </div>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup info</span>
                  <textarea
                    rows={4}
                    value={selectedClient.setup_info ?? ""}
                    onChange={(event) => void patchClient(selectedClient, { setup_info: event.target.value })}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>
              </div>
            )}
          </Surface>
        </div>
      )}
    </div>
  );
}
