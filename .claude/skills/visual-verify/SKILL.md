---
name: visual-verify
description: "Use to visually verify a UI change in a real browser before declaring it done — screenshots per affected role (client / manager / admin), before and after. Required for any change that alters rendered output. Not needed for backend-only, docs-only, or pure-logic changes."
user-invocable: true
---

# Visual Verification

Type-checks and unit tests do not prove a UI change works. **Feature correctness must be
observed.** If you changed what renders, you screenshot it — in every role that can see it.

## The loop

```
1. pnpm dev
2. Playwright MCP → browser_navigate to the affected page
3. For each affected role (client / manager / admin):
     a. seed the session as that role
     b. browser_take_screenshot            ← before
     c. drive the change (click the control, open the drawer, apply the filter)
     d. browser_take_screenshot            ← after
4. Actually look at the screenshots. If the UI did not change the way you expected,
   STOP and investigate. Do not declare done.
```

Step 4 is the point of the exercise. A screenshot you did not look at is not verification.

## Getting a role session

Real accounts live in the gitignored `.env.test.local` (there is a synthetic QA client for portal
testing). For role-scoped screenshots without a real account, copy the `seedSession` +
`mockSupabase` helpers from [`e2e/smoke.spec.ts`](../../../e2e/smoke.spec.ts); there is a starter at
[`e2e/visual-debug.spec.ts.example`](../../../e2e/visual-debug.spec.ts.example).

Super-admin impersonation exercises the *effective* identity, which is what most role bugs hide
behind — but it is not a substitute for a real sign-in when you changed auth or RLS. For those,
do both.

## What to check, not just that it renders

- **Both theme axes.** Dark is the only theme, but the contrast axis is real and **defaults to
  `contrast`** — the neon status palette is what a first-time user sees. If you touched a status
  badge, condition cell, severity pill or any `--status`-driven colour, screenshot **both**
  `data-color-theme` states. See [design-system.md](../../../docs/reference/design-system.md).
- **The gradient canvas.** Content floats on a photographic gradient, not a flat panel. New text on
  the canvas needs the established `drop-shadow` treatment or it will be unreadable in the light
  band at the top. Screenshot the *top* of the page, not just the middle.
- **Responsive.** Desktop-first, but the internal tables degrade to cards/drawers. Take a mobile
  viewport shot for anything in a table or a drawer.
- **The three states.** Loading, empty, and error are part of the feature, not extras. Force them
  (hang the loader, empty the filter, reject the promise) and look at each.

## Evidence

Screenshots from Playwright MCP land in `.playwright-mcp/` (gitignored). Do not commit them, and do
not commit stray PNGs to the repo root — that has happened before and left ~20 orphan files in git.

If a change is worth a permanent visual record, put it under `docs/screenshots/<topic>/` and link it
from the doc that explains it.

## Checklist

- [ ] Dev server running against the real Supabase project
- [ ] Before + after screenshots for **each** affected role
- [ ] Both contrast states if status colours are involved
- [ ] Mobile viewport if a table/drawer is involved
- [ ] Loading / empty / error states observed
- [ ] Screenshots actually inspected — differences explained, not assumed
