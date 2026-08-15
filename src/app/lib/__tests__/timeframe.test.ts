import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEFRAME_PRESET,
  TIMEFRAME_PRESETS,
  createDefaultTimeframe,
  getTimeframeLabel,
  normalizeTimeframePreset,
  resolveTimeframeBounds,
  type TimeframePreset,
  type TimeframeValue,
} from "../timeframe";

function at(preset: TimeframePreset, now: string) {
  return resolveTimeframeBounds({ preset, customStart: null, customEnd: null }, new Date(now));
}

/** Local-time YYYY-MM-DD, so an assertion never turns into a timezone quiz. */
function day(date: Date | null): string | null {
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

describe("timeframe presets", () => {
  it("resolves the current-period presets up to today", () => {
    expect(day(at("mtd", "2026-08-14T10:00:00").start)).toBe("2026-08-01");
    expect(day(at("mtd", "2026-08-14T10:00:00").end)).toBe("2026-08-14");
    expect(day(at("qtd", "2026-08-14T10:00:00").start)).toBe("2026-07-01");
    expect(day(at("ytd", "2026-08-14T10:00:00").start)).toBe("2026-01-01");
    expect(day(at("7d", "2026-08-14T10:00:00").start)).toBe("2026-08-08");
  });

  it("closes last month on the last day of that month", () => {
    const august = at("last_month", "2026-08-14T10:00:00");
    expect(day(august.start)).toBe("2026-07-01");
    expect(day(august.end)).toBe("2026-07-31");
  });

  it("rolls last month back into the previous year in January", () => {
    const january = at("last_month", "2026-01-15T10:00:00");
    expect(day(january.start)).toBe("2025-12-01");
    expect(day(january.end)).toBe("2025-12-31");
  });

  it("closes last quarter, including the Q1 → previous Q4 rollover", () => {
    const q3 = at("last_quarter", "2026-08-14T10:00:00");
    expect(day(q3.start)).toBe("2026-04-01");
    expect(day(q3.end)).toBe("2026-06-30");

    const q1 = at("last_quarter", "2026-02-10T10:00:00");
    expect(day(q1.start)).toBe("2025-10-01");
    expect(day(q1.end)).toBe("2025-12-31");
  });

  it("closes last year on 31 December", () => {
    const lastYear = at("last_year", "2026-03-01T10:00:00");
    expect(day(lastYear.start)).toBe("2025-01-01");
    expect(day(lastYear.end)).toBe("2025-12-31");
  });

  it("leaves all time unbounded", () => {
    expect(at("all", "2026-08-14T10:00:00")).toEqual({ start: null, end: null });
  });

  it("resolves every preset in the picker, and labels it", () => {
    // The table-driven guard: add a ninth preset to TIMEFRAME_PRESETS and forget its case in
    // getPresetBounds and this fails, instead of the window silently landing on the default.
    for (const { key, label } of TIMEFRAME_PRESETS) {
      const bounds = at(key, "2026-08-14T10:00:00");
      if (key === "all") {
        expect(bounds).toEqual({ start: null, end: null });
      } else {
        expect(day(bounds.start), key).not.toBeNull();
        expect(day(bounds.end), key).not.toBeNull();
      }
      expect(getTimeframeLabel({ preset: key, customStart: null, customEnd: null })).toBe(label);
    }
  });

  it("ends every closed period at the last millisecond of its final day", () => {
    const end = at("last_month", "2026-08-14T10:00:00").end as Date;
    expect(end.getHours()).toBe(23);
    expect(end.getMilliseconds()).toBe(999);
  });
});

describe("retired presets", () => {
  it("normalises 21d / 30d / 90d and anything unknown to the default", () => {
    for (const retired of ["21d", "30d", "90d", "garbage", "", null, undefined, 7]) {
      expect(normalizeTimeframePreset(retired)).toBe(DEFAULT_TIMEFRAME_PRESET);
    }
    expect(normalizeTimeframePreset("custom")).toBe("custom");
    expect(normalizeTimeframePreset("last_quarter")).toBe("last_quarter");
  });

  it("resolves a retired preset to the default window, never to all time", () => {
    // The regression this fallback exists for: falling through to {null, null} would silently widen
    // a bookmarked 30-day link to every row ever created, and every number on the page with it.
    const stale = { preset: "90d" as TimeframePreset, customStart: null, customEnd: null };
    expect(resolveTimeframeBounds(stale, new Date("2026-08-14T10:00:00"))).toEqual(
      at("mtd", "2026-08-14T10:00:00"),
    );
  });

  it("labels a retired preset as the default rather than leaving the button blank", () => {
    expect(getTimeframeLabel({ preset: "21d" as TimeframePreset, customStart: null, customEnd: null }))
      .toBe("Current month");
  });

  it("defaults new sessions to the current month", () => {
    expect(createDefaultTimeframe()).toEqual({ preset: "mtd", customStart: null, customEnd: null });
  });
});

describe("custom ranges", () => {
  it("swaps a reversed custom range instead of returning an empty window", () => {
    const reversed: TimeframeValue = { preset: "custom", customStart: "2026-08-20", customEnd: "2026-08-10" };
    const bounds = resolveTimeframeBounds(reversed);
    expect(day(bounds.start)).toBe("2026-08-10");
    expect(day(bounds.end)).toBe("2026-08-20");
  });
});
