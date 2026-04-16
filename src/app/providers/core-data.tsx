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
import { repository } from "../data/repository";
import { useAuth } from "./auth";
import type { CampaignRecord, ClientRecord, CoreSnapshot, LeadRecord } from "../types/core";

interface CoreDataContextValue extends CoreSnapshot {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateClient: (clientId: string, patch: Partial<ClientRecord>) => Promise<void>;
  updateCampaign: (campaignId: string, patch: Partial<CampaignRecord>) => Promise<void>;
  updateLead: (leadId: string, patch: Partial<LeadRecord>) => Promise<void>;
}

const EMPTY_SNAPSHOT: CoreSnapshot = {
  users: [],
  clients: [],
  campaigns: [],
  leads: [],
  replies: [],
  campaignDailyStats: [],
  dailyStats: [],
};

const CoreDataContext = createContext<CoreDataContextValue | null>(null);

export function CoreDataProvider({ children }: { children: ReactNode }) {
  const { identity, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<CoreSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await repository.loadSnapshot();
      startTransition(() => {
        setSnapshot(next);
        setError(null);
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Failed to load workspace data.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

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
    const updated = await repository.updateClient(clientId, patch);
    setSnapshot((current) => ({
      ...current,
      clients: current.clients.map((item) => (item.id === clientId ? updated : item)),
    }));
  }, []);

  const updateCampaign = useCallback(async (campaignId: string, patch: Partial<CampaignRecord>) => {
    const updated = await repository.updateCampaign(campaignId, patch);
    setSnapshot((current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => (item.id === campaignId ? updated : item)),
    }));
  }, []);

  const updateLead = useCallback(async (leadId: string, patch: Partial<LeadRecord>) => {
    const updated = await repository.updateLead(leadId, patch);
    setSnapshot((current) => ({
      ...current,
      leads: current.leads.map((item) => (item.id === leadId ? updated : item)),
    }));
  }, []);

  const value = useMemo<CoreDataContextValue>(
    () => ({
      ...snapshot,
      loading,
      error,
      refresh,
      updateClient,
      updateCampaign,
      updateLead,
    }),
    [error, loading, refresh, snapshot, updateCampaign, updateClient, updateLead],
  );

  return <CoreDataContext.Provider value={value}>{children}</CoreDataContext.Provider>;
}

export function useCoreData() {
  const context = useContext(CoreDataContext);
  if (!context) throw new Error("useCoreData must be used within CoreDataProvider.");
  return context;
}
