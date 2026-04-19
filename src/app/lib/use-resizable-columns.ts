import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

interface UseResizableColumnsOptions {
  storageKey: string;
  defaultWidths: number[];
  minWidths?: number[];
}

interface UseResizableColumnsResult {
  template: string;
  getResizeMouseDown: (index: number) => (event: ReactMouseEvent<HTMLElement>) => void;
  resetWidths: () => void;
}

function normalizeWidths(values: unknown, expectedLength: number) {
  if (!Array.isArray(values) || values.length !== expectedLength) return null;
  const normalized = values.map((value) => Number(value));
  if (normalized.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  return normalized;
}

export function useResizableColumns(options: UseResizableColumnsOptions): UseResizableColumnsResult {
  const { storageKey, defaultWidths } = options;
  const minWidths = useMemo(
    () => (options.minWidths && options.minWidths.length === defaultWidths.length ? options.minWidths : defaultWidths.map(() => 120)),
    [defaultWidths, options.minWidths],
  );

  const [widths, setWidths] = useState<number[]>(() => {
    if (typeof window === "undefined") return defaultWidths;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultWidths;

    try {
      const parsed = JSON.parse(raw);
      return normalizeWidths(parsed, defaultWidths.length) ?? defaultWidths;
    } catch {
      return defaultWidths;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  }, [storageKey, widths]);

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
