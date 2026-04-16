# Copilot Frontend Instructions

Use these rules by default for frontend tasks in this repository.

## Architecture
- Keep React components focused and composable.
- Lift state only when multiple children need synchronized state.
- Prefer typed view-model boundaries over ad-hoc data shaping in UI components.

## Accessibility (Required)
- Use semantic HTML first; use ARIA only when native semantics are not enough.
- Ensure keyboard operability for interactive elements.
- Keep visible focus states and accessible labels for controls.
- Validate common a11y issues during implementation, not only before release.

## Performance
- Optimize for Core Web Vitals (LCP, INP, CLS).
- Minimize shipped JavaScript and split by route or feature when useful.
- Avoid expensive re-renders; only memoize after identifying real render hotspots.
- Use responsive images, modern formats, and sensible lazy loading.

## UI Behavior
- Always cover loading, empty, error, and success states.
- Provide clear user feedback for async actions.
- Keep interactions predictable and resilient to partial backend data.

## Testing
- Prioritize behavior-focused tests for critical flows.
- Add or update tests for non-trivial UI logic and edge states.

## Code Change Discipline
- Preserve design system consistency and existing project conventions.
- Avoid unrelated refactors in feature-level changes unless necessary for correctness.

## Project Guardrails (PDCA)
- Treat live Supabase as the runtime source of truth.
- Do not add local fixture or mock-data fallback paths for runtime behavior.
- Keep role shells route-based (`/client/*`, `/manager/*`, `/admin/*`).
- Enforce role scope boundaries from docs/reference visibility and mutation matrices.
- Keep analytics tables read-only from frontend mutations.
- Render explicit blocker states for missing auth linkage, tenant mapping, or RLS.
