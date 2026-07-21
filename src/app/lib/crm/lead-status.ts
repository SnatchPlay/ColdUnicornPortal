/**
 * Lead CRM status model (ADR-0013, refined 2026-07-19). The taxonomy is deliberately SPLIT into two
 * orthogonal dimensions plus a disposition, rather than one mixed stored column:
 *
 *   - crm_stage      — non-terminal funnel position (preMQL | MQL | SQL). DERIVED on read from lead
 *                      activity facts; never stored (no drift, no backfill).
 *   - final_outcome  — explicit terminal decision (won | lost | lost_premql). STORED on `leads`
 *                      alongside `conclusion` + `concluded_at`, set only by the conclusion action.
 *   - contact_disposition — OOO / NRR. A separate dimension DERIVED from the n8n-owned
 *                      `leads.qualification` value; it does NOT change the funnel stage (OOO
 *                      preserves the stage; NRR only becomes `lost` via an explicit decision).
 *
 * `resolveCrmStatus` collapses the two dimensions into the single display/health status used by the
 * CRM view's M column and the health evaluator's prerequisite gating. It also bridges the LEGACY
 * terminal signals (`won` boolean, `qualification='rejected'`) so existing leads read correctly
 * before any explicit `final_outcome` is set. Existing KPI dashboards are unaffected — they keep
 * their current booleans/qualification semantics.
 *
 * Pure + dependency-free: imported by both the browser and the Deno gateway (same contract as
 * `lead-health.ts`).
 */

import type { ContactDisposition, CrmStage, FinalOutcome, LeadCrmStatus } from "../../types/core";

export type { ContactDisposition, CrmStage, FinalOutcome };
/** The resolved single status (a CrmStage or a FinalOutcome) consumed by the CRM view + health. */
export type ResolvedCrmStatus = LeadCrmStatus;

/** Minimal structural facts the status resolver reads (both LeadRecord and server projections fit). */
export interface LeadStatusFacts {
  qualification?: string | null;
  meeting_booked?: boolean | null;
  meeting_held?: boolean | null;
  offer_sent?: boolean | null;
  won?: boolean | null;
  final_outcome?: FinalOutcome | null;
  /** Persisted disposition (n8n-owned). Preferred over the legacy `qualification` fallback. */
  contact_disposition?: ContactDisposition | null;
}

/**
 * Non-terminal funnel position from activity facts. `SQL` once any meeting/offer progress exists,
 * `MQL` when qualification is MQL, else `preMQL`. Intentionally ignores OOO/NRR (a contact
 * disposition, not a funnel stage) and terminal signals (handled by `resolveCrmStatus`).
 */
export function deriveCrmStage(facts: LeadStatusFacts): CrmStage {
  if (facts.offer_sent || facts.meeting_held || facts.meeting_booked) return "SQL";
  if (facts.qualification === "MQL") return "MQL";
  return "preMQL";
}

/**
 * Map a legacy n8n `qualification` value to the canonical domain-named disposition (spec item 10).
 * `null` = ordinary/active contact. The legacy `OOO`/`NRR` abbreviations live ONLY here, at the
 * compatibility boundary — every consumer downstream sees `out_of_office` / `not_right_role`.
 */
export function mapLegacyQualificationToDisposition(qualification?: string | null): ContactDisposition | null {
  if (qualification === "OOO") return "out_of_office";
  if (qualification === "NRR") return "not_right_role";
  return null;
}

/**
 * ⚠️ MIGRATION-WINDOW LEGACY (ADR-0015). Under the new model an OOO/NRR contact is NOT a CRM lead —
 * the state lives in `ooo_followups` against a `sequencer_contacts` row, and the operational view
 * owns it. This function therefore only describes rows n8n wrote under the OLD contract.
 *
 * It is kept deliberately, not removed: spec §18 allows these fields to "залишити лише тимчасово на
 * період міграції", and deleting the read side at portal-deploy time would blind managers to OOO
 * leads during the window between this deploy and the n8n cutover — leads that still exist and are
 * still being written. `migrations/deferred/20260722z` drops the underlying columns; delete this
 * function, `mapLegacyQualificationToDisposition`, the `ContactDisposition` type and the CRM
 * "Disposition" column in the same change that applies it.
 *
 * The effective contact disposition (spec item 10). Prefers the PERSISTED `contact_disposition` column
 * (n8n-owned, independent of `qualification`, so a disposition change never overwrites the funnel
 * stage). Falls back to mapping a LEGACY `qualification` of OOO/NRR to a display disposition — that
 * fallback is DISPLAY-ONLY for old rows: the prior qualification of a legacy OOO/NRR row cannot be
 * reconstructed without historical data, so nothing is backfilled.
 *
 * `deriveCrmStage` reads `qualification` independently, so once n8n writes the disposition column
 * instead of overwriting `qualification`, `MQL + OOO` stays `MQL` and `SQL + OOO` stays `SQL`.
 */
export function deriveContactDisposition(facts: LeadStatusFacts): ContactDisposition | null {
  return facts.contact_disposition ?? mapLegacyQualificationToDisposition(facts.qualification);
}

/**
 * The single display/health status. An explicit `final_outcome` wins; otherwise legacy terminal
 * signals (`won` boolean, `qualification='rejected'`) are bridged, then the derived non-terminal
 * stage. NRR is NOT auto-lost — it only becomes `lost` when an operator records `final_outcome`.
 */
export function resolveCrmStatus(facts: LeadStatusFacts): ResolvedCrmStatus {
  if (facts.final_outcome) return facts.final_outcome;
  if (facts.won) return "won";
  if (facts.qualification === "rejected") return "lost";
  return deriveCrmStage(facts);
}
