-- Add an explicit position to per-column overrides so master_admin can
-- reorder the Clients mega-table columns. Nullable: a NULL position means
-- "no explicit override — use the built-in MEGA_COLUMNS default order".
-- The frontend places columns with explicit positions first (ordered by
-- position ascending), then the remaining columns in their default order.

alter table public.client_table_column_overrides
  add column if not exists position int;
