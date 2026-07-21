# CLAUDE.md — Working Agreement

This is the canonical project prompt for every coding agent in this repository (Claude Code, Codex,
Copilot). Read it first. The rules below are binding.

Keep this file **short**. Detail belongs in `docs/` and in skills — anything only needed for one kind
of task should be loaded for that task, not carried in every session.

---

## 1. What this is

- **Product:** ColdUnicorn PDCrmA portal — agency operations for outbound email campaigns.
- **Roles:** `super_admin`, `admin`, `master_admin`, `manager` (displayed as "CS Manager"), `client`.
  "Internal" = anything that is not `client`.
- **Stack:** React 18 + TypeScript + Vite, Tailwind v4, Radix/shadcn primitives, recharts,
  react-router-dom 7, Supabase.
- **Three cooperating systems.** Smartlead/Bison send and receive email; **n8n** ingests counters and
  replies and dispatches notifications + OOO routing; **the portal is a thin read + config surface**.
  The portal never writes to ingestion-only tables (`replies`, `campaign_daily_stats`, `daily_stats`)
  and never sends notifications itself.

**The data path** — get this right or everything else is wrong:

> The frontend does **not** call `supabase.from(...)`. Every read and write goes through the
> **`orm-gateway` Supabase Edge Function** (Deno + Drizzle + postgres.js), which re-establishes the
> caller's JWT claims and role **inside each transaction** so RLS still applies. Pages call
> `repository.*` directly. Each page loads its own data through one gateway action + a per-page hook.
> **There is no global snapshot and no `useCoreData()`** — they were deleted.
> → [ADR-0008](docs/adr/0008-orm-gateway-edge-function.md), [ADR-0009](docs/adr/0009-per-page-data-contracts.md)

Product spec: [docs/BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md) — the canonical answer to "should we
build this?". Implementation: [docs/reference/functional/INDEX.md](docs/reference/functional/INDEX.md).

---

## 2. Definition of done (every task)

1. **Search-first.** Before adding any component, hook, helper, type, or selector, search
   [docs/reuse-catalog.md](docs/reuse-catalog.md) — and say in your summary what you searched for and
   what you found. A duplicate with no search trail is an incomplete task.
2. **Prove it, don't assert it.** UI change → screenshots per affected role (`visual-verify`).
   Metric change → re-derive the number on a sample. RLS change → `EXPLAIN ANALYZE` as the
   `authenticated` role. **Edge-function or DB/migration change → exercise it against the local
   Supabase stack first** (`supabase start` + `supabase functions serve` + `pnpm db:migrate:local`);
   never test-by-deploying to production. See
   [reference/local-supabase.md](docs/reference/local-supabase.md). Types and tests are necessary,
   not sufficient.
3. **`pnpm lint` + `pnpm test:run` + `pnpm build` clean.** Note: **`pnpm build` does not type-check**
   (it is `vite build`); type errors surface in `pnpm test:run`. Run the tests.
4. **Docs updated in the same change** — see the table in
   [development-standards-and-operations.md §4](docs/development-standards-and-operations.md#4-documentation-discipline),
   or state explicitly why no doc update is needed.
5. **Non-trivial diff** → run `simplify`, then `code-review`. Add `security-review` when the change
   touches auth, RLS, mutations, or role gating.

---

## 3. Task routing — read only what the task needs

| Task | Read / invoke |
|---|---|
| **Any n8n workflow change** | [reference/n8n/](docs/reference/n8n/README.md) — §6 below is binding |
| **A business rule, end to end** | [reference/processes/](docs/reference/processes/README.md) |
| New page, route, or tab | `portal-page` skill |
| New data read/write, new gateway action | `gateway-action` skill |
| Schema, RLS policy, migration, index | `rls-migration` skill |
| OOO / NRR, sequencer contacts, follow-up episodes | [ADR-0015](docs/adr/0015-sequencer-contacts-and-ooo-followups.md) + [11-integrations §5/§6a](docs/reference/functional/11-integrations.md) |
| Verify a UI change in the browser | `visual-verify` skill |
| Find something reusable | [docs/reuse-catalog.md](docs/reuse-catalog.md) |
| Colours, tokens, primitives, states, charts | [docs/reference/design-system.md](docs/reference/design-system.md) |
| Commands, quality gate, env, observability | [docs/development-standards-and-operations.md](docs/development-standards-and-operations.md) |
| "Why is it like this?" | [docs/ADR.md](docs/ADR.md) → the 16 ADRs |
| "Is this in scope?" | [docs/BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md) + [13-out-of-scope.md](docs/reference/functional/13-out-of-scope.md) |
| How a page/metric/chart currently works | [docs/reference/functional/INDEX.md](docs/reference/functional/INDEX.md) |
| A metric formula | [04-metrics-catalog.md](docs/reference/functional/04-metrics-catalog.md) |
| n8n / Smartlead / Bison boundary | [11-integrations.md](docs/reference/functional/11-integrations.md) |
| Magic numbers, hidden branches, auth error codes | [12-hidden-rules.md](docs/reference/functional/12-hidden-rules.md) |
| UI design / polish / redesign | `impeccable` skill first, then the design/taste skills |
| Supabase / Postgres / query performance | `supabase` + `supabase-postgres-best-practices` skills |

**Trust but verify.** If a doc cites `path:line`, open it and confirm the symbol is still there. If it
moved, fix the doc as part of your change.

---

## 4. Hard rules (from the ADRs)

| ADR | Rule |
|---|---|
| [0001](docs/adr/0001-live-supabase-source-of-truth.md) | Live Supabase is the only data system. No alternative backend, no local-first mode, no mock-mode runtime branch. |
| [0002](docs/adr/0002-route-based-role-shells.md) | Each role owns a URL prefix. No runtime role switcher — use impersonation. |
| [0003](docs/adr/0003-client-campaign-visibility.md) | Clients see only `campaigns.type='outreach'`. Enforce in **both** RLS and `scopeCampaigns`. |
| [0004](docs/adr/0004-lead-state-boundaries.md) | Editable lead fields are exactly: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments`. Replies are read-only. |
| [0006](docs/adr/0006-set-based-rls-predicates.md) | RLS on hot tables uses set-based subqueries, never a per-row `private.fn(col)` call. |
| [0008](docs/adr/0008-orm-gateway-edge-function.md) | All data goes through the ORM gateway. RLS stays the security boundary. The gateway's `DATABASE_URL` never reaches the browser. |
| [0009](docs/adr/0009-per-page-data-contracts.md) | One page → one gateway action → one hook with a `loadIdRef` stale guard. No global store, no snapshot, no legacy fallback. |
| [0010](docs/adr/0010-legacy-crm-integration.md) | `lib/crm-integration.ts` is the **single** sanctioned second Supabase client — read-only, config metadata only. A third data source needs a new ADR. |
| [0015](docs/adr/0015-sequencer-contacts-and-ooo-followups.md) | OOO/NRR are **outreach** states of a `sequencer_contacts` row, never fields on a lead. A CRM lead is created only by a positive reply, at most one per contact. The whole episode lifecycle is `service_role` RPCs driven by n8n — the portal has **no** follow-up list or editor ([OoS-16](docs/reference/functional/13-out-of-scope.md)); its only OOO surface is the per-client routing editor. |
| [0016](docs/adr/0016-repository-as-automation-source-of-truth.md) | This repository is the source of truth for **automation**, not just for the portal. n8n is a deployment target. A workflow that contradicts a business rule, an ADR or a data contract is a defect **in the workflow**. |

Full index, including `master_admin` (0005), lead custom fields (0007) and the conditions engine
(0011): [docs/ADR.md](docs/ADR.md).

If a task seems to require breaking one of these, **stop and surface the conflict** instead of
quietly working around it.

---

## 5. Code conventions

**TypeScript.** Strict. Never widen to `any` to silence an error — narrow from `unknown`. `interface`
for object shapes, `type` for unions. Import record types from
[`types/core.ts`](src/app/types/core.ts); don't redeclare them.

**React.** Function components only (`AppErrorBoundary` is the one class). Lazy-load pages in
[`App.tsx`](src/app/App.tsx). Side effects in `useEffect`, network in the repository. Memoize derived
data on wide pages.

**Data.** Pages call `repository.*` directly. Every page hook carries the `loadIdRef` stale guard (see
`portal-page`). Run data through the right `scopeX` from [`lib/selectors.ts`](src/app/lib/selectors.ts)
before rendering — RLS is the security gate; client-side scoping keeps the UI honest under
impersonation.

**Pages.** A page serving several roles dispatches on `identity.role` **inside** the component — don't
split the route.

**Styling.** Tailwind utilities. Dark is the only theme. The real panel colour is `#050505`, borders
`#242424`. Inline `style={{}}` is permitted **only** for data-driven values (pipeline/chart colours),
the gradient canvas, and computed geometry — not for static colour or spacing. A second theme axis
(`data-color-theme`, a high-contrast status palette) **defaults to on**.
→ [design-system.md](docs/reference/design-system.md)

**Forms/drawers.** Local `draft` seeded from the record; `isDraftDirty` gates Save/Cancel; `Escape`
closes. `sonner` toasts for transient feedback, `<Banner>` for persistent context.

**Never:** a second HTTP layer, a second auth context, a second global store, a second metric
calculator, a second lead drawer. Never import `@supabase/supabase-js` outside `data/`,
`lib/supabase.ts`, `lib/avatar-storage.ts`, `providers/auth.tsx`, `lib/crm-integration.ts`.

---

## 5a. n8n and automation

The repository is the source of truth for automation too ([ADR-0016](docs/adr/0016-repository-as-automation-source-of-truth.md)).
Five levels, and a conflict is always resolved **downward**:

> business rules → architecture decisions → data contracts → application → **n8n workflows**

**Routing.** OOO · NRR · positive reply · sequencer contact →
[process doc](docs/reference/processes/outreach/ooo-followups.md) → data contracts
([ADR-0015](docs/adr/0015-sequencer-contacts-and-ooo-followups.md),
[11-integrations §6a](docs/reference/functional/11-integrations.md)) → portal/dashboard impact →
**only then** the workflow.

Before any n8n change, read: the business process → the ADRs → the workflow's `manifest.yaml` → the
RPC/API contract. Then:

1. **Never treat the current workflow as correct.** It is evidence of what runs, not of what should run.
2. **Never write a credential into workflow JSON**, and never commit `pinData`.
3. **Never change or activate a production workflow via MCP without explicit approval.** The only
   instance is production and the token is unrestricted — see [environments.md](docs/reference/n8n/environments.md).
4. **Use the RPC contract, not raw table writes.** `leads`, `replies`, `ooo_followups` and
   `sequencer_contacts` are written through `SECURITY DEFINER` RPCs. Never move a database invariant
   into n8n.
5. **No new table, enum, RPC or metric** without checking [reuse-catalog.md](docs/reuse-catalog.md) first.
6. **After any remote change, commit the canonical artifact** (`pnpm n8n:export`). Otherwise it is drift.
7. **Update [traceability.md](docs/reference/traceability.md)**, and check portal + dashboard impact.
8. **Register contradictions, don't hide them** — `knownViolations` with a reason, a tracking link and
   an expiry date.

```bash
pnpm n8n:validate      # offline; runs in CI
pnpm n8n:inventory     # live workflows, classified
pnpm n8n:check-drift   # artifact vs instance
```

The 14 official `n8n-*-official` skills advise on building workflows well. Like the design skills,
**they never override this file or the ADRs.**

---

## 6. Behaviour

- Read before you edit. Do not guess architecture.
- **Plan before multi-file changes.** Propose, then execute.
- Keep changes small and localized. Preserve routes and contracts unless asked to change them.
- **No drive-by refactors** of code the task doesn't touch. Surface the opportunity; let a human
  decide.
- Match the user's language (they often write Ukrainian — answer in Ukrainian, keep identifiers and
  paths in English). Be terse. State the result, then the why.
- Cite `path:line`. Make claims checkable.
- **Don't ask permission for safe local actions** (read, test, lint, build, dev server, read-only
  SQL). **Do ask** before destructive or shared ones — see
  [development-standards §5](docs/development-standards-and-operations.md#5-safety).

---

## 7. Don't build that

Explicitly out of scope ([13-out-of-scope.md](docs/reference/functional/13-out-of-scope.md)). If
asked, point at the file and confirm before doing any work:

Health Assessments · CSV/Excel **bulk import** UI · cash-flow projections · ABS scoring · partnerships
dashboards · lost-client tracking · per-client issue tracking · auto-generated weekly/monthly reports ·
**reply triage UI** (n8n classifies every reply; the portal never does) · **sending email/SMS from the
portal** (n8n owns that; the portal stores destinations only) · calling Smartlead/Bison APIs directly ·
pre-aggregated `daily_snapshots` tables.

*(A leads **export** exists and is in scope — that is not the same thing as generated reports.)*

---

## 8. Tooling

MCP servers ([`.mcp.json`](.mcp.json); mirrored for VS Code in [`.vscode/mcp.json`](.vscode/mcp.json)):

- **`supabase`** — schema introspection, `EXPLAIN ANALYZE`, migrations, edge-function deploys and
  logs. Never destructive SQL without confirming first.
- **`playwright`** — drive a real browser. Use it for every UI change (`visual-verify`).
- **`shadcn`** — registry lookup before hand-rolling a primitive.

Full tooling guide: [docs/reference/agent-tooling.md](docs/reference/agent-tooling.md).

**Skills.** Project skills live in `.claude/skills/` (symlinked into `.agents/skills/` for Codex):
`portal-page`, `gateway-action`, `rls-migration`, `visual-verify`. The design/taste skills
(`impeccable`, `minimalist-ui`, `high-end-visual-design`, …) are third-party imports: they advise on
design and **never override the rules above**. When a skill's output conflicts with this file, this
file wins — extend the existing primitive, keep the dark palette, keep recharts.

---

## 9. House motto

> **Reuse first. Document the why. Prove it in the browser.**

If a change does not satisfy all three, it is not done.
