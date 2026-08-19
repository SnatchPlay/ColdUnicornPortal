-- client_ooo_routing: make it structurally impossible to route one client's OOO follow-ups into
-- another client's campaign.
--
-- Why. Found on 2026-08-15 by the first controlled run of the phase-B OOO enrolment worker, which
-- got back `403 - the api key does not match the workspace the record is on`. The key was not stale:
-- all three of FortumEnergia's routing rows (male, female, general) pointed at GIC's campaigns
-- 951 / 952 / 950. Every client's campaigns are named identically — "OOO automation | male" and so
-- on — so in a campaign picker that is not scoped to one client, the wrong row is indistinguishable
-- from the right one. FortumEnergia had no OOO campaigns of its own, so there was no correct row to
-- pick. 95 episodes were routed that way.
--
-- What stopped an actual leak was luck of the right kind: the worker authenticates with the
-- CONTACT's workspace key, and Bison refused the cross-workspace write. Had the two clients shared a
-- workspace, one client's contacts would have been enrolled into another client's follow-up sequence
-- and mailed from that client's senders. The legacy sheet-driven branch had the same exposure and
-- could never have shown it — it died at the first request and recorded nothing.
--
-- The hole was structural, not clerical: the table had independent foreign keys to `clients` and to
-- `campaigns`, and nothing tied `campaigns.client_id` to `client_ooo_routing.client_id`. The pair was
-- unconstrained, so the same mistake could be made again from the portal, from n8n, or from psql.
--
-- The fix is declarative rather than a trigger: a composite foreign key can only be satisfied by a
-- campaign that belongs to the same client, and Postgres enforces it on every write path at once.
-- UNIQUE (id, client_id) on `campaigns` is redundant as a uniqueness claim (`id` is already the
-- primary key) and exists solely to be the target of that composite key.
--
-- Prerequisite, already done: the three FortumEnergia rows were deleted and their 95 live episodes
-- parked via skip_ooo_followup(..., 'routing_missing') — not by raw DML, and deliberately not simply
-- dropped. `routing_missing` is the one skip reason recover_skipped_ooo_followups resurrects, so the
-- moment real routing exists for that client, those episodes come back on their own.
--
-- Verified on 2026-08-15 against production in a rolled-back transaction: the constraint applies to
-- the live data, a cross-client insert is rejected, and a same-client insert still succeeds.
--
-- ADR-0003 (client visibility is enforced in the data layer, not only in the UI)
-- ADR-0015 (the OOO episode lifecycle is owned by the database)

alter table public.campaigns
  add constraint campaigns_id_client_id_key unique (id, client_id);

alter table public.client_ooo_routing
  drop constraint if exists client_ooo_routing_campaign_id_fkey;

alter table public.client_ooo_routing
  add constraint client_ooo_routing_campaign_same_client_fkey
  foreign key (campaign_id, client_id)
  references public.campaigns (id, client_id);
