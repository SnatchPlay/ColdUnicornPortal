import { useCallback, useEffect, useRef, useState } from "react";
import { repository } from "../data/repository";

/**
 * Per-user table preferences (column widths, filters, sort), stored in Postgres via the
 * ORM gateway so a layout follows the person across browsers and devices.
 *
 * Two-tier on purpose:
 *
 *  - **localStorage is the cache.** It is read synchronously on mount, so the table paints
 *    with the user's own layout on the first frame instead of flashing defaults for the
 *    duration of a round-trip.
 *  - **Postgres is the source of truth.** When the row lands it replaces the cache.
 *
 * Writes are debounced: dragging a column edge produces a width change per mousemove, and
 * every one of those must not become a gateway call.
 *
 * If the gateway rejects the action (e.g. the function has not been deployed yet), the hook
 * degrades to the cache and the table keeps working — a preferences failure must never take
 * a page down.
 */

const SAVE_DEBOUNCE_MS = 800;

function cacheKey(tableKey: string) {
  return `table-prefs:${tableKey}`;
}

function readCache(tableKey: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(tableKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeCache(tableKey: string, preferences: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(tableKey), JSON.stringify(preferences));
  } catch {
    // Quota or private mode — the DB copy still carries the layout.
  }
}

export interface UseTablePreferencesResult<T extends Record<string, unknown>> {
  /** Current preferences: the cache on the first frame, the DB row once it lands. */
  preferences: Partial<T>;
  /**
   * True once the server round-trip has settled (either way). Until then the values come
   * from the cache, and nothing is written back — otherwise a default-valued render would
   * overwrite the row that is still in flight.
   */
  loaded: boolean;
  /** Shallow-merge a patch. Cached immediately, persisted after the debounce. */
  update: (patch: Partial<T>) => void;
}

export function useTablePreferences<T extends Record<string, unknown>>(
  tableKey: string,
  enabled = true,
): UseTablePreferencesResult<T> {
  const [preferences, setPreferences] = useState<Partial<T>>(
    () => (readCache(tableKey) as Partial<T> | null) ?? {},
  );
  const [loaded, setLoaded] = useState(false);

  const loadIdRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Partial<T> | null>(null);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!pending || !enabled) return;

    // Promise.resolve().then keeps a *synchronous* throw (an older gateway build without the
    // action, a partially-stubbed repository) from escaping as an uncaught error and taking
    // the page down with it. A preferences failure is always degraded, never fatal.
    void Promise.resolve()
      .then(() => repository.saveTablePreferences(tableKey, pending as Record<string, unknown>))
      .catch((error) => {
        // Degraded, not broken: the cache still holds the layout for this browser.
        console.warn(`[table-prefs] failed to save ${tableKey}`, error);
      });
  }, [enabled, tableKey]);

  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }

    const loadId = ++loadIdRef.current;
    let cancelled = false;

    void Promise.resolve()
      .then(() => repository.loadTablePreferences(tableKey))
      .then((payload) => {
        if (cancelled || loadId !== loadIdRef.current) return;

        if (payload.preferences) {
          const remote = payload.preferences as Partial<T>;
          setPreferences(remote);
          writeCache(tableKey, remote as Record<string, unknown>);
        } else {
          // Nothing saved server-side yet. If this browser has a layout from before the
          // table existed (or from an offline session), promote it instead of dropping it.
          const cached = readCache(tableKey);
          if (cached && Object.keys(cached).length > 0) {
            pendingRef.current = cached as Partial<T>;
          }
        }
      })
      .catch((error) => {
        if (cancelled || loadId !== loadIdRef.current) return;
        console.warn(`[table-prefs] failed to load ${tableKey}`, error);
      })
      .finally(() => {
        if (cancelled || loadId !== loadIdRef.current) return;
        setLoaded(true);
        // Promote a cache-only layout now that writes are unblocked.
        if (pendingRef.current) flush();
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, tableKey, flush]);

  // Flush a pending save when the component goes away (navigating off the page right after
  // a resize would otherwise lose it).
  useEffect(() => () => flush(), [flush]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch };
        writeCache(tableKey, next as Record<string, unknown>);

        // Never write before the load settles — a save racing the initial fetch would
        // persist defaults over the user's stored layout.
        if (loaded && enabled) {
          pendingRef.current = next;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
        }

        return next;
      });
    },
    [enabled, flush, loaded, tableKey],
  );

  return { preferences, loaded, update };
}
