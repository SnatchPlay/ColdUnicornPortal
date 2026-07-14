-- Per-user table preferences — column widths, filters and sort for the portal's tables.
--
-- Why a new table rather than `column_overrides`: that table is a *global* layout owned by
-- master_admin (labels, order, hidden columns) and applies to everyone. Resizing a column or
-- picking a status filter is a personal ergonomic act — one CS manager dragging a column must
-- not rebuild the grid for the whole team. So these are keyed by user.
--
-- Note on impersonation: the portal impersonates client-side only (auth.tsx swaps `identity`),
-- while the JWT that reaches the gateway still belongs to the real actor. `auth.uid()` is
-- therefore the person doing the dragging, which is exactly what we want to key on.

begin;

create table if not exists public.user_table_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  -- Which table these preferences belong to, e.g. 'clients:mega'. Free-form so a new
  -- table can adopt this without a migration.
  table_key text not null,
  -- { widths: { <columnId>: number }, filters: {...}, sort: { key, direction } }.
  -- Deliberately schemaless: the UI owns the shape, and an unknown/stale key is ignored
  -- by the client rather than breaking a page.
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, table_key)
);

comment on table public.user_table_preferences is
  'Per-user, per-table UI preferences (column widths, filters, sort). Personal — not the global column_overrides layout.';

-- Keep a single row from growing without bound (a runaway client could otherwise stuff
-- megabytes into jsonb). 64 KB is far above any real layout; the gateway also caps the
-- payload before it gets here.
alter table public.user_table_preferences
  drop constraint if exists user_table_preferences_size_check;
alter table public.user_table_preferences
  add constraint user_table_preferences_size_check
  check (pg_column_size(preferences) <= 65536);

alter table public.user_table_preferences enable row level security;

-- Own rows only, for every verb. `auth.uid()` is a stable per-statement value, not a
-- per-row function call on a column, so this stays set-based (ADR-0006).
drop policy if exists "user_table_preferences_select_own" on public.user_table_preferences;
create policy "user_table_preferences_select_own"
on public.user_table_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_table_preferences_insert_own" on public.user_table_preferences;
create policy "user_table_preferences_insert_own"
on public.user_table_preferences
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_table_preferences_update_own" on public.user_table_preferences;
create policy "user_table_preferences_update_own"
on public.user_table_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_table_preferences_delete_own" on public.user_table_preferences;
create policy "user_table_preferences_delete_own"
on public.user_table_preferences
for delete
to authenticated
using (user_id = auth.uid());

commit;
