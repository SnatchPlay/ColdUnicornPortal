import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { DomainsPagePayload } from "../types/view-contracts";

function mapError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Domains loading timed out.";
    if (reason.kind === "permission") return "Access to domains is blocked by your current permissions.";
    if (reason.kind === "network") return "Domains could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load domains.";
}

/**
 * Per-page loader for DomainsPage (Phase 7). Stale guard prevents slow
 * in-flight responses from overwriting a newer state.
 */
export function useDomainsPage() {
  const [data, setData] = useState<DomainsPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  function load() {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadDomainsPage()
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

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: () => { load(); } };
}
