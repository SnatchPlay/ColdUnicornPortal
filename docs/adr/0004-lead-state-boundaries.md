# ADR 0004: Lead State Boundaries

## Status
Accepted

## Decision
Lead runtime uses the live `leads` table as the editable source for:
- `qualification`
- milestone booleans (`meeting_booked`, `meeting_held`, `offer_sent`, `won`)
- `comments`

Reply history is read from `replies` and is not treated as the primary editable pipeline source.

## Consequences
- Internal lead operations stay simple and aligned with current schema.
- Future reply-review modules can be added without changing current CRUD ownership.
