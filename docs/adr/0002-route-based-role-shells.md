# ADR 0002: Route-Based Role Shells

## Status
Accepted

## Decision
The app uses route-based role shells instead of tab-only runtime switching:
- `/client/*`
- `/manager/*`
- `/admin/*`

## Consequences
- Every workspace becomes deep-linkable.
- Role guards live in the router, not in demo UI state.
- Shared feature modules are reused under different route shells.
