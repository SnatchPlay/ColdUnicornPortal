-- Record what workspace provisioning last observed, per client per sequencer.
--
-- Until now nothing in the database said whether a client's Aimfox/Bison workspace was actually
-- wired. The answer existed only at the vendor, and only for whoever went to look. That is how
-- FortumEnergia sat without the `preMQL` label (so no preMQL lead could ever be created there) and
-- GIC without `MQL` — both found by hand on 2026-08-07, both invisible from the portal.
--
-- These two columns are where `aimfox-workspace-setup` / `bison-workspace-setup` leave their
-- verdict, and the only thing the portal reads to answer "is this client configured".
-- Process: docs/reference/processes/ops/workspace-provisioning.md
-- Result contract: automation/n8n/workflows/ops/aimfox-workspace-setup/contracts/setup-result.schema.json
--
-- No queue table and no scheduler: the status is refreshed only when setup is actually run
-- (decided 2026-08-07 — a nightly drift check was considered and rejected). `setup_checked_at`
-- is therefore load-bearing: a stale timestamp is the honest answer, a fresh-looking `{}` is not.
--
-- RLS is untouched. `client_sequencers` carries table-level policies keyed on
-- private.can_manage_client(client_id), so the new columns inherit exactly the same scoping as
-- api_key already has. Measured with EXPLAIN (ANALYZE, BUFFERS) as the `authenticated` role — a
-- real JWT sub per role, never superuser — on the loadClientsOverview select
-- (supabase/functions/orm-gateway/index.ts:1504). Local stack, 48 rows, median of 3 warm runs,
-- the same query with and without the two new columns:
--
--   role      rows   9 columns   11 columns
--   admin       48     1.98 ms      1.60 ms
--   manager      3     3.05 ms      2.67 ms
--   client       0     2.81 ms      2.40 ms   ← credentials stay invisible to the client role
--
-- Identical plan on both sides: Seq Scan + Filter: private.can_manage_client(client_id). The
-- differences are run-to-run noise on 48 rows, not an effect of the change (the very first cold
-- run of the session read 8.1 / 6.1 / 6.1 ms across all three roles, before any cache was warm).
-- Row counts per role are the number that matters here and they are unchanged.
--
-- The per-row predicate is deliberately left alone. ADR-0006 scopes the set-based rewrite to hot
-- tables; this one is two orders of magnitude below that line, and converting it would be a
-- drive-by change to a policy this migration does not otherwise touch.
--
-- No `client` role exists in the local dump, so that row was measured against a synthetic client
-- user created and rolled back inside the probe transaction.

alter table public.client_sequencers
  add column setup_state      jsonb       not null default '{}'::jsonb,
  add column setup_checked_at timestamptz;

-- A scalar or an array here would mean a caller wrote the wrong shape; fail loudly at write time
-- rather than let the portal render nonsense.
alter table public.client_sequencers
  add constraint client_sequencers_setup_state_object
  check (jsonb_typeof(setup_state) = 'object');

comment on column public.client_sequencers.setup_state is
  'Last provisioning verdict for this client+sequencer, in the shape of setup-result.schema.json '
  'minus `candidates`: { state, resolved, steps, dry_run, ... }. `{}` means never checked — read '
  'setup_checked_at, not this, to tell "checked and empty" from "never checked". '
  'MUST NOT contain an api_key or any other secret: the gateway derives booleans from this and '
  'ships them to the browser, while the key stays server-side (process doc, invariant 7). '
  'Written only by the workspace-setup workflows; the portal never writes it.';

comment on column public.client_sequencers.setup_checked_at is
  'When setup last ran for this row, dry_run or not. NULL = never. There is no scheduled drift '
  'check by design, so this value ages and is meant to: the portal shows it so an operator can see '
  'that a "configured" verdict is six weeks old.';

-- A client with no row here has no connector at all — that is itself a provisioning state
-- ("missing"), not an absent one. Audytel spent weeks in it while three leads were dropped on the
-- floor, because nothing surfaced the difference between "not wired" and "not looked at".
comment on table public.client_sequencers is
  'One client''s credentials and provisioning state for one sequencer (ADR-0012). The absence of a '
  'row means the client is not connected to that sequencer — the portal must render that as '
  '"missing", never as "unknown".';
