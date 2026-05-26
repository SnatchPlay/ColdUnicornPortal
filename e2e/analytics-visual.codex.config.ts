import { defineConfig, devices } from "@playwright/test";

const previewPort = 4175;
const previewBaseUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./",
  testMatch: /analytics-visual\.codex\.spec\.ts$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  use: {
    baseURL: previewBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175",
    url: previewBaseUrl,
    timeout: 60_000,
    reuseExistingServer: true,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://bnetnuzxynmdftiadwef.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
      VITE_APP_BASE_URL: previewBaseUrl,
      VITE_APP_ENV: "production",
      VITE_AUTH_ALLOW_SELF_SIGNUP: "false",
      VITE_AUTH_ALLOW_MAGIC_LINK: "true",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["line"]],
});
