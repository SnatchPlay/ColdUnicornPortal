// Minimal .env reader. The repo deliberately carries no dotenv dependency (see
// scripts/db-apply-migrations.mjs — connection details come from the environment), but the n8n
// credentials live in .env.local, which is gitignored and not exported by the shell. So we read
// that one file directly rather than asking every developer to `set -a && . ./.env.local`.
//
// Values already present in process.env always win, so CI can inject them as secrets.

import { existsSync, readFileSync } from "node:fs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

/** Parse a .env file into a plain object. Handles `export ` prefixes, quotes and `#` comments. */
function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes. Unquoted values keep everything up to a trailing
    // ` #` comment; a bare `#` inside an unquoted value is rare and not worth guessing at.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load .env.local then .env into process.env without overwriting anything already set. */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = REPO_ROOT + file;
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(path))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** Read a required variable, failing with an actionable message rather than a stack trace. */
export function requireEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required.${hint ? ` ${hint}` : ""}`);
    console.error("Put it in .env.local (gitignored). See .env.example and docs/reference/n8n/mcp-setup.md.");
    process.exit(1);
  }
  return value;
}

export { REPO_ROOT };
