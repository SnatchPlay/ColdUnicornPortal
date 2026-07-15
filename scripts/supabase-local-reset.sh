#!/usr/bin/env bash
#
# Provision (or reset) the local Supabase DB from a full cloud dump.
#
# Why not `supabase db reset`: the base schema lives only in the cloud, and supabase/migrations/ is
# a set of *delta* migrations (not a from-zero schema) whose YYYYMMDDb_ filenames the CLI skips. So
# we boot an EMPTY stack (migrations moved aside so the CLI doesn't try and fail to apply them),
# restore a full cloud dump, then apply any NEW migrations with the same runner used for prod.
#
# Usage:  CLOUD_DB_URL='postgresql://…pooler.supabase.com:5432/postgres' ./scripts/supabase-local-reset.sh
#
# The dump holds real data (PII): it is written under supabase/.local/ (gitignored) and never committed.
set -euo pipefail

: "${CLOUD_DB_URL:?set CLOUD_DB_URL to the cloud pooler connection string}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
PROJECT_ID="$(grep -m1 '^project_id' "$ROOT/supabase/config.toml" | cut -d'"' -f2)"
DB_CID="supabase_db_${PROJECT_ID}"
HOLD="$ROOT/supabase/.local/mig-hold"
DUMP_DIR="$ROOT/supabase/.local"
SB() { npx --yes supabase@latest "$@"; }

mkdir -p "$HOLD" "$DUMP_DIR"

echo "==> Booting an empty local stack (delta migrations held aside so the CLI won't apply them)"
mv "$ROOT"/supabase/migrations/*.sql "$HOLD"/ 2>/dev/null || true
restore_migrations() { mv "$HOLD"/*.sql "$ROOT"/supabase/migrations/ 2>/dev/null || true; rmdir "$HOLD" 2>/dev/null || true; }
trap restore_migrations EXIT   # always put the migrations back, even on failure
SB start

echo "==> Dumping the cloud schema + data (schema is base-only; data is PII, gitignored)"
SB db dump --db-url "$CLOUD_DB_URL"             -f "$DUMP_DIR/schema.sql"
SB db dump --db-url "$CLOUD_DB_URL" --data-only -f "$DUMP_DIR/data.sql"

echo "==> Restoring the dump into the local DB ($DB_CID)"
docker exec -i "$DB_CID" psql -U postgres -d postgres -v ON_ERROR_STOP=0 < "$DUMP_DIR/schema.sql" >/dev/null
docker exec -i "$DB_CID" psql -U postgres -d postgres -v ON_ERROR_STOP=0 < "$DUMP_DIR/data.sql"   >/dev/null

echo "==> Restoring migrations and applying any NEW ones with the runner"
restore_migrations
trap - EXIT
SUPABASE_DB_URL="$LOCAL_DB" node "$ROOT/scripts/db-apply-migrations.mjs"

echo "==> Local DB ready. API http://127.0.0.1:54321 · Studio http://127.0.0.1:54323"
