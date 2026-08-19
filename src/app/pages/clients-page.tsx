import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Banner, EmptyState, InlineLinkButton, LoadingState, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { LightweightSheet } from "../components/ui/lightweight-sheet";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../components/ui/utils";
import { repository, RepositoryError } from "../data/repository";
import { logAfterRaf2, markInteractionStart, markPoint, measureAfterRaf2, measureBetween, timeSyncOp } from "../lib/perf-mark";
import {
  createClientMetricsFromSummary,
  projectMetricsToChannel,
  type ClientMetricsPack,
} from "../lib/client-metrics";
import { DevProfiler, useDevRenderCount } from "../lib/react-profiler-dev";
import { isInternalAdmin, scopeClients } from "../lib/selectors";
import { ShowArchivedToggle } from "../components/archive-controls";
import { buildClientConditionContext } from "../lib/conditions/client-condition-context";
import { evaluateClientConditions } from "../lib/conditions/client-condition-results";
import { toConditionRule } from "../lib/conditions/mapper";
import { useAuth } from "../providers/auth";
import { CLIENT_STATUSES } from "../types/core";
import type {
  ClientCustomFieldRecord,
  ClientRecord,
  ClientSequencerRecord,
  ClientStatus,
  InviteRequest,
  SatisfactionLevel,
} from "../types/core";
import type { SequencerCredentialInput } from "../data/orm-gateway-contract";
import { getCustomFieldSortValue } from "../lib/custom-field-sort";
import type { ClientMetricsSummary, ClientsMetricsFullPayload, UserLite } from "../types/view-contracts";
import {
  ClientDrawer,
  buildClientPatch,
  buildSequencerPatches,
  EMPTY_SEQUENCER_CREDS,
  toClientDraft,
  type ClientDraft,
  type ClientSequencerCreds,
} from "./clients-page/client-drawer";
import {
  ClientsMegaTable,
  CHANNEL_VIEWS,
  MEGA_COLUMNS,
  isColumnInChannelView,
  statusBadgeClass,
  type ChannelView,
  type ClientMegaRow,
  type MegaSortState,
} from "./clients-page/mega-table";
import { createSelectionStore } from "./clients-page/selection-store";
import {
  SEQUENCER_TITLES,
  WorkspacePicker,
  type SequencerKey,
  type WorkspaceChoice,
} from "./clients-page/workspace-picker";
import { useTablePreferences } from "../lib/use-table-preferences";

const PAGE_SIZE = 50;

/** Fallback sort: the Client column, A→Z. Also where the channel switch lands a stale sort key. */
const DEFAULT_MEGA_SORT: MegaSortState = { key: "name", direction: "asc" };

// The channel switch reads Email / LinkedIn but stores the vendor keys the projection is built on
// (`ChannelView`) — renaming those would invalidate every saved layout for a label change.
const CHANNEL_VIEW_CHIPS: Array<{ value: ChannelView; label: string; ariaLabel: string }> = [
  { value: "both", label: "Both", ariaLabel: "Both channels, combined and side by side" },
  { value: "email", label: "Email", ariaLabel: "Email numbers only" },
  { value: "aimfox", label: "LinkedIn", ariaLabel: "LinkedIn numbers only" },
];

// Radix <Select> forbids an empty-string item value, so the "no owner" choice needs a sentinel.
// It maps to `manager_id = null` on submit.
const UNASSIGNED_MANAGER = "__unassigned__";

/** Row key in `user_table_preferences` for this grid. */
const CLIENTS_TABLE_PREFS_KEY = "clients:mega";

/**
 * The caller's saved layout. Every field is optional and re-validated on read: a stale key
 * (a column that no longer exists, a status that was renamed) must be ignored, never trusted.
 */
interface ClientsTablePreferences extends Record<string, unknown> {
  /** Column width in px, keyed by column id. */
  widths: Record<string, number>;
  statusFilter: string[];
  // Layouts saved before 2026-08-14 also carry `satisfactionFilter` / `managerFilter` from the two
  // filters that were removed. Nothing reads them; `update()` shallow-merges, so they are carried
  // along on every save until the row is rewritten. Harmless — but never reuse those key names.
  /**
   * Clients-tab channel view switch: "both" | "email" | "aimfox". The stored values keep the
   * vendor names even though the switch now reads Both / Email / LinkedIn — renaming them would
   * invalidate every saved layout for a label change.
   */
  channelView: ChannelView;
  sort: MegaSortState;
}

interface CreateClientDraft {
  name: string;
  managerId: string;
  status: ClientStatus | "";
  // Saved to client_sequencers, not clients (ADR-0012). Chosen from the vendor's own list, never
  // typed: API keys and workspace ids are what provisioning exists to obtain.
  workspaces: { emailbison: WorkspaceChoice | null; aimfox: WorkspaceChoice | null };
  kpiLeads: number | null;
  kpiMeetings: number | null;
  contractedAmount: number | null;
  contractDueDate: string;
}


function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface CustomSortContext {
  fields: ReadonlyMap<string, ClientCustomFieldRecord>;
  valuesByClient: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
}

function compareMega(
  left: ClientMegaRow,
  right: ClientMegaRow,
  sort: MegaSortState,
  customCtx?: CustomSortContext,
): number {
  let a: string | number | null;
  let b: string | number | null;
  // Custom columns ("cf:<id>") aren't in the static MEGA_COLUMNS list, so resolve
  // their sort value from the field definition + stored values here. Without this
  // branch sorting a custom column was a no-op (the 3G "nothing happens" bug).
  if (sort.key.startsWith("cf:") && customCtx) {
    const fieldId = sort.key.slice(3);
    const field = customCtx.fields.get(fieldId);
    if (!field) return 0;
    a = getCustomFieldSortValue(field, customCtx.valuesByClient.get(left.client.id)?.get(fieldId) ?? null);
    b = getCustomFieldSortValue(field, customCtx.valuesByClient.get(right.client.id)?.get(fieldId) ?? null);
  } else {
    const col = MEGA_COLUMNS.find((c) => c.id === sort.key);
    if (!col || !col.sortValue) return 0;
    a = col.sortValue(left);
    b = col.sortValue(right);
  }
  const dir = sort.direction === "asc" ? 1 : -1;
  // Empty/null always sorts last, regardless of direction.
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * dir;
}

function mapClientsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return `Loading timed out. A database performance issue may be affecting this view.`;
    if (reason.kind === "permission") return `Access to client data is blocked by your current permissions.`;
    if (reason.kind === "network") return `Client data could not be loaded due to a network error. Try again.`;
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load client data.";
}

// Skip the 2-rAF deferral in tests so stats load synchronously alongside the shell.
const IS_TEST = typeof process !== "undefined" && process.env.NODE_ENV === "test";

// ── Per-page data hook ─────────────────────────────────────────────────────────────────────────
// Phase 5B/5C split: shell (~85 KB) loads first, compact metrics summary (~35–70 KB) loads after
// first paint. Replaces the raw ~1.4 MB loadClientsStats transfer with pre-bucketed per-client
// aggregate facts. createClientMetricsFromSummary converts facts → ClientMetricsPack on the
// frontend without iterating over thousands of raw rows.

const EMPTY_METRICS_SUMMARY: ClientMetricsSummary = {
  client_id: "",
  daily_sent:          [0, 0, 0, 0, 0],
  schedule_today:      0,
  schedule_tomorrow:   0,
  schedule_day_after:  0,
  wow_sent:            [0, 0, 0, 0, 0],
  wow_human:           [0, 0, 0, 0, 0],
  wow_bounce:          [0, 0, 0, 0, 0],
  wow_ooo:             [0, 0, 0, 0, 0],
  wow_negative:        [0, 0, 0, 0, 0],
  wow_leads:           [0, 0, 0, 0, 0],
  wow_sql:             [0, 0, 0, 0, 0],
  mom_total:           [0, 0, 0, 0, 0],
  mom_sql:             [0, 0, 0, 0, 0],
  mom_meetings:        [0, 0, 0, 0, 0],
  mom_won:             [0, 0, 0, 0, 0],
  threedod_total:      [0, 0, 0, 0, 0],
  threedod_sql:        [0, 0, 0, 0, 0],
  latest_prospects_count: 0,
  threedod_total_eb:   [0, 0, 0, 0, 0],
  threedod_total_af:   [0, 0, 0, 0, 0],
  threedod_sql_eb:     [0, 0, 0, 0, 0],
  threedod_sql_af:     [0, 0, 0, 0, 0],
  wow_leads_eb:        [0, 0, 0, 0, 0],
  wow_leads_af:        [0, 0, 0, 0, 0],
  wow_sql_eb:          [0, 0, 0, 0, 0],
  wow_sql_af:          [0, 0, 0, 0, 0],
  mom_total_eb:        [0, 0, 0, 0, 0],
  mom_total_af:        [0, 0, 0, 0, 0],
  mom_sql_eb:          [0, 0, 0, 0, 0],
  mom_sql_af:          [0, 0, 0, 0, 0],
  mom_meetings_eb:     [0, 0, 0, 0, 0],
  mom_meetings_af:     [0, 0, 0, 0, 0],
  mom_won_eb:          [0, 0, 0, 0, 0],
  mom_won_af:          [0, 0, 0, 0, 0],
  aimfox_daily_sent:   [0, 0, 0, 0, 0],
  aimfox_schedule_today:     0,
  aimfox_schedule_tomorrow:  0,
  aimfox_schedule_day_after: 0,
  aimfox_invite_limit: null,
  aimfox_invite_limit_remaining: null,
  aimfox_remaining_database_size: null,
  aimfox_active_campaigns: 0,
  aimfox_active_audience: 0,
  aimfox_active_invites_sent: null,
  aimfox_active_invites_accepted: null,
  aimfox_active_with_messages: 0,
  aimfox_active_measured: 0,
};

function useClientsOverview() {
  const { identity, loading: authLoading } = useAuth();
  // Full payload — shell fields are always populated; metricsSummaries starts empty and merges
  // in after first paint (Phase 5C deferred load).
  const [data, setData] = useState<ClientsMetricsFullPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deduplication: prevent concurrent in-flight requests for the same phase.
  const shellInFlightRef = useRef(false);
  const statsInFlightRef = useRef(false);

  // Archived clients are hidden by default (migration 20260813). The flag is mirrored into a ref so
  // `load` keeps a stable identity — the mount effect depends on it, and putting the flag in its
  // deps would turn every unrelated re-render of the toggle into a page refetch.
  const [showArchived, setShowArchivedState] = useState(false);
  const showArchivedRef = useRef(false);

  const loadStats = useCallback(async () => {
    if (statsInFlightRef.current) return;
    statsInFlightRef.current = true;
    setStatsLoading(true);
    markPoint("clients:stats:fetch:start");
    try {
      const result = await repository.loadClientsMetricsSummary();
      markPoint("clients:stats:fetch:end");
      measureBetween("clients:stats:fetch:start", "clients:stats:fetch:end", "[perf][clients] metrics summary fetch round-trip");
      if (import.meta.env.DEV) {
        const sizeOf = (v: unknown) => { try { return JSON.stringify(v).length; } catch { return 0; } };
        console.log(`[perf][clients] metrics summary payload bytes: ${(sizeOf(result.summaries) / 1024).toFixed(1)} KB (${result._meta.clientsCount} clients)`);
      }
      setData((prev) => (prev ? { ...prev, metricsSummaries: result.summaries } : null));
      setStatsLoaded(true);
      markPoint("clients:stats:state:set");
    } catch (reason) {
      // Stats failure is non-fatal: table renders without metrics, conditions, or DoD columns.
      console.warn("[clients] metrics summary load failed — metrics will be unavailable:", mapClientsError(reason));
    } finally {
      statsInFlightRef.current = false;
      setStatsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (shellInFlightRef.current) return;
    shellInFlightRef.current = true;
    setLoading(true);
    setStatsLoaded(false);
    markPoint("clients:fetch:start");
    try {
      const shellResult = await repository.loadClientsOverview({ includeArchived: showArchivedRef.current });
      markPoint("clients:fetch:end");
      measureBetween("clients:fetch:start", "clients:fetch:end", "[perf][clients] shell fetch round-trip");
      // Merge shell with existing summaries (or empty on first load) so the table
      // keeps showing the last-known metrics during a manual refresh.
      setData((prev) => ({
        ...shellResult,
        metricsSummaries: prev?.metricsSummaries ?? [],
      }));
      markPoint("clients:state:set");
      setError(null);
      // Log when the shell has rendered (2 rAFs after setData).
      measureAfterRaf2("clients:fetch:start", "[perf][clients] first shell render ready");
      // Defer stats load until after the shell paints so the main thread is free
      // for layout/paint before receiving the ~1.4 MB stats payload.
      if (IS_TEST) {
        void loadStats();
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => void loadStats()));
      }
    } catch (reason) {
      setError(mapClientsError(reason));
    } finally {
      shellInFlightRef.current = false;
      setLoading(false);
    }
  }, [loadStats]);

  useEffect(() => {
    if (authLoading || !identity) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, identity, load]);

  // ── Mutations with optimistic update / rollback ──────────────────────────────────────────────

  const createClient = useCallback(
    async (
      input: Omit<ClientRecord, "id" | "created_at" | "updated_at">,
      sequencerCredentials?: SequencerCredentialInput[],
    ) => {
      try {
        const created = await repository.createClient(input, sequencerCredentials);
        setData((prev) => {
          if (!prev) return prev;
          return { ...prev, clients: [created, ...prev.clients] };
        });
        // Server also created client_sequencers rows — refresh the shell to pull them
        // (rare op; keeps drawer credentials in sync without hand-building rows).
        if (sequencerCredentials?.length) void load();
        // Returned, not swallowed: the create sheet provisions the chosen workspace straight after,
        // and that call needs the id this is the only place to learn it from.
        return created;
      } catch (reason) {
        const msg = mapClientsError(reason);
        toast.error(msg);
        throw reason;
      }
    },
    [load],
  );

  const upsertClientSequencer = useCallback(
    async (clientId: string, sequencerKey: string, patch: Omit<SequencerCredentialInput, "sequencer_key">) => {
      try {
        const updated = await repository.upsertClientSequencer(clientId, sequencerKey, patch);
        setData((prev) => {
          if (!prev) return prev;
          const idx = prev.clientSequencers.findIndex((row) => row.id === updated.id);
          const clientSequencers =
            idx >= 0
              ? prev.clientSequencers.map((row, i) =>
                  i === idx
                    ? // Keep the provisioning status we already had. The upsert statement does not
                      // touch setup_state/setup_checked_at and does not return them, so taking the
                      // response wholesale would blank the status in the UI while the database
                      // still holds it — a saved API key would make the client look "never checked".
                      { ...updated, setup_state: row.setup_state, setup_checked_at: row.setup_checked_at }
                    : row,
                )
              : [...prev.clientSequencers, updated];
          return { ...prev, clientSequencers };
        });
        return updated;
      } catch (reason) {
        const msg = mapClientsError(reason);
        toast.error(msg);
        throw reason;
      }
    },
    [],
  );

  const updateClient = useCallback(
    async (clientId: string, patch: Partial<ClientRecord>) => {
      // Optimistic update first.
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, clients: prev.clients.map((c) => (c.id === clientId ? { ...c, ...patch } : c)) };
      });
      try {
        const updated = await repository.updateClient(clientId, patch);
        // Apply server-confirmed row (has server-generated updated_at etc.).
        setData((prev) => {
          if (!prev) return prev;
          return { ...prev, clients: prev.clients.map((c) => (c.id === clientId ? updated : c)) };
        });
      } catch (reason) {
        // Roll back optimistic update via re-fetch.
        void load();
        const msg = mapClientsError(reason);
        toast.error(msg);
        throw reason;
      }
    },
    [load],
  );

  const sendInvite = useCallback(async (payload: InviteRequest) => {
    try {
      await repository.sendInvite(payload);
    } catch (reason) {
      const msg = mapClientsError(reason);
      toast.error(msg);
      throw reason;
    }
  }, []);

  const upsertClientUserMapping = useCallback(
    async (userId: string, clientId: string) => {
      try {
        const mapping = await repository.upsertClientUserMapping(userId, clientId);
        setData((prev) => {
          if (!prev) return prev;
          const existing = prev.clientUsers.findIndex((m) => m.user_id === userId);
          const lite = { id: mapping.id, client_id: mapping.client_id, user_id: mapping.user_id };
          const updated =
            existing >= 0
              ? prev.clientUsers.map((m, i) => (i === existing ? lite : m))
              : [...prev.clientUsers, lite];
          return { ...prev, clientUsers: updated };
        });
      } catch (reason) {
        const msg = mapClientsError(reason);
        toast.error(msg);
        throw reason;
      }
    },
    [],
  );

  const deleteClientUserMapping = useCallback(async (mappingId: string) => {
    try {
      await repository.deleteClientUserMapping(mappingId);
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, clientUsers: prev.clientUsers.filter((m) => m.id !== mappingId) };
      });
    } catch (reason) {
      const msg = mapClientsError(reason);
      toast.error(msg);
      throw reason;
    }
  }, []);

  const upsertClientCustomFieldValue = useCallback(
    async (clientId: string, fieldId: string, value: string | null) => {
      try {
        const updated = await repository.upsertClientCustomFieldValue(clientId, fieldId, value);
        setData((prev) => {
          if (!prev) return prev;
          const idx = prev.clientCustomFieldValues.findIndex(
            (v) => v.client_id === clientId && v.field_id === fieldId,
          );
          const lite = {
            client_id: updated.client_id,
            field_id: updated.field_id,
            value: updated.value,
            updated_at: updated.updated_at,
            updated_by: updated.updated_by,
          };
          const updated2 =
            idx >= 0
              ? prev.clientCustomFieldValues.map((v, i) => (i === idx ? lite : v))
              : [...prev.clientCustomFieldValues, lite];
          return { ...prev, clientCustomFieldValues: updated2 };
        });
      } catch (reason) {
        const msg = mapClientsError(reason);
        toast.error(msg);
        throw reason;
      }
    },
    [],
  );

  const setShowArchived = useCallback((next: boolean) => {
    showArchivedRef.current = next;
    setShowArchivedState(next);
    void load();
  }, [load]);

  return {
    data,
    loading,
    statsLoaded,
    statsLoading,
    error,
    showArchived,
    setShowArchived,
    refresh: load,
    createClient,
    updateClient,
    upsertClientSequencer,
    sendInvite,
    upsertClientUserMapping,
    deleteClientUserMapping,
    upsertClientCustomFieldValue,
  };
}

// ── CreateClientSheet — memoized so typing in the form does not re-render the mega-table ────────

interface CreateClientSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  managerUsers: UserLite[];
  canEditAssignments: boolean;
  onCreateClient: (
    input: Omit<ClientRecord, "id" | "created_at" | "updated_at">,
    sequencerCredentials?: SequencerCredentialInput[],
  ) => Promise<ClientRecord>;
  /** Pull the page again once provisioning has written setup_state for the new client. */
  onRefresh: () => void;
  defaultManagerId: string;
}

const CreateClientSheet = memo(function CreateClientSheet({
  open,
  onOpenChange,
  managerUsers,
  canEditAssignments,
  onCreateClient,
  onRefresh,
  defaultManagerId,
}: CreateClientSheetProps) {
  useDevRenderCount("CreateClientSheet", () => `open=${open}`);
  const [draft, setDraft] = useState<CreateClientDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shell timing: measure from "new-client-sheet:click" mark on false→true transition.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      measureAfterRaf2("new-client-sheet:click", "[perf][sheet] new-client shell click→raf2");
      logAfterRaf2("[perf][sheet] lightweight-new-client open state→raf2");
    }
    prevOpenRef.current = open;
  }, [open]);

  // Seed draft on open; clear on close.
  useEffect(() => {
    if (open) {
      setDraft({
        name: "",
        managerId: defaultManagerId,
        status: "Active",
        workspaces: { emailbison: null, aimfox: null },
        kpiLeads: null,
        kpiMeetings: null,
        contractedAmount: null,
        contractDueDate: "",
      });
    } else {
      setDraft(null);
      setIsSubmitting(false);
    }
  }, [open, defaultManagerId]);

  async function handleSubmit() {
    // Manager is optional — only name and status are required.
    if (!draft || !draft.name.trim() || !draft.status) return;
    setIsSubmitting(true);
    try {
      // Sequencer credentials become client_sequencers rows server-side (ADR-0012). A client with
      // no row at all is a legitimate starting state — `Resolve Client` left-joins the connector in
      // both workflows precisely so provisioning can run before one exists.
      const chosen = (["emailbison", "aimfox"] as const)
        .map((key) => ({ key, choice: draft.workspaces[key] }))
        .filter((entry): entry is { key: SequencerKey; choice: WorkspaceChoice } => entry.choice !== null);
      const sequencerCredentials: SequencerCredentialInput[] = chosen.map(({ key, choice }) => ({
        sequencer_key: key,
        api_key: null,
        external_workspace_id: choice.workspace_id,
      }));
      const created = await onCreateClient(
        {
          name: draft.name.trim(),
          manager_id: draft.managerId || null,
          status: draft.status as ClientStatus,
          kpi_leads: draft.kpiLeads,
          kpi_meetings: draft.kpiMeetings,
          contracted_amount: draft.contractedAmount,
          contract_due_date: draft.contractDueDate || null,
          min_daily_sent: 0,
          inboxes_count: 0,
          crm_config: null,
          sms_phone_numbers: null,
          notification_emails: null,
          auto_ooo_enabled: false,
          prospects_signed: 0,
          prospects_added: 0,
          setup_info: null,
          bi_setup_done: false,
          lost_reason: null,
          notes: null,
        },
        sequencerCredentials.length > 0 ? sequencerCredentials : undefined,
      );

      // Provision each chosen workspace for real. This is the point of choosing one here: the
      // manager should not have to open the client afterwards to finish the job. Sequential rather
      // than parallel — each run is up to eight vendor calls behind one 45s gateway budget, and two
      // at once is how you collect a pair of `unknown`s instead of one answer.
      for (const { key, choice } of chosen) {
        try {
          const result = await repository.requestWorkspaceSetup({
            clientId: created.id,
            sequencerKey: key,
            workspaceId: choice.workspace_id,
            dryRun: false,
          });
          if (result.state === "configured") {
            toast.success(`${SEQUENCER_TITLES[key]}: configured`);
          } else {
            // Never a silent partial. The client exists either way, so say what is left undone
            // rather than let a green "created" imply the workspace is ready.
            toast.warning(`${SEQUENCER_TITLES[key]}: ${result.state.replace(/_/g, " ")}`);
          }
        } catch (reason) {
          // The client was created; only provisioning failed. Say exactly that — the operator's
          // next move is the Set up button in the drawer, not creating the client again.
          toast.error(
            `${SEQUENCER_TITLES[key]}: ${reason instanceof Error ? reason.message : "provisioning failed"}. ` +
              `The client was created — run Set up from its card.`,
          );
        }
      }
      if (chosen.length) onRefresh();
      onOpenChange(false);
    } catch {
      // error shown via toast from useClientsOverview
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <LightweightSheet
      open={open}
      onOpenChange={onOpenChange}
      title={<span className="text-white">New client</span>}
      description="Fill in the required fields to create a new client account."
      className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md"
    >
        {draft && (
          <div className="space-y-4 px-6 pb-6">
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name *</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                placeholder="Client name"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
              />
            </label>
            {canEditAssignments && (
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager</span>
                <Select
                  value={draft.managerId || UNASSIGNED_MANAGER}
                  onValueChange={(v) =>
                    setDraft((d) => (d ? { ...d, managerId: v === UNASSIGNED_MANAGER ? "" : v } : d))
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
                    {managerUsers.map((m) => (
                      <SelectItem
                        key={m.id}
                        value={m.id}
                        className="text-white focus:bg-[#1a1a1a] focus:text-white"
                      >
                        {m.first_name} {m.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status *</span>
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft((d) => (d ? { ...d, status: v as ClientStatus } : d))}
              >
                <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {/* No keys and no id to type. Provisioning obtains both; all a human has that it
                cannot derive is which of the vendor's workspaces is this client, and only when the
                names differ — an exact-name match held for 4 of 9 clients when measured. */}
            <WorkspacePicker
              sequencerKey="emailbison"
              chosen={draft.workspaces.emailbison}
              onChoose={(choice) =>
                setDraft((d) => (d ? { ...d, workspaces: { ...d.workspaces, emailbison: choice } } : d))
              }
            />
            <WorkspacePicker
              sequencerKey="aimfox"
              chosen={draft.workspaces.aimfox}
              onChoose={(choice) =>
                setDraft((d) => (d ? { ...d, workspaces: { ...d.workspaces, aimfox: choice } } : d))
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">KPI leads</span>
                <input
                  type="number"
                  value={draft.kpiLeads ?? ""}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, kpiLeads: e.target.value === "" ? null : Number(e.target.value) } : d,
                    )
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">KPI meetings</span>
                <input
                  type="number"
                  value={draft.kpiMeetings ?? ""}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, kpiMeetings: e.target.value === "" ? null : Number(e.target.value) } : d,
                    )
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contracted amount</span>
                <input
                  type="number"
                  value={draft.contractedAmount ?? ""}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, contractedAmount: e.target.value === "" ? null : Number(e.target.value) } : d,
                    )
                  }
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contract due date</span>
                <input
                  type="date"
                  value={draft.contractDueDate}
                  onChange={(e) => setDraft((d) => (d ? { ...d, contractDueDate: e.target.value } : d))}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                />
              </label>
            </div>
            <button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting || !draft.name.trim() || !draft.status}
              className="w-full rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create client"}
            </button>
          </div>
        )}
    </LightweightSheet>
  );
});

// ── CreateClientSheetHost ─────────────────────────────────────────────────────────────────────
// Owns the "is sheet open" boolean so that toggling the sheet does NOT cause ClientsPage (or
// ClientsMegaTable) to re-render. Receives only stable props from ClientsPage.

interface CreateClientSheetHostProps {
  managerUsers: UserLite[];
  canEditAssignments: boolean;
  onCreateClient: (
    input: Omit<ClientRecord, "id" | "created_at" | "updated_at">,
    sequencerCredentials?: SequencerCredentialInput[],
  ) => Promise<ClientRecord>;
  /** Pull the page again once provisioning has written setup_state for the new client. */
  onRefresh: () => void;
  defaultManagerId: string;
}

const CreateClientSheetHost = memo(function CreateClientSheetHost({
  managerUsers,
  canEditAssignments,
  onCreateClient,
  onRefresh,
  defaultManagerId,
}: CreateClientSheetHostProps) {
  useDevRenderCount("CreateClientSheetHost");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => {
          markInteractionStart("new-client-sheet:click");
          setIsOpen(true);
        }}
        className="rounded-full border border-sky-400/30 bg-[#050e18] px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20"
      >
        New client
      </button>
      <DevProfiler id="CreateClientSheet">
        <CreateClientSheet
          open={isOpen}
          onOpenChange={setIsOpen}
          managerUsers={managerUsers}
          canEditAssignments={canEditAssignments}
          onCreateClient={onCreateClient}
          onRefresh={onRefresh}
          defaultManagerId={defaultManagerId}
        />
      </DevProfiler>
    </>
  );
});

// ── Main page ──────────────────────────────────────────────────────────────────────────────────

export function ClientsPage() {
  useDevRenderCount("ClientsPage");
  const { identity } = useAuth();
  const {
    data,
    loading,
    statsLoaded,
    statsLoading,
    error,
    showArchived,
    setShowArchived,
    refresh,
    createClient,
    updateClient,
    upsertClientSequencer,
    sendInvite,
    upsertClientUserMapping,
    deleteClientUserMapping,
    upsertClientCustomFieldValue,
  } = useClientsOverview();

  // Stable derived arrays — memoized on data so downstream memos see stable references.
  const clients = useMemo(() => data?.clients ?? [], [data]);
  const users = useMemo(
    () => (data?.usersLite ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; email: string; role: string }>,
    [data],
  );
  const clientUsers = useMemo(() => data?.clientUsers ?? [], [data]);
  const conditionRules = useMemo(() => data?.conditionRules ?? [], [data]);
  const columnOverrides = useMemo(() => data?.columnOverrides ?? [], [data]);
  const clientCustomFields = useMemo(() => data?.clientCustomFields ?? [], [data]);
  const clientCustomFieldValues = useMemo(() => data?.clientCustomFieldValues ?? [], [data]);
  const sequencers = useMemo(() => data?.sequencers ?? [], [data]);
  const clientSequencers = useMemo(() => data?.clientSequencers ?? [], [data]);

  // Per-client sequencer credential rows keyed by catalog key (ADR-0012).
  const credsByClientId = useMemo<ReadonlyMap<string, ClientSequencerCreds>>(() => {
    const keyBySequencerId = new Map(sequencers.map((s) => [s.id, s.key] as const));
    const out = new Map<string, ClientSequencerCreds>();
    for (const row of clientSequencers) {
      const key = keyBySequencerId.get(row.sequencer_id);
      if (key !== "emailbison" && key !== "aimfox") continue;
      const creds = out.get(row.client_id) ?? { ...EMPTY_SEQUENCER_CREDS };
      creds[key] = row as ClientSequencerRecord;
      out.set(row.client_id, creds);
    }
    return out;
  }, [sequencers, clientSequencers]);

  // ── Derived per-client metrics (Phase 5C: summary path) ──────────────────────────────────────

  const metricsByClientId = useMemo<ReadonlyMap<string, ClientMetricsPack>>(() => {
    // Skip until summaries arrive — running against empty data would produce false danger states
    // in condition evaluation (e.g. "no emails sent today" when stats just haven't loaded yet).
    if (!data || !statsLoaded) return new Map();
    return timeSyncOp(`[perf][clients] metrics-derivation (${data.clients.length} clients)`, () => {
      const summaryByClientId = new Map(data.metricsSummaries.map((s) => [s.client_id, s]));
      const result = new Map<string, ClientMetricsPack>();
      for (const client of data.clients) {
        const summary = summaryByClientId.get(client.id) ?? EMPTY_METRICS_SUMMARY;
        result.set(client.id, createClientMetricsFromSummary(summary));
      }
      return result;
    });
  }, [data, statsLoaded]);

  const customFieldValuesByClient = useMemo(() => {
    const out = new Map<string, Map<string, string | null>>();
    for (const value of clientCustomFieldValues) {
      let inner = out.get(value.client_id);
      if (!inner) {
        inner = new Map();
        out.set(value.client_id, inner);
      }
      inner.set(value.field_id, value.value);
    }
    return out;
  }, [clientCustomFieldValues]);

  const canEditCustomField = useMemo(() => {
    const role = identity?.role;
    if (!role) return (_fieldId: string) => false;
    const fieldMap = new Map(clientCustomFields.map((f) => [f.id, f]));
    return (fieldId: string) => {
      const field = fieldMap.get(fieldId);
      return field ? (field.editable_by ?? ["master_admin"]).includes(role) : false;
    };
  }, [identity?.role, clientCustomFields]);

  // Stable callback for onCustomFieldValueChange — must be stable so ClientsMegaTable.memo
  // does not see a new function reference on every ClientsPage render.
  const handleCustomFieldValueChange = useCallback(
    (clientId: string, fieldId: string, value: string | null) => {
      void upsertClientCustomFieldValue(clientId, fieldId, value);
    },
    [upsertClientCustomFieldValue],
  );

  // Stable callback for onNotesChange — same memoization requirement as above.
  const handleNotesChange = useCallback(
    (clientId: string, value: string | null) => {
      void updateClient(clientId, { notes: value });
    },
    [updateClient],
  );

  // Stable callback for inline status edits from the grid's Status column.
  const handleStatusChange = useCallback(
    (clientId: string, status: ClientStatus) => {
      void updateClient(clientId, { status });
    },
    [updateClient],
  );

  // Inline satisfaction rating from the grid's Client column. Same optimistic-update/rollback path
  // as Status and Notes — `updateClient` patches local state, then re-fetches on error.
  const handleSatisfactionChange = useCallback(
    (clientId: string, next: SatisfactionLevel | null) => {
      void updateClient(clientId, { satisfaction: next });
    },
    [updateClient],
  );

  // ── Drawer / selection state ──────────────────────────────────────────────────────────────────

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [mappingUserId, setMappingUserId] = useState("");
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const [nameSearch, setNameSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["Active"]));
  const [channelView, setChannelView] = useState<ChannelView>("both");
  const [sort, setSort] = useState<MegaSortState>(DEFAULT_MEGA_SORT);

  // Per-user layout: column widths, filters and sort, stored in Postgres so the grid looks
  // the same on any browser. The name search is deliberately *not* persisted — a stale
  // search term silently hiding most of the table on next login is a trap, not a feature.
  const { preferences: tablePrefs, loaded: prefsLoaded, update: updateTablePrefs } =
    useTablePreferences<ClientsTablePreferences>(CLIENTS_TABLE_PREFS_KEY);

  // Apply the stored layout once, when it lands. `prefsLoaded` flips exactly once per mount,
  // so this cannot fight the user's later clicks.
  const prefsAppliedRef = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || prefsAppliedRef.current) return;
    prefsAppliedRef.current = true;

    if (Array.isArray(tablePrefs.statusFilter)) {
      const valid = tablePrefs.statusFilter.filter((s): s is string => CLIENT_STATUSES.includes(s as never));
      setStatusFilter(new Set(valid));
    }
    // Only set it when something was actually stored — an unconditional setter would revert a
    // switch the user clicked while the preferences round-trip was still in flight.
    const storedView = CHANNEL_VIEWS.includes(tablePrefs.channelView as ChannelView)
      ? (tablePrefs.channelView as ChannelView)
      : null;
    if (storedView) setChannelView(storedView);
    // A stored sort key must still name a real column *that the restored channel view shows*.
    // Anyone who used the grid before the health rollup was removed has `"health"` saved here, and
    // a layout saved before this view existed can pair `aimfox` with an EmailBison-only column —
    // either way, restoring it would sort by nothing at all.
    if (tablePrefs.sort && typeof tablePrefs.sort.key === "string") {
      const key = tablePrefs.sort.key;
      const known = key.startsWith("cf:") || MEGA_COLUMNS.some((c) => c.id === key);
      if (known && isColumnInChannelView(key, storedView ?? "both")) {
        setSort({ key, direction: tablePrefs.sort.direction === "desc" ? "desc" : "asc" });
      }
    }
  }, [prefsLoaded, tablePrefs]);

  const handleSortChange = useCallback(
    (next: MegaSortState) => {
      setSort(next);
      updateTablePrefs({ sort: next });
    },
    [updateTablePrefs],
  );

  const handleWidthsChange = useCallback(
    (widths: Record<string, number>) => updateTablePrefs({ widths }),
    [updateTablePrefs],
  );

  const handleStatusToggle = useCallback(
    (status: string) => {
      setStatusFilter((prev) => {
        const next = new Set(prev);
        if (next.has(status)) next.delete(status);
        else next.add(status);
        updateTablePrefs({ statusFilter: [...next] });
        return next;
      });
    },
    [updateTablePrefs],
  );

  const handleChannelViewChange = useCallback(
    (next: ChannelView) => {
      setChannelView(next);
      // A sort bound to a column this view hides would silently do nothing — compareMega finds no
      // matching column and returns 0. Fall back to the default Client sort instead.
      const keepsSort = isColumnInChannelView(sort.key, next);
      if (!keepsSort) setSort(DEFAULT_MEGA_SORT);
      updateTablePrefs(keepsSort ? { channelView: next } : { channelView: next, sort: DEFAULT_MEGA_SORT });
    },
    [sort.key, updateTablePrefs],
  );

  const handleClearFilters = useCallback(() => {
    setNameSearch("");
    setStatusFilter(new Set());
    updateTablePrefs({ statusFilter: [] });
  }, [updateTablePrefs]);

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  // Assignable owners for a client: CS Managers *and* admins (any internal, non-client user).
  // Named `managerUsers` because it feeds the drawer's "Manager" picker and the manager-name lookup.
  const managerUsers = useMemo(
    () =>
      users
        .filter((u) => u.role !== "client")
        .sort((a, b) =>
          `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`),
        ),
    [users],
  );
  const clientRoleUsers = useMemo(() => users.filter((u) => u.role === "client"), [users]);
  const managerById = useMemo(() => new Map(managerUsers.map((m) => [m.id, m] as const)), [managerUsers]);

  const normalizedConditionRules = useMemo(
    () => conditionRules.map(toConditionRule),
    [conditionRules],
  );

  const conditionPackByClientId = useMemo(() => {
    // No metrics yet → skip condition evaluation entirely so clients don't show
    // false danger states while stats are loading.
    if (metricsByClientId.size === 0) return new Map<string, ReturnType<typeof evaluateClientConditions>>();
    const packs = new Map<string, ReturnType<typeof evaluateClientConditions>>();
    for (const client of scopedClients) {
      const metrics = metricsByClientId.get(client.id) ?? createClientMetricsFromSummary(EMPTY_METRICS_SUMMARY);
      const manager = managerById.get(client.manager_id ?? "") ?? null;
      const context = buildClientConditionContext({
        client,
        manager: manager as Parameters<typeof buildClientConditionContext>[0]["manager"],
        metricsOverview: metrics.overview,
        dodRows: metrics.dodRows,
        threeDodRows: metrics.threeDodRows,
        wowRows: metrics.wowRows,
        momRows: metrics.momRows,
        campaigns: [],
        leads: [],
        dailyStats: [],
        customFieldValues: customFieldValuesByClient.get(client.id),
        sequencerCredentials: {
          emailbisonWorkspaceId: credsByClientId.get(client.id)?.emailbison?.external_workspace_id ?? null,
          emailbisonApiKey: credsByClientId.get(client.id)?.emailbison?.api_key ?? null,
          aimfoxApiKey: credsByClientId.get(client.id)?.aimfox?.api_key ?? null,
        },
      });
      packs.set(client.id, evaluateClientConditions(context, normalizedConditionRules, metrics, client));
    }
    return packs;
  }, [metricsByClientId, normalizedConditionRules, scopedClients, managerById, customFieldValuesByClient, credsByClientId]);

  const megaRows = useMemo<ClientMegaRow[]>(() => {
    return timeSyncOp(`[perf][clients] mega-rows (${scopedClients.length} rows)`, () =>
      scopedClients.map((client) => {
        const manager = managerById.get(client.manager_id ?? "");
        const managerName = manager
          ? `${manager.first_name ?? ""} ${manager.last_name ?? ""}`.trim()
          : "Unassigned";
        const metrics = metricsByClientId.get(client.id) ?? createClientMetricsFromSummary(EMPTY_METRICS_SUMMARY);
        const conditionPack = conditionPackByClientId.get(client.id) ?? null;
        return {
          client,
          managerName,
          // Narrow the numbers to the selected channel here, at page level, and NOT inside the
          // table: compareMega sorts through col.sortValue(row) on row.metrics, so a projection
          // applied any deeper would let the sort disagree with what is rendered. The condition
          // packs above stay on the blended metrics on purpose — a display switch must not change
          // what a rule means (see stripProjectedConditionKeys in mega-table).
          metrics: projectMetricsToChannel(metrics, channelView),
          conditionPack,
          sequencerCreds: credsByClientId.get(client.id) ?? EMPTY_SEQUENCER_CREDS,
        };
      }),
    );
  }, [channelView, conditionPackByClientId, credsByClientId, managerById, metricsByClientId, scopedClients]);

  const customFieldById = useMemo(
    () => new Map(clientCustomFields.map((f) => [f.id, f] as const)),
    [clientCustomFields],
  );

  const sortedMegaRows = useMemo(() => {
    const customCtx = { fields: customFieldById, valuesByClient: customFieldValuesByClient };
    return megaRows.slice().sort((a, b) => compareMega(a, b, sort, customCtx));
  }, [megaRows, sort, customFieldById, customFieldValuesByClient]);

  const nameSearchTrimmed = nameSearch.trim().toLowerCase();
  const filteredMegaRows = useMemo(
    () =>
      sortedMegaRows.filter((row) => {
        if (nameSearchTrimmed && !row.client.name.toLowerCase().includes(nameSearchTrimmed)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(row.client.status)) return false;
        return true;
      }),
    [nameSearchTrimmed, statusFilter, sortedMegaRows],
  );

  const visibleMegaRows = useMemo(
    () => filteredMegaRows.slice(0, visibleRowsCount),
    [filteredMegaRows, visibleRowsCount],
  );
  const hasMoreClients = visibleRowsCount < filteredMegaRows.length;

  const selectedClient = useMemo(
    () => scopedClients.find((c) => c.id === selectedClientId) ?? null,
    [scopedClients, selectedClientId],
  );
  const selectedConditionPack = useMemo(
    () => (selectedClient ? conditionPackByClientId.get(selectedClient.id) ?? null : null),
    [conditionPackByClientId, selectedClient],
  );
  const selectedClientMappings = useMemo(
    () => (selectedClient ? clientUsers.filter((m) => m.client_id === selectedClient.id) : []),
    [clientUsers, selectedClient],
  );
  const selectedManagerName = useMemo(() => {
    if (!selectedClient) return "—";
    const manager = users.find((u) => u.id === selectedClient.manager_id);
    if (!manager) return "—";
    return `${manager.first_name ?? ""} ${manager.last_name ?? ""}`.trim();
  }, [selectedClient, users]);

  const canEditAssignments = identity ? isInternalAdmin(identity.role) : false;
  const canInviteUsers = identity ? isInternalAdmin(identity.role) || identity.role === "manager" : false;
  // clients_update_scoped = can_manage_client(id): admin tier + the assigned manager. A manager only
  // ever receives their own clients, so role !== "client" is the whole UI-side rule.
  const canArchiveClients = identity ? identity.role !== "client" : false;
  // Inline status edit mirrors the drawer's status field, which is open to any internal user
  // (managers manage their own clients' lifecycle). RLS remains the write gate.
  const canEditStatus = identity ? identity.role !== "client" : false;

  // External store that broadcasts the selected-client id and column id to
  // per-row subscribers in the mega-table. Decouples the row/cell highlight
  // from React props so ClientsMegaTable does not re-render on drawer open/close.
  const selectionStore = useMemo(createSelectionStore, []);
  // Ref filled by ClientsMegaTable with the ordered visible column id array;
  // read by the keyboard handler to perform horizontal column navigation.
  const tableColsRef = useRef<string[]>([]);

  const openClient = useCallback(
    (id: string) => {
      markInteractionStart("client-drawer:click");
      const client = scopedClients.find((c) => c.id === id) ?? null;
      selectionStore.set({ clientId: id, colId: null });
      setSelectedClientId(id);
      setDraft(client ? toClientDraft(client, credsByClientId.get(client.id) ?? EMPTY_SEQUENCER_CREDS) : null);
      setMappingUserId("");
      setInviteEmail("");
      setInviteMessage(null);
    },
    [scopedClients, selectionStore, credsByClientId],
  );

  const closeClient = useCallback(() => {
    selectionStore.set({ clientId: null, colId: null });
    setSelectedClientId(null);
    setDraft(null);
    setMappingUserId("");
    setInviteEmail("");
    setInviteMessage(null);
  }, [selectionStore]);

  const handleRowClick = useCallback((id: string) => openClient(id), [openClient]);

  const handleCellHighlight = useCallback((clientId: string, colId: string) => {
    selectionStore.set({ clientId, colId });
  }, [selectionStore]);

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedClientId && !scopedClients.some((c) => c.id === selectedClientId)) {
      closeClient();
    }
  }, [scopedClients, selectedClientId, nameSearchTrimmed, statusFilter, closeClient]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeClient();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const state = selectionStore.get();
      if (!state.clientId) return;
      const colIds = tableColsRef.current;
      if (!colIds.length) return;
      const currentColIdx = state.colId ? colIds.indexOf(state.colId) : -1;
      const nextIdx =
        event.key === "ArrowRight"
          ? currentColIdx === -1 ? 0 : currentColIdx + 1
          : currentColIdx === -1 ? colIds.length - 1 : currentColIdx - 1;
      if (nextIdx < 0 || nextIdx >= colIds.length) return;
      event.preventDefault();
      selectionStore.set({ clientId: state.clientId, colId: colIds[nextIdx] });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // tableColsRef is a ref — not a dep; selectionStore is stable
  }, [closeClient, selectionStore]);

  const selectedClientCreds = useMemo(
    () => (selectedClient ? credsByClientId.get(selectedClient.id) ?? EMPTY_SEQUENCER_CREDS : EMPTY_SEQUENCER_CREDS),
    [credsByClientId, selectedClient],
  );

  const draftPatch = useMemo(() => {
    if (!selectedClient || !draft) return {};
    return buildClientPatch(selectedClient, draft, canEditAssignments);
  }, [canEditAssignments, draft, selectedClient]);
  const sequencerPatches = useMemo(
    () => (selectedClient && draft ? buildSequencerPatches(selectedClientCreds, draft) : []),
    [draft, selectedClient, selectedClientCreds],
  );
  const isDraftDirty = Object.keys(draftPatch).length > 0 || sequencerPatches.length > 0;

  const handleSave = useCallback(async () => {
    if (!selectedClient || !draft || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      if (Object.keys(draftPatch).length > 0) {
        await updateClient(selectedClient.id, draftPatch);
      }
      for (const { sequencerKey, patch } of sequencerPatches) {
        await upsertClientSequencer(selectedClient.id, sequencerKey, patch);
      }
      setDraft((current) => (current ? { ...current } : current));
    } finally {
      setIsSavingDraft(false);
    }
  }, [draft, draftPatch, isDraftDirty, selectedClient, sequencerPatches, updateClient, upsertClientSequencer]);

  const handleCancel = useCallback(() => {
    if (!selectedClient) return;
    setDraft(toClientDraft(selectedClient, selectedClientCreds));
  }, [selectedClient, selectedClientCreds]);

  const handleAssignClientUser = useCallback(async () => {
    if (!selectedClient || !mappingUserId) return;
    setIsSavingMapping(true);
    try {
      await upsertClientUserMapping(mappingUserId, selectedClient.id);
      setMappingUserId("");
    } finally {
      setIsSavingMapping(false);
    }
  }, [mappingUserId, selectedClient, upsertClientUserMapping]);

  const handleRemoveClientUserMapping = useCallback(
    async (mappingId: string) => {
      setIsSavingMapping(true);
      try {
        await deleteClientUserMapping(mappingId);
      } finally {
        setIsSavingMapping(false);
      }
    },
    [deleteClientUserMapping],
  );

  const handleInviteUser = useCallback(async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      setInviteMessage({ tone: "warning", text: "Enter a valid email before sending an invitation." });
      return;
    }
    if (!selectedClient) {
      setInviteMessage({ tone: "warning", text: "Select a client before inviting a client user." });
      return;
    }
    setIsSendingInvite(true);
    setInviteMessage(null);
    try {
      await sendInvite({ email: normalizedEmail, role: "client", clientId: selectedClient.id });
      setInviteEmail("");
      setInviteMessage({ tone: "info", text: `Client invitation sent to ${normalizedEmail}.` });
    } catch {
      setInviteMessage({ tone: "danger", text: "Invitation request failed. Check permissions and try again." });
    } finally {
      setIsSendingInvite(false);
    }
  }, [inviteEmail, selectedClient, sendInvite]);

  // Stable callback for the create mutation passed into the memoized sheet.
  const handleCreateClientStable = useCallback(
    (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">, sequencerCredentials?: SequencerCredentialInput[]) =>
      createClient(input, sequencerCredentials),
    [createClient],
  );

  // Default manager ID pre-filled for manager role users.
  const defaultManagerId = identity?.role === "manager" ? (identity.userId ?? "") : "";

  if (!identity || identity.role === "client") {
    return (
      <EmptyState
        title="Clients workspace is internal only"
        description="This route is available to admin and manager roles."
      />
    );
  }

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="space-y-6">
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

  const createClientButton = (
    <CreateClientSheetHost
      managerUsers={managerUsers}
      canEditAssignments={canEditAssignments}
      onCreateClient={handleCreateClientStable}
      onRefresh={refresh}
      defaultManagerId={defaultManagerId}
    />
  );

  const clientsToolbar = (
    <div className="flex items-center gap-2">
      {canArchiveClients ? (
        <ShowArchivedToggle value={showArchived} onChange={setShowArchived} disabled={loading} />
      ) : null}
      {createClientButton}
    </div>
  );

  return (
    <div className="space-y-6">
      {scopedClients.length === 0 ? (
        <>
          <div className="flex justify-end">{clientsToolbar}</div>
          <EmptyState
            title="No clients assigned"
            description="The current identity does not have any visible clients."
          />
        </>
      ) : (
        <Surface
          title="Client PDCrmA grid"
          subtitle={`${visibleMegaRows.length} of ${filteredMegaRows.length} clients in current filter${statsLoading ? " · loading metrics…" : ""}`}
          actions={clientsToolbar}
        >
          {/* ── Filter bar — single row: search · status · channel ─── */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Search by name…"
                className="h-8 w-[132px] rounded-lg border border-white/15 bg-black/30 px-3 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-white/30"
              />

              <div className="flex flex-wrap gap-1.5">
                {CLIENT_STATUSES.map((s) => {
                  const active = statusFilter.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleStatusToggle(s)}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition",
                        active
                          ? statusBadgeClass(s)
                          : "border-white/15 bg-transparent text-white/40 hover:border-white/30 hover:text-white/70",
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>

              <ToggleGroup
                type="single"
                value={channelView}
                onValueChange={(value) => {
                  if (!value) return;
                  handleChannelViewChange(value as ChannelView);
                }}
                variant="outline"
                className="flex-nowrap rounded-xl border border-border bg-black/10 p-1"
                aria-label="Channel view"
              >
                {/* flex-none so each item sizes to its own label — the base ToggleGroupItem uses
                    flex-1 (equal widths), which squeezes the longest label past its cell. */}
                {CHANNEL_VIEW_CHIPS.map((chip) => (
                  <ToggleGroupItem
                    key={chip.value}
                    value={chip.value}
                    className="h-6 flex-none whitespace-nowrap px-3 text-[11px]"
                    aria-label={chip.ariaLabel}
                  >
                    {chip.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {(nameSearch || statusFilter.size > 0) && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="h-8 rounded-lg border border-white/15 bg-black/20 px-3 text-xs text-white/50 transition hover:border-white/30 hover:text-white"
                >
                  Clear
                </button>
              )}
          </div>

          <DevProfiler id="ClientsMegaTable">
            <ClientsMegaTable
              rows={visibleMegaRows}
              sort={sort}
              onSortChange={handleSortChange}
              onRowClick={handleRowClick}
              onHighlight={handleCellHighlight}
              selectionStore={selectionStore}
              colsRef={tableColsRef}
              channelView={channelView}
              savedWidths={(tablePrefs.widths as Record<string, number> | undefined) ?? null}
              onWidthsChange={handleWidthsChange}
              columnOverrides={columnOverrides}
              customFields={clientCustomFields}
              customFieldValuesByClient={customFieldValuesByClient}
              canEditCustomField={canEditCustomField}
              onCustomFieldValueChange={handleCustomFieldValueChange}
              onNotesChange={handleNotesChange}
              canEditStatus={canEditStatus}
              onStatusChange={handleStatusChange}
              // Same gate as inline Status: any internal user rates, clients never. RLS decides.
              onSatisfactionChange={canEditStatus ? handleSatisfactionChange : undefined}
            />
          </DevProfiler>

          {hasMoreClients && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => setVisibleRowsCount((current) => current + PAGE_SIZE)}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
              >
                Load more clients
              </button>
            </div>
          )}
        </Surface>
      )}

      {/* CreateClientSheetHost owns the open state — sheet open/close does not re-render ClientsPage
          or ClientsMegaTable. Trigger button and sheet live together inside the host. */}

      {selectedClient && draft && (
        <DevProfiler id="ClientDrawer">
        <ClientDrawer
          client={selectedClient}
          draft={draft}
          setDraft={setDraft}
          conditionPack={selectedConditionPack}
          managerName={selectedManagerName}
          managerUsers={managerUsers as Parameters<typeof ClientDrawer>[0]["managerUsers"]}
          clientRoleUsers={clientRoleUsers as Parameters<typeof ClientDrawer>[0]["clientRoleUsers"]}
          allClients={clients}
          allUsers={users as Parameters<typeof ClientDrawer>[0]["allUsers"]}
          selectedClientMappings={selectedClientMappings}
          allClientUsers={clientUsers}
          mappingUserId={mappingUserId}
          setMappingUserId={setMappingUserId}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteMessage={inviteMessage}
          isSavingDraft={isSavingDraft}
          isSavingMapping={isSavingMapping}
          isSendingInvite={isSendingInvite}
          isDraftDirty={isDraftDirty}
          sequencerCreds={selectedClientCreds}
          canEditAssignments={canEditAssignments}
          canInviteUsers={canInviteUsers}
          canArchive={canArchiveClients}
          onArchived={() => { closeClient(); void refresh(); }}
          onClose={closeClient}
          onSave={() => {
            void handleSave();
          }}
          onCancel={handleCancel}
          onAssignClientUser={() => {
            void handleAssignClientUser();
          }}
          onRemoveClientUserMapping={(id) => {
            void handleRemoveClientUserMapping(id);
          }}
          onInviteUser={() => {
            void handleInviteUser();
          }}
        />
        </DevProfiler>
      )}
    </div>
  );
}
