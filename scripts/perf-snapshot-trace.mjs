// [TEMP PERF] Investigate double loadSnapshot.
// Exercises three flows and captures every [TEMP PERF] line with a high-res
// browser timestamp so we can attribute each loadSnapshot call to its trigger.
//
// Run: corepack pnpm exec node scripts/perf-snapshot-trace.mjs <devUrl|prodUrl>
// Defaults to dev (http://localhost:5175). Output: scripts/perf-snapshot-trace.output.txt

import { chromium } from "@playwright/test";
import { appendFile, writeFile } from "node:fs/promises";

const BASE_URL = process.argv[2] || "http://localhost:5175";
const EMAIL = "apopovych@quitcode.com";
const PASSWORD = "2336629a";
const OUT_FILE = "scripts/perf-snapshot-trace.output.txt";

const t0 = Date.now();
const elapsed = () => (Date.now() - t0).toString().padStart(6, " ");
const log = async (msg) => {
  const line = `[${elapsed()}ms] ${msg}`;
  console.log(line);
  await appendFile(OUT_FILE, line + "\n");
};
const banner = async (text) => {
  const sep = "─".repeat(72);
  await appendFile(OUT_FILE, `\n${sep}\n  ${text}\n${sep}\n`);
  console.log(`\n${sep}\n  ${text}\n${sep}`);
};

async function waitForLoadSnapshot(page, timeoutMs = 30000) {
  // Wait until at least one "snapshot row counts:" line has been printed.
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((globalThis.__snapshotRowCountsSeen || 0) > 0) return;
    await page.waitForTimeout(50);
  }
}

async function main() {
  await writeFile(OUT_FILE, `# snapshot-trace ${new Date().toISOString()}\n# base=${BASE_URL}\n\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  globalThis.__snapshotRowCountsSeen = 0;
  page.on("console", (msg) => {
    const text = msg.text();
    if (!text.includes("[TEMP PERF]")) return;
    if (text.includes("snapshot row counts:")) globalThis.__snapshotRowCountsSeen += 1;
    void appendFile(OUT_FILE, `[${elapsed()}ms] [CONSOLE] ${text}\n`);
  });
  page.on("pageerror", (err) => {
    void appendFile(OUT_FILE, `[${elapsed()}ms] [PAGE ERROR] ${err.message}\n`);
  });

  // ===================================================================
  // FLOW 1: direct URL load → /admin/clients (no prior session in tab)
  // ===================================================================
  await banner("FLOW 1: direct URL load /admin/clients (cold tab, must sign in first)");
  // First we have to log in. Approach: open /login, sign in, then full-reload at /admin/clients.
  await log("→ goto /login");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByText("Sign in to your account").waitFor({ timeout: 15000 });
  await page.locator("input[type='email']").fill(EMAIL);
  await page.locator("input[type='password']").fill(PASSWORD);
  await log("→ click Sign in");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/admin/"), { timeout: 30000 });
  await log(`✓ landed on ${page.url()}`);

  // FULL RELOAD at /admin/clients (this is the "Flow 1" measurement)
  globalThis.__snapshotRowCountsSeen = 0;
  await banner("FLOW 1 BEGIN — full reload at /admin/clients");
  await log("→ page.goto /admin/clients (full reload)");
  const flow1Start = Date.now();
  await page.goto(`${BASE_URL}/admin/clients`, { waitUntil: "domcontentloaded" });
  await waitForLoadSnapshot(page);
  await page.waitForTimeout(2000); // allow any trailing duplicate snapshot to land
  await log(`FLOW 1 END (elapsed=${Date.now() - flow1Start}ms, snapshot-row-counts-lines=${globalThis.__snapshotRowCountsSeen})`);

  // ===================================================================
  // FLOW 2: in-app navigation: /admin/dashboard → /admin/clients via sidebar
  // ===================================================================
  globalThis.__snapshotRowCountsSeen = 0;
  await banner("FLOW 2 BEGIN — in-app navigation /admin/dashboard → /admin/clients");
  await log("→ page.goto /admin/dashboard (full reload to set baseline)");
  await page.goto(`${BASE_URL}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await waitForLoadSnapshot(page);
  await page.waitForTimeout(2000);
  await log(`baseline /admin/dashboard loaded (snapshot-row-counts-lines=${globalThis.__snapshotRowCountsSeen})`);

  // Now click the sidebar "Clients" link — react-router in-app navigation
  globalThis.__snapshotRowCountsSeen = 0;
  await log("→ click sidebar 'Clients' link");
  const navClients = page.locator('a[href="/admin/clients"]').first();
  await navClients.waitFor({ timeout: 5000 });
  await navClients.click();
  await page.waitForURL("**/admin/clients", { timeout: 10000 });
  await page.waitForTimeout(3000); // settle window
  await log(`FLOW 2 END (snapshot-row-counts-lines during nav=${globalThis.__snapshotRowCountsSeen})`);

  // ===================================================================
  // FLOW 3: /admin/clients → /admin/dashboard → /admin/clients (in-app)
  // ===================================================================
  globalThis.__snapshotRowCountsSeen = 0;
  await banner("FLOW 3 BEGIN — back-and-forth /admin/clients ↔ /admin/dashboard");
  await log("→ click sidebar 'Dashboard'");
  await page.locator('a[href="/admin/dashboard"]').first().click();
  await page.waitForURL("**/admin/dashboard", { timeout: 10000 });
  await page.waitForTimeout(1500);
  await log(`mid-flow at /admin/dashboard (snapshot-row-counts-lines=${globalThis.__snapshotRowCountsSeen})`);

  globalThis.__snapshotRowCountsSeen = 0;
  await log("→ click sidebar 'Clients' (second time)");
  await page.locator('a[href="/admin/clients"]').first().click();
  await page.waitForURL("**/admin/clients", { timeout: 10000 });
  await page.waitForTimeout(3000);
  await log(`FLOW 3 END (snapshot-row-counts-lines on return=${globalThis.__snapshotRowCountsSeen})`);

  await banner("DONE");
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  await appendFile(OUT_FILE, `\n!! FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
