import { useState } from "react";
import { toast } from "sonner";
import { repository } from "../../data/repository";
import { cn } from "../../components/ui/utils";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import type { ClientSequencerRecord, WorkspaceSetupState, WorkspaceSetupStep } from "../../types/core";
import type { WorkspaceSetupResult } from "../../types/view-contracts";
import type { ClientSequencerCreds } from "./client-drawer";
import { SEQUENCER_TITLES, WorkspacePicker, type SequencerKey } from "./workspace-picker";

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

// Fixed order, not `Object.entries` order. The workflows emit keys in their own sequence and the
// two vendors do not agree (Aimfox has `labels`, Bison has `tags`), so reading the object's order
// made the list reshuffle between clients — two cards side by side could not be compared row by
// row. Anything the workflows report that is not listed here is appended, never dropped.
const STEP_ORDER = ["key", "webhooks", "labels", "tags", "campaigns", "routing"] as const;

const STEP_LABELS: Record<string, string> = {
  key: "API key",
  webhooks: "Webhooks",
  labels: "Labels",
  tags: "Tags",
  campaigns: "Campaigns",
  // Reported by bison-workspace-setup, which fills an EMPTY routing rule and never re-points one an
  // operator set. The live truth is the OOO routing section below — this is what the last run saw.
  routing: "OOO routing",
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
export function describeChecked(value: string | null): { text: string; stale: boolean } | null {
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

/**
 * The workspace id, entered either way the operator can honestly enter it.
 *
 * The New client sheet only ever offers the list, and that is right there: before the client row
 * exists every workspace it could claim is unclaimed, so the list is complete by construction. In
 * the drawer it is not. The listing filters out workspaces another client already claimed, and it is
 * a live vendor round trip that can fail or return nothing — so an id that cannot be picked still
 * has to be typeable. Hence two modes rather than replacing the input: this is the screen where a
 * connector gets repaired, and a repair screen that can only offer the happy path is not one.
 *
 * Both modes write the same draft field, so the drawer's Save bar and the card's "unsaved" pill work
 * exactly as they did. Picking here claims nothing by itself — it records which workspace is this
 * client's; Check and Set up are still what talk to the vendor.
 */
function WorkspaceIdField({
  sequencerKey,
  value,
  onChange,
  placeholder,
}: {
  sequencerKey: SequencerKey;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  // A client that already has an id is being read, not connected: show it as the plain string it is
  // rather than behind a dropdown that — the workspace being claimed — cannot list it back.
  const [mode, setMode] = useState<"list" | "manual">(value ? "manual" : "list");

  return (
    <div className="space-y-1.5">
      {/* Two cards sit side by side in a half-width drawer, so the label is kept off its own second
          line: a wrapped "Workspace / ID" pushed the toggle out of line between the two vendors. */}
      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
        <FieldLabel>Workspace ID</FieldLabel>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (next) setMode(next as "list" | "manual");
          }}
          variant="outline"
          className="shrink-0 border border-white/10"
        >
          <ToggleGroupItem
            value="list"
            className="h-6 flex-none whitespace-nowrap border-0 px-2 text-[10px] uppercase tracking-[0.12em]"
          >
            From list
          </ToggleGroupItem>
          <ToggleGroupItem
            value="manual"
            className="h-6 flex-none whitespace-nowrap border-0 px-2 text-[10px] uppercase tracking-[0.12em]"
          >
            Type it
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {mode === "list" ? (
        <WorkspacePicker
          sequencerKey={sequencerKey}
          label={null}
          chosen={value ? { workspace_id: value, name: null } : null}
          onChoose={(choice) => onChange(choice?.workspace_id ?? "")}
          triggerClassName="rounded-xl px-3 py-2"
          emptyHint={`Every ${SEQUENCER_TITLES[sequencerKey]} workspace already belongs to a client — including this one, if it is already connected. Type the id to set it anyway.`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        />
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
  draftWorkspaceId,
}: {
  label: string;
  row: ClientSequencerRecord | null;
  clientId: string;
  sequencerKey: SequencerKey;
  /** The credential inputs for this vendor — the card stays vendor-agnostic. */
  fields: React.ReactNode;
  /** True when the draft's credentials for this vendor differ from what is stored. */
  dirty: boolean;
  /** The workspace id currently in the drawer's draft — saved or not. See `run`. */
  draftWorkspaceId: string;
}) {
  const [busy, setBusy] = useState<"check" | "apply" | null>(null);
  const [open, setOpen] = useState(false);
  // The run's own answer, shown until the page reloads. `setup_state` in the database is updated by
  // the workflow, but this component is fed by a payload the page loaded earlier — without this the
  // card would still show the previous verdict after a successful run.
  const [fresh, setFresh] = useState<WorkspaceSetupResult | null>(null);
  // The workspace the operator picked out of a `needs_selection` list, held so every later run from
  // this card carries it. See `run` for why forgetting it strands a brand-new client.
  const [picked, setPicked] = useState<string | null>(null);

  // Never collapse over an unsaved edit: the Save bar at the top of the drawer would then be armed
  // by a field the operator cannot see. While dirty the disclosure is not offered at all rather
  // than offered and ignored — a control that does nothing is worse than no control.
  const expanded = open || dirty;

  /**
   * `workspaceId` answers a previous `needs_selection` — the operator naming which of the vendor's
   * workspaces is this client's. Picking one runs as a check: naming a workspace is a claim about
   * our own records and should not also write into the vendor in the same click.
   *
   * The pick has to be remembered, and that is not a convenience. For a client that already has a
   * connector row, `Record` persists the id on the dry run itself (its ON CONFLICT branch coalesces
   * a null `external_workspace_id`; dry_run protects the vendor, not our database). For a *new*
   * client there is no row yet, and `Record`'s `INSERT … SELECT … WHERE` refuses to create one on a
   * dry run — correctly, since creating it would make the client connected. So nothing is stored,
   * and a subsequent Set up sent without the id would resolve from scratch and land right back in
   * `needs_selection`. Holding the pick for the life of the card is what closes that loop.
   *
   * The draft's own workspace id is the last fallback, and it is what makes the field above and
   * these buttons one control rather than two. Without it, choosing a workspace and pressing Check
   * before Save sent no id at all: the workflow resolved by name from scratch and answered
   * `needs_selection` again — the card ignoring the answer the operator had just given it. Order is
   * most-recent-intent first: this click, then a chip picked earlier in this card's life, then the
   * field. An empty field is not an id, so it stays `null` and the workflow resolves as before.
   */
  const run = async (mode: "check" | "apply", workspaceId?: string) => {
    if (mode === "apply") {
      const confirmed = window.confirm(
        `Provision ${label} for this client?\n\nThis creates whatever is missing — webhooks, ` +
          `labels or tags — inside the client's own ${label} workspace. It never deletes anything, ` +
          `and running it twice changes nothing the second time.`,
      );
      if (!confirmed) return;
    }
    const effectiveWorkspaceId = workspaceId ?? picked ?? (draftWorkspaceId.trim() || null);
    if (workspaceId) setPicked(workspaceId);
    setBusy(mode);
    try {
      const result = await repository.requestWorkspaceSetup({
        clientId,
        sequencerKey,
        workspaceId: effectiveWorkspaceId,
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
          {fresh ? <RunNotes result={fresh} busy={busy !== null} onPick={(id) => void run("check", id)} /> : null}
        </div>
      ) : (
        // A finished run must not vanish because the card was collapsed afterwards.
        fresh && <RunNotes result={fresh} busy={busy !== null} onPick={(id) => void run("check", id)} />
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
function RunNotes({
  result,
  busy,
  onPick,
}: {
  result: WorkspaceSetupResult;
  busy: boolean;
  onPick: (workspaceId: string) => void;
}) {
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
      {/* needs_selection is the one state only a human can answer, and for a new client it is the
          normal one, not an edge case: provisioning matches on an exact name, and a live run on
          2026-08-09 put Fab.Marketingu here with three candidates. So the candidates are the
          control, not a list to read and retype elsewhere — the `workspaceId` leg of the payload
          has existed since ADR-0018 and had nothing wired to it.
          Already filtered of workspaces claimed by other clients, server-side. */}
      {result.candidates?.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/50">
            Which of these is this client? Picking one claims it and re-checks — it writes nothing
            into the vendor.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.candidates.map((candidate) => (
              <button
                key={candidate.workspace_id}
                type="button"
                disabled={busy}
                onClick={() => onPick(candidate.workspace_id)}
                title={`Workspace ${candidate.workspace_id}`}
                className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {candidate.name ?? candidate.workspace_id}
              </button>
            ))}
          </div>
        </div>
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
  aimfoxWorkspaceId,
  onChange,
}: {
  clientId: string;
  creds: ClientSequencerCreds;
  crmConnected: boolean;
  externalWorkspaceId: string;
  externalApiKey: string;
  linkedinApiKey: string;
  aimfoxWorkspaceId: string;
  onChange: (patch: {
    externalWorkspaceId?: string;
    externalApiKey?: string;
    linkedinApiKey?: string;
    aimfoxWorkspaceId?: string;
  }) => void;
}) {
  // Compared against the connector rows the draft was seeded from, so this is exactly the same
  // notion of dirty the drawer's Save bar uses for these three fields.
  const bisonDirty =
    externalWorkspaceId !== (creds.emailbison?.external_workspace_id ?? "") ||
    externalApiKey !== (creds.emailbison?.api_key ?? "");
  const aimfoxDirty =
    linkedinApiKey !== (creds.aimfox?.api_key ?? "") ||
    aimfoxWorkspaceId !== (creds.aimfox?.external_workspace_id ?? "");

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
          label={SEQUENCER_TITLES.emailbison}
          row={creds.emailbison}
          clientId={clientId}
          sequencerKey="emailbison"
          dirty={bisonDirty}
          draftWorkspaceId={externalWorkspaceId}
          fields={
            <div className="space-y-3">
              <WorkspaceIdField
                key={`${clientId}-emailbison`}
                sequencerKey="emailbison"
                value={externalWorkspaceId}
                onChange={(value) => onChange({ externalWorkspaceId: value })}
                placeholder="e.g. 12345"
              />
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
          label={SEQUENCER_TITLES.aimfox}
          row={creds.aimfox}
          clientId={clientId}
          sequencerKey="aimfox"
          dirty={aimfoxDirty}
          draftWorkspaceId={aimfoxWorkspaceId}
          fields={
            <div className="space-y-3">
              {/* This field exists because `needs_selection` is not an edge case: provisioning
                  matches on an exact name, and a live dry run on 2026-08-09 put Fab.Marketingu in
                  that state with three candidates. Without somewhere to put the chosen id, the
                  card would list the answers and offer no way to give one. */}
              <WorkspaceIdField
                key={`${clientId}-aimfox`}
                sequencerKey="aimfox"
                value={aimfoxWorkspaceId}
                onChange={(value) => onChange({ aimfoxWorkspaceId: value })}
                placeholder="Resolved by provisioning — or paste one to claim it"
              />
              <label className="block space-y-1.5">
                <FieldLabel>API key</FieldLabel>
                <SecretInput
                  value={linkedinApiKey}
                  onChange={(value) => onChange({ linkedinApiKey: value })}
                  placeholder="Obtained by provisioning — paste only to override"
                />
              </label>
            </div>
          }
        />
      </div>

      {/* Client-level, not per sequencer: the legacy CRM connection is one config blob for the
          whole client (ADR-0010), so it sits under both cards rather than inside either. */}
      <MaskedField label="CRM status" value={crmConnected ? "Connected" : null} />
    </section>
  );
}
