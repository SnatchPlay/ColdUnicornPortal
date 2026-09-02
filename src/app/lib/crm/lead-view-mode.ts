/**
 * The three lead tables (ADR-0013): PDCA = the dense report, CRM = the banded CRM table,
 * Combined = the calm union of both. The type lives in `lib/` — not in the switcher component —
 * so the column builder and the read-model hook can key on it without importing UI.
 */
export type LeadViewMode = "pdca" | "crm" | "combined";

/** CRM and Combined read the SAME response (`loadLeadCrmList`); only the column set differs. */
export function isCrmViewMode(mode: LeadViewMode): boolean {
  return mode !== "pdca";
}
