import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { RepositoryError, repository } from "../data/repository";
import { useAuth } from "./auth";
import type {
  CampaignRecord,
  ClientRecord,
  ClientUserRecord,
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
  updateClient: (clientId: string, patch: Partial<ClientRecord>) => Promise<void>;
  updateCampaign: (campaignId: string, patch: Partial<CampaignRecord>) => Promise<void>;
  updateLead: (leadId: string, patch: Partial<LeadRecord>) => Promise<void>;
  updateDomain: (domainId: string, patch: Partial<DomainRecord>) => Promise<void>;
  updateInvoice: (invoiceId: string, patch: Partial<InvoiceRecord>) => Promise<void>;
  sendInvite: (payload: InviteRequest) => Promise<void>;
  listInvites: () => Promise<InviteRecord[]>;
  resendInvite: (inviteId: string) => Promise<InviteRecord>;
  revokeInvite: (inviteId: string) => Promise<void>;
  upsertClientUserMapping: (userId: string, clientId: string) => Promise<void>;
  deleteClientUserMapping: (mappingId: string) => Promise<void>;
  upsertEmailExcludeDomain: (domain: string) => Promise<void>;
  deleteEmailExcludeDomain: (domain: string) => Promise<void>;
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
};

const CoreDataContext = createContext<CoreDataContextValue | null>(null);

function mapCoreDataError(reason: unknown) {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "permission") {
      if (reason.table === "invites") {
        return reason.message;
      }
      return `Access to ${reason.table} is blocked by your current permissions.`;
    }
    if (reason.kind === "network") {
      return `Could not load ${reason.table} because the network connection is unstable. Try again.`;
    }
    return `Could not ${reason.operation} ${reason.table}. Please retry.`;
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

  const refresh = useCallback(async () => {
    const includeDailyStats = identity?.role !== "client";

    setLoading(true);
    try {
      const next = await repository.loadSnapshot({ includeDailyStats });
      startTransition(() => {
        setSnapshot(next);
        setError(null);
      });
    } catch (reason) {
      setError(mapCoreDataError(reason));
    } finally {
      setLoading(false);
    }
  }, [identity?.role]);

  useEffect(() => {
    if (authLoading) return;
    if (!identity) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, identity, refresh]);

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
      setSnapshot((current) => ({
        ...current,
        clients: current.clients.map((item) => (item.id === clientId ? updated : item)),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        clients: current.clients.map((item) => (item.id === clientId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
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
      setSnapshot((current) => ({
        ...current,
        campaigns: current.campaigns.map((item) => (item.id === campaignId ? updated : item)),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        campaigns: current.campaigns.map((item) => (item.id === campaignId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
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
      setSnapshot((current) => ({
        ...current,
        leads: current.leads.map((item) => (item.id === leadId ? updated : item)),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        leads: current.leads.map((item) => (item.id === leadId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
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
      setSnapshot((current) => ({
        ...current,
        domains: current.domains.map((item) => (item.id === domainId ? updated : item)),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        domains: current.domains.map((item) => (item.id === domainId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
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
      setSnapshot((current) => ({
        ...current,
        invoices: current.invoices.map((item) => (item.id === invoiceId ? updated : item)),
      }));
      setError(null);
    } catch (reason) {
      const message = mapCoreDataError(reason);
      setSnapshot((current) => ({
        ...current,
        invoices: current.invoices.map((item) => (item.id === invoiceId ? previous : item)),
      }));
      setError(message);
      toast.error(message);
    }
  }, [snapshot.invoices]);

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

  const value = useMemo<CoreDataContextValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh,
      updateClient,
      updateCampaign,
      updateLead,
      updateDomain,
      updateInvoice,
      sendInvite,
      listInvites,
      resendInvite,
      revokeInvite,
      upsertClientUserMapping,
      deleteClientUserMapping,
      upsertEmailExcludeDomain,
      deleteEmailExcludeDomain,
    }),
    [
      deleteEmailExcludeDomain,
      deleteClientUserMapping,
      error,
      listInvites,
      loading,
      refresh,
      resendInvite,
      revokeInvite,
      sendInvite,
      snapshot,
      updateCampaign,
      updateClient,
      updateDomain,
      updateInvoice,
      updateLead,
      upsertEmailExcludeDomain,
      upsertClientUserMapping,
    ],
  );

  return <CoreDataContext.Provider value={value}>{children}</CoreDataContext.Provider>;
}

export function useCoreData() {
  const context = useContext(CoreDataContext);
  if (!context) throw new Error("useCoreData must be used within CoreDataProvider.");
  return context;
}
