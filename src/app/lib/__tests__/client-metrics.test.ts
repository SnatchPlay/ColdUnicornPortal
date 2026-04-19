import { describe, expect, it } from "vitest";
import { createClientMetrics } from "../client-metrics";

function makeDailyStat(
  date: string,
  sent: number,
  response: number,
  bounce: number,
  human: number,
  ooo: number,
  negative: number,
  scheduleToday = 0,
  scheduleTomorrow = 0,
  scheduleDayAfter = 0,
) {
  return {
    id: `ds-${date}`,
    client_id: "client-1",
    report_date: date,
    emails_sent: sent,
    prospects_in_base: 0,
    mql_count: 0,
    me_count: 0,
    response_count: response,
    bounce_count: bounce,
    won_count: 0,
    negative_count: negative,
    ooo_count: ooo,
    human_replies_count: human,
    inboxes_count: 0,
    prospects_count: 0,
    schedule_today: scheduleToday,
    schedule_tomorrow: scheduleTomorrow,
    schedule_day_after: scheduleDayAfter,
    week_number: 16,
    month_number: 4,
    year: 2026,
    created_at: `${date}T00:00:00.000Z`,
  };
}

function makeLead(date: string, qualification: string | null, meetingBooked = false, won = false) {
  return {
    id: `lead-${date}-${qualification ?? "none"}-${meetingBooked ? "meeting" : "nomeeting"}-${won ? "won" : "nowon"}`,
    created_at: `${date}T10:00:00.000Z`,
    updated_at: `${date}T10:00:00.000Z`,
    client_id: "client-1",
    campaign_id: null,
    email: `${date}@test.local`,
    first_name: "Lead",
    last_name: "User",
    job_title: null,
    company_name: null,
    linkedin_url: null,
    gender: null,
    qualification,
    expected_return_date: null,
    external_id: null,
    phone_number: null,
    phone_source: null,
    industry: null,
    headcount_range: null,
    website: null,
    country: null,
    message_title: null,
    message_number: null,
    response_time_hours: null,
    response_time_label: null,
    meeting_booked: meetingBooked,
    meeting_held: false,
    offer_sent: false,
    won,
    added_to_ooo_campaign: false,
    external_blacklist_id: null,
    external_domain_blacklist_id: null,
    source: "test",
    reply_text: null,
    comments: null,
  };
}

describe("createClientMetrics", () => {
  it("computes DoD, 3DoD, WoW and MoM metrics from existing sources", () => {
    const dailyStats = [
      makeDailyStat("2026-04-19", 100, 20, 5, 10, 3, 2, 300, 350, 400),
      makeDailyStat("2026-04-18", 90, 18, 4, 9, 2, 1),
      makeDailyStat("2026-04-17", 80, 16, 4, 8, 2, 1),
      makeDailyStat("2026-04-16", 70, 14, 3, 7, 2, 1),
      makeDailyStat("2026-04-15", 60, 12, 3, 6, 1, 1),
      makeDailyStat("2026-04-14", 50, 10, 2, 5, 1, 1),
      makeDailyStat("2026-04-13", 40, 8, 2, 4, 1, 1),
      makeDailyStat("2026-04-06", 30, 6, 1, 3, 1, 0),
      makeDailyStat("2026-04-05", 20, 4, 1, 2, 1, 0),
    ];

    const leads = [
      makeLead("2026-04-19", "MQL", true),
      makeLead("2026-04-19", "preMQL"),
      makeLead("2026-04-19", null),
      makeLead("2026-04-18", "MQL"),
      makeLead("2026-04-17", "preMQL"),
      makeLead("2026-04-16", "MQL"),
      makeLead("2026-04-10", "MQL"),
      makeLead("2026-03-22", "MQL", false, true),
      makeLead("2026-03-15", null),
    ];

    const metrics = createClientMetrics(dailyStats as never, leads as never, new Date("2026-04-19T12:00:00.000Z"));

    expect(metrics.overview.scheduleDayAfter).toBe(400);
    expect(metrics.overview.scheduleTomorrow).toBe(350);
    expect(metrics.overview.scheduleToday).toBe(300);

    expect(metrics.overview.sentToday).toBe(100);
    expect(metrics.overview.sentYesterday).toBe(90);
    expect(metrics.overview.sentTwoDaysAgo).toBe(80);

    expect(metrics.overview.threeDodTotal).toBe(4);
    expect(metrics.overview.threeDodSql).toBe(2);

    expect(metrics.overview.wowResponseRate).toBeCloseTo(0.2, 4);
    expect(metrics.overview.wowHumanRate).toBeCloseTo(0.1, 4);
    expect(metrics.overview.wowBounceRate).toBeCloseTo(23 / 490, 4);
    expect(metrics.overview.wowOooRate).toBeCloseTo(12 / 490, 4);
    expect(metrics.overview.wowSql).toBe(3);
    expect(metrics.overview.momSql).toBe(4);

    expect(metrics.wowRows[0].totalLeads).toBe(6);
    expect(metrics.wowRows[0].sqlLeads).toBe(3);
    expect(metrics.momRows[0].meetings).toBe(1);
    expect(metrics.momRows[1].won).toBe(1);
  });

  it("returns null rates when weekly sent volume is zero", () => {
    const dailyStats = [makeDailyStat("2026-04-10", 10, 2, 1, 1, 0, 0)];
    const leads = [makeLead("2026-04-19", "MQL")];

    const metrics = createClientMetrics(dailyStats as never, leads as never, new Date("2026-04-19T12:00:00.000Z"));
    expect(metrics.wowRows[0].responseRate).toBeNull();
    expect(metrics.wowRows[0].humanRate).toBeNull();
    expect(metrics.wowRows[0].bounceRate).toBeNull();
    expect(metrics.wowRows[0].oooRate).toBeNull();
    expect(metrics.wowRows[0].negativeRate).toBeNull();
  });
});
