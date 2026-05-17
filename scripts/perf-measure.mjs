// [TEMP PERF] One-shot Playwright run to capture [TEMP PERF] console output
// from a real login → /clients → first-row click flow.
//
// Run with: corepack pnpm exec node scripts/perf-measure.mjs
// Requires `pnpm dev` running at http://localhost:5175.
// Output: scripts/perf-measure.output.txt

import { chromium } from "@playwright/test";
import { appendFile, writeFile } from "node:fs/promises";

const BASE_URL = "http://localhost:5175";
const EMAIL = "apopovych@quitcode.com";
const PASSWORD = "2336629a";
const OUT_FILE = "scripts/perf-measure.output.txt";

const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  return appendFile(OUT_FILE, line + "\n");
};

async function main() {
  await writeFile(OUT_FILE, "");
  await log("=== PERF MEASURE START ===");

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  // Pipe every console message; tag PERF ones separately for easy filtering.
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[TEMP PERF]")) {
      void appendFile(OUT_FILE, `[CONSOLE] ${t}\n`);
    } else if (msg.type() === "error") {
      void appendFile(OUT_FILE, `[CONSOLE ERROR] ${t}\n`);
    }
  });

  page.on("pageerror", (err) => {
    void appendFile(OUT_FILE, `[PAGE ERROR] ${err.message}\n`);
  });

  // --- Login -----------------------------------------------------------
  await log("→ navigate to /login");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  await log("→ wait for login form");
  await page.getByText("Sign in to your account").waitFor({ timeout: 15000 });

  await page.locator("input[type='email']").fill(EMAIL);
  await page.locator("input[type='password']").fill(PASSWORD);

  await log("→ click Sign in");
  await page.getByRole("button", { name: "Sign in" }).click();

  // --- Wait for redirect into a role-prefixed route -------------------
  await log("→ wait for redirect into /admin|/manager|/client");
  try {
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/admin/") ||
        url.pathname.startsWith("/manager/") ||
        url.pathname.startsWith("/client/"),
      { timeout: 30000 },
    );
  } catch (e) {
    await log(`!! redirect timeout; current url=${page.url()}`);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    await log(`!! page text snippet: ${bodyText.slice(0, 400)}`);
    await browser.close();
    process.exit(1);
  }
  await log(`✓ landed on ${page.url()}`);

  // --- Determine role from URL & navigate to clients ------------------
  const url = new URL(page.url());
  let clientsPath = "/manager/clients";
  if (url.pathname.startsWith("/admin/")) clientsPath = "/admin/clients";
  else if (url.pathname.startsWith("/client/")) {
    await log("!! signed-in user has client role — no /clients page; aborting");
    await browser.close();
    process.exit(2);
  }
  await log(`→ navigate to ${clientsPath}`);
  await page.goto(`${BASE_URL}${clientsPath}`, { waitUntil: "domcontentloaded" });

  // --- Wait for at least one row button to appear ---------------------
  await log("→ wait for first row button to render");
  await page
    .locator('button[aria-label^="Open details for "]')
    .first()
    .waitFor({ timeout: 30000 });

  // Wait a bit more for memos to log & settle
  await page.waitForTimeout(2000);
  await log("=== MARKER: about to click first row ===");
  await appendFile(OUT_FILE, "\n=== MARKER: about to click first row ===\n\n");

  // --- Click first row ------------------------------------------------
  const rowButtons = await page.locator('button[aria-label^="Open details for "]').count();
  await log(`row buttons present: ${rowButtons}`);
  const target = page.locator('button[aria-label^="Open details for "]').first();
  const targetLabel = await target.getAttribute("aria-label");
  await log(`→ click row: ${targetLabel}`);
  await target.click({ timeout: 5000 });

  // Wait for drawer to mount
  await page.waitForTimeout(2000);
  await appendFile(OUT_FILE, "\n=== MARKER: 2s after row click ===\n\n");

  // Capture if a drawer (dialog) is present
  const drawerVisible = await page.getByRole("dialog").count().catch(() => 0);
  await log(`drawer dialog count: ${drawerVisible}`);

  await page.waitForTimeout(1000);

  await log("=== PERF MEASURE END ===");
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  await appendFile(OUT_FILE, `\n!! FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
