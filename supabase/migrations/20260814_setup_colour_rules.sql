-- Setup droplist colouring, v2.
--
-- Was (20260714_pdca_cell_colour_rules.sql): One = danger, BiS1 / BiS2 = good, and a client with no
-- value at all stayed uncoloured — which is precisely the client somebody needs to see.
-- Now: nothing set = danger (red) · One = warning (yellow) · BiS1 / BiS2 = good (green).
--
-- The "nothing set" branch is `is_blank`: true for a stored null, an empty string, and a client with
-- no `client_custom_field_values` row at all (src/app/lib/conditions/evaluator.ts).
-- The tempting alternative — `not_in ["One","BiS1","BiS2"]` — was rejected because it copies the
-- droplist's option list into the rule body: the day a master_admin adds a fourth setup type, every
-- client on it turns red for "not chosen". `is_blank` was not offered for droplist metrics in the
-- guided rule builder until this change widened ENUM_OPS (lib/conditions/metric-catalog.ts) — the
-- builder and the validator already handled right-operand-less operators, so it was only a gap in a
-- preset list. The rule stays editable by a master_admin without the super_admin-only Raw JSON tab.
--
-- Branches evaluate in array order, first match wins (src/app/lib/conditions/evaluator.ts), so the
-- two positive branches come first and the catch-all is last.
--
-- The custom-field id is environment-specific, so resolve it by name and no-op where absent.
-- Idempotent: `on conflict (key) do update` overwrites `branches` unconditionally, which also
-- repairs a rule that was hand-edited in the master-admin UI.

begin;

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
    'Colours the Setup column: nothing set = red, One = yellow, BiS1 / BiS2 = green.',
    'client',
    'clients_overview',
    'custom.' || setup_field_id,
    'global',
    'cell',
    'cf:' || setup_field_id,
    format('[
      {"severity":"good","when":{"left":{"metric":"custom.%1$s"},"op":"in","right":{"value":["BiS1","BiS2"]}},"label":"BI setup","message":"Client is on a BiS setup."},
      {"severity":"warning","when":{"left":{"metric":"custom.%1$s"},"op":"eq","right":{"value":"One"}},"label":"One-off setup","message":"Client is on a one-off setup."},
      {"severity":"danger","when":{"left":{"metric":"custom.%1$s"},"op":"is_blank"},"label":"Setup not chosen","message":"No setup type has been selected for this client."}
    ]', setup_field_id)::jsonb,
    null,
    45,
    true
  )
  -- name / description are in the update list on purpose: the 20260714 version omitted them, so a
  -- re-run left the old description in place describing rules that no longer existed.
  on conflict (key) do update set
    name        = excluded.name,
    description = excluded.description,
    metric_key  = excluded.metric_key,
    column_key  = excluded.column_key,
    branches    = excluded.branches,
    enabled     = true,
    updated_at  = now();
end $$;

commit;
