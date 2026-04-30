# Copilot Project Instructions (Primary)

This repository uses `CLAUDE.md` as the primary instruction source for agent behavior.

Mandatory:
- Treat `CLAUDE.md` as the canonical working agreement.
- Apply it by default for all tasks in this workspace.
- If any guidance here conflicts with `CLAUDE.md`, follow `CLAUDE.md`.

Quick guardrails (kept here for discovery):
- Live Supabase is the runtime source of truth.
- Keep route-based role shells: `/client/*`, `/manager/*`, `/admin/*`.
- Do not add local fixture/mock runtime fallbacks.
- Respect role visibility and mutation boundaries.
- Keep analytics tables read-only from frontend mutations.
