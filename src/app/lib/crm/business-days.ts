/**
 * Business-day / deadline engine for the Lead CRM health model (Cold CRM / PDCA spec, Appendix D).
 *
 * DESIGN CONTRACT — this module is imported by BOTH the browser bundle and the Deno `orm-gateway`
 * edge function (same relative-import mechanism as `orm-gateway-contract.ts`). It must therefore:
 *   - have ZERO runtime dependencies (only `Date` + `Intl`, available in Deno and the browser),
 *   - be pure (no `Date.now()` inside the deadline math — callers pass an explicit `asOf`),
 *   - keep one implementation so backend and frontend can never disagree on a red/orange cell.
 *
 * Timezone / holiday / cutoff parameters are DEFERRED (spec §12 Q19, Appendix D.2): we ship a
 * sensible default and thread the real values through `BusinessDayConfig` later without touching
 * any call site. Until the client confirms them, derived colours are "indicative, not authoritative".
 */

/** Working-day / SLA configuration. Threaded through the read-model payload (see the gateway). */
export interface BusinessDayConfig {
  /** IANA timezone the "working day" and the 16:00 cutoff are evaluated in. */
  timezone: string;
  /** ISO `YYYY-MM-DD` dates treated as non-working (holidays). Empty until a calendar is confirmed. */
  holidays: string[];
  /** A lead arriving at/after this local hour has its contact-SLA "day 0" shifted to the next working day. */
  cutoffHour: number;
  /** `Date.getUTCDay()` values that are weekend days. Default `[6, 0]` = Saturday, Sunday. */
  weekend: number[];
}

/**
 * Default config. `Europe/Warsaw` per spec Appendix D.2 ("if unavailable, Europe/Warsaw"); holidays
 * empty (documented: holidays are NOT counted until a calendar is implemented); cutoff 16:00.
 */
export const DEFAULT_BUSINESS_DAY_CONFIG: BusinessDayConfig = {
  timezone: "Europe/Warsaw",
  holidays: [],
  cutoffHour: 16,
  weekend: [6, 0],
};

/** A wall-clock calendar date in the configured timezone (no time component). */
export interface CivilDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

interface ZonedParts extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timezone, fmt);
  }
  return fmt;
}

/** Extract the wall-clock parts of an instant as seen in `timezone`. */
function zonedParts(iso: string | Date, timezone: string): ZonedParts {
  const instant = iso instanceof Date ? iso : new Date(iso);
  const map: Record<string, number> = {};
  for (const part of zonedFormatter(timezone).formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** The offset (timezone − UTC) in milliseconds at a given instant. */
function tzOffsetMs(timezone: string, instantMs: number): number {
  const p = zonedParts(new Date(instantMs), timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instantMs;
}

/**
 * Convert a wall-clock time in `timezone` to a UTC ISO string. Standard two-pass offset lookup
 * (as in date-fns-tz): guess the offset at the naive instant, then correct. Near a DST transition
 * this can be off by the transition amount for the ~1h ambiguous window — acceptable while tz params
 * are deferred and deadlines are day-granular.
 */
function zonedWallToUtcIso(
  c: CivilDate,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): string {
  const naive = Date.UTC(c.year, c.month - 1, c.day, hour, minute, second);
  const offset = tzOffsetMs(timezone, naive);
  return new Date(naive - offset).toISOString();
}

function civilWeekday(c: CivilDate): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

function civilKey(c: CivilDate): string {
  const mm = String(c.month).padStart(2, "0");
  const dd = String(c.day).padStart(2, "0");
  return `${c.year}-${mm}-${dd}`;
}

function addCivilDays(c: CivilDate, n: number): CivilDate {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Number of whole days from `a` to `b` (positive if b is later), by civil date. */
function civilDaysBetween(a: CivilDate, b: CivilDate): number {
  const am = Date.UTC(a.year, a.month - 1, a.day);
  const bm = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bm - am) / MS_PER_DAY);
}

export function isWorkingDay(c: CivilDate, cfg: BusinessDayConfig): boolean {
  if (cfg.weekend.includes(civilWeekday(c))) return false;
  if (cfg.holidays.includes(civilKey(c))) return false;
  return true;
}

/** The next working day strictly after `c`. */
export function nextWorkingDay(c: CivilDate, cfg: BusinessDayConfig): CivilDate {
  let cur = addCivilDays(c, 1);
  while (!isWorkingDay(cur, cfg)) cur = addCivilDays(cur, 1);
  return cur;
}

/**
 * The civil date `n` working days after `start` (n ≥ 0). `start` need not itself be a working day;
 * only subsequent working days are counted. `n = 0` returns `start` unchanged.
 */
export function addBusinessDays(start: CivilDate, n: number, cfg: BusinessDayConfig): CivilDate {
  let cur = start;
  let remaining = Math.max(0, Math.trunc(n));
  while (remaining > 0) {
    cur = addCivilDays(cur, 1);
    if (isWorkingDay(cur, cfg)) remaining -= 1;
  }
  return cur;
}

/** The civil date of an instant, as seen in the configured timezone. */
export function civilDateOf(iso: string, cfg: BusinessDayConfig): CivilDate {
  const p = zonedParts(iso, cfg.timezone);
  return { year: p.year, month: p.month, day: p.day };
}

/**
 * Allowed "day 0" for the contact-made SLA (spec §5.2, Appendix D.2): the lead's received local
 * date, unless it arrived on a non-working day or at/after the cutoff hour — then it shifts to the
 * next working day.
 */
export function contactDayZero(receivedIso: string, cfg: BusinessDayConfig): CivilDate {
  const p = zonedParts(receivedIso, cfg.timezone);
  const received: CivilDate = { year: p.year, month: p.month, day: p.day };
  if (!isWorkingDay(received, cfg) || p.hour >= cfg.cutoffHour) {
    return nextWorkingDay(received, cfg);
  }
  return received;
}

/** End-of-local-day (23:59:59) UTC ISO string for a civil date — the shape used in tooltips. */
export function endOfDayIso(c: CivilDate, cfg: BusinessDayConfig): string {
  return zonedWallToUtcIso(c, 23, 59, 59, cfg.timezone);
}

/**
 * Deadline = end of the local day that is `workingDays` working days after the anchor instant's
 * local date. Used for the "missing 1 / 2 working days after X" rules across the CRM columns.
 */
export function businessDeadline(anchorIso: string, workingDays: number, cfg: BusinessDayConfig): string {
  const due = addBusinessDays(civilDateOf(anchorIso, cfg), workingDays, cfg);
  return endOfDayIso(due, cfg);
}

/**
 * Contact-SLA deadline: end of the local day that is `extraWorkingDays` working days after the
 * normalized day 0 (0 → end of day 0, 1 → end of day +1, …).
 */
export function contactDeadline(receivedIso: string, extraWorkingDays: number, cfg: BusinessDayConfig): string {
  const due = addBusinessDays(contactDayZero(receivedIso, cfg), extraWorkingDays, cfg);
  return endOfDayIso(due, cfg);
}

/**
 * Working days between two civil dates (`from` exclusive, `to` inclusive when later). Same date → 0;
 * next working day → 1. This is the primitive behind "Days to contact" and the contact-SLA matrix,
 * which measures the contact date against the normalized day 0 (itself a civil date).
 */
export function businessDaysBetweenCivil(from: CivilDate, to: CivilDate, cfg: BusinessDayConfig): number {
  const totalDays = civilDaysBetween(from, to);
  if (totalDays === 0) return 0;
  const sign = totalDays > 0 ? 1 : -1;
  let count = 0;
  let cur = from;
  for (let i = 0; i < Math.abs(totalDays); i += 1) {
    cur = addCivilDays(cur, sign);
    if (isWorkingDay(cur, cfg)) count += 1;
  }
  return sign * count;
}

/**
 * Working days elapsed between two instants, by civil date (`from` exclusive, `to` inclusive when
 * later). Same-day → 0; next working day → 1. Used for "Days to contact" (spec §5.2 Q).
 */
export function businessDaysBetween(fromIso: string, toIso: string, cfg: BusinessDayConfig): number {
  return businessDaysBetweenCivil(civilDateOf(fromIso, cfg), civilDateOf(toIso, cfg), cfg);
}

/** Calendar days between two instants, by civil date in the configured timezone (spec §5.5 AI). */
export function calendarDaysBetween(fromIso: string, toIso: string, cfg: BusinessDayConfig): number {
  return civilDaysBetween(civilDateOf(fromIso, cfg), civilDateOf(toIso, cfg));
}

/** Add `hours` to an instant (timestamp-based, timezone-independent) — the 2h transcript SLA. */
export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * MS_PER_HOUR).toISOString();
}

/** Add `weeks` calendar weeks to an instant — the 1/2-week negotiation thresholds (spec Appendix D.3). */
export function addCalendarWeeks(iso: string, weeks: number): string {
  return new Date(new Date(iso).getTime() + weeks * 7 * MS_PER_DAY).toISOString();
}

/** True when `asOf` is strictly past `deadlineIso`. Both are absolute instants. */
export function isPastDeadline(deadlineIso: string, asOfIso: string): boolean {
  return new Date(asOfIso).getTime() > new Date(deadlineIso).getTime();
}
