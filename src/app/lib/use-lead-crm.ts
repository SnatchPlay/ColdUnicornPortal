import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import { isCrmViewMode, type LeadViewMode } from "./crm/lead-view-mode";
import { useLeadsList } from "./use-leads";
import type { HealthContext } from "./crm/lead-health";
import type { LeadCrmListResponse, LeadsListParams, LeadsListResponse } from "../types/view-contracts";

function mapError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "CRM leads loading timed out.";
    if (reason.kind === "permission") return "Access to CRM leads is blocked by your current permissions.";
    if (reason.kind === "network") return "CRM leads could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load CRM leads.";
}

/**
 * Per-page loader for the Lead CRM view (ADR-0013). Re-fetches whenever the serialized params change
 * and carries the `loadIdRef` stale guard (ADR-0009) so a slow in-flight response can never overwrite
 * a newer one — the pattern the leads list (`use-leads.ts`) predates and should not be copied from.
 */
export function useLeadCrmList(params: LeadsListParams, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  // The response is stored WITH the params key that produced it: consumers that buffer rows (the
  // client page's "Load more") must be able to tell a fresh response from one that predates the last
  // filter/mode change — effects run after the render that changed the params, so without this stamp
  // a stale response is committed under the new key.
  const [entry, setEntry] = useState<{ key: string; value: LeadCrmListResponse } | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);
  const paramsKey = JSON.stringify(params);
  // `params` is a fresh object each render; the ref lets `load` be identity-stable (and therefore
  // `refresh` too) while still reading the current params.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // Which params produced the response in `data`, and whether this loader was on last time — see the
  // twin comments in `useLeadsList`.
  const dataKeyRef = useRef<string | null>(null);
  const wasEnabledRef = useRef(enabled);

  const load = useCallback(() => {
    const id = ++loadIdRef.current;
    const key = JSON.stringify(paramsRef.current);
    setLoading(true);
    repository.loadLeadCrmList(paramsRef.current)
      .then((result) => {
        if (id !== loadIdRef.current) return;
        dataKeyRef.current = key;
        setEntry({ key, value: result });
        setError(null);
      })
      .catch((reason) => {
        if (id !== loadIdRef.current) return;
        setError(mapError(reason));
      })
      .finally(() => {
        if (id === loadIdRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const justEnabled = enabled && !wasEnabledRef.current;
    wasEnabledRef.current = enabled;
    if (!enabled) {
      // Switched off: cancel the in-flight load and drop the error, keep the response — see the twin
      // comment in `useLeadsList`.
      loadIdRef.current += 1;
      setError(null);
      setLoading(true);
      return;
    }
    if (justEnabled && dataKeyRef.current !== paramsKey) {
      dataKeyRef.current = null;
      setEntry(null);
    }
    load();
  }, [paramsKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable identity: the internal Leads page passes `refresh` into memoised callbacks, and a fresh
  // arrow per render would invalidate them on every render in CRM mode.
  const refresh = useCallback(() => { if (enabled) load(); }, [load, enabled]);

  return { data: entry?.value ?? null, isDataCurrent: entry?.key === paramsKey, loading, error, refresh };
}


/**
 * One loader for the PDCA / CRM / Combined switch (ADR-0013), shared by the internal Leads page and
 * the client My Pipeline page: PDCA reads `loadLeadsList`, CRM and Combined read `loadLeadCrmList`,
 * and only the active mode's action is fetched. Both responses satisfy the fields the pages read, so
 * callers keep one `data` / `loading` / `error` / `refresh` set regardless of mode.
 *
 * `healthContext` is the server clock + working-day config the health evaluator needs; it is memoised
 * on those two scalars (not on the response object) so `LeadCrmTable`'s per-row evaluation memo stays
 * stable when an unrelated re-fetch returns the same clock.
 */
export function useLeadViewModeList(params: LeadsListParams, viewMode: LeadViewMode) {
  const isCrmView = isCrmViewMode(viewMode);
  const pdca = useLeadsList(params, { enabled: !isCrmView });
  const crm = useLeadCrmList(params, { enabled: isCrmView });

  const asOf = crm.data?.asOf;
  const businessDays = crm.data?.businessDays;
  const healthContext = useMemo<HealthContext | undefined>(
    () => (asOf && businessDays ? { asOf, businessDays } : undefined),
    [asOf, businessDays],
  );

  return {
    isCrmView,
    /** False while the active loader's response predates the current params (a filter or mode change
     *  that has not landed yet). Buffering consumers must not commit a response under a newer key. */
    isDataCurrent: isCrmView ? crm.isDataCurrent : pdca.isDataCurrent,
    // `LeadCrmListResponse` widens to `LeadsListResponse` (its rows extend `LeadsListRow`), so the
    // shared fields — rows, totalCount, stageCounts, custom fields/values — read the same in both
    // modes. A CRM table narrows its rows back with `as LeadCrmRow[]` at the render site.
    data: (isCrmView ? crm.data : pdca.data) as LeadsListResponse | null,
    loading: isCrmView ? crm.loading : pdca.loading,
    error: isCrmView ? crm.error : pdca.error,
    refresh: isCrmView ? crm.refresh : pdca.refresh,
    asOf,
    businessDays,
    healthContext,
  };
}
