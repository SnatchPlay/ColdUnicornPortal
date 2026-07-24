-- Retire the Smartlead sequencer from the catalog.
--
-- Smartlead was seeded as a load-bearing catalog entry in 20260704 but was never used: the agency
-- runs cold email through EmailBison and LinkedIn through Aimfox. Verified 2026-07-24 on production —
-- 0 campaigns and 0 leads reference the smartlead UUID (all attribute to emailbison/aimfox), and the
-- catalog row was already absent. This migration makes that state canonical and cleans any other
-- environment (local stacks seeded from 20260704) that still carries the row.
--
-- Idempotent and safe: the guard aborts instead of orphaning any campaign/lead. Because the FK is
-- ON DELETE RESTRICT, a delete would error anyway if the row were referenced — the explicit check
-- gives a legible message instead.

begin;

do $$
begin
  if exists (
    select 1 from public.campaigns where sequencer_id = '00000000-0000-4000-a000-000000000001'::uuid
    union all
    select 1 from public.leads     where sequencer_id = '00000000-0000-4000-a000-000000000001'::uuid
  ) then
    raise exception 'Cannot remove the smartlead sequencer: campaigns or leads still attribute to it. Re-attribute them first.';
  end if;

  delete from public.client_sequencers where sequencer_id = '00000000-0000-4000-a000-000000000001'::uuid;
  delete from public.sequencers        where id           = '00000000-0000-4000-a000-000000000001'::uuid;
end $$;

commit;
