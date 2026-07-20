import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_DAY_CONFIG,
  addBusinessDays,
  addCalendarWeeks,
  addHours,
  businessDaysBetween,
  businessDeadline,
  calendarDaysBetween,
  contactDayZero,
  contactDeadline,
  endOfDayIso,
  isPastDeadline,
  isWorkingDay,
  nextWorkingDay,
  type BusinessDayConfig,
} from "../business-days";

// Reference calendar (all Europe/Warsaw, CEST = UTC+2 in July):
//   Mon 2026-07-13 · Fri 2026-07-17 · Sat 2026-07-18 · Sun 2026-07-19 · Mon 2026-07-20
const cfg = DEFAULT_BUSINESS_DAY_CONFIG;

describe("isWorkingDay / nextWorkingDay", () => {
  it("weekdays are working, weekend days are not", () => {
    expect(isWorkingDay({ year: 2026, month: 7, day: 13 }, cfg)).toBe(true); // Mon
    expect(isWorkingDay({ year: 2026, month: 7, day: 18 }, cfg)).toBe(false); // Sat
    expect(isWorkingDay({ year: 2026, month: 7, day: 19 }, cfg)).toBe(false); // Sun
  });

  it("holidays in config are non-working", () => {
    const withHoliday: BusinessDayConfig = { ...cfg, holidays: ["2026-07-13"] };
    expect(isWorkingDay({ year: 2026, month: 7, day: 13 }, withHoliday)).toBe(false);
  });

  it("nextWorkingDay skips the weekend", () => {
    expect(nextWorkingDay({ year: 2026, month: 7, day: 17 }, cfg)).toEqual({ year: 2026, month: 7, day: 20 });
  });
});

describe("addBusinessDays", () => {
  it("adds within the week", () => {
    expect(addBusinessDays({ year: 2026, month: 7, day: 13 }, 1, cfg)).toEqual({ year: 2026, month: 7, day: 14 });
  });

  it("skips the weekend", () => {
    expect(addBusinessDays({ year: 2026, month: 7, day: 17 }, 1, cfg)).toEqual({ year: 2026, month: 7, day: 20 });
    expect(addBusinessDays({ year: 2026, month: 7, day: 13 }, 5, cfg)).toEqual({ year: 2026, month: 7, day: 20 });
  });

  it("n = 0 returns the start unchanged", () => {
    expect(addBusinessDays({ year: 2026, month: 7, day: 18 }, 0, cfg)).toEqual({ year: 2026, month: 7, day: 18 });
  });
});

describe("contactDayZero (after-16:00 + non-working shift)", () => {
  it("before cutoff on a working day → same day", () => {
    // 09:00 Warsaw = 07:00Z
    expect(contactDayZero("2026-07-13T07:00:00Z", cfg)).toEqual({ year: 2026, month: 7, day: 13 });
  });

  it("at/after 16:00 local → next working day", () => {
    // 17:00 Warsaw = 15:00Z
    expect(contactDayZero("2026-07-13T15:00:00Z", cfg)).toEqual({ year: 2026, month: 7, day: 14 });
  });

  it("arrives on a weekend → next working day (Monday)", () => {
    // Sat 10:00 Warsaw = 08:00Z
    expect(contactDayZero("2026-07-18T08:00:00Z", cfg)).toEqual({ year: 2026, month: 7, day: 20 });
  });
});

describe("businessDaysBetween (Days to contact)", () => {
  it("same working day → 0", () => {
    expect(businessDaysBetween("2026-07-13T07:00:00Z", "2026-07-13T14:00:00Z", cfg)).toBe(0);
  });

  it("next working day → 1", () => {
    expect(businessDaysBetween("2026-07-13T07:00:00Z", "2026-07-14T07:00:00Z", cfg)).toBe(1);
  });

  it("across a weekend counts only working days", () => {
    // Fri → Mon = 1 working day
    expect(businessDaysBetween("2026-07-17T07:00:00Z", "2026-07-20T07:00:00Z", cfg)).toBe(1);
  });
});

describe("deadlines (end-of-local-day ISO)", () => {
  it("businessDeadline: 1 working day after a Monday anchor → end of Tuesday (CEST UTC+2)", () => {
    expect(businessDeadline("2026-07-13T09:00:00Z", 1, cfg)).toBe("2026-07-14T21:59:59.000Z");
  });

  it("contactDeadline: day 0 and day +1 end-of-day", () => {
    expect(contactDeadline("2026-07-13T07:00:00Z", 0, cfg)).toBe("2026-07-13T21:59:59.000Z");
    expect(contactDeadline("2026-07-13T07:00:00Z", 1, cfg)).toBe("2026-07-14T21:59:59.000Z");
  });

  it("endOfDayIso honours winter offset (CET UTC+1)", () => {
    expect(endOfDayIso({ year: 2026, month: 1, day: 15 }, cfg)).toBe("2026-01-15T22:59:59.000Z");
  });
});

describe("timestamp / calendar helpers", () => {
  it("addHours (2h transcript SLA)", () => {
    expect(addHours("2026-07-13T10:00:00.000Z", 2)).toBe("2026-07-13T12:00:00.000Z");
  });

  it("addCalendarWeeks (negotiation thresholds)", () => {
    expect(addCalendarWeeks("2026-07-13T10:00:00.000Z", 1)).toBe("2026-07-20T10:00:00.000Z");
  });

  it("calendarDaysBetween (days in negotiation)", () => {
    expect(calendarDaysBetween("2026-07-13T10:00:00Z", "2026-07-20T10:00:00Z", cfg)).toBe(7);
  });

  it("isPastDeadline compares absolute instants", () => {
    expect(isPastDeadline("2026-07-14T21:59:59.000Z", "2026-07-15T00:00:00.000Z")).toBe(true);
    expect(isPastDeadline("2026-07-14T21:59:59.000Z", "2026-07-14T12:00:00.000Z")).toBe(false);
  });
});
