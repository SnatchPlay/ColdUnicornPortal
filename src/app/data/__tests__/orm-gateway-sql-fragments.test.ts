import { describe, expect, it } from "vitest";

/**
 * Regression guard for the `IS NULLAND` class of gateway bug.
 *
 * Drizzle concatenates the static chunks of a `sql` template with no separator
 * (`node_modules/drizzle-orm/sql/sql.js`: `chunk.value.join("")`). A conditional fragment that
 * starts with a bare `AND`/`OR` therefore glues itself to whatever precedes the interpolation:
 * `... archived_at IS NULL${campStatusCond()}` rendered as `... archived_at IS NULLAND camp.status = $2`,
 * and the manager dashboard answered 500 on every load (fixed 2026-09-02).
 *
 * Nothing in this repo type-checks and the gateway runs on Deno, so the only cheap gate is the
 * convention itself: a conditional fragment carries its own leading space.
 */
const sources = import.meta.glob("/supabase/functions/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// `sql`AND ...`` / `sql`OR ...`` — a fragment meant to be appended, missing its leading space.
const UNSPACED_FRAGMENT = /sql`(?:AND|OR)\s/;

describe("orm-gateway sql fragments", () => {
  it("reads the gateway source", () => {
    expect(Object.keys(sources)).toContain("/supabase/functions/orm-gateway/index.ts");
  });

  it("gives every appended AND/OR fragment a leading space", () => {
    const offenders = Object.entries(sources).flatMap(([path, src]) =>
      src.split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => UNSPACED_FRAGMENT.test(line))
        .map(([lineNo, line]) => `${path}:${lineNo}: ${line.trim()}`)
    );

    expect(offenders).toEqual([]);
  });
});
