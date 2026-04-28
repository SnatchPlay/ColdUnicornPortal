import { describe, expect, it } from "vitest";
import { createClientMetrics } from "../../client-metrics";
import { buildClientConditionContext } from "../client-condition-context";

describe("buildClientConditionContext", () => {
  it("maps core metrics and client fields from createClientMetrics output", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const dailyStats = [
      {
        id: "d1",
        client_id: "client-1",
        report_date: iso,
        emails_sent: 150,
        prospects_in_base: 0,
        mql_count: 0,
        me_count: 0,
        response_count: 12,
        bounce_count: 3,
        won_count: 0,
        negative_count: 1,
        ooo_count: 4,
        human_replies_count: 8,
        inboxes_count: 0,
        prospects_count: 0,
        schedule_today: 160,
        schedule_tomorrow: 170,
        schedule_day_after: 180,
        week_number: 17,
        month_number: 4,
        year: 2026,
        created_at: `${iso}T00:00:00.000Z`,
      },
    ];

    const leads = [
      {
        id: "l1",
        created_at: `${iso}T08:00:00.000Z`,
        updated_at: `${iso}T08:00:00.000Z`,
        client_id: "client-1",
        campaign_id: null,
        email: null,
        first_name: null,
        last_name: null,
        job_title: null,
        company_name: null,
        linkedin_url: null,
        gender: null,
        qualification: "MQL",
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
        meeting_booked: true,
        meeting_held: false,
        offer_sent: false,
        won: false,
        added_to_ooo_campaign: false,
        external_blacklist_id: null,
        external_domain_blacklist_id: null,
        source: "test",
        reply_text: null,
        comments: null,
      },
    ];

    const metrics = createClientMetrics(dailyStats as never, leads as never, today);
    const context = buildClientConditionContext({
      client: {
        id: "client-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        name: "Acme",
        manager_id: "manager-1",
        kpi_leads: 20,
        kpi_meetings: 8,
        contracted_amount: 1000,
        contract_due_date: null,
        external_workspace_id: 999,
        status: "Active",
        external_api_key: null,
        min_daily_sent: 120,
        inboxes_count: 12,
        crm_config: null,
        sms_phone_numbers: null,
        notification_emails: null,
        auto_ooo_enabled: true,
        linkedin_api_key: "li-key",
        prospects_signed: 200,
        prospects_added: 180,
        setup_info: null,
        bi_setup_done: false,
        lost_reason: null,
        notes: null,
      },
      manager: {
        id: "manager-1",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: null,
        email: "m@test.local",
        first_name: "Mary",
        last_name: "Manager",
        role: "manager",
      },
      metricsOverview: metrics.overview,
      dodRows: metrics.dodRows,
      threeDodRows: metrics.threeDodRows,
      wowRows: metrics.wowRows,
      momRows: metrics.momRows,
      campaigns: [],
      leads: [],
      dailyStats: [],
    });

    expect(context.min_sent).toBe(120);
    expect(context.inboxes).toBe(12);
    expect(context.sent_today).toBe(150);
    expect(context.schedule_today).toBe(160);
    expect(context.schedule_tomorrow).toBe(170);
    expect(context.schedule_day_after).toBe(180);
    expect(context.three_dod_sql).toBeGreaterThanOrEqual(1);
    expect(context.monthly_sql_kpi).toBe(20);
    expect(context.monthly_won_kpi).toBeNull();
    expect(context.auto_li_api_key).toBe("li-key");
  });

  it("keeps nullable/missing mapped fields as null for disabled-rule compatibility", () => {
    const metrics = createClientMetrics([], []);
    const context = buildClientConditionContext({
      client: {
        id: "client-2",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        name: "Bravo",
        manager_id: "manager-1",
        kpi_leads: null,
        kpi_meetings: null,
        contracted_amount: null,
        contract_due_date: null,
        external_workspace_id: null,
        status: "On hold",
        external_api_key: null,
        min_daily_sent: 0,
        inboxes_count: 0,
        crm_config: null,
        sms_phone_numbers: null,
        notification_emails: null,
        auto_ooo_enabled: false,
        linkedin_api_key: null,
        prospects_signed: 0,
        prospects_added: 0,
        setup_info: null,
        bi_setup_done: false,
        lost_reason: null,
        notes: null,
      },
      manager: null,
      metricsOverview: metrics.overview,
      dodRows: metrics.dodRows,
      threeDodRows: metrics.threeDodRows,
      wowRows: metrics.wowRows,
      momRows: metrics.momRows,
      campaigns: [],
      leads: [],
      dailyStats: [],
    });

    expect(context.report_or_folder_link).toBeNull();
    expect(context.folder_link).toBeNull();
    expect(context.issues).toBeNull();
    expect(context.monthly_won_kpi).toBeNull();
  });
});
