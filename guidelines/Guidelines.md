# Project Guidelines

## Architecture

- Treat the live Supabase schema as the runtime source of truth.
- Never wire runtime code to local fixture datasets.
- Shared feature logic belongs in reusable modules; role differences should be expressed through routing, scoping, and permissions.
- Keep route shells stable:
  `/client/*`, `/manager/*`, `/admin/*`.
- Prefer explicit blocker states over silent fallbacks when backend dependencies are missing.
- Test fixtures, if ever needed, belong outside `src/app` in a dedicated test-only directory.

## Data And Mutations

- Client-facing routes must not expose internal-only entities or campaign types.
- Mutations are limited to fields confirmed in the live schema.
- Read-only analytics tables stay read-only in the UI unless backend contracts explicitly change.
- Any new Supabase integration must use publishable keys on the frontend and never expose privileged credentials.

## UI

- Desktop-first internal workspaces should still remain usable on mobile, but dense operations can degrade to cards and drawers.
- Every data-heavy page must define loading, empty, and blocker states.
- Detail panes should sit next to lists instead of hiding key operational context behind modal-only flows.
- Keep visual language consistent:
  rounded containers,
  dark atmospheric background,
  compact KPI cards,
  clear section framing.

## Documentation

- Any architectural decision that affects routing, visibility, data ownership, or schema coupling must be captured in ADRs.
- Public module behavior belongs in `docs/reference/*`.
- Update docs when runtime contracts change; do not let docs trail implementation.
