-- PDCA grid cell-colour rules — fix the per-bucket operand + add Setup colouring.
--
-- Background. 3-DoD / WoW / MoM cells are coloured through the per-cell evaluation
-- path in `lib/conditions/client-condition-results.ts`, which injects the bucket's
-- own number as `context.value` and overrides `column_key` with `td3:{bucket}:{metric}`
-- (resp. `wow:` / `mom:`). The seeded rules below compared `{"metric":"three_dod_sql"}`
-- / `"wow_sql"` / `"mom_sql"` instead — those context keys hold *row-level rolling
-- aggregates* (3-day sum, current week, current month) and are identical for all five
-- buckets, so every cell in a band got the same colour, derived from the wrong number.
-- Switching the left operand to `{"metric":"value"}` makes each cell judge its own day.
--
-- The rate rules (wow_bounce_rate, wow_ooo_rate, …) already used `value` and are correct.
--
-- Targets are derived from `monthly_sql_kpi` (= clients.kpi_leads, "KPI LEADS / MONTH"):
--   3-DoD SQL → KPI / 20 days · WoW SQL → KPI / 4 weeks · MoM SQL → KPI
--   >= target → good (green) · 80–99.99% of it → warning (yellow) · < 80% → danger (red)
--
-- The comparisons scale the *left* (integer) side rather than multiplying the KPI by
-- 0.05 / 0.04 / 0.25 / 0.2: `value * 20 >= kpi` is exact, whereas `value >= kpi * 0.04`
-- drifts in IEEE-754 (100 * 0.04 = 4.000000000000001), which would flip a client sitting
-- exactly on the 80% boundary from yellow to red. Same for the 2.51x ratio, expressed as
-- `value * 100 >= sql * 251`.
--
-- A client with no KPI (kpi_leads is null) matches no branch, so its cells stay uncoloured.

begin;

-- 3-DoD SQL vs daily lead-KPI target (KPI / 20).
update public.condition_rules
set
  description = 'Compares each day''s SQL leads against the daily SQL KPI target (monthly KPI / 20 days).',
  branches = '[
    {"severity":"good","when":{"left":{"metric":"value","multiplier":20},"op":"gte","right":{"metric":"monthly_sql_kpi"}},"label":"SQL on daily target","message":"Day''s SQL leads are at or above the daily lead-KPI target (KPI / 20)."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value","multiplier":25},"op":"gte","right":{"metric":"monthly_sql_kpi"}},{"left":{"metric":"value","multiplier":20},"op":"lt","right":{"metric":"monthly_sql_kpi"}}]},"label":"SQL slightly below daily target","message":"Day''s SQL leads are between 80% and 99.99% of the daily lead-KPI target."},
    {"severity":"danger","when":{"left":{"metric":"value","multiplier":25},"op":"lt","right":{"metric":"monthly_sql_kpi"}},"label":"SQL below daily target","message":"Day''s SQL leads are below 80% of the daily lead-KPI target."}
  ]'::jsonb,
  updated_at = now()
where key = 'three_dod_sql_vs_monthly_lead_kpi_daily_target';

-- WoW SQL vs weekly lead-KPI target (KPI / 4).
update public.condition_rules
set
  description = 'Compares each week''s SQL leads against the weekly SQL KPI target (monthly KPI / 4 weeks).',
  branches = '[
    {"severity":"good","when":{"left":{"metric":"value","multiplier":4},"op":"gte","right":{"metric":"monthly_sql_kpi"}},"label":"SQL on weekly target","message":"Week''s SQL leads are at or above the weekly lead-KPI target (KPI / 4)."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value","multiplier":5},"op":"gte","right":{"metric":"monthly_sql_kpi"}},{"left":{"metric":"value","multiplier":4},"op":"lt","right":{"metric":"monthly_sql_kpi"}}]},"label":"SQL slightly below weekly target","message":"Week''s SQL leads are between 80% and 99.99% of the weekly lead-KPI target."},
    {"severity":"danger","when":{"left":{"metric":"value","multiplier":5},"op":"lt","right":{"metric":"monthly_sql_kpi"}},"label":"SQL below weekly target","message":"Week''s SQL leads are below 80% of the weekly lead-KPI target."}
  ]'::jsonb,
  updated_at = now()
where key = 'wow_sql_vs_monthly_lead_kpi_weekly_target';

-- MoM SQL vs the monthly lead KPI itself. (1.25 is exact in binary; value * 1.25 >= kpi
-- is the same test as value >= 0.8 * kpi, without the rounding drift.)
update public.condition_rules
set
  description = 'Compares each month''s SQL leads against the monthly SQL KPI.',
  branches = '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"gte","right":{"metric":"monthly_sql_kpi"}},"label":"SQL on monthly target","message":"Month''s SQL leads are at or above the monthly lead KPI."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value","multiplier":1.25},"op":"gte","right":{"metric":"monthly_sql_kpi"}},{"left":{"metric":"value"},"op":"lt","right":{"metric":"monthly_sql_kpi"}}]},"label":"SQL slightly below monthly target","message":"Month''s SQL leads are between 80% and 99.99% of the monthly lead KPI."},
    {"severity":"danger","when":{"left":{"metric":"value","multiplier":1.25},"op":"lt","right":{"metric":"monthly_sql_kpi"}},"label":"SQL below monthly target","message":"Month''s SQL leads are below 80% of the monthly lead KPI."}
  ]'::jsonb,
  updated_at = now()
where key = 'mom_sql_vs_monthly_lead_kpi';

-- MoM Meetings vs the monthly meetings KPI. Same per-bucket defect as the SQL bands:
-- the branches compared `mom_meetings`, which is the *current* month's number, so all
-- five MoM Mtg cells were coloured from bucket 0 — a month with 0 meetings could render
-- green next to a literal "0".
update public.condition_rules
set
  description = 'Compares each month''s booked meetings against the monthly meetings KPI.',
  branches = '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"gte","right":{"metric":"monthly_meeting_kpi"}},"label":"Meetings on monthly target","message":"Month''s meetings are at or above the monthly meetings KPI."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value","multiplier":1.25},"op":"gte","right":{"metric":"monthly_meeting_kpi"}},{"left":{"metric":"value"},"op":"lt","right":{"metric":"monthly_meeting_kpi"}}]},"label":"Meetings slightly below monthly target","message":"Month''s meetings are between 80% and 99.99% of the monthly meetings KPI."},
    {"severity":"danger","when":{"left":{"metric":"value","multiplier":1.25},"op":"lt","right":{"metric":"monthly_meeting_kpi"}},"label":"Meetings below monthly target","message":"Month''s meetings are below 80% of the monthly meetings KPI."}
  ]'::jsonb,
  updated_at = now()
where key = 'mom_meetings_vs_meeting_kpi';

-- 3-DoD TOTAL vs the SQL leads of the *same day*.
-- `cell.sql_leads` is the same-bucket sibling injected by evaluateThreeDodCells; the
-- row-level `three_dod_sql` key would compare against the 3-day rolling sum instead.
-- base_filter keeps empty days (total = 0) uncoloured — without it, 0 >= 2.51 * 0 holds.
update public.condition_rules
set
  name = '3DoD Total vs Same-Day SQL',
  description = 'Flags a day whose total leads are 2.51x or more of that same day''s SQL leads — weak lead quality.',
  branches = '[
    {"severity":"warning","when":{"left":{"metric":"value","multiplier":100},"op":"gte","right":{"metric":"cell.sql_leads","multiplier":251}},"label":"Total leads too high vs SQL","message":"Total leads are at least 2.51x the SQL leads of the same day. Lead quality may be weak."}
  ]'::jsonb,
  base_filter = '{"left":{"metric":"value"},"op":"gt","right":{"value":0}}'::jsonb,
  updated_at = now()
where key = 'three_dod_total_too_high_vs_sql';

-- The "Bi" column is gone from the grid and from the client drawer, so the rule that
-- coloured it has no cell to paint. Keep the row (history + `clients.bi_setup_done`
-- still exist) but stop evaluating it.
update public.condition_rules
set enabled = false, updated_at = now()
where key = 'bi_setup_required';

-- Setup droplist colouring: One = red, BiS1 / BiS2 = green.
-- The field is a master-admin custom column, so its id differs per environment — resolve
-- it by name. No-op where the column has not been created.
do $$
declare
  setup_field_id uuid;
begin
  select id into setup_field_id
  from public.client_custom_fields
  where lower(name) = 'setup' and field_type = 'droplist'
  order by position
  limit 1;

  if setup_field_id is null then
    raise notice 'No "Setup" droplist custom field found — skipping setup_type_colour rule.';
    return;
  end if;

  insert into public.condition_rules (
    key, name, description, target_entity, surface, metric_key,
    scope_type, apply_to, column_key, branches, base_filter, priority, enabled
  ) values (
    'setup_type_colour',
    'Setup type',
    'Colours the Setup column: One = red, BiS1 / BiS2 = green.',
    'client',
    'clients_overview',
    'custom.' || setup_field_id,
    'global',
    'cell',
    'cf:' || setup_field_id,
    format('[
      {"severity":"good","when":{"left":{"metric":"custom.%1$s"},"op":"in","right":{"value":["BiS1","BiS2"]}},"label":"BI setup","message":"Client is on a BiS setup."},
      {"severity":"danger","when":{"left":{"metric":"custom.%1$s"},"op":"eq","right":{"value":"One"}},"label":"One-off setup","message":"Client is on a one-off setup."}
    ]', setup_field_id)::jsonb,
    null,
    45,
    true
  )
  on conflict (key) do update set
    metric_key = excluded.metric_key,
    column_key = excluded.column_key,
    branches = excluded.branches,
    enabled = true,
    updated_at = now();
end $$;

commit;
