-- Adds the master_admin variant to the user_role enum.
-- master_admin = customer-facing top-tier admin who configures the Clients table
-- and trigger thresholds. Seeded manually (see docs/reference/functional/12-hidden-rules.md).
alter type public.user_role add value if not exists 'master_admin';
