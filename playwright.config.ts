import { defineConfig, devices } from "@playwright/test";

const previewPort = 4175;
const previewBaseUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: previewBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "corepack pnpm exec vite preview --host 127.0.0.1 --port 4175",
    url: previewBaseUrl,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
