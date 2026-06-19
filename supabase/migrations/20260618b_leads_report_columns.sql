-- Client Feedback Batch 4 (Leads Report Table replacement).
-- Adds report-only fields to public.leads:
--   * rename `comments` -> `client_note`  (client-facing note; preserved data, was already
--     surfaced in the client portal lead drawer, so it stays the client-visible note)
--   * add    `coldunicorn_note`           (internal note; hidden from the client role by the
--     orm-gateway loadLeadsList projection)
--   * add    `highlight`                   (manual report row colour: green/yellow/red or NULL)
--
-- NOTE: This batch intentionally does NOT touch status semantics — the legacy
-- micro-CRM booleans (meeting_booked/meeting_held/offer_sent/won) and qualification
-- are unchanged. The "Status" report column is derived read-only from the existing
-- getLeadStage() logic. Status-model migration is deferred pending client confirmation.

alter table public.leads rename column comments to client_note;

alter table public.leads add column if not exists coldunicorn_note text;

alter table public.leads add column if not exists highlight text
  check (highlight in ('green', 'yellow', 'red'));
