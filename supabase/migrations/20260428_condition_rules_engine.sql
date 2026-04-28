begin;

create table if not exists public.condition_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  target_entity text not null default 'client',
  surface text not null,
  metric_key text not null,
  source_sheet text,
  source_range text,
  scope_type text not null default 'global',
  client_id uuid references public.clients(id) on delete cascade,
  manager_id uuid references public.users(id) on delete cascade,
  apply_to text not null default 'cell',
  column_key text,
  branches jsonb not null,
  base_filter jsonb,
  priority integer not null default 100,
  enabled boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_condition_rules_lookup
  on public.condition_rules (target_entity, surface, enabled, priority);

create index if not exists idx_condition_rules_client_scope
  on public.condition_rules (client_id)
  where scope_type = 'client';

create index if not exists idx_condition_rules_manager_scope
  on public.condition_rules (manager_id)
  where scope_type = 'manager';

alter table public.condition_rules enable row level security;

drop policy if exists "condition_rules_select_scoped" on public.condition_rules;
create policy "condition_rules_select_scoped"
on public.condition_rules
for select
to authenticated
using (
  private.is_admin_user()
  or (
    private.current_app_role() = 'manager'
    and (
      scope_type = 'global'
      or (scope_type = 'manager' and manager_id = auth.uid())
      or (
        scope_type = 'client'
        and client_id in (
          select c.id
          from public.clients c
          where c.manager_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists "condition_rules_admin_insert" on public.condition_rules;
create policy "condition_rules_admin_insert"
on public.condition_rules
for insert
to authenticated
with check (private.is_admin_user());

drop policy if exists "condition_rules_admin_update" on public.condition_rules;
create policy "condition_rules_admin_update"
on public.condition_rules
for update
to authenticated
using (private.is_admin_user())
with check (private.is_admin_user());

drop policy if exists "condition_rules_admin_delete" on public.condition_rules;
create policy "condition_rules_admin_delete"
on public.condition_rules
for delete
to authenticated
using (private.is_admin_user());

insert into public.condition_rules (
  key,
  name,
  description,
  target_entity,
  surface,
  metric_key,
  source_sheet,
  source_range,
  scope_type,
  apply_to,
  column_key,
  branches,
  base_filter,
  priority,
  enabled,
  notes
)
values
(
  'prospects_added_vs_signed',
  'Prospects Added vs Signed',
  'Tracks whether prospects added meet the signed target.',
  'client',
  'clients_overview',
  'prospects_added',
  'CS PDCA',
  'P4:P70',
  'global',
  'cell',
  'prospects_added',
  '[
    {"severity":"good","when":{"left":{"metric":"prospects_added"},"op":"gte","right":{"metric":"prospects_signed"}},"label":"Prospects target reached","message":"Prospects added is greater than or equal to prospects signed."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"prospects_added"},"op":"gte","right":{"metric":"prospects_signed","multiplier":0.8}},{"left":{"metric":"prospects_added"},"op":"lt","right":{"metric":"prospects_signed"}}]},"label":"Prospects slightly below target","message":"Prospects added is between 80% and 99% of target."},
    {"severity":"danger","when":{"left":{"metric":"prospects_added"},"op":"lt","right":{"metric":"prospects_signed","multiplier":0.8}},"label":"Prospects below target","message":"Prospects added is below 80% of target."}
  ]'::jsonb,
  null,
  10,
  true,
  null
),
(
  'dod_sent_or_schedule_vs_min_sent',
  'DoD Sent/Schedule vs Min Sent',
  'Reusable DoD bucket evaluator for schedule and sent values.',
  'client',
  'clients_dod',
  'value',
  'CS PDCA',
  'S4:Z70',
  'global',
  'cell',
  'dynamic_dod_bucket',
  '[
    {"severity":"good","when":{"all":[{"left":{"metric":"value"},"op":"gte","right":{"metric":"min_sent","multiplier":0.971}},{"left":{"metric":"value"},"op":"lt","right":{"metric":"min_sent","multiplier":1.5}}]},"label":"Within normal send range","message":"Current value is within acceptable daily-send range."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value"},"op":"gte","right":{"metric":"min_sent","multiplier":0.8}},{"left":{"metric":"value"},"op":"lte","right":{"metric":"min_sent","multiplier":0.97}}]},"label":"Slightly below minimum","message":"Current value is between 80% and 97% of target."},
    {"severity":"danger","when":{"left":{"metric":"value"},"op":"lt","right":{"metric":"min_sent","multiplier":0.8}},"label":"Below daily send floor","message":"Current value is below 80% of configured minimum sent."},
    {"severity":"critical_over","when":{"left":{"metric":"value"},"op":"gte","right":{"metric":"min_sent","multiplier":1.5}},"label":"Over sending threshold","message":"Current value exceeds 150% of configured minimum sent."}
  ]'::jsonb,
  null,
  20,
  true,
  null
),
(
  'inboxes_vs_min_sent',
  'Inboxes vs Min Sent Capacity',
  'Checks if inbox capacity supports configured daily volume.',
  'client',
  'clients_overview',
  'inboxes',
  'CS PDCA',
  'N4:N70',
  'global',
  'cell',
  'inboxes',
  '[
    {"severity":"good","when":{"left":{"metric":"inboxes"},"op":"gte","right":{"metric":"min_sent","multiplier":0.1}},"label":"Inbox capacity sufficient","message":"Inbox capacity supports configured daily send volume."},
    {"severity":"danger","when":{"left":{"metric":"inboxes"},"op":"lt","right":{"metric":"min_sent","multiplier":0.1}},"label":"Inbox capacity too low","message":"Inbox capacity is below required minimum for configured daily send volume."}
  ]'::jsonb,
  null,
  30,
  true,
  null
),
(
  'three_dod_sql_vs_monthly_lead_kpi_daily_target',
  '3DoD SQL vs Daily Lead KPI Target',
  'Compares 3DoD SQL to daily SQL KPI target (monthly KPI / 20).',
  'client',
  'clients_3dod',
  'three_dod_sql',
  'CS PDCA',
  'AF4:AJ70',
  'global',
  'cell',
  'three_dod_sql',
  '[
    {"severity":"good","when":{"left":{"metric":"three_dod_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi","multiplier":0.05}},"label":"3DoD SQL on target","message":"3DoD SQL is at or above daily lead KPI target."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"three_dod_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi","multiplier":0.04}},{"left":{"metric":"three_dod_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi","multiplier":0.05}}]},"label":"3DoD SQL slightly below target","message":"3DoD SQL is between 80% and 99% of daily target."},
    {"severity":"danger","when":{"left":{"metric":"three_dod_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi","multiplier":0.04}},"label":"3DoD SQL below target","message":"3DoD SQL is below 80% of daily target."}
  ]'::jsonb,
  null,
  40,
  true,
  null
),
(
  'three_dod_total_too_high_vs_sql',
  '3DoD Total Too High vs SQL',
  'Flags when total leads are more than 2x SQL leads.',
  'client',
  'clients_3dod',
  'three_dod_total',
  'CS PDCA',
  'AA4:AE70',
  'global',
  'cell',
  'three_dod_total',
  '[
    {"severity":"warning","when":{"left":{"metric":"three_dod_total"},"op":"gt","right":{"metric":"three_dod_sql","multiplier":2.01}},"label":"Total leads too high vs SQL","message":"Total leads are more than 2x SQL leads. Lead quality may be weak."}
  ]'::jsonb,
  null,
  41,
  true,
  null
),
(
  'wow_bounce_rate',
  'WoW Bounce Rate',
  'Tracks bounce-rate risk thresholds.',
  'client',
  'clients_wow',
  'wow_bounce_rate',
  'CS PDCA',
  'AK4:AN70',
  'global',
  'cell',
  'wow_bounce_rate',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"lte","right":{"value":0.01}},"label":"Bounce healthy","message":"Bounce rate is within healthy range (<=1%)."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value"},"op":"gt","right":{"value":0.01}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.02}}]},"label":"Bounce warning","message":"Bounce rate is between 1% and 2%."},
    {"severity":"danger","when":{"left":{"metric":"value"},"op":"gte","right":{"value":0.02}},"label":"Bounce danger","message":"Bounce rate is above 2%."}
  ]'::jsonb,
  null,
  50,
  true,
  null
),
(
  'wow_total_response_rate',
  'WoW Total Response Rate',
  'Legacy parity rule for total response rate.',
  'client',
  'clients_wow',
  'wow_total_response_rate',
  'CS PDCA',
  'AO4:AR70',
  'global',
  'cell',
  'wow_total_response_rate',
  '[
    {"severity":"good","when":{"any":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.02}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.001}}]},"label":"Response in acceptable legacy band","message":"Response rate meets legacy green conditions."},
    {"severity":"danger","when":{"all":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.001}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.02}}]},"label":"Response rate low","message":"Response rate is between 0.10% and 2%."}
  ]'::jsonb,
  null,
  51,
  true,
  'Legacy sheet treats very low response rate under 0.10% as green, likely to avoid flagging empty rows. Verify business intent.'
),
(
  'wow_human_response_rate',
  'WoW Human Response Rate',
  'Legacy parity rule for human response rate.',
  'client',
  'clients_wow',
  'wow_human_response_rate',
  'CS PDCA',
  'AS4:AV70',
  'global',
  'cell',
  'wow_human_response_rate',
  '[
    {"severity":"good","when":{"any":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.01}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.001}}]},"label":"Human response in acceptable legacy band","message":"Human response rate meets legacy green conditions."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.001}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.01}}]},"label":"Human response slightly low","message":"Human response rate is between 0.10% and 1%."}
  ]'::jsonb,
  null,
  52,
  true,
  'Legacy sheet treats very low human response rate under 0.10% as green. Verify business intent.'
),
(
  'wow_ooo_rate',
  'WoW OOO Rate',
  'Monitors OOO rate against legacy normal range.',
  'client',
  'clients_wow',
  'wow_ooo_rate',
  'CS PDCA',
  'AW4:AZ70',
  'global',
  'cell',
  'wow_ooo_rate',
  '[
    {"severity":"good","when":{"any":[{"all":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.005}},{"left":{"metric":"value"},"op":"lte","right":{"value":0.06}}]},{"left":{"metric":"value"},"op":"lt","right":{"value":0.001}}]},"label":"OOO rate normal","message":"OOO rate is in legacy normal range."},
    {"severity":"warning","when":{"any":[{"left":{"metric":"value"},"op":"gt","right":{"value":0.06}},{"all":[{"left":{"metric":"value"},"op":"gte","right":{"value":0.001}},{"left":{"metric":"value"},"op":"lt","right":{"value":0.005}}]}]},"label":"OOO rate warning","message":"OOO rate is outside legacy normal range."}
  ]'::jsonb,
  null,
  53,
  true,
  'Legacy sheet treats OOO rate under 0.10% as green. Verify business intent.'
),
(
  'wow_negative_response_rate',
  'WoW Negative Response Rate',
  'Tracks negative-rate threshold.',
  'client',
  'clients_wow',
  'wow_negative_rate',
  'CS PDCA',
  'BA4:BD70',
  'global',
  'cell',
  'wow_negative_rate',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"lte","right":{"value":0.02}},"label":"Negative rate healthy","message":"Negative response rate is within healthy range."},
    {"severity":"warning","when":{"left":{"metric":"value"},"op":"gt","right":{"value":0.02}},"label":"Negative rate elevated","message":"Negative response rate is above 2%."}
  ]'::jsonb,
  null,
  54,
  true,
  null
),
(
  'wow_sql_vs_monthly_lead_kpi_weekly_target',
  'WoW SQL vs Weekly KPI Target',
  'Compares current-week SQL against monthly KPI / 4.',
  'client',
  'clients_wow',
  'wow_sql',
  'CS PDCA',
  'BI4:BL70',
  'global',
  'cell',
  'wow_sql',
  '[
    {"severity":"good","when":{"left":{"metric":"wow_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi","multiplier":0.25}},"label":"WoW SQL on weekly target","message":"Current-week SQL meets weekly target."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"wow_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi","multiplier":0.2}},{"left":{"metric":"wow_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi","multiplier":0.25}}]},"label":"WoW SQL slightly below target","message":"Current-week SQL is between 80% and 99% of weekly target."},
    {"severity":"danger","when":{"left":{"metric":"wow_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi","multiplier":0.2}},"label":"WoW SQL below target","message":"Current-week SQL is below 80% of weekly target."}
  ]'::jsonb,
  null,
  55,
  true,
  null
),
(
  'mom_sql_vs_monthly_lead_kpi',
  'MoM SQL vs Lead KPI',
  'Compares current-month SQL against monthly SQL KPI.',
  'client',
  'clients_mom',
  'mom_sql',
  'CS PDCA',
  'BX4:CA70',
  'global',
  'cell',
  'mom_sql',
  '[
    {"severity":"good","when":{"left":{"metric":"mom_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi"}},"label":"MoM SQL on target","message":"Current-month SQL meets monthly KPI."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"mom_sql"},"op":"gte","right":{"metric":"monthly_sql_kpi","multiplier":0.8}},{"left":{"metric":"mom_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi"}}]},"label":"MoM SQL slightly below target","message":"Current-month SQL is between 80% and 99% of KPI."},
    {"severity":"danger","when":{"left":{"metric":"mom_sql"},"op":"lt","right":{"metric":"monthly_sql_kpi","multiplier":0.8}},"label":"MoM SQL below target","message":"Current-month SQL is below 80% of KPI."}
  ]'::jsonb,
  null,
  60,
  true,
  null
),
(
  'mom_meetings_vs_meeting_kpi',
  'MoM Meetings vs Meeting KPI',
  'Compares current-month meetings against monthly meetings KPI.',
  'client',
  'clients_mom',
  'mom_meetings',
  'CS PDCA',
  'CC4:CF70',
  'global',
  'cell',
  'mom_meetings',
  '[
    {"severity":"good","when":{"left":{"metric":"mom_meetings"},"op":"gte","right":{"metric":"monthly_meeting_kpi"}},"label":"MoM meetings on target","message":"Current-month meetings meet monthly KPI."},
    {"severity":"warning","when":{"all":[{"left":{"metric":"mom_meetings"},"op":"gte","right":{"metric":"monthly_meeting_kpi","multiplier":0.8}},{"left":{"metric":"mom_meetings"},"op":"lt","right":{"metric":"monthly_meeting_kpi"}}]},"label":"MoM meetings slightly below target","message":"Current-month meetings are between 80% and 99% of KPI."},
    {"severity":"danger","when":{"left":{"metric":"mom_meetings"},"op":"lt","right":{"metric":"monthly_meeting_kpi","multiplier":0.8}},"label":"MoM meetings below target","message":"Current-month meetings are below 80% of KPI."}
  ]'::jsonb,
  null,
  61,
  true,
  null
),
(
  'mom_won_vs_won_kpi',
  'MoM Won vs Won KPI',
  'Disabled until monthly_won_kpi source exists.',
  'client',
  'clients_mom',
  'mom_won',
  'CS PDCA',
  'CH4:CK70',
  'global',
  'cell',
  'mom_won',
  '[
    {"severity":"good","when":{"left":{"metric":"mom_won"},"op":"gte","right":{"metric":"monthly_won_kpi"}},"label":"MoM won on target","message":"Current-month won meets monthly won KPI."},
    {"severity":"danger","when":{"left":{"metric":"mom_won"},"op":"lt","right":{"metric":"monthly_won_kpi"}},"label":"MoM won below target","message":"Current-month won is below monthly won KPI."}
  ]'::jsonb,
  null,
  62,
  false,
  'Disabled: monthly_won_kpi is not mapped in current schema.'
),
(
  'min_sent_required',
  'Min Sent Is Required',
  'Active clients must have min sent configured.',
  'client',
  'clients_setup',
  'min_sent',
  'CS PDCA',
  'Q4:Q16 Q18:Q20 Q23 Q31:Q36',
  'global',
  'cell',
  'min_sent',
  '[
    {"severity":"danger","when":{"left":{"metric":"min_sent"},"op":"is_blank"},"label":"Min sent missing","message":"Minimum daily sent is required for active clients."}
  ]'::jsonb,
  '{"left":{"metric":"client.status"},"op":"eq","right":{"value":"Active"}}'::jsonb,
  70,
  true,
  null
),
(
  'spreadsheet_or_workspace_ids_present',
  'Workspace ID Present',
  'Checks for workspace identifier presence.',
  'client',
  'clients_setup',
  'client.external_workspace_id',
  'CS PDCA',
  'D4:F70',
  'global',
  'cell',
  'spreadsheet_or_workspace_id',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"not_blank"},"label":"Workspace ID present","message":"Workspace identifier is present."},
    {"severity":"warning","when":{"left":{"metric":"value"},"op":"is_blank"},"label":"Workspace ID missing","message":"Workspace identifier is missing."}
  ]'::jsonb,
  null,
  71,
  true,
  'Mapped to clients.external_workspace_id only; spreadsheet-id source not present in schema.'
),
(
  'report_or_folder_link_present',
  'Report/Folder Link Starts with HTTP',
  'Disabled until report link field is available in schema.',
  'client',
  'clients_setup',
  'report_or_folder_link',
  'CS PDCA',
  'H4:I70',
  'global',
  'cell',
  'report_or_folder_link',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"starts_with","right":{"value":"http"}},"label":"Report link valid","message":"Report or folder link starts with http."}
  ]'::jsonb,
  null,
  72,
  false,
  'Disabled: no canonical report_or_folder_link field in current schema.'
),
(
  'folder_link_present',
  'Folder Link Starts with HTTP',
  'Disabled until folder_link field is available in schema.',
  'client',
  'clients_setup',
  'folder_link',
  'CS PDCA',
  'L4:L70',
  'global',
  'cell',
  'folder_link',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"starts_with","right":{"value":"http"}},"label":"Folder link valid","message":"Folder link starts with http."}
  ]'::jsonb,
  null,
  73,
  false,
  'Disabled: no canonical folder_link field in current schema.'
),
(
  'issues_ok',
  'Issues Starts with OK',
  'Disabled until dedicated issues field exists.',
  'client',
  'clients_setup',
  'issues',
  'CS PDCA',
  'R4:R70',
  'global',
  'cell',
  'issues',
  '[
    {"severity":"good","when":{"left":{"metric":"value","transform":"lower"},"op":"starts_with","right":{"value":"ok"}},"label":"Issues marked OK","message":"Issues text starts with OK."}
  ]'::jsonb,
  null,
  74,
  false,
  'Disabled: issues source is ambiguous in current schema.'
),
(
  'bi_setup_required',
  'BI Setup Required',
  'Flags clients where BI setup is not confirmed.',
  'client',
  'clients_setup',
  'bi_setup',
  'CS PDCA',
  'K10:K11 K13 K15 K18:K19 K23 K25 K31 K33:K34 K36',
  'global',
  'cell',
  'bi_setup',
  '[
    {"severity":"warning","when":{"left":{"metric":"value"},"op":"neq","right":{"value":true}},"label":"BI setup missing","message":"BI setup is not confirmed as complete."}
  ]'::jsonb,
  null,
  75,
  true,
  null
),
(
  'checkbox_true_green',
  'Checkbox TRUE Is Green',
  'Disabled generic spreadsheet formatting rule.',
  'client',
  'clients_setup',
  'boolean_config_flag',
  'CS PDCA',
  'K4:K36 CV4:CV43 CX4:DF70 K38:K43',
  'global',
  'cell',
  'boolean_config_flag',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"eq","right":{"value":true}},"label":"Checkbox enabled","message":"Boolean flag is enabled."}
  ]'::jsonb,
  null,
  76,
  false,
  'Disabled: generic checkbox formatting should be split into field-specific rules.'
),
(
  'auto_li_api_key_present',
  'Auto-LI API Key Present',
  'Checks if auto-LI API key is configured.',
  'client',
  'clients_setup',
  'auto_li_api_key',
  'CS PDCA',
  'CY4:CY102',
  'global',
  'cell',
  'auto_li_api_key',
  '[
    {"severity":"good","when":{"left":{"metric":"value"},"op":"not_blank"},"label":"Auto-LI API key present","message":"Auto-LI API key is configured."},
    {"severity":"warning","when":{"left":{"metric":"value"},"op":"is_blank"},"label":"Auto-LI API key missing","message":"Auto-LI API key is missing."}
  ]'::jsonb,
  null,
  77,
  true,
  'Mapped to clients.linkedin_api_key.'
),
(
  'bp_text_warning',
  'Text Begins with BP',
  'Non-operational legacy formatting rule.',
  'client',
  'clients_setup',
  'text_value',
  'CS PDCA',
  'B1 A2:A70 B71:B970',
  'global',
  'cell',
  'text_value',
  '[
    {"severity":"danger","when":{"left":{"metric":"value"},"op":"starts_with","right":{"value":"BP"}},"label":"BP marker detected","message":"Text starts with BP."}
  ]'::jsonb,
  null,
  90,
  false,
  'Non-operational formatting from source sheet; disabled by default.'
)
on conflict (key)
do update
set
  name = excluded.name,
  description = excluded.description,
  target_entity = excluded.target_entity,
  surface = excluded.surface,
  metric_key = excluded.metric_key,
  source_sheet = excluded.source_sheet,
  source_range = excluded.source_range,
  scope_type = excluded.scope_type,
  client_id = excluded.client_id,
  manager_id = excluded.manager_id,
  apply_to = excluded.apply_to,
  column_key = excluded.column_key,
  branches = excluded.branches,
  base_filter = excluded.base_filter,
  priority = excluded.priority,
  enabled = excluded.enabled,
  notes = excluded.notes,
  updated_at = now();

commit;