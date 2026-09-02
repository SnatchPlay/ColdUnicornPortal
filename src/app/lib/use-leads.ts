import { useCallback, useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { LeadDetailResult, LeadsFilterOptions, LeadsListParams, LeadsListResponse } from "../types/view-contracts";
import type { LeadTaskRecord, ReplyRecord } from "../types/core";

export function mapLeadsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Loading timed out. A database performance issue may be affecting this view.";
    if (reason.kind === "permission") return "Access to lead data is blocked by your current permissions.";
    if (reason.kind === "network") return "Lead data could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load lead data.";
}

/** Fetches a server-paginated/filtered leads list. Re-fetches whenever params change. */
export function useLeadsList(params: LeadsListParams, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  // Response + the params key that produced it — see the twin comment in `useLeadCrmList`.
  const [entry, setEntry] = useState<{ key: string; value: LeadsListResponse } | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  // Serialize params to avoid effect identity issues.
  const paramsKey = JSON.stringify(params);
  // ADR-0009 stale guard: with `enabled` toggling (the leads view switcher) two loads can overlap,
  // and without this counter a slow earlier response overwrites a newer one.
  const loadIdRef = useRef(0);
  // Which params produced the response currently in `data`, and whether this loader was on last time.
  // Together they let a switched-off loader keep a still-valid cache (instant switch back) while a
  // cache that went stale during the off period is dropped before it can paint.
  const dataKeyRef = useRef<string | null>(null);
  const wasEnabledRef = useRef(enabled);

  const load = useCallback(async (p: LeadsListParams) => {
    const id = ++loadIdRef.current;
    const key = JSON.stringify(p);
    setLoading(true);
    try {
      const result = await repository.loadLeadsList(p);
      if (id !== loadIdRef.current) return; // stale — discard
      dataKeyRef.current = key;
      setEntry({ key, value: result });
      setError(null);
    } catch (reason) {
      if (id !== loadIdRef.current) return;
      setError(mapLeadsError(reason));
    } finally {
      if (id === loadIdRef.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const justEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled) {
      // Switched off (the other view mode is on screen). Cancel any in-flight load and drop the error
      // — a failure from the previous visit must not paint before the re-fetch has even started. The
      // response itself is KEPT: if the params are still the same on the way back it is valid, and
      // re-rendering it beats a second of empty table.
      //
      // `loading` stays TRUE: nothing reads a disabled loader's flags (the composed
      // `useLeadViewModeList` reads only the active half), and it is the honest value for "will fetch
      // the moment I am switched on" — the render that flips `enabled` would otherwise paint one
      // frame of the empty state before this effect runs.
      loadIdRef.current += 1;
      setError(null);
      setLoading(true);
      return;
    }
    // Back on: the filters may have moved while this loader was off, and that cache would be rows and
    // counts for a query nobody asked for. Only then is it dropped.
    if (justEnabled && dataKeyRef.current !== paramsKey) {
      dataKeyRef.current = null;
      setEntry(null);
    }
    void load(params);
  }, [paramsKey, enabled]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => { void load(params); }, [load, paramsKey]);

  return { data: entry?.value ?? null, isDataCurrent: entry?.key === paramsKey, loading, error, refresh };
}

/**
 * Loads filter option lists (clients + campaigns with leads) once on mount.
 * Not re-fetched on filter/paginate changes — the lists are stable per session.
 */
export function useLeadsFilterOptions(): { data: LeadsFilterOptions | null; loading: boolean } {
  const [data, setData] = useState<LeadsFilterOptions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    repository.loadLeadsFilterOptions()
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { /* non-fatal — dropdowns stay empty */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, loading };
}

/** Lazily fetches the reply thread for a single lead when the drawer opens. */
export function useLeadDetail(leadId: string | null): { replies: ReplyRecord[]; loading: boolean } {
  const [replies, setReplies] = useState<ReplyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!leadId) { setReplies([]); return; }
    cancelRef.current = false;
    setLoading(true);
    setReplies([]);
    repository.loadLeadDetail(leadId)
      .then((result: LeadDetailResult) => { if (!cancelRef.current) setReplies(result.replies); })
      .catch(() => { /* replies missing is non-fatal — show empty */ })
      .finally(() => { if (!cancelRef.current) setLoading(false); });
    return () => { cancelRef.current = true; };
  }, [leadId]);

  return { replies, loading };
}

/** Lazily fetches a lead's task list when the CRM drawer opens (ADR-0013). `reload` re-fetches after a
 *  task write so the list and the CRM open-count/next-due stay in step. Uses a per-load id (ADR-0009
 *  stale guard) so overlapping loads/reloads can never let an older response overwrite a newer one. */
export function useLeadTasks(leadId: string | null): { tasks: LeadTaskRecord[]; loading: boolean; reload: () => void } {
  const [tasks, setTasks] = useState<LeadTaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const loadIdRef = useRef(0);

  const load = useCallback((id: string) => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    repository.loadLeadTasks(id)
      .then((result) => { if (loadId === loadIdRef.current) setTasks(result); })
      .catch(() => { /* tasks missing is non-fatal — show empty */ })
      .finally(() => { if (loadId === loadIdRef.current) setLoading(false); });
  }, []);

  useEffect(() => {
    if (!leadId) { loadIdRef.current += 1; setTasks([]); return; } // invalidate any in-flight load
    setTasks([]);
    load(leadId);
  }, [leadId, load]);

  const reload = useCallback(() => { if (leadId) load(leadId); }, [leadId, load]);
  return { tasks, loading, reload };
}
