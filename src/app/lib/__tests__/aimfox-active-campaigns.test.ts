import { describe, expect, it } from "vitest";
import { createClientMetricsFromSummary } from "../client-metrics";
import type { ClientMetricsSummary } from "../../types/view-contracts";

// The ACTIVE-campaign rollup: remaining database, acceptance rate and the Li/Lf service level.
// Every one of these comes from `campaigns` rather than from the daily snapshot, and the thing
// worth pinning is not the arithmetic but the null handling — each field has to say "—" rather
// than invent a number for a client we have not measured.

const ZEROS = [0, 0, 0, 0, 0];

function summary(over: Partial<ClientMetricsSummary> = {}): ClientMetricsSummary {
  return {
    client_id: "c1",
    daily_sent: [...ZEROS],
    schedule_today: 0,
    schedule_tomorrow: 0,
    schedule_day_after: 0,
    wow_sent: [...ZEROS],
    wow_human: [...ZEROS],
    wow_bounce: [...ZEROS],
    wow_ooo: [...ZEROS],
    wow_negative: [...ZEROS],
    wow_leads: [...ZEROS],
    wow_sql: [...ZEROS],
    mom_total: [...ZEROS],
    mom_sql: [...ZEROS],
    mom_meetings: [...ZEROS],
    mom_won: [...ZEROS],
    threedod_total: [...ZEROS],
    threedod_sql: [...ZEROS],
    latest_prospects_count: 0,
    threedod_total_eb: [...ZEROS],
    threedod_total_af: [...ZEROS],
    threedod_sql_eb: [...ZEROS],
    threedod_sql_af: [...ZEROS],
    wow_leads_eb: [...ZEROS],
    wow_leads_af: [...ZEROS],
    wow_sql_eb: [...ZEROS],
    wow_sql_af: [...ZEROS],
    mom_total_eb: [...ZEROS],
    mom_total_af: [...ZEROS],
    mom_sql_eb: [...ZEROS],
    mom_sql_af: [...ZEROS],
    mom_meetings_eb: [...ZEROS],
    mom_meetings_af: [...ZEROS],
    mom_won_eb: [...ZEROS],
    mom_won_af: [...ZEROS],
    aimfox_daily_sent: [...ZEROS],
    aimfox_schedule_today: 0,
    aimfox_schedule_tomorrow: 0,
    aimfox_schedule_day_after: 0,
    aimfox_invite_limit: null,
    aimfox_invite_limit_remaining: null,
    aimfox_remaining_database_size: null,
    aimfox_active_campaigns: 0,
    aimfox_active_audience: 0,
    aimfox_active_invites_sent: null,
    aimfox_active_invites_accepted: null,
    aimfox_active_with_messages: 0,
    aimfox_active_measured: 0,
    ...over,
  } as ClientMetricsSummary;
}

const overview = (over: Partial<ClientMetricsSummary>) => createClientMetricsFromSummary(summary(over)).overview;

describe("Aimfox ACTIVE-campaign rollup", () => {
  it("derives remaining database from the loaded audience, not from the vendor ceiling", () => {
    // The real ColdUnicorn PL numbers behind the change: three active campaigns totalling 3005
    // prospects with 792 invites already sent. The daily snapshot said 19968 for the same client
    // because it subtracted from `audience_size`, a fixed 10000-per-campaign ceiling.
    const o = overview({
      aimfox_active_campaigns: 3,
      aimfox_active_audience: 3005,
      aimfox_active_invites_sent: 792,
      aimfox_active_invites_accepted: 333,
      aimfox_active_measured: 3,
      aimfox_remaining_database_size: 19_968,
    });

    expect(o.aimfoxActiveRemainingDb).toBe(2213);
    expect(o.aimfoxAcceptRate).toBeCloseTo(0.4205, 4);
    // The deprecated field is still carried, and still wrong — proof the grid reads the other one.
    expect(o.aimfoxRemainingDb).toBe(19_968);
  });

  it("floors remaining database at zero when a campaign oversends its audience", () => {
    const o = overview({
      aimfox_active_campaigns: 1,
      aimfox_active_audience: 100,
      aimfox_active_invites_sent: 140,
      aimfox_active_invites_accepted: 10,
      aimfox_active_measured: 1,
    });
    expect(o.aimfoxActiveRemainingDb).toBe(0);
  });

  it("reports nothing at all for a client with no active campaign", () => {
    const o = overview({});
    expect(o.aimfoxActiveRemainingDb).toBeNull();
    expect(o.aimfoxAcceptRate).toBeNull();
    expect(o.aimfoxCampaignMode).toBeNull();
  });

  it("reports nothing when the campaigns exist but have never been measured", () => {
    // aimfox-campaign-sync catalogues a campaign an hour before aimfox-daily-metrics measures it.
    // In that window the audience is known and the counters are not, and a remaining database of
    // "the whole audience" would be a guess stated as a fact.
    const o = overview({
      aimfox_active_campaigns: 2,
      aimfox_active_audience: 900,
      aimfox_active_invites_sent: null,
      aimfox_active_invites_accepted: null,
      aimfox_active_measured: 0,
    });
    expect(o.aimfoxActiveRemainingDb).toBeNull();
    expect(o.aimfoxAcceptRate).toBeNull();
    expect(o.aimfoxCampaignMode).toBeNull();
  });

  it("reads acceptance as a 0..1 fraction and refuses to divide by nothing", () => {
    expect(
      overview({
        aimfox_active_campaigns: 1,
        aimfox_active_audience: 500,
        aimfox_active_invites_sent: 0,
        aimfox_active_invites_accepted: 0,
        aimfox_active_measured: 1,
      }).aimfoxAcceptRate,
    ).toBeNull();

    expect(
      overview({
        aimfox_active_campaigns: 1,
        aimfox_active_audience: 500,
        aimfox_active_invites_sent: 200,
        aimfox_active_invites_accepted: 0,
        aimfox_active_measured: 1,
      }).aimfoxAcceptRate,
    ).toBe(0);
  });

  it("calls a client Li only when every measured active campaign is invitations-only", () => {
    const mode = (withMessages: number) =>
      overview({
        aimfox_active_campaigns: 2,
        aimfox_active_audience: 900,
        aimfox_active_invites_sent: 100,
        aimfox_active_invites_accepted: 20,
        aimfox_active_measured: 2,
        aimfox_active_with_messages: withMessages,
      }).aimfoxCampaignMode;

    expect(mode(0)).toBe("invites");
    // One campaign with a sequence is enough: the client is running full LinkedIn outreach.
    expect(mode(1)).toBe("full");
    expect(mode(2)).toBe("full");
  });
});
