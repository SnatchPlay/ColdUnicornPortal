import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { repository, RepositoryError } from "../data/repository";
import type { ShellData } from "../types/view-contracts";
import { useAuth } from "./auth";

interface ShellDataContextValue extends ShellData {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_SHELL: ShellData = {
  usersLite: [],
  clientsLite: [],
  clientUsers: [],
};

const ShellDataContext = createContext<ShellDataContextValue | null>(null);

function mapShellError(reason: unknown): string {
  if (reason instanceof RepositoryError) {
    const suffix = reason.code ? ` [${reason.code}] ${reason.message}` : ` ${reason.message}`;
    return `Could not ${reason.operation} ${reason.table}.${suffix}`;
  }
  if (reason instanceof Error) return reason.message;
  return "Failed to load workspace shell data.";
}

function sizeOf(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return -1;
  }
}

/**
 * Tiny global boot provider that replaces the monolithic snapshot for navigation-level data.
 * Holds only lite users/clients + client⇄user mappings. Page data lives in per-page hooks.
 */
export function ShellDataProvider({ children }: { children: ReactNode }) {
  const { identity, loading: authLoading } = useAuth();
  const [shell, setShell] = useState<ShellData>(EMPTY_SHELL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const t0 = performance.now();
      const data = await repository.loadShellData();
      // [PERF] shell payload audit
      console.log(
        `[PERF][shell] loadShellData ${(performance.now() - t0).toFixed(1)}ms ` +
          `(usersLite=${data.usersLite.length}, clientsLite=${data.clientsLite.length}, ` +
          `clientUsers=${data.clientUsers.length}, ${(sizeOf(data) / 1024).toFixed(1)}KB)`,
      );
      // Ignore stale responses if a newer refresh started.
      if (seq !== refreshSeq.current) return;
      setShell(data);
      setError(null);
    } catch (reason) {
      if (seq !== refreshSeq.current) return;
      setError(mapShellError(reason));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!identity) {
      setShell(EMPTY_SHELL);
      setError(null);
      setLoading(false);
      return;
    }
    void refresh();
  }, [authLoading, identity, refresh]);

  const value = useMemo<ShellDataContextValue>(
    () => ({ ...shell, loading, error, refresh }),
    [shell, loading, error, refresh],
  );

  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData(): ShellDataContextValue {
  const value = useContext(ShellDataContext);
  if (!value) {
    throw new Error("useShellData must be used within a ShellDataProvider.");
  }
  return value;
}
