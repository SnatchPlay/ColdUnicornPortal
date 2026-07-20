import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { EmailAccountsPagePayload } from "../types/view-contracts";

function mapError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Email accounts loading timed out.";
    if (reason.kind === "permission") return "Access to email accounts is blocked by your current permissions.";
    if (reason.kind === "network") return "Email accounts could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load email accounts.";
}

/**
 * Per-page loader for EmailAccountsPage. Same loadIdRef stale-guard as useDomainsPage — a slow
 * in-flight response can never overwrite a newer one. Warming history is loaded lazily per mailbox
 * via repository.loadEmailAccountWarming(id), not in this payload.
 */
export function useEmailAccountsPage() {
  const [data, setData] = useState<EmailAccountsPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  function load() {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadEmailAccountsPage()
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
