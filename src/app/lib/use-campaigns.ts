import { useCallback, useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { CampaignStatsResponse, CampaignsListParams, CampaignsListResponse } from "../types/view-contracts";

export function mapCampaignsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Loading timed out. A database performance issue may be affecting this view.";
    if (reason.kind === "permission") return "Access to campaign data is blocked by your current permissions.";
    if (reason.kind === "network") return "Campaign data could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load campaign data.";
}

/**
 * Fetches a server-filtered/sorted campaigns list. Re-fetches whenever params change.
 * Stale guard: if params change while a request is in-flight, the old response is discarded.
 * This prevents the 30s outlier scenario from overwriting a newer fast response.
 */
export function useCampaignsList(params: CampaignsListParams) {
  const [data, setData] = useState<CampaignsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const paramsKey = JSON.stringify(params);
  // Monotonically-increasing load ID — only the latest response is accepted.
  const loadIdRef = useRef(0);

  const load = useCallback(async (p: CampaignsListParams, id: number) => {
    setLoading(true);
    const t0 = performance.now();
    try {
      const result = await repository.loadCampaignsList(p);
      if (id !== loadIdRef.current) {
        console.log(
          `[PERF][gateway] loadCampaignsList: STALE loadId=${id} current=${loadIdRef.current} ` +
            `elapsed=${(performance.now() - t0).toFixed(1)}ms — discarded`,
        );
        return; // stale: a newer request has already landed
      }
      setData(result);
      setError(null);
      if (import.meta.env.DEV) {
        const params = p;
        console.log(
          `[PERF][gateway] loadCampaignsList: loadId=${id} elapsed=${(performance.now() - t0).toFixed(1)}ms ` +
            `hasSearch=${!!params.search} searchLen=${params.search?.length ?? 0} ` +
            `clientId=${params.clientId ?? "all"} status=${params.status ?? "all"} ` +
            `sortField=${params.sortField} page=${params.page} pageSize=${params.pageSize} ` +
            `rows=${result.rows.length} total=${result.totalCount}` +
            (result._qms ? ` qms=${JSON.stringify(result._qms)}` : ""),
        );
      }
    } catch (reason) {
      if (id !== loadIdRef.current) return;
      setError(mapCampaignsError(reason));
    } finally {
      if (id === loadIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = ++loadIdRef.current;
    void load(params, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => {
    const id = ++loadIdRef.current;
    void load(params, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, paramsKey]);

  return { data, loading, error, refresh };
}

/**
 * Lazily fetches 90-day daily stats for a single campaign when the drawer opens.
 * Fires only when campaignId is non-null. Stale guard prevents old slow responses
 * from overwriting newer ones when the user switches campaigns quickly.
 */
export function useCampaignStats(campaignId: string | null): { data: CampaignStatsResponse | null; loading: boolean } {
  const [data, setData] = useState<CampaignStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!campaignId) { setData(null); return; }
    const id = ++loadIdRef.current;
    setLoading(true);
    setData(null);
    const t0 = performance.now();
    repository.loadCampaignStats(campaignId)
      .then((result) => {
        if (id !== loadIdRef.current) return; // stale
        setData(result);
        if (import.meta.env.DEV) {
          console.log(
            `[PERF][gateway] loadCampaignStats: campaignId=${campaignId} ` +
              `elapsed=${(performance.now() - t0).toFixed(1)}ms rows=${result.rows.length}` +
              (result._qms ? ` qms=${JSON.stringify(result._qms)}` : ""),
          );
        }
      })
      .catch(() => { /* non-fatal: chart stays empty */ })
      .finally(() => { if (id === loadIdRef.current) setLoading(false); });
  }, [campaignId]);

  return { data, loading };
}

/**
 * Fetches 90-day stats for ALL accessible campaigns once on mount.
 * Used by ClientCampaignsPage for getCampaignPerformance (needs full series for timeframe filtering).
 */
export function useAllCampaignStats(): { data: CampaignStatsResponse | null; loading: boolean } {
  const [data, setData] = useState<CampaignStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    repository.loadCampaignStats()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          if (import.meta.env.DEV) {
            console.log(
              `[PERF][gateway] loadCampaignStats (all): elapsed=${(performance.now() - t0).toFixed(1)}ms rows=${result.rows.length}`,
            );
          }
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}
