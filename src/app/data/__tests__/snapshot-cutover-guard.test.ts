import { describe, expect, it } from "vitest";

/**
 * Cutover ratchet for the universal-snapshot retirement (see plan goofy-riding-rabbit + memory
 * snapshot-refactor-no-legacy-fallback).
 *
 * The universal `loadSnapshot` data contract is being replaced by per-page loaders. This test
 * fails if any app-runtime source file outside the explicit allowlist references `loadSnapshot`.
 * The intent is twofold:
 *   1. Prevent NEW code from depending on the snapshot during migration.
 *   2. Track migration progress — the allowlist shrinks each phase and must be EMPTY at Phase 8
 *      (no-snapshot cutover), at which point `loadSnapshot` is deleted entirely.
 *
 * No `useLegacySnapshot()` fallback is permitted; that string is also banned outright.
 */

// Raw source of every app-runtime TS/TSX file (tests excluded by the filter below).
const sources = import.meta.glob("/src/app/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Files still permitted to reference `loadSnapshot` while the migration is in flight.
 * Remove entries as phases land; the list MUST be empty after the Phase 8 cutover.
 */
const LOAD_SNAPSHOT_ALLOWLIST = new Set<string>([
  "/src/app/data/repository.ts", // defines + invokes the action (deleted in Phase 8)
  "/src/app/data/orm-gateway-contract.ts", // payload/response/parse for the action (deleted in Phase 8)
  "/src/app/providers/core-data.tsx", // legacy provider boot call (removed in Phase 8)
]);

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
