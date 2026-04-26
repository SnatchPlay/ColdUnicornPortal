/**
 * Standalone Playwright config for visual-analysis.spec.ts.
 * Points at the running `pnpm dev` server (no webServer auto-start).
 * Real Supabase auth is used (per .env), so this is NOT a CI test.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: /visual-analysis\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.VA_BASE_URL ?? "http://localhost:5175",
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"]],
});
