# Design System

The house style is a **dark, dense, data-first dashboard**. There is no light mode. This file is the
ground truth for tokens, primitives, and the rules that actually hold in the code — verified against
`src/` on 2026-07-14. Where reality diverges from what an older doc claimed, reality wins and the
divergence is called out.

Related: [08 · Charts catalog](./functional/08-charts-catalog.md) · [UI states](./ui-states.md) ·
[CLAUDE.md §4.5 Styles](../../CLAUDE.md).

---

## 1. Theme model — two independent axes

The app has **two** theme mechanisms. They are orthogonal and are frequently confused. Neither was
documented before this file.

### 1.1 Axis A — shadcn dark/light tokens (effectively a constant)

[`src/styles/theme.css:3-79`](../../src/styles/theme.css) declares a light `:root` palette **and** a
`.dark` override block, wired into Tailwind via `@theme inline` (`theme.css:81-120`).

**There is no toggle and no light mode.** `.dark` is hardcoded exactly twice, both in
[`App.tsx`](../../src/app/App.tsx):

| Site | Line | What it wraps |
|---|---|---|
| `<div className="dark">` | [`App.tsx:295`](../../src/app/App.tsx#L295) | the entire app (providers + router + Toaster) |
| `<div className="dark min-h-screen …">` | [`App.tsx:270`](../../src/app/App.tsx#L270) | `RuntimeConfigScreen` (renders before providers when env vars are missing) |

Consequence: **the light `:root` palette is dead weight.** Nothing in the running app ever renders
under light tokens. `:root` survives only as the fallback source for the four tokens `.dark` does not
redefine: `--font-size`, `--input-background`, `--switch-background`, `--radius`.

Practically, the shadcn semantic tokens (`bg-background`, `text-foreground`, `border-border`,
`bg-primary`, …) are used almost nowhere in product code — pages use raw hex utilities (§2). The
tokens matter only inside `src/app/components/ui/*` primitives, which were generated from shadcn.

> **DON'T** add light-mode variants or a dark/light toggle. **DON'T** "fix" `:root` — it is inert.

### 1.2 Axis B — `ColorThemeProvider`: default vs contrast (real, user-facing)

[`src/app/providers/color-theme.tsx`](../../src/app/providers/color-theme.tsx) is **not** light/dark.
It is a **colorblind-friendly high-contrast neon override for status/severity semantics only**.

| Property | Value |
|---|---|
| Type | `"default" \| "contrast"` (`color-theme.tsx:3`) |
| **Default value** | **`contrast`** — anything other than the literal `"default"` in storage resolves to `contrast` (`color-theme.tsx:20-26`) |
| DOM effect | sets `data-color-theme="contrast"` on `<html>`; removes the attribute for `default` (`color-theme.tsx:28-34`) |
| Persistence | `localStorage["pdca-color-theme"]` (`color-theme.tsx:17`) |
| Toggle UI | `Contrast` lucide icon button in the sidebar footer, [`app-shell.tsx:410-421`](../../src/app/components/app-shell.tsx#L410) — amber when contrast is on |
| CSS surface | [`theme.css:232-316`](../../src/styles/theme.css#L232) |

It changes **only** status semantics: condition cells, severity badges, client-status badges, reply
badges, yes-pills (§6). It does not touch surfaces, borders, typography, or chart series.

> **DO** add new status colors to *both* the base rule and its `[data-color-theme="contrast"]`
> override. A status color that exists only in one branch is a bug for colorblind users.
>
> The rule is about **status**. Colour that carries no good/warning/danger meaning — decoration, or a
> selected-state marker such as `.rainbow-active` (§2.3a) — is deliberately exempt: the high-contrast
> palette has nothing to say about it, and forcing an override would only invent a second look for
> the same non-signal.

---

## 2. Color tokens

All colors ship as raw hex Tailwind arbitrary values (`bg-[#050505]`). Counts below are literal
occurrences in `src/**/*.tsx`, measured 2026-07-14.

### 2.1 Surfaces

| Token | Uses | Role |
|---|---|---|
| `bg-[#030303]` | 1 | **App root canvas** — [`app-shell.tsx:519`](../../src/app/components/app-shell.tsx#L519). Sits under the gradient image (§4). |
| `bg-[#050505]` | **73** | **Primary panel.** `Surface`, `PortalSurface`, sidebar, mobile nav, `PortalSearch`, `SelectTrigger`/`SelectContent`, and the global `<select>` restyle. |
| `bg-[#080808]` | 26 | Recessed / stateful surface — `EmptyState`, `LoadingState`, `EmptyPortalState`, `PortalLoadingState`, neutral `MetricCard`, portal chart tooltip background, popover bodies. |
| `bg-[#111]` | 26 | Inner tile + hover — `FieldTile` in the lead drawer, sidebar button hovers. |
| `bg-[#1a1a1a]` | **70** | Table rows, chips, inline inputs, meta pills. |
| `bg-[#0f0f0f]` | 6 | **Secondary buttons only** — timeframe preset buttons (`portal-ui.tsx:77,90`), leads/client-leads filter buttons. Not a panel color. |
| `bg-[#070707]` | 1 | `LeadDrawer` aside (`portal-ui.tsx:513`). |

> **Correction:** older docs and CLAUDE.md §4.5 claim `#0f0f0f` is the panel color. **It is not.**
> The panel color is `#050505`; `#0f0f0f` appears 6 times, all on secondary buttons.

### 2.2 Borders

| Token | Uses | Role |
|---|---|---|
| `border-[#242424]` | **100** | **Primary border.** Every `Surface` / `PortalSurface` / tile / input / chip. |
| `border-[#1f1f1f]` | 21 | Structural dividers — sidebar edge, mobile nav top border, lead-drawer section rules. |
| `border-[#3a3a3a]` | 14 | Hover / active border lift. Also the scrollbar thumb color (`theme.css:126`). |

Accent borders are expressed as Tailwind alphas, not hex: `border-emerald-500/20`,
`border-amber-500/25`, `border-blue-500/20`, `border-violet-500/25`, `border-indigo-500/20`,
`border-red-500/25`.

### 2.3 Tinted KPI surfaces

Used by `MetricCard` ([`app-ui.tsx:88-95`](../../src/app/components/app-ui.tsx#L88)) and `KpiTile`
([`portal-ui.tsx:184-190`](../../src/app/components/portal-ui.tsx#L184)). Each is a near-black hue
paired with a matching `*-500/2x` border and `*-400` foreground.

| Tone | Background | Border | Text | Available in |
|---|---|---|---|---|
| success / green | `#06120d` | `emerald-500/20` | `emerald-400` | both |
| warning / amber | `#120d04` | `amber-500/2x` | `amber-400` | both |
| info / blue | `#050e18` | `blue-500/20` | `blue-400` | both |
| purple | `#0d0714` | `violet-500/25` | `violet-400` | `KpiTile` only |
| indigo | `#08071a` | `indigo-500/20` | `indigo-400` | `KpiTile` only |
| neutral | `#080808` | `#242424` | white | `MetricCard` only |

### 2.3a The house rainbow (`--rainbow-sweep` / `.rainbow-active`)

Defined once in [`theme.css`](../../src/styles/theme.css), the only gradient token in the system.
It reproduces the app-canvas image ([`gradient-top.jpg`](../../src/imports/backgrounds/gradient-top.jpg),
applied in `app-shell.tsx` — see §4.3) as a horizontal CSS sweep, so a small element can carry *that*
gradient rather than a second, unrelated one:

```
deep blue #0b2be0 → #1a6ef5 → cyan #17c8e8 → near-black #07090b → orange #ff5a0a → #ff3c14 → magenta #d94ab4 → violet #a63bdd
```

`.rainbow-active` layers a **40% black scrim** over it as a second `background-image`, plus white
text, `font-weight: 600` and a text shadow. The scrim is not decoration: white on the raw cyan stop
is about 1.9:1, and scrimmed it clears 4.5:1 while the orange stop goes well past it. Layering it as
a background rather than an overlay element keeps the gradient free of an extra DOM node and of an
inline `style` (CLAUDE.md §5).

Used by the PDCA / CRM / Combined switcher on the leads page, where the active option changes which
table the page renders. Reach for it for a *selection* that reframes the screen — not for status,
and not as a general accent; the tinted surfaces in §2.3 are still the answer there.

### 2.4 Text

| Class | Use |
|---|---|
| `text-white` | Headings, values, primary table cells |
| `text-neutral-200` | Subtitles / hints **on the gradient canvas** (paired with a drop-shadow, §4) |
| `text-neutral-300` | Eyebrow labels, icon-adjacent text |
| `text-neutral-400` | Secondary body inside panels, inactive nav |
| `text-neutral-500` | Placeholders, em-dash null values, muted meta |

---

## 3. Typography

**The font stack is un-set.** [`src/styles/fonts.css`](../../src/styles/fonts.css) is a **0-byte
file**, imported at [`index.css:1`](../../src/styles/index.css#L1). There is no `@font-face` and no
`font-family` declaration anywhere in `src/`. The app renders on the Tailwind preflight default sans
stack (system UI). That is a real, unintentional-looking gap — if a brand face is ever wanted, this
is the single file to fill.

Base: `--font-size: 16px` applied to `html` (`theme.css:4`, `theme.css:185-187`). `@layer base` also
sets default sizes/weights for `h1`–`h4`, `label`, `button`, `input` (`theme.css:189-229`) — these
are in `@layer base` so any Tailwind text utility overrides them. In practice every component sets
its own size, so the base element rules are near-invisible.

The scale actually used:

| Role | Classes | Site |
|---|---|---|
| Page title | `text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-[30px] sm:leading-none` | `PageHeader` ([`app-ui.tsx:17`](../../src/app/components/app-ui.tsx#L17)), `PortalPageHeader` ([`portal-ui.tsx:134`](../../src/app/components/portal-ui.tsx#L134)) |
| Page subtitle | `text-sm sm:text-base text-neutral-200` | same |
| Section title | `text-lg font-semibold tracking-[-0.02em] sm:text-xl` | `Surface` (`app-ui.tsx:66`), `PortalSurface` (`portal-ui.tsx:160`) |
| Eyebrow label | `text-xs font-semibold uppercase tracking-[0.14em]` (0.16em in `MetricCard`, 0.18em in drawer `SectionLabel`) | `MetricCard`, `FieldTile`, `SectionLabel`, timeframe popover |
| KPI value | `text-2xl font-medium sm:text-3xl` (`KpiTile`) / `text-xl sm:text-2xl` (`MetricCard`) | — |
| Body / table | `text-sm` | everywhere |
| Meta / chip | `text-xs` | — |
| Mono | `font-mono text-[13px]` | `FieldTile mono` (external IDs) |

Rule of thumb: **negative tracking for headings, wide positive tracking for uppercase eyebrows.**

---

## 4. Layout, radii, spacing, and the gradient canvas

### 4.1 Radii

| Radius | Applies to |
|---|---|
| `rounded-2xl` | Surfaces, KPI tiles, field tiles, drawers' inner cards, search input |
| `rounded-xl` | Buttons, banners, nav items, filter chips, pipeline badges, icon wells |
| `rounded-lg` | Sidebar controls, `SelectTrigger`, small date inputs |
| `rounded-full` | Pills, dots, avatars, `InlineLinkButton` |

The `--radius: 0.625rem` token and the derived `--radius-sm/md/lg/xl` (`theme.css:33`, `108-111`)
are used only inside `ui/*` shadcn primitives; product code uses the Tailwind scale directly.

### 4.2 Grid + spacing

- Desktop-first. Canonical grids: `md:grid-cols-2 xl:grid-cols-4` (KPI rows) and the asymmetric
  `xl:grid-cols-[1.6fr_1fr]` (charts left / tables right).
- Panel padding: `p-4 sm:p-6`. Tile padding: `p-5`. Drawer sections: `p-6`.
- Vertical rhythm between panels: `gap-5` / `space-y-5`.

### 4.3 Gradient canvas (commit `bd3d959`) — and the text-shadow rule it forced

[`app-shell.tsx:519-524`](../../src/app/components/app-shell.tsx#L519):

```tsx
<div className="min-h-screen bg-[#030303] text-white">
  <div aria-hidden="true"
       className="pointer-events-none fixed inset-0 bg-cover bg-top bg-no-repeat"
       style={{ backgroundImage: `url(${gradientTop})` }} />
```

- Image: `src/imports/backgrounds/gradient-top.jpg`, imported at `app-shell.tsx:20`.
- The layer is `fixed inset-0`, full-bleed, non-scrolling, behind everything.
- The sidebar is opaque `bg-[#050505]`; `<main>` (`app-shell.tsx:550`) is **transparent** — the
  gradient shows through around and between panels.

**Consequence — the text-shadow rule.** Any text that renders *directly on the canvas* (i.e. outside
an opaque panel) needs a shadow to stay legible over the gradient. 12 such call sites exist, all
using `drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]` (or `0_1px_3px` for h1):

| Component | Lines |
|---|---|
| `PageHeader` title + subtitle | [`app-ui.tsx:17-18`](../../src/app/components/app-ui.tsx#L17) |
| `MetricCard` label / value / hint | [`app-ui.tsx:98-100`](../../src/app/components/app-ui.tsx#L98) |
| `PortalPageHeader` title + subtitle | [`portal-ui.tsx:134-135`](../../src/app/components/portal-ui.tsx#L134) |
| `KpiTile` value / label / hint | [`portal-ui.tsx:197-199`](../../src/app/components/portal-ui.tsx#L197) |

(`MetricCard`/`KpiTile` are tinted-translucent enough that the gradient reads through, hence the
shadow there too.)

> **DO** add `drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]` to any new text placed on the canvas or on a
> tinted KPI tile. **DON'T** add it to text inside an opaque `#050505` / `#080808` panel.

---

## 5. Primitive inventory

### 5.1 Composite primitives (use these first)

**Internal pages — [`app-ui.tsx`](../../src/app/components/app-ui.tsx)**

| Component | Purpose |
|---|---|
| `PageHeader` | Title + subtitle + right-aligned actions. Canvas text-shadowed. |
| `Surface` | The panel. `rounded-2xl border-[#242424] bg-[#050505] p-4 sm:p-6`, optional title/subtitle/actions. |
| `Banner` | Persistent inline notice: `info` (emerald) / `warning` (amber) / `danger` (red). |
| `MetricCard` | KPI tile, tones `neutral \| success \| warning \| info`. |
| `EmptyState`, `LoadingState` | See §7. |
| `InlineLinkButton` | Pill-shaped "go somewhere" affordance with an arrow. |
| `ChartTextSummary` | `sr-only` textual description of a chart (a11y). Pair with every recharts panel. |

**Client portal — [`portal-ui.tsx`](../../src/app/components/portal-ui.tsx)**

| Component | Purpose |
|---|---|
| `PortalPageHeader`, `PortalSurface` | Portal twins of `PageHeader` / `Surface` (same tokens). |
| `KpiTile` | 5-tone KPI tile with icon well; more visual than `MetricCard`. |
| `ChartPanel` | `PortalSurface` + fixed `h-72` chart body. |
| `ResponsiveChart`, `ChartTooltip` | Thin recharts wrappers pinned to `PORTAL_CHART_TOOLTIP`. |
| `DateRangeButton` | Timeframe popover (presets + custom range), backed by `lib/timeframe.ts`. |
| `FilterChip`, `PortalSearch` | Filter + search controls. |
| `PipelineBadge` | Stage pill; **color is data-driven** from `PIPELINE_STAGES` (§8.3). |
| `LeadDrawer` + `LeadDetailSections` / `LeadConversation` / `LeadMetaSection` | Read-only lead panel with focus trap + `Escape` close. Internal pages reuse the section components around an editable form. |
| `EmptyPortalState`, `PortalLoadingState`, `PortalErrorState` | See §7. |
| `PORTAL_CHART_TOOLTIP` | Exported tooltip config (§8.2). |

### 5.2 Base primitives — `src/app/components/ui/` (16 files)

33 unused shadcn primitives were deleted. What remains, and who imports it:

| File | Importers outside `ui/` | Note |
|---|---|---|
| `select.tsx` | 14 | The workhorse. |
| `lightweight-sheet.tsx` | 6 | **Custom, not shadcn.** Replaces shadcn `sheet` — a plain fixed-position drawer without Radix Dialog, used for the mobile sidebar and page drawers. |
| `popover.tsx` | 4 | Radix. |
| `badge.tsx` | 3 | Often overridden by the status classes in §6 (which sit outside `@layer` precisely so they beat `bg-primary`). |
| `checkbox.tsx` | 3 | Radix. |
| `user-avatar.tsx` | 3 | **Custom.** Wraps `avatar.tsx`, resolves Supabase avatar paths, falls back to initials. Use this, never `avatar` directly. |
| `tooltip.tsx` | 2 | Radix. |
| `toggle-group.tsx` | 2 | Radix; depends on `toggle.tsx`. |
| `input.tsx`, `tabs.tsx`, `breadcrumb.tsx`, `pagination.tsx` | 1 each | — |
| `avatar.tsx` | 0 (used by `user-avatar`) | Internal dep. |
| `button.tsx` | 0 (used by `pagination`) | Internal dep — product code hand-rolls buttons with Tailwind. |
| `toggle.tsx` | 0 (used by `toggle-group`) | Internal dep. |
| `utils.ts` | many | `cn()` = `clsx` + `tailwind-merge`. Always use it for conditional classes. |

> `ui/chart.tsx` (shadcn `ChartContainer`) has been **deleted**. All charts are hand-rolled recharts.

---

## 6. Status semantics (the entire status color system)

Defined in [`theme.css:232-316`](../../src/styles/theme.css#L232), **deliberately outside any
`@layer`** so they outrank Tailwind utilities and the `Badge` primitive's `bg-primary` without
`!important`. Every class has a `[data-color-theme="contrast"]` neon override (§1.2).

| Class family | Members | Base look | Contrast look | Used by |
|---|---|---|---|---|
| `.cond-cell` + `-good` / `-danger` / `-warning` / `-critical` | 4 | Translucent full-bleed cell fill (`rgb(… / 0.7)`), edge-to-edge inside a table cell | Solid neon fill, `font-weight: 800` | `clients-page/mega-table.tsx` condition columns |
| `.crm-cell` + `-green` / `-yellow` / `-orange` / `-red` / `-pending` | 5 | Translucent full-bleed fill tuned to the CRM table's `px-2.5`/`py-2` cells; distinct **orange** + subtle **pending** the conditions engine lacks | Solid neon fill (`green #06F701`, `yellow #F9F909`, `orange #ff6600`, `red #FA0200`, `pending #2f2f2f`), weight 800 | `lead-crm-table.tsx` — Lead CRM per-cell health (ADR-0013), fed by `lib/crm/lead-health.ts` |
| `.sev-badge-*` | 4 (same suffixes) | Tinted 12% bg + pale border + pale text | Neon border + 15% bg + neon text, weight 700 | Clients name-column rollup, condition chips, `settings/condition-rule-builder.tsx` |
| `.status-badge-*` | 6 — `active`, `inactive`, `abo`, `sales`, `onhold`, `offboard` | 40% dark fill + saturated border + light text | Solid neon fill with black/white text, weight 800 | Client status column |
| `.reply-badge-*` | 6 — `interested`, `ooo`, `nrr`, `left`, `spam`, `neutral` | 15% tint + light text | 20% neon tint + neon text, weight 700 | `ReplyClassificationBadge` ([`portal-ui.tsx:421-435`](../../src/app/components/portal-ui.tsx#L421)) |
| `.yes-pill` / `.yes-pill-dot` | 2 | Emerald 15% / `#10b981` dot | `#00ff41` matrix green | `YesNoPill` ([`portal-ui.tsx:407`](../../src/app/components/portal-ui.tsx#L407)) |

Contrast neon palette (`theme.css:242-247`): good `#06F701`, danger `#FA0200`, warning `#F9F909`,
critical `#ff00ff`, abo `#00e5ff`, sales `#bf00ff`, on-hold `#ffa500`, offboarding `#ff6600`.

### 6.1 Other global CSS you must not re-implement

| Feature | Lines | Notes |
|---|---|---|
| Custom scrollbars | [`theme.css:123-146`](../../src/styles/theme.css#L123) | `scrollbar-width: thin`, thumb gradient `#424242 → #2d2d2d` on a `#0b0b0b` track, webkit + Firefox. |
| Global `<select>` restyle | [`theme.css:148-173`](../../src/styles/theme.css#L148) | Kills native appearance, injects an SVG chevron, forces `#050505` background on the control *and* its `option`s. Native `<select>`s therefore already look right — reach for `ui/select` only when you need Radix behaviour. |
| `prefers-reduced-motion` | [`theme.css:318-331`](../../src/styles/theme.css#L318) | Collapses all animations/transitions to 0.01ms and disables `.animate-spin`. |

---

## 7. State surfaces — which one to use

Two parallel families. **Pick by role-surface, not by taste.**

| State | Internal (admin / manager / `app-ui.tsx`) | Client portal (`portal-ui.tsx`) |
|---|---|---|
| Loading (page) | `LoadingState` — centered spinner chip, `min-h-[40vh]`, fixed copy | `PortalLoadingState` — bordered card with spinner + customizable title/description |
| Loading (panel) | reuse `LoadingState` inside the `Surface` | `PortalLoadingState` inside the `PortalSurface` |
| Empty | `EmptyState({title, description})` — dashed `#242424` border on `#080808` | `EmptyPortalState({title, description})` — identical treatment, portal-namespaced |
| Error | `Banner tone="danger"` — inline, non-blocking, no retry affordance | `PortalErrorState({title, description, onRetry})` — red card **with a Retry button** |
| Warning / persistent context | `Banner tone="warning"` (snapshot staleness, impersonation) | `Banner` is also used in portal pages; there is no portal-specific warning surface |
| Transient success/failure of a mutation | `sonner` toast (`toast.success` / `toast.error`) | same |

Rules:

- **Error with a retry path → `PortalErrorState`.** It is the only state surface with an `onRetry`
  affordance; internal pages that need retry should use it or add retry to `Banner` rather than
  hand-rolling a third card.
- **Persistent context, not a failure → `Banner`.** Impersonation, snapshot windows, permission notes.
- **Never render a blank table.** Every list/panel gets an explicit empty state.
- **Never fall back to fixtures on error** (ADR-0001). Surface the blocker.

Full behavioural contract: [ui-states.md](./ui-states.md).

---

## 8. Charts

recharts only, hand-rolled — there is no `ChartContainer` wrapper (deleted). Full inventory:
[08-charts-catalog.md](./functional/08-charts-catalog.md).

### 8.1 Series palette

| Hex | Meaning |
|---|---|
| `#22c55e` green | sent (portal), replies (internal), won, positive rows |
| `#38bdf8` sky | sent (internal), momentum-sent |
| `#3b82f6` blue | MQLs, prospects, positive velocity bars |
| `#1d4ed8` deep blue | negative velocity bars |
| `#8b5cf6` violet | meetings, opens |
| `#f97316` orange | bounces |
| `#f59e0b` amber | positive momentum |
| `#facc15` yellow | sub-threshold accent (reply rate < 5%) |

Grid: `#141414` (portal) · `rgba(148,163,184,0.12)` (internal). Axes: `fontSize: 11`,
`rgba(148,163,184,0.8)` ticks, `axisLine={false} tickLine={false}`.

### 8.2 Three tooltip configs (one too many)

| Config | Source | Background / border |
|---|---|---|
| `PORTAL_CHART_TOOLTIP` | [`portal-ui.tsx:16-25`](../../src/app/components/portal-ui.tsx#L16) | `#080808` / `#242424`, radius 12px |
| `DASHBOARD_CHART_TOOLTIP` | [`dashboard-momentum.ts:25-35`](../../src/app/lib/dashboard-momentum.ts#L25) | `rgba(2,6,23,0.98)` / `rgba(148,163,184,0.2)`, radius 16px, `cursor: false` |
| **raw inline `contentStyle` literals** | [`statistics-page.tsx:848,876,912`](../../src/app/pages/statistics-page.tsx#L848), [`campaigns-page.tsx:887`](../../src/app/pages/campaigns-page.tsx#L887) | byte-identical copies of `DASHBOARD_CHART_TOOLTIP` |

> **Known violation.** The 4 inline literals duplicate `DASHBOARD_CHART_TOOLTIP`. Replace them with
> the import when you next touch those files. Do **not** add a fourth config.

### 8.3 Data-driven colors

`PIPELINE_STAGES` — [`client-view-models.ts:14-22`](../../src/app/lib/client-view-models.ts#L14):

| Stage | Color |
|---|---|
| `preMQL` | `#facc15` |
| `MQL` | `#3b82f6` |
| `meeting_scheduled` | `#c084fc` |
| `meeting_held` | `#818cf8` |
| `offer_sent` | `#f97316` |
| `won` | `#22c55e` |
| `rejected` | `#fb7185` |
| (fallback `unqualified`) | `#737373` |

These are the only colors that legitimately reach the DOM as inline `style` (§9).

### 8.4 Inert tokens

`--chart-1` … `--chart-5` (oklch, `theme.css:28-32` / `66-70`) are wired through `@theme inline` but
**nothing reads them**. Ignore. Do not "adopt" them without converting every chart at once.

---

## 9. The honest inline-style rule

CLAUDE.md §4.5 says "no `style={{ … }}` for color/spacing". That rule is violated in **20 places
across 11 files**, including the primitives themselves. The real, enforceable rule is:

> **Inline `style` is permitted only for values that cannot exist as a static class:**
> 1. **Data-driven colors** — pipeline stage / campaign status / lead-highlight colors computed at
>    runtime (`PipelineBadge` [`portal-ui.tsx:241`](../../src/app/components/portal-ui.tsx#L241),
>    `lead-report-columns.tsx:83`, `campaigns-page.tsx:653`, `leads-page.tsx:658`,
>    `client-dashboard-page.tsx:708-732`).
> 2. **The gradient canvas** — bundler-resolved image URL
>    ([`app-shell.tsx:523`](../../src/app/components/app-shell.tsx#L523)).
> 3. **Computed geometry** — virtualised/resizable table column widths and funnel-bar widths
>    (`clients-page/mega-table.tsx:1184-1193`, `client-dashboard-page.tsx:715`).
>
> **Everything else is Tailwind.** A static hex or a fixed pixel value in a `style` prop is a defect.

---

## 10. Information architecture (folded in from the retired `design-conventions.md`)

- Route-based application structure, not tab-only switching (ADR-0002).
- Large workspaces use a sidebar shell plus a content canvas ([`app-shell.tsx`](../../src/app/components/app-shell.tsx)).
- Metrics render in compact cards **before** detailed tables/charts.
- Tables always pair with a contextual detail pane or a drill-in surface (drawer).
- Empty, loading, and blocker states are first-class UI states (§7).

---

## 11. DO / DON'T

**DO**

- Reuse `Surface` / `PortalSurface` for every panel; add a prop before forking.
- Use `cn()` for every conditional class.
- Use `#050505` for panels, `#242424` for borders, `#1a1a1a` for rows/chips.
- Add `drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]` to text on the gradient canvas or on tinted KPI tiles.
- Add both the base **and** the `[data-color-theme="contrast"]` rule for any new status color (decoration such as `.rainbow-active` is exempt — §1.2).
- Reuse `--rainbow-sweep` / `.rainbow-active` (§2.3a) instead of authoring a second gradient.
- Add a `ChartTextSummary` next to every new chart.
- Register any new chart in [08-charts-catalog.md](./functional/08-charts-catalog.md) in the same change.

**DON'T**

- Don't add a light theme, a dark/light toggle, or touch the dead `:root` palette.
- Don't confuse `ColorThemeProvider` with dark mode — it is a status-contrast axis, default **on**.
- Don't introduce a fourth recharts tooltip config; import one of the two exported ones.
- Don't use `bg-[#0f0f0f]` as a panel color (it is the secondary-button color).
- Don't use `ui/avatar`, `ui/button`, or `ui/toggle` directly — use `UserAvatar`, Tailwind buttons,
  and `ToggleGroup`.
- Don't reach for shadcn `sheet` — it is deleted; use `LightweightSheet`.
- Don't put static colors or spacing in a `style` prop (§9).
- Don't re-implement scrollbars, `<select>` styling, or reduced-motion handling — they are global.
