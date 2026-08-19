-- LinkedIn (Aimfox) DoD colouring: the Schedule and Daily-sent bands get absolute floors.
--
-- Until now only the Bison bands were coloured, by `dod_sent_or_schedule_vs_min_sent`, which reads
-- every cell against the client's configured `min_sent`. LinkedIn has no such per-client contract
-- number, so these two rules carry literal floors instead — and because the two bands mean
-- different things (invites *planned* vs invites *sent*), they get a surface each rather than one
-- reusable rule. See `DOD_CELL_BANDS` in src/app/lib/conditions/client-condition-results.ts.
--
--   Schedule (LinkedIn):   >= 30 green            · < 30 red
--   Daily sent (LinkedIn): >= 20 green · 10-19 yellow · < 10 red
--
-- `base_filter` is the "IF LinkedIn connected" gate, and it is load-bearing, not decorative: the
-- gateway's metrics summary runs the Aimfox counters through `toInt`, so a client with no Aimfox
-- connector reports 0 rather than null (orm-gateway/index.ts, loadClientsMetricsSummary). Without
-- the gate every email-only client would light up solid red across both bands.
--
-- `linkedin_connected` is computed in client-condition-context.ts and is true when the client has
-- an Aimfox credential *or* Aimfox numbers are arriving for it. Both arms are needed: the credential
-- alone misses clients that send invites without a `client_sequencers` row (there are such clients),
-- and the numbers alone would drop a connected client the week it sends nothing — which is exactly
-- the week somebody needs to see red.
--
-- Branches evaluate in array order, first match wins, so the ranges are still written out in full:
-- a master_admin reordering them in the builder must not silently change what yellow means.
--
-- Idempotent: `on conflict (key) do update` overwrites the rule body, which also repairs a rule
-- that was hand-edited in the master-admin UI.

begin;

insert into public.condition_rules (
  key, name, description, target_entity, surface, metric_key,
  scope_type, apply_to, column_key, branches, base_filter, priority, enabled
) values
(
  'dod_aimfox_schedule_floor',
  'DoD Schedule (LinkedIn) floor',
  'Colours the Schedule (LinkedIn) band: 30 or more invites planned = green, fewer = red. Only applies to clients with a LinkedIn connector.',
  'client',
  'clients_dod_aimfox_schedule',
  'value',
  'global',
  'cell',
  'dynamic_dod_bucket',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"gte","right":{"value":30}},"label":"LinkedIn schedule healthy","message":"30 or more LinkedIn invites are scheduled for this day."},
    {"severity":"danger","when":{"left":{"metric":"value"},"op":"lt","right":{"value":30}},"label":"LinkedIn schedule too low","message":"Fewer than 30 LinkedIn invites are scheduled for this day."}
  ]'::jsonb,
  '{"left":{"metric":"linkedin_connected"},"op":"eq","right":{"value":true}}'::jsonb,
  21,
  true
),
(
  'dod_aimfox_sent_floor',
  'DoD Daily sent (LinkedIn) floor',
  'Colours the Daily sent (LinkedIn) band: 20 or more invites sent = green, 10-19 = yellow, fewer than 10 = red. Only applies to clients with a LinkedIn connector.',
  'client',
  'clients_dod_aimfox_sent',
  'value',
  'global',
  'cell',
  'dynamic_dod_bucket',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"gte","right":{"value":20}},"label":"LinkedIn volume on target","message":"20 or more LinkedIn invites were sent on this day."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value"},"op":"gte","right":{"value":10}},{"left":{"metric":"value"},"op":"lt","right":{"value":20}}]},"label":"LinkedIn volume below target","message":"Between 10 and 19 LinkedIn invites were sent on this day."},
    {"severity":"danger","when":{"left":{"metric":"value"},"op":"lt","right":{"value":10}},"label":"LinkedIn volume critical","message":"Fewer than 10 LinkedIn invites were sent on this day."}
  ]'::jsonb,
  '{"left":{"metric":"linkedin_connected"},"op":"eq","right":{"value":true}}'::jsonb,
  22,
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
