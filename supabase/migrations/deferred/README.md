# Deferred migrations

Migrations that are **written and reviewed now** but must **not run yet**.

## Why this directory exists

[`scripts/db-apply-migrations.mjs`](../../../scripts/db-apply-migrations.mjs) applies **every**
unapplied `.sql` file in `supabase/migrations/`, in filename order, with no opt-out. A "⚠️ do not
apply yet" comment in a file header is documentation, not a guard — CI's `db-migrate` job would run
it on the next push to `main`. (`20260704b_drop_client_sequencer_credentials.sql` carried exactly
such a header and was applied anyway.)

The runner filters on `.endsWith(".sql")` **and** `statSync(...).isFile()`, so anything inside this
subdirectory is invisible to it. That is the guard.

## How to apply one

When the preconditions in the file's own header are all satisfied:

```bash
git mv supabase/migrations/deferred/<file>.sql supabase/migrations/
pnpm db:migrate:local     # verify against the local stack FIRST
```

then let CI apply it to the cloud on merge. Never run a deferred migration straight against
production — see [CLAUDE.md §2](../../../CLAUDE.md) and
[docs/reference/local-supabase.md](../../../docs/reference/local-supabase.md).

## Current contents

| File | Blocked on |
|---|---|
| `20260722z_drop_legacy_ooo_columns.sql` | n8n cutover to the OOO RPCs (`20260722e`): it must stop writing `leads.qualification = 'OOO'/'NRR'`, `expected_return_date`, `added_to_ooo_campaign` and `contact_disposition`. Full preconditions are in the file header. |
