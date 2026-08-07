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

// Step keys differ per vendor on purpose: Aimfox has labels, Bison has tags. Rendering whatever the
// workflow reported — rather than a fixed list — keeps this component honest when a canonical set
// changes, instead of silently hiding a new step.
const STEP_LABELS: Record<string, string> = {
  key: "API key",
  webhooks: "Webhooks",
  labels: "Labels",
  tags: "Tags",
  campaigns: "Campaigns",
};

type Tone = "good" | "warn" | "bad" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  good: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  warn: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  bad: "border-red-400/40 bg-red-500/10 text-red-100",
  muted: "border-border bg-black/10 text-muted-foreground",
};

function stateTone(state: WorkspaceSetupState["state"] | "never" | "no_connector"): Tone {
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

function stateLabel(state: WorkspaceSetupState["state"] | "never" | "no_connector"): string {
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
  if (outcome === "ok" || outcome === "created") return "good";
  if (outcome === "missing") return "warn";
  if (outcome === "failed") return "bad";
  return "muted";
}

/** Absolute, never "3 days ago": a stale check is only useful if you can see how stale. */
function formatChecked(value: string | null): string {
  if (!value) return "never checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never checked";
  return `checked ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
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

function SequencerRow({
  label,
  row,
}: {
  label: string;
  row: ClientSequencerRecord | null;
}) {
  // No row at all is a provisioning state, not an absent one — the whole point of this section.
  const setup: WorkspaceSetupState = row?.setup_state ?? {};
  const state = !row ? "no_connector" : setup.state ?? "never";
  const steps = Object.entries(setup.steps ?? {});

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-white">{label}</span>
        <Pill tone={stateTone(state)}>{stateLabel(state)}</Pill>
        {row ? (
          <span className="text-[11px] text-white/40">{formatChecked(row.setup_checked_at)}</span>
        ) : null}
      </div>

      {row?.external_workspace_id ? (
        <p className="font-mono text-[11px] text-white/40">workspace {row.external_workspace_id}</p>
      ) : null}

      {steps.length ? (
        <div className="flex flex-wrap gap-1.5">
          {steps.map(([key, step]) => (
            <Pill key={key} tone={stepTone(step.outcome)}>
              {STEP_LABELS[key] ?? key}
              {step.missing?.length ? ` · ${step.missing.length} missing` : ""}
            </Pill>
          ))}
        </div>
      ) : null}

      {/* A dry run reports the same steps as a real one, so say which this was — otherwise
          "Partly configured" reads as "we tried and failed" when it means "we only looked". */}
      {row && setup.dry_run === true ? (
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
          What the setup workflows last saw in the client's sending systems. Written by n8n, read
          here.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SequencerRow label={SEQUENCER_LABELS.emailbison} row={creds.emailbison} />
        <SequencerRow label={SEQUENCER_LABELS.aimfox} row={creds.aimfox} />
      </div>
      <p className="text-[11px] text-white/40">
        There is no scheduled drift check: a status is only as fresh as its timestamp.
      </p>
    </section>
  );
}
