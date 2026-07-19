import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { EditLabel } from "./lead-edit-form";
import { nullableString } from "../lib/lead-draft";
import type { FinalOutcome, LeadRecord } from "../types/core";

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

export function LeadConclusionEditor({ lead, readOnly, saving, onSave }: {
  lead: LeadRecord;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (finalOutcome: FinalOutcome | null, conclusion: string | null) => void;
}) {
  const [outcome, setOutcome] = useState<FinalOutcome | "">(lead.final_outcome ?? "");
  const [conclusion, setConclusion] = useState(lead.conclusion ?? "");

  const { nextOutcome, nextConclusion, dirty } = useMemo(() => {
    const o = outcome || null;
    const c = nullableString(conclusion);
    return { nextOutcome: o, nextConclusion: c, dirty: (lead.final_outcome ?? null) !== o || (lead.conclusion ?? null) !== c };
  }, [outcome, conclusion, lead.final_outcome, lead.conclusion]);

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Conclusion</p>

      <label className="block space-y-2">
        <EditLabel>Terminal outcome</EditLabel>
        <Select value={outcome === "" ? OUTCOME_NONE : outcome} disabled={readOnly}
          onValueChange={(v) => setOutcome(v === OUTCOME_NONE ? "" : (v as FinalOutcome))}>
          <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60">
            <SelectValue placeholder="Not concluded" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value={OUTCOME_NONE} className="text-white focus:bg-[#1a1a1a] focus:text-white">Not concluded</SelectItem>
            {(Object.keys(OUTCOME_LABELS) as FinalOutcome[]).map((o) => (
              <SelectItem key={o} value={o} className="text-white focus:bg-[#1a1a1a] focus:text-white">{OUTCOME_LABELS[o]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="block space-y-2">
        <EditLabel>Conclusion note</EditLabel>
        <textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} disabled={readOnly} rows={2}
          placeholder="Why the lead reached this outcome"
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-muted-foreground disabled:opacity-60" />
      </label>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onSave(nextOutcome, nextConclusion)}
            disabled={!dirty || saving}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save conclusion"}
          </button>
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
