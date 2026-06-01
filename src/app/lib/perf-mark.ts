/**
 * Dev-only performance instrumentation helpers.
 *
 * All functions are no-ops in production builds (import.meta.env.DEV === false)
 * and in Vitest tests (process.env.NODE_ENV === "test") where requestAnimationFrame
 * does not fire automatically.
 *
 * ---
 * Shell vs content timing (drawers):
 *   "shell"   = overlay + header + action buttons in DOM and painted
 *   "content" = deferred heavy form / chart / conversation mounted and painted
 *
 * If the start mark is missing (drawer opened without a tracked click),
 * measureAfterRaf2 rewrites "click→raf2" → "open→raf2" in the label.
 */

const IS_DEV = import.meta.env.DEV;
const IS_TEST = typeof process !== "undefined" && process.env.NODE_ENV === "test";

/** True only in the browser dev server. False in prod builds and test runs. */
const ACTIVE = IS_DEV && !IS_TEST;

// ── Interaction marks ───────────────────────────────────────────────────────

/**
 * Place a named performance mark at the moment of user interaction (click).
 * Clears any previous mark with the same name so measurements never use stale data.
 */
export function markInteractionStart(name: string): void {
  if (!ACTIVE) return;
  try { performance.clearMarks(name); } catch { /* ignore */ }
  performance.mark(name);
}

/**
 * Place a performance mark at an arbitrary point (does NOT clear previous marks
 * with the same name — use markInteractionStart for interaction origins).
 */
export function markPoint(name: string): void {
  if (!ACTIVE) return;
  performance.mark(name);
}

// ── Async / rAF measurements ────────────────────────────────────────────────

/**
 * After two animation frames, measure elapsed time from `startMark` and
 * console.log `label: Xms`.
 *
 * If `startMark` is not found (no tracked click), falls back to measuring
 * from the call site and rewrites "click→raf2" → "open→raf2" in the label.
 */
export function measureAfterRaf2(startMark: string, label: string): void {
  if (!ACTIVE) return;
  const callTime = performance.now();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const startEntry = performance.getEntriesByName(startMark, "mark").at(-1);
      if (startEntry) {
        const elapsed = (performance.now() - startEntry.startTime).toFixed(1);
        console.log(`${label}: ${elapsed}ms`);
      } else {
        const elapsed = (performance.now() - callTime).toFixed(1);
        console.log(`${label.replace("click→raf2", "open→raf2")}: ${elapsed}ms`);
      }
    });
  });
}

/**
 * After two animation frames, log `label: Xms` measured from the call site.
 * Use when there is no interaction start mark to reference.
 */
export function logAfterRaf2(label: string): void {
  if (!ACTIVE) return;
  const callTime = performance.now();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      console.log(`${label}: ${(performance.now() - callTime).toFixed(1)}ms`);
    });
  });
}

// ── Synchronous measurements ────────────────────────────────────────────────

/**
 * Measure elapsed time between two named marks and console.log `label: Xms`.
 * Silent if either mark is not found.
 */
export function measureBetween(startMark: string, endMark: string, label: string): void {
  if (!ACTIVE) return;
  const start = performance.getEntriesByName(startMark, "mark").at(-1);
  const end = performance.getEntriesByName(endMark, "mark").at(-1);
  if (!start || !end) return;
  console.log(`${label}: ${(end.startTime - start.startTime).toFixed(1)}ms`);
}

/**
 * Run `fn` synchronously, log `label: Xms` with the wall-clock duration.
 * In non-dev/test mode `fn` is called directly with zero overhead.
 *
 * Use inside useMemo to time expensive derivations:
 *   const rows = useMemo(() =>
 *     timeSyncOp("[perf][clients] mega-rows (47)", () => buildRows(...)),
 *   [deps]);
 */
export function timeSyncOp<T>(label: string, fn: () => T): T {
  if (!ACTIVE) return fn();
  const t0 = performance.now();
  const result = fn();
  console.log(`${label}: ${(performance.now() - t0).toFixed(1)}ms`);
  return result;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Safely clear a named performance mark (ignores errors if the mark does not exist).
 */
export function clearMarksSafely(name: string): void {
  if (!ACTIVE) return;
  try { performance.clearMarks(name); } catch { /* ignore */ }
}

// ── Long-task observer ───────────────────────────────────────────────────────

/**
 * Start a PerformanceObserver that logs every browser long task (>50 ms).
 *
 * Returns a disconnect function; call it from a useEffect cleanup.
 * Returns undefined in prod, test, or browsers that don't support longtask.
 *
 * Log format:
 *   [perf][longtask] duration=Xms start=Y name=Z attribution=...
 */
export function startLongTaskObserver(): (() => void) | undefined {
  if (!ACTIVE) return undefined;
  if (typeof PerformanceObserver === "undefined") return undefined;

  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const taskEntry = entry as PerformanceEntry & {
          attribution?: Array<{ name: string; containerType?: string; containerName?: string }>;
        };
        const attrs = taskEntry.attribution
          ?.map((a) => [a.name, a.containerName, a.containerType].filter(Boolean).join("/"))
          .join(", ");
        console.log(
          `[perf][longtask] duration=${entry.duration.toFixed(1)}ms` +
            ` start=${entry.startTime.toFixed(1)}` +
            ` name=${entry.name}` +
            ` attribution=${attrs ?? "unknown"}`,
        );
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    return () => observer.disconnect();
  } catch {
    return undefined;
  }
}
