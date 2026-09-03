import { formatDate } from "./format";

export type TimeframePreset =
  | "7d"
  | "mtd"
  | "last_month"
  | "qtd"
  | "last_quarter"
  | "ytd"
  | "last_year"
  | "all"
  | "custom";

export interface TimeframeValue {
  preset: TimeframePreset;
  customStart: string | null;
  customEnd: string | null;
}

// Typed as never-"custom" because getPresetBounds takes it as a fallback and cannot resolve a custom
// range without the dates that only a TimeframeValue carries.
export const DEFAULT_TIMEFRAME_PRESET: Exclude<TimeframePreset, "custom"> = "mtd";

/**
 * The Leads tab is the exception: it opens on **all time**, for every role. A leads list is a working
 * CRM surface, not a period report — a lead created two months ago is still the lead someone has to
 * call today, and a month-shaped default hid it behind a filter nobody had set. Dashboards and
 * statistics keep `DEFAULT_TIMEFRAME_PRESET`, where a period is the point.
 */
export const LEADS_DEFAULT_TIMEFRAME_PRESET: Exclude<TimeframePreset, "custom"> = "all";

// `mtd` / `qtd` / `ytd` keep their keys — only their labels moved from "… to Date" to "Current …",
// so nothing persisted and no shared link changes meaning. The rolling `21d` / `30d` / `90d` presets
// were retired on 2026-08-14; see normalizeTimeframePreset for what happens to the stragglers.
export const TIMEFRAME_PRESETS: Array<{ key: Exclude<TimeframePreset, "custom">; label: string }> = [
  { key: "7d", label: "Last 7 days" },
  { key: "mtd", label: "Current month" },
  { key: "last_month", label: "Last month" },
  { key: "qtd", label: "Current quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "ytd", label: "Current year" },
  { key: "last_year", label: "Last year" },
  { key: "all", label: "All time" },
];

/**
 * Anything this does not recognise degrades to the default preset. The values that matter are the
 * retired `21d` / `30d` / `90d`, which still live in bookmarked URLs (`?range=30d`). Degrading them
 * is deliberate: the failure mode worth engineering against is falling through to
 * `{start: null, end: null}`, which silently widens a 30-day window to all time and makes every
 * number on the page bigger for no visible reason.
 *
 * Call this wherever a preset enters the app from outside — URL params, stored layouts — rather than
 * comparing `timeframe.preset` yourself.
 */
export function normalizeTimeframePreset(
  value: unknown,
  fallback: Exclude<TimeframePreset, "custom"> = DEFAULT_TIMEFRAME_PRESET,
): TimeframePreset {
  if (value === "custom") return "custom";
  if (typeof value === "string" && TIMEFRAME_PRESETS.some((preset) => preset.key === value)) {
    return value as TimeframePreset;
  }
  return fallback;
}

function toStartOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toEndOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
}

function parseUnknownDate(value: string | null | undefined) {
  if (!value) return null;
  const parsedDateOnly = parseDateOnly(value);
  if (parsedDateOnly) return parsedDateOnly;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * A period that has already closed: whole months, quarters or years.
 * `new Date(y, m, 0)` is the last day of month `m - 1`, and month indexes outside 0..11 roll into the
 * neighbouring year, so January → previous December and Q1 → previous Q4 need no special-casing.
 */
function closedPeriod(year: number, startMonth: number, months: number) {
  return {
    start: new Date(year, startMonth, 1),
    end: toEndOfDay(new Date(year, startMonth + months, 0)),
  };
}

function getPresetBounds(
  preset: Exclude<TimeframePreset, "custom">,
  now = new Date(),
): { start: Date | null; end: Date | null } {
  const today = toStartOfDay(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  switch (preset) {
    case "7d":
      return { start: addDays(today, -6), end: toEndOfDay(today) };
    case "mtd":
      return { start: new Date(year, month, 1), end: toEndOfDay(today) };
    case "last_month":
      return closedPeriod(year, month - 1, 1);
    case "qtd":
      return { start: new Date(year, Math.floor(month / 3) * 3, 1), end: toEndOfDay(today) };
    case "last_quarter":
      return closedPeriod(year, Math.floor(month / 3) * 3 - 3, 3);
    case "ytd":
      return { start: new Date(year, 0, 1), end: toEndOfDay(today) };
    case "last_year":
      return closedPeriod(year - 1, 0, 12);
    case "all":
      return { start: null, end: null };
  }
}

export function createDefaultTimeframe(
  preset: Exclude<TimeframePreset, "custom"> = DEFAULT_TIMEFRAME_PRESET,
): TimeframeValue {
  return {
    preset,
    customStart: null,
    customEnd: null,
  };
}

export function resolveTimeframeBounds(timeframe: TimeframeValue, now = new Date()) {
  // Every consumer routes through here, so this is the one place a retired preset has to be caught.
  const preset = normalizeTimeframePreset(timeframe.preset);
  if (preset !== "custom") {
    return getPresetBounds(preset, now);
  }

  const startDate = parseUnknownDate(timeframe.customStart);
  const endDate = parseUnknownDate(timeframe.customEnd);

  const start = startDate ? toStartOfDay(startDate) : null;
  const end = endDate ? toEndOfDay(endDate) : null;

  if (start && end && start.getTime() > end.getTime()) {
    return { start: toStartOfDay(endDate as Date), end: toEndOfDay(startDate as Date) };
  }

  return { start, end };
}

export function filterByTimeframe<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  timeframe: TimeframeValue,
  now?: Date,
) {
  const bounds = resolveTimeframeBounds(timeframe, now);
  if (!bounds.start && !bounds.end) return items;

  return items.filter((item) => {
    const date = parseUnknownDate(getDate(item));
    if (!date) return false;
    const timestamp = date.getTime();
    if (bounds.start && timestamp < bounds.start.getTime()) return false;
    if (bounds.end && timestamp > bounds.end.getTime()) return false;
    return true;
  });
}

export function getTimeframeLabel(timeframe: TimeframeValue) {
  const preset = normalizeTimeframePreset(timeframe.preset);
  if (preset !== "custom") {
    // The `??` is unreachable — normalizeTimeframePreset only returns keys from this table — but
    // deriving the fallback from the table keeps the label out of a second, drift-prone literal.
    return (
      TIMEFRAME_PRESETS.find((entry) => entry.key === preset)?.label ??
      TIMEFRAME_PRESETS.find((entry) => entry.key === DEFAULT_TIMEFRAME_PRESET)!.label
    );
  }

  if (timeframe.customStart && timeframe.customEnd) {
    return `${formatDate(timeframe.customStart, { day: "numeric", month: "short" })} - ${formatDate(timeframe.customEnd, { day: "numeric", month: "short" })}`;
  }
  if (timeframe.customStart) {
    return `From ${formatDate(timeframe.customStart, { day: "numeric", month: "short" })}`;
  }
  if (timeframe.customEnd) {
    return `Until ${formatDate(timeframe.customEnd, { day: "numeric", month: "short" })}`;
  }
  return "Custom range";
}
