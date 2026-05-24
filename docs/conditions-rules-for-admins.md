# Conditions & Warnings — Admin Guide

Plain-language guide for **admins, CS managers, and the master admin** on:

- What the coloured cells on the Clients page actually mean
- How to set up or change warnings (if you're the master admin)
- When you need to ask engineering for help

You do not need any technical background. If you can read a spreadsheet, you can use this.

---

## 1. What you see on the Clients page

The Clients page shows one row per client and many columns: Status, Inboxes, Min sent, KPI Leads, KPI Meetings, MoM, WoW, and so on. **Most cells are plain numbers on a black background.** But some cells are coloured:

| Colour | Severity | What it means |
|--------|----------|---------------|
| 🟢 **green** | "Good" — performance is on target. Rarely used; usually we just don't colour healthy cells. |
| 🔵 **blue / info** | "FYI" — non-urgent note. Used when we want to highlight something neutral. |
| 🟡 **yellow / amber** | "Warning" — slipping. Worth checking but not on fire. |
| 🔴 **red / danger** | "Problem" — needs attention now. |
| 🔴 **deep red** ("critical_over") | "Crisis" — something dramatically wrong, e.g. way past a hard limit. |

**When you hover** over a coloured cell, a tooltip appears with the reason (e.g. *"Min daily sent is below 200/day"*). That tooltip is the rule's `message`.

You can also filter the Clients page by health: at the top of the page there are chips like **All / Critical / Danger / Warning / Healthy**. Clicking one filters down to clients whose worst cell falls into that bucket. This is how you find "who needs attention this morning" in 5 seconds.

The colouring is **calculated live** every time you open the page. There is no nightly batch — change a threshold now and the next reload reflects it.

---

## 2. Who can change what

| You are | What you can do |
|---------|------------------|
| **Client** | See your own portal only. No colouring config; you just see your own KPIs. |
| **CS Manager** | See clients assigned to you. You see the colours; you cannot change thresholds. |
| **Admin** | See all clients. You see the colours; you cannot change thresholds. Ask master admin if a threshold feels off. |
| **Master admin** | See all clients **and** change thresholds via two surfaces: (1) the simpler **Simple triggers** card for quick yellow/red on built-in metrics; (2) the full **Conditions Engine** with dropdown builder — covers custom columns, droplist values, flat AND/OR, per-client scoping, custom hover messages. |
| **Super admin** (engineering) | Same as master admin plus a **Raw JSON** tab in the Conditions Engine for advanced shapes (deep nesting, DoD cells, metric paths outside the catalog). |

---

## 3. The two ways thresholds get configured

There are two surfaces in **Settings**:

### 3.1 Simple triggers (you, the master admin)

**Where:** Settings → Simple triggers.

A card per metric. Two number inputs (Yellow, Red) and an optional message. Click Save → cells on the Clients page start colouring on the next refresh.

Coverage today:

- **Min daily sent** — alert when below threshold
- **Inboxes count** — alert when below threshold
- **KPI Leads progress** — alert when below threshold
- **KPI Meetings progress** — alert when below threshold

(Engineering can extend this list when you need more metrics. Just ask.)

**How yellow + red interact:**
- Value below red → red cell (worst case wins)
- Otherwise below yellow → yellow cell
- Otherwise → no colour

If you only fill yellow and leave red blank → only yellow alerts. Same for red-only. Both is normal.

### 3.2 Conditions Engine (master admin + engineering)

**Where:** Settings → Conditions Engine. This surface is **available to master admin**. You see the same visual builder engineering uses; the only thing super admin has on top is a Raw JSON tab for advanced shapes.

The builder is **fully dropdown-driven** — no typing of metric names, no magic strings:

- Pick what to watch from one grouped dropdown (built-in columns + your custom columns auto-appear).
- Pick a scope (all clients / one specific client / one specific manager / "only active clients" checkbox).
- Define severity bands — each with a coloured severity chip, an operator dropdown filtered to what makes sense for that metric, and a value input that adapts (numeric, boolean toggle, droplist picker, etc.).
- Bands can have multiple conditions joined with a flat **ALL of (AND)** or **ANY of (OR)** — covers "bounce ≥ 2% OR complaint ≥ 0.5%" type cases.

When to still ask engineering:
- Deeply nested logic like `(A AND B) OR (C AND D)`.
- Rules on DoD cells (the special bucketed columns).
- A brand-new metric not yet in the catalog.

---

## 4. Reading a Simple-trigger row

When you open Settings → Simple triggers, each row looks like this:

```
┌─ Min daily sent  alert when below threshold ─────────────────────────────┐
│                                                                          │
│   Yellow [ 500 ]   Red [ 200 ]   [ Below contracted volume… ]   [Save]   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Reading it:

- **Metric name** + a short note about direction (below or above the threshold).
- **Yellow** — the warning threshold.
- **Red** — the danger threshold.
- **Message** — the text shown on hover when the cell is coloured. Optional but recommended.
- **Save** — applies your changes globally.

That's the whole UI. There are no other settings.

---

## 5. Worked example

**Goal:** Highlight clients whose daily sent volume is slipping. Anything under 500/day should turn yellow. Under 200/day should turn red. Hovering should explain that they're below the contracted floor.

**Steps:**

1. Settings → Simple triggers → find the "Min daily sent" row.
2. Yellow: type `500`.
3. Red: type `200`.
4. Message: type `Below contracted volume — check inboxes and warm-up status`.
5. Click **Save**.

**Result:**

- A client sending 950/day → no colour.
- A client sending 350/day → cell turns yellow. Tooltip says your message.
- A client sending 120/day → cell turns red. Tooltip says your message.
- A client sending 0 → still red (anything below 200 is red).

**To turn off the warning later:** clear both Yellow and Red boxes → Save. The rule is removed and cells stop colouring.

---

## 6. How to think about thresholds

A few principles that hold across all metrics:

- **Yellow is "look at me this week"; red is "fix me today."** Don't set them too close together — there should be a meaningful gap. If yellow=500 and red=499, yellow has no purpose.
- **Set red to your hard floor, yellow to your soft floor.** Hard floor: the contracted minimum, the deliverability tripwire, the regulatory limit. Soft floor: where you'd want the CS manager to start asking questions.
- **Don't try to alert on everything.** If too many cells are coloured, the colour stops meaning anything. Aim for ~10–20% of cells to be flagged at any given time.
- **Reasonable defaults work.** When in doubt, set yellow = "80% of target" and red = "50% of target." Adjust after a week of watching the dashboard.

---

## 7. Common questions

**Q: I set a threshold but the cell still isn't coloured.**

A: Try a hard refresh (Ctrl+R / Cmd+R). Conditions are evaluated when the page loads, so changes apply on the next page load. If still not colouring, check:
- Is the metric value actually crossing the threshold?
- Is the client status `Active`? Some metrics only apply to active clients (engineering can confirm).
- Are you looking at the right column? Some metric names overlap.

**Q: Two cells in the same row are coloured differently — why?**

A: Each cell is independently evaluated. One column might be below threshold while another is fine. The **row's overall health** (the chip near the client name) is the worst of any cell.

**Q: The tooltip text doesn't match what I typed.**

A: You may have changed the message but the page hasn't reloaded. Hard refresh. If still wrong, engineering may have set up an additional rule on the same metric that is winning — ask them to check.

**Q: I want to alert on something Simple triggers doesn't cover (e.g. "this specific client only", or "metric A AND metric B").**

A: Open Settings → **Conditions Engine** → New rule. You can express:
- One specific client / one specific manager (scope dropdown).
- Active-only restriction (one checkbox).
- Multiple conditions joined with AND or ANY (flat — one level).
- Custom tooltip messages per severity band.
- **Compare two metrics** instead of comparing to a fixed number. After picking the operator, switch the next dropdown from "a fixed value" to "another metric" — then pick a second metric and optionally a multiplier. Example: "MQLs is less than `KPI Leads` × `0.8`" turns the cell red when actual leads dip under 80% of contracted. Only available for numeric/percent metrics.

If you need deeply nested logic, DoD cells, or a metric not in the dropdown — ask engineering with:
> "I need an alert when **<exact condition>** on **<which column>**. Yellow at **<number>**, red at **<number>**. Tooltip should say **<text>**."

**Q: I deleted a Simple trigger by accident.**

A: Just recreate it — type the numbers again and Save. Nothing is permanently lost; the rule just stops applying.

**Q: Why does the same metric have a Yellow/Red on multiple pages?**

A: It doesn't — there's one global threshold per metric. The same rule is shown wherever that metric appears on the Clients page. Change it once, see it everywhere.

**Q: Can I see a history of who changed what?**

A: Not in the UI today. Engineering can pull the `updated_at` and `updated_by` columns from the `condition_rules` table if you need an audit.

---

## 8. Mental model in one line

> **A Simple trigger says: "for this metric, anywhere across all clients, paint the cell yellow below X and red below Y, with this hover message."**

If you find yourself wishing for "but" or "except" or "only when" — that's a sign you need engineering's Conditions Engine, not Simple triggers.

---

## 9. Glossary

- **Cell** — one square in the Clients table (e.g. the "Min sent" value for ColdCo Ltd).
- **Row** — one client's line in the Clients table.
- **Severity** — `info` < `warning` (yellow) < `danger` (red) < `critical_over` (deep red). The cell's colour matches the rule's severity.
- **Threshold** — the number you type into Yellow or Red.
- **Metric** — the thing being measured (Min daily sent, KPI Leads, etc.).
- **Trigger / Rule** — the configured threshold + colour + message combination.
- **Active client** — a client whose status is `Active` (not Inactive, Offboarding, On hold, Abo, or Sales). Many built-in rules only apply to Active clients to avoid false alarms on closed accounts.
- **Master admin** — the role that can edit Simple triggers. Currently `lukasz@coldunicorn.com`.
- **Super admin / engineering** — internal engineering role with raw access to the underlying Conditions Engine.

---

## 10. When to call engineering

You're fine without engineering for: setting yellow/red on the metrics already in Simple triggers, tuning thresholds up or down, changing the hover message, removing a warning.

Call engineering when you need:

- A metric not in the Simple-triggers list.
- A condition involving more than one metric (e.g. "low sent AND high bounce").
- A different threshold for one specific client.
- A row-level alert (colour the whole row, not just one cell).
- A badge on the Setup section (e.g. "BI not configured").
- Anything you can't phrase as "Yellow when X, Red when Y."

Engineering can do all of the above in the Conditions Engine. Lead time is usually under a day.
