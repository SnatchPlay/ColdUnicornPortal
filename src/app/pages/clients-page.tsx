import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../components/ui/utils";
import { repository, RepositoryError } from "../data/repository";
import { markInteractionStart, markPoint, measureAfterRaf2, measureBetween, timeSyncOp } from "../lib/perf-mark";
import { createClientMetrics, type ClientMetricsPack } from "../lib/client-metrics";
import { isInternalAdmin, scopeClients } from "../lib/selectors";
import { buildClientConditionContext } from "../lib/conditions/client-condition-context";
import { evaluateClientConditions } from "../lib/conditions/client-condition-results";
import { getHealthScore, getHighestSeverity } from "../lib/conditions/evaluator";
import { toConditionRule } from "../lib/conditions/mapper";
import type { ConditionSeverity } from "../lib/conditions/types";
import { useAuth } from "../providers/auth";
import type { ClientRecord, InviteRequest } from "../types/core";
import type { ClientsOverviewPayload, UserLite } from "../types/view-contracts";
import {
  ClientDrawer,
  buildClientPatch,
  toClientDraft,
  type ClientDraft,
} from "./clients-page/client-drawer";
import {
  ClientsMegaTable,
  MEGA_COLUMNS,
  type ClientMegaRow,
  type MegaSortState,
} from "./clients-page/mega-table";
import { createSelectionStore } from "./clients-page/selection-store";

const PAGE_SIZE = 50;
const HEALTH_FILTERS = ["all", "warning", "danger", "critical", "healthy"] as const;
type HealthFilter = (typeof HEALTH_FILTERS)[number];

const CLIENT_STATUSES = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"] as const;
type ClientStatus = (typeof CLIENT_STATUSES)[number];

interface CreateClientDraft {
  name: string;
  managerId: string;
  status: ClientStatus | "";
  externalWorkspaceId: number | null;
  externalApiKey: string;
  kpiLeads: number | null;
  kpiMeetings: number | null;
  contractedAmount: number | null;
  contractDueDate: string;
}

const STATUS_COLORS: Record<string, string> = {
  Active: "border-emerald-500 bg-emerald-900/40 text-emerald-200",
  Abo: "border-sky-400 bg-sky-900/40 text-sky-200",
  Sales: "border-violet-400 bg-violet-900/40 text-violet-200",
  "On hold": "border-amber-400 bg-amber-900/40 text-amber-200",
  Offboarding: "border-orange-400 bg-orange-900/40 text-orange-200",
  Inactive: "border-red-500 bg-red-900/40 text-red-200",
};

function matchesHealthFilter(filter: HealthFilter, severity: ConditionSeverity | null): boolean {
  if (filter === "all") return true;
  if (filter === "healthy") return !severity || severity === "good" || severity === "info";
  if (!severity) return false;
  if (filter === "critical") return severity === "critical_over";
  if (filter === "danger") return severity === "danger";
  return severity === "warning";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function compareMega(left: ClientMegaRow, right: ClientMegaRow, sort: MegaSortState): number {
  const col = MEGA_COLUMNS.find((c) => c.id === sort.key);
  if (!col || !col.sortValue) return 0;
  const a = col.sortValue(left);
  const b = col.sortValue(right);
  const dir = sort.direction === "asc" ? 1 : -1;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * dir;
  }
  return String(a).localeCompare(String(b)) * dir;
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

// ── Per-page data hook ─────────────────────────────────────────────────────────────────────────

function useClientsOverview() {
  const { identity, loading: authLoading } = useAuth();
  const [data, setData] = useState<ClientsOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    markPoint("clients:fetch:start");
    try {
      const result = await repository.loadClientsOverview();
      markPoint("clients:fetch:end");
      measureBetween("clients:fetch:start", "clients:fetch:end", "[perf][clients] fetch round-trip");
      setData(result);
      markPoint("clients:state:set");
      setError(null);
    } catch (reason) {
      setError(mapClientsError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !identity) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load();
  }, [authLoading, identity, load]);

  // ── Mutations with optimistic update / rollback ──────────────────────────────────────────────

  const createClient = useCallback(
    async (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">) => {
      try {
        const created = await repository.createClient(input);
        setData((prev) => {
          if (!prev) return prev;
          return { ...prev, clients: [created, ...prev.clients] };
        });
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

  return {
    data,
    loading,
    error,
    refresh: load,
    createClient,
    updateClient,
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
  onCreateClient: (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">) => Promise<void>;
  defaultManagerId: string;
}

const CreateClientSheet = memo(function CreateClientSheet({
  open,
  onOpenChange,
  managerUsers,
  canEditAssignments,
  onCreateClient,
  defaultManagerId,
}: CreateClientSheetProps) {
  const [draft, setDraft] = useState<CreateClientDraft | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shell timing: measure from "new-client-sheet:click" mark on false→true transition.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      measureAfterRaf2("new-client-sheet:click", "[perf][sheet] new-client shell click→raf2");
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
        externalWorkspaceId: null,
        externalApiKey: "",
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
    if (!draft || !draft.name.trim() || !draft.managerId || !draft.status) return;
    setIsSubmitting(true);
    try {
      await onCreateClient({
        name: draft.name.trim(),
        manager_id: draft.managerId,
        status: draft.status as ClientStatus,
        kpi_leads: draft.kpiLeads,
        kpi_meetings: draft.kpiMeetings,
        contracted_amount: draft.contractedAmount,
        contract_due_date: draft.contractDueDate || null,
        external_workspace_id: draft.externalWorkspaceId,
        external_api_key: draft.externalApiKey.trim() || null,
        min_daily_sent: 0,
        inboxes_count: 0,
        crm_config: null,
        sms_phone_numbers: null,
        notification_emails: null,
        auto_ooo_enabled: false,
        linkedin_api_key: null,
        prospects_signed: 0,
        prospects_added: 0,
        setup_info: null,
        bi_setup_done: false,
        lost_reason: null,
        notes: null,
      });
      onOpenChange(false);
    } catch {
      // error shown via toast from useClientsOverview
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md">
        <SheetHeader className="p-6 pb-2">
          <SheetTitle className="text-white">New client</SheetTitle>
          <SheetDescription>Fill in the required fields to create a new client account.</SheetDescription>
        </SheetHeader>
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
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager *</span>
                <Select
                  value={draft.managerId}
                  onValueChange={(v) => setDraft((d) => (d ? { ...d, managerId: v } : d))}
                >
                  <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
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
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace ID</span>
              <input
                type="number"
                value={draft.externalWorkspaceId ?? ""}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, externalWorkspaceId: e.target.value === "" ? null : Number(e.target.value) } : d,
                  )
                }
                placeholder="Smartlead workspace ID"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace API key</span>
              <input
                value={draft.externalApiKey}
                onChange={(e) => setDraft((d) => (d ? { ...d, externalApiKey: e.target.value } : d))}
                placeholder="Smartlead API key"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs text-white outline-none placeholder:text-neutral-500"
              />
            </label>
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
              disabled={isSubmitting || !draft.name.trim() || !draft.managerId || !draft.status}
              className="w-full rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create client"}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
});

// ── Main page ──────────────────────────────────────────────────────────────────────────────────

export function ClientsPage() {
  const { identity } = useAuth();
  const {
    data,
    loading,
    error,
    refresh,
    createClient,
    updateClient,
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

  // ── Derived per-client metrics (replaces metricsByClientId from useCoreData) ─────────────────

  const metricsByClientId = useMemo<ReadonlyMap<string, ClientMetricsPack>>(() => {
    if (!data) return new Map();
    return timeSyncOp(`[perf][clients] metrics-derivation (${data.clients.length} clients)`, () => {
      const statsByClient = new Map<string, typeof data.dailyStats>();
      const leadsByClient = new Map<string, typeof data.leadProjections>();
      for (const client of data.clients) {
        statsByClient.set(client.id, []);
        leadsByClient.set(client.id, []);
      }
      for (const stat of data.dailyStats) {
        statsByClient.get(stat.client_id)?.push(stat);
      }
      for (const lead of data.leadProjections) {
        leadsByClient.get(lead.client_id)?.push(lead);
      }
      const result = new Map<string, ClientMetricsPack>();
      for (const client of data.clients) {
        result.set(
          client.id,
          createClientMetrics(statsByClient.get(client.id) ?? [], leadsByClient.get(client.id) ?? []),
        );
      }
      return result;
    });
  }, [data]);

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

  // ── Drawer / selection state ──────────────────────────────────────────────────────────────────

  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [mappingUserId, setMappingUserId] = useState("");
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [nameSearch, setNameSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [managerFilter, setManagerFilter] = useState("all");
  const [sort, setSort] = useState<MegaSortState>({ key: "health", direction: "asc" });

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const managerUsers = useMemo(() => users.filter((u) => u.role === "manager"), [users]);
  const clientRoleUsers = useMemo(() => users.filter((u) => u.role === "client"), [users]);
  const managerById = useMemo(() => new Map(managerUsers.map((m) => [m.id, m] as const)), [managerUsers]);

  const normalizedConditionRules = useMemo(
    () => conditionRules.map(toConditionRule),
    [conditionRules],
  );

  const conditionPackByClientId = useMemo(() => {
    const packs = new Map<string, ReturnType<typeof evaluateClientConditions>>();
    for (const client of scopedClients) {
      const metrics = metricsByClientId.get(client.id) ?? createClientMetrics([], []);
      const manager = managerById.get(client.manager_id) ?? null;
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
      });
      packs.set(client.id, evaluateClientConditions(context, normalizedConditionRules, metrics, client));
    }
    return packs;
  }, [metricsByClientId, normalizedConditionRules, scopedClients, managerById, customFieldValuesByClient]);

  const megaRows = useMemo<ClientMegaRow[]>(() => {
    return timeSyncOp(`[perf][clients] mega-rows (${scopedClients.length} rows)`, () =>
      scopedClients.map((client) => {
        const manager = managerById.get(client.manager_id);
        const managerName = manager
          ? `${manager.first_name ?? ""} ${manager.last_name ?? ""}`.trim()
          : "Unassigned";
        const metrics = metricsByClientId.get(client.id) ?? createClientMetrics([], []);
        const conditionPack = conditionPackByClientId.get(client.id) ?? null;
        const allResults = conditionPack?.allResults ?? [];
        const highestSeverity = getHighestSeverity(allResults);
        const rollupCause = allResults.find((r) => r.severity === highestSeverity)?.label ?? "All KPIs on target";
        return {
          client,
          managerName,
          metrics,
          highestSeverity,
          healthScore: getHealthScore(allResults),
          rollupCause,
          conditionPack,
        };
      }),
    );
  }, [conditionPackByClientId, managerById, metricsByClientId, scopedClients]);

  const sortedMegaRows = useMemo(() => {
    return megaRows.slice().sort((a, b) => compareMega(a, b, sort));
  }, [megaRows, sort]);

  const nameSearchTrimmed = nameSearch.trim().toLowerCase();
  const filteredMegaRows = useMemo(
    () =>
      sortedMegaRows.filter((row) => {
        if (!matchesHealthFilter(healthFilter, row.highestSeverity)) return false;
        if (nameSearchTrimmed && !row.client.name.toLowerCase().includes(nameSearchTrimmed)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(row.client.status)) return false;
        if (managerFilter !== "all" && row.client.manager_id !== managerFilter) return false;
        return true;
      }),
    [healthFilter, nameSearchTrimmed, statusFilter, managerFilter, sortedMegaRows],
  );

  const healthFilterCounts = useMemo(() => {
    const counts = new Map<HealthFilter, number>([
      ["all", sortedMegaRows.length],
      ["critical", 0],
      ["danger", 0],
      ["warning", 0],
      ["healthy", 0],
    ]);
    for (const row of sortedMegaRows) {
      if (matchesHealthFilter("critical", row.highestSeverity)) counts.set("critical", (counts.get("critical") ?? 0) + 1);
      if (matchesHealthFilter("danger", row.highestSeverity)) counts.set("danger", (counts.get("danger") ?? 0) + 1);
      if (matchesHealthFilter("warning", row.highestSeverity)) counts.set("warning", (counts.get("warning") ?? 0) + 1);
      if (matchesHealthFilter("healthy", row.highestSeverity)) counts.set("healthy", (counts.get("healthy") ?? 0) + 1);
    }
    return counts;
  }, [sortedMegaRows]);

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

  // External store that broadcasts the selected-client id to per-row
  // subscribers in the mega-table. Decouples the row highlight from React
  // props so ClientsMegaTable does not re-render on drawer open/close.
  const selectionStore = useMemo(createSelectionStore, []);

  const openClient = useCallback(
    (id: string) => {
      markInteractionStart("client-drawer:click");
      const client = scopedClients.find((c) => c.id === id) ?? null;
      selectionStore.set(id);
      setSelectedClientId(id);
      setDraft(client ? toClientDraft(client) : null);
      setMappingUserId("");
      setInviteEmail("");
      setInviteMessage(null);
    },
    [scopedClients, selectionStore],
  );

  const closeClient = useCallback(() => {
    selectionStore.set(null);
    setSelectedClientId(null);
    setDraft(null);
    setMappingUserId("");
    setInviteEmail("");
    setInviteMessage(null);
  }, [selectionStore]);

  const handleRowClick = useCallback((id: string) => openClient(id), [openClient]);

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedClientId && !scopedClients.some((c) => c.id === selectedClientId)) {
      closeClient();
    }
  }, [scopedClients, selectedClientId, healthFilter, nameSearchTrimmed, statusFilter, managerFilter, closeClient]);

  useEffect(() => {
    if (!selectedClient) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeClient();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClient, closeClient]);

  const draftPatch = useMemo(() => {
    if (!selectedClient || !draft) return {};
    return buildClientPatch(selectedClient, draft, canEditAssignments);
  }, [canEditAssignments, draft, selectedClient]);
  const isDraftDirty = Object.keys(draftPatch).length > 0;

  const handleSave = useCallback(async () => {
    if (!selectedClient || !draft || !isDraftDirty) return;
    setIsSavingDraft(true);
    try {
      await updateClient(selectedClient.id, draftPatch);
      setDraft((current) => (current ? { ...current } : current));
    } finally {
      setIsSavingDraft(false);
    }
  }, [draft, draftPatch, isDraftDirty, selectedClient, updateClient]);

  const handleCancel = useCallback(() => {
    if (!selectedClient) return;
    setDraft(toClientDraft(selectedClient));
  }, [selectedClient]);

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
    (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">) => createClient(input),
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
        <PageHeader title="Clients" subtitle="Operational client control surface for managing core client settings." />
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
        subtitle="Dense PDCA grid covering DoD, 3-DoD, WoW, and MoM in a single horizontally-scrollable surface. Click any row to open the configuration drawer."
        actions={
          <button
            onClick={() => {
              markInteractionStart("new-client-sheet:click");
              setIsCreatingClient(true);
            }}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20"
          >
            New client
          </button>
        }
      />

      {scopedClients.length === 0 ? (
        <EmptyState
          title="No clients assigned"
          description="The current identity does not have any visible clients."
        />
      ) : (
        <Surface
          title="Client PDCA grid"
          subtitle={`${visibleMegaRows.length} of ${filteredMegaRows.length} clients in current health filter`}
        >
          {/* ── Filter bar ─────────────────────────────────────── */}
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-2">
              <p className="shrink-0 text-xs uppercase tracking-[0.16em] text-muted-foreground">Health</p>
              <ToggleGroup
                type="single"
                value={healthFilter}
                onValueChange={(value) => {
                  if (!value) return;
                  setHealthFilter(value as HealthFilter);
                }}
                variant="outline"
                className="flex-1 flex-wrap rounded-xl border border-border bg-black/10 p-1 md:flex-nowrap"
              >
                {HEALTH_FILTERS.map((filter) => (
                  <ToggleGroupItem key={filter} value={filter} className="h-8 flex-1 text-xs">
                    {filter === "all"
                      ? `All (${healthFilterCounts.get("all") ?? 0})`
                      : `${
                          filter === "healthy"
                            ? "Healthy"
                            : filter === "critical"
                            ? "Critical"
                            : filter === "danger"
                            ? "Danger"
                            : "Warning"
                        } (${healthFilterCounts.get(filter) ?? 0})`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Search by name…"
                className="h-8 min-w-[160px] rounded-lg border border-white/15 bg-black/30 px-3 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-white/30"
              />

              <div className="flex flex-wrap gap-1.5">
                {CLIENT_STATUSES.map((s) => {
                  const active = statusFilter.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStatusFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(s)) next.delete(s);
                          else next.add(s);
                          return next;
                        });
                      }}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition",
                        active
                          ? STATUS_COLORS[s]
                          : "border-white/15 bg-transparent text-white/40 hover:border-white/30 hover:text-white/70",
                      )}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>

              {canEditAssignments && managerUsers.length > 0 && (
                <Select value={managerFilter} onValueChange={setManagerFilter}>
                  <SelectTrigger className="h-8 min-w-[140px] rounded-lg border-white/15 bg-black/30 text-xs text-white">
                    <SelectValue placeholder="All managers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All managers</SelectItem>
                    {managerUsers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.first_name} {m.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {(nameSearch || statusFilter.size > 0 || managerFilter !== "all" || healthFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setNameSearch("");
                    setStatusFilter(new Set());
                    setManagerFilter("all");
                    setHealthFilter("all");
                  }}
                  className="h-8 rounded-lg border border-white/15 bg-black/20 px-3 text-xs text-white/50 transition hover:border-white/30 hover:text-white"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <ClientsMegaTable
            rows={visibleMegaRows}
            sort={sort}
            onSortChange={setSort}
            onRowClick={handleRowClick}
            selectionStore={selectionStore}
            columnOverrides={columnOverrides}
            customFields={clientCustomFields}
            customFieldValuesByClient={customFieldValuesByClient}
            canEditCustomField={canEditCustomField}
            onCustomFieldValueChange={(clientId, fieldId, value) => {
              void upsertClientCustomFieldValue(clientId, fieldId, value);
            }}
          />

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

      {/* CreateClientSheet is memoized — its draft state does not re-render the mega-table. */}
      <CreateClientSheet
        open={isCreatingClient}
        onOpenChange={setIsCreatingClient}
        managerUsers={managerUsers}
        canEditAssignments={canEditAssignments}
        onCreateClient={handleCreateClientStable}
        defaultManagerId={defaultManagerId}
      />

      {selectedClient && draft && (
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
          canEditAssignments={canEditAssignments}
          canInviteUsers={canInviteUsers}
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
      )}
    </div>
  );
}
