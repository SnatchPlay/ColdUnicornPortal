/**
 * Functional analysis spec — captures interactive states (drawers, forms, tabs)
 * per role to document what is editable / addable / triggerable in the live UI.
 *
 * Outputs to docs/screenshots/functional-analysis-2026-04-26/.
 *
 * Credentials are passed via env (FA_*_EMAIL / FA_*_PASSWORD); never commit them.
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.VA_BASE_URL ?? process.env.FA_BASE_URL ?? "http://localhost:5175";
const OUT_DIR = path.resolve(__dirname, "..", "docs", "screenshots", "functional-analysis-2026-04-26");

const VIEWPORT_DESKTOP = { width: 1440, height: 900 };

function shot(file: string) {
  return { path: path.join(OUT_DIR, file), fullPage: true } as const;
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto(BASE_URL + "/login");
  await page.locator('input[type="email"], input[name="email"], input[id*="email" i]').first().fill(email);
  await page.locator('input[type="password"], input[name="password"], input[id*="password" i]').first().fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

test.use({ viewport: VIEWPORT_DESKTOP });

// ────────────────────────────────── CLIENT ──────────────────────────────────

test("client - open lead drawer (read-only)", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.VA_CLIENT_EMAIL ?? process.env.FA_CLIENT_EMAIL!;
  const password = process.env.VA_CLIENT_PASSWORD ?? process.env.FA_CLIENT_PASSWORD!;

  await login(page, email, password);
  await page.goto(BASE_URL + "/client/leads");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Click the first lead row
  const firstRow = page.locator('[role="button"], button, [class*="cursor-pointer"]').filter({ hasText: /@/ }).first();
  await firstRow.click({ trial: false }).catch(() => {});
  await page.waitForTimeout(800);

  await page.screenshot(shot("client-leads-drawer.png"));
});

test("client - settings (no email/reset link block)", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.VA_CLIENT_EMAIL ?? process.env.FA_CLIENT_EMAIL!;
  const password = process.env.VA_CLIENT_PASSWORD ?? process.env.FA_CLIENT_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/client/settings");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot(shot("client-settings-full.png"));
});

// ────────────────────────────────── MANAGER ──────────────────────────────────

test("manager - clients drawer + DoD tab", async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.VA_MANAGER_EMAIL ?? process.env.FA_MANAGER_EMAIL!;
  const password = process.env.VA_MANAGER_PASSWORD ?? process.env.FA_MANAGER_PASSWORD!;
  await login(page, email, password);

  await page.goto(BASE_URL + "/manager/clients");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Try DoD tab if present
  const dodTab = page.getByRole("tab", { name: /dod/i }).first();
  if (await dodTab.count()) {
    await dodTab.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot(shot("manager-clients-tab-dod.png"));
  }

  // Try MoM tab
  const momTab = page.getByRole("tab", { name: /mom/i }).first();
  if (await momTab.count()) {
    await momTab.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot(shot("manager-clients-tab-mom.png"));
  }

  // Back to overview and click first client row to open drawer
  const overviewTab = page.getByRole("tab", { name: /overview/i }).first();
  if (await overviewTab.count()) await overviewTab.click().catch(() => {});
  await page.waitForTimeout(500);

  const rows = page.locator('button, [role="button"]').filter({ hasText: /Active|On hold|Sales|Offboarding/i });
  const count = await rows.count();
  if (count > 0) {
    await rows.first().click({ trial: false }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot(shot("manager-clients-drawer.png"));
  }
});

test("manager - leads drawer (editable fields)", async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.VA_MANAGER_EMAIL ?? process.env.FA_MANAGER_EMAIL!;
  const password = process.env.VA_MANAGER_PASSWORD ?? process.env.FA_MANAGER_PASSWORD!;
  await login(page, email, password);

  await page.goto(BASE_URL + "/manager/leads");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const firstRow = page.locator('button, [role="button"], [class*="cursor-pointer"]').filter({ hasText: /@/ }).first();
  await firstRow.click({ trial: false }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot(shot("manager-leads-drawer.png"));
});

test("manager - campaigns drawer (editable fields)", async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.VA_MANAGER_EMAIL ?? process.env.FA_MANAGER_EMAIL!;
  const password = process.env.VA_MANAGER_PASSWORD ?? process.env.FA_MANAGER_PASSWORD!;
  await login(page, email, password);

  await page.goto(BASE_URL + "/manager/campaigns");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const firstCampaignRow = page
    .locator('button, [role="button"], [class*="cursor-pointer"]')
    .filter({ hasText: /outreach|nurture|campaign/i })
    .first();
  await firstCampaignRow.click({ trial: false }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot(shot("manager-campaigns-drawer.png"));
});

test("manager - blacklist (no add field, only Remove)", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.VA_MANAGER_EMAIL ?? process.env.FA_MANAGER_EMAIL!;
  const password = process.env.VA_MANAGER_PASSWORD ?? process.env.FA_MANAGER_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/manager/blacklist");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "manager-blacklist-top.png"), fullPage: false });
});

// ────────────────────────────────── ADMIN ──────────────────────────────────

test("admin - user mgmt: form with role=client shows client picker", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.VA_ADMIN_EMAIL ?? process.env.FA_ADMIN_EMAIL!;
  const password = process.env.VA_ADMIN_PASSWORD ?? process.env.FA_ADMIN_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/admin/users");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Fill email
  await page.locator('input[type="email"], input[placeholder*="@" i]').first().fill("test@example.com");
  // Try opening client select (if visible because role defaults to client per UI)
  await page.screenshot(shot("admin-users-form-client-role.png"));

  // Switch role to manager and screenshot — client picker should disappear
  const roleSelect = page.locator("button").filter({ hasText: /^client$|select role/i }).first();
  if (await roleSelect.count()) {
    await roleSelect.click().catch(() => {});
    await page.waitForTimeout(300);
    const managerOpt = page.getByRole("option", { name: /manager/i }).first();
    if (await managerOpt.count()) {
      await managerOpt.click().catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot(shot("admin-users-form-manager-role.png"));
    }
  }
});

test("admin - blacklist: add domain form visible", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.VA_ADMIN_EMAIL ?? process.env.FA_ADMIN_EMAIL!;
  const password = process.env.VA_ADMIN_PASSWORD ?? process.env.FA_ADMIN_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/admin/blacklist");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, "admin-blacklist-top.png"), fullPage: false });
});

test("admin - clients drawer (full-edit fields)", async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.VA_ADMIN_EMAIL ?? process.env.FA_ADMIN_EMAIL!;
  const password = process.env.VA_ADMIN_PASSWORD ?? process.env.FA_ADMIN_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/admin/clients");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const rows = page.locator('button, [role="button"]').filter({ hasText: /Active|On hold|Sales/i });
  if (await rows.count()) {
    await rows.first().click({ trial: false }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot(shot("admin-clients-drawer.png"));
  }
});

test("admin - leads drawer (full editing)", async ({ page }) => {
  test.setTimeout(120_000);
  const email = process.env.VA_ADMIN_EMAIL ?? process.env.FA_ADMIN_EMAIL!;
  const password = process.env.VA_ADMIN_PASSWORD ?? process.env.FA_ADMIN_PASSWORD!;
  await login(page, email, password);
  await page.goto(BASE_URL + "/admin/leads");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const firstRow = page.locator('button, [role="button"]').filter({ hasText: /@/ }).first();
  await firstRow.click({ trial: false }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot(shot("admin-leads-drawer.png"));
});
