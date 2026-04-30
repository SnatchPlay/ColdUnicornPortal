# orm-gateway

Supabase Edge Function that routes app data actions through Drizzle ORM with transaction-local RLS passthrough.

## Purpose

- Replace frontend direct `supabase.from(...)` reads/writes for core runtime data operations.
- Execute DB actions through Drizzle + Postgres.js in Edge.
- Preserve Supabase RLS behavior by setting JWT claims and role in transaction-local settings.

## Required secrets

- `DATABASE_URL` (transaction pooler connection string)
- `SUPABASE_URL` (managed by Supabase runtime)
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY` (managed by Supabase runtime)

## Request

`POST /functions/v1/orm-gateway`

Headers:

- `Authorization: Bearer <user_access_token>`
- `Content-Type: application/json`

Body:

```json
{
  "action": "loadSnapshot",
  "includeDailyStats": true
}
```

## Response envelope

Success:

```json
{
  "ok": true,
  "data": { "...": "action result" }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "message": "...",
    "code": "optional_pg_code"
  }
}
```
