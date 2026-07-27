/**
 * Parse every Supabase edge function and fail on a syntax error.
 *
 * These files are the one part of the repo nothing else checks. `pnpm build` is `vite build` and
 * never looks at `supabase/functions`; `pnpm test:run` cannot import them (Deno modules with
 * `npm:`/`jsr:` specifiers Node will not resolve); eslint's config does not cover the directory.
 * The only thing that parsed them was `supabase functions deploy` — which runs in CI *after* merge.
 *
 * On 2026-07-27 that gap shipped a broken `main`: a SQL comment inside a `sql` template literal
 * contained backticks, the backticks closed the literal, and the file stopped parsing. lint, tests,
 * build and n8n:validate were all green; the deploy failed and production silently stayed on the
 * previous version of the gateway.
 *
 * esbuild ships with vite, so this costs nothing and needs no Deno. It asserts syntax only —
 * imports are not resolved and types are not checked, which is exactly why it works on
 * Deno-flavoured TypeScript.
 *
 * Usage: node scripts/check-edge-functions.mjs   (wired into `pnpm lint`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = resolve(REPO_ROOT, "supabase/functions");

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...collect(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

const files = collect(FUNCTIONS_DIR);

// A moved or renamed directory must not turn this check into a silent pass.
if (files.length === 0) {
  console.error(`No .ts files under ${relative(REPO_ROOT, FUNCTIONS_DIR)} — did the directory move?`);
  process.exit(1);
}

let failed = 0;
for (const path of files) {
  const name = relative(REPO_ROOT, path);
  try {
    await transform(readFileSync(path, "utf8"), { loader: "ts", format: "esm" });
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    for (const e of err.errors ?? [{ text: err.message }]) {
      const at = e.location ? `:${e.location.line}:${e.location.column}` : "";
      console.error(`    ${e.text}${at}`);
      if (e.location?.lineText) console.error(`    | ${e.location.lineText.trim()}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} edge function source(s) failed to parse.`);
  process.exit(1);
}
console.log(`${files.length} edge function source(s) parse.`);
