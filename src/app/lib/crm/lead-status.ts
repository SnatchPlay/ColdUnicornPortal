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
 * Contact disposition, derived from the n8n-owned `qualification` value. `null` = ordinary contact.
 * OOO/NRR are read-only here — reclassifying them would be an n8n ingestion-contract change.
 */
export function deriveContactDisposition(facts: LeadStatusFacts): ContactDisposition | null {
  if (facts.qualification === "OOO") return "OOO";
  if (facts.qualification === "NRR") return "NRR";
  return null;
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
