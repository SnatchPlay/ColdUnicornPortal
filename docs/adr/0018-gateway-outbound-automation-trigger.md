# ADR 0018: The gateway may trigger automation, and nothing else outbound

## Status
Accepted 2026-08-07

## Context

Workspace provisioning ([process](../reference/processes/ops/workspace-provisioning.md)) is now two
n8n workflows that resolve a client's Aimfox or Bison workspace, read what is already wired, and add
only what is missing. Both are proven against production. Neither has a way to be started by a human
using the portal: the only entry point is n8n's own **Execute workflow** button, and the n8n public
REST API has no run endpoint at all — `POST /workflows/{id}/run` does not exist, and probing for one
finds `/activate`, which is a different and far more dangerous verb.

So the team's actual workflow today is: open n8n, find the workflow, paste a `client_id`, press
Execute, read the JSON. That is not something to ask a CS manager to do, and it is the reason the
provisioning gaps found on 2026-08-07 — FortumEnergia without a `preMQL` label, GIC without `MQL`,
Audytel without a connector at all — were invisible until somebody went looking by hand.

The portal needs one button. The button needs the gateway to make an outbound HTTP call.

**That is a new capability, and it deserves a decision rather than a commit.** Until now
[`orm-gateway`](../../supabase/functions/orm-gateway/index.ts) has had exactly one dependency: the
database. Every request it serves ends in Postgres. Giving it a second, network-shaped dependency
changes its failure modes (timeouts, partial success, a third party's availability inside a request
the browser is waiting on) and, more importantly, changes what an attacker who finds a flaw in it
can reach.

The alternatives considered:

- **A queue table the portal writes and n8n polls.** No outbound call, no new trust surface, and the
  gateway stays purely a database function. Rejected: it converts a synchronous question ("is this
  client configured?") into an asynchronous one, so the UI has to poll, the operator waits without
  knowing how long, and a stuck row is invisible. It also adds a table whose only purpose is to
  avoid an HTTP request.
- **The browser calls n8n directly.** Rejected outright — it puts an automation secret in the
  browser and bypasses RLS, contradicting [ADR-0008](0008-orm-gateway-edge-function.md).
- **A second edge function for outbound calls.** Rejected: it is a second HTTP layer with a second
  auth story, and CLAUDE.md §5 forbids exactly that. The gateway already re-establishes the caller's
  identity per transaction; that is the check this feature needs, and duplicating it elsewhere means
  maintaining two copies of the rule about who may provision a client.

## Decision

### 1. `orm-gateway` may make outbound calls of exactly one class: triggering a repository-tracked n8n workflow

Not "outbound calls". Not "webhooks". One class, enumerated in code as a closed list of workflow
triggers, each with a fixed URL read from an environment variable. A new outbound destination is a
new environment variable and a new entry in that list — a visible change, not a parameter.

The gateway must **never** call a vendor (Aimfox, Bison, Google) directly. Those calls belong to
n8n, which holds the credentials. The gateway calls n8n; n8n calls the vendor. That boundary is what
keeps a vendor master key out of the edge function's environment entirely.

> **Amended 2026-08-09 — reading, through the same trigger.** The New client form has to offer the
> vendor's workspaces *before* a client row exists, so `requestWorkspaceSetup` accepts
> `clientId: null` and answers `state: "workspace_list"`. This stays inside the clause rather than
> widening it: same action, same closed URL list, no new destination, and the caller still names a
> sequencer rather than a URL. Two consequences had to be handled explicitly. Authorisation cannot
> be the usual `clients` pre-flight when there is no client, so listing is gated on the caller's
> role being internal — a `client` gets 403. And the mode cannot write: with no `client_id` the
> workflow terminates at `Needs Selection`, a node with no edge to `Record`, so refusing to write is
> structural rather than a flag.

### 2. The call carries a shared secret, and the workflow should verify it

`N8N_AUTOMATION_SHARED_SECRET`, sent as a header on every request. The receiving n8n webhook is
meant to use header auth.

> **Shipped in violation of this clause, deliberately.** The two provisioning webhooks went live on
> 2026-08-08 **unauthenticated**, at the owner's explicit direction after the alternative was offered
> and declined. The gateway sends `x-automation-secret` regardless, so turning verification on is a
> one-side change: create the credential, attach it, set the same value on the edge function.
>
> Registered as `unauthenticated-webhook` in both manifests' `knownViolations` with a review date of
> **2026-11-30**, and written up as
> [security finding 11](../reference/n8n/security.md#11-the-workspace-provisioning-webhooks-are-unauthenticated--medium-open).
> `pnpm n8n:validate` keeps reporting it as an accepted warning until that date, then fails.
>
> This note exists because the alternative — leaving the clause reading as though it were true — is
> worse than the gap it describes. A document that misreports its own system cannot be used to
> reason about it.

The existing Aimfox ingestion webhooks are unauthenticated for the same practical reason, and their
path is effectively a bearer token. The exposure a provisioning webhook adds is bounded and worth
stating precisely: the run is idempotent and additive against a closed canonical set, it never
deletes, the workspace is resolved from `client_sequencers` or an exact name match rather than from
the request, and **no credential is ever returned** (§4). What an unauthenticated caller can do is
force provisioning runs — burning vendor quota — and complete provisioning for a client we had
deliberately left unwired. What they cannot do is read a key or point us at a workspace of their
choosing.

### 3. Authorisation is the caller's role, checked the way every other action is

Provisioning is internal-only: `super_admin`, `admin`, `master_admin`, and a `manager` for a client
they are assigned. That is precisely `private.can_manage_client(client_id)` — the predicate already
guarding `client_sequencers`. The action resolves the client through RLS **before** it calls out, so
a caller who cannot see the row cannot trigger provisioning for it.

The check is therefore not new code. Getting zero rows back from the pre-flight read is the refusal.

### 4. No credential ever crosses back to the browser

The workflow's result contains `steps` describing what is present, not what it is. The contracts
forbid an `api_key` field outright (`additionalProperties: false`), and `client_sequencers.setup_state`
is documented as never holding a secret. The gateway derives booleans; the key stays server-side.

### 5. The call is synchronous, bounded, and may honestly fail

A full provisioning run is up to eight vendor calls. The gateway waits, with an explicit timeout,
and on timeout returns a result whose state says the outcome is unknown rather than a 500 or a
fabricated success. **A timed-out provisioning run may well have succeeded** — the workflow keeps
running after the gateway stops listening — so the UI must offer "check again", never "retry" as if
nothing happened.

### 6. Reading the status is not an outbound call

`client_sequencers.setup_state` and `setup_checked_at`
([`20260807`](../../supabase/migrations/20260807_workspace_setup_state.sql)) are ordinary columns on
a table the clients page already loads. The status the portal shows comes from the database, on the
existing `loadClientsOverview` action. **Only pressing the button goes out to the network.**

This is deliberate: the expensive, failure-prone path is on an explicit user action, and every page
load stays exactly as cheap as it was.

## Consequences

- The edge function gains `N8N_WORKSPACE_SETUP_URL_AIMFOX`, `N8N_WORKSPACE_SETUP_URL_BISON` and
  `N8N_AUTOMATION_SHARED_SECRET`. Absent configuration means the action refuses with a clear message
  — it does not fall back to anything.
- Both provisioning workflows gained a webhook trigger alongside their existing
  `executeWorkflowTrigger`, so the hand-run path keeps working. An `Input` node normalises the two
  trigger shapes — the webhook delivers under `body`, the sub-workflow trigger at the root — and is
  where `dry_run` is forced to a boolean. Anything but an explicit `false` is a check, so a partial
  or mistyped body cannot write. That guard matters more with the webhook open than it did before.
- `supabase functions list` must keep showing `orm-gateway` as `verify_jwt: true`. An outbound
  capability behind an unauthenticated function would be a serious defect.
- A future automation trigger (say, re-running a campaign sync for one client) is now a small,
  precedented change rather than a new argument. A future *non-trigger* outbound call — a webhook to
  Slack, a call to a vendor — is **not** covered by this ADR and needs its own.

## What this does not license

- Calling Aimfox, Bison, Google or any other vendor from the gateway. Ever.
- Passing a URL, host or path from the browser. The destination is chosen server-side from a closed
  list; the caller names a sequencer, not an address.
- Returning workflow internals — execution data, node output, credentials — to the browser. Only the
  documented result contract crosses back.
- Fire-and-forget calls the caller cannot observe. If the gateway cannot report what happened, it
  says so.
