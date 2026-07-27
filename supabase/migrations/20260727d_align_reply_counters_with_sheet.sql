-- Align human_replies_count / ooo_count with CS PDCA for 2026-07-13 .. 2026-07-26.
--
-- WHY. Both stores compute these two columns the same broken way — `total_now - total_stored_yesterday`
-- of an UNDATED lifetime counter read from `/api/replies?...&folder=inbox` — and they poll it at
-- different moments, so they manufacture different "day" counts from the same facts. Up to and
-- including the week of 2026-07-06 the two agreed exactly. From 2026-07-13 they diverge, which lines
-- up with the ingestion outage around 2026-07-20 and the backfill that repaired it: a delta recomputed
-- against a baseline that had already moved.
--
-- WHAT THIS IS NOT. It does not make the numbers correct. Measured over the last 30 days across all
-- active clients, the lifetime counter is non-monotonic in BOTH stores — 17 backward steps in Supabase,
-- 9 in the sheet — because an inbox shrinks when a reply is archived and the `max(delta, 0)` clamp in
-- both writers discards the drop without resetting the baseline. This aligns onto the less-damaged of
-- two damaged series so the portal and CS PDCA stop disagreeing in front of the team. Under ADR-0017
-- that is an explicit phase-A statement: for these two columns, in this window, the sheet is
-- authoritative. The real repair is reconstruction from Bison pagination, which is complete and
-- self-validating against `line-area-chart-stats` — see docs/reference/n8n/ooo-true-count.md.
--
-- WINDOW ENDS 2026-07-26, NOT TODAY. The snapshot was taken mid-afternoon on 2026-07-27, so its rows
-- for that date are a partial day. Applying them would overwrite live counters with staler ones — the
-- first dry-run did exactly that and pushed UniTalk's current-week Human RR from 2.4% to 1.3%, away
-- from CS PDCA rather than towards it. Completed days only.
--
-- SCOPE. 75 (workspace, date) rows where the two stores actually disagree, from the snapshot committed
-- at automation/sheets/pdca/extracts/2026-07-27/daily-stats.csv. Rows that already agree are not listed,
-- so this file is exactly the change. Sums: human 742 -> 340, ooo 1892 -> 911.
--
-- `automated_replies_count` is set alongside `ooo_count`. The two are byte-identical by construction
-- (both are `automatedRepliesTotal - prevTotal`); updating one and not the other would leave the row
-- internally inconsistent for the first time.
--
-- IDEMPOTENT: assigns absolute values, so a second run changes nothing. NOT self-healing: the ingestion
-- worker keeps writing its own deltas, so a future backfill of these dates would overwrite this. That is
-- accepted — this repairs a bounded incident, it does not install a sync.

begin;

with sheet(workspace_id, report_date, human_replies, automated_replies) as (
  values
    ('100', '2026-07-13'::date, 7, 19),
    ('100', '2026-07-14'::date, 4, 12),
    ('100', '2026-07-20'::date, 3, 4),
    ('100', '2026-07-21'::date, 0, 0),
    ('100', '2026-07-22'::date, 1, 0),
    ('100', '2026-07-23'::date, 0, 1),
    ('11', '2026-07-13'::date, 9, 18),
    ('11', '2026-07-14'::date, 1, 14),
    ('11', '2026-07-20'::date, 3, 7),
    ('11', '2026-07-21'::date, 4, 3),
    ('11', '2026-07-23'::date, 7, 9),
    ('11', '2026-07-24'::date, 0, 7),
    ('113', '2026-07-15'::date, 0, 0),
    ('113', '2026-07-20'::date, 0, 0),
    ('116', '2026-07-14'::date, 3, 20),
    ('116', '2026-07-15'::date, 5, 15),
    ('116', '2026-07-16'::date, 2, 10),
    ('116', '2026-07-20'::date, 3, 26),
    ('116', '2026-07-21'::date, 1, 18),
    ('12', '2026-07-20'::date, 2, 15),
    ('12', '2026-07-21'::date, 4, 7),
    ('12', '2026-07-23'::date, 7, 9),
    ('12', '2026-07-24'::date, 7, 12),
    ('123', '2026-07-15'::date, 6, 5),
    ('123', '2026-07-16'::date, 2, 3),
    ('123', '2026-07-17'::date, 2, 10),
    ('123', '2026-07-20'::date, 8, 6),
    ('123', '2026-07-21'::date, 5, 4),
    ('123', '2026-07-22'::date, 5, 1),
    ('123', '2026-07-23'::date, 5, 2),
    ('125', '2026-07-15'::date, 6, 19),
    ('125', '2026-07-20'::date, 4, 17),
    ('125', '2026-07-21'::date, 3, 11),
    ('125', '2026-07-22'::date, 5, 12),
    ('130', '2026-07-15'::date, 2, 7),
    ('130', '2026-07-16'::date, 0, 5),
    ('2', '2026-07-13'::date, 10, 43),
    ('2', '2026-07-14'::date, 10, 33),
    ('2', '2026-07-15'::date, 5, 13),
    ('2', '2026-07-16'::date, 11, 14),
    ('2', '2026-07-17'::date, 2, 11),
    ('2', '2026-07-20'::date, 2, 18),
    ('2', '2026-07-21'::date, 5, 18),
    ('2', '2026-07-23'::date, 3, 7),
    ('2', '2026-07-24'::date, 0, 1),
    ('36', '2026-07-13'::date, 20, 24),
    ('36', '2026-07-14'::date, 19, 57),
    ('36', '2026-07-15'::date, 15, 43),
    ('36', '2026-07-16'::date, 14, 35),
    ('36', '2026-07-17'::date, 7, 15),
    ('36', '2026-07-20'::date, 19, 19),
    ('36', '2026-07-21'::date, 5, 19),
    ('36', '2026-07-22'::date, 9, 18),
    ('36', '2026-07-24'::date, 14, 26),
    ('55', '2026-07-20'::date, 3, 22),
    ('55', '2026-07-21'::date, 3, 18),
    ('55', '2026-07-22'::date, 2, 10),
    ('55', '2026-07-23'::date, 1, 7),
    ('55', '2026-07-24'::date, 4, 14),
    ('73', '2026-07-13'::date, 0, 7),
    ('73', '2026-07-14'::date, 4, 3),
    ('73', '2026-07-20'::date, 1, 10),
    ('73', '2026-07-21'::date, 1, 11),
    ('73', '2026-07-22'::date, 1, 10),
    ('73', '2026-07-23'::date, 3, 5),
    ('76', '2026-07-20'::date, 1, 3),
    ('76', '2026-07-21'::date, 0, 1),
    ('77', '2026-07-20'::date, 6, 11),
    ('77', '2026-07-21'::date, 0, 1),
    ('89', '2026-07-20'::date, 3, 4),
    ('89', '2026-07-21'::date, 0, 0),
    ('94', '2026-07-13'::date, 9, 14),
    ('94', '2026-07-14'::date, 0, 12),
    ('94', '2026-07-20'::date, 1, 5),
    ('94', '2026-07-21'::date, 1, 1)
)
update public.daily_stats d
   set human_replies_count     = s.human_replies,
       ooo_count               = s.automated_replies,
       automated_replies_count = s.automated_replies
  from sheet s
  join public.client_sequencers cs
    on cs.external_workspace_id = s.workspace_id
  join public.sequencers seq
    on seq.id = cs.sequencer_id and seq.key = 'emailbison'
 where d.client_id = cs.client_id
   and d.report_date = s.report_date
   and (d.human_replies_count, d.ooo_count, d.automated_replies_count)
       is distinct from (s.human_replies, s.automated_replies, s.automated_replies);

commit;
