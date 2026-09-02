import type { ReactNode } from "react";
import type { AppRole } from "../types/core";
import type { LeadCrmRow } from "../types/view-contracts";
import { resolveCrmStatus } from "./crm/lead-status";
import { calendarDaysBetween, workingDaysToContact, DEFAULT_BUSINESS_DAY_CONFIG, type BusinessDayConfig } from "./crm/business-days";
import { CRM_PROCESS_ISSUES_ENABLED, CRM_PROCESS_ISSUES_PENDING_LABEL } from "./crm/crm-features";
import { LEAD_CRM_REGISTRY, type LeadCrmRegistryEntry, type LeadCrmColumnId } from "./crm/lead-crm-registry";
import type { LeadReportColumn } from "./lead-report-columns";
import type { LeadViewMode } from "./crm/lead-view-mode";
import { formatDate, getFullName } from "./format";

/**
 * CRM view column registry (ADR-0013, Cold CRM / PDCA spec). Renders the SUBSET of the canonical
 * registry (`lead-crm-registry.ts`) that is a live CRM cell. Each rendered column carries a typed
 * `registryId` (a stable SEMANTIC id, never a spreadsheet letter) and is stamped with its registry
 * `meta` at build time via `LEAD_CRM_REGISTRY[registryId]` — a statically-checked lookup, so the
 * renderer and the declarative registry can never diverge and a typo is a compile error.
 *
 * Each column additionally carries a visual `stage` band used by `LeadCrmTable` to render the grouped
 * stage strip. Per-cell health colours come from the shared evaluator via the `healthId` (also a
 * semantic id, shared with the registry entry and the evaluator).
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
   * Semantic id the health evaluator keys on. Present only on columns that carry an SLA/quality/presence
   * colour; absent columns render plain. `"process_issues"` is the derived rollup, rendered from the
   * row's full health map by the table.
   */
  healthId?: LeadCrmColumnId;
  /** Stable semantic id linking the rendered column to its registry entry — a compile-checked lookup
   *  (`LEAD_CRM_REGISTRY[registryId]`), never a spreadsheet letter. Absent on display-only columns. */
  registryId?: LeadCrmColumnId;
  /** Declarative registry metadata (mode/source/status/editability/role-visibility). Stamped at build. */
  meta?: LeadCrmRegistryEntry;
  /** One-line explanation of the column's rule, shown as a header tooltip. */
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

/** Col Y — the open-tasks list (spec item 6). Shows the ordered titles with a "+N more" overflow, and
 *  the full ordered list on hover (native title) so the cell conveys the list, not just a count. */
function TaskListCell({ tasks }: { tasks: LeadCrmRow["open_tasks"] }) {
  if (!tasks || tasks.length === 0) return <span className="text-muted-foreground">—</span>;
  const titles = tasks.map((t) => t.title);
  const shown = titles.slice(0, 2);
  const extra = titles.length - shown.length;
  const label = extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
  return <span className="min-w-0 truncate" title={titles.join("\n")}>{label}</span>;
}

/** Days a lead has spent in negotiation. Uses the server `asOf` (not the browser clock) and the server
 *  `businessDays` config so it matches the health evaluator's AI cell. */
function negotiationDays(row: LeadCrmRow, asOf: string, cfg: BusinessDayConfig): number | null {
  if (!row.negotiation_started_at) return null;
  const end = row.concluded_at ?? asOf;
  return calendarDaysBetween(row.negotiation_started_at, end, cfg);
}

/** Col Q — working days from lead receipt (cutoff-shifted day-zero) to first contact. Uses the exact
 *  same `workingDaysToContact` basis + config as the Contact-made health reason, so the displayed count
 *  and its hover explanation always agree. */
function daysToContact(row: LeadCrmRow, cfg: BusinessDayConfig): number | null {
  if (!row.created_at || !row.contact_made_at) return null;
  return workingDaysToContact(row.created_at, row.contact_made_at, cfg);
}

export interface BuildLeadCrmColumnsOptions {
  role: AppRole | undefined;
  /** Admin/master view shows the owning Client column. */
  showClient: boolean;
  /** Server clock from the read-model response, for deterministic derived durations. */
  asOf?: string;
  /** Server working-day config from the read-model, so derived day counts match the health cells. */
  businessDays?: BusinessDayConfig;
  /** Append the derived AO "Process issues" rollup column (CRM mode only; never for the client role). */
  includeProcessIssues?: boolean;
}

/** Stamp each rendered column with its canonical registry entry (spec item 8). The lookup is a typed
 *  index into `LEAD_CRM_REGISTRY` — no runtime fallback needed, a bad id is a compile error. Display-only
 *  columns (the admin Client column, the disposition sub-view) carry no `registryId` and no metadata. */
function withMeta(columns: LeadCrmColumn[]): LeadCrmColumn[] {
  for (const col of columns) {
    if (col.registryId) col.meta = LEAD_CRM_REGISTRY[col.registryId];
  }
  return columns;
}

/**
 * Build the CRM column registry. Internal-only columns (scripts, insights, scores, transcripts,
 * internal note) are omitted for the client role — the gateway also nulls those fields, so this is a
 * UI-tidiness layer, not the security boundary.
 */
export function buildLeadCrmColumns(options: BuildLeadCrmColumnsOptions): LeadCrmColumn[] {
  const isClient = options.role === "client";
  const asOf = options.asOf ?? new Date().toISOString();
  const cfg = options.businessDays ?? DEFAULT_BUSINESS_DAY_CONFIG;
  const columns: LeadCrmColumn[] = [];

  // --- Lead stage ---
  columns.push(
    { id: "company", label: "Company", stage: "lead", width: 170, minWidth: 120, healthId: "company", registryId: "company", value: (r) => r.company_name },
    { id: "full_name", label: "Name", stage: "lead", width: 170, minWidth: 120, healthId: "full_name", registryId: "full_name", value: (r) => getFullName(r.first_name, r.last_name) },
  );
  if (options.showClient) {
    columns.push({ id: "client", label: "Client", stage: "lead", width: 150, minWidth: 100, value: (r) => r.clientName || "—" });
  }
  columns.push(
    { id: "phone", label: "Phone", stage: "lead", width: 130, minWidth: 90, healthId: "phone", registryId: "phone", value: (r) => r.phone_number },
    { id: "email", label: "Email", stage: "lead", width: 190, minWidth: 130, healthId: "email", registryId: "email", value: (r) => r.email },
    {
      // Col K — Message history (spec item 7). PARTIAL: reply count is reliable; the full thread is OPEN.
      id: "msg_history", label: "Msg history", stage: "lead", width: 100, minWidth: 70, align: "right", healthId: "msg_history", registryId: "msg_history",
      headerHelp: "Replies received on this lead. Green once at least one reply exists. Full inbound/outbound thread is not yet modelled.",
      value: (r) => r.replyCount || null,
      render: (r) => (
        <span title={r.lastReplyAt ? `Last reply: ${shortDate(r.lastReplyAt)}` : "No replies yet"}>
          {r.replyCount || "—"}
        </span>
      ),
    },
    {
      id: "linkedin_invitation", label: "LinkedIn invite", stage: "lead", width: 120, minWidth: 90, healthId: "linkedin_invitation", registryId: "linkedin_invitation",
      headerHelp: "Green once the invite is sent; yellow if the LinkedIn (Aimfox) integration is connected but no invite went out; grey when the integration is off.",
      value: (r) => shortDate(r.linkedin_invitation_sent_at),
    },
    {
      id: "status", label: "Status", stage: "lead", width: 130, minWidth: 100, registryId: "status",
      value: (r) => STATUS_LABELS[resolveCrmStatus(r)] ?? resolveCrmStatus(r),
    },
    { id: "lead_received", label: "Lead received", stage: "lead", width: 120, minWidth: 90, healthId: "lead_received", registryId: "lead_received", value: (r) => shortDate(r.created_at) },
  );

  // --- Qualification stage ---
  if (!isClient) {
    columns.push({
      id: "intro_script", label: "Intro script", stage: "qualification", width: 110, minWidth: 80, healthId: "intro_script", registryId: "intro_script",
      headerHelp: "Yellow until the intro call script is prepared.",
      value: (r) => present(r.intro_meeting?.call_script),
    });
  }
  columns.push(
    {
      id: "contact_made", label: "Contact made", stage: "qualification", width: 140, minWidth: 100, healthId: "contact_made", registryId: "contact_made",
      headerHelp: "Should be same working day. Yellow at +1 working day, red past that. Calling scores better than emailing.",
      value: (r) => (r.contact_made_at ? `${shortDate(r.contact_made_at)}${r.contact_method ? ` (${r.contact_method})` : ""}` : ""),
    },
    {
      // Col Q — Days to contact (spec item 7). Own derived column; shares P's colour.
      id: "days_to_contact", label: "Days to contact", stage: "qualification", width: 110, minWidth: 80, align: "right", healthId: "days_to_contact", registryId: "days_to_contact",
      headerHelp: "Working days from lead receipt (shifted past the daily cutoff / weekends) to first contact. Colour follows Contact made.",
      value: (r) => daysToContact(r, cfg),
    },
    {
      id: "meeting_set", label: "Meeting set", stage: "qualification", width: 130, minWidth: 100, healthId: "meeting_set", registryId: "meeting_set",
      headerHelp: "For an MQL+ lead, yellow if no intro meeting is scheduled within 1 working day of receipt.",
      value: (r) => shortDate(r.intro_meeting?.scheduled_at),
    },
  );
  if (!isClient) {
    columns.push(
      {
        id: "intro_insights", label: "Meeting insights", stage: "qualification", width: 130, minWidth: 90, healthId: "intro_insights", registryId: "intro_insights",
        headerHelp: "Yellow when a meeting is set but pre-meeting insights are missing.",
        value: (r) => present(r.intro_meeting?.pre_meeting_insights),
      },
      {
        id: "intro_transcript", label: "Transcript", stage: "qualification", width: 110, minWidth: 80, healthId: "intro_transcript", registryId: "intro_transcript",
        headerHelp: "Red if the transcription link is missing more than 2 hours after the meeting.",
        value: (r) => (r.intro_meeting?.transcription_url ? "Link" : ""),
        render: (r) => <LinkCell href={r.intro_meeting?.transcription_url} label="Transcript" />,
      },
      {
        id: "intro_score", label: "Process score", stage: "qualification", width: 110, minWidth: 80, align: "right", healthId: "intro_score", registryId: "intro_score",
        headerHelp: "Quality band: green ≥70, yellow ≥50, orange ≥30, red below. Red if missing 1 day after the meeting.",
        value: (r) => r.intro_meeting?.process_score ?? null,
      },
      {
        id: "intro_conversion", label: "Conversion insights", stage: "qualification", width: 140, minWidth: 90, healthId: "intro_conversion", registryId: "intro_conversion",
        headerHelp: "Red if conversion insights are missing 1 working day after the meeting.",
        value: (r) => present(r.intro_meeting?.conversion_insights),
      },
    );
  }

  // --- Offering stage ---
  columns.push(
    {
      id: "offer_date", label: "Offer date", stage: "offering", width: 120, minWidth: 90, healthId: "offer_date", registryId: "offer_date",
      headerHelp: "After the intro meeting: yellow at +1 working day, red at +2 with no contracted offer date.",
      value: (r) => shortDate(r.current_offer?.contracted_send_date),
    },
    {
      id: "next_step_date", label: "Next-step date", stage: "offering", width: 120, minWidth: 90, healthId: "next_step_date", registryId: "next_step_date",
      headerHelp: "After the intro meeting: yellow at +1 working day, red at +2 with no contracted next-step date.",
      value: (r) => shortDate(r.next_task_due_at),
    },
    {
      // Col Y — the open-tasks list, not just a count (spec item 6).
      id: "next_steps", label: "Next steps", stage: "offering", width: 190, minWidth: 130, healthId: "next_steps", registryId: "next_steps",
      headerHelp: "Open task titles. Yellow/red when a next-step date exists but no open task backs it.",
      // `?? []` so a lead row from an older gateway response (no open_tasks field) degrades to empty
      // rather than throwing and crashing the whole table (value() is always called by the renderer).
      value: (r) => (r.open_tasks ?? []).map((t) => t.title).join(", ") || null,
      render: (r) => <TaskListCell tasks={r.open_tasks ?? []} />,
    },
  );
  if (!isClient) {
    columns.push(
      {
        id: "summary_transcript", label: "Summary transcript", stage: "offering", width: 130, minWidth: 90, healthId: "summary_transcript", registryId: "summary_transcript",
        headerHelp: "Red if the summary meeting transcription is missing more than 2 hours after the meeting.",
        value: (r) => (r.summary_meeting?.transcription_url ? "Link" : ""),
        render: (r) => <LinkCell href={r.summary_meeting?.transcription_url} label="Transcript" />,
      },
      {
        id: "summary_conversion", label: "Summary insights", stage: "offering", width: 130, minWidth: 90, healthId: "summary_conversion", registryId: "summary_conversion",
        headerHelp: "Yellow/red when summary conversion insights lag 1–2 working days after the meeting.",
        value: (r) => present(r.summary_meeting?.conversion_insights),
      },
    );
  }

  // --- Expert brand building stage ---
  columns.push(
    {
      id: "value1_date", label: "1st value date", stage: "expert_brand", width: 120, minWidth: 90, healthId: "value1_date", registryId: "value1_date",
      headerHelp: "For an SQL+ lead with a next-step date: yellow/red at +1/+2 working days without a 1st value date.",
      value: (r) => shortDate(r.value_delivery_1?.planned_date),
    },
    {
      id: "value1_items", label: "1st values", stage: "expert_brand", width: 160, minWidth: 110, healthId: "value1_items", registryId: "value1_items",
      headerHelp: "Yellow when a 1st value date is set but the value list is empty.",
      value: (r) => (r.value_delivery_1?.value_items ?? []).join(", "),
    },
    {
      id: "value1_sent", label: "1st sent", stage: "expert_brand", width: 110, minWidth: 80, healthId: "value1_sent", registryId: "value1_sent",
      headerHelp: "Yellow/red at +1/+2 working days after the planned 1st value date without a send.",
      value: (r) => shortDate(r.value_delivery_1?.sent_at),
    },
    {
      id: "value2_date", label: "2nd value date", stage: "expert_brand", width: 120, minWidth: 90, healthId: "value2_date", registryId: "value2_date",
      headerHelp: "After the 1st value date: yellow/red at +1/+2 working days without a 2nd value date.",
      value: (r) => shortDate(r.value_delivery_2?.planned_date),
    },
    {
      id: "value2_items", label: "2nd values", stage: "expert_brand", width: 160, minWidth: 110, healthId: "value2_items", registryId: "value2_items",
      headerHelp: "Yellow when a 2nd value date is set but the value list is empty.",
      value: (r) => (r.value_delivery_2?.value_items ?? []).join(", "),
    },
    {
      id: "value2_sent", label: "2nd sent", stage: "expert_brand", width: 110, minWidth: 80, healthId: "value2_sent", registryId: "value2_sent",
      headerHelp: "Yellow/red at +1/+2 working days after the planned 2nd value date without a send.",
      value: (r) => shortDate(r.value_delivery_2?.sent_at),
    },
  );

  // --- Finalization stage ---
  columns.push(
    {
      id: "negotiation", label: "Negotiation start", stage: "finalization", width: 130, minWidth: 90, healthId: "negotiation", registryId: "negotiation",
      headerHelp: "After the 2nd value: yellow at +1 week, red at +2 weeks without negotiation starting.",
      value: (r) => shortDate(r.negotiation_started_at),
    },
    {
      id: "negotiation_days", label: "Days in negotiation", stage: "finalization", width: 130, minWidth: 90, align: "right", healthId: "negotiation_days", registryId: "negotiation_days",
      headerHelp: "Duration band: green ≤30 days, yellow ≤60, orange ≤90, red beyond.",
      value: (r) => negotiationDays(r, asOf, cfg),
    },
    {
      // Col AJ — client_note and coldunicorn_note are DISTINCT channels; internal sees both, labelled,
      // never a `client_note || coldunicorn_note` merge that would hide the internal note (spec item 11).
      id: "notes", label: "Notes", stage: "finalization", width: 220, minWidth: 140, healthId: "notes", registryId: "notes",
      value: (r) => {
        if (isClient) return r.client_note;
        return [
          r.client_note?.trim() ? `Client: ${r.client_note}` : null,
          r.coldunicorn_note?.trim() ? `Internal: ${r.coldunicorn_note}` : null,
        ].filter(Boolean).join(" · ") || null;
      },
    },
  );

  // --- Conclusions stage ---
  columns.push(
    {
      id: "conclusion", label: "Conclusion", stage: "conclusions", width: 200, minWidth: 130, healthId: "conclusion", registryId: "conclusion",
      value: (r) => (r.final_outcome ? `${STATUS_LABELS[r.final_outcome]}${r.conclusion ? ` — ${r.conclusion}` : ""}` : (isClient ? "" : r.conclusion ?? "")),
    },
  );
  // Process-issue rollup (spec AO). OPEN + feature-flagged (spec item 3): while the counted-step rule is
  // unapproved it renders a non-authoritative placeholder and carries no health colour — it must not
  // read as a finished metric. When enabled it shows the derived count (0 green … 4+ red) via the table.
  if (options.includeProcessIssues && !isClient) {
    columns.push(
      CRM_PROCESS_ISSUES_ENABLED
        ? {
            id: "process_issues", label: "Process issues", stage: "conclusions", width: 110, minWidth: 80, align: "right", healthId: "process_issues", registryId: "process_issues",
            headerHelp: "Count of overdue process steps (green 0, yellow 1, orange 2–3, red 4+). Cascades from one root cause count once.",
            value: () => null, // rendered from the row's full health map by the table
          }
        : {
            id: "process_issues", label: "Process issues", stage: "conclusions", width: 110, minWidth: 80, align: "right", registryId: "process_issues",
            headerHelp: CRM_PROCESS_ISSUES_PENDING_LABEL,
            value: () => null,
            render: () => <span className="text-muted-foreground" title={CRM_PROCESS_ISSUES_PENDING_LABEL}>—</span>,
          },
    );
  }

  return withMeta(columns);
}

const NO_CRM_COLUMNS: LeadCrmColumn[] = [];

/**
 * The CRM table's columns for a given view mode (ADR-0013) — the whole mode→columns rule in one place,
 * so the internal Leads page and the client My Pipeline page cannot drift:
 *
 * - `pdca` renders `LeadReportTable`, never this table → no columns are built at all.
 * - `crm` is the banded CRM set (`includeProcessIssues` is honoured for internal roles only).
 * - `combined` (spec B.3) unions the PDCA report columns — carried as the Lead band — with the CRM
 *   stage columns, dropping the CRM lead-band duplicates. The PDCA (`getLeadStage`) Status is dropped
 *   and the CRM (`resolveCrmStatus`) Status kept, so the status taxonomy is the same in both CRM modes.
 */
export function buildLeadColumnsForViewMode(
  options: BuildLeadCrmColumnsOptions & { viewMode: LeadViewMode; reportColumns: LeadReportColumn[] },
): LeadCrmColumn[] {
  const { viewMode, reportColumns, ...crmOptions } = options;
  if (viewMode === "pdca") return NO_CRM_COLUMNS;
  const crmColumns = buildLeadCrmColumns({ ...crmOptions, includeProcessIssues: viewMode === "crm" && crmOptions.includeProcessIssues });
  if (viewMode === "crm") return crmColumns;
  const pdcaAsCrm: LeadCrmColumn[] = reportColumns.map((c) => ({
    id: `pdca:${c.id}`, label: c.label, stage: "lead", width: c.width, minWidth: c.minWidth, align: c.align,
    value: c.value, render: c.render,
  }));
  return [
    ...pdcaAsCrm.filter((c) => c.id !== "pdca:status"),
    ...crmColumns.filter((c) => c.stage !== "lead" || c.id === "status"),
  ];
}
