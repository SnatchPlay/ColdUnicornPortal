-- Per-campaign Aimfox facts: how many invites the campaign sent and got accepted, and whether it
-- messages people at all.
--
-- Everything here is already fetched every two hours by `aimfox-daily-metrics`, which calls
-- GET /campaigns/{id} and GET /campaigns/{id}/metrics for every campaign and then throws all but
-- two numbers away. These four columns are where those numbers land.
--
--   invites_sent      = metrics.sent_connections      (cumulative, per campaign, not per day)
--   invites_accepted  = metrics.accepted_connections  (same)
--   message_steps     = Σ flows[].flow_message_templates.length
--   metrics_synced_at = when the above were last measured
--
-- `message_steps` is the LinkedIn service level, and it is a count rather than a flag because that
-- is what the vendor actually exposes. Probed across all nine keyed workspaces on 2026-08-19:
-- `outreach_type` is 'connect' on every one of the 19 campaigns and distinguishes nothing, while
-- the message sequence lives in the PRIMARY_CONNECT flow's `flow_message_templates`. A campaign
-- with zero of them sends invites and never writes; one with two or three runs a full sequence.
-- Corroborated independently: the only two clients that come out at zero are exactly the two whose
-- campaigns are named "Zaproszenia" (Polish for "invitations").
--
-- NULL vs 0 is load-bearing and there is deliberately no DEFAULT: NULL means "never measured", 0
-- means "measured, and it is zero". The accept-rate denominator needs that difference, and it is
-- the same discipline `aimfox-campaign-sync` already applies to `positive_responses` — a column is
-- better left unwritten than reset to a guess on every run.
--
-- Aimfox-only in practice. The columns stay on `campaigns` rather than a side table because they
-- are facts *of* a campaign; `sequencer_id` already says which vendor a row belongs to, and Bison
-- campaigns simply leave them NULL.

begin;

alter table public.campaigns
  add column if not exists invites_sent      integer,
  add column if not exists invites_accepted  integer,
  add column if not exists message_steps     integer,
  add column if not exists metrics_synced_at timestamptz;

comment on column public.campaigns.invites_sent is
  'Aimfox: cumulative connection invites sent by this campaign (metrics.sent_connections). NULL = never measured. Written by aimfox-daily-metrics.';
comment on column public.campaigns.invites_accepted is
  'Aimfox: cumulative invites accepted (metrics.accepted_connections). NULL = never measured. Written by aimfox-daily-metrics.';
comment on column public.campaigns.message_steps is
  'Aimfox: number of follow-up message templates across the campaign flows. 0 = invitations only, >0 = full campaign. Drives the Li/Lf mark in the clients grid. NULL = never measured.';
comment on column public.campaigns.metrics_synced_at is
  'When invites_sent / invites_accepted / message_steps were last read from Aimfox. No scheduled re-check exists, so this value ages and is meant to.';

-- The clients grid aggregates these per client over ACTIVE Aimfox campaigns on every page load.
create index if not exists idx_campaigns_aimfox_active
  on public.campaigns (client_id)
  where sequencer_id = '00000000-0000-4000-a000-000000000003'::uuid
    and status = 'active'
    and archived_at is null;

-- Deprecation, recorded rather than enforced: the clients grid stops reading this column in the
-- same change. It is Σ over ACTIVE campaigns of (audience_size − sent_connections), and
-- `audience_size` is a fixed ceiling the vendor reports (10000 for every `list` campaign, 2500 for
-- a `navigator` one), NOT the loaded audience — so the stored number has been ~20x too large for
-- its whole life (Bent Iron PL: 19968 stored against a real 918). The real audience is
-- `target_count`, which is already synced into campaigns.database_size. n8n keeps writing this
-- column for now by explicit decision; nothing reads it.
comment on column public.sequencer_daily_stats.remaining_database_size is
  'DEPRECATED 2026-08-19 — do not read. Computed from Aimfox audience_size, which is a fixed ceiling and not the loaded audience, so the value is wrong by a large factor. The clients grid derives remaining database from campaigns.database_size - campaigns.invites_sent over ACTIVE Aimfox campaigns instead. See docs/reference/functional/11-integrations.md.';

commit;
