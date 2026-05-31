import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { AnalyticsOverviewPayload, ClientDashboardPayload } from "../types/view-contracts";

function mapAnalyticsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Analytics loading timed out.";
    if (reason.kind === "permission") return "Access to analytics data is blocked by your current permissions.";
    if (reason.kind === "network") return "Analytics data could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load analytics data.";
}

/**
 * Loads the internal analytics overview (Phase 6). Stale guard prevents slow
 * in-flight responses from overwriting a newer state.
 */
export function useAnalyticsOverview() {
  const [data, setData] = useState<AnalyticsOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  const load = () => {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadAnalyticsOverview()
      .then((result) => {
        if (id !== loadIdRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((reason) => {
        if (id !== loadIdRef.current) return;
        setError(mapAnalyticsError(reason));
      })
      .finally(() => {
        if (id === loadIdRef.current) setLoading(false);
      });
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { load(); };

  return { data, loading, error, refresh };
}

/**
 * Loads the client analytics data. Reuses loadClientDashboard — the payload already
 * contains everything ClientStatisticsPage needs (client lite, campaigns, lead projections,
 * campaignDailyStats 90d, dailyStats 180d). Stale guard on clientId change.
 */
export function useClientAnalytics(clientId: string | null) {
  const [data, setData] = useState<ClientDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!clientId) { setData(null); setLoading(false); return; }
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadClientDashboard(clientId)
      .then((result) => {
        if (id !== loadIdRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((reason) => {
        if (id !== loadIdRef.current) return;
        setError(mapAnalyticsError(reason));
      })
      .finally(() => {
        if (id === loadIdRef.current) setLoading(false);
      });
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    if (!clientId) return;
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadClientDashboard(clientId)
      .then((result) => { if (id === loadIdRef.current) { setData(result); setError(null); } })
      .catch((reason) => { if (id === loadIdRef.current) setError(mapAnalyticsError(reason)); })
      .finally(() => { if (id === loadIdRef.current) setLoading(false); });
  };

  return { data, loading, error, refresh };
}
