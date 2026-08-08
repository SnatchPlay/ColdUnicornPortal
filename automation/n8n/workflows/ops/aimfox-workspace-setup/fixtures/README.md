# Fixtures

Sanitized example payloads for `aimfox-workspace-setup`, matching
[`contracts/setup-input.schema.json`](../contracts/setup-input.schema.json) and
[`contracts/setup-result.schema.json`](../contracts/setup-result.schema.json).

**All values are synthetic.** No real client id, workspace UUID, API key or user id appears here.
Every UUID was invented for this folder. Fixtures must never be produced by copying a production
execution — see [security.md](../../../../../../docs/reference/n8n/security.md).

These are inputs for **reasoning and review**, not a runnable harness: the workflow calls the Aimfox
API with an agency master key, so it cannot be executed against a fixture without live credentials.
Do **not** run it against production to "try" one — a real run creates webhooks in a client's
workspace.

> `pnpm n8n:validate` scans every fixture for secrets and requires the `_fixture` note, but it only
> schema-checks fixtures when `contracts/hub-child-input.schema.json` exists — that filename is
> hardcoded in `scripts/n8n/validate.mjs`. The schemas here are therefore **not** enforced by CI.
> Generalising the validator to pick up any `*-input.schema.json` is tracked as a follow-up.

| File | Case | Expected result |
|---|---|---|
| `already-configured.json` | fully wired workspace, apply | every step `ok`, `state: configured`, nothing created |
| `fresh-workspace.json` | workspace exists at the vendor, nothing wired, apply | key minted, 2 webhooks + 2 labels created, `state: partial` |
| `dry-run-missing-label.json` | the FortumEnergia shape — `preMQL` label absent — checked, not applied | `labels.outcome: missing`, `state: partial`, **nothing written** |
| `webhook-named-differently.json` | the GIC shape — the `lead_label_added` webhook is named `Manual Tag` | `webhooks.outcome: ok`. Matching on name would create a duplicate; invariant 4 |
| `key-at-vendor-only.json` | the Natalia Kobielska shape — token exists at the vendor, never stored | key reused, not minted a second time |
| `name-ambiguous.json` | two workspaces match the client name | `state: needs_selection`, candidates listed, nothing written |
| `explicit-workspace.json` | the operator answered a `needs_selection` by choosing | `resolved.matched_by: explicit`, no name search |
