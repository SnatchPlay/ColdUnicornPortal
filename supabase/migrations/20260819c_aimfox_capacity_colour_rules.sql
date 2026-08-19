-- Colour the two LinkedIn capacity cells in the clients grid.
--
--   Acceptance rate  (`aimfox_accept_rate`) : >= 40% green · 30-39% yellow · < 30% red
--   Remaining database (`aimfox_remaining_db`) : >= 200 green · 100-199 yellow · < 100 red
--
-- Both metrics are 0..1 fractions / plain integers on the condition context, fed from the ACTIVE
-- Aimfox campaign rollup (client-condition-context.ts). RATES ARE FRACTIONS: 0.40, not 40 — every
-- other rate rule in this table is written the same way (see wow_bounce_rate, 20260428), and a rule
-- comparing a 0..1 value against 40 would simply never fire.
--
-- No `base_filter`, deliberately. Both metrics are NULL for a client with no active LinkedIn
-- campaign, and every numeric operator in the evaluator returns false against a NULL left operand
-- (evaluator.ts compareWithOperator) — so those clients match no branch and stay uncoloured without
-- a gate to maintain. A real 0 still colours: a client that has sent its whole audience genuinely
-- has nothing left, and that is worth seeing in red.
--
-- Branches evaluate in array order, first match wins, so each range is written out in full rather
-- than relying on the preceding branch having already excluded it.
--
-- Idempotent: `on conflict (key) do update` overwrites the rule body, which also repairs a rule
-- hand-edited in the master-admin UI.

begin;

insert into public.condition_rules (
  key, name, description, target_entity, surface, metric_key,
  scope_type, apply_to, column_key, branches, base_filter, priority, enabled
) values
(
  'aimfox_accept_rate',
  'LinkedIn acceptance rate',
  'Colours the LinkedIn acceptance cell: 40% or more = green, 30-39% = yellow, under 30% = red. Cumulative across the client''s active Aimfox campaigns.',
  'client',
  'clients_overview',
  'aimfox_accept_rate',
  'global',
  'cell',
  'aimfox_accept_rate',
  '[
    {"severity":"good","when":{"left":{"metric":"aimfox_accept_rate"},"op":"gte","right":{"value":0.4}},"label":"Acceptance healthy","message":"40% or more of LinkedIn invites are being accepted."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"aimfox_accept_rate"},"op":"gte","right":{"value":0.3}},{"left":{"metric":"aimfox_accept_rate"},"op":"lt","right":{"value":0.4}}]},"label":"Acceptance below target","message":"Between 30% and 39% of LinkedIn invites are being accepted."},
    {"severity":"danger","when":{"left":{"metric":"aimfox_accept_rate"},"op":"lt","right":{"value":0.3}},"label":"Acceptance critical","message":"Fewer than 30% of LinkedIn invites are being accepted."}
  ]'::jsonb,
  null,
  46,
  true
),
(
  'aimfox_remaining_db',
  'LinkedIn remaining database',
  'Colours the LinkedIn remaining-database cell: 200 or more = green, 100-199 = yellow, under 100 = red. Loaded audience minus invites already sent, across active Aimfox campaigns.',
  'client',
  'clients_overview',
  'aimfox_remaining_db',
  'global',
  'cell',
  'aimfox_remaining_db',
  '[
    {"severity":"good","when":{"left":{"metric":"aimfox_remaining_db"},"op":"gte","right":{"value":200}},"label":"Audience healthy","message":"200 or more prospects are still available to invite."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"aimfox_remaining_db"},"op":"gte","right":{"value":100}},{"left":{"metric":"aimfox_remaining_db"},"op":"lt","right":{"value":200}}]},"label":"Audience running low","message":"Between 100 and 199 prospects are still available to invite."},
    {"severity":"danger","when":{"left":{"metric":"aimfox_remaining_db"},"op":"lt","right":{"value":100}},"label":"Audience nearly exhausted","message":"Fewer than 100 prospects are still available to invite — load more audience."}
  ]'::jsonb,
  null,
  47,
  true
)
on conflict (key) do update set
  name        = excluded.name,
  description = excluded.description,
  surface     = excluded.surface,
  metric_key  = excluded.metric_key,
  column_key  = excluded.column_key,
  branches    = excluded.branches,
  base_filter = excluded.base_filter,
  enabled     = true,
  updated_at  = now();

commit;
