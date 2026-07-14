# ADR 0011: Conditions Rules Engine (Stored JSON DSL)

## Status

Accepted 2026-07-14 (records a decision already shipped; written retroactively).

## Context

CS managers need the clients table to *tell them where to look*: highlight a client whose reply
rate collapsed, flag a campaign that stopped sending, colour a cell red when a KPI misses target.
The rules behind those highlights are **operational policy**, not product logic — they change as
the agency's playbook changes, and different clients/managers need different thresholds.

Hardcoding them in TSX would mean a deploy per threshold tweak and no per-client variation. But
the obvious "make it configurable" answers are all traps:

- A **formula string** field (`"reply_rate < 0.02"`) means shipping an expression parser and
  evaluator, and every stored rule becomes an injection/eval surface.
- **SQL predicates** stored in a table would let a rule read anything RLS allows, and would have to
  run server-side, defeating the point (the values being compared are already on the client, in the
  computed metrics).

## Decision

Condition rules are rows in `condition_rules` holding a **structured JSON DSL**, evaluated on the
client by a pure interpreter. There is no formula string, no `eval`, no SQL.

- **The DSL is a typed tree** ([`lib/conditions/types.ts`](../../src/app/lib/conditions/types.ts)):
  a `ConditionComparisonNode` is `{ left, op, right }` where each side is a `ConditionValueRef`
  (`{ value }` — a literal, or `{ metric }` — a key from the metric catalogue, with optional
  `multiplier`/`transform`). Nodes compose through `all` / `any` groups. The operator set is a
  closed union (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_blank`, `not_blank`,
  `starts_with`, `not_starts_with`, `in`, `not_in`) — a rule can only say things the union can
  express.
- **`metric` is a key, not an expression.** Every referenceable value is registered in
  [`lib/conditions/metric-catalog.ts`](../../src/app/lib/conditions/metric-catalog.ts). A rule
  cannot reach a column that the catalogue does not expose, which keeps the blast radius of a
  malformed rule to "renders nothing" rather than "reads anything".
- **The evaluator is pure** ([`lib/conditions/evaluator.ts`](../../src/app/lib/conditions/evaluator.ts)):
  `(rule, context) → ConditionEvaluationResult`. No I/O, no data access — it is handed a context
  object built from metrics the page already computed. That makes it exhaustively unit-testable
  (`lib/conditions/__tests__/`).
- **Rules carry presentation intent, not presentation code**: `severity`
  (`good | info | warning | danger | critical_over`) and `apply_to`
  (`row | cell | badge | section`). The UI maps severity → the status CSS classes documented in
  [design-system.md](../reference/design-system.md); a rule can never inject a class or a colour.
- **Scoping** is `global | client | manager` (`ConditionScopeType`), so the same engine serves the
  agency-wide playbook and per-client overrides.
- **Validation at the boundary**: [`lib/conditions/validation.ts`](../../src/app/lib/conditions/validation.ts)
  validates the tree before it is stored, so an invalid rule cannot be persisted from the builder
  UI ([`pages/settings/condition-rule-builder.tsx`](../../src/app/pages/settings/condition-rule-builder.tsx)).

## Alternatives considered

- **Formula strings + an expression parser.** Rejected: a parser/evaluator is a security and
  maintenance liability, error messages are poor, and the builder UI cannot offer a safe
  autocomplete over free text.
- **SQL predicates evaluated server-side.** Rejected: the compared values are derived metrics that
  exist only after client-side computation; pushing them back to SQL means duplicating the metric
  layer in the database.
- **Hardcoded rules in the page.** Rejected: a deploy per threshold change, and no per-client
  scoping.
- **A generic rules library (json-logic, etc.).** Rejected: their operator sets are open-ended and
  untyped at the edges; the closed union + metric catalogue is what makes this safe *and* gives the
  builder UI a finite thing to render.

## Consequences

- **Adding a referenceable metric is a catalogue change**, not a rule change — register it in
  `metric-catalog.ts` (and in [04-metrics-catalog.md](../reference/functional/04-metrics-catalog.md))
  before a rule can use it.
- **Rules are evaluated per row, on the client.** The evaluator must stay cheap; it runs inside the
  clients mega-table render path. Do not add I/O to it.
- **The DSL is a public contract.** Changing an operator's semantics silently rewrites the meaning
  of every stored rule. Operator changes are additive-only; removals need a data migration.
- Severity → colour is owned by the design system's status classes, and those have a
  high-contrast variant (`data-color-theme="contrast"`), so rules stay colourblind-safe for free.
- User-facing documentation: [conditions-rules-guide.md](../conditions-rules-guide.md) and
  [14-condition-rules.md](../reference/functional/14-condition-rules.md).
