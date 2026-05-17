// [TEMP PERF] — Performance instrumentation helpers.
//
// PURPOSE
//   Collect real numbers for the performance audit (drawer-open latency,
//   loadSnapshot duration, derived-memo cost, render counts).
//
// REMOVAL
//   Search the repo for the literal string `[TEMP PERF]` and delete every
//   marked block. Then delete this file. Removal points:
//     - src/app/pages/clients-page.tsx
//     - src/app/pages/clients-page/client-drawer.tsx
//     - src/app/pages/clients-page/mega-table.tsx
//     - src/app/providers/core-data.tsx
//     - src/app/data/repository.ts
//     - supabase/functions/orm-gateway/index.ts
//
// USAGE
//   1) Run `pnpm dev`, open DevTools console, sign in.
//   2) Open the clients page, then click any row.
//   3) Console will print one line per measurement, all prefixed `[TEMP PERF]`.
//   4) Filter the console with `[TEMP PERF]` to isolate.

import { useRef } from "react";

const PREFIX = "[TEMP PERF]";

export function perfLog(message: string, value?: unknown) {
  if (typeof window === "undefined") return;
  if (value === undefined) {
    console.log(`${PREFIX} ${message}`);
  } else {
    console.log(`${PREFIX} ${message}`, value);
  }
}

/** Count renders of a component. Call at the top of the component body. */
export function useRenderCounter(componentName: string): number {
  const count = useRef(0);
  count.current += 1;
  perfLog(`${componentName} render #${count.current}`);
  return count.current;
}

/** Measure a synchronous block (e.g. useMemo body). Returns whatever fn returns. */
export function measureSync<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const result = fn();
  const dur = performance.now() - t0;
  perfLog(`memo ${label}: ${dur.toFixed(2)} ms`);
  return result;
}

/** Mark a moment in time. Used together with `measureBetween`. */
export function mark(label: string) {
  if (typeof performance === "undefined") return;
  performance.mark(`${PREFIX} ${label}`);
}

/** Measure between two previously-marked labels. Logs and returns the duration in ms. */
export function measureBetween(label: string, startMark: string, endMark: string): number | null {
  if (typeof performance === "undefined") return null;
  try {
    const m = performance.measure(`${PREFIX} ${label}`, `${PREFIX} ${startMark}`, `${PREFIX} ${endMark}`);
    perfLog(`${label}: ${m.duration.toFixed(2)} ms`);
    return m.duration;
  } catch {
    return null;
  }
}

/** Reset all performance marks/measures created by this module (call between test runs). */
export function clearMarks() {
  if (typeof performance === "undefined") return;
  performance.clearMarks();
  performance.clearMeasures();
}
