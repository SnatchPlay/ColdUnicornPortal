-- Seed the OOO routing chain from the ARM sheet, and stop OOO follow-up campaigns being
-- client-visible (ADR-0015, ADR-0017 precondition 5; docs/reference/n8n/ooo-phase-a.md).
--
-- Source of the mapping: the `ARM` tab of the "Automated Replies Management" spreadsheet, which is
-- what the live `Add OOO Leads` workflow (zaPkpSAuvjibUUDU) reads today. Exported read-only on
-- 2026-07-21 and transcribed here as literals, so this migration is reviewable and reproducible
-- without Google access.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY PART 1 IS A BUG FIX, NOT JUST PREPARATION
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Clients see exactly `campaigns.type = 'outreach'` — enforced in RLS
-- (20260601b_leads_campaigns_replies_rls_set_based.sql, "campaigns_select_scoped") and again in
-- scopeCampaigns() (src/app/lib/selectors.ts). ADR-0003.
--
-- 25 campaigns named "OOO automation | male|female|general" are typed `outreach`, so 9 clients can
-- currently see their own OOO follow-up campaigns in the portal, and those campaigns'
-- campaign_daily_stats (3645 rows, 2026-01-22..2026-07-19, 121 sent / 20 replies) are counted in
-- client-facing campaign metrics. ADR-0015 §"campaigns" and 11-integrations §5 both state these
-- must be `ooo_followup` and invisible to clients.
--
-- Campaigns are pinned by external_id rather than matched on name: a LIKE over campaign names is
-- not something a migration should decide on.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- KNOWN INCOMPLETENESS (reported, not guessed)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- * ARM lists 16 Bison workspaces; 14 resolve to an enabled client_sequencers row. Workspaces
--   '75' and '130' do not, so 6 of the 48 routing rows cannot be created. They are reported by the
--   NOTICE below rather than being invented — a placeholder client_sequencer would be a guess about
--   which client owns that workspace.
-- * external_ids 365, 629, 630, 631 are OOO campaigns by name but appear in no ARM row. They are
--   reclassified (part 1) so they stop being client-visible, but get no routing: nothing routes to
--   them today, and inventing a mapping would be worse than leaving them unrouted.
-- * clients.auto_ooo_enabled is NOT touched here. It gates record_ooo_followup, so flipping it
--   changes what the new write path records — that belongs to the phase A cutover, with its own
--   decision, not to a seed migration.

begin;

-- ── 1. OOO follow-up campaigns stop being client-visible ──────────────────────────────────────
update public.campaigns
set type = 'ooo_followup'
where external_id in (
    '352', '365', '370', '371', '597', '598', '600', '602', '604', '605', '606', '607',
    '608', '610', '611', '612', '613', '614', '615', '629', '630', '631', '632', '633',
    '634', '931', '932', '933', '934', '935', '936', '937', '938', '939', '940', '941',
    '942', '943', '944', '945', '947', '948', '949', '950', '951', '952', '953', '954',
    '955', '956', '957', '958'
  )
  and type <> 'ooo_followup';

-- ── 2. Routing rules, from the ARM sheet ──────────────────────────────────────────────────────
-- routing_key is the explicit male|female|general of ADR-0015 §7; the legacy `gender` column is
-- left NULL (it is dropped by the deferred 20260722z).
with arm(workspace_id, routing_key, campaign_external_id) as (
  values
    ('2', 'female', '370'),
    ('2', 'general', '371'),
    ('2', 'male', '352'),
    ('5', 'female', '602'),
    ('5', 'general', '605'),
    ('5', 'male', '604'),
    ('11', 'female', '597'),
    ('11', 'general', '600'),
    ('11', 'male', '598'),
    ('12', 'female', '632'),
    ('12', 'general', '634'),
    ('12', 'male', '633'),
    ('36', 'female', '606'),
    ('36', 'general', '608'),
    ('36', 'male', '607'),
    ('55', 'female', '610'),
    ('55', 'general', '612'),
    ('55', 'male', '611'),
    ('73', 'female', '937'),
    ('73', 'general', '939'),
    ('73', 'male', '938'),
    ('75', 'female', '953'),
    ('75', 'general', '955'),
    ('75', 'male', '954'),
    ('76', 'female', '940'),
    ('76', 'general', '942'),
    ('76', 'male', '941'),
    ('77', 'female', '613'),
    ('77', 'general', '615'),
    ('77', 'male', '614'),
    ('94', 'female', '956'),
    ('94', 'general', '958'),
    ('94', 'male', '957'),
    ('100', 'female', '936'),
    ('100', 'general', '934'),
    ('100', 'male', '935'),
    ('113', 'female', '945'),
    ('113', 'general', '943'),
    ('113', 'male', '944'),
    ('123', 'female', '931'),
    ('123', 'general', '933'),
    ('123', 'male', '932'),
    ('125', 'female', '952'),
    ('125', 'general', '950'),
    ('125', 'male', '951'),
    ('130', 'female', '947'),
    ('130', 'general', '949'),
    ('130', 'male', '948')
)
insert into public.client_ooo_routing (client_id, routing_key, campaign_id, is_active)
select cs.client_id, arm.routing_key, c.id, true
from arm
join public.client_sequencers cs
  on cs.external_workspace_id = arm.workspace_id
 and cs.enabled
join public.campaigns c
  on c.external_id = arm.campaign_external_id
on conflict do nothing;

-- ── 3. Report what could not be seeded ────────────────────────────────────────────────────────
do $$
declare
  v_campaigns  integer;
  v_routes     integer;
  v_unmatched  text;
begin
  select count(*) into v_campaigns from public.campaigns where type = 'ooo_followup';
  select count(*) into v_routes    from public.client_ooo_routing where is_active;

  select string_agg(distinct ws, ', ' order by ws)
    into v_unmatched
  from (values ('75'), ('130')) as t(ws)
  where not exists (
    select 1 from public.client_sequencers cs
    where cs.external_workspace_id = t.ws and cs.enabled
  );

  raise notice 'ooo_followup campaigns: %', v_campaigns;
  raise notice 'active routing rules: % (expected 42 of 48 ARM rows)', v_routes;
  if v_unmatched is not null then
    raise notice 'ARM workspaces with no enabled client_sequencers row, NOT seeded: %', v_unmatched;
  end if;
end $$;

commit;
