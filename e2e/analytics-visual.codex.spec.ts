import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const projectRef = "bnetnuzxynmdftiadwef";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const authStorageKey = `sb-${projectRef}-auth-token`;

function session(userId = "master-user-1", email = "master@test.local") {
  return {
    access_token: `access-token-${userId}`,
    refresh_token: `refresh-token-${userId}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: userId, email, aud: "authenticated", role: "authenticated" },
  };
}

function snapshot() {
  const clients = Array.from({ length: 24 }, (_, index) => {
    const number = index + 1;
    return {
      id: `client-${number}`,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z",
      name: `Client ${String(number).padStart(2, "0")}`,
      manager_id: number <= 12 ? "manager-1" : "manager-2",
      status: "Active",
      kpi_leads: 10,
      kpi_meetings: 2,
      contracted_amount: 1000,
      contract_due_date: null,
      min_daily_sent: 20,
      inboxes_count: 3,
      crm_config: null,
      sms_phone_numbers: [],
      notification_emails: [],
      auto_ooo_enabled: false,
      prospects_signed: 0,
      prospects_added: 0,
      setup_info: null,
      bi_setup_done: false,
      lost_reason: null,
      notes: null,
    };
  });
  const campaigns = clients.flatMap((client, index) =>
    [1, 2].map((slot) => ({
      id: `campaign-${index + 1}-${slot}`,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z",
      client_id: client.id,
      type: "outreach",
      status: "active",
      name: `Campaign ${String(index + 1).padStart(2, "0")}.${slot}`,
      database_size: 120,
      positive_responses: 3,
      start_date: "2026-05-25",
      external_id: `ext-${index + 1}-${slot}`,
      gender_target: null,
    })),
  );
  const leads = clients.flatMap((client, index) =>
    ["MQL", "preMQL", null].map((qualification, leadIndex) => ({
      id: `lead-${index + 1}-${leadIndex}`,
      created_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z",
      client_id: client.id,
      campaign_id: `campaign-${index + 1}-1`,
      first_name: "Lead",
      last_name: `${index + 1}-${leadIndex}`,
      email: `lead-${index + 1}-${leadIndex}@test.local`,
      status: "new",
      qualification,
      stage: "new_lead",
      reply_category: qualification,
      ooo_detected: false,
      expected_return_date: null,
      notes: null,
      phone: null,
      company: null,
      title: null,
      linkedin_url: null,
      enrichment: null,
    })),
  );

  return {
    users: [
      { id: "manager-1", created_at: "2026-01-01", updated_at: null, email: "one@test.local", first_name: "One", last_name: "Manager", role: "manager" },
      { id: "manager-2", created_at: "2026-01-01", updated_at: null, email: "two@test.local", first_name: "Two", last_name: "Manager", role: "manager" },
    ],
    clients,
    clientUsers: [],
    campaigns,
    leads,
    replies: [],
    campaignDailyStats: campaigns.map((campaign, index) => ({
      id: `stat-${index + 1}`,
      campaign_id: campaign.id,
      report_date: index % 2 === 0 ? "2026-05-25" : "2026-05-26",
      sent_count: index % 2 === 0 ? 100 : 40,
      reply_count: index % 2 === 0 ? 5 : 2,
      bounce_count: 1,
      unique_open_count: 0,
      positive_replies_count: 1,
    })),
    dailyStats: [],
    domains: [],
    invoices: [],
    emailExcludeList: [],
    conditionRules: [],
    columnOverrides: [],
    clientCustomFields: [],
    clientCustomFieldValues: [],
  };
}

async function seed(page: Page, options: { role?: "master_admin" | "client" } = {}) {
  const role = options.role ?? "master_admin";
  const userId = role === "client" ? "client-user-1" : "master-user-1";
  const email = role === "client" ? "client@test.local" : "master@test.local";
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: authStorageKey, value: session(userId, email) },
  );
  const data = snapshot();
  if (role === "client") {
    data.campaignDailyStats.push({
      id: "stat-client-1-old",
      campaign_id: "campaign-1-1",
      report_date: "2026-04-28",
      sent_count: 100,
      reply_count: 10,
      bounce_count: 1,
      unique_open_count: 0,
      positive_replies_count: 1,
    });
    data.dailyStats = [
      {
        id: "daily-client-1-old",
        client_id: "client-1",
        report_date: "2026-04-28",
        emails_sent: 100,
        response_count: 10,
        bounce_count: 1,
        mql_count: 5,
        prospects_count: 80,
        negative_count: 0,
        ooo_count: 0,
        human_replies_count: 8,
        schedule_today: 0,
        schedule_tomorrow: 0,
        schedule_day_after: 0,
      },
      {
        id: "daily-client-1-recent",
        client_id: "client-1",
        report_date: "2026-05-26",
        emails_sent: 40,
        response_count: 4,
        bounce_count: 0,
        mql_count: 2,
        prospects_count: 120,
        negative_count: 0,
        ooo_count: 0,
        human_replies_count: 4,
        schedule_today: 0,
        schedule_tomorrow: 0,
        schedule_day_after: 0,
      },
    ];
  }
  await page.route(`${supabaseUrl}/auth/v1/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${supabaseUrl}/functions/v1/orm-gateway`, async (route) => {
    const body = route.request().postDataJSON() as { action?: string; sessionUserId?: string };
    if (body.action === "loadIdentity") {
      const identity =
        role === "client"
          ? { id: userId, fullName: "Client User", email, role: "client", clientId: "client-1" }
          : { id: body.sessionUserId, fullName: "Master Admin", email, role: "master_admin" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { identity } }),
      });
      return;
    }
    if (body.action === "loadSnapshot") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: [] }) });
  });
}

// KNOWN STALE (not run in CI — .github/workflows/ci.yml runs `pnpm test:run` only).
// The fixtures below hardcode April/May 2026 dates while the default timeframe is relative to today,
// so the chart-summary assertions in this file and in "client dashboard timeframe filters monthly
// panels" only held while the wall clock sat inside that window. The 2026-08-14 preset change
// (default 21 days → current month) updated the button labels here but could not re-baseline the
// numbers; re-basing means deriving the fixture dates from `new Date()` rather than editing counts.
test("master admin analytics visual state", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/statistics");

  await expect(page.getByText(/Days without activity rows are rendered as 0/)).toHaveCount(0);
  await expect(page.getByText("Opens")).toHaveCount(0);
  await expect(page.getByText("Replies & bounces")).toBeVisible();
  await expect(page.getByText("Sent volume chart with 30 calendar days and 2 active days.")).toBeAttached();
  await expect(page.getByText("Lead count and qualification split.")).toBeVisible();
  await expect(page.getByText("MQL 12").first()).toBeVisible();
  await expect(page.getByText(/Showing 12 of 24 client groups/)).toBeVisible();
  await expect(page.getByText("Client 01").first()).toBeVisible();

  await page.getByRole("button", { name: /Current month/i }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByText(/Days without activity rows are rendered as 0/)).toHaveCount(0);

  await page.screenshot({ path: path.join("test-results", "analytics-admin-statistics.png"), fullPage: true });
});

test("client dashboard timeframe filters monthly panels", async ({ page }) => {
  await seed(page, { role: "client" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/client/dashboard");

  await expect(page.getByRole("heading", { name: "Daily sent" })).toBeVisible();
  await expect(page.getByText("Sent count by month")).toBeVisible();
  await expect(page.getByText("Monthly leads chart with 2 months and total 7 leads.")).toBeAttached();
  await expect(page.getByText("Monthly sent chart with 2 months and total 240 emails.")).toBeAttached();
  await expect(page.getByText("Monthly prospects chart with 2 months and total 40 prospects added.")).toBeAttached();

  await page.getByRole("button", { name: /Current month/i }).click();
  await page.getByRole("button", { name: "Last 7 days" }).click();

  await expect(page.getByText("Monthly leads chart with 1 month and total 2 leads.")).toBeAttached();
  await expect(page.getByText("Monthly sent chart with 1 month and total 140 emails.")).toBeAttached();
  await expect(page.getByText("Monthly prospects chart with 1 month and total 40 prospects added.")).toBeAttached();

  await page.screenshot({ path: path.join("test-results", "client-dashboard-timeframe.png"), fullPage: true });
});
