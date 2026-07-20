import { useState } from "react";
import { EditLabel, EditInput, SaveButton } from "./lead-edit-form";
import { datePart } from "../lib/lead-draft";
import type { LeadValueDeliveryInput } from "../data/orm-gateway-contract";
import type { LeadCrmValueDelivery } from "../types/view-contracts";

/**
 * Value-delivery editor for the Lead CRM view (ADR-0013, Phase 5.3). Two deliveries per lead, keyed on
 * sequence 1/2 (the two the CRM view shows). All fields are CS-manager-owned; no legacy-boolean trigger
 * fires. `planned_date` is a DATE (verbatim), `sent_at` a timestamptz (civil-date via `datePart`), and
 * `value_items` is edited as a comma-separated list. Seed once — parent mounts with `key`.
 */

function ValueSubEditor({ title, delivery, readOnly, saving, onSave }: {
  title: string;
  delivery: LeadCrmValueDelivery | null;
  readOnly?: boolean;
  saving?: boolean;
  onSave: (patch: LeadValueDeliveryInput) => void;
}) {
  const seedPlanned = delivery?.planned_date ?? ""; // DATE — no tz shift
  const seedSent = datePart(delivery?.sent_at ?? null) ?? ""; // timestamptz — civil date
  const seedItems = (delivery?.value_items ?? []).join(", ");

  const [plannedDate, setPlannedDate] = useState(seedPlanned);
  const [sentAt, setSentAt] = useState(seedSent);
  const [itemsText, setItemsText] = useState(seedItems);

  const dirty = plannedDate !== seedPlanned || sentAt !== seedSent || itemsText !== seedItems;

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-neutral-300">{title}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2"><EditLabel>Planned date</EditLabel><EditInput value={plannedDate} onChange={setPlannedDate} disabled={readOnly} type="date" /></label>
        <label className="space-y-2"><EditLabel>Sent</EditLabel><EditInput value={sentAt} onChange={setSentAt} disabled={readOnly} type="date" /></label>
      </div>
      <label className="block space-y-2">
        <EditLabel>Value items (comma-separated)</EditLabel>
        <EditInput value={itemsText} onChange={setItemsText} disabled={readOnly} placeholder="e.g. Case study, LinkedIn post" />
      </label>
      {!readOnly ? (
        <SaveButton
          onClick={() => onSave({
            planned_date: plannedDate || null,
            sent_at: sentAt || null,
            value_items: itemsText.split(",").map((s) => s.trim()).filter(Boolean),
          })}
          disabled={!dirty || saving}
          saving={saving}
          label="Save value"
        />
      ) : null}
    </div>
  );
}

export function LeadValueDeliveriesEditor({ first, second, readOnly, savingSeq, onSave }: {
  first: LeadCrmValueDelivery | null;
  second: LeadCrmValueDelivery | null;
  readOnly?: boolean;
  savingSeq?: 1 | 2 | null;
  onSave: (sequenceNumber: 1 | 2, patch: LeadValueDeliveryInput) => void;
}) {
  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Value deliveries</p>
      <ValueSubEditor title="1st value" delivery={first} readOnly={readOnly} saving={savingSeq === 1} onSave={(p) => onSave(1, p)} />
      <ValueSubEditor title="2nd value" delivery={second} readOnly={readOnly} saving={savingSeq === 2} onSave={(p) => onSave(2, p)} />
    </section>
  );
}
