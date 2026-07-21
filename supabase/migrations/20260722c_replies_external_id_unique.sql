-- The missing UNIQUE that every ingestion-idempotency claim already depends on.
--
-- docs/reference/functional/11-integrations.md §7 states: "Ingestion idempotency rests on UNIQUE
-- constraints: campaigns.external_id, replies.external_id, …". For `replies` that was not true —
-- the table has only replies_pkey plus four non-unique indexes (verified against a production dump
-- on 2026-07-21). Nothing enforced it, so a redelivered webhook could insert the same reply twice
-- and quietly inflate every reply-derived counter.
--
-- ADR-0015 makes this load-bearing: `public.upsert_reply` is defined as an idempotent
-- `on conflict (external_id) do update`, which Postgres cannot even plan without a matching unique
-- index. The doc is now accurate rather than aspirational.
--
-- FAILURE MODE IS DELIBERATE: if production already contains duplicate external_id values this
-- migration ABORTS with their count instead of quietly skipping the index. Skipping would leave
-- `upsert_reply` broken at runtime and the idempotency guarantee false. Resolving duplicates is a
-- data decision (which copy is canonical, what to do with the extra lead links), not something a
-- migration should guess. `external_id` is already NOT NULL, so no partial index is needed.

begin;

do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes
    from (
      select external_id
        from public.replies
       group by external_id
      having count(*) > 1
    ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot make replies.external_id unique: % duplicated value(s). Deduplicate first — see the header of %',
      v_dupes, '20260722c_replies_external_id_unique.sql';
  end if;
end $$;

create unique index if not exists replies_external_id_uk on public.replies (external_id);

comment on index public.replies_external_id_uk is
  'Ingestion idempotency key for replies (ADR-0015). public.upsert_reply''s ON CONFLICT target — do not drop.';

commit;
