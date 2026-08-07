# Fixtures

Sanitized example payloads for `bison-workspace-setup`, matching
[`contracts/setup-input.schema.json`](../contracts/setup-input.schema.json) and
[`contracts/setup-result.schema.json`](../contracts/setup-result.schema.json).

**All values are synthetic.** No real client id, workspace id, API key or user id appears here.
Every UUID was invented for this folder, and the workspace ids are deliberately out of the range
production uses. Fixtures must never be produced by copying a production execution — see
[security.md](../../../../../../docs/reference/n8n/security.md).

These are inputs for **reasoning and review**, not a runnable harness: the workflow calls the Bison
API with an agency master key, so it cannot be executed against a fixture without live credentials.
Do **not** run it against production to "try" one — a real run of iteration 2 creates webhooks in a
client's sending system.

> Same validator gap as the Aimfox folder: `pnpm n8n:validate` scans fixtures for secrets and
> requires the `_fixture` note, but only schema-checks them when `contracts/hub-child-input.schema.json`
> exists, because that filename is hardcoded in `scripts/n8n/validate.mjs`. The schemas here are
> therefore **not** enforced by CI. Generalising the validator is tracked as a follow-up.

| File | Case | Expected result |
|---|---|---|
| `already-configured.json` | fully wired workspace, apply | every step `ok`, `state: configured`, nothing created |
| `fresh-workspace.json` | workspace exists at the vendor, nothing wired, apply | key minted and **stored**, 2 webhooks + 2 tags created, campaigns reported missing, `state: partial` |
| `webhook-named-differently.json` | the UniTalk shape — the `lead_replied` webhook is named `Reply Classification` | `webhooks.outcome: ok`. Matching on name would create a duplicate; invariant 4 |
| `no-mql-tag.json` | a workspace without an `MQL` tag — 9 of 16 Active ones | `state: configured`. `MQL` is **not** in the Bison canonical set; the MQL path runs off the built-in `Interested` tag |
| `duplicate-campaigns.json` | the Bent Iron PL shape — the OOO triple was created twice | `campaigns.present` shows `×2`, `outcome: ok`, and nothing is created to "fix" it |
| `name-ambiguous.json` | two workspaces match the client name | `state: needs_selection`, candidates carry `personal_team` / `main` / `parent_id`, nothing written |
| `client-not-found.json` | a `client_id` with no enabled `emailbison` connector | `state: client_not_found` with a reason — never a silent success |
