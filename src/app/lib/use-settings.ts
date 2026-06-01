import { useEffect, useRef, useState } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { AdminSettingsPayload } from "../types/view-contracts";

function mapSettingsError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    if (reason.kind === "timeout") return "Settings loading timed out.";
    if (reason.kind === "permission") return "Access to settings is blocked by your current permissions.";
    if (reason.kind === "network") return "Settings could not be loaded due to a network error. Try again.";
    return reason.message;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load settings.";
}

/**
 * Loads admin settings (condition rules, column overrides, custom field definitions, clients).
 * Stale guard prevents slow in-flight responses from overwriting a newer state.
 * Called once on mount; refresh() re-loads after mutations.
 */
export function useAdminSettings() {
  const [data, setData] = useState<AdminSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  function load() {
    const id = ++loadIdRef.current;
    setLoading(true);
    repository.loadAdminSettings()
      .then((result) => {
        if (id !== loadIdRef.current) return;
        setData(result);
        setError(null);
      })
      .catch((reason) => {
        if (id !== loadIdRef.current) return;
        setError(mapSettingsError(reason));
      })
      .finally(() => {
        if (id === loadIdRef.current) setLoading(false);
      });
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { load(); };

  return { data, loading, error, refresh };
}
