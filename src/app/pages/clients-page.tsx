import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { scopeClients } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { ClientRecord, InviteRole } from "../types/core";

const CLIENT_STATUSES: ClientRecord["status"][] = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"];
const CLIENT_USER_PLACEHOLDER = "__select_client_user__";

interface ClientDraft {
  name: string;
  status: ClientRecord["status"];
  minDailySent: number;
  inboxesCount: number;
  notificationEmails: string;
  smsPhoneNumbers: string;
  autoOooEnabled: boolean;
  setupInfo: string;
  managerId: string;
}

function toCsv(items: string[] | null) {
  return (items ?? []).join(", ");
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toClientDraft(client: ClientRecord): ClientDraft {
  return {
    name: client.name,
    status: client.status,
    minDailySent: client.min_daily_sent,
    inboxesCount: client.inboxes_count,
    notificationEmails: toCsv(client.notification_emails),
    smsPhoneNumbers: toCsv(client.sms_phone_numbers),
    autoOooEnabled: client.auto_ooo_enabled,
    setupInfo: client.setup_info ?? "",
    managerId: client.manager_id,
  };
}

function buildClientPatch(client: ClientRecord, draft: ClientDraft, canEditAssignments: boolean): Partial<ClientRecord> {
  const patch: Partial<ClientRecord> = {};

  if (client.name !== draft.name) {
    patch.name = draft.name;
  }
  if (client.status !== draft.status) {
    patch.status = draft.status;
  }
  if (client.min_daily_sent !== draft.minDailySent) {
    patch.min_daily_sent = draft.minDailySent;
  }
  if (client.inboxes_count !== draft.inboxesCount) {
    patch.inboxes_count = draft.inboxesCount;
  }

  const nextNotificationEmails = parseCsv(draft.notificationEmails);
  if (JSON.stringify(client.notification_emails ?? []) !== JSON.stringify(nextNotificationEmails)) {
    patch.notification_emails = nextNotificationEmails;
  }

  const nextSmsPhones = parseCsv(draft.smsPhoneNumbers);
  if (JSON.stringify(client.sms_phone_numbers ?? []) !== JSON.stringify(nextSmsPhones)) {
    patch.sms_phone_numbers = nextSmsPhones;
  }

  const nextSetupInfo = draft.setupInfo.trim();
  if ((client.setup_info ?? "") !== draft.setupInfo) {
    patch.setup_info = nextSetupInfo.length > 0 ? draft.setupInfo : null;
  }

  if (client.auto_ooo_enabled !== draft.autoOooEnabled) {
    patch.auto_ooo_enabled = draft.autoOooEnabled;
  }

  if (canEditAssignments && client.manager_id !== draft.managerId) {
    patch.manager_id = draft.managerId;
  }

  return patch;
}

export function ClientsPage() {
  const { identity } = useAuth();
  const {
    clients,
    users,
    clientUsers,
    updateClient,
    sendInvite,
    upsertClientUserMapping,
    deleteClientUserMapping,
    loading,
    error,
    refresh,
  } = useCoreData();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [mappingUserId, setMappingUserId] = useState("");
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("client");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const selectedClient =
    scopedClients.find((item) => item.id === selectedClientId) ?? scopedClients[0] ?? null;
  const canEditAssignments = identity?.role === "admin" || identity?.role === "super_admin";
  const canInviteUsers = identity?.role === "admin" || identity?.role === "super_admin" || identity?.role === "manager";
  const canInviteInternalRoles = identity?.role === "admin" || identity?.role === "super_admin";

  const managerUsers = useMemo(
    () => users.filter((item) => item.role === "manager"),
    [users],
  );
  const clientRoleUsers = useMemo(
    () => users.filter((item) => item.role === "client"),
    [users],
  );

  const selectedClientMappings = useMemo(
    () => (selectedClient ? clientUsers.filter((item) => item.client_id === selectedClient.id) : []),
    [clientUsers, selectedClient],
  );

  const clientById = useMemo(
    () => new Map(clients.map((item) => [item.id, item.name])),
    [clients],
  );

  const mappingByUserId = useMemo(
    () => new Map(clientUsers.map((item) => [item.user_id, item])),
    [clientUsers],
  );

  const selectedMapping = useMemo(
    () => clientUsers.find((item) => item.user_id === mappingUserId) ?? null,
    [clientUsers, mappingUserId],
  );

  const selectedMappingClientName = useMemo(() => {
    if (!selectedMapping) return null;
    return clients.find((item) => item.id === selectedMapping.client_id)?.name ?? "Unknown client";
  }, [clients, selectedMapping]);

  const selectedManagerName = useMemo(() => {
    if (!selectedClient) return "—";
    const manager = users.find((item) => item.id === selectedClient.manager_id);
    if (!manager) return "—";
    return `${manager.first_name} ${manager.last_name}`.trim();
  }, [selectedClient, users]);

  useEffect(() => {
    if (!selectedClient) {
      setDraft(null);
      setMappingUserId("");
      return;
    }

    setDraft(toClientDraft(selectedClient));
    setMappingUserId("");
  }, [selectedClient?.id]);

  useEffect(() => {
    if (!canInviteInternalRoles) {
      setInviteRole("client");
    }
  }, [canInviteInternalRoles]);

  const draftPatch = useMemo(() => {
    if (!selectedClient || !draft) return {};
    return buildClientPatch(selectedClient, draft, canEditAssignments);
  }, [canEditAssignments, draft, selectedClient]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  async function saveDraft() {
    if (!selectedClient || !draft || !isDraftDirty) return;

    setIsSavingDraft(true);
    try {
      await updateClient(selectedClient.id, draftPatch);
      setDraft((current) => (current ? { ...current } : current));
    } finally {
      setIsSavingDraft(false);
    }
  }

  function cancelDraft() {
    if (!selectedClient) return;
    setDraft(toClientDraft(selectedClient));
  }

  async function assignClientUser() {
    if (!selectedClient || !mappingUserId) return;

    setIsSavingMapping(true);
    try {
      await upsertClientUserMapping(mappingUserId, selectedClient.id);
      setMappingUserId("");
    } finally {
      setIsSavingMapping(false);
    }
  }

  async function removeClientUserMapping(mappingId: string) {
    setIsSavingMapping(true);
    try {
      await deleteClientUserMapping(mappingId);
    } finally {
      setIsSavingMapping(false);
    }
  }

  async function inviteUser() {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      setInviteMessage({ tone: "warning", text: "Enter a valid email before sending an invitation." });
      return;
    }

    const roleToInvite = canInviteInternalRoles ? inviteRole : "client";
    if (!canInviteInternalRoles && roleToInvite !== "client") {
      setInviteMessage({ tone: "danger", text: "Manager accounts can invite client users only." });
      return;
    }

    if (roleToInvite === "client" && !selectedClient) {
      setInviteMessage({ tone: "warning", text: "Select a client before inviting a client user." });
      return;
    }

    setIsSendingInvite(true);
    setInviteMessage(null);
    try {
      await sendInvite({
        email: normalizedEmail,
        role: roleToInvite,
        ...(roleToInvite === "client" && selectedClient ? { clientId: selectedClient.id } : {}),
      });
      setInviteEmail("");
      setInviteMessage({ tone: "info", text: `Invitation sent to ${normalizedEmail}.` });
    } catch {
      setInviteMessage({ tone: "danger", text: "Invitation request failed. Check permissions and try again." });
    } finally {
      setIsSendingInvite(false);
    }
  }

  if (!identity || identity.role === "client") {
    return (
      <EmptyState
        title="Clients workspace is internal only"
        description="This route is available to admin and manager roles."
      />
    );
  }

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Clients"
          subtitle="Operational client control surface for managing core client settings."
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
        title="Clients"
        subtitle="Operational client control surface for managing core client settings."
      />

      {canInviteUsers && (
        <Surface
          title="Invite users"
          subtitle={
            canInviteInternalRoles
              ? "Admins can invite client, manager, and admin users."
              : "Managers can invite client users for assigned clients only."
          }
        >
          <div className="space-y-4">
            {inviteMessage && <Banner tone={inviteMessage.tone}>{inviteMessage.text}</Banner>}
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</span>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@company.com"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Role</span>
                <Select
                  value={canInviteInternalRoles ? inviteRole : "client"}
                  disabled={!canInviteInternalRoles}
                  onValueChange={(value) => setInviteRole(value as InviteRole)}
                >
                  <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-70">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    <SelectItem value="client" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      client
                    </SelectItem>
                    {canInviteInternalRoles && (
                      <SelectItem value="manager" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        manager
                      </SelectItem>
                    )}
                    {canInviteInternalRoles && (
                      <SelectItem value="admin" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        admin
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {inviteRole === "client"
                  ? `Client invite target: ${selectedClient?.name ?? "select a client"}`
                  : "Internal role invite is organization-wide."}
              </p>
              <button
                onClick={() => {
                  void inviteUser();
                }}
                disabled={isSendingInvite || !inviteEmail.trim()}
                className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingInvite ? "Sending..." : "Send invitation"}
              </button>
            </div>
          </div>
        </Surface>
      )}

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

          <Surface title="Client detail" subtitle="Manage core client details and settings.">
            {!selectedClient ? (
              <EmptyState title="Select a client" description="Client detail appears here once a client is selected." />
            ) : (
              <div className="space-y-5">
                {draft && (
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
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client name</span>
                    <input
                      value={draft?.name ?? ""}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status</span>
                    <Select
                      value={draft?.status ?? CLIENT_STATUSES[0]}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                status: value as ClientRecord["status"],
                              }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                        {CLIENT_STATUSES.map((status) => (
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
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Min daily sent</span>
                    <input
                      type="number"
                      value={draft?.minDailySent ?? 0}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const value = Number(event.target.value);
                          return {
                            ...current,
                            minDailySent: Number.isFinite(value) ? Math.max(0, value) : 0,
                          };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Inboxes</span>
                    <input
                      type="number"
                      value={draft?.inboxesCount ?? 0}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const value = Number(event.target.value);
                          return {
                            ...current,
                            inboxesCount: Number.isFinite(value) ? Math.max(0, value) : 0,
                          };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Notification emails</span>
                    <textarea
                      rows={3}
                      value={draft?.notificationEmails ?? ""}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, notificationEmails: event.target.value } : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">SMS phones</span>
                    <textarea
                      rows={3}
                      value={draft?.smsPhoneNumbers ?? ""}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, smsPhoneNumbers: event.target.value } : current,
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  {canEditAssignments && (
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager assignment</span>
                      <Select
                        value={draft?.managerId || undefined}
                        onValueChange={(value) =>
                          setDraft((current) => (current ? { ...current, managerId: value } : current))
                        }
                      >
                        <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                          <SelectValue placeholder="Select manager" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                          {managerUsers.map((manager) => (
                            <SelectItem
                              key={manager.id}
                              value={manager.id}
                              className="text-white focus:bg-[#1a1a1a] focus:text-white"
                            >
                              {`${manager.first_name} ${manager.last_name}`.trim()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager</p>
                    <p className="mt-2 text-sm">{selectedManagerName}</p>
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
                      <span className="text-sm">{draft?.autoOooEnabled ? "Enabled" : "Disabled"}</span>
                      <Checkbox
                        checked={draft?.autoOooEnabled ?? false}
                        onCheckedChange={(checked) =>
                          setDraft((current) =>
                            current ? { ...current, autoOooEnabled: checked === true } : current,
                          )
                        }
                        className="h-4 w-4"
                      />
                    </div>
                  </label>
                </div>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup info</span>
                  <textarea
                    rows={4}
                    value={draft?.setupInfo ?? ""}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, setupInfo: event.target.value } : current))
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>

                {canEditAssignments && (
                  <div className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                    <div className="space-y-1">
                      <p className="text-sm">Client-user mappings</p>
                      <p className="text-xs text-muted-foreground">
                        Each client user can be linked to one client. Re-assigning moves access to the selected client.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[16rem] flex-1 space-y-2">
                        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client user</span>
                        <Select
                          value={mappingUserId || CLIENT_USER_PLACEHOLDER}
                          onValueChange={(value) => setMappingUserId(value === CLIENT_USER_PLACEHOLDER ? "" : value)}
                        >
                          <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                            <SelectValue placeholder="Select a client user" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                            <SelectItem
                              value={CLIENT_USER_PLACEHOLDER}
                              className="text-white focus:bg-[#1a1a1a] focus:text-white"
                            >
                              Select a client user
                            </SelectItem>
                            {clientRoleUsers.map((user) => {
                              const mapping = mappingByUserId.get(user.id);
                              const mappedClientName = mapping ? clientById.get(mapping.client_id) ?? "Unknown client" : null;
                              return (
                                <SelectItem
                                  key={user.id}
                                  value={user.id}
                                  className="text-white focus:bg-[#1a1a1a] focus:text-white"
                                >
                                  {`${user.first_name} ${user.last_name}`.trim()} · {user.email}
                                  {mappedClientName ? ` (mapped: ${mappedClientName})` : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </label>
                      <button
                        onClick={() => {
                          void assignClientUser();
                        }}
                        disabled={!mappingUserId || isSavingMapping}
                        className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSavingMapping ? "Applying..." : "Assign user"}
                      </button>
                    </div>

                    {selectedMapping && selectedMapping.client_id !== selectedClient.id && (
                      <Banner tone="warning">
                        Selected user is currently mapped to {selectedMappingClientName}. Saving will re-assign access.
                      </Banner>
                    )}

                    {selectedClientMappings.length === 0 ? (
                      <EmptyState title="No mapped users" description="Assign client users to grant portal access." />
                    ) : (
                      <div className="space-y-2">
                        {selectedClientMappings.map((mapping) => {
                          const user = users.find((item) => item.id === mapping.user_id);
                          return (
                            <div
                              key={mapping.id}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-black/20 px-4 py-3"
                            >
                              <div>
                                <p className="text-sm">{user ? `${user.first_name} ${user.last_name}`.trim() : mapping.user_id}</p>
                                <p className="text-xs text-muted-foreground">{user?.email ?? "Email unavailable"}</p>
                              </div>
                              <button
                                onClick={() => {
                                  void removeClientUserMapping(mapping.id);
                                }}
                                disabled={isSavingMapping}
                                className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Remove mapping
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
