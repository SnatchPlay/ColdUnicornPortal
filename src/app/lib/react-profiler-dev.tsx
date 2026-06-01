/**
 * Dev-only React Profiler instrumentation helpers.
 *
 * All exports are no-ops / passthrough in production builds and Vitest test runs.
 * In development they attach React.Profiler and log slow renders with interaction
 * context so you can correlate long tasks with specific user interactions.
 *
 * Log formats:
 *   [perf][react] id=ClientsMegaTable phase=update actual=XXms base=YYms
 *                 start=ZZ commit=WW interaction=new-client-sheet
 *
 *   [perf][render] ClientsMegaTable count=N rows=48
 *
 * Profiler log thresholds (any one condition triggers):
 *   A. actualDuration >= 16ms           — over one 60-fps frame, always loud
 *   B. actualDuration >= 8ms            — half-frame, only during a known interaction
 *      AND interaction !== "unknown"
 *   C. baseDuration >= 150ms            — very expensive theoretical subtree
 *      AND actualDuration >= 4ms        — AND actually did some real work this commit
 *
 * Rule C supersedes the old "baseDuration >= 50" rule that was producing constant
 * noise for well-memoized subtrees like StablePageContent (base ~60ms, actual 0-2ms).
 *
 * Interaction correlation:
 *   Scans the most recent performance mark among the known interaction starts.
 *   Any mark fired within the last 5 s is treated as the active interaction.
 *
 * Known interaction marks (set by markInteractionStart in perf-mark.ts):
 *   "menu:click"             → mobile-menu
 *   "new-client-sheet:click" → new-client-sheet
 *   "client-drawer:click"    → client-drawer
 *   "lead-drawer:click"      → lead-drawer
 *   "campaign-drawer:click"  → campaign-drawer
 */

import { Profiler, useEffect, useRef, type ReactNode } from "react";

const IS_DEV = import.meta.env.DEV;
const IS_TEST = typeof process !== "undefined" && process.env.NODE_ENV === "test";

/** True only in the browser dev server. False in production builds and test runs. */
const ACTIVE = IS_DEV && !IS_TEST;

// ── Interaction tracking ─────────────────────────────────────────────────────

const INTERACTION_MARKS: Record<string, string> = {
  "menu:click":               "mobile-menu",
  "new-client-sheet:click":   "new-client-sheet",
  "client-drawer:click":      "client-drawer",
  "lead-drawer:click":        "lead-drawer",
  "campaign-drawer:click":    "campaign-drawer",
};
const INTERACTION_TTL_MS = 5000;

function getActiveInteraction(): string {
  try {
    const now = performance.now();
    let bestLabel: string | null = null;
    let bestTime = -Infinity;
    for (const [markName, label] of Object.entries(INTERACTION_MARKS)) {
      const entries = performance.getEntriesByName(markName, "mark");
      const last = entries[entries.length - 1];
      if (last && now - last.startTime <= INTERACTION_TTL_MS && last.startTime > bestTime) {
        bestTime = last.startTime;
        bestLabel = label;
      }
    }
    return bestLabel ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Profiler onRender callback ───────────────────────────────────────────────

function handleProfilerRender(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
): void {
  const interaction = getActiveInteraction();
  const shouldLog =
    actualDuration >= 16 ||
    (actualDuration >= 8 && interaction !== "unknown") ||
    (baseDuration >= 150 && actualDuration >= 4);
  if (!shouldLog) return;
  console.log(
    `[perf][react] id=${id} phase=${phase}` +
    ` actual=${actualDuration.toFixed(1)}ms base=${baseDuration.toFixed(1)}ms` +
    ` start=${startTime.toFixed(0)} commit=${commitTime.toFixed(0)}` +
    ` interaction=${interaction}`,
  );
}

// ── DevProfiler component ────────────────────────────────────────────────────

export interface DevProfilerProps {
  id: string;
  children: ReactNode;
}

/**
 * Dev-only React.Profiler wrapper. Renders children directly in production
 * and test environments — zero overhead. In development wraps with Profiler
 * and logs any slow render that meets the threshold.
 *
 * Use at the top level of a heavy subtree, not per-row or per-cell.
 *
 * @example
 * <DevProfiler id="ClientsMegaTable">
 *   <ClientsMegaTable ... />
 * </DevProfiler>
 */
export function DevProfiler({ id, children }: DevProfilerProps): JSX.Element {
  if (!ACTIVE) return <>{children}</>;
  return (
    <Profiler id={id} onRender={handleProfilerRender}>
      {children}
    </Profiler>
  );
}

// ── useDevRenderCount hook ───────────────────────────────────────────────────

/**
 * Log which props changed identity since the last committed render.
 * Useful for diagnosing unexpected memo bail-outs. Fires post-commit to avoid
 * Strict Mode double-invocation noise. No-ops in production and test.
 *
 * @example
 * // In a function component that receives a props object:
 * function ClientsMegaTableImpl(props: ClientsMegaTableProps) {
 *   useWhyDidYouRender("ClientsMegaTable", props as Record<string, unknown>);
 *   ...
 * }
 * // → [perf][why] ClientsMegaTable propChanged=onCustomFieldValueChange
 */
export function useWhyDidYouRender(id: string, props: Record<string, unknown>): void {
  // Sync the latest props into a ref so the post-commit effect always sees the
  // freshest values regardless of when React schedules the effect.
  const latestRef = useRef(props);
  latestRef.current = props;
  const prevRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!ACTIVE) return;
    const current = latestRef.current;
    if (prevRef.current) {
      const allKeys = new Set([...Object.keys(prevRef.current), ...Object.keys(current)]);
      for (const key of allKeys) {
        if (prevRef.current[key] !== current[key]) {
          console.log(`[perf][why] ${id} propChanged=${key}`);
        }
      }
    }
    prevRef.current = { ...current };
  });
}

/**
 * Track and log how many times a component has committed a render.
 * Uses useEffect (post-commit) so Strict Mode double-invocations are NOT counted.
 *
 * No-ops in production and test. Pass `extra` to include dynamic context.
 *
 * @example
 * useDevRenderCount("ClientsMegaTable", () => `rows=${rows.length}`);
 * // → [perf][render] ClientsMegaTable count=3 rows=48
 *
 * useDevRenderCount("NewClientSheet", () => `open=${open}`);
 * // → [perf][render] NewClientSheet count=2 open=true
 */
export function useDevRenderCount(id: string, extra?: () => string): void {
  const countRef = useRef(0);
  // Hold latest extra fn in a ref so the effect closure always calls the current version.
  const extraRef = useRef(extra);
  extraRef.current = extra;

  useEffect(() => {
    if (!ACTIVE) return;
    countRef.current += 1;
    const suffix = extraRef.current?.() ?? "";
    console.log(`[perf][render] ${id} count=${countRef.current}${suffix ? ` ${suffix}` : ""}`);
  });
}
