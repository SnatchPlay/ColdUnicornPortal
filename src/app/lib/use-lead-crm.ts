import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { LeadCrmListResponse, LeadsListParams } from "../types/view-contracts";

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
  const [data, setData] = useState<LeadCrmListResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);
  const paramsKey = JSON.stringify(params);

  function load() {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadLeadCrmList(params)
      .then((result) => {
        if (id !== loadIdRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((reason) => {
        if (id !== loadIdRef.current) return;
        setError(mapError(reason));
      })
      .finally(() => {
        if (id === loadIdRef.current) setLoading(false);
      });
  }

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    load();
  }, [paramsKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: () => { if (enabled) load(); } };
}
