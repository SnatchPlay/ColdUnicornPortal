-- Make the legacy agency-owned domain fields nullable. Winnr-synced domains have no client link,
-- setup email, or purchase date — those are populated only when a domain is provisioned through the
-- agency's own process (which does not exist for Winnr imports yet). Production already had these
-- constraints dropped manually (n8n inserts Winnr domains with NULLs); this migration captures that
-- change in version control so a fresh/local database matches production. Idempotent — `drop not null`
-- on an already-nullable column is a no-op.

alter table public.domains
  alter column client_id    drop not null,
  alter column setup_email  drop not null,
  alter column purchase_date drop not null;
