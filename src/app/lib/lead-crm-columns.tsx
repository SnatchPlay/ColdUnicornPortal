import type { ReactNode } from "react";
import type { AppRole } from "../types/core";
import type { LeadCrmRow } from "../types/view-contracts";
import { resolveCrmStatus, deriveContactDisposition } from "./crm/lead-status";
import { calendarDaysBetween, DEFAULT_BUSINESS_DAY_CONFIG } from "./crm/business-days";
import { formatDate, getFullName } from "./format";

/**
 * CRM view column registry (ADR-0013, Cold CRM / PDCA spec). Mirrors `lead-report-columns.tsx` but
 * each column additionally carries a visual `stage` band (Lead / Qualification / Offering / Expert
 * brand / Finalization / Conclusions — spec §3.2) used by `LeadCrmTable` to render the grouped
 * stage strip. Phase 3 is value-only; per-cell health colours (the `health` accessor) land in Phase 4.
 */

export type CrmStage = "lead" | "qualification" | "offering" | "expert_brand" | "finalization" | "conclusions";

export const CRM_STAGES: { key: CrmStage; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "qualification", label: "Qualification" },
  { key: "offering", label: "Offering" },
  { key: "expert_brand", label: "Expert brand building" },
  { key: "finalization", label: "Finalization" },
  { key: "conclusions", label: "Conclusions" },
];

export interface LeadCrmColumn {
  id: string;
  label: string;
  stage: CrmStage;
  width: number;
  minWidth: number;
  align?: "left" | "right" | "center";
  /** Primitive cell value (also used for export / the default text renderer). */
  value: (row: LeadCrmRow) => string | number | null;
  render?: (row: LeadCrmRow) => ReactNode;
  /**
   * Spreadsheet column letter the health evaluator keys on (spec Appendix A). Present only on columns
   * that carry an SLA/quality/presence colour; absent columns render plain (Phase 4). The special id
   * `"AO"` is the derived process-issue count, rendered from the row's full health map by the table.
   */
  healthId?: string;
  /** One-line explanation of the column's rule, shown as a header tooltip (Phase 4). */
  headerHelp?: string;
}

const STATUS_LABELS: Record<string, string> = {
  preMQL: "pre-MQL",
  MQL: "MQL",
  SQL: "SQL",
  won: "Won",
  lost: "Lost",
  lost_premql: "Lost (pre-MQL)",
};

function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  return formatDate(value, { day: "numeric", month: "short", year: "2-digit" });
}

function present(value: string | null | undefined): string {
  return value && value.trim() ? "Yes" : "";
}

function LinkCell({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <a href={safe} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}
       className="truncate text-sky-400 underline-offset-2 hover:underline">{label}</a>
  );
}

/** Days a lead has spent in negotiation. Uses the server `asOf` (not the browser clock) so it matches
 *  the health evaluator's AI cell. */
function negotiationDays(row: LeadCrmRow, asOf: string): number | null {
  if (!row.negotiation_started_at) return null;
  const end = row.concluded_at ?? asOf;
  return calendarDaysBetween(row.negotiation_started_at, end, DEFAULT_BUSINESS_DAY_CONFIG);
}

export interface BuildLeadCrmColumnsOptions {
  role: AppRole | undefined;
  /** Admin/master view shows the owning Client column. */
  showClient: boolean;
  /** Server clock from the read-model response, for deterministic derived durations. */
  asOf?: string;
  /** Append the derived AO "Process issues" rollup column (CRM mode only; never for the client role). */
  includeProcessIssues?: boolean;
}

/**
 * Build the CRM column registry. Internal-only columns (scripts, insights, scores, transcripts,
 * internal note) are omitted for the client role — the gateway also nulls those fields, so this is a
 * UI-tidiness layer, not the security boundary.
 */
export function buildLeadCrmColumns(options: BuildLeadCrmColumnsOptions): LeadCrmColumn[] {
  const isClient = options.role === "client";
  const asOf = options.asOf ?? new Date().toISOString();
  const columns: LeadCrmColumn[] = [];

  // --- Lead stage ---
  columns.push(
    { id: "company", label: "Company", stage: "lead", width: 170, minWidth: 120, healthId: "A", value: (r) => r.company_name },
    { id: "full_name", label: "Name", stage: "lead", width: 170, minWidth: 120, healthId: "E", value: (r) => getFullName(r.first_name, r.last_name) },
  );
  if (options.showClient) {
    columns.push({ id: "client", label: "Client", stage: "lead", width: 150, minWidth: 100, value: (r) => r.clientName || "—" });
  }
  columns.push(
    { id: "phone", label: "Phone", stage: "lead", width: 130, minWidth: 90, healthId: "F", value: (r) => r.phone_number },
    { id: "email", label: "Email", stage: "lead", width: 190, minWidth: 130, healthId: "G", value: (r) => r.email },
    {
      id: "linkedin_invitation", label: "LinkedIn invite", stage: "lead", width: 120, minWidth: 90, healthId: "I",
      headerHelp: "Green once the invite is sent; yellow if the LinkedIn integration is connected but no invite went out.",
      value: (r) => shortDate(r.linkedin_invitation_sent_at),
    },
    {
      id: "status", label: "Status", stage: "lead", width: 130, minWidth: 100,
      value: (r) => STATUS_LABELS[resolveCrmStatus(r)] ?? resolveCrmStatus(r),
    },
    {
      id: "disposition", label: "Disposition", stage: "lead", width: 110, minWidth: 80,
      value: (r) => deriveContactDisposition(r) ?? "",
    },
    { id: "lead_received", label: "Lead received", stage: "lead", width: 120, minWidth: 90, healthId: "N", value: (r) => shortDate(r.created_at) },
  );

  // --- Qualification stage ---
  if (!isClient) {
    columns.push({
      id: "intro_script", label: "Intro script", stage: "qualification", width: 110, minWidth: 80, healthId: "O",
      headerHelp: "Yellow until the intro call script is prepared.",
      value: (r) => present(r.intro_meeting?.call_script),
    });
  }
  columns.push(
    {
      id: "contact_made", label: "Contact made", stage: "qualification", width: 140, minWidth: 100, healthId: "P",
      headerHelp: "Should be same working day. Yellow at +1 working day, red past that. Calling scores better than emailing.",
      value: (r) => (r.contact_made_at ? `${shortDate(r.contact_made_at)}${r.contact_method ? ` (${r.contact_method})` : ""}` : ""),
    },
    {
      id: "meeting_set", label: "Meeting set", stage: "qualification", width: 130, minWidth: 100, healthId: "R",
      headerHelp: "For an MQL+ lead, yellow if no intro meeting is scheduled within 1 working day of receipt.",
      value: (r) => shortDate(r.intro_meeting?.scheduled_at),
    },
  );
  if (!isClient) {
    columns.push(
      {
        id: "intro_insights", label: "Meeting insights", stage: "qualification", width: 130, minWidth: 90, healthId: "S",
        headerHelp: "Yellow when a meeting is set but pre-meeting insights are missing.",
        value: (r) => present(r.intro_meeting?.pre_meeting_insights),
      },
      {
        id: "intro_transcript", label: "Transcript", stage: "qualification", width: 110, minWidth: 80, healthId: "T",
        headerHelp: "Red if the transcription link is missing more than 2 hours after the meeting.",
        value: (r) => (r.intro_meeting?.transcription_url ? "Link" : ""),
        render: (r) => <LinkCell href={r.intro_meeting?.transcription_url} label="Transcript" />,
      },
      {
        id: "intro_score", label: "Process score", stage: "qualification", width: 110, minWidth: 80, align: "right", healthId: "U",
        headerHelp: "Quality band: green ≥70, yellow ≥50, orange ≥30, red below. Red if missing 1 day after the meeting.",
        value: (r) => r.intro_meeting?.process_score ?? null,
      },
      {
        id: "intro_conversion", label: "Conversion insights", stage: "qualification", width: 140, minWidth: 90, healthId: "V",
        headerHelp: "Red if conversion insights are missing 1 working day after the meeting.",
        value: (r) => present(r.intro_meeting?.conversion_insights),
      },
    );
  }

  // --- Offering stage ---
  columns.push(
    {
      id: "offer_date", label: "Offer date", stage: "offering", width: 120, minWidth: 90, healthId: "W",
      headerHelp: "After the intro meeting: yellow at +1 working day, red at +2 with no contracted offer date.",
      value: (r) => shortDate(r.current_offer?.contracted_send_date),
    },
    {
      id: "next_step_date", label: "Next-step date", stage: "offering", width: 120, minWidth: 90, healthId: "X",
      headerHelp: "After the intro meeting: yellow at +1 working day, red at +2 with no contracted next-step date.",
      value: (r) => shortDate(r.next_task_due_at),
    },
    {
      id: "next_steps", label: "Open tasks", stage: "offering", width: 100, minWidth: 70, align: "right", healthId: "Y",
      headerHelp: "Yellow/red when a next-step date exists but no open task backs it.",
      value: (r) => r.open_tasks_count,
    },
  );
  if (!isClient) {
    columns.push(
      {
        id: "summary_transcript", label: "Summary transcript", stage: "offering", width: 130, minWidth: 90, healthId: "Z",
        headerHelp: "Red if the summary meeting transcription is missing more than 2 hours after the meeting.",
        value: (r) => (r.summary_meeting?.transcription_url ? "Link" : ""),
        render: (r) => <LinkCell href={r.summary_meeting?.transcription_url} label="Transcript" />,
      },
      {
        id: "summary_conversion", label: "Summary insights", stage: "offering", width: 130, minWidth: 90, healthId: "AA",
        headerHelp: "Yellow/red when summary conversion insights lag 1–2 working days after the meeting.",
        value: (r) => present(r.summary_meeting?.conversion_insights),
      },
    );
  }

  // --- Expert brand building stage ---
  columns.push(
    {
      id: "value1_date", label: "1st value date", stage: "expert_brand", width: 120, minWidth: 90, healthId: "AB",
      headerHelp: "For an SQL+ lead with a next-step date: yellow/red at +1/+2 working days without a 1st value date.",
      value: (r) => shortDate(r.value_delivery_1?.planned_date),
    },
    {
      id: "value1_items", label: "1st values", stage: "expert_brand", width: 160, minWidth: 110, healthId: "AC",
      headerHelp: "Yellow when a 1st value date is set but the value list is empty.",
      value: (r) => (r.value_delivery_1?.value_items ?? []).join(", "),
    },
    {
      id: "value1_sent", label: "1st sent", stage: "expert_brand", width: 110, minWidth: 80, healthId: "AD",
      headerHelp: "Yellow/red at +1/+2 working days after the planned 1st value date without a send.",
      value: (r) => shortDate(r.value_delivery_1?.sent_at),
    },
    {
      id: "value2_date", label: "2nd value date", stage: "expert_brand", width: 120, minWidth: 90, healthId: "AE",
      headerHelp: "After the 1st value date: yellow/red at +1/+2 working days without a 2nd value date.",
      value: (r) => shortDate(r.value_delivery_2?.planned_date),
    },
    {
      id: "value2_items", label: "2nd values", stage: "expert_brand", width: 160, minWidth: 110, healthId: "AF",
      headerHelp: "Yellow when a 2nd value date is set but the value list is empty.",
      value: (r) => (r.value_delivery_2?.value_items ?? []).join(", "),
    },
    {
      id: "value2_sent", label: "2nd sent", stage: "expert_brand", width: 110, minWidth: 80, healthId: "AG",
      headerHelp: "Yellow/red at +1/+2 working days after the planned 2nd value date without a send.",
      value: (r) => shortDate(r.value_delivery_2?.sent_at),
    },
  );

  // --- Finalization stage ---
  columns.push(
    {
      id: "negotiation", label: "Negotiation start", stage: "finalization", width: 130, minWidth: 90, healthId: "AH",
      headerHelp: "After the 2nd value: yellow at +1 week, red at +2 weeks without negotiation starting.",
      value: (r) => shortDate(r.negotiation_started_at),
    },
    {
      id: "negotiation_days", label: "Days in negotiation", stage: "finalization", width: 130, minWidth: 90, align: "right", healthId: "AI",
      headerHelp: "Duration band: green ≤30 days, yellow ≤60, orange ≤90, red beyond.",
      value: (r) => negotiationDays(r, asOf),
    },
    { id: "notes", label: "Notes", stage: "finalization", width: 200, minWidth: 130, healthId: "AJ", value: (r) => (isClient ? r.client_note : r.client_note || r.coldunicorn_note) },
  );

  // --- Conclusions stage ---
  columns.push(
    {
      id: "conclusion", label: "Conclusion", stage: "conclusions", width: 200, minWidth: 130, healthId: "AN",
      value: (r) => (r.final_outcome ? `${STATUS_LABELS[r.final_outcome]}${r.conclusion ? ` — ${r.conclusion}` : ""}` : (isClient ? "" : r.conclusion ?? "")),
    },
  );
  // Process-issue rollup (spec AO): count of distinct overdue steps, one root failure counted once.
  // Internal-only — the client role's projection nulls the internal SLA fields it would tally.
  if (options.includeProcessIssues && !isClient) {
    columns.push({
      id: "process_issues", label: "Process issues", stage: "conclusions", width: 110, minWidth: 80, align: "right", healthId: "AO",
      headerHelp: "Count of overdue process steps (green 0, yellow 1, orange 2–3, red 4+). Cascades from one root cause count once.",
      value: () => null, // rendered from the row's full health map by the table
    });
  }

  return columns;
}
