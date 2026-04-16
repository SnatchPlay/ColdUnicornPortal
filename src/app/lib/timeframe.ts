import { formatDate } from "./format";

export type TimeframePreset = "7d" | "30d" | "90d" | "mtd" | "qtd" | "ytd" | "all" | "custom";

export interface TimeframeValue {
  preset: TimeframePreset;
  customStart: string | null;
  customEnd: string | null;
}

export const TIMEFRAME_PRESETS: Array<{ key: Exclude<TimeframePreset, "custom">; label: string }> = [
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "mtd", label: "Month to Date" },
  { key: "qtd", label: "Quarter to Date" },
  { key: "ytd", label: "Year to Date" },
  { key: "all", label: "All Time" },
];

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

function getPresetBounds(preset: Exclude<TimeframePreset, "custom">, now = new Date()) {
  const today = toStartOfDay(now);
  switch (preset) {
    case "7d":
      return { start: addDays(today, -6), end: toEndOfDay(today) };
    case "30d":
      return { start: addDays(today, -29), end: toEndOfDay(today) };
    case "90d":
      return { start: addDays(today, -89), end: toEndOfDay(today) };
    case "mtd":
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: toEndOfDay(today) };
    case "qtd": {
      const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3;
      return { start: new Date(today.getFullYear(), quarterStartMonth, 1), end: toEndOfDay(today) };
    }
    case "ytd":
      return { start: new Date(today.getFullYear(), 0, 1), end: toEndOfDay(today) };
    case "all":
    default:
      return { start: null, end: null };
  }
}

export function createDefaultTimeframe(): TimeframeValue {
  return {
    preset: "30d",
    customStart: null,
    customEnd: null,
  };
}

export function resolveTimeframeBounds(timeframe: TimeframeValue) {
  if (timeframe.preset !== "custom") {
    return getPresetBounds(timeframe.preset);
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
) {
  const bounds = resolveTimeframeBounds(timeframe);
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
  if (timeframe.preset !== "custom") {
    return TIMEFRAME_PRESETS.find((preset) => preset.key === timeframe.preset)?.label ?? "Last 30 Days";
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
  return "Custom Range";
}