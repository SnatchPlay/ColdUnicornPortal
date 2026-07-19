import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { EditLabel, EditInput } from "./lead-edit-form";
import { datePart } from "../lib/lead-draft";
import type { LeadMeetingInput } from "../data/orm-gateway-contract";
import type { LeadCrmMeeting } from "../types/view-contracts";
import { MEETING_STATUS_VALUES, type MeetingStatus } from "../types/core";

/**
 * Intro/summary meeting editor for the Lead CRM view (ADR-0013, Phase 5.3). A CS manager owns the
 * OPERATIONAL fields — status, scheduled/held dates, call script; the AI-generated fields
 * (transcription, insights, score) stay n8n-owned and are not editable here. Setting a `scheduled`/
 * `held` status fires the DB trigger that recomputes `leads.meeting_booked`/`meeting_held`, so this is
 * how the portal moves a lead through the meeting KPIs. Dates use the same civil-date helper as the
 * lead draft so what you edit matches the health engine's day.
 *
 * Seed once from the meeting projection — the parent mounts this with `key={lead.id}`, so switching
 * leads remounts it; after a save+refresh the same lead re-diffs to not-dirty.
 */

const STATUS_LABEL: Record<MeetingStatus, string> = {
  planned: "Planned",
  scheduled: "Scheduled",
  held: "Held",
  cancelled: "Cancelled",
  no_show: "No-show",
};

function MeetingSubEditor({ title, meeting, readOnly, saving, onSave }: {
  title: string;
  meeting: LeadCrmMeeting | null;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (patch: LeadMeetingInput) => void;
}) {
  const seedStatus: MeetingStatus = meeting?.status ?? "planned";
  const seedScheduled = datePart(meeting?.scheduled_at ?? null) ?? "";
  const seedHeld = datePart(meeting?.held_at ?? null) ?? "";
  const seedScript = meeting?.call_script ?? "";

  const [status, setStatus] = useState<MeetingStatus>(seedStatus);
  const [scheduledAt, setScheduledAt] = useState(seedScheduled);
  const [heldAt, setHeldAt] = useState(seedHeld);
  const [callScript, setCallScript] = useState(seedScript);

  const dirty = status !== seedStatus || scheduledAt !== seedScheduled || heldAt !== seedHeld || callScript !== seedScript;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-neutral-300">{title}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2">
          <EditLabel>Status</EditLabel>
          <Select value={status} disabled={readOnly} onValueChange={(v) => setStatus(v as MeetingStatus)}>
            <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
              {MEETING_STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-2"><EditLabel>Scheduled</EditLabel><EditInput value={scheduledAt} onChange={setScheduledAt} disabled={readOnly} type="date" /></label>
        <label className="space-y-2"><EditLabel>Held</EditLabel><EditInput value={heldAt} onChange={setHeldAt} disabled={readOnly} type="date" /></label>
      </div>
      <label className="block space-y-2">
        <EditLabel>Call script</EditLabel>
        <textarea value={callScript} onChange={(e) => setCallScript(e.target.value)} disabled={readOnly} rows={2}
          placeholder="Prep notes / agenda for the call"
          className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-muted-foreground disabled:opacity-60" />
      </label>
      {!readOnly ? (
        <button
          onClick={() => onSave({ status, scheduled_at: scheduledAt || null, held_at: heldAt || null, call_script: callScript.trim() || null })}
          disabled={!dirty || saving}
          className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save meeting"}
        </button>
      ) : null}
    </div>
  );
}

export function LeadMeetingsEditor({ intro, summary, readOnly, savingType, onSave }: {
  intro: LeadCrmMeeting | null;
  summary: LeadCrmMeeting | null;
  readOnly?: boolean;
  savingType?: "intro" | "summary" | null;
  onSave: (meetingType: "intro" | "summary", patch: LeadMeetingInput) => void;
}) {
  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Meetings</p>
      <MeetingSubEditor title="Intro meeting" meeting={intro} readOnly={readOnly} saving={savingType === "intro"} onSave={(p) => onSave("intro", p)} />
      <MeetingSubEditor title="Summary meeting" meeting={summary} readOnly={readOnly} saving={savingType === "summary"} onSave={(p) => onSave("summary", p)} />
    </section>
  );
}
