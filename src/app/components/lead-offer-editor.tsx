import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { EditLabel, EditInput } from "./lead-edit-form";
import type { LeadOfferInput } from "../data/orm-gateway-contract";
import type { LeadCrmOffer } from "../types/view-contracts";
import { OFFER_STATUS_VALUES, type OfferStatus } from "../types/core";

/**
 * Current-offer editor for the Lead CRM view (ADR-0013, Phase 5.3). Operates on the "current offer" the
 * CRM view shows (latest non-cancelled) — a `sent`/`accepted` status fires the DB trigger that
 * recomputes `leads.offer_sent`, so this is how the portal moves a lead through the offer KPI. Only the
 * two projected/CS-manager-owned fields are editable (status + contracted send date); revisions and the
 * secondary fields (sent_at/offer_url/notes) are deferred. Seed once — parent mounts with `key`.
 */

const STATUS_LABEL: Record<OfferStatus, string> = {
  planned: "Planned",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function LeadOfferEditor({ offer, readOnly, saving, onSave }: {
  offer: LeadCrmOffer | null;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (patch: LeadOfferInput) => void;
}) {
  const seedStatus: OfferStatus = offer?.status ?? "planned";
  // contracted_send_date is a Postgres DATE (already YYYY-MM-DD, no zone) — use it verbatim, no tz shift.
  const seedDate = offer?.contracted_send_date ?? "";

  const [status, setStatus] = useState<OfferStatus>(seedStatus);
  const [contractedSendDate, setContractedSendDate] = useState(seedDate);

  const dirty = status !== seedStatus || contractedSendDate !== seedDate;

  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Offer</p>
      <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>Status</EditLabel>
            <Select value={status} disabled={readOnly} onValueChange={(v) => setStatus(v as OfferStatus)}>
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white disabled:opacity-60"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                {OFFER_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s} className="text-white focus:bg-[#1a1a1a] focus:text-white">{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-2"><EditLabel>Contracted send date</EditLabel><EditInput value={contractedSendDate} onChange={setContractedSendDate} disabled={readOnly} type="date" /></label>
        </div>
        {!readOnly ? (
          <button
            onClick={() => onSave({ status, contracted_send_date: contractedSendDate || null })}
            disabled={!dirty || saving}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save offer"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
