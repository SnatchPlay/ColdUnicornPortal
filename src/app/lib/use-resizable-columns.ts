import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

interface UseResizableColumnsOptions {
  storageKey: string;
  defaultWidths: number[];
  minWidths?: number[];
  /**
   * Stable per-column ids, in render order. Supply these for tables whose column
   * set is dynamic (hidden columns, custom fields, master-admin reordering): widths
   * are then persisted as an `{ id: width }` record instead of a positional array,
   * so a saved width follows its own column across reorder / add / remove.
   *
   * Omit for tables with a fixed column set — those keep the positional array.
   */
  columnIds?: readonly string[];
}

interface UseResizableColumnsResult {
  template: string;
  getResizeMouseDown: (index: number) => (event: ReactMouseEvent<HTMLElement>) => void;
  resetWidths: () => void;
}

function isUsableWidth(value: unknown): value is number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

/** Positional array — for a fixed column set. Rejects a payload of the wrong length. */
function normalizeWidths(values: unknown, expectedLength: number) {
  if (!Array.isArray(values) || values.length !== expectedLength) return null;
  const normalized = values.map((value) => Number(value));
  if (normalized.some((value) => !isUsableWidth(value))) return null;
  return normalized;
}

/**
 * Keyed record — for a dynamic column set. Every column falls back to its own default,
 * so an unknown id (column removed) is ignored and a new id (column added) simply keeps
 * its default instead of invalidating the whole saved layout.
 */
function normalizeWidthsById(values: unknown, columnIds: readonly string[], defaultWidths: number[]) {
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const stored = values as Record<string, unknown>;
  return columnIds.map((id, index) => {
    const saved = stored[id];
    return isUsableWidth(saved) ? Number(saved) : defaultWidths[index];
  });
}

function readStoredWidths(
  storageKey: string,
  defaultWidths: number[],
  columnIds?: readonly string[],
): number[] {
  if (typeof window === "undefined") return defaultWidths;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return defaultWidths;
  try {
    const parsed = JSON.parse(raw);
    const restored = columnIds
      ? normalizeWidthsById(parsed, columnIds, defaultWidths)
      : normalizeWidths(parsed, defaultWidths.length);
    return restored ?? defaultWidths;
  } catch {
    return defaultWidths;
  }
}

function serializeWidths(widths: number[], columnIds?: readonly string[]) {
  if (!columnIds) return JSON.stringify(widths);
  const byId: Record<string, number> = {};
  columnIds.forEach((id, index) => {
    const width = widths[index];
    if (isUsableWidth(width)) byId[id] = Math.round(width);
  });
  return JSON.stringify(byId);
}

export function useResizableColumns(options: UseResizableColumnsOptions): UseResizableColumnsResult {
  const { storageKey, defaultWidths, columnIds } = options;
  const minWidths = useMemo(
    () => (options.minWidths && options.minWidths.length === defaultWidths.length ? options.minWidths : defaultWidths.map(() => 120)),
    [defaultWidths, options.minWidths],
  );

  const [widths, setWidths] = useState<number[]>(() => readStoredWidths(storageKey, defaultWidths, columnIds));

  // Re-read whenever the identity of the column set changes — the storage key, or (for a
  // dynamic table) the ids themselves. The one-shot useState initializer runs before the
  // async data that determines the column set has landed, so without this the settled
  // layout would never be restored and would look like a reset.
  const signature = `${storageKey}|${columnIds ? columnIds.join(",") : defaultWidths.length}`;
  const prevSignatureRef = useRef(signature);
  useEffect(() => {
    if (prevSignatureRef.current === signature) return;
    prevSignatureRef.current = signature;
    setWidths(readStoredWidths(storageKey, defaultWidths, columnIds));
    // `signature` already covers storageKey + columnIds; defaultWidths tracks cols.
  }, [signature, storageKey, defaultWidths, columnIds]);

  // Persist only once the widths belong to the current column set. On the render where
  // the set changed, `widths` still holds the previous layout — writing it here would
  // stamp the old widths onto the new columns before the re-read lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prevSignatureRef.current !== signature) return;
    if (columnIds && widths.length !== columnIds.length) return;
    window.localStorage.setItem(storageKey, serializeWidths(widths, columnIds));
  }, [storageKey, widths, columnIds, signature]);

  const getResizeMouseDown = useCallback(
    (index: number) => (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = widths[index] ?? defaultWidths[index];

      function onMouseMove(moveEvent: MouseEvent) {
        const deltaX = moveEvent.clientX - startX;
        setWidths((current) => {
          const next = current.slice();
          const minWidth = minWidths[index] ?? 120;
          next[index] = Math.max(minWidth, Math.round(startWidth + deltaX));
          return next;
        });
      }

      function onMouseUp() {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [defaultWidths, minWidths, widths],
  );

  const template = useMemo(() => widths.map((value) => `${Math.max(1, Math.round(value))}px`).join(" "), [widths]);

  const resetWidths = useCallback(() => {
    setWidths(defaultWidths);
  }, [defaultWidths]);

  return {
    template,
    getResizeMouseDown,
    resetWidths,
  };
}
