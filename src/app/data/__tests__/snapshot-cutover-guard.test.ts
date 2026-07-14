import { describe, expect, it } from "vitest";

/**
 * Regression guard for the completed universal-snapshot retirement (ADR-0009).
 *
 * The universal `loadSnapshot` data contract has been fully replaced by per-page loaders
 * (`loadShellData` + one gateway select action per route). The allowlist is now EMPTY and must
 * stay that way: no app-runtime file may reference `loadSnapshot`, and no `useLegacySnapshot()`
 * fallback may be reintroduced. New pages load their own data — see the `portal-page` skill.
 */

// Raw source of every app-runtime TS/TSX file (tests excluded by the filter below).
const sources = import.meta.glob("/src/app/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Empty since the cutover landed. Do NOT add entries — a new `loadSnapshot` reference means
 * someone is rebuilding the universal snapshot instead of adding a per-page gateway action.
 */
const LOAD_SNAPSHOT_ALLOWLIST = new Set<string>([]);

function appRuntimeFiles() {
  return Object.entries(sources).filter(([path]) => !path.includes("/__tests__/"));
}

// Match real code usage — `repository.loadSnapshot(...)` access or the `"loadSnapshot"` action
// string — not prose comments that merely mention the word.
const LOAD_SNAPSHOT_USAGE = /\.loadSnapshot\b|["']loadSnapshot["']/;

describe("snapshot cutover guard", () => {
  it("does not let new app code depend on loadSnapshot", () => {
    const offenders = appRuntimeFiles()
      .filter(([path]) => !LOAD_SNAPSHOT_ALLOWLIST.has(path))
      .filter(([, src]) => LOAD_SNAPSHOT_USAGE.test(src))
      .map(([path]) => path);

    expect(
      offenders,
      `New references to loadSnapshot found outside the migration allowlist. Migrate these pages ` +
        `to per-page loaders instead of reading the universal snapshot:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("never reintroduces a useLegacySnapshot fallback", () => {
    const offenders = appRuntimeFiles()
      .filter(([, src]) => src.includes("useLegacySnapshot"))
      .map(([path]) => path);

    expect(offenders, `useLegacySnapshot fallback is forbidden:\n${offenders.join("\n")}`).toEqual([]);
  });
});
