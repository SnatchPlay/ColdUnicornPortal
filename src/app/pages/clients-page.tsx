import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { Banner, EmptyState, InlineLinkButton, LoadingState, PageHeader, Surface } from "../components/app-ui";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  createClientMetrics,
  type ClientMetricsPack,
  type DodRow,
  type MomRow,
  type ThreeDodRow,
  type WowRow,
} from "../lib/client-metrics";
import { formatDate, formatMoney, formatNumber } from "../lib/format";
import { scopeClients } from "../lib/selectors";
import { useResizableColumns } from "../lib/use-resizable-columns";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { ClientRecord } from "../types/core";

const CLIENT_STATUSES: ClientRecord["status"][] = ["Active", "Abo", "On hold", "Offboarding", "Inactive", "Sales"];
const CLIENT_USER_PLACEHOLDER = "__select_client_user__";
const PAGE_SIZE = 50;
const OVERVIEW_GRID_CLASS =
  "grid min-w-[1820px] gap-3 [grid-template-columns:var(--clients-overview-columns)]";

const DOD_BUCKET_ORDER: Record<string, number> = {
  "+2": 0,
  "+1": 1,
  "0": 2,
  "-1": 3,
  "-2": 4,
  "-3": 5,
  "-4": 6,
};
const THREE_DOD_BUCKET_ORDER: Record<string, number> = {
  "0": 0,
  "-1": 1,
  "-2": 2,
  "-3": 3,
  "-4": 4,
};
const WOW_BUCKET_ORDER: Record<string, number> = {
  "0": 0,
  "-1": 1,
  "-2": 2,
  "-3": 3,
};
const MOM_BUCKET_ORDER: Record<string, number> = {
  "0": 0,
  "-1": 1,
  "-2": 2,
  "-3": 3,
};

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

interface ClientOverviewRow {
  client: ClientRecord;
  managerName: string;
  metrics: ClientMetricsPack["overview"];
}

type SortDirection = "asc" | "desc";
type ClientSortKey =
  | "name"
  | "status"
  | "manager"
  | "schedule"
  | "sent"
  | "threeDodTotal"
  | "threeDodSql"
  | "wowResponse"
  | "wowHuman"
  | "wowBounce"
  | "wowOoo"
  | "wowSql"
  | "momSql"
  | "updated";
type DodSortKey = "bucket" | "schedule" | "sent";
type ThreeDodSortKey = "bucket" | "totalLeads" | "sqlLeads";
type WowSortKey = "bucket" | "totalLeads" | "sqlLeads" | "responseRate" | "humanRate" | "bounceRate" | "oooRate" | "negativeRate";
type MomSortKey = "bucket" | "totalLeads" | "sqlLeads" | "meetings" | "won";

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

function compareBucket(
  left: string,
  right: string,
  direction: SortDirection,
  order: Record<string, number>,
) {
  const leftRank = order[left] ?? Number.MAX_SAFE_INTEGER;
  const rightRank = order[right] ?? Number.MAX_SAFE_INTEGER;
  return compareNumber(leftRank, rightRank, direction);
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) return "sort";
  return direction === "asc" ? "asc" : "desc";
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

function formatMetricCell(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatTriple(left: number | null | undefined, middle: number | null | undefined, right: number | null | undefined) {
  return `${formatMetricCell(left)} / ${formatMetricCell(middle)} / ${formatMetricCell(right)}`;
}

export function ClientsPage() {
  const { identity } = useAuth();
  const {
    clients,
    users,
    clientUsers,
    leads,
    dailyStats,
    updateClient,
    sendInvite,
    upsertClientUserMapping,
    deleteClientUserMapping,
    loading,
    error,
    refresh,
  } = useCoreData();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [visibleRowsCount, setVisibleRowsCount] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<ClientDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [mappingUserId, setMappingUserId] = useState("");
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: "info" | "warning" | "danger"; text: string } | null>(null);
  const [clientSort, setClientSort] = useState<{ key: ClientSortKey; direction: SortDirection }>({
    key: "updated",
    direction: "desc",
  });
  const [dodSort, setDodSort] = useState<{ key: DodSortKey; direction: SortDirection }>({
    key: "bucket",
    direction: "asc",
  });
  const [threeDodSort, setThreeDodSort] = useState<{ key: ThreeDodSortKey; direction: SortDirection }>({
    key: "bucket",
    direction: "asc",
  });
  const [wowSort, setWowSort] = useState<{ key: WowSortKey; direction: SortDirection }>({
    key: "bucket",
    direction: "asc",
  });
  const [momSort, setMomSort] = useState<{ key: MomSortKey; direction: SortDirection }>({
    key: "bucket",
    direction: "asc",
  });
  const overviewColumns = useResizableColumns({
    storageKey: "table:clients:overview-columns",
    defaultWidths: [240, 160, 190, 230, 230, 170, 170, 180, 170, 170, 170, 150, 150, 150],
    minWidths: [160, 130, 140, 170, 170, 130, 130, 130, 130, 130, 130, 120, 120, 120],
  });
  const dodColumns = useResizableColumns({
    storageKey: "table:clients:dod-columns",
    defaultWidths: [130, 220, 220],
    minWidths: [100, 140, 140],
  });
  const threeDodColumns = useResizableColumns({
    storageKey: "table:clients:three-dod-columns",
    defaultWidths: [130, 220, 220],
    minWidths: [100, 140, 140],
  });
  const wowColumns = useResizableColumns({
    storageKey: "table:clients:wow-columns",
    defaultWidths: [100, 130, 130, 150, 150, 150, 150, 150],
    minWidths: [80, 100, 100, 110, 110, 110, 110, 110],
  });
  const momColumns = useResizableColumns({
    storageKey: "table:clients:mom-columns",
    defaultWidths: [120, 170, 170, 170, 170],
    minWidths: [90, 120, 120, 120, 120],
  });
  const overviewTableStyle = useMemo(
    () =>
      ({
        "--clients-overview-columns": overviewColumns.template,
      }) as CSSProperties,
    [overviewColumns.template],
  );
  const dodTableStyle = useMemo(
    () =>
      ({
        "--clients-dod-columns": dodColumns.template,
      }) as CSSProperties,
    [dodColumns.template],
  );
  const threeDodTableStyle = useMemo(
    () =>
      ({
        "--clients-three-dod-columns": threeDodColumns.template,
      }) as CSSProperties,
    [threeDodColumns.template],
  );
  const wowTableStyle = useMemo(
    () =>
      ({
        "--clients-wow-columns": wowColumns.template,
      }) as CSSProperties,
    [wowColumns.template],
  );
  const momTableStyle = useMemo(
    () =>
      ({
        "--clients-mom-columns": momColumns.template,
      }) as CSSProperties,
    [momColumns.template],
  );

  const scopedClients = useMemo(() => (identity ? scopeClients(identity, clients) : []), [clients, identity]);
  const managerUsers = useMemo(() => users.filter((item) => item.role === "manager"), [users]);
  const clientRoleUsers = useMemo(() => users.filter((item) => item.role === "client"), [users]);
  const managerById = useMemo(() => new Map(managerUsers.map((manager) => [manager.id, manager])), [managerUsers]);

  const scopedClientIds = useMemo(() => new Set(scopedClients.map((item) => item.id)), [scopedClients]);
  const metricsByClientId = useMemo(() => {
    const statsByClient = new Map<string, typeof dailyStats>();
    const leadsByClient = new Map<string, typeof leads>();

    for (const client of scopedClients) {
      statsByClient.set(client.id, []);
      leadsByClient.set(client.id, []);
    }

    for (const stat of dailyStats) {
      if (!scopedClientIds.has(stat.client_id)) continue;
      (statsByClient.get(stat.client_id) as typeof dailyStats).push(stat);
    }

    for (const lead of leads) {
      if (!scopedClientIds.has(lead.client_id)) continue;
      (leadsByClient.get(lead.client_id) as typeof leads).push(lead);
    }

    const byClient = new Map<string, ClientMetricsPack>();
    for (const client of scopedClients) {
      byClient.set(client.id, createClientMetrics(statsByClient.get(client.id) ?? [], leadsByClient.get(client.id) ?? []));
    }

    return byClient;
  }, [dailyStats, leads, scopedClientIds, scopedClients]);

  const overviewRows = useMemo<ClientOverviewRow[]>(() => {
    return scopedClients.map((client) => {
      const manager = managerById.get(client.manager_id);
      const managerName = manager ? `${manager.first_name} ${manager.last_name}`.trim() : "Unassigned";
      const metrics = metricsByClientId.get(client.id) ?? createClientMetrics([], []);
      return {
        client,
        managerName,
        metrics: metrics.overview,
      };
    });
  }, [managerById, metricsByClientId, scopedClients]);

  const sortedOverviewRows = useMemo(() => {
    return overviewRows.slice().sort((left, right) => {
      if (clientSort.key === "name") {
        return compareText(left.client.name, right.client.name, clientSort.direction);
      }
      if (clientSort.key === "status") {
        return compareText(left.client.status, right.client.status, clientSort.direction);
      }
      if (clientSort.key === "manager") {
        return compareText(left.managerName, right.managerName, clientSort.direction);
      }
      if (clientSort.key === "schedule") {
        return compareNumber(left.metrics.scheduleToday, right.metrics.scheduleToday, clientSort.direction);
      }
      if (clientSort.key === "sent") {
        return compareNumber(left.metrics.sentToday, right.metrics.sentToday, clientSort.direction);
      }
      if (clientSort.key === "threeDodTotal") {
        return compareNumber(left.metrics.threeDodTotal, right.metrics.threeDodTotal, clientSort.direction);
      }
      if (clientSort.key === "threeDodSql") {
        return compareNumber(left.metrics.threeDodSql, right.metrics.threeDodSql, clientSort.direction);
      }
      if (clientSort.key === "wowResponse") {
        return compareNumber(left.metrics.wowResponseRate, right.metrics.wowResponseRate, clientSort.direction);
      }
      if (clientSort.key === "wowHuman") {
        return compareNumber(left.metrics.wowHumanRate, right.metrics.wowHumanRate, clientSort.direction);
      }
      if (clientSort.key === "wowBounce") {
        return compareNumber(left.metrics.wowBounceRate, right.metrics.wowBounceRate, clientSort.direction);
      }
      if (clientSort.key === "wowOoo") {
        return compareNumber(left.metrics.wowOooRate, right.metrics.wowOooRate, clientSort.direction);
      }
      if (clientSort.key === "wowSql") {
        return compareNumber(left.metrics.wowSql, right.metrics.wowSql, clientSort.direction);
      }
      if (clientSort.key === "momSql") {
        return compareNumber(left.metrics.momSql, right.metrics.momSql, clientSort.direction);
      }
      return compareText(left.client.updated_at, right.client.updated_at, clientSort.direction);
    });
  }, [clientSort.direction, clientSort.key, overviewRows]);

  const visibleOverviewRows = useMemo(() => sortedOverviewRows.slice(0, visibleRowsCount), [sortedOverviewRows, visibleRowsCount]);
  const hasMoreClients = visibleRowsCount < sortedOverviewRows.length;

  const selectedClient = useMemo(
    () => scopedClients.find((item) => item.id === selectedClientId) ?? null,
    [scopedClients, selectedClientId],
  );
  const selectedClientMetrics = useMemo(
    () => (selectedClient ? metricsByClientId.get(selectedClient.id) ?? createClientMetrics([], []) : null),
    [metricsByClientId, selectedClient],
  );

  const selectedClientMappings = useMemo(
    () => (selectedClient ? clientUsers.filter((item) => item.client_id === selectedClient.id) : []),
    [clientUsers, selectedClient],
  );

  const clientById = useMemo(() => new Map(clients.map((item) => [item.id, item.name])), [clients]);
  const mappingByUserId = useMemo(() => new Map(clientUsers.map((item) => [item.user_id, item])), [clientUsers]);

  const selectedMapping = useMemo(
    () => clientUsers.find((item) => item.user_id === mappingUserId) ?? null,
    [clientUsers, mappingUserId],
  );

  const selectedMappingClientName = useMemo(() => {
    if (!selectedMapping) return null;
    return clients.find((item) => item.id === selectedMapping.client_id)?.name ?? "Unknown client";
  }, [clients, selectedMapping]);

  const selectedManagerName = useMemo(() => {
    if (!selectedClient) return "-";
    const manager = users.find((item) => item.id === selectedClient.manager_id);
    if (!manager) return "-";
    return `${manager.first_name} ${manager.last_name}`.trim();
  }, [selectedClient, users]);

  const canEditAssignments = identity?.role === "admin" || identity?.role === "super_admin";
  const canInviteUsers = identity?.role === "admin" || identity?.role === "super_admin" || identity?.role === "manager";

  useEffect(() => {
    setVisibleRowsCount(PAGE_SIZE);
    if (selectedClientId && !scopedClients.some((item) => item.id === selectedClientId)) {
      setSelectedClientId(null);
    }
  }, [scopedClients, selectedClientId]);

  useEffect(() => {
    if (!selectedClient) {
      setDraft(null);
      setMappingUserId("");
      setInviteEmail("");
      setInviteMessage(null);
      return;
    }

    setDraft(toClientDraft(selectedClient));
    setMappingUserId("");
    setInviteEmail("");
    setInviteMessage(null);
  }, [selectedClient]);

  useEffect(() => {
    if (!selectedClient) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedClientId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClient]);

  const draftPatch = useMemo(() => {
    if (!selectedClient || !draft) return {};
    return buildClientPatch(selectedClient, draft, canEditAssignments);
  }, [canEditAssignments, draft, selectedClient]);

  const isDraftDirty = Object.keys(draftPatch).length > 0;

  const sortedDodRows = useMemo(() => {
    if (!selectedClientMetrics) return [];
    return selectedClientMetrics.dodRows.slice().sort((left, right) => {
      if (dodSort.key === "bucket") {
        return compareBucket(left.bucket, right.bucket, dodSort.direction, DOD_BUCKET_ORDER);
      }
      if (dodSort.key === "schedule") {
        return compareNumber(left.schedule, right.schedule, dodSort.direction);
      }
      return compareNumber(left.sent, right.sent, dodSort.direction);
    });
  }, [dodSort.direction, dodSort.key, selectedClientMetrics]);

  const sortedThreeDodRows = useMemo(() => {
    if (!selectedClientMetrics) return [];
    return selectedClientMetrics.threeDodRows.slice().sort((left, right) => {
      if (threeDodSort.key === "bucket") {
        return compareBucket(left.bucket, right.bucket, threeDodSort.direction, THREE_DOD_BUCKET_ORDER);
      }
      if (threeDodSort.key === "totalLeads") {
        return compareNumber(left.totalLeads, right.totalLeads, threeDodSort.direction);
      }
      return compareNumber(left.sqlLeads, right.sqlLeads, threeDodSort.direction);
    });
  }, [selectedClientMetrics, threeDodSort.direction, threeDodSort.key]);

  const sortedWowRows = useMemo(() => {
    if (!selectedClientMetrics) return [];
    return selectedClientMetrics.wowRows.slice().sort((left, right) => {
      if (wowSort.key === "bucket") {
        return compareBucket(left.bucket, right.bucket, wowSort.direction, WOW_BUCKET_ORDER);
      }
      if (wowSort.key === "totalLeads") {
        return compareNumber(left.totalLeads, right.totalLeads, wowSort.direction);
      }
      if (wowSort.key === "sqlLeads") {
        return compareNumber(left.sqlLeads, right.sqlLeads, wowSort.direction);
      }
      if (wowSort.key === "responseRate") {
        return compareNumber(left.responseRate, right.responseRate, wowSort.direction);
      }
      if (wowSort.key === "humanRate") {
        return compareNumber(left.humanRate, right.humanRate, wowSort.direction);
      }
      if (wowSort.key === "bounceRate") {
        return compareNumber(left.bounceRate, right.bounceRate, wowSort.direction);
      }
      if (wowSort.key === "oooRate") {
        return compareNumber(left.oooRate, right.oooRate, wowSort.direction);
      }
      return compareNumber(left.negativeRate, right.negativeRate, wowSort.direction);
    });
  }, [selectedClientMetrics, wowSort.direction, wowSort.key]);

  const sortedMomRows = useMemo(() => {
    if (!selectedClientMetrics) return [];
    return selectedClientMetrics.momRows.slice().sort((left, right) => {
      if (momSort.key === "bucket") {
        return compareBucket(left.bucket, right.bucket, momSort.direction, MOM_BUCKET_ORDER);
      }
      if (momSort.key === "totalLeads") {
        return compareNumber(left.totalLeads, right.totalLeads, momSort.direction);
      }
      if (momSort.key === "sqlLeads") {
        return compareNumber(left.sqlLeads, right.sqlLeads, momSort.direction);
      }
      if (momSort.key === "meetings") {
        return compareNumber(left.meetings, right.meetings, momSort.direction);
      }
      return compareNumber(left.won, right.won, momSort.direction);
    });
  }, [momSort.direction, momSort.key, selectedClientMetrics]);

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

    if (!selectedClient) {
      setInviteMessage({ tone: "warning", text: "Select a client before inviting a client user." });
      return;
    }

    setIsSendingInvite(true);
    setInviteMessage(null);
    try {
      await sendInvite({
        email: normalizedEmail,
        role: "client",
        clientId: selectedClient.id,
      });
      setInviteEmail("");
      setInviteMessage({ tone: "info", text: `Client invitation sent to ${normalizedEmail}.` });
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
        subtitle="Primary analytics hub for manager/admin quick analysis with drawer-based drill-down."
      />

      {scopedClients.length === 0 ? (
        <EmptyState title="No clients assigned" description="The current identity does not have any visible clients." />
      ) : (
        <Surface title="Client analytics table" subtitle={`${visibleOverviewRows.length} of ${sortedOverviewRows.length} clients in current scope`}>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="overflow-x-auto" style={overviewTableStyle}>
              <div className={`${OVERVIEW_GRID_CLASS} border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground`}>
                {[
                  { key: "name" as const, label: "Client", defaultDirection: "asc" as SortDirection },
                  { key: "status" as const, label: "Status", defaultDirection: "asc" as SortDirection },
                  { key: "manager" as const, label: "Manager", defaultDirection: "asc" as SortDirection },
                  { key: "schedule" as const, label: "DoD schedule +2/+1/0", defaultDirection: "desc" as SortDirection },
                  { key: "sent" as const, label: "DoD sent 0/-1/-2", defaultDirection: "desc" as SortDirection },
                  { key: "threeDodTotal" as const, label: "3DoD total", defaultDirection: "desc" as SortDirection },
                  { key: "threeDodSql" as const, label: "3DoD SQL", defaultDirection: "desc" as SortDirection },
                  { key: "wowResponse" as const, label: "WoW response", defaultDirection: "desc" as SortDirection },
                  { key: "wowHuman" as const, label: "WoW human", defaultDirection: "desc" as SortDirection },
                  { key: "wowBounce" as const, label: "WoW bounce", defaultDirection: "desc" as SortDirection },
                  { key: "wowOoo" as const, label: "WoW OOO", defaultDirection: "desc" as SortDirection },
                  { key: "wowSql" as const, label: "WoW SQL", defaultDirection: "desc" as SortDirection },
                  { key: "momSql" as const, label: "MoM SQL", defaultDirection: "desc" as SortDirection },
                  { key: "updated" as const, label: "Updated", defaultDirection: "desc" as SortDirection },
                ].map((column, index, collection) => (
                  <div key={column.key} className="relative min-w-0">
                    <button
                      onClick={() =>
                        setClientSort((current) =>
                          current.key === column.key
                            ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                            : { key: column.key, direction: column.defaultDirection },
                        )
                      }
                      className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                    >
                      {column.label} ({sortIndicator(clientSort.key === column.key, clientSort.direction)})
                    </button>
                    {index < collection.length - 1 && (
                      <div onMouseDown={overviewColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                    )}
                  </div>
                ))}
              </div>

              <div className="min-w-[1820px] divide-y divide-border">
                {visibleOverviewRows.map((row) => {
                  const isActive = selectedClient?.id === row.client.id;
                  return (
                    <button
                      key={row.client.id}
                      onClick={() => setSelectedClientId(row.client.id)}
                      aria-label={`Open details for ${row.client.name}`}
                      className={`${OVERVIEW_GRID_CLASS} w-max px-4 py-4 text-left transition ${isActive ? "bg-sky-500/10" : "hover:bg-white/5"}`}
                    >
                      <div>
                        <p className="text-sm">{row.client.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatMoney(row.client.contracted_amount)}</p>
                      </div>
                      <div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs">{row.client.status}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{row.managerName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatTriple(
                          row.metrics.scheduleDayAfter,
                          row.metrics.scheduleTomorrow,
                          row.metrics.scheduleToday,
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatTriple(row.metrics.sentToday, row.metrics.sentYesterday, row.metrics.sentTwoDaysAgo)}
                      </p>
                      <p className="text-sm text-muted-foreground">{formatMetricCell(row.metrics.threeDodTotal)}</p>
                      <p className="text-sm text-muted-foreground">{formatMetricCell(row.metrics.threeDodSql)}</p>
                      <p className="text-sm text-muted-foreground">{formatRate(row.metrics.wowResponseRate)}</p>
                      <p className="text-sm text-muted-foreground">{formatRate(row.metrics.wowHumanRate)}</p>
                      <p className="text-sm text-muted-foreground">{formatRate(row.metrics.wowBounceRate)}</p>
                      <p className="text-sm text-muted-foreground">{formatRate(row.metrics.wowOooRate)}</p>
                      <p className="text-sm text-muted-foreground">{formatMetricCell(row.metrics.wowSql)}</p>
                      <p className="text-sm text-muted-foreground">{formatMetricCell(row.metrics.momSql)}</p>
                      <p className="text-sm text-muted-foreground">{formatDate(row.client.updated_at, { day: "2-digit", month: "short" })}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

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

      {selectedClient && draft && selectedClientMetrics && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => setSelectedClientId(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedClient.name} details`}
            className="flex h-full w-full max-w-[980px] flex-col border-l border-border bg-[#050505] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-6">
              <div>
                <h2 className="text-xl">{selectedClient.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Client workspace grouped by summary, performance metrics, configuration, and user access.
                </p>
              </div>
              <button
                onClick={() => setSelectedClientId(null)}
                className="rounded-xl border border-border p-2 text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
                aria-label="Close client details"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
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

              <section className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                <div className="space-y-1">
                  <p className="text-sm">Client summary</p>
                  <p className="text-xs text-muted-foreground">Quick context for ownership, contract, and automation flags.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Assigned manager</p>
                    <p className="mt-2 text-sm">{selectedManagerName}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contract amount</p>
                    <p className="mt-2 text-sm">{formatMoney(selectedClient.contracted_amount)}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-black/10 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Contract due date</p>
                    <p className="mt-2 text-sm">{formatDate(selectedClient.contract_due_date)}</p>
                  </div>
                  <label className="rounded-2xl border border-border bg-black/10 p-4">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auto OOO</span>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm">{draft.autoOooEnabled ? "Enabled" : "Disabled"}</span>
                      <Checkbox
                        checked={draft.autoOooEnabled}
                        onCheckedChange={(checked) =>
                          setDraft((current) => (current ? { ...current, autoOooEnabled: checked === true } : current))
                        }
                        className="h-4 w-4"
                      />
                    </div>
                  </label>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                <div className="space-y-1">
                  <p className="text-sm">Performance metrics</p>
                  <p className="text-xs text-muted-foreground">DoD, 3DoD, WoW, and MoM metric tables for fast comparison.</p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">DoD (schedule and sent)</p>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <div className="overflow-x-auto" style={dodTableStyle}>
                      <div className="grid min-w-[680px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground [grid-template-columns:var(--clients-dod-columns)]">
                        {[
                          { key: "bucket" as const, label: "Offset" },
                          { key: "schedule" as const, label: "Planned emails" },
                          { key: "sent" as const, label: "Sent emails" },
                        ].map((column, index, collection) => (
                          <div key={column.key} className="relative min-w-0">
                            <button
                              onClick={() =>
                                setDodSort((current) =>
                                  current.key === column.key
                                    ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                                    : { key: column.key, direction: column.key === "bucket" ? "asc" : "desc" },
                                )
                              }
                              className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                            >
                              {column.label} ({sortIndicator(dodSort.key === column.key, dodSort.direction)})
                            </button>
                            {index < collection.length - 1 && (
                              <div onMouseDown={dodColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="min-w-[680px] divide-y divide-border">
                        {sortedDodRows.map((row: DodRow) => (
                          <div key={row.bucket} className="grid min-w-[680px] gap-3 px-4 py-3 text-sm [grid-template-columns:var(--clients-dod-columns)]">
                            <span>{row.bucket}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.schedule)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.sent)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">3DoD leads</p>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <div className="overflow-x-auto" style={threeDodTableStyle}>
                      <div className="grid min-w-[680px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground [grid-template-columns:var(--clients-three-dod-columns)]">
                        {[
                          { key: "bucket" as const, label: "Offset" },
                          { key: "totalLeads" as const, label: "Total leads" },
                          { key: "sqlLeads" as const, label: "SQL leads" },
                        ].map((column, index, collection) => (
                          <div key={column.key} className="relative min-w-0">
                            <button
                              onClick={() =>
                                setThreeDodSort((current) =>
                                  current.key === column.key
                                    ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                                    : { key: column.key, direction: column.key === "bucket" ? "asc" : "desc" },
                                )
                              }
                              className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                            >
                              {column.label} ({sortIndicator(threeDodSort.key === column.key, threeDodSort.direction)})
                            </button>
                            {index < collection.length - 1 && (
                              <div onMouseDown={threeDodColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="min-w-[680px] divide-y divide-border">
                        {sortedThreeDodRows.map((row: ThreeDodRow) => (
                          <div key={row.bucket} className="grid min-w-[680px] gap-3 px-4 py-3 text-sm [grid-template-columns:var(--clients-three-dod-columns)]">
                            <span>{row.bucket}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.totalLeads)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.sqlLeads)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">WoW rates and leads</p>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <div className="overflow-x-auto" style={wowTableStyle}>
                      <div className="grid min-w-[980px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground [grid-template-columns:var(--clients-wow-columns)]">
                        {[
                          { key: "bucket" as const, label: "Week" },
                          { key: "totalLeads" as const, label: "Total" },
                          { key: "sqlLeads" as const, label: "SQL" },
                          { key: "responseRate" as const, label: "Response" },
                          { key: "humanRate" as const, label: "Human" },
                          { key: "bounceRate" as const, label: "Bounce" },
                          { key: "oooRate" as const, label: "OOO" },
                          { key: "negativeRate" as const, label: "Negative" },
                        ].map((column, index, collection) => (
                          <div key={column.key} className="relative min-w-0">
                            <button
                              onClick={() =>
                                setWowSort((current) =>
                                  current.key === column.key
                                    ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                                    : { key: column.key, direction: column.key === "bucket" ? "asc" : "desc" },
                                )
                              }
                              className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                            >
                              {column.label} ({sortIndicator(wowSort.key === column.key, wowSort.direction)})
                            </button>
                            {index < collection.length - 1 && (
                              <div onMouseDown={wowColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="min-w-[980px] divide-y divide-border">
                        {sortedWowRows.map((row: WowRow) => (
                          <div key={row.bucket} className="grid min-w-[980px] gap-3 px-4 py-3 text-sm [grid-template-columns:var(--clients-wow-columns)]">
                            <span>{row.bucket}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.totalLeads)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.sqlLeads)}</span>
                            <span className="text-muted-foreground">{formatRate(row.responseRate)}</span>
                            <span className="text-muted-foreground">{formatRate(row.humanRate)}</span>
                            <span className="text-muted-foreground">{formatRate(row.bounceRate)}</span>
                            <span className="text-muted-foreground">{formatRate(row.oooRate)}</span>
                            <span className="text-muted-foreground">{formatRate(row.negativeRate)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">MoM pipeline</p>
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <div className="overflow-x-auto" style={momTableStyle}>
                      <div className="grid min-w-[800px] gap-3 border-b border-border bg-black/20 px-4 py-3 text-xs uppercase tracking-[0.16em] text-muted-foreground [grid-template-columns:var(--clients-mom-columns)]">
                        {[
                          { key: "bucket" as const, label: "Month" },
                          { key: "totalLeads" as const, label: "Total leads" },
                          { key: "sqlLeads" as const, label: "SQL leads" },
                          { key: "meetings" as const, label: "Meetings" },
                          { key: "won" as const, label: "Won" },
                        ].map((column, index, collection) => (
                          <div key={column.key} className="relative min-w-0">
                            <button
                              onClick={() =>
                                setMomSort((current) =>
                                  current.key === column.key
                                    ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                                    : { key: column.key, direction: column.key === "bucket" ? "asc" : "desc" },
                                )
                              }
                              className="w-full pr-3 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground transition hover:text-white"
                            >
                              {column.label} ({sortIndicator(momSort.key === column.key, momSort.direction)})
                            </button>
                            {index < collection.length - 1 && (
                              <div onMouseDown={momColumns.getResizeMouseDown(index)} className="absolute -right-1 top-0 h-full w-2 cursor-col-resize rounded-sm bg-transparent transition hover:bg-white/20" />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="min-w-[800px] divide-y divide-border">
                        {sortedMomRows.map((row: MomRow) => (
                          <div key={row.bucket} className="grid min-w-[800px] gap-3 px-4 py-3 text-sm [grid-template-columns:var(--clients-mom-columns)]">
                            <span>{row.bucket}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.totalLeads)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.sqlLeads)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.meetings)}</span>
                            <span className="text-muted-foreground">{formatMetricCell(row.won)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                <div className="space-y-1">
                  <p className="text-sm">Client configuration</p>
                  <p className="text-xs text-muted-foreground">Core settings used by campaign operations.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client display name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client lifecycle status</span>
                    <Select
                      value={draft.status}
                      onValueChange={(value) =>
                        setDraft((current) => (current ? { ...current, status: value as ClientRecord["status"] } : current))
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
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Minimum emails per day</span>
                    <input
                      type="number"
                      value={draft.minDailySent}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const value = Number(event.target.value);
                          return { ...current, minDailySent: Number.isFinite(value) ? Math.max(0, value) : 0 };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Active inbox count</span>
                    <input
                      type="number"
                      value={draft.inboxesCount}
                      onChange={(event) =>
                        setDraft((current) => {
                          if (!current) return current;
                          const value = Number(event.target.value);
                          return { ...current, inboxesCount: Number.isFinite(value) ? Math.max(0, value) : 0 };
                        })
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Notification email recipients</span>
                    <textarea
                      rows={3}
                      value={draft.notificationEmails}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, notificationEmails: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">SMS alert phone numbers</span>
                    <textarea
                      rows={3}
                      value={draft.smsPhoneNumbers}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, smsPhoneNumbers: event.target.value } : current))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  {canEditAssignments && (
                    <label className="space-y-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Assigned manager</span>
                      <Select
                        value={draft.managerId || undefined}
                        onValueChange={(value) => setDraft((current) => (current ? { ...current, managerId: value } : current))}
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

                <label className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Setup notes</span>
                  <textarea
                    rows={4}
                    value={draft.setupInfo}
                    onChange={(event) => setDraft((current) => (current ? { ...current, setupInfo: event.target.value } : current))}
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                  />
                </label>
              </section>

              <section className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                <div className="space-y-1">
                  <p className="text-sm">User access management</p>
                  <p className="text-xs text-muted-foreground">
                    Invite client users and manage active client-user mappings in one place.
                  </p>
                </div>

                {canInviteUsers && (
                  <div className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                    <div className="space-y-1">
                      <p className="text-sm">Invite a client portal user</p>
                      <p className="text-xs text-muted-foreground">Invite target is fixed to {selectedClient.name}.</p>
                    </div>
                    {inviteMessage && <Banner tone={inviteMessage.tone}>{inviteMessage.text}</Banner>}
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[16rem] flex-1 space-y-2">
                        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">User email</span>
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          placeholder="name@company.com"
                          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                        />
                      </label>
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
                )}

                {canEditAssignments && (
                  <div className="space-y-4 rounded-2xl border border-border bg-black/10 p-4">
                    <div className="space-y-1">
                      <p className="text-sm">Active client-user mappings</p>
                      <p className="text-xs text-muted-foreground">
                        Each client user can be linked to one client. Re-assignment moves access to this client.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                      <label className="min-w-[16rem] flex-1 space-y-2">
                        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client user account</span>
                        <Select
                          value={mappingUserId || CLIENT_USER_PLACEHOLDER}
                          onValueChange={(value) => setMappingUserId(value === CLIENT_USER_PLACEHOLDER ? "" : value)}
                        >
                          <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                            <SelectValue placeholder="Select a client user account" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                            <SelectItem value={CLIENT_USER_PLACEHOLDER} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                              Select a client user account
                            </SelectItem>
                            {clientRoleUsers.map((user) => {
                              const mapping = mappingByUserId.get(user.id);
                              const mappedClientName = mapping ? clientById.get(mapping.client_id) ?? "Unknown client" : null;
                              return (
                                <SelectItem key={user.id} value={user.id} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                                  {`${user.first_name} ${user.last_name}`.trim()} - {user.email}
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
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

