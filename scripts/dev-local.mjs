// One command to bring the whole local stack up and keep it up:
//
//   1. supabase start                         — Postgres + Kong + Auth + Studio (idempotent; fast if
//                                                already running)
//   2. pnpm db:migrate:local                  — apply any migrations not yet in the local DB
//   3. supabase functions serve --env-file …  — the edge runtime that hosts orm-gateway (long-running)
//   4. vite                                   — the app (long-running)
//
// Steps 3 and 4 run concurrently for the life of the process; Ctrl-C tears both down. This exists
// because `pnpm dev` used to be *only* step 4, so the gateway 503'd ("name resolution failed") until
// someone remembered to start the edge runtime by hand. See docs/reference/local-supabase.md.
//
// No orchestration dependency on purpose — plain child_process so `pnpm install` stays untouched.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const FUNCTIONS_ENV = "supabase/functions/.env.local";
const APP_ENV = ".env.local";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
};

function step(msg) {
  console.log(`\n${c.cyan("▶")} ${msg}`);
}

function die(msg) {
  console.error(`\n${c.red("✗")} ${msg}`);
  process.exit(1);
}

// The supabase CLI is not on this machine's PATH in every setup, but a copy is usually reachable via
// npx. Prefer PATH (fast, no npx overhead), fall back to npx, else send the reader to the install doc.
function resolveSupabase() {
  if (spawnSync("supabase", ["--version"], { stdio: "ignore" }).status === 0) {
    return { cmd: "supabase", pre: [] };
  }
  if (spawnSync("npx", ["--no-install", "supabase", "--version"], { stdio: "ignore" }).status === 0) {
    return { cmd: "npx", pre: ["--no-install", "supabase"] };
  }
  die(
    "Supabase CLI not found.\n" +
      "  Install it globally (`brew install supabase/tap/supabase`) or add it as a dev dependency,\n" +
      "  then re-run `pnpm dev`. See docs/reference/local-supabase.md.",
  );
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (res.status !== 0) {
    die(`\`${cmd} ${args.join(" ")}\` exited with code ${res.status ?? "signal " + res.signal}.`);
  }
}

// ── Preflight ────────────────────────────────────────────────────────────────────────────────────
for (const [file, hint] of [
  [APP_ENV, ".env.local.example"],
  [FUNCTIONS_ENV, "supabase/functions/.env.local.example"],
]) {
  if (!existsSync(`${ROOT}${file}`)) {
    die(`Missing ${file}. Copy it from ${hint} and fill in the values (see docs/reference/local-supabase.md).`);
  }
}

const sb = resolveSupabase();

// ── 1. Containers ──────────────────────────────────────────────────────────────────────────────
step("Starting the Supabase stack (supabase start)…");
run(sb.cmd, [...sb.pre, "start"]);

// ── 2. Migrations ──────────────────────────────────────────────────────────────────────────────
step("Applying local migrations (pnpm db:migrate:local)…");
run("node", ["scripts/db-apply-migrations.mjs"], { env: { ...process.env, SUPABASE_DB_URL: LOCAL_DB_URL } });

// ── 3 + 4. Long-running: edge runtime + vite ─────────────────────────────────────────────────────
step("Serving edge functions + starting Vite. Ctrl-C stops both.\n");

const children = [];
let shuttingDown = false;

function launch(label, cmd, args, extraEnv = {}) {
  // `detached: true` puts the child in its own process group. `supabase functions serve` is really
  // an `npx` wrapper that execs the platform CLI binary, which then spawns the edge runtime — a
  // SIGTERM to the wrapper alone leaves the binary orphaned (reparented to PID 1). Killing the whole
  // group by negative PID reaches every descendant.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // If either long-running process dies on its own, the dev environment is broken — take the
    // whole thing down rather than leave a half-running stack that looks fine but isn't.
    console.log(c.dim(`\n[${label}] exited (${signal ?? code}). Shutting the rest down.`));
    shutdown(typeof code === "number" ? code : 1);
  });
  children.push(child);
  return child;
}

function killGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal); // negative pid → the whole process group
  } catch {
    try {
      child.kill(signal); // group already gone; fall back to the direct child
    } catch {
      /* already dead */
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killGroup(child, "SIGTERM");
  // Escalate to SIGKILL for anything that ignored SIGTERM, then exit.
  setTimeout(() => {
    for (const child of children) killGroup(child, "SIGKILL");
    process.exit(code);
  }, 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

launch("edge", sb.cmd, [...sb.pre, "functions", "serve", "--env-file", FUNCTIONS_ENV]);
launch("vite", "npx", ["--no-install", "vite"]);
