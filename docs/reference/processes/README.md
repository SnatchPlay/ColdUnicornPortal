# Business processes

**Level 1** of the source-of-truth hierarchy ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md)).

A process document answers *what the rule is* — the lifecycle, the invariants, the states that may
not be reached. It is the thing an n8n workflow, a gateway action or a portal page must conform to,
and the thing that wins when they disagree.

## How this differs from what already exists

The repository already documents the product well, but not by process:

| If you want… | Read |
|---|---|
| "Should we build this?" | [BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md) — product scope, per role |
| "How does the code do it today?" | [reference/functional/](../functional/INDEX.md) — per page, table, metric |
| "Why is it like this?" | [docs/ADR.md](../../ADR.md) |
| **"What is the rule, end to end, across portal + database + automation?"** | **here** |

A process cuts *across* those files: one process touches several tables, a gateway action, a portal
surface, a metric and one or more n8n workflows. Before this folder existed there was no single place
that stated the OOO lifecycle — which is how a production workflow came to contradict
[ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) without anyone noticing.

**Do not duplicate.** A process document *links* to the data model and metrics catalog; it does not
restate them. If you find yourself copying a column list, link instead.

## Structure

```
processes/<domain>/<process>.md
```

Current domains: `outreach`.

## Template

Business purpose · Definitions · Triggering events · Preconditions · Main flow · Alternative flows ·
Cancellation and terminal states · Business invariants · Data ownership · Database entities ·
RPC/API contracts · Portal surfaces · Dashboard metrics · Related n8n workflows · Failure handling ·
Security considerations · Acceptance criteria · Related ADRs

Omit a section only when it genuinely does not apply, and say so — an empty "Security considerations"
should read "none beyond RLS", not vanish.

**Record divergence.** Where the live implementation does not yet match the rule, say so explicitly
under "Related n8n workflows" with a link to the backlog. A process document that describes an
intended state as though it were live is worse than none: it is the exact failure this folder exists
to prevent.

## Index

| Process | Domain | Status |
|---|---|---|
| [OOO follow-ups (and NRR)](outreach/ooo-followups.md) | outreach | contract accepted; n8n cutover pending |

## Traceability

Each process is linked to its tables, RPCs, portal surfaces, metrics, workflows and tests in
[traceability.md](../traceability.md).
