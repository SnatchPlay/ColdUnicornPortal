import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { InvoicesPagePayload } from "../types/view-contracts";

function mapError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Invoices loading timed out.";
    if (reason.kind === "permission") return "Access to invoices is blocked by your current permissions.";
    if (reason.kind === "network") return "Invoices could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load invoices.";
}

/**
 * Per-page loader for InvoicesPage (Phase 7). Stale guard prevents slow
 * in-flight responses from overwriting a newer state.
 */
export function useInvoicesPage() {
  const [data, setData] = useState<InvoicesPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  function load() {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadInvoicesPage()
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
