import { describe, expect, it } from "vitest";
import {
  createClientMetrics,
  createClientMetricsFromSummary,
  projectMetricsToChannel,
} from "../client-metrics";
import type { ClientMetricsSummary } from "../../types/view-contracts";

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
    client_id: "client-1",
    report_date: date,
    emails_sent: sent,
    mql_count: 0,
    response_count: response,
    bounce_count: bounce,
    negative_count: negative,
    ooo_count: ooo,
    human_replies_count: human,
    prospects_count: 0,
    schedule_today: scheduleToday,
    schedule_tomorrow: scheduleTomorrow,
    schedule_day_after: scheduleDayAfter,
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
    external_blacklist_id: null,
    external_domain_blacklist_id: null,
    source: "test",
    reply_text: null,
    client_note: null,
    coldunicorn_note: null,
    highlight: null,
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

    expect(metrics.overview.wowResponseRate).toBeCloseTo(61 / 490, 4); // (human+ooo)/sent
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

// Blended = 10, EmailBison = 7, Aimfox = 3 across every lead-derived metric, so a projected value
// identifies its channel unambiguously. Aimfox volume differs from Bison volume on purpose.
function makeSummary(): ClientMetricsSummary {
  const blended = [10, 10, 10, 10, 10];
  const eb = [7, 7, 7, 7, 7];
  const af = [3, 3, 3, 3, 3];
  return {
    client_id: "client-1",
    daily_sent: [380, 395, 384, 300, 280],
    schedule_today: 380,
    schedule_tomorrow: 395,
    schedule_day_after: 410,
    wow_sent: [1000, 0, 0, 0, 0],
    wow_human: [100, 0, 0, 0, 0],
    wow_bounce: [50, 0, 0, 0, 0],
    wow_ooo: [20, 0, 0, 0, 0],
    wow_negative: [10, 0, 0, 0, 0],
    wow_leads: blended,
    wow_sql: blended,
    mom_total: blended,
    mom_sql: blended,
    mom_meetings: blended,
    mom_won: blended,
    threedod_total: blended,
    threedod_sql: blended,
    latest_prospects_count: 4200,
    threedod_total_eb: eb,
    threedod_total_af: af,
    threedod_sql_eb: eb,
    threedod_sql_af: af,
    wow_leads_eb: eb,
    wow_leads_af: af,
    wow_sql_eb: eb,
    wow_sql_af: af,
    mom_total_eb: eb,
    mom_total_af: af,
    mom_sql_eb: eb,
    mom_sql_af: af,
    mom_meetings_eb: eb,
    mom_meetings_af: af,
    mom_won_eb: eb,
    mom_won_af: af,
    aimfox_daily_sent: [40, 41, 42, 43, 44],
    aimfox_schedule_today: 45,
    aimfox_schedule_tomorrow: 46,
    aimfox_schedule_day_after: 47,
    aimfox_invite_limit: 195,
    aimfox_invite_limit_remaining: 8,
    aimfox_remaining_database_size: 19_968,
    aimfox_active_campaigns: 1,
    aimfox_active_audience: 2167,
    aimfox_active_invites_sent: 215,
    aimfox_active_invites_accepted: 71,
    aimfox_active_with_messages: 0,
    aimfox_active_measured: 1,
  };
}

describe("projectMetricsToChannel", () => {
  const pack = createClientMetricsFromSummary(makeSummary());
  const bucket = <T extends { bucket: string }>(rows: T[], name: string) => rows.find((r) => r.bucket === name)!;

  it("returns the pack untouched for the Both view", () => {
    // Same reference, not a deep copy: the default view must pay nothing for the switch existing.
    expect(projectMetricsToChannel(pack, "both")).toBe(pack);
  });

  it("narrows every lead-derived band to EmailBison", () => {
    const eb = projectMetricsToChannel(pack, "email");

    expect(eb.threeDodRows.map((r) => r.totalLeads)).toEqual([7, 7, 7, 7, 7]);
    expect(eb.threeDodRows.map((r) => r.sqlLeads)).toEqual([7, 7, 7, 7, 7]);
    expect(eb.wowRows[0].totalLeads).toBe(7);
    expect(eb.wowRows[0].sqlLeads).toBe(7);
    expect(eb.momRows[0].totalLeads).toBe(7);
    expect(eb.momRows[0].sqlLeads).toBe(7);
    expect(eb.momRows[0].meetings).toBe(7);
    expect(eb.momRows[0].won).toBe(7);

    // Schedule / Daily sent come from daily_stats, which is EmailBison by construction — untouched.
    expect(eb.dodRows).toBe(pack.dodRows);
    expect(eb.overview.sentToday).toBe(380);
    expect(eb.overview.scheduleDayAfter).toBe(410);

    // Reply rates are Bison facts and stay.
    expect(eb.wowRows[0].humanRate).toBeCloseTo(0.1, 4);

    expect(eb.overview.threeDodTotal).toBe(21); // buckets 0..-2
    expect(eb.overview.wowSql).toBe(7);
    expect(eb.overview.momSql).toBe(7);
  });

  it("narrows every lead-derived band to Aimfox and swaps in the LinkedIn volume", () => {
    const af = projectMetricsToChannel(pack, "aimfox");

    expect(af.threeDodRows.map((r) => r.totalLeads)).toEqual([3, 3, 3, 3, 3]);
    expect(af.wowRows[0].sqlLeads).toBe(3);
    expect(af.momRows[0].totalLeads).toBe(3);
    expect(af.momRows[0].meetings).toBe(3);
    expect(af.momRows[0].won).toBe(3);

    expect(bucket(af.dodRows, "0").sent).toBe(40);
    expect(bucket(af.dodRows, "-1").sent).toBe(41);
    expect(bucket(af.dodRows, "0").schedule).toBe(45);
    expect(bucket(af.dodRows, "+1").schedule).toBe(46);
    expect(bucket(af.dodRows, "+2").schedule).toBe(47);
    // The Bison band leaves schedule null on past days and sent null on future ones; the Aimfox
    // mirror must keep those holes as "—" rather than inventing a 0.
    expect(bucket(af.dodRows, "-1").schedule).toBeNull();
    expect(bucket(af.dodRows, "+2").sent).toBeNull();
    expect(af.overview.sentToday).toBe(40);
    expect(af.overview.scheduleToday).toBe(45);

    // No email reply rate may survive under an Aimfox heading. There is no WoW acceptance band any
    // more — acceptance is a cumulative per-campaign fact now, on the overview, not a weekly rate
    // divided out of two daily counters.
    expect(af.wowRows[0].responseRate).toBeNull();
    expect(af.wowRows[0].humanRate).toBeNull();
    expect(af.wowRows[0].bounceRate).toBeNull();
    expect(af.wowRows[0].oooRate).toBeNull();
    expect(af.overview.wowHumanRate).toBeNull();

    // Channel-agnostic facts survive untouched.
    expect(af.overview.latestProspectsCount).toBe(4200);
    expect(af.overview.aimfoxInviteLimitRemaining).toBe(8);
  });

  it("projects a raw pack (no sequencer dimension) to zeros instead of throwing", () => {
    const raw = createClientMetrics(
      [] as never,
      [makeLead("2026-04-19", "MQL")] as never,
      new Date("2026-04-19T12:00:00.000Z"),
    );
    const af = projectMetricsToChannel(raw, "aimfox");
    expect(af.threeDodRows[0].totalLeads).toBe(0);
    expect(af.momRows[0].won).toBe(0);
    expect(bucket(af.dodRows, "0").sent).toBeNull();
  });
});
