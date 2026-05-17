import { useCallback, useEffect, useMemo, useState } from "react";
// [TEMP PERF] perf instrumentation — remove with the rest of `[TEMP PERF]` blocks
import { mark, measureSync, perfLog, useRenderCounter } from "../lib/__perf";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { cn } from "../components/ui/utils";
import { createClientMetrics, type ClientMetricsPack } from "../lib/client-metrics";
import { scopeClients } from "../lib/selectors";
import { buildClientConditionContext } from "../lib/conditions/client-condition-context";
import { evaluateClientConditions } from "../lib/conditions/client-condition-results";
import { getHealthScore, getHighestSeverity } from "../lib/conditions/evaluator";
import { toConditionRule } from "../lib/conditions/mapper";
import type { ConditionSeverity } from "../lib/conditions/types";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
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

const PAGE_SIZE = 50;
const HEALTH_FILTERS = ["all", "warning", "danger", "critical", "healthy"] as const;
type HealthFilter = (typeof HEALTH_FILTERS)[number];

const CLIENT_STATUSES = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"] as const;

interface CreateClientDraft {
  name: string;
  managerId: string;
  status: (typeof CLIENT_STATUSES)[number] | "";
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

export function ClientsPage() {
  // [TEMP PERF] count renders of ClientsPage
  useRenderCounter("ClientsPage");
  const { identity } = useAuth();
  const {
    clients,
    users,
    clientUsers,
    metricsByClientId,
    conditionRules = [],
    createClient,
    updateClient,
    sendInvite,
    upsertClientUserMapping,
    deleteClientUserMapping,
    loading,
    error,
    refresh,
  } = useCoreData();

  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [createClientDraft, setCreateClientDraft] = useState<CreateClientDraft | null>(null);
  const [isSubmittingCreateClient, setIsSubmittingCreateClient] = useState(false);

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
    // [TEMP PERF] measure condition-pack build cost
    return measureSync(`conditionPackByClientId (clients=${scopedClients.length}, rules=${normalizedConditionRules.length})`, () => {
      const packs = new Map<string, ReturnType<typeof evaluateClientConditions>>();
      for (const client of scopedClients) {
        const metrics = metricsByClientId.get(client.id) ?? createClientMetrics([], []);
        const manager = managerById.get(client.manager_id) ?? null;
        const context = buildClientConditionContext({
          client,
          manager,
          metricsOverview: metrics.overview,
          dodRows: metrics.dodRows,
          threeDodRows: metrics.threeDodRows,
          wowRows: metrics.wowRows,
          momRows: metrics.momRows,
          campaigns: [],
          leads: [],
          dailyStats: [],
        });
        packs.set(client.id, evaluateClientConditions(context, normalizedConditionRules, metrics, client));
      }
      return packs;
    });
    // [TEMP PERF] /end
  }, [metricsByClientId, normalizedConditionRules, scopedClients, managerById]);

  const megaRows = useMemo<ClientMegaRow[]>(() => {
    // [TEMP PERF] measure mega-row build cost
    return measureSync(`megaRows (clients=${scopedClients.length})`, () => scopedClients.map((client) => {
      const manager = managerById.get(client.manager_id);
      const managerName = manager ? `${manager.first_name} ${manager.last_name}`.trim() : "Unassigned";
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
    }));
    // [TEMP PERF] /end
  }, [conditionPackByClientId, managerById, metricsByClientId, scopedClients]);

  const sortedMegaRows = useMemo(() => {
    // [TEMP PERF] measure sort cost
    return measureSync(`sortedMegaRows (rows=${megaRows.length}, key=${sort.key})`, () =>
      megaRows.slice().sort((a, b) => compareMega(a, b, sort)),
    );
    // [TEMP PERF] /end
  }, [megaRows, sort]);

  const nameSearchTrimmed = nameSearch.trim().toLowerCase();
  const filteredMegaRows = useMemo(
    () =>
      // [TEMP PERF] measure filter cost
      measureSync(`filteredMegaRows (in=${sortedMegaRows.length})`, () =>
        sortedMegaRows.filter((row) => {
          if (!matchesHealthFilter(healthFilter, row.highestSeverity)) return false;
          if (nameSearchTrimmed && !row.client.name.toLowerCase().includes(nameSearchTrimmed)) return false;
          if (statusFilter.size > 0 && !statusFilter.has(row.client.status)) return false;
          if (managerFilter !== "all" && row.client.manager_id !== managerFilter) return false;
          return true;
        }),
      ),
      // [TEMP PERF] /end
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
    return `${manager.first_name} ${manager.last_name}`.trim();
  }, [selectedClient, users]);

  const canEditAssignments = identity?.role === "admin" || identity?.role === "super_admin";

  function openCreateClient() {
    setCreateClientDraft({
      name: "",
      managerId: identity?.role === "manager" ? (identity.userId ?? "") : "",
      status: "Active",
      externalWorkspaceId: null,
      externalApiKey: "",
      kpiLeads: null,
      kpiMeetings: null,
      contractedAmount: null,
      contractDueDate: "",
    });
    setIsCreatingClient(true);
  }

  async function handleCreateClient() {
    if (!createClientDraft || !createClientDraft.name.trim() || !createClientDraft.managerId || !createClientDraft.status) return;
    setIsSubmittingCreateClient(true);
    try {
      await createClient({
        name: createClientDraft.name.trim(),
        manager_id: createClientDraft.managerId,
        status: createClientDraft.status as (typeof CLIENT_STATUSES)[number],
        kpi_leads: createClientDraft.kpiLeads,
        kpi_meetings: createClientDraft.kpiMeetings,
        contracted_amount: createClientDraft.contractedAmount,
        contract_due_date: createClientDraft.contractDueDate || null,
        external_workspace_id: createClientDraft.externalWorkspaceId,
        external_api_key: createClientDraft.externalApiKey.trim() || null,
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
      setIsCreatingClient(false);
      setCreateClientDraft(null);
    } catch {
      // error shown via toast from core-data
    } finally {
      setIsSubmittingCreateClient(false);
    }
  }
  const canInviteUsers =
    identity?.role === "admin" || identity?.role === "super_admin" || identity?.role === "manager";

  // Open the drawer: select the client AND seed the draft in the same React event.
  // This batches both state updates into one render so the drawer mounts on the
  // first render after the click (no useEffect-driven second render).
  const openClient = useCallback(
    (id: string) => {
      const client = scopedClients.find((c) => c.id === id) ?? null;
      setSelectedClientId(id);
      setDraft(client ? toClientDraft(client) : null);
      setMappingUserId("");
      setInviteEmail("");
      setInviteMessage(null);
    },
    [scopedClients],
  );

  const closeClient = useCallback(() => {
    setSelectedClientId(null);
    setDraft(null);
    setMappingUserId("");
    setInviteEmail("");
    setInviteMessage(null);
  }, []);

  // Reset visible rows when scope or filter changes; drop selection if scope no longer holds it
  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedClientId && !scopedClients.some((c) => c.id === selectedClientId)) {
      closeClient();
    }
  }, [scopedClients, selectedClientId, healthFilter, nameSearchTrimmed, statusFilter, managerFilter, closeClient]);

  // Esc closes drawer
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
            onClick={openCreateClient}
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
            {/* Row 1: Health */}
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

            {/* Row 2: Search + Status + Manager */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Name search */}
              <input
                type="search"
                value={nameSearch}
                onChange={(e) => setNameSearch(e.target.value)}
                placeholder="Search by name…"
                className="h-8 min-w-[160px] rounded-lg border border-white/15 bg-black/30 px-3 text-xs text-white placeholder:text-muted-foreground outline-none focus:border-white/30"
              />

              {/* Status multi-select pills */}
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

              {/* Manager filter — admin only */}
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

              {/* Clear all */}
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
            onRowClick={(id) => {
              // [TEMP PERF] mark moment of user click — paired with drawer-mounted in ClientDrawer
              mark("drawer-click");
              perfLog(`row click → openClient(${id})`);
              openClient(id);
            }}
            selectedClientId={selectedClientId}
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

      <Sheet open={isCreatingClient} onOpenChange={setIsCreatingClient}>
        <SheetContent className="overflow-y-auto border-l border-[#242424] bg-[#050505] sm:max-w-md">
          <SheetHeader className="p-6 pb-2">
            <SheetTitle className="text-white">New client</SheetTitle>
            <SheetDescription>Fill in the required fields to create a new client account.</SheetDescription>
          </SheetHeader>
          {createClientDraft && (
            <div className="space-y-4 px-6 pb-6">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Name *</span>
                <input
                  value={createClientDraft.name}
                  onChange={(e) => setCreateClientDraft((d) => d ? { ...d, name: e.target.value } : d)}
                  placeholder="Client name"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
                />
              </label>
              {canEditAssignments && (
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager *</span>
                  <Select value={createClientDraft.managerId} onValueChange={(v) => setCreateClientDraft((d) => d ? { ...d, managerId: v } : d)}>
                    <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                      {managerUsers.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          {m.first_name} {m.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Status *</span>
                <Select value={createClientDraft.status} onValueChange={(v) => setCreateClientDraft((d) => d ? { ...d, status: v as (typeof CLIENT_STATUSES)[number] } : d)}>
                  <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                    {CLIENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace ID</span>
                <input
                  type="number"
                  value={createClientDraft.externalWorkspaceId ?? ""}
                  onChange={(e) => setCreateClientDraft((d) => d ? { ...d, externalWorkspaceId: e.target.value === "" ? null : Number(e.target.value) } : d)}
                  placeholder="Smartlead workspace ID"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace API key</span>
                <input
                  value={createClientDraft.externalApiKey}
                  onChange={(e) => setCreateClientDraft((d) => d ? { ...d, externalApiKey: e.target.value } : d)}
                  placeholder="Smartlead API key"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-500 font-mono text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">KPI leads</span>
                  <input
                    type="number"
                    value={createClientDraft.kpiLeads ?? ""}
                    onChange={(e) => setCreateClientDraft((d) => d ? { ...d, kpiLeads: e.target.value === "" ? null : Number(e.target.value) } : d)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">KPI meetings</span>
                  <input
                    type="number"
                    value={createClientDraft.kpiMeetings ?? ""}
                    onChange={(e) => setCreateClientDraft((d) => d ? { ...d, kpiMeetings: e.target.value === "" ? null : Number(e.target.value) } : d)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contracted amount</span>
                  <input
                    type="number"
                    value={createClientDraft.contractedAmount ?? ""}
                    onChange={(e) => setCreateClientDraft((d) => d ? { ...d, contractedAmount: e.target.value === "" ? null : Number(e.target.value) } : d)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contract due date</span>
                  <input
                    type="date"
                    value={createClientDraft.contractDueDate}
                    onChange={(e) => setCreateClientDraft((d) => d ? { ...d, contractDueDate: e.target.value } : d)}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
                  />
                </label>
              </div>
              <button
                onClick={() => { void handleCreateClient(); }}
                disabled={isSubmittingCreateClient || !createClientDraft.name.trim() || !createClientDraft.managerId || !createClientDraft.status}
                className="w-full rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmittingCreateClient ? "Creating..." : "Create client"}
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {selectedClient && draft && (
        <ClientDrawer
          client={selectedClient}
          draft={draft}
          setDraft={setDraft}
          conditionPack={selectedConditionPack}
          managerName={selectedManagerName}
          managerUsers={managerUsers}
          clientRoleUsers={clientRoleUsers}
          allClients={clients}
          allUsers={users}
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
