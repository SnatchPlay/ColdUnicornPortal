# Database invariant tests

SQL suites that assert the guarantees a migration is supposed to provide. Each file runs inside one
transaction and ends with `rollback`, so it is safe against a local copy of a production dump and
leaves nothing behind.

They exist because types and application tests cannot prove a database invariant: a partial unique
index, an RLS policy or a `SECURITY DEFINER` grant is only real if the database refuses the thing it
is supposed to refuse.

## Running

Against the local stack ([docs/reference/local-supabase.md](../../docs/reference/local-supabase.md)):

```bash
docker exec -i supabase_db_bnetnuzxynmdftiadwef \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/ooo-invariants.sql
```

Success prints the three `--- … suite passed ---` markers and `ROLLBACK`. Any violated invariant
aborts at its own `ASSERT` with the message naming the check (e.g. `T2.12 a second ACTIVE follow-up
was allowed`).

`plpgsql.check_asserts` must be `on` (the default). Confirm with
`show plpgsql.check_asserts;` — if it is `off`, every assertion is a silent no-op and the suite
proves nothing.

## Suites

| File | Covers |
|---|---|
| `ooo-invariants.sql` | ADR-0015. Ingestion idempotency, the two `ooo_followups` unique invariants, the follow-up state machine and its illegal transitions, `promote_contact_to_lead` whitelist + one-contact-one-lead, skipped-episode recovery, RLS isolation between managers / the client role, and the backfill classification rules. |
