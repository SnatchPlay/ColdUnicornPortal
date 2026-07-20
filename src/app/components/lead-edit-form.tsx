import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  CONTACT_METHOD_UNSET,
  EDITABLE_QUALIFICATIONS,
  LEAD_GENDER_UNSET,
  LEAD_QUALIFICATION_UNSET,
  type LeadDraft,
} from "../lib/lead-draft";
import type { ContactMethod, LeadGender, LeadQualification } from "../types/core";

/**
 * Editable lead form (Identity / Pipeline / OOO sections). Shared by the Leads page drawer and the
 * Manager dashboard lead drawer. Pure presentational component driven by a `LeadDraft` + updater.
 */

export function EditLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{children}</span>;
}

export function EditInput({ value, onChange, disabled, type = "text", placeholder }: {
  value: string; onChange: (next: string) => void; disabled?: boolean; type?: string; placeholder?: string;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={disabled}
      className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-sky-400/40 disabled:opacity-60" />
  );
}

/** Shared enum `<Select>` for the lead editors — `options` are the values (incl. any leading "unset"
 *  sentinel the caller manages), `labels` maps each to its display text. */
export function EditSelect({ value, options, labels, disabled, onChange, placeholder }: {
  value: string; options: readonly string[]; labels: Record<string, string>;
  disabled?: boolean; onChange: (next: string) => void; placeholder?: string;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-white focus:bg-[#1a1a1a] focus:text-white">{labels[o]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shared dirty-gated Save pill used by all the CRM drawer editors. */
export function SaveButton({ onClick, disabled, saving, label = "Save" }: {
  onClick: () => void; disabled?: boolean; saving?: boolean; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? "Saving…" : label}
    </button>
  );
}

export function LeadEditForm({ draft, updateDraft, readOnly, hideWon = false, showCrmFields = false }: {
  draft: LeadDraft;
  updateDraft: (updater: (current: LeadDraft) => LeadDraft) => void;
  readOnly: boolean;
  /** Hide the legacy `won` pipeline toggle — the CRM drawer's conclusion editor owns `won` (ADR-0013). */
  hideWon?: boolean;
  /** Show the CRM operational fields (contact/method/negotiation/LinkedIn dates) — CRM view only. */
  showCrmFields?: boolean;
}) {
  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    updateDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Identity</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><EditLabel>First name</EditLabel><EditInput value={draft.firstName} onChange={(v) => set("firstName", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>Last name</EditLabel><EditInput value={draft.lastName} onChange={(v) => set("lastName", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>Email</EditLabel><EditInput value={draft.email} onChange={(v) => set("email", v)} disabled={readOnly} type="email" /></label>
          <label className="space-y-2"><EditLabel>Job title</EditLabel><EditInput value={draft.jobTitle} onChange={(v) => set("jobTitle", v)} disabled={readOnly} /></label>
          <label className="space-y-2 md:col-span-2"><EditLabel>Company</EditLabel><EditInput value={draft.companyName} onChange={(v) => set("companyName", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>LinkedIn URL</EditLabel><EditInput value={draft.linkedinUrl} onChange={(v) => set("linkedinUrl", v)} disabled={readOnly} placeholder="https://linkedin.com/in/…" /></label>
          <label className="space-y-2"><EditLabel>Website</EditLabel><EditInput value={draft.website} onChange={(v) => set("website", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>Phone</EditLabel><EditInput value={draft.phoneNumber} onChange={(v) => set("phoneNumber", v)} disabled={readOnly} type="tel" /></label>
          <label className="space-y-2"><EditLabel>Phone source</EditLabel><EditInput value={draft.phoneSource} onChange={(v) => set("phoneSource", v)} disabled={readOnly} placeholder="manual, enrichment, …" /></label>
          <label className="space-y-2">
            <EditLabel>Gender</EditLabel>
            <Select value={draft.gender === "" ? LEAD_GENDER_UNSET : draft.gender} disabled={readOnly} onValueChange={(value) => set("gender", value === LEAD_GENDER_UNSET ? "" : (value as LeadGender))}>
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue placeholder="Unknown" /></SelectTrigger>
              <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={LEAD_GENDER_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">Unknown</SelectItem>
                <SelectItem value="male" className="text-white focus:bg-[#1a1a1a] focus:text-white">male</SelectItem>
                <SelectItem value="female" className="text-white focus:bg-[#1a1a1a] focus:text-white">female</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2"><EditLabel>Country</EditLabel><EditInput value={draft.country} onChange={(v) => set("country", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>Industry</EditLabel><EditInput value={draft.industry} onChange={(v) => set("industry", v)} disabled={readOnly} /></label>
          <label className="space-y-2"><EditLabel>Headcount</EditLabel><EditInput value={draft.headcountRange} onChange={(v) => set("headcountRange", v)} disabled={readOnly} placeholder="e.g. 51-200" /></label>
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pipeline</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>Qualification</EditLabel>
            <Select value={draft.qualification === "" ? LEAD_QUALIFICATION_UNSET : draft.qualification} disabled={readOnly} onValueChange={(value) => set("qualification", value === LEAD_QUALIFICATION_UNSET ? "" : (value as LeadQualification))}>
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue placeholder="unqualified" /></SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value={LEAD_QUALIFICATION_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">unqualified</SelectItem>
                {EDITABLE_QUALIFICATIONS.map((q) => <SelectItem key={q} value={q} className="text-white focus:bg-[#1a1a1a] focus:text-white">{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2">
            <EditLabel>Client note</EditLabel>
            <textarea value={draft.clientNote} onChange={(event) => set("clientNote", event.target.value)} disabled={readOnly} rows={3} className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none disabled:opacity-60" />
          </label>
        </div>
        <label className="block space-y-2">
          <EditLabel>ColdUnicorn note (internal)</EditLabel>
          <textarea value={draft.coldunicornNote} onChange={(event) => set("coldunicornNote", event.target.value)} disabled={readOnly} rows={2} placeholder="Internal — not visible to the client" className="w-full rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-white outline-none placeholder:text-muted-foreground disabled:opacity-60" />
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { label: "Meeting booked", key: "meetingBooked" as const, value: draft.meetingBooked },
            { label: "Meeting held", key: "meetingHeld" as const, value: draft.meetingHeld },
            { label: "Offer sent", key: "offerSent" as const, value: draft.offerSent },
            { label: "Won", key: "won" as const, value: draft.won },
          ].filter((item) => !(hideWon && item.key === "won")).map((item) => (
            <label key={item.label} className="rounded-2xl border border-white/10 bg-black/10 p-4">
              <EditLabel>{item.label}</EditLabel>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm">{item.value ? "Yes" : "No"}</span>
                <Checkbox checked={item.value} disabled={readOnly} onCheckedChange={(checked) => set(item.key, checked === true)} />
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">OOO</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2"><EditLabel>Expected return date</EditLabel><EditInput value={draft.expectedReturnDate} onChange={(v) => set("expectedReturnDate", v)} disabled={readOnly} type="date" /></label>
          <label className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <EditLabel>In OOO campaign</EditLabel>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm">{draft.addedToOooCampaign ? "Yes" : "No"}</span>
              <Checkbox checked={draft.addedToOooCampaign} disabled={readOnly} onCheckedChange={(checked) => set("addedToOooCampaign", checked === true)} />
            </div>
          </label>
        </div>
      </section>

      {/* CRM operational state (ADR-0013, Phase 5.2) — dates driving the CRM health columns. Shown only
          in the CRM view; edited via the shared draft/Save flow (not a separate action). */}
      {showCrmFields ? (
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">CRM operational</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2"><EditLabel>Contact made</EditLabel><EditInput value={draft.contactMadeAt} onChange={(v) => set("contactMadeAt", v)} disabled={readOnly} type="date" /></label>
            <label className="space-y-2">
              <EditLabel>Contact method</EditLabel>
              <Select value={draft.contactMethod === "" ? CONTACT_METHOD_UNSET : draft.contactMethod} disabled={readOnly}
                onValueChange={(value) => set("contactMethod", value === CONTACT_METHOD_UNSET ? "" : (value as ContactMethod))}>
                <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                  <SelectItem value={CONTACT_METHOD_UNSET} className="text-white focus:bg-[#1a1a1a] focus:text-white">—</SelectItem>
                  <SelectItem value="phone" className="text-white focus:bg-[#1a1a1a] focus:text-white">phone</SelectItem>
                  <SelectItem value="email" className="text-white focus:bg-[#1a1a1a] focus:text-white">email</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2"><EditLabel>LinkedIn invite sent</EditLabel><EditInput value={draft.linkedinInvitationSentAt} onChange={(v) => set("linkedinInvitationSentAt", v)} disabled={readOnly} type="date" /></label>
            <label className="space-y-2"><EditLabel>Negotiation start</EditLabel><EditInput value={draft.negotiationStartedAt} onChange={(v) => set("negotiationStartedAt", v)} disabled={readOnly} type="date" /></label>
          </div>
        </section>
      ) : null}
    </div>
  );
}
