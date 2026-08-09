import { useState } from "react";
import { toast } from "sonner";
import { repository } from "../../data/repository";
import { cn } from "../../components/ui/utils";
import type { ClientSequencerRecord, WorkspaceSetupState, WorkspaceSetupStep } from "../../types/core";
import type { WorkspaceSetupResult } from "../../types/view-contracts";
import type { ClientSequencerCreds } from "./client-drawer";

/**
 * The **Credentials & IDs** section of the client drawer: one card per sequencer carrying both the
 * connection settings n8n reads and what provisioning last found in that workspace
 * ([process](docs/reference/processes/ops/workspace-provisioning.md)).
 *
 * The two used to be separate sections, and that was wrong twice over. A key being present says
 * nothing about whether the workspace is wired — Fortum had a key and no `preMQL` label for weeks —
 * so the verdict belongs next to the field that raises the question, not two sections away. And
 * four credential inputs shown unconditionally is noise for the reader who has them: a CS manager
 * needs to know that EmailBison is configured, not what the key is. So the card answers that in one
 * line and keeps keys, per-step detail and the run buttons behind a disclosure.
 *
 * The portal never edits `setup_state` — it is written only by the two n8n workflows. What the
 * buttons do is *ask n8n to run*, through the single outbound call the gateway is allowed to make
 * (ADR-0018). "Check" reads and reports; "Set up" creates what is missing in a client's sending
 * system, so it asks first.
 *
 * The distinction this section exists to make visible: **a client with no connector row is not
 * "unknown", it is "missing"**. Audytel sat in exactly that gap while three of its leads were
 * dropped, and nothing anywhere said so.
 */

const SEQUENCER_LABELS = { emailbison: "EmailBison", aimfox: "Aimfox" } as const;

// Fixed order, not `Object.entries` order. The workflows emit keys in their own sequence and the
// two vendors do not agree (Aimfox has `labels`, Bison has `tags`), so reading the object's order
// made the list reshuffle between clients — two cards side by side could not be compared row by
// row. Anything the workflows report that is not listed here is appended, never dropped.
const STEP_ORDER = ["key", "webhooks", "labels", "tags", "campaigns"] as const;

const STEP_LABELS: Record<string, string> = {
  key: "API key",
  webhooks: "Webhooks",
  labels: "Labels",
  tags: "Tags",
  campaigns: "Campaigns",
};

// The outcome has to be readable as a word. Colour alone fails the contrast axis, fails colour
// blindness, and — worse here — cannot distinguish "we created this" from "this already existed",
// which are different facts about someone's sending system.
const OUTCOME_WORDS: Record<WorkspaceSetupStep["outcome"], string> = {
  ok: "ok",
  created: "created",
  missing: "missing",
  skipped: "not checked",
  failed: "failed",
};

type Tone = "good" | "new" | "warn" | "bad" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  good: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  new: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  warn: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  bad: "border-red-400/40 bg-red-500/10 text-red-100",
  muted: "border-border bg-black/10 text-muted-foreground",
};

/** Past this, a "configured" verdict is an old observation and is shown as one. */
const STALE_AFTER_DAYS = 30;

type DisplayState = WorkspaceSetupState["state"] | "never" | "no_connector";

function stateTone(state: DisplayState): Tone {
  switch (state) {
    case "configured":
      return "good";
    case "partial":
    case "needs_selection":
      return "warn";
    case "missing":
    case "no_connector":
    case "client_not_found":
      return "bad";
    default:
      return "muted";
  }
}

function stateLabel(state: DisplayState): string {
  switch (state) {
    case "configured":
      return "Configured";
    case "partial":
      return "Partly configured";
    case "missing":
      return "Not wired";
    case "needs_selection":
      return "Workspace not chosen";
    case "client_not_found":
      return "No connector enabled";
    case "no_connector":
      return "No connector";
    default:
      return "Never checked";
  }
}

/**
 * The one line a reader who does not open the card gets. It has to carry the whole answer, so it
 * says what was found *and* when — a verdict with no date is the claim this section must not make.
 */
function stateSummary(state: DisplayState, label: string): string {
  switch (state) {
    case "configured":
      return "Everything this client needs is in place.";
    case "partial":
      return "Some of what this client needs is missing.";
    case "missing":
      return "Nothing is set up in this workspace yet.";
    case "needs_selection":
      return "More than one workspace could be this client's — nobody has said which.";
    case "client_not_found":
      return `This client has a ${label} row, but the connector is not enabled.`;
    case "no_connector":
      return `Not connected to ${label} at all — no workspace, no key. Leads sent there would arrive nowhere.`;
    default:
      return "Nothing has looked at this workspace yet.";
  }
}

function stepTone(outcome: WorkspaceSetupStep["outcome"]): Tone {
  if (outcome === "ok") return "good";
  if (outcome === "created") return "new";
  if (outcome === "missing") return "warn";
  if (outcome === "failed") return "bad";
  return "muted";
}

/**
 * Absolute date plus how long ago. The absolute date alone made a six-week-old "Configured" look
 * exactly like a four-minute-old one — which is precisely the claim this section must not make,
 * given there is no scheduled drift check.
 */
function describeChecked(value: string | null): { text: string; stale: boolean } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const ago = days >= 1 ? plural(days, "day") : hours >= 1 ? plural(hours, "hour") : plural(minutes, "min");
  return {
    text: `${date.toLocaleDateString(undefined, { dateStyle: "medium" })} · ${ago}`,
    stale: days >= STALE_AFTER_DAYS,
  };
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function orderedSteps(steps: Record<string, WorkspaceSetupStep>): Array<[string, WorkspaceSetupStep]> {
  const known = STEP_ORDER.filter((key) => steps[key]).map((key) => [key, steps[key]] as [string, WorkspaceSetupStep]);
  const extra = Object.entries(steps).filter(([key]) => !STEP_ORDER.includes(key as (typeof STEP_ORDER)[number]));
  return [...known, ...extra];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{children}</span>
  );
}

/**
 * A key the operator can reveal but that is not on screen by default. Lives here rather than in the
 * drawer because the credentials section is the only thing that ever renders one.
 */
function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        type={shown ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 pr-14 font-mono text-sm outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.12em] text-white/40 transition hover:text-white"
        >
          {shown ? "hide" : "show"}
        </button>
      )}
    </div>
  );
}

/** Read-only value with reveal + copy. Used for CRM status, which the portal does not edit. */
function MaskedField({ label, value, mask = false }: { label: string; value: string | null; mask?: boolean }) {
  const [shown, setShown] = useState(!mask);
  const [copied, setCopied] = useState(false);

  const displayValue = value === null || value === "" ? null : value;
  const masked = displayValue && !shown ? "•".repeat(Math.min(displayValue.length, 12)) : displayValue;

  const doCopy = async () => {
    if (!displayValue) return;
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="min-w-[140px] text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span className="flex-1 truncate font-mono text-xs text-white/80">{masked ?? "—"}</span>
      {displayValue && mask && (
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="text-[10px] uppercase tracking-[0.12em] text-white/40 transition hover:text-white"
        >
          {shown ? "hide" : "show"}
        </button>
      )}
      {displayValue && (
        <button
          type="button"
          onClick={() => {
            void doCopy();
          }}
          className={cn(
            "rounded-md border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition",
            copied ? "border-emerald-400/40 text-emerald-200" : "text-white/40 hover:text-white",
          )}
        >
          {copied ? "✓" : "copy"}
        </button>
      )}
    </div>
  );
}

function SequencerCard({
  label,
  row,
  clientId,
  sequencerKey,
  fields,
  dirty,
}: {
  label: string;
  row: ClientSequencerRecord | null;
  clientId: string;
  sequencerKey: "emailbison" | "aimfox";
  /** The credential inputs for this vendor — the card stays vendor-agnostic. */
  fields: React.ReactNode;
  /** True when the draft's credentials for this vendor differ from what is stored. */
  dirty: boolean;
}) {
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [open, setOpen] = useState(false);
  // The run's own answer, shown until the page reloads. `setup_state` in the database is updated by
  // the workflow, but this component is fed by a payload the page loaded earlier — without this the
  // card would still show the previous verdict after a successful run.
  const [fresh, setFresh] = useState<WorkspaceSetupResult | null>(null);

  // Never collapse over an unsaved edit: the Save bar at the top of the drawer would then be armed
  // by a field the operator cannot see. While dirty the disclosure is not offered at all rather
  // than offered and ignored — a control that does nothing is worse than no control.
  const expanded = open || dirty;

  const run = async (mode: "check" | "apply") => {
    if (mode === "apply") {
      const confirmed = window.confirm(
        `Provision ${label} for this client?\n\nThis creates whatever is missing — webhooks, ` +
          `labels or tags — inside the client's own ${label} workspace. It never deletes anything, ` +
          `and running it twice changes nothing the second time.`,
      );
      if (!confirmed) return;
    }
    setBusy(mode);
    try {
      const result = await repository.requestWorkspaceSetup({
        clientId,
        sequencerKey,
        dryRun: mode === "check",
      });
      setFresh(result);
      if (result.state === "unknown") {
        // Not an error and not a success. The run may still be going, so the honest instruction is
        // "check again", never "try again" (ADR-0018 §5).
        toast.warning(`${label}: no answer yet — the run may still be going. Check again shortly.`);
      } else if (result.recorded === false) {
        toast.warning(`${label}: ${result.state}, but the result could not be recorded.`);
      } else {
        toast.success(`${label}: ${result.state.replace(/_/g, " ")}`);
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : `Could not reach ${label} provisioning.`);
    } finally {
      setBusy(null);
    }
  };

  // No row at all is a provisioning state, not an absent one — the whole point of this section.
  const setup: WorkspaceSetupState = row?.setup_state ?? {};

  // A run that just answered is the newest thing known about this workspace, and the card has to
  // say so. The page payload was loaded before the run, so reading only `row` left the header on
  // "Never checked" directly above "Just now: configured" — the card contradicting itself, with
  // the stale half on top where it gets read first.
  //
  // `unknown` is excluded on purpose: it means the run gave no answer (ADR-0018 §5), so the last
  // recorded verdict is still the best thing known. `recorded: false` is NOT excluded — the run
  // did observe the workspace, only the write-back failed, and RunNotes says so underneath.
  const live = fresh && fresh.state !== "unknown" ? fresh : null;

  const state: DisplayState = live ? live.state : row ? (setup.state ?? "never") : "no_connector";
  const checked = live
    ? { text: "just now", stale: false }
    : row
      ? describeChecked(row.setup_checked_at)
      : null;
  const steps = orderedSteps(live?.steps ?? setup.steps ?? {});
  const wasDryRun = live ? live.dry_run : setup.dry_run;

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      {/* The toggle is a sibling of the wrapping pill group, not part of it: inside, a long verdict
          pushed it onto its own line on one card and not the other, and two cards side by side have
          to line up or they cannot be compared at a glance. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">{label}</span>
          <Pill tone={stateTone(state)}>{stateLabel(state)}</Pill>
          {/* Staleness is its own claim, next to the verdict rather than under it. */}
          {checked?.stale ? <Pill tone="warn">stale</Pill> : null}
          {dirty ? <Pill tone="new">unsaved</Pill> : null}
        </div>
        {!dirty && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            {expanded ? "Hide" : "Details"}
          </button>
        )}
      </div>

      <p className="text-[11px] text-white/50">{stateSummary(state, label)}</p>
      {/* Only when there is a date to give. With none, the pill already says "Never checked" and
          the sentence above already explains it — a third line saying it again is the noise this
          section was collapsed to remove. */}
      {checked ? (
        <p className={`text-[11px] ${checked.stale ? "text-amber-200/70" : "text-white/40"}`}>
          Checked {checked.text}
        </p>
      ) : null}

      {expanded ? (
        <div className="space-y-3 border-t border-white/10 pt-3">
          {fields}

          {/* Labelled "stored" because it comes from the connector row, not from the run. Without
              that word a `needs_selection` card reads as a contradiction — "workspace not chosen"
              directly above a workspace id. */}
          {row?.external_workspace_id && sequencerKey !== "emailbison" ? (
            <p className="break-all font-mono text-[11px] text-white/40">
              stored workspace {row.external_workspace_id}
            </p>
          ) : null}

          {/* A row of identical "not checked" pills carries no information; the state pill already
              says the run never got that far. Show the steps only when at least one was decided. */}
          {steps.some(([, step]) => step.outcome !== "skipped") ? (
            <div className="flex flex-wrap gap-1.5">
              {steps.map(([key, step]) => (
                <Pill key={key} tone={stepTone(step.outcome)}>
                  {STEP_LABELS[key] ?? key} · {OUTCOME_WORDS[step.outcome] ?? step.outcome}
                  {step.missing?.length ? ` (${step.missing.length})` : ""}
                </Pill>
              ))}
            </div>
          ) : null}

          {/* A dry run reports the same steps as a real one. Say so where it changes the meaning —
              on anything short of "configured", "missing" means "we only looked", not "we tried". */}
          {wasDryRun === true && state !== "configured" ? (
            <p className="text-[11px] text-white/40">Last run was a check — nothing was created.</p>
          ) : null}

          <RunButtons busy={busy} onRun={run} />
          {fresh ? <RunNotes result={fresh} /> : null}
        </div>
      ) : (
        // A finished run must not vanish because the card was collapsed afterwards.
        fresh && <RunNotes result={fresh} />
      )}
    </div>
  );
}

function RunButtons({
  busy,
  onRun,
}: {
  busy: "check" | "apply" | null;
  onRun: (mode: "check" | "apply") => void;
}) {
  const base =
    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => onRun("check")}
        className={`${base} border-white/15 bg-white/5 text-white/80 hover:bg-white/10`}
      >
        {busy === "check" ? "Checking…" : "Check"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => onRun("apply")}
        className={`${base} border-sky-400/30 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20`}
      >
        {busy === "apply" ? "Provisioning…" : "Set up"}
      </button>
    </div>
  );
}

/**
 * What the run adds beyond the verdict. The verdict itself is not repeated here — the card header
 * already adopted it, and printing "Just now: configured" under a header reading "Never checked"
 * is how this component last managed to contradict itself on screen.
 */
function RunNotes({ result }: { result: WorkspaceSetupResult }) {
  const created = Object.values(result.steps ?? {}).flatMap((step) => step.created ?? []);
  const unknown = result.state === "unknown";
  if (!unknown && !result.reason && !created.length && !result.candidates?.length && result.recorded !== false) {
    return null;
  }
  return (
    <div className="space-y-1 rounded-lg border border-white/10 bg-black/30 p-2">
      {/* The one state the card does not adopt, so it has to be stated here instead. */}
      {unknown ? (
        <p className="text-[11px] text-amber-200/80">
          No answer yet — the run may still be going. Check again shortly; the verdict above is the
          last one on record.
        </p>
      ) : null}
      {result.reason ? <p className="text-[11px] text-white/50">{result.reason}</p> : null}
      {created.length ? (
        <p className="text-[11px] text-sky-200">Created: {created.join(", ")}</p>
      ) : null}
      {/* needs_selection is the one state the operator has to answer. Listing the candidates is the
          answer sheet; picking one is a re-run with an explicit workspace_id, which the UI does not
          do yet — so name them rather than pretend the state is actionable here. */}
      {result.candidates?.length ? (
        <p className="text-[11px] text-white/50">
          Unclaimed workspaces: {result.candidates.map((c) => c.name ?? c.workspace_id).join(", ")}
        </p>
      ) : null}
      {/* The verdict above is this run's, but nothing stored it. Say what that costs, because the
          card looks identical to a recorded one until the page is reloaded and the old value
          returns. */}
      {result.recorded === false ? (
        <p className="text-[11px] text-amber-200/80">
          Not recorded — the vendor work may have happened even though the database was not
          updated. Reloading this page will show the previous verdict again.
        </p>
      ) : null}
    </div>
  );
}

export function SequencerConnections({
  clientId,
  creds,
  crmConnected,
  externalWorkspaceId,
  externalApiKey,
  linkedinApiKey,
  onChange,
}: {
  clientId: string;
  creds: ClientSequencerCreds;
  crmConnected: boolean;
  externalWorkspaceId: string;
  externalApiKey: string;
  linkedinApiKey: string;
  onChange: (patch: {
    externalWorkspaceId?: string;
    externalApiKey?: string;
    linkedinApiKey?: string;
  }) => void;
}) {
  // Compared against the connector rows the draft was seeded from, so this is exactly the same
  // notion of dirty the drawer's Save bar uses for these three fields.
  const bisonDirty =
    externalWorkspaceId !== (creds.emailbison?.external_workspace_id ?? "") ||
    externalApiKey !== (creds.emailbison?.api_key ?? "");
  const aimfoxDirty = linkedinApiKey !== (creds.aimfox?.api_key ?? "");

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="border-l-2 border-sky-400/50 pl-3">
        <p className="text-sm font-medium text-white">Credentials & IDs</p>
        <p className="text-xs text-white/50">
          Per-sequencer connection settings read by n8n, and what the setup workflows last found in
          each workspace. There is no scheduled re-check, so every verdict is only as current as its
          date. Open a card for keys, per-step detail and the run buttons.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SequencerCard
          label={SEQUENCER_LABELS.emailbison}
          row={creds.emailbison}
          clientId={clientId}
          sequencerKey="emailbison"
          dirty={bisonDirty}
          fields={
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <FieldLabel>Workspace ID</FieldLabel>
                <input
                  type="text"
                  value={externalWorkspaceId}
                  onChange={(event) => onChange({ externalWorkspaceId: event.target.value })}
                  placeholder="e.g. 12345"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block space-y-1.5">
                <FieldLabel>API key</FieldLabel>
                <SecretInput
                  value={externalApiKey}
                  onChange={(value) => onChange({ externalApiKey: value })}
                  placeholder="Paste API key…"
                />
              </label>
            </div>
          }
        />
        <SequencerCard
          label={SEQUENCER_LABELS.aimfox}
          row={creds.aimfox}
          clientId={clientId}
          sequencerKey="aimfox"
          dirty={aimfoxDirty}
          fields={
            <label className="block space-y-1.5">
              <FieldLabel>API key</FieldLabel>
              {/* No workspace-id input on purpose: an Aimfox workspace is resolved by the setup
                  workflow and stored on the connector row, never typed in by hand. */}
              <SecretInput
                value={linkedinApiKey}
                onChange={(value) => onChange({ linkedinApiKey: value })}
                placeholder="Paste LinkedIn key…"
              />
            </label>
          }
        />
      </div>

      {/* Client-level, not per sequencer: the legacy CRM connection is one config blob for the
          whole client (ADR-0010), so it sits under both cards rather than inside either. */}
      <MaskedField label="CRM status" value={crmConnected ? "Connected" : null} />
    </section>
  );
}
