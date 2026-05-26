import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const projectRef = "bnetnuzxynmdftiadwef";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const authStorageKey = `sb-${projectRef}-auth-token`;

function session() {
  return {
    access_token: "access-token-master-user-1",
    refresh_token: "refresh-token-master-user-1",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: { id: "master-user-1", email: "master@test.local", aud: "authenticated", role: "authenticated" },
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
      external_workspace_id: null,
      external_api_key: null,
      min_daily_sent: 20,
      inboxes_count: 3,
      crm_config: null,
      sms_phone_numbers: [],
      notification_emails: [],
      auto_ooo_enabled: false,
      linkedin_api_key: null,
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

async function seed(page: Page) {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: authStorageKey, value: session() },
  );
  const data = snapshot();
  await page.route(`${supabaseUrl}/auth/v1/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route(`${supabaseUrl}/functions/v1/orm-gateway`, async (route) => {
    const body = route.request().postDataJSON() as { action?: string; sessionUserId?: string };
    if (body.action === "loadIdentity") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { identity: { id: body.sessionUserId, fullName: "Master Admin", email: "master@test.local", role: "master_admin" } } }),
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

test("master admin analytics visual state", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/statistics");

  await expect(page.getByText(/Last 30 Days shows 30 calendar days; 2 active days contain campaign activity/)).toBeVisible();
  await expect(page.getByText("Sent volume chart with 30 calendar days and 2 active days.")).toBeAttached();
  await expect(page.getByText("Lead count and qualification split.")).toBeVisible();
  await expect(page.getByText("MQL 12").first()).toBeVisible();
  await expect(page.getByText(/Showing 12 of 24 client groups/)).toBeVisible();
  await expect(page.getByText("Client 01")).toBeVisible();

  await page.getByRole("button", { name: /Last 30 Days/i }).click();
  await page.getByRole("button", { name: "Last 7 Days" }).click();
  await expect(page.getByText(/Last 7 Days shows 7 calendar days; 2 active days contain campaign activity/)).toBeVisible();

  await page.screenshot({ path: path.join("test-results", "analytics-admin-statistics.png"), fullPage: true });
});
