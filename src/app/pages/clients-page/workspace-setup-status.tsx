import type { ClientSequencerRecord, WorkspaceSetupState, WorkspaceSetupStep } from "../../types/core";
import type { ClientSequencerCreds } from "./client-drawer";

/**
 * What workspace provisioning last observed, per sequencer
 * ([process](docs/reference/processes/ops/workspace-provisioning.md)).
 *
 * Read-only, and deliberately so: `setup_state` is written **only** by the two n8n workflows
 * (ADR-0018 §6). The portal renders their verdict and never edits it. The "Перевірити" /
 * "Налаштувати" buttons arrive with the `requestWorkspaceSetup` gateway action, which needs the
 * workflows' webhook trigger to exist first.
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

function SequencerCard({ label, row }: { label: string; row: ClientSequencerRecord | null }) {
  // No row at all is a provisioning state, not an absent one — the whole point of this section.
  if (!row) {
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">{label}</span>
          <Pill tone="bad">{stateLabel("no_connector")}</Pill>
        </div>
        <p className="text-xs text-white/50">
          This client is not connected to {label} at all — no workspace, no key. Leads sent there
          would arrive nowhere.
        </p>
      </div>
    );
  }

  const setup: WorkspaceSetupState = row.setup_state ?? {};
  const state: DisplayState = setup.state ?? "never";
  const checked = describeChecked(row.setup_checked_at);
  const steps = orderedSteps(setup.steps ?? {});

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-white">{label}</span>
        <Pill tone={stateTone(state)}>{stateLabel(state)}</Pill>
        {/* Staleness is its own claim, next to the verdict rather than under it. */}
        {checked?.stale ? <Pill tone="warn">stale</Pill> : null}
      </div>

      <p className={`text-[11px] ${checked?.stale ? "text-amber-200/70" : "text-white/40"}`}>
        {checked ? `Checked ${checked.text}` : "Never checked — nothing has looked at this workspace yet."}
      </p>

      {/* Labelled "stored" because it comes from the connector row, not from the run. Without that
          word a `needs_selection` card reads as a contradiction — "workspace not chosen" directly
          above a workspace id. */}
      {row.external_workspace_id ? (
        <p className="break-all font-mono text-[11px] text-white/40">
          stored workspace {row.external_workspace_id}
        </p>
      ) : null}

      {/* A row of identical "not checked" pills carries no information; the state pill already says
          the run never got that far. Show the steps only when at least one was actually decided. */}
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
      {setup.dry_run === true && state !== "configured" ? (
        <p className="text-[11px] text-white/40">Last run was a check — nothing was created.</p>
      ) : null}
    </div>
  );
}

export function WorkspaceSetupStatus({ creds }: { creds: ClientSequencerCreds }) {
  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="border-l-2 border-sky-400/50 pl-3">
        <p className="text-sm font-medium text-white">Workspace provisioning</p>
        <p className="text-xs text-white/50">
          What the setup workflows last found in this client's sending systems. There is no
          scheduled re-check, so every verdict below is only as current as its date.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SequencerCard label={SEQUENCER_LABELS.emailbison} row={creds.emailbison} />
        <SequencerCard label={SEQUENCER_LABELS.aimfox} row={creds.aimfox} />
      </div>
    </section>
  );
}
