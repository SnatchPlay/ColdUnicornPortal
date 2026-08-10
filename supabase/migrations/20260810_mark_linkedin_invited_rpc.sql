-- One RPC so the AutoConnect import can stamp a lead without writing `leads` in raw SQL.
--
-- ADR-0015 makes `leads` an RPC-owned table, and `pnpm n8n:validate` enforces it: the first draft of
-- `aimfox-import-to-connection-shadow` updated `leads` directly and was refused. The validator
-- pointed at `promote_contact_to_lead`, which is the wrong tool — that CREATES a lead from a
-- positive reply. Nothing existed for "this lead has now been sent a LinkedIn connection request",
-- so this is that, and the rule stands rather than being suppressed.
--
-- Why the column matters: `leads.linkedin_invitation_sent_at` has existed and been written by
-- nothing (0 of 4995 rows on 2026-08-09). The Sheets branch of the import has no local dedup at all
-- — it re-reads yesterday every run and re-POSTs the batch, and whether Aimfox ignores a duplicate
-- profile in a campaign audience has never been verified. Owning this column is what makes a repeat
-- run safe by construction instead of by assumption.

begin;

create or replace function public.mark_linkedin_invited(p_lead_ids uuid[])
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with updated as (
    update public.leads
       set linkedin_invitation_sent_at = now()
     -- `is null` makes this idempotent: a lead already stamped keeps its first timestamp, so the
     -- record says when the invite actually went out, not when something last re-ran.
     where id = any(p_lead_ids)
       and linkedin_invitation_sent_at is null
    returning 1
  )
  select coalesce(count(*), 0)::int from updated;
$$;

comment on function public.mark_linkedin_invited(uuid[]) is
  'Stamps leads.linkedin_invitation_sent_at for leads whose LinkedIn profile was just added to an '
  'Aimfox campaign audience. Returns the number newly stamped. Idempotent: an already-stamped lead '
  'is left alone, so the timestamp records the first invite and a re-run cannot move it. '
  'Called by aimfox-import-to-connection (Supabase branch). ADR-0015 keeps leads RPC-owned.';

-- SECURITY DEFINER, so nothing but the roles named here may call it. `authenticated` is deliberately
-- absent: no portal surface sends LinkedIn invites, and an RPC that marks leads as contacted has no
-- business being reachable from a browser session.
revoke all on function public.mark_linkedin_invited(uuid[]) from public;
grant execute on function public.mark_linkedin_invited(uuid[]) to service_role;

commit;
