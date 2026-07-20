/**
 * CRM view feature capabilities (ADR-0013). Simple compile-time flags for parts of the Cold CRM / PDCA
 * spec whose business rules are NOT yet product-approved and therefore must not surface as authoritative,
 * product-facing metrics. Flipping a flag on is a product decision, not a code cleanup.
 */

/**
 * AO "Process issues" rollup (spec §5 AO). The counted-step list, whether `yellow` counts, the meaning
 * of "not included", and the exact prerequisite chains are all OPEN. Until the rule table is signed off
 * the column renders a non-authoritative placeholder ("—", tooltip explains) and does not feed any
 * health/progress surface. The evaluator (`processIssuesCount`) stays live for tests behind this flag.
 */
export const CRM_PROCESS_ISSUES_ENABLED = false;

/** Tooltip shown on the disabled AO cell so the blank is explained rather than looking broken. */
export const CRM_PROCESS_ISSUES_PENDING_LABEL = "Rule definition pending product approval";
