/**
 * Visual analysis spec — runs against `pnpm dev` (port 5175) with REAL credentials.
 * Credentials read from env vars VA_*_EMAIL / VA_*_PASSWORD so they are never
 * persisted in the repo. Output PNGs go to test-results/visual-analysis/.
 *
 * This file is intentionally NOT included in `pnpm test:smoke`; the smoke
 * config uses `vite preview` with mocked Supabase. Run this manually:
 *
 *   pnpm exec playwright test e2e/visual-analysis.spec.ts \
 *     --config=e2e/visual-analysis.config.ts
 */

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const BASE_URL = process.env.VA_BASE_URL ?? "http://localhost:5175";

type Role = "client" | "manager" | "admin";

interface RoleCreds {
  email: string;
  password: string;
}

const credentials: Record<Role, RoleCreds> = {
  client: {
    email: process.env.VA_CLIENT_EMAIL ?? "",
    password: process.env.VA_CLIENT_PASSWORD ?? "",
  },
  manager: {
    email: process.env.VA_MANAGER_EMAIL ?? "",
    password: process.env.VA_MANAGER_PASSWORD ?? "",
  },
  admin: {
    email: process.env.VA_ADMIN_EMAIL ?? "",
    password: process.env.VA_ADMIN_PASSWORD ?? "",
  },
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

function shotPath(name: string) {
  return path.join("docs", "screenshots", "visual-analysis-2026-04-26", `${name}.png`);
}

async function signIn(page: Page, role: Role) {
  const creds = credentials[role];
  if (!creds.email || !creds.password) {
    test.skip(true, `Missing creds for ${role}; set VA_${role.toUpperCase()}_EMAIL/PASSWORD`);
  }

  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder("name@company.com").fill(creds.email);
  await page.getByPlaceholder("Enter your password").fill(creds.password);
  await page.getByRole("button", { name: /^Sign in/ }).click();

  // Wait for redirect to role home. Tolerant of slow snapshots.
  await page.waitForURL(/\/(client|manager|admin)\/dashboard/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

async function captureFullAndMobile(page: Page, role: Role, slug: string, url?: string) {
  if (url) {
    await page.goto(url);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800); // let charts settle
  }

  await page.setViewportSize(VIEWPORTS.desktop);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath(`${role}-${slug}-desktop`), fullPage: true });

  await page.setViewportSize(VIEWPORTS.mobile);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath(`${role}-${slug}-mobile`), fullPage: true });

  // Restore desktop for subsequent navigations.
  await page.setViewportSize(VIEWPORTS.desktop);
}

test.describe.configure({ mode: "serial" });

test("00 - public login page (no auth)", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.setViewportSize(VIEWPORTS.desktop);
  await page.screenshot({ path: shotPath("public-login-desktop"), fullPage: true });
  await page.setViewportSize(VIEWPORTS.mobile);
  await page.screenshot({ path: shotPath("public-login-mobile"), fullPage: true });
});

test("client - dashboard / pipeline / campaigns / analytics / settings", async ({ page }) => {
  await signIn(page, "client");
  await captureFullAndMobile(page, "client", "01-dashboard");
  await captureFullAndMobile(page, "client", "02-pipeline", `${BASE_URL}/client/leads`);
  await captureFullAndMobile(page, "client", "03-campaigns", `${BASE_URL}/client/campaigns`);
  await captureFullAndMobile(page, "client", "04-analytics", `${BASE_URL}/client/statistics`);
  await captureFullAndMobile(page, "client", "05-settings", `${BASE_URL}/client/settings`);
});

test("manager - dashboard / clients / leads / campaigns / analytics / domains / invoices / blacklist", async ({ page }) => {
  await signIn(page, "manager");
  await captureFullAndMobile(page, "manager", "01-dashboard");
  await captureFullAndMobile(page, "manager", "02-clients", `${BASE_URL}/manager/clients`);
  await captureFullAndMobile(page, "manager", "03-leads", `${BASE_URL}/manager/leads`);
  await captureFullAndMobile(page, "manager", "04-campaigns", `${BASE_URL}/manager/campaigns`);
  await captureFullAndMobile(page, "manager", "05-analytics", `${BASE_URL}/manager/statistics`);
  await captureFullAndMobile(page, "manager", "06-domains", `${BASE_URL}/manager/domains`);
  await captureFullAndMobile(page, "manager", "07-invoices", `${BASE_URL}/manager/invoices`);
  await captureFullAndMobile(page, "manager", "08-blacklist", `${BASE_URL}/manager/blacklist`);
  await captureFullAndMobile(page, "manager", "09-settings", `${BASE_URL}/manager/settings`);
});

test("admin - dashboard / users / clients / leads / campaigns / analytics / domains / invoices / blacklist", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin");
  await captureFullAndMobile(page, "admin", "01-dashboard");
  await captureFullAndMobile(page, "admin", "02-users", `${BASE_URL}/admin/users`);
  await captureFullAndMobile(page, "admin", "03-clients", `${BASE_URL}/admin/clients`);
  await captureFullAndMobile(page, "admin", "04-leads", `${BASE_URL}/admin/leads`);
  await captureFullAndMobile(page, "admin", "05-campaigns", `${BASE_URL}/admin/campaigns`);
  await captureFullAndMobile(page, "admin", "06-analytics", `${BASE_URL}/admin/statistics`);
  await captureFullAndMobile(page, "admin", "07-domains", `${BASE_URL}/admin/domains`);
  await captureFullAndMobile(page, "admin", "08-invoices", `${BASE_URL}/admin/invoices`);
  await captureFullAndMobile(page, "admin", "09-blacklist", `${BASE_URL}/admin/blacklist`);
  await captureFullAndMobile(page, "admin", "10-settings", `${BASE_URL}/admin/settings`);
});
