# ADR 0001: Live Supabase Is The Runtime Source Of Truth

## Status
Accepted

## Decision
Frontend runtime contracts follow the accessible Supabase project `bnetnuzxynmdftiadwef`.

## Consequences
- `src/app/types/core.ts` is aligned to the live table and enum shape.
- Old prototype-only types and `mock.ts` are not allowed as runtime truth.
- When docs and DB diverge, DB wins for implementation and docs must be reconciled.
