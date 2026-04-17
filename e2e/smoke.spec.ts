import { expect, test, type Page } from "@playwright/test";

const projectRef = "bnetnuzxynmdftiadwef";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const authStorageKey = `sb-${projectRef}-auth-token`;

type Role = "client" | "manager" | "admin";

function buildSession(userId: string, email: string) {
  return {
    access_token: `access-token-${userId}`,
    refresh_token: `refresh-token-${userId}`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    expires_in: 60 * 60,
    token_type: "bearer",
    user: {
      id: userId,
      email,
      aud: "authenticated",
      role: "authenticated",
    },
  };
}

async function seedSession(page: Page, role: Role) {
  const session = buildSession(`${role}-user-1`, `${role}@test.local`);
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: authStorageKey,
      value: session,
    },
  );
}

async function mockSupabase(page: Page, options: { role?: Role; missingClientMapping?: boolean }) {
  const sessionRole = options.role;

  await page.route(`${supabaseUrl}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();

    if (table === "users") {
      if (!sessionRole) {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: `${sessionRole}-user-1`,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
            email: `${sessionRole}@test.local`,
            first_name: sessionRole === "admin" ? "Admin" : sessionRole === "manager" ? "Manager" : "Client",
            last_name: "User",
            role: sessionRole,
          },
        ]),
      });
      return;
    }

    if (table === "client_users") {
      const body =
        sessionRole === "client" && !options.missingClientMapping
          ? JSON.stringify([{ client_id: "client-1" }])
          : "[]";
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }

    if (table === "clients") {
      const body =
        sessionRole === "manager" || sessionRole === "admin"
          ? JSON.stringify([
              {
                id: "client-1",
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
                name: "Acme",
                manager_id: sessionRole === "manager" ? "manager-user-1" : "manager-user-1",
                kpi_leads: 10,
                kpi_meetings: 2,
                contracted_amount: 1000,
                contract_due_date: "2026-12-01",
                external_workspace_id: null,
                status: "Active",
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
              },
            ])
          : "[]";
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route(`${supabaseUrl}/auth/v1/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

test("login entry is production-safe", async ({ page }) => {
  await mockSupabase(page, {});
  await page.goto("/login");

  await expect(page.getByText("Sign in to your account")).toBeVisible();
  await expect(page.getByText("Access is provisioned by your account administrator.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Magic link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register" })).toHaveCount(0);
});

test("password reset entry remains available", async ({ page }) => {
  await mockSupabase(page, {});
  await page.goto("/login");
  await page.getByRole("button", { name: "Forgot password" }).click();

  await expect(page.getByText("Reset your password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
});

test("client without mapping is blocked from workspace routes", async ({ page }) => {
  await seedSession(page, "client");
  await mockSupabase(page, { role: "client", missingClientMapping: true });
  await page.goto("/client/dashboard");

  await expect(page.getByText("Account setup required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry setup check" })).toBeVisible();
});

test("manager and admin protected routes render with a provisioned session", async ({ page }) => {
  await seedSession(page, "manager");
  await mockSupabase(page, { role: "manager" });
  await page.goto("/manager/dashboard");
  await expect(page.getByText("Manager Dashboard")).toBeVisible();

  const adminPage = await page.context().newPage();
  await seedSession(adminPage, "admin");
  await mockSupabase(adminPage, { role: "admin" });
  await adminPage.goto("/admin/dashboard");
  await expect(adminPage.getByText("Admin Dashboard")).toBeVisible();
  await adminPage.close();
});
