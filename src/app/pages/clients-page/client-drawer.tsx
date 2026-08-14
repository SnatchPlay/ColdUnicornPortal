import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDeferredMount } from "../../lib/use-deferred-mount";
import { measureAfterRaf2 } from "../../lib/perf-mark";
import { Plus, X } from "lucide-react";
import { ArchiveButton } from "../../components/archive-controls";
import { Banner, EmptyState } from "../../components/app-ui";
import { SatisfactionHearts, satisfactionLabel } from "../../components/satisfaction-hearts";
import { OooRoutingEditor } from "./ooo-routing-editor";
import { SequencerConnections } from "./sequencer-connections";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { cn } from "../../components/ui/utils";
import type { evaluateClientConditions } from "../../lib/conditions/client-condition-results";
import { getCellCondition, getSeverityClassName } from "../../lib/conditions/evaluator";
import { formatDate, formatMoney } from "../../lib/format";
import { CLIENT_STATUSES } from "../../types/core";
import type { ClientRecord, ClientSequencerRecord, ClientUserRecord, SatisfactionLevel, UserRecord } from "../../types/core";

const CLIENT_USER_PLACEHOLDER = "__select_client_user__";
// Sentinel for the "no owner" choice — Radix <Select> forbids an empty-string item value.
const UNASSIGNED_MANAGER = "__unassigned__";

const LOST_REASON_STATUSES: ClientRecord["status"][] = ["Inactive", "Offboarding", "Subscription"];

export interface ClientDraft {
  name: string;
  status: ClientRecord["status"];
  satisfaction: SatisfactionLevel | null;
  minDailySent: number;
  inboxesCount: number;
  notificationEmails: string[];
  smsPhoneNumbers: string[];
  autoOooEnabled: boolean;
  setupInfo: string;
  managerId: string;
  // sequencer credentials (editable; saved to client_sequencers, not clients — ADR-0012)
  externalWorkspaceId: string;
  externalApiKey: string;
  linkedinApiKey: string;
  /** Aimfox workspace id. Editable so a `needs_selection` verdict can be answered from the UI. */
  aimfoxWorkspaceId: string;
  // prospects & setup
  prospectsSigned: number;
  prospectsAdded: number;
  // notes & lost reason
  notes: string;
  lostReason: string;
  // contract & KPIs (admin only)
  kpiLeads: string;
  kpiMeetings: string;
  contractedAmount: string;
  contractDueDate: string;
}

function normalizeStringList(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

interface StringListEditorProps {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  inputType?: "text" | "email" | "tel";
  emptyLabel: string;
  addLabel: string;
  removeLabel: string;
}

function StringListEditor({
  values,
  onChange,
  placeholder,
  inputType = "text",
  emptyLabel,
  addLabel,
  removeLabel,
}: StringListEditorProps) {
  const updateAt = (index: number, value: string) => {
    const next = values.slice();
    next[index] = value;
    onChange(next);
  };
  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };
  return (
    <div className="space-y-2">
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {values.map((value, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                type={inputType}
                value={value}
                onChange={(event) => updateAt(index, event.target.value)}
                placeholder={placeholder}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label={removeLabel}
                title={removeLabel}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/20 text-muted-foreground transition hover:border-red-400/40 hover:text-red-200"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-sky-400/40 hover:text-sky-100"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

/** Per-client sequencer credential rows relevant to the drawer (ADR-0012). */
export interface ClientSequencerCreds {
  emailbison: ClientSequencerRecord | null;
  aimfox: ClientSequencerRecord | null;
}

export const EMPTY_SEQUENCER_CREDS: ClientSequencerCreds = { emailbison: null, aimfox: null };

export function toClientDraft(client: ClientRecord, creds: ClientSequencerCreds): ClientDraft {
  return {
    name: client.name,
    status: client.status,
    satisfaction: client.satisfaction,
    minDailySent: client.min_daily_sent,
    inboxesCount: client.inboxes_count,
    notificationEmails: client.notification_emails ?? [],
    smsPhoneNumbers: client.sms_phone_numbers ?? [],
    autoOooEnabled: client.auto_ooo_enabled,
    setupInfo: client.setup_info ?? "",
    managerId: client.manager_id ?? "",
    externalWorkspaceId: creds.emailbison?.external_workspace_id ?? "",
    externalApiKey: creds.emailbison?.api_key ?? "",
    linkedinApiKey: creds.aimfox?.api_key ?? "",
    aimfoxWorkspaceId: creds.aimfox?.external_workspace_id ?? "",
    prospectsSigned: client.prospects_signed,
    prospectsAdded: client.prospects_added,
    notes: client.notes ?? "",
    lostReason: client.lost_reason ?? "",
    kpiLeads: client.kpi_leads != null ? String(client.kpi_leads) : "",
    kpiMeetings: client.kpi_meetings != null ? String(client.kpi_meetings) : "",
    contractedAmount: client.contracted_amount != null ? String(client.contracted_amount) : "",
    contractDueDate: client.contract_due_date ?? "",
  };
}

export function buildClientPatch(
  client: ClientRecord,
  draft: ClientDraft,
  canEditAssignments: boolean,
): Partial<ClientRecord> {
  const patch: Partial<ClientRecord> = {};

  if (client.name !== draft.name) patch.name = draft.name;
  if (client.status !== draft.status) patch.status = draft.status;
  if (client.satisfaction !== draft.satisfaction) patch.satisfaction = draft.satisfaction;
  if (client.min_daily_sent !== draft.minDailySent) patch.min_daily_sent = draft.minDailySent;
  if (client.inboxes_count !== draft.inboxesCount) patch.inboxes_count = draft.inboxesCount;

  const nextEmails = normalizeStringList(draft.notificationEmails);
  if (JSON.stringify(client.notification_emails ?? []) !== JSON.stringify(nextEmails)) {
    patch.notification_emails = nextEmails;
  }

  const nextSms = normalizeStringList(draft.smsPhoneNumbers);
  if (JSON.stringify(client.sms_phone_numbers ?? []) !== JSON.stringify(nextSms)) {
    patch.sms_phone_numbers = nextSms;
  }

  const trimmedSetup = draft.setupInfo.trim();
  if ((client.setup_info ?? "") !== draft.setupInfo) {
    patch.setup_info = trimmedSetup.length > 0 ? draft.setupInfo : null;
  }

  if (client.auto_ooo_enabled !== draft.autoOooEnabled) {
    patch.auto_ooo_enabled = draft.autoOooEnabled;
  }

  if (canEditAssignments && (client.manager_id ?? "") !== draft.managerId) {
    patch.manager_id = draft.managerId || null;
  }

  // prospects & setup flags
  // Sequencer credentials are persisted separately via client_sequencers (ADR-0012), not on the client patch.
  if (client.prospects_signed !== draft.prospectsSigned) patch.prospects_signed = draft.prospectsSigned;
  if (client.prospects_added !== draft.prospectsAdded) patch.prospects_added = draft.prospectsAdded;

  // notes & lost reason
  const nextNotes = draft.notes.trim() || null;
  if ((client.notes ?? null) !== nextNotes) patch.notes = nextNotes;
  const nextLostReason = draft.lostReason.trim() || null;
  if ((client.lost_reason ?? null) !== nextLostReason) patch.lost_reason = nextLostReason;

  // contract & KPIs (admin only)
  if (canEditAssignments) {
    const nextKpiLeads = draft.kpiLeads.trim() ? parseInt(draft.kpiLeads, 10) || null : null;
    if ((client.kpi_leads ?? null) !== nextKpiLeads) patch.kpi_leads = nextKpiLeads;
    const nextKpiMeetings = draft.kpiMeetings.trim() ? parseInt(draft.kpiMeetings, 10) || null : null;
    if ((client.kpi_meetings ?? null) !== nextKpiMeetings) patch.kpi_meetings = nextKpiMeetings;
    const nextAmount = draft.contractedAmount.trim() ? parseFloat(draft.contractedAmount) || null : null;
    if ((client.contracted_amount ?? null) !== nextAmount) patch.contracted_amount = nextAmount;
    const nextDue = draft.contractDueDate.trim() || null;
    if ((client.contract_due_date ?? null) !== nextDue) patch.contract_due_date = nextDue;
  }

  return patch;
}

/**
 * Diff the draft's credential fields against the current client_sequencers rows.
 * Returns one upsert per touched sequencer (ADR-0012: EmailBison holds workspace
 * id + API key; Aimfox holds the LinkedIn key).
 */
export function buildSequencerPatches(
  creds: ClientSequencerCreds,
  draft: ClientDraft,
): Array<{ sequencerKey: "emailbison" | "aimfox"; patch: { api_key?: string | null; external_workspace_id?: string | null } }> {
  const patches: Array<{ sequencerKey: "emailbison" | "aimfox"; patch: { api_key?: string | null; external_workspace_id?: string | null } }> = [];

  const emailbisonPatch: { api_key?: string | null; external_workspace_id?: string | null } = {};
  const nextWorkspaceId = draft.externalWorkspaceId.trim() || null;
  if ((creds.emailbison?.external_workspace_id ?? null) !== nextWorkspaceId) {
    emailbisonPatch.external_workspace_id = nextWorkspaceId;
  }
  const nextApiKey = draft.externalApiKey.trim() || null;
  if ((creds.emailbison?.api_key ?? null) !== nextApiKey) emailbisonPatch.api_key = nextApiKey;
  if (Object.keys(emailbisonPatch).length > 0) patches.push({ sequencerKey: "emailbison", patch: emailbisonPatch });

  const aimfoxPatch: { api_key?: string | null; external_workspace_id?: string | null } = {};
  const nextAimfoxKey = draft.linkedinApiKey.trim() || null;
  if ((creds.aimfox?.api_key ?? null) !== nextAimfoxKey) aimfoxPatch.api_key = nextAimfoxKey;
  const nextAimfoxWorkspace = draft.aimfoxWorkspaceId.trim() || null;
  if ((creds.aimfox?.external_workspace_id ?? null) !== nextAimfoxWorkspace) {
    aimfoxPatch.external_workspace_id = nextAimfoxWorkspace;
  }
  if (Object.keys(aimfoxPatch).length > 0) patches.push({ sequencerKey: "aimfox", patch: aimfoxPatch });

  return patches;
}

export interface ClientDrawerProps {
  client: ClientRecord;
  draft: ClientDraft;
  setDraft: (updater: (draft: ClientDraft | null) => ClientDraft | null) => void;
  conditionPack: ReturnType<typeof evaluateClientConditions> | null;
  managerName: string;
  managerUsers: UserRecord[];
  clientRoleUsers: UserRecord[];
  allClients: ClientRecord[];
  allUsers: UserRecord[];
  selectedClientMappings: ClientUserRecord[];
  allClientUsers: ClientUserRecord[];
  mappingUserId: string;
  setMappingUserId: (value: string) => void;
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  inviteMessage: { tone: "info" | "warning" | "danger"; text: string } | null;
  isSavingDraft: boolean;
  isSavingMapping: boolean;
  isSendingInvite: boolean;
  isDraftDirty: boolean;
  canEditAssignments: boolean;
  canInviteUsers: boolean;
  /** Archive/restore control visibility — false for the client role (RLS blocks it anyway). */
  canArchive: boolean;
  /** Called after a successful archive/restore: close the drawer and reload the page. */
  onArchived: () => void;
  /** The client's connector rows, already loaded by the page — carries setup_state (ADR-0018 §6). */
  sequencerCreds: ClientSequencerCreds;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
  onAssignClientUser: () => void;
  onRemoveClientUserMapping: (mappingId: string) => void;
  onInviteUser: () => void;
}

export function ClientDrawer({
  client,
  draft,
  setDraft,
  conditionPack,
  managerName,
  managerUsers,
  clientRoleUsers,
  allClients,
  allUsers,
  selectedClientMappings,
  allClientUsers,
  mappingUserId,
  setMappingUserId,
  inviteEmail,
  setInviteEmail,
  inviteMessage,
  isSavingDraft,
  isSavingMapping,
  isSendingInvite,
  isDraftDirty,
  canEditAssignments,
  canInviteUsers,
  canArchive,
  onArchived,
  sequencerCreds,
  onClose,
  onSave,
  onCancel,
  onAssignClientUser,
  onRemoveClientUserMapping,
  onInviteUser,
}: ClientDrawerProps) {
  const setupMinSentCondition = getCellCondition(conditionPack?.setupResults ?? [], "min_sent");

  const clientById = new Map(allClients.map((c) => [c.id, c.name] as const));
  const mappingByUserId = new Map(allClientUsers.map((m) => [m.user_id, m] as const));
  const selectedMapping = allClientUsers.find((m) => m.user_id === mappingUserId) ?? null;
  const selectedMappingClientName = selectedMapping
    ? clientById.get(selectedMapping.client_id) ?? "Unknown client"
    : null;

  // Two-phase mount: overlay + header + action buttons paint immediately;
  // the heavy form sections are deferred until after 2 rAFs.
  const bodyReady = useDeferredMount(true);

  // Shell timing: component mounts = overlay + header visible.
  useEffect(() => {
    measureAfterRaf2("client-drawer:click", "[perf][drawer] client shell click→raf2");
  }, []);

  // Content timing: deferred sections visible.
  useEffect(() => {
    if (!bodyReady) return;
    measureAfterRaf2("client-drawer:click", "[perf][drawer] client content deferred→raf2");
  }, [bodyReady]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${client.name} details`}
        className="flex h-full w-full max-w-[640px] flex-col border-l border-border bg-[#050505] text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
          <div className="space-y-1">
            <h2 className="text-xl text-foreground">{client.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5">
                {client.status}
              </span>
              <span>Manager: {managerName}</span>
              {client.contracted_amount != null && (
                <span>{formatMoney(client.contracted_amount)}</span>
              )}
              {client.contract_due_date && <span>Due {formatDate(client.contract_due_date)}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/15 p-2 text-white/50 transition hover:border-white/30 hover:text-white"
            aria-label="Close client details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onCancel}
              disabled={!isDraftDirty || isSavingDraft}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel changes
            </button>
            <button
              onClick={onSave}
              disabled={!isDraftDirty || isSavingDraft}
              className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingDraft ? "Saving..." : "Save changes"}
            </button>
            {canArchive ? (
              <div className="ml-auto">
                <ArchiveButton
                  entity="client"
                  id={client.id}
                  name={client.name}
                  archivedAt={client.archived_at}
                  onDone={onArchived}
                  disabled={isSavingDraft}
                />
              </div>
            ) : null}
          </div>

          {/* Phase 2: deferred sections — mount after overlay has painted */}
          {bodyReady ? (<>
          {/* Credentials and the provisioning verdict are one section, and first in the drawer:
              a key being present says nothing about whether the workspace is actually wired, so
              the two facts have to be read together. Keys and the run buttons sit behind a
              per-card disclosure — a CS manager needs "EmailBison is configured", not the key.
              `setup_state` is read-only here; it is written by n8n alone (ADR-0018 §6). */}
          <SequencerConnections
            clientId={client.id}
            creds={sequencerCreds}
            crmConnected={!!client.crm_config && Object.keys(client.crm_config).length > 0}
            externalWorkspaceId={draft.externalWorkspaceId}
            externalApiKey={draft.externalApiKey}
            linkedinApiKey={draft.linkedinApiKey}
            aimfoxWorkspaceId={draft.aimfoxWorkspaceId}
            onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
          />

          {/* Contract & KPIs — admin only */}
          {canEditAssignments && (
            <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="border-l-2 border-amber-400/50 pl-3">
                <p className="text-sm font-medium text-white">Contract & KPIs</p>
                <p className="text-xs text-white/50">
                  Admin-only. Contract parameters and monthly KPI targets.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    KPI leads / month
                  </span>
                  <input
                    type="number"
                    value={draft.kpiLeads}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, kpiLeads: event.target.value } : current,
                      )
                    }
                    placeholder="e.g. 10"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    KPI meetings / month
                  </span>
                  <input
                    type="number"
                    value={draft.kpiMeetings}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, kpiMeetings: event.target.value } : current,
                      )
                    }
                    placeholder="e.g. 3"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Contracted amount
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={draft.contractedAmount}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, contractedAmount: event.target.value } : current,
                      )
                    }
                    placeholder="e.g. 2500.00"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Contract due date
                  </span>
                  <input
                    type="date"
                    value={draft.contractDueDate}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, contractDueDate: event.target.value } : current,
                      )
                    }
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none [color-scheme:dark]"
                  />
                </label>
              </div>
            </section>
          )}

          {/* Editable client form */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="border-l-2 border-emerald-400/50 pl-3">
              <p className="text-sm font-medium text-white">Client configuration</p>
              <p className="text-xs text-white/50">Core settings used by campaign operations.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Client display name
                </span>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Client lifecycle status
                </span>
                <Select
                  value={draft.status}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      current ? { ...current, status: value as ClientRecord["status"] } : current,
                    )
                  }
                >
                  <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                    {CLIENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {/* Not a <label>: the hearts are a radiogroup of buttons, which a label must not wrap. */}
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Customer satisfaction
                </span>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <SatisfactionHearts
                    value={draft.satisfaction}
                    onChange={(next) => setDraft((current) => (current ? { ...current, satisfaction: next } : current))}
                  />
                  <span className="text-xs text-muted-foreground">{satisfactionLabel(draft.satisfaction)}</span>
                </div>
              </div>

              <label
                className={cn(
                  "space-y-2",
                  setupMinSentCondition ? "rounded-xl border p-3" : "",
                  setupMinSentCondition ? getSeverityClassName(setupMinSentCondition.severity) : "",
                )}
              >
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Minimum emails per day
                </span>
                <input
                  type="number"
                  value={draft.minDailySent}
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
                {setupMinSentCondition && (
                  <p className="text-xs text-muted-foreground">{setupMinSentCondition.message}</p>
                )}
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Active inbox count
                </span>
                <input
                  type="number"
                  value={draft.inboxesCount}
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

              {canEditAssignments && (
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Assigned manager
                  </span>
                  <Select
                    value={draft.managerId || UNASSIGNED_MANAGER}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        current
                          ? { ...current, managerId: value === UNASSIGNED_MANAGER ? "" : value }
                          : current,
                      )
                    }
                  >
                    <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                      <SelectItem
                        value={UNASSIGNED_MANAGER}
                        className="text-white focus:bg-[#1a1a1a] focus:text-white"
                      >
                        Unassigned
                      </SelectItem>
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

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Prospects signed
                </span>
                <input
                  type="number"
                  value={draft.prospectsSigned}
                  onChange={(event) =>
                    setDraft((current) => {
                      if (!current) return current;
                      const value = Number(event.target.value);
                      return { ...current, prospectsSigned: Number.isFinite(value) ? Math.max(0, value) : 0 };
                    })
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Prospects added
                </span>
                <input
                  type="number"
                  value={draft.prospectsAdded}
                  onChange={(event) =>
                    setDraft((current) => {
                      if (!current) return current;
                      const value = Number(event.target.value);
                      return { ...current, prospectsAdded: Number.isFinite(value) ? Math.max(0, value) : 0 };
                    })
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auto OOO</span>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm">{draft.autoOooEnabled ? "Enabled" : "Disabled"}</span>
                  <Checkbox
                    checked={draft.autoOooEnabled}
                    onCheckedChange={(checked) =>
                      setDraft((current) =>
                        current ? { ...current, autoOooEnabled: checked === true } : current,
                      )
                    }
                    className="h-4 w-4"
                  />
                </div>
              </label>

              {/* Routing rows live in `client_ooo_routing`, so this section saves independently of
                  the client draft above (BL-2 / ADR-0015). It is fed the PERSISTED
                  `client.auto_ooo_enabled`, not `draft.autoOooEnabled`: this section writes
                  immediately while the toggle above does not, so showing the draft value would let
                  it claim rules are inactive (or active) before the client row is saved. */}
              <OooRoutingEditor clientId={client.id} autoOooEnabled={client.auto_ooo_enabled} />

              {LOST_REASON_STATUSES.includes(draft.status) && (
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Lost reason
                  </span>
                  <textarea
                    rows={2}
                    value={draft.lostReason}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, lostReason: event.target.value } : current,
                      )
                    }
                    placeholder="Why did this client leave or go inactive?"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>
              )}

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Internal notes</span>
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, notes: event.target.value } : current))
                  }
                  placeholder="Internal notes visible only to CS team."
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup notes</span>
                <textarea
                  rows={4}
                  value={draft.setupInfo}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, setupInfo: event.target.value } : current))
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
              </label>
            </div>
          </section>

          {/* Contacts */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="border-l-2 border-white/25 pl-3">
              <p className="text-sm font-medium text-white">Contacts</p>
              <p className="text-xs text-white/50">
                Destinations n8n uses for email and SMS notifications.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Notification email recipients
                </span>
                <StringListEditor
                  values={draft.notificationEmails}
                  onChange={(next) =>
                    setDraft((current) => (current ? { ...current, notificationEmails: next } : current))
                  }
                  placeholder="name@company.com"
                  inputType="email"
                  emptyLabel="No email recipients yet."
                  addLabel="Add email"
                  removeLabel="Remove email"
                />
              </div>
              <div className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  SMS alert phone numbers
                </span>
                <StringListEditor
                  values={draft.smsPhoneNumbers}
                  onChange={(next) =>
                    setDraft((current) => (current ? { ...current, smsPhoneNumbers: next } : current))
                  }
                  placeholder="+1 555 123 4567"
                  inputType="tel"
                  emptyLabel="No phone numbers yet."
                  addLabel="Add phone number"
                  removeLabel="Remove phone number"
                />
              </div>
            </div>
          </section>

          {/* User access management */}
          <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="border-l-2 border-violet-400/50 pl-3">
              <p className="text-sm font-medium text-white">User access management</p>
              <p className="text-xs text-white/50">
                Invite client users and manage active client-user mappings in one place.
              </p>
            </div>

            {canInviteUsers && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div>
                  <p className="text-sm font-medium text-white">Invite a client portal user</p>
                  <p className="text-xs text-white/50">Invite target is fixed to {client.name}.</p>
                </div>
                {inviteMessage && <Banner tone={inviteMessage.tone}>{inviteMessage.text}</Banner>}
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1 space-y-2 sm:min-w-[16rem]">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      User email
                    </span>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="name@company.com"
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <button
                    onClick={onInviteUser}
                    disabled={isSendingInvite || !inviteEmail.trim()}
                    className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSendingInvite ? "Sending..." : "Send invitation"}
                  </button>
                </div>
              </div>
            )}

            {canEditAssignments && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div>
                  <p className="text-sm font-medium text-white">Active client-user mappings</p>
                  <p className="text-xs text-white/50">
                    Each client user can be linked to one client. Re-assignment moves access to this client.
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1 space-y-2 sm:min-w-[16rem]">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Client user account
                    </span>
                    <Select
                      value={mappingUserId || CLIENT_USER_PLACEHOLDER}
                      onValueChange={(value) =>
                        setMappingUserId(value === CLIENT_USER_PLACEHOLDER ? "" : value)
                      }
                    >
                      <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                        <SelectValue placeholder="Select a client user account" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                        <SelectItem
                          value={CLIENT_USER_PLACEHOLDER}
                          className="text-white focus:bg-[#1a1a1a] focus:text-white"
                        >
                          Select a client user account
                        </SelectItem>
                        {clientRoleUsers.map((user) => {
                          const mapping = mappingByUserId.get(user.id);
                          const mappedClientName = mapping
                            ? clientById.get(mapping.client_id) ?? "Unknown client"
                            : null;
                          return (
                            <SelectItem
                              key={user.id}
                              value={user.id}
                              className="text-white focus:bg-[#1a1a1a] focus:text-white"
                            >
                              {`${user.first_name} ${user.last_name}`.trim()} - {user.email}
                              {mappedClientName ? ` (mapped: ${mappedClientName})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </label>
                  <button
                    onClick={onAssignClientUser}
                    disabled={!mappingUserId || isSavingMapping}
                    className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingMapping ? "Applying..." : "Assign user"}
                  </button>
                </div>

                {selectedMapping && selectedMapping.client_id !== client.id && (
                  <Banner tone="warning">
                    Selected user is currently mapped to {selectedMappingClientName}. Saving will re-assign access.
                  </Banner>
                )}

                {selectedClientMappings.length === 0 ? (
                  <EmptyState title="No mapped users" description="Assign client users to grant portal access." />
                ) : (
                  <div className="space-y-2">
                    {selectedClientMappings.map((mapping) => {
                      const user = allUsers.find((item) => item.id === mapping.user_id);
                      return (
                        <div
                          key={mapping.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm">
                              {user ? `${user.first_name} ${user.last_name}`.trim() : mapping.user_id}
                            </p>
                            <p className="text-xs text-muted-foreground">{user?.email ?? "Email unavailable"}</p>
                          </div>
                          <button
                            onClick={() => onRemoveClientUserMapping(mapping.id)}
                            disabled={isSavingMapping}
                            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
          </section>
          </>) : (
            <div className="mt-2 space-y-4" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
