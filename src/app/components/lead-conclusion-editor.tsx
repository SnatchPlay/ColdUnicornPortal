import { useState } from "react";
import { EditLabel, EditSelect, SaveButton } from "./lead-edit-form";
import { nullableString } from "../lib/lead-draft";
import { FINAL_OUTCOME_VALUES, type FinalOutcome, type LeadRecord } from "../types/core";

/**
 * Terminal-conclusion editor for the Lead CRM view (ADR-0013, Phase 5). Setting a `final_outcome` is a
 * dedicated ATOMIC action (`repository.concludeLead`), NOT a `LeadEditForm` draft field: the write must
 * set `conclusion` + `concluded_at` together (DB CHECK) and sync the legacy `won` boolean, which the
 * meeting/offer recompute triggers never touch. Kept separate from the draft/patch flow so the two
 * write paths never race over `won`. Internal-only (clients are read-only over CRM data).
 *
 * Seed once from the lead — the parent mounts this with `key={lead.id}`, so switching leads remounts it.
 */

const OUTCOME_NONE = "__not_concluded__";
const OUTCOME_LABELS: Record<FinalOutcome, string> = {
  won: "Won",
  lost: "Lost",
  lost_premql: "Lost (pre-MQL)",
};
const OUTCOME_OPTIONS = [OUTCOME_NONE, ...FINAL_OUTCOME_VALUES];
const OUTCOME_SELECT_LABELS: Record<string, string> = { [OUTCOME_NONE]: "Not concluded", ...OUTCOME_LABELS };

export function LeadConclusionEditor({ lead, readOnly, saving, onSave }: {
  lead: LeadRecord;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (finalOutcome: FinalOutcome | null, conclusion: string | null) => void;
}) {
  const [outcome, setOutcome] = useState<FinalOutcome | "">(lead.final_outcome ?? "");
  const [conclusion, setConclusion] = useState(lead.conclusion ?? "");

  const nextOutcome = outcome || null;
  const nextConclusion = nullableString(conclusion);
  const dirty = (lead.final_outcome ?? null) !== nextOutcome || (lead.conclusion ?? null) !== nextConclusion;

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conclusion</p>

      <label className="block space-y-2">
        <EditLabel>Terminal outcome</EditLabel>
        <EditSelect
          value={outcome === "" ? OUTCOME_NONE : outcome}
          options={OUTCOME_OPTIONS}
          labels={OUTCOME_SELECT_LABELS}
          disabled={readOnly}
          onChange={(v) => setOutcome(v === OUTCOME_NONE ? "" : (v as FinalOutcome))}
        />
      </label>

      <label className="block space-y-2">
        <EditLabel>Conclusion note</EditLabel>
        <textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} disabled={readOnly} rows={2}
          placeholder="Why the lead reached this outcome"
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-muted-foreground disabled:opacity-60" />
      </label>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <SaveButton onClick={() => onSave(nextOutcome, nextConclusion)} disabled={!dirty || saving} saving={saving} label="Save conclusion" />
          <p className="text-xs text-muted-foreground">
            {nextOutcome === "won"
              ? "Marks the lead Won and counts it toward the win KPI."
              : nextOutcome
                ? `Marks the lead ${OUTCOME_LABELS[nextOutcome]} and removes it from the win KPI.`
                : "Clears the terminal outcome and un-counts any win."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
