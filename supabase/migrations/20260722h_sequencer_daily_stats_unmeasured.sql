-- Let sequencer_daily_stats distinguish "measured zero" from "not measured".
--
-- The table has never been written (verified 2026-07-22, 0 rows, no portal or gateway reader).
-- Its first data is a backfill of Aimfox metrics out of the '🤖Daily stats' sheet, which carries
-- invitations sent and schedule volume but NOT acceptances. Writing 0 into invites_accepted would
-- store an unmeasured value indistinguishably from a real zero — the exact defect recorded as
-- invariant 3 in docs/reference/processes/outreach/bison-ingestion.md ("a silent zero is a lie").
--
-- invites_sent keeps NOT NULL: every row the backfill writes has a real value for it.

alter table public.sequencer_daily_stats
  alter column invites_accepted drop not null,
  alter column invites_accepted drop default;

comment on column public.sequencer_daily_stats.invites_accepted is
  'Invitations accepted on the report date. NULL means not measured — the source did not report it. '
  'Never write 0 to mean "unknown": consumers must treat NULL and 0 differently.';

comment on column public.sequencer_daily_stats.profile_id is
  'LinkedIn profile the row describes. The sentinel ''__workspace_total__'' marks a row whose source '
  'reported per workspace per day rather than per profile (the Google Sheets backfill). Any '
  'per-profile ingestion MUST exclude that sentinel or it will double-count the workspace.';
