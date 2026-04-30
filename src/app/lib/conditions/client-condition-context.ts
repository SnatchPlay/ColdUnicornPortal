import type { ClientMetricsOverview, DodRow, MomRow, ThreeDodRow, WowRow } from "../client-metrics";
import type { CampaignRecord, ClientRecord, DailyStatRecord, LeadRecord, UserRecord } from "../../types/core";

export interface BuildClientConditionContextInput {
  client: ClientRecord;
  manager?: UserRecord | null;
  metricsOverview: ClientMetricsOverview;
  dodRows: DodRow[];
  threeDodRows: ThreeDodRow[];
  wowRows: WowRow[];
  momRows: MomRow[];
  campaigns: CampaignRecord[];
  leads: LeadRecord[];
  dailyStats: DailyStatRecord[];
}

export interface ClientConditionContext {
  target_id: string;
  client: {
    id: string;
    name: string;
    status: string | null;
    min_daily_sent: number | null;
    inboxes_count: number | null;
    kpi_leads: number | null;
    kpi_meetings: number | null;
    kpi_won: number | null;
    prospects_signed: number | null;
    prospects_added: number | null;
    auto_ooo_enabled: boolean | null;
    bi_setup_done: boolean | null;
    external_workspace_id: string | number | null;
    external_api_key: string | null;
    linkedin_api_key: string | null;
    setup_info: string | null;
    notes: string | null;
  };
  manager_name: string | null;

  prospects_signed: number | null;
  prospects_added: number | null;

  inboxes: number | null;
  min_sent: number | null;

  sent_today: number | null;
  sent_yesterday: number | null;
  sent_two_days_ago: number | null;

  schedule_day_after: number | null;
  schedule_tomorrow: number | null;
  schedule_today: number | null;

  three_dod_total_0: number | null;
  three_dod_total_1: number | null;
  three_dod_total_2: number | null;
  three_dod_total_3: number | null;
  three_dod_total_4: number | null;

  three_dod_sql_0: number | null;
  three_dod_sql_1: number | null;
  three_dod_sql_2: number | null;
  three_dod_sql_3: number | null;
  three_dod_sql_4: number | null;

  three_dod_total: number | null;
  three_dod_sql: number | null;

  wow_response_rate: number | null;
  wow_total_response_rate: number | null;
  wow_human_response_rate: number | null;
  wow_bounce_rate: number | null;
  wow_ooo_rate: number | null;
  wow_negative_rate: number | null;
  wow_sql: number | null;

  mom_sql: number | null;
  mom_meetings: number | null;
  mom_won: number | null;

  monthly_sql_kpi: number | null;
  monthly_meeting_kpi: number | null;
  monthly_won_kpi: number | null;

  report_or_folder_link: string | null;
  folder_link: string | null;
  issues: string | null;
  bi_setup: boolean | null;
  auto_li_api_key: string | null;

  value?: unknown;
}

function rowByBucket<T extends { bucket: string }>(rows: T[], bucket: string): T | null {
  return rows.find((row) => row.bucket === bucket) ?? null;
}

export function buildClientConditionContext(input: BuildClientConditionContextInput): ClientConditionContext {
  const { client, manager, metricsOverview, threeDodRows, wowRows, momRows } = input;

  const three0 = rowByBucket(threeDodRows, "0");
  const three1 = rowByBucket(threeDodRows, "-1");
  const three2 = rowByBucket(threeDodRows, "-2");
  const three3 = rowByBucket(threeDodRows, "-3");
  const three4 = rowByBucket(threeDodRows, "-4");

  const wow0 = rowByBucket(wowRows, "0");
  const mom0 = rowByBucket(momRows, "0");

  return {
    target_id: client.id,
    client: {
      id: client.id,
      name: client.name,
      status: client.status ?? null,
      min_daily_sent: client.min_daily_sent ?? null,
      inboxes_count: client.inboxes_count ?? null,
      kpi_leads: client.kpi_leads ?? null,
      kpi_meetings: client.kpi_meetings ?? null,
      kpi_won: null,
      prospects_signed: client.prospects_signed ?? null,
      prospects_added: client.prospects_added ?? null,
      auto_ooo_enabled: client.auto_ooo_enabled,
      bi_setup_done: client.bi_setup_done,
      external_workspace_id: client.external_workspace_id ?? null,
      external_api_key: client.external_api_key ?? null,
      linkedin_api_key: client.linkedin_api_key ?? null,
      setup_info: client.setup_info ?? null,
      notes: client.notes ?? null,
    },
    manager_name: manager ? `${manager.first_name} ${manager.last_name}`.trim() : null,

    prospects_signed: client.prospects_signed ?? null,
    prospects_added: client.prospects_added ?? null,

    inboxes: client.inboxes_count ?? null,
    min_sent: client.min_daily_sent ?? null,

    sent_today: metricsOverview.sentToday ?? null,
    sent_yesterday: metricsOverview.sentYesterday ?? null,
    sent_two_days_ago: metricsOverview.sentTwoDaysAgo ?? null,

    schedule_day_after: metricsOverview.scheduleDayAfter ?? null,
    schedule_tomorrow: metricsOverview.scheduleTomorrow ?? null,
    schedule_today: metricsOverview.scheduleToday ?? null,

    three_dod_total_0: three0?.totalLeads ?? null,
    three_dod_total_1: three1?.totalLeads ?? null,
    three_dod_total_2: three2?.totalLeads ?? null,
    three_dod_total_3: three3?.totalLeads ?? null,
    three_dod_total_4: three4?.totalLeads ?? null,

    three_dod_sql_0: three0?.sqlLeads ?? null,
    three_dod_sql_1: three1?.sqlLeads ?? null,
    three_dod_sql_2: three2?.sqlLeads ?? null,
    three_dod_sql_3: three3?.sqlLeads ?? null,
    three_dod_sql_4: three4?.sqlLeads ?? null,

    three_dod_total: metricsOverview.threeDodTotal ?? null,
    three_dod_sql: metricsOverview.threeDodSql ?? null,

    wow_response_rate: metricsOverview.wowResponseRate ?? null,
    wow_total_response_rate: metricsOverview.wowResponseRate ?? null,
    wow_human_response_rate: metricsOverview.wowHumanRate ?? null,
    wow_bounce_rate: metricsOverview.wowBounceRate ?? null,
    wow_ooo_rate: metricsOverview.wowOooRate ?? null,
    wow_negative_rate: wow0?.negativeRate ?? null,
    wow_sql: metricsOverview.wowSql ?? null,

    mom_sql: metricsOverview.momSql ?? null,
    mom_meetings: mom0?.meetings ?? null,
    mom_won: mom0?.won ?? null,

    monthly_sql_kpi: client.kpi_leads ?? null,
    monthly_meeting_kpi: client.kpi_meetings ?? null,
    monthly_won_kpi: null,

    report_or_folder_link: null,
    folder_link: null,
    issues: null,
    bi_setup: client.bi_setup_done,
    auto_li_api_key: client.linkedin_api_key ?? null,
  };
}