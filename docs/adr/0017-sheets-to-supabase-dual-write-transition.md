# ADR 0017: Google Sheets → Supabase migration by dual-write

## Status
Accepted 2026-07-21

## Context

The agency's operations were **built on Google Sheets** — not as a staging hack, but as the real
system: client configuration, per-client API keys, daily counters, OOO tracking, dashboards and
reports all live in spreadsheets that people open and use every day. Automation ran in Make.com and
has since been rebuilt in n8n (33 workflows, 27 active). The portal in this repository is the move
from that model to something durable.

The migration is therefore **not** "delete the spreadsheets and switch to Postgres". Two facts make a
hard cutover unacceptable:

1. **The sheets are load-bearing today.** People read them. Dashboards and reports are built on them.
   Switching the write target in one step would blind the business the moment it shipped.
2. **The Supabase model is new and unexercised.** [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md)
   shipped the whole OOO model — tables, RPCs, RLS, ~70 invariant assertions — and `ooo_followups`
   has **0 rows** in production. Correct, tested, and never yet driven by a real event. Trusting it as
   the sole record before anything has flowed through it would be a guess.

The previous version of this repository's automation documentation treated every Sheets write as debt
to be deleted. That was wrong, and it mattered: it would have produced a cutover that removed the
business's working system in the same change that switched on an untested one.

## Decision

### 1. Every write path runs to both sources during the transition

For a process being migrated, n8n writes **Sheets and Supabase**, in that order, for one event.
This is a strangler-fig migration: the new system is built alongside the old, proven against it, and
only then does the old one lose its readers.

Three phases per process:

| Phase | Sheets | Supabase | Authoritative | Portal reads |
|---|---|---|---|---|
| **A · dual-write** | write | write | **Sheets** | Supabase (may be incomplete) |
| **B · parity** | write | write | **Supabase** | Supabase |
| **C · cutover** | — | write | Supabase | Supabase |

A process moves A → B only when a reconciliation shows the two agree; B → C only after the sheet has
no remaining readers. The phase is recorded per workflow in `manifest.yaml` (`transition.phase`), not
inferred.

### 1a. Dual-write is implemented as two fully parallel branches, not a shared prefix

Within a workflow the two paths are **independent end to end** — each resolves its own client, its
own routing, its own field mapping, and each issues its own calls to the sequencer API:

```
trigger ─┬─▶ [L] legacy branch    sheet lookup  → map from sheet columns   → Bison API
         └─▶ [S] supabase branch  RPC / SQL     → map from Postgres columns → Bison API
```

Two properties follow, and both are the point:

- **Cutover is a wire cut.** Phase C is "disconnect branch L", not a rewrite. Nothing that branch S
  needs is computed inside branch L, so removing L cannot break S.
- **The comparison is real.** Branch S exercises the whole path — resolution, mapping, API call —
  rather than a shared prefix with two endings. A shared prefix would prove only that two writers
  agree about data one of them already resolved.

The cost is duplicated work per event: two sheet/DB reads and two API calls where one would do. That
is accepted for the duration.

### 1b. The external side effect is the dangerous part of running two branches

Duplicating a *write to our own stores* is cheap. Duplicating a *call to the sequencer* is not: it
acts on a real contact. Two rules bound it.

**Same target ⇒ safe.** Bison's `attach-leads` silently ignores a contact already in the campaign
(the same property [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md) §4 relies on for
`submitted`). So both branches attaching the *same* lead to the *same* campaign is a no-op.

**Different target ⇒ harm.** If the two branches resolve different campaigns, the contact is enrolled
in **two follow-up sequences** and gets emailed twice. This is the failure mode of a parallel run and
it is not hypothetical: the routing sources are different objects (the `ARM` sheet vs
`client_ooo_routing`) that merely *ought* to agree.

Therefore phase A is split:

| | Branch S resolution + mapping | Branch S API call | Purpose |
|---|---|---|---|
| **A1 · shadow** | runs | **suppressed** — the request it *would* send is logged | prove the two branches resolve the same target |
| **A2 · live** | runs | fires | prove branch S can drive the process end to end |

A1 → A2 requires measured agreement on the resolved target, not a review of the code. The suppression
in A1 must be at the last node — build the exact request, then log instead of send — or the shadow
proves less than it appears to.

### 2. Supabase is written through the RPC contract, Sheets through its existing nodes

Dual-write does not weaken [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md) §5. The Supabase
side goes through the `SECURITY DEFINER` RPCs; the second write target does not license a raw
`INSERT` into `leads`. The invariants stay in the database precisely because there is now a second,
weaker store that has none.

### 3. The Supabase write must never be able to break the Sheets write

During phase A the business still runs on the sheet. So:

- **Sheets first, Supabase second.** A failure in the new path must not prevent the old one.
- **The Supabase write is non-fatal in phase A** — it uses n8n's error output, and a failure is
  recorded, not raised.
- **A failed Supabase write is visible**, not swallowed: it lands in `integration_sync_runs` (the
  existing per-run log, already n8n-owned and `service_role`-only) so divergence is measurable rather
  than discovered later.

In phase B this inverts: Supabase is authoritative, so its failure is the one that matters.

### 4. Both sides must be idempotent, independently

A retry must not duplicate on either store. Supabase already has this — `upsert_reply` on
`external_id`, and the two partial unique indexes on `ooo_followups`. **Sheets does not**: today's
OOO append is unconditional, so a redelivered event writes a second row. Dual-write makes this worse,
not better, because the two stores would then disagree by construction. Any sheet write brought into
dual-write must first become an append-or-update on a stable key.

### 5. Divergence is measured, not assumed

A process cannot leave phase A on the claim that it works. It needs a reconciliation — a query per
side, compared on the natural key, with the difference reported. Parity is the entry condition for
phase B, and the number is recorded in the manifest.

### 6. ADR-0001 is scoped, not contradicted

[ADR-0001](0001-live-supabase-source-of-truth.md) says *frontend runtime contracts* follow the live
Supabase project. That is unaffected: **the portal never reads Google Sheets, in any phase.** What
this ADR adds is that during the transition an n8n workflow may write a second, non-authoritative
store. The summary line in [CLAUDE.md](../../CLAUDE.md) §4 ("the only data system") is tightened to
say "the only data system the **portal** reads".

## Alternatives considered

- **Hard cutover per process.** Rejected — see Context: it removes a working system and switches on an
  unexercised one in a single step, with no measurement in between.
- **Backfill the sheet history into Supabase, then cut over.** Rejected as the primary mechanism: a
  backfill proves the old data can be copied, not that the new write path works under live events.
  Useful *after* dual-write proves the path, not instead of it.
- **Dual-write with Supabase first.** Rejected for phase A: it puts the untested store in front of the
  one the business depends on.
- **Write to Supabase and mirror out to Sheets from Postgres** (trigger or scheduled export).
  Genuinely attractive — one write path, one source of truth, sheets as a pure projection — and it is
  the likely end state for *reporting* sheets. Rejected for phase A because it makes the untested
  store authoritative from day one, which is the risk this ADR exists to avoid. Reconsider at phase C.

## Consequences

- Every migrating workflow gets **more** complexity, not less, for the duration. This is the price of
  not being blind during the switch, and it is temporary — phase C removes it.
- `manifest.yaml` gains a `transition` block (phase, authoritative source, reconciliation query,
  parity evidence). `pnpm n8n:validate` checks that a workflow declaring a Sheets **and** a Supabase
  write also declares its phase and authoritative source — a silent dual-write is the dangerous kind.
- The OOO family is the first process through this, and is currently at **phase 0** — Sheets only,
  Supabase never written. See [migration-backlog §1](../reference/n8n/migration-backlog.md#1-ooo-cutover).
- `20260722z_drop_legacy_ooo_columns.sql` is unblocked by phase A, not phase C: it drops legacy
  *lead* columns, which no phase writes.
- Per-client Bison API keys living in the CS PDCA sheet are **not** covered by this ADR. Credentials
  are not business data; they move to `client_sequencers.api_key` independently, and sooner
  ([security.md §1](../reference/n8n/security.md)).

## Related
- [ADR-0001](0001-live-supabase-source-of-truth.md) — scoped by §6 above.
- [ADR-0015](0015-sequencer-contacts-and-ooo-followups.md) — the Supabase-side contract dual-write targets.
- [ADR-0016](0016-repository-as-automation-source-of-truth.md) — why the workflow is the artifact this is expressed in.
- [Process · OOO follow-ups](../reference/processes/outreach/ooo-followups.md) — the first process to migrate.
