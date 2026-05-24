# Master Admin — User Guide

This is a plain-language guide for the **Master Admin** of the ColdUnicorn PDCA portal. It explains the three things only you can do, with no technical background needed:

1. Rename or hide columns in the Clients table
2. Add your own custom columns (text / checkbox / dropdown)
3. Set "yellow" and "red" warning thresholds on metrics

If you can sign in to the portal, you can do everything below. You will not need to touch code, SQL, or anything in Supabase.

---

## Before you start

You need to be signed in with the master-admin account (`lukasz@coldunicorn.com`). If you can see a section called **Clients table customization** at the bottom of **Settings**, you are signed in as the master admin. If you do not see it, you are signed in as a regular admin and you will not be able to make these changes.

All edits save **immediately** when you click outside an input or tick a checkbox. There is no "Save" button for column edits — your change is live the moment you tab away. If you make a mistake, just edit it back.

Your changes are **global**. Renaming the "Min daily sent" column affects what every admin and CS manager sees, including yourself. The same goes for hiding columns, adding custom columns, and setting trigger thresholds.

---

## 1. Renaming or hiding built-in columns

**Where:** Settings → Clients table customization → Built-in columns — labels & visibility.

You will see a list of every column that currently appears in the Clients page mega-table (Client, Manager, Status, KPI Leads, MoM Sent, etc.). Each row has three things:

- The **original column name** (greyed out on the left) — this never changes; it is your reference.
- A **text box** in the middle — type your own name here to override the label. Leave blank to use the original.
- A **"Hidden" checkbox** on the right — tick it to remove the column from the Clients table entirely.

### To rename a column

1. Find the row for the column (e.g. "Min daily sent").
2. Click in the text box and type the new name (e.g. "Daily volume").
3. Click anywhere outside the box. Your change is saved.
4. Open the Clients page in another tab to confirm the new name appears.

To go back to the original name, just clear the text box and click out — the column reverts to its built-in label.

### To hide a column

1. Find the row for the column you want to hide.
2. Tick the **Hidden** checkbox.
3. The column will disappear from the Clients table immediately.

To bring it back, untick the box.

### Reordering columns

Each row in the customization list has small **↑** / **↓** buttons on the left. Click them to move a column up or down. The change is global — every admin and CS manager sees the new order on the Clients page the next time they refresh.

The first row's ↑ and the last row's ↓ are disabled. You can move a column across group boundaries (e.g. drag a WoW column into the Basic group) — the Clients page just renders them in the order you set.

To revert to the original order: not exposed in the UI yet. Ask engineering to clear the `position` column on `client_table_column_overrides` for the columns you want to reset.

### What you cannot do here

- You cannot **change what a built-in column calculates**. The formula stays the same; only the displayed name and position change.
- You cannot **resize** columns from here. Resizing is done by dragging the column edge in the Clients page itself (per-user, not global).

---

## 2. Adding your own custom columns

**Where:** Settings → Clients table customization → Custom columns.

This is the section that lets you replicate "I just need to see this on every client" needs you used to handle by adding a column in Google Sheets. You can create three kinds of column:

| Type | What it looks like | Good for |
|------|-------------------|----------|
| **text** | A small text box per client | Notes, short status labels, ticket numbers |
| **checkbox** | A tick box per client | Setup steps done, flags ("Trial?", "BI dashboard live?") |
| **droplist** | A dropdown per client with options you define | Stage labels, vertical names, owner labels |

Custom columns appear **at the end** of the Clients table, after the "MoM" section, under a "Custom" group.

### To add a new custom column

1. At the bottom of the Custom columns card you will see a row with: a **name box**, a **type dropdown**, an optional **options box**, and an **"Add column"** button.
2. Type the column name (e.g. "Trial ends" or "BI dashboard").
3. Pick the type:
   - **text** — leave the options box empty.
   - **checkbox** — leave the options box empty.
   - **droplist** — type the options separated by commas, e.g. `Active, Paused, Stalled, At risk`.
4. Click **Add column**.
5. The new column appears immediately, both in the list above and at the end of the Clients table.

### To edit an existing custom column

- **Rename:** click in the name box, type the new name, click out.
- **Edit droplist options:** click in the options box, change the comma-separated list, click out. (Be careful: if you remove an option that is already selected on some clients, those clients will show "—" until someone picks a new option for them.)
- **Change the type** is not supported. If you need to switch a text column to a droplist, delete it and create a new one.

### To delete a custom column

Click the red **Delete** button on its row. You will be asked to confirm. Deleting a column **permanently** removes all values that have been entered against it for every client. There is no undo.

### Filling in custom column values

You (master admin) fill these in directly in the **Clients page**, not in Settings. Open the Clients page, find each custom column at the right end of the table, and:

- For **text** — click the cell, type, click out.
- For **checkbox** — tick or untick the box.
- For **droplist** — pick an option from the dropdown.

Other internal admins (regular admins, CS managers) **can see** these values but **cannot edit** them. Only you can change them. This is intentional so the data stays consistent.

---

## 3. Setting up warnings (Simple triggers)

**Where:** Settings → Simple triggers.

This is where you decide when the system should colour a cell **yellow** (warning) or **red** (problem). Each row is one metric. You set a yellow threshold, a red threshold, and an optional message.

### What you see

A list of cards, one per metric. Currently:

- **Min daily sent** — alert when the client's actual sent volume is below the threshold.
- **Inboxes count** — alert when the client has fewer inboxes than the threshold.
- **KPI Leads progress** — alert when KPI leads progress is below the threshold.
- **KPI Meetings progress** — alert when KPI meetings progress is below the threshold.

For each metric you see:

- A short note ("alert when below threshold" — meaning the alert fires when the value drops *below* what you set)
- A **Yellow** number input
- A **Red** number input
- An optional **message** field (what the tooltip says when the cell is coloured)
- A **Save** button

### To set or change a threshold

1. Find the metric row.
2. Type the yellow number in the **Yellow** box (e.g. `500` for Min daily sent — cell turns yellow when the client sends fewer than 500).
3. Type the red number in the **Red** box (e.g. `200` — cell turns red when fewer than 200).
4. Type a message in the **message** box if you want the user to see context on hover (e.g. "Below contracted volume").
5. Click **Save**.

The Clients page will start colouring cells the next time it loads.

### To remove a warning

1. Clear both the **Yellow** and **Red** boxes (leave them empty).
2. Click **Save**.
3. The warning is removed entirely — the cells will no longer be coloured for that metric.

### How yellow and red interact

- If the value is **below the red threshold** → cell is **red** (the worst alert wins).
- Otherwise, if it is **below the yellow threshold** → cell is **yellow**.
- Otherwise → no colour.

If you only set yellow and leave red empty, only yellow alerts will fire. If you only set red and leave yellow empty, only red alerts will fire. Both is the normal case.

### A worked example

You want the **Min daily sent** column to highlight clients sending less than they should:

- Yellow: `500` (warn at less than 500/day — slipping)
- Red: `200` (alarm at less than 200/day — broken)
- Message: `Below contracted volume — check inboxes and warm-up status`

Click Save. Now any client sending 199/day or fewer will have a red cell with that tooltip, anyone between 200 and 499 will have a yellow cell, and anyone at 500+ will be normal.

### What you cannot set here (yet)

- More complex conditions like "Yellow when below 500 *and* the client status is Active." Use the **Conditions Engine** below — it's now available to you with a dropdown builder.
- Per-client thresholds (different yellow/red per client). The Simple triggers card sets one global threshold per metric. Use Conditions Engine for per-client rules.
- Custom metrics (anything not in the built-in list). New metrics need engineering work.

If you need any of the above, open **Conditions Engine** below — it covers most of these. If still stuck, message engineering.

---

## 3b. Conditions Engine — the full builder

**Where:** Settings → Conditions Engine (visible to you as master admin).

This is the next step up from Simple triggers. Same idea — colour cells based on metric values — but with:

- **Custom columns** you added (text / checkbox / droplist) appear in the metric dropdown under "Custom columns".
- **Per-client / per-manager scoping** — one rule can apply only to a specific client or only to clients of a specific manager.
- **Only active clients** toggle — skip Inactive / Offboarding / On-hold without typing anything.
- **Multiple conditions per band** — "alert when bounce ≥ 2% **or** complaint ≥ 0.5%" via a flat ALL/ANY toggle.
- **Compare two metrics** — instead of a fixed number, the right side of a comparison can be another numeric metric with an optional multiplier. Example: "MQLs is less than `KPI Leads × 0.8`" lights the cell red when actual leads slip under 80% of contracted target. Available on numeric/percent metrics.
- **Custom tooltip messages** per severity band.

Everything is dropdown-driven — there are no text fields where you need to know a magic name. The metric picker constrains operators (e.g. boolean custom column → only "Yes / No" options) and value inputs (e.g. droplist column → only the options you defined).

When you save a rule here, it appears alongside Simple-trigger rules in the same `Condition rules` list. Both surfaces write to the same engine.

For full reference on each section of the builder, see [Conditions Rules — Power-User Guide](conditions-rules-guide.md).

---

## Common questions

**Q: I renamed a column but my colleague still sees the old name.**
A: Ask them to refresh their browser. Renames take effect on the next page load.

**Q: Can a regular admin or CS manager add custom columns?**
A: No. Only the master admin can add, rename, or delete custom columns and built-in column overrides, and only the master admin can set or change Simple-trigger thresholds. Others see the columns and values but cannot edit them.

**Q: I deleted a custom column by accident. Can I get the data back?**
A: No. Deleting a custom column also removes all of its values across every client. Treat the red Delete button as final.

**Q: I see Settings → Conditions Engine. What is that?**
A: Only super-admins (engineering) see that. It is the underlying rules engine that Simple triggers writes to. You do not need to use it — Simple triggers is the user-friendly view on the same data.

**Q: I see "Master admin" written next to my name in the side panel — what does it mean?**
A: It just confirms which role you are signed in as. Master admin sees everything regular admins see, plus the customization and Simple-triggers sections in Settings.

**Q: A column I added does not appear in the Clients table.**
A: Refresh the Clients page. New columns appear at the very right end of the table (after the MoM section) — you may need to scroll right.

**Q: Can I undo a label override?**
A: Yes. Open Settings → Clients table customization, find the column, clear the text in the middle box, and click outside. The column reverts to its original built-in name.

---

## When to call engineering

You will need engineering help for any of the following:

- Adding a brand-new metric to the Simple-triggers list (e.g. "DoD Sent drop %").
- Setting a threshold that depends on more than one value, or that only applies to some clients.
- Reordering built-in columns or grouping them differently.
- Anything involving Smartlead, Bison, n8n, or external integrations.
- Inviting someone else as a master admin (this is a manual database operation by design).

For everything else listed in this guide, you do not need to ask — just do it.
