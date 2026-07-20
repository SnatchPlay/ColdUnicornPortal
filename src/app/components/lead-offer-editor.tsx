import { useState } from "react";
import { EditLabel, EditInput, EditSelect, SaveButton } from "./lead-edit-form";
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
            <EditSelect value={status} options={OFFER_STATUS_VALUES} labels={STATUS_LABEL} disabled={readOnly} onChange={(v) => setStatus(v as OfferStatus)} />
          </label>
          <label className="space-y-2"><EditLabel>Contracted send date</EditLabel><EditInput value={contractedSendDate} onChange={setContractedSendDate} disabled={readOnly} type="date" /></label>
        </div>
        {!readOnly ? (
          <SaveButton
            onClick={() => onSave({ status, contracted_send_date: contractedSendDate || null })}
            disabled={!dirty || saving}
            saving={saving}
            label="Save offer"
          />
        ) : null}
      </div>
    </section>
  );
}
