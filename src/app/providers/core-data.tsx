import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
// [TEMP PERF] perf instrumentation — remove with the rest of `[TEMP PERF]` blocks
import { measureSync, perfLog } from "../lib/__perf";
import { RepositoryError, repository } from "../data/repository";
import { createClientMetrics, type ClientMetricsPack } from "../lib/client-metrics";
import { scopeClients } from "../lib/selectors";
import { useAuth } from "./auth";
import type {
  CampaignRecord,
  ClientCustomFieldRecord,
  ClientCustomFieldType,
  ClientCustomFieldValueRecord,
  ClientRecord,
  ClientUserRecord,
  ColumnOverrideRecord,
  ConditionRuleRecord,
  CoreSnapshot,
  DomainRecord,
  EmailExcludeRecord,
  InviteRecord,
  InviteRequest,
  InvoiceRecord,
  LeadRecord,
} from "../types/core";

interface CoreDataContextValue extends CoreSnapshot {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  metricsByClientId: ReadonlyMap<string, ClientMetricsPack>;
  createClient: (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">) => Promise<void>;
  createCampaign: (input: Omit<CampaignRecord, "id" | "created_at" | "updated_at">) => Promise<void>;
  createLead: (input: Omit<LeadRecord, "id" | "created_at" | "updated_at">) => Promise<void>;
  createDomain: (input: Omit<DomainRecord, "id" | "created_at" | "updated_at">) => Promise<void>;
  updateClient: (clientId: string, patch: Partial<ClientRecord>) => Promise<void>;
  updateCampaign: (campaignId: string, patch: Partial<CampaignRecord>) => Promise<void>;
  updateLead: (leadId: string, patch: Partial<LeadRecord>) => Promise<void>;
  updateDomain: (domainId: string, patch: Partial<DomainRecord>) => Promise<void>;
  updateInvoice: (invoiceId: string, patch: Partial<InvoiceRecord>) => Promise<void>;
  createConditionRule: (
    input: Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at" | "created_by"> & { created_by?: string | null },
  ) => Promise<void>;
  updateConditionRule: (
    ruleId: string,
    patch: Partial<Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at">>,
  ) => Promise<void>;
  deleteConditionRule: (ruleId: string) => Promise<void>;
  sendInvite: (payload: InviteRequest) => Promise<void>;
  listInvites: () => Promise<InviteRecord[]>;
  resendInvite: (inviteId: string) => Promise<InviteRecord>;
  revokeInvite: (inviteId: string) => Promise<void>;
  upsertClientUserMapping: (userId: string, clientId: string) => Promise<void>;
  deleteClientUserMapping: (mappingId: string) => Promise<void>;
  upsertEmailExcludeDomain: (domain: string) => Promise<void>;
  deleteEmailExcludeDomain: (domain: string) => Promise<void>;
  upsertColumnOverride: (
    columnKey: string,
    patch: { label_override?: string | null; hidden?: boolean; position?: number | null },
  ) => Promise<void>;
  setColumnOrder: (orderedKeys: string[]) => Promise<void>;
  createClientCustomField: (input: {
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
  }) => Promise<void>;
  updateClientCustomField: (
    fieldId: string,
    patch: {
      name?: string;
      field_type?: ClientCustomFieldType;
      options?: string[] | null;
      position?: number;
    },
  ) => Promise<void>;
  deleteClientCustomField: (fieldId: string) => Promise<void>;
  upsertClientCustomFieldValue: (
    clientId: string,
    fieldId: string,
    value: string | null,
  ) => Promise<void>;
}

const EMPTY_SNAPSHOT: CoreSnapshot = {
  users: [],
  clients: [],
  clientUsers: [],
  campaigns: [],
  leads: [],
  replies: [],
  campaignDailyStats: [],
  dailyStats: [],
  domains: [],
  invoices: [],
  emailExcludeList: [],
  conditionRules: [],
  columnOverrides: [],
  clientCustomFields: [],
  clientCustomFieldValues: [],
};

const CoreDataContext = createContext<CoreDataContextValue | null>(null);

function mapCoreDataError(reason: unknown) {
  if (reason instanceof RepositoryError) {
    if (import.meta.env?.DEV) {
      console.error("[CoreData] repository error", {
        table: reason.table,
        operation: reason.operation,
        kind: reason.kind,
        code: reason.code,
        message: reason.message,
        details: reason.details,
        hint: reason.hint,
      });
    }
    if (reason.kind === "permission") {
      if (reason.table === "invites") {
        return reason.message;
      }
      return `Access to ${reason.table} is blocked by your current permissions.`;
    }
    if (reason.kind === "timeout") {
      return `Loading ${reason.table} timed out on the database (${reason.code ?? "57014"}). A row-level-security or index issue is likely — open DevTools console for details.`;
    }
    if (reason.kind === "network") {
      return `Could not load ${reason.table} because the network connection is unstable. Try again.`;
    }
    const suffix = reason.code ? ` [${reason.code}] ${reason.message}` : ` ${reason.message}`;
    return `Could not ${reason.operation} ${reason.table}.${suffix}`;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return "Failed to load workspace data.";
}

export function CoreDataProvider({ children }: { children: ReactNode }) {
  const { identity, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<CoreSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // [TEMP PERF] trace mount + refresh trigger source — investigating double loadSnapshot
  const mountCountRef = useRef(0);
  const refreshCountRef = useRef(0);
  const prevIdentityRef = useRef<typeof identity>(null);
  const prevAuthLoadingRef = useRef<boolean | null>(null);
  useEffect(() => {
    mountCountRef.current += 1;
    console.log(`[TEMP PERF][snapshot-trace] CoreDataProvider MOUNT #${mountCountRef.current}`);
    return () => {
      console.log(`[TEMP PERF][snapshot-trace] CoreDataProvider UNMOUNT (after ${refreshCountRef.current} refresh calls)`);
    };
  }, []);
  // [TEMP PERF] /end

  const refresh = useCallback(async () => {
    const includeDailyStats = identity?.role !== "client";
    const includeConditionRules = identity?.role !== "client";

    // [TEMP PERF] count refresh invocations
    refreshCountRef.current += 1;
    const refreshId = refreshCountRef.current;
    console.log(`[TEMP PERF][snapshot-trace] refresh() #${refreshId} START (identityId=${identity?.id ?? "null"}, role=${identity?.role ?? "null"})`);
    // [TEMP PERF] /end

    setLoading(true);
    try {
      // [TEMP PERF] time the full refresh (snapshot + condition rules)
      const t0 = performance.now();
      const [snapshotData, conditionRules] = await Promise.all([
        repository.loadSnapshot({ includeDailyStats }),
        includeConditionRules ? repository.loadConditionRules() : Promise.resolve([]),
      ]);
      const totalMs = performance.now() - t0;
      perfLog(`loadSnapshot+conditionRules total: ${totalMs.toFixed(1)} ms`);
      perfLog(
        `snapshot row counts: ` +
          `clients=${snapshotData.clients.length} ` +
          `users=${snapshotData.users.length} ` +
          `clientUsers=${snapshotData.clientUsers.length} ` +
          `campaigns=${snapshotData.campaigns.length} ` +
          `leads=${snapshotData.leads.length} ` +
          `replies=${snapshotData.replies.length} ` +
          `campaignDailyStats=${snapshotData.campaignDailyStats.length} ` +
          `dailyStats=${snapshotData.dailyStats.length} ` +
          `domains=${snapshotData.domains.length} ` +
          `invoices=${snapshotData.invoices.length} ` +
          `emailExcludeList=${snapshotData.emailExcludeList.length} ` +
          `conditionRules=${conditionRules.length}`,
      );
      // [TEMP PERF] per-dataset JSON-size breakdown for payload audit
      const sizeOf = (value: unknown) => {
        try {
          return JSON.stringify(value).length;
        } catch {
          return -1;
        }
      };
      const sizes: Record<string, number> = {
        clients: sizeOf(snapshotData.clients),
        users: sizeOf(snapshotData.users),
        clientUsers: sizeOf(snapshotData.clientUsers),
        campaigns: sizeOf(snapshotData.campaigns),
        leads: sizeOf(snapshotData.leads),
        replies: sizeOf(snapshotData.replies),
        campaignDailyStats: sizeOf(snapshotData.campaignDailyStats),
        dailyStats: sizeOf(snapshotData.dailyStats),
        domains: sizeOf(snapshotData.domains),
        invoices: sizeOf(snapshotData.invoices),
        emailExcludeList: sizeOf(snapshotData.emailExcludeList),
        conditionRules: sizeOf(conditionRules),
      };
      const total = Object.values(sizes).reduce((a, b) => a + (b > 0 ? b : 0), 0);
      const entries = Object.entries(sizes).sort((a, b) => b[1] - a[1]);
      for (const [name, bytes] of entries) {
        const pct = total > 0 ? ((bytes / total) * 100).toFixed(1) : "0.0";
        perfLog(`snapshot size: ${name.padEnd(20)} ${(bytes / 1024).toFixed(1).padStart(9)} KB  (${pct.padStart(5)}%)`);
      }
      perfLog(`snapshot size: TOTAL                ${(total / 1024).toFixed(1).padStart(9)} KB`);
      // [TEMP PERF] /end size-breakdown
      // [TEMP PERF] /end
      startTransition(() => {
        setSnapshot({
          ...snapshotData,
          conditionRules,
        });
        setError(null);
      });
    } catch (reason) {
      setError(mapCoreDataError(reason));
    } finally {
      setLoading(false);
    }
  }, [identity?.role]);

  useEffect(() => {
    // [TEMP PERF] diff the deps so we know what fired this effect
    const identityChanged = prevIdentityRef.current !== identity;
    const authLoadingChanged = prevAuthLoadingRef.current !== authLoading;
    console.log(
      `[TEMP PERF][snapshot-trace] refresh-effect fired ` +
        `(authLoading: ${prevAuthLoadingRef.current} → ${authLoading}${authLoadingChanged ? " *" : ""}, ` +
        `identity ref changed: ${identityChanged}, identityId=${identity?.id ?? "null"})`,
    );
    prevIdentityRef.current = identity;
    prevAuthLoadingRef.current = authLoading;
    // [TEMP PERF] /end
    if (authLoading) return;
    if (!identity) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, identity, refresh]);

  const createClient = useCallback(async (input: Omit<ClientRecord, "id" | "created_at" | "updated_at">) => {
    try {
      const created = await repository.createClient(input);
      startTransition(() => {
        setSnapshot((current) => ({ ...current, clients: [created, ...current.clients] }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const createCampaign = useCallback(async (input: Omit<CampaignRecord, "id" | "created_at" | "updated_at">) => {
    try {
      const created = await repository.createCampaign(input);
      startTransition(() => {
        setSnapshot((current) => ({ ...current, campaigns: [created, ...current.campaigns] }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const createLead = useCallback(async (input: Omit<LeadRecord, "id" | "created_at" | "updated_at">) => {
    try {
      const created = await repository.createLead(input);
      startTransition(() => {
        setSnapshot((current) => ({ ...current, leads: [created, ...current.leads] }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const createDomain = useCallback(async (input: Omit<DomainRecord, "id" | "created_at" | "updated_at">) => {
    try {
      const created = await repository.createDomain(input);
      startTransition(() => {
        setSnapshot((current) => ({ ...current, domains: [created, ...current.domains] }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const updateClient = useCallback(async (clientId: string, patch: Partial<ClientRecord>) => {
    const previous = snapshot.clients.find((item) => item.id === clientId);
    if (!previous) {
      const message = "Client record is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic = { ...previous, ...patch } as ClientRecord;
    setSnapshot((current) => ({
      ...current,
      clients: current.clients.map((item) => (item.id === clientId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateClient(clientId, patch);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          clients: current.clients.map((item) => (item.id === clientId ? updated : item)),
        }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          clients: current.clients.map((item) => (item.id === clientId ? previous : item)),
        }));
      });
    }
  }, [snapshot.clients]);

  const updateCampaign = useCallback(async (campaignId: string, patch: Partial<CampaignRecord>) => {
    const previous = snapshot.campaigns.find((item) => item.id === campaignId);
    if (!previous) {
      const message = "Campaign record is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic = { ...previous, ...patch } as CampaignRecord;
    setSnapshot((current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => (item.id === campaignId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateCampaign(campaignId, patch);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          campaigns: current.campaigns.map((item) => (item.id === campaignId ? updated : item)),
        }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          campaigns: current.campaigns.map((item) => (item.id === campaignId ? previous : item)),
        }));
      });
    }
  }, [snapshot.campaigns]);

  const updateLead = useCallback(async (leadId: string, patch: Partial<LeadRecord>) => {
    const previous = snapshot.leads.find((item) => item.id === leadId);
    if (!previous) {
      const message = "Lead record is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic = { ...previous, ...patch } as LeadRecord;
    setSnapshot((current) => ({
      ...current,
      leads: current.leads.map((item) => (item.id === leadId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateLead(leadId, patch);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          leads: current.leads.map((item) => (item.id === leadId ? updated : item)),
        }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          leads: current.leads.map((item) => (item.id === leadId ? previous : item)),
        }));
      });
    }
  }, [snapshot.leads]);

  const updateDomain = useCallback(async (domainId: string, patch: Partial<DomainRecord>) => {
    const previous = snapshot.domains.find((item) => item.id === domainId);
    if (!previous) {
      const message = "Domain record is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic = { ...previous, ...patch } as DomainRecord;
    setSnapshot((current) => ({
      ...current,
      domains: current.domains.map((item) => (item.id === domainId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateDomain(domainId, patch);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          domains: current.domains.map((item) => (item.id === domainId ? updated : item)),
        }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          domains: current.domains.map((item) => (item.id === domainId ? previous : item)),
        }));
      });
    }
  }, [snapshot.domains]);

  const updateInvoice = useCallback(async (invoiceId: string, patch: Partial<InvoiceRecord>) => {
    const previous = snapshot.invoices.find((item) => item.id === invoiceId);
    if (!previous) {
      const message = "Invoice record is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic = { ...previous, ...patch } as InvoiceRecord;
    setSnapshot((current) => ({
      ...current,
      invoices: current.invoices.map((item) => (item.id === invoiceId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateInvoice(invoiceId, patch);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          invoices: current.invoices.map((item) => (item.id === invoiceId ? updated : item)),
        }));
        setError(null);
      });
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      startTransition(() => {
        setSnapshot((current) => ({
          ...current,
          invoices: current.invoices.map((item) => (item.id === invoiceId ? previous : item)),
        }));
      });
    }
  }, [snapshot.invoices]);

  const createConditionRule = useCallback(async (
    input: Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at" | "created_by"> & { created_by?: string | null },
  ) => {
    try {
      const created = await repository.createConditionRule(input);
      setSnapshot((current) => ({
        ...current,
        conditionRules: current.conditionRules
          .concat(created)
          .slice()
          .sort((left, right) => left.priority - right.priority),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const updateConditionRule = useCallback(async (
    ruleId: string,
    patch: Partial<Omit<ConditionRuleRecord, "id" | "created_at" | "updated_at">>,
  ) => {
    const previous = snapshot.conditionRules.find((item) => item.id === ruleId);
    if (!previous) {
      const message = "Condition rule is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }

    const optimistic: ConditionRuleRecord = {
      ...previous,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    setSnapshot((current) => ({
      ...current,
      conditionRules: current.conditionRules.map((item) => (item.id === ruleId ? optimistic : item)),
    }));

    try {
      const updated = await repository.updateConditionRule(ruleId, patch);
      setSnapshot((current) => ({
        ...current,
        conditionRules: current.conditionRules
          .map((item) => (item.id === ruleId ? updated : item))
          .slice()
          .sort((left, right) => left.priority - right.priority),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        conditionRules: current.conditionRules.map((item) => (item.id === ruleId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, [snapshot.conditionRules]);

  const deleteConditionRule = useCallback(async (ruleId: string) => {
    const previous = snapshot.conditionRules;
    setSnapshot((current) => ({
      ...current,
      conditionRules: current.conditionRules.filter((item) => item.id !== ruleId),
    }));

    try {
      await repository.deleteConditionRule(ruleId);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        conditionRules: previous,
      }));
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, [snapshot.conditionRules]);

  const sendInvite = useCallback(async (payload: InviteRequest) => {
    try {
      await repository.sendInvite(payload);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const listInvites = useCallback(async () => {
    try {
      const invites = await repository.listInvites();
      setError(null);
      return invites;
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const resendInvite = useCallback(async (inviteId: string) => {
    try {
      const invite = await repository.resendInvite(inviteId);
      setError(null);
      return invite;
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const revokeInvite = useCallback(async (inviteId: string) => {
    try {
      await repository.revokeInvite(inviteId);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, []);

  const upsertClientUserMapping = useCallback(async (userId: string, clientId: string) => {
    const previous = snapshot.clientUsers;
    const existing = previous.find((item) => item.user_id === userId);
    const optimistic: ClientUserRecord = existing
      ? { ...existing, client_id: clientId }
      : {
          id: `optimistic:${userId}`,
          created_at: new Date().toISOString(),
          client_id: clientId,
          user_id: userId,
        };

    setSnapshot((current) => ({
      ...current,
      clientUsers: existing
        ? current.clientUsers.map((item) => (item.user_id === userId ? optimistic : item))
        : [optimistic, ...current.clientUsers],
    }));

    try {
      const updated = await repository.upsertClientUserMapping(userId, clientId);
      setSnapshot((current) => ({
        ...current,
        clientUsers: current.clientUsers.some((item) => item.user_id === userId)
          ? current.clientUsers.map((item) => (item.user_id === userId ? updated : item))
          : [updated, ...current.clientUsers],
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        clientUsers: previous,
      }));
      setError(message);
      toast.error(message);
    }
  }, [snapshot.clientUsers]);

  const deleteClientUserMapping = useCallback(async (mappingId: string) => {
    const previous = snapshot.clientUsers;

    setSnapshot((current) => ({
      ...current,
      clientUsers: current.clientUsers.filter((item) => item.id !== mappingId),
    }));

    try {
      await repository.deleteClientUserMapping(mappingId);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        clientUsers: previous,
      }));
      setError(message);
      toast.error(message);
    }
  }, [snapshot.clientUsers]);

  const upsertEmailExcludeDomain = useCallback(async (domain: string) => {
    const normalized = domain.trim().toLowerCase();
    if (!normalized) {
      const message = "Domain value is required.";
      setError(message);
      toast.error(message);
      return;
    }

    const previous = snapshot.emailExcludeList;
    const optimistic: EmailExcludeRecord = {
      domain: normalized,
      created_at: new Date().toISOString(),
    };

    setSnapshot((current) => ({
      ...current,
      emailExcludeList: current.emailExcludeList.some((item) => item.domain === normalized)
        ? current.emailExcludeList
        : [optimistic, ...current.emailExcludeList],
    }));

    try {
      const updated = await repository.upsertEmailExcludeDomain(normalized);
      setSnapshot((current) => ({
        ...current,
        emailExcludeList: current.emailExcludeList.some((item) => item.domain === normalized)
          ? current.emailExcludeList.map((item) => (item.domain === normalized ? updated : item))
          : [updated, ...current.emailExcludeList],
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        emailExcludeList: previous,
      }));
      setError(message);
      toast.error(message);
    }
  }, [snapshot.emailExcludeList]);

  const upsertColumnOverride = useCallback(
    async (
      columnKey: string,
      patch: { label_override?: string | null; hidden?: boolean; position?: number | null },
    ) => {
      try {
        const updated = await repository.upsertColumnOverride(columnKey, patch);
        setSnapshot((current) => {
          const existing = current.columnOverrides.some((item) => item.column_key === columnKey);
          return {
            ...current,
            columnOverrides: existing
              ? current.columnOverrides.map((item) => (item.column_key === columnKey ? updated : item))
              : [...current.columnOverrides, updated],
          };
        });
        setError(null);
      } catch (reason) {
        const message = mapCoreDataError(reason);
        setError(message);
        toast.error(message);
        throw reason;
      }
    },
    [],
  );

  const setColumnOrder = useCallback(async (orderedKeys: string[]) => {
    const previous = snapshot.columnOverrides;
    // Optimistic local update — keeps the table feeling instant on click.
    const optimistic = orderedKeys.map<ColumnOverrideRecord>((key, idx) => {
      const existing = previous.find((o) => o.column_key === key);
      return {
        column_key: key,
        label_override: existing?.label_override ?? null,
        hidden: existing?.hidden ?? false,
        position: idx,
        updated_at: new Date().toISOString(),
        updated_by: existing?.updated_by ?? null,
      };
    });
    setSnapshot((current) => ({ ...current, columnOverrides: optimistic }));
    try {
      const updated = await repository.setColumnOrder(orderedKeys);
      setSnapshot((current) => ({ ...current, columnOverrides: updated }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({ ...current, columnOverrides: previous }));
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, [snapshot.columnOverrides]);

  const createClientCustomField = useCallback(
    async (input: {
      name: string;
      field_type: ClientCustomFieldType;
      options?: string[] | null;
      position?: number;
    }) => {
      try {
        const created = await repository.createClientCustomField(input);
        setSnapshot((current) => ({
          ...current,
          clientCustomFields: [...current.clientCustomFields, created].sort((l, r) => l.position - r.position),
        }));
        setError(null);
      } catch (reason) {
        const message = mapCoreDataError(reason);
        setError(message);
        toast.error(message);
        throw reason;
      }
    },
    [],
  );

  const updateClientCustomField = useCallback(
    async (
      fieldId: string,
      patch: {
        name?: string;
        field_type?: ClientCustomFieldType;
        options?: string[] | null;
        position?: number;
      },
    ) => {
      try {
        const updated = await repository.updateClientCustomField(fieldId, patch);
        setSnapshot((current) => ({
          ...current,
          clientCustomFields: current.clientCustomFields
            .map((item) => (item.id === fieldId ? updated : item))
            .sort((l, r) => l.position - r.position),
        }));
        setError(null);
      } catch (reason) {
        const message = mapCoreDataError(reason);
        setError(message);
        toast.error(message);
        throw reason;
      }
    },
    [],
  );

  const deleteClientCustomField = useCallback(async (fieldId: string) => {
    const previousFields = snapshot.clientCustomFields;
    const previousValues = snapshot.clientCustomFieldValues;
    setSnapshot((current) => ({
      ...current,
      clientCustomFields: current.clientCustomFields.filter((item) => item.id !== fieldId),
      clientCustomFieldValues: current.clientCustomFieldValues.filter((item) => item.field_id !== fieldId),
    }));
    try {
      await repository.deleteClientCustomField(fieldId);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        clientCustomFields: previousFields,
        clientCustomFieldValues: previousValues,
      }));
      setError(message);
      toast.error(message);
      throw reason;
    }
  }, [snapshot.clientCustomFields, snapshot.clientCustomFieldValues]);

  const upsertClientCustomFieldValue = useCallback(
    async (clientId: string, fieldId: string, value: string | null) => {
      try {
        const updated = await repository.upsertClientCustomFieldValue(clientId, fieldId, value);
        setSnapshot((current) => {
          const exists = current.clientCustomFieldValues.some(
            (item) => item.client_id === clientId && item.field_id === fieldId,
          );
          return {
            ...current,
            clientCustomFieldValues: exists
              ? current.clientCustomFieldValues.map((item) =>
                  item.client_id === clientId && item.field_id === fieldId ? updated : item,
                )
              : [...current.clientCustomFieldValues, updated],
          };
        });
        setError(null);
      } catch (reason) {
        const message = mapCoreDataError(reason);
        setError(message);
        toast.error(message);
        throw reason;
      }
    },
    [],
  );

  const deleteEmailExcludeDomain = useCallback(async (domain: string) => {
    const normalized = domain.trim().toLowerCase();
    const previous = snapshot.emailExcludeList;

    setSnapshot((current) => ({
      ...current,
      emailExcludeList: current.emailExcludeList.filter((item) => item.domain !== normalized),
    }));

    try {
      await repository.deleteEmailExcludeDomain(normalized);
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        emailExcludeList: previous,
      }));
      setError(message);
      toast.error(message);
    }
  }, [snapshot.emailExcludeList]);

  const metricsByClientId = useMemo<ReadonlyMap<string, ClientMetricsPack>>(() => {
    // [TEMP PERF] measure global metric-pack build cost
    return measureSync(
      `metricsByClientId (clients=${snapshot.clients.length}, leads=${snapshot.leads.length}, dailyStats=${snapshot.dailyStats.length})`,
      () => {
        const scopedList = identity ? scopeClients(identity, snapshot.clients) : [];
        const clientIds = new Set(scopedList.map((c) => c.id));
        const statsByClient = new Map<string, typeof snapshot.dailyStats>();
        const leadsByClient = new Map<string, typeof snapshot.leads>();
        for (const client of scopedList) {
          statsByClient.set(client.id, []);
          leadsByClient.set(client.id, []);
        }
        for (const stat of snapshot.dailyStats) {
          if (clientIds.has(stat.client_id)) {
            (statsByClient.get(stat.client_id) as typeof snapshot.dailyStats).push(stat);
          }
        }
        for (const lead of snapshot.leads) {
          if (clientIds.has(lead.client_id)) {
            (leadsByClient.get(lead.client_id) as typeof snapshot.leads).push(lead);
          }
        }
        const result = new Map<string, ClientMetricsPack>();
        for (const client of scopedList) {
          result.set(
            client.id,
            createClientMetrics(statsByClient.get(client.id) ?? [], leadsByClient.get(client.id) ?? []),
          );
        }
        return result;
      },
    );
    // [TEMP PERF] /end
  }, [identity, snapshot.clients, snapshot.dailyStats, snapshot.leads]);

  const value = useMemo<CoreDataContextValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh,
      metricsByClientId,
      createClient,
      createCampaign,
      createLead,
      createDomain,
      updateClient,
      updateCampaign,
      updateLead,
      updateDomain,
      updateInvoice,
      createConditionRule,
      updateConditionRule,
      deleteConditionRule,
      sendInvite,
      listInvites,
      resendInvite,
      revokeInvite,
      upsertClientUserMapping,
      deleteClientUserMapping,
      upsertEmailExcludeDomain,
      deleteEmailExcludeDomain,
      upsertColumnOverride,
      setColumnOrder,
      createClientCustomField,
      updateClientCustomField,
      deleteClientCustomField,
      upsertClientCustomFieldValue,
    }),
    [
      deleteEmailExcludeDomain,
      deleteClientUserMapping,
      error,
      listInvites,
      loading,
      metricsByClientId,
      refresh,
      resendInvite,
      revokeInvite,
      sendInvite,
      snapshot,
      createClient,
      createCampaign,
      createLead,
      createDomain,
      updateCampaign,
      updateClient,
      updateDomain,
      updateInvoice,
      updateLead,
      createConditionRule,
      updateConditionRule,
      deleteConditionRule,
      upsertEmailExcludeDomain,
      upsertClientUserMapping,
      upsertColumnOverride,
      setColumnOrder,
      createClientCustomField,
      updateClientCustomField,
      deleteClientCustomField,
      upsertClientCustomFieldValue,
    ],
  );

  return <CoreDataContext.Provider value={value}>{children}</CoreDataContext.Provider>;
}

export function useCoreData() {
  const context = useContext(CoreDataContext);
  if (!context) throw new Error("useCoreData must be used within CoreDataProvider.");
  return context;
}
