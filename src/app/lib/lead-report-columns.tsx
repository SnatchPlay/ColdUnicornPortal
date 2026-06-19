import { useState, type ReactNode } from "react";
import type { AppRole, LeadCustomFieldRecord, LeadHighlight } from "../types/core";
import type { LeadsListRow } from "../types/view-contracts";
import { getLeadStage } from "./selectors";
import { PIPELINE_STAGES } from "./client-view-models";
import { formatDate, getFullName } from "./format";

/**
 * Shared, dense "spreadsheet" column registry for the Leads report table (Client Feedback
 * Batch 4). The internal Leads page and the client portal report both render from this list so
 * the report mirrors the legacy Google Sheets export. Each column exposes a primitive `value`
 * accessor reused by CSV/XLSX export (Task 4G) and an optional rich `render`.
 *
 * NOTE: Status is read-only and derived from the existing getLeadStage() — this batch does not
 * change status semantics or the legacy micro-CRM booleans.
 */

export type LeadReportColumnAlign = "left" | "right" | "center";

export interface LeadReportColumn {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  align?: LeadReportColumnAlign;
  /** Maps to a loadLeadsList server sort field; omit for display-only (non-sortable) columns. */
  serverSortField?: string;
  /** Primitive cell value for CSV/XLSX export and the default text renderer. */
  value: (row: LeadsListRow) => string | number | null;
  /** Optional rich cell renderer; falls back to a truncated text node of `value`. */
  render?: (row: LeadsListRow) => ReactNode;
}

/** Manual report row highlight colours from client feedback (Batch 4, Task 4E). */
export const LEAD_HIGHLIGHT_COLORS: Record<LeadHighlight, string> = {
  green: "#06F701",
  yellow: "#F9F909",
  red: "#FA0200",
};

export const LEAD_HIGHLIGHT_ORDER: LeadHighlight[] = ["green", "yellow", "red"];

/** Semi-transparent row background so highlighted rows stay readable (~18% alpha). */
export function leadHighlightBackground(highlight: LeadHighlight | null | undefined): string | undefined {
  if (!highlight) return undefined;
  return `${LEAD_HIGHLIGHT_COLORS[highlight]}2e`;
}

export function getStageLabel(stageKey: string): string {
  return PIPELINE_STAGES.find((stage) => stage.key === stageKey)?.label ?? "Unqualified";
}

export function getStageColor(stageKey: string): string {
  return PIPELINE_STAGES.find((stage) => stage.key === stageKey)?.color ?? "#94a3b8";
}

function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  return formatDate(value, { day: "numeric", month: "short", year: "2-digit" });
}

function LinkCell({ href, label }: { href: string | null; label?: string }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      className="truncate text-sky-400 underline-offset-2 hover:underline"
    >
      {label ?? href}
    </a>
  );
}

function StatusBadge({ stageKey }: { stageKey: string }) {
  const color = getStageColor(stageKey);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}18`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {getStageLabel(stageKey)}
    </span>
  );
}

export interface BuildLeadReportColumnsOptions {
  role: AppRole | undefined;
  /** Admin/master view shows the owning Client column (multiple clients in scope). */
  showClient: boolean;
}

/**
 * Base report columns mirroring the Google Sheets export. Internal-only columns (ColdUnicorn
 * note) are omitted for the client role; the gateway also nulls coldunicorn_note for clients.
 */
export function buildLeadReportColumns(options: BuildLeadReportColumnsOptions): LeadReportColumn[] {
  const isClient = options.role === "client";
  const columns: LeadReportColumn[] = [];

  columns.push({
    id: "lead",
    label: "Full name",
    width: 190,
    minWidth: 130,
    serverSortField: "lead",
    value: (row) => getFullName(row.first_name, row.last_name) || "—",
  });

  if (options.showClient) {
    columns.push({
      id: "client",
      label: "Client",
      width: 150,
      minWidth: 100,
      serverSortField: "client",
      value: (row) => row.clientName || "—",
    });
  }

  columns.push(
    { id: "job_title", label: "Job title", width: 160, minWidth: 100, value: (row) => row.job_title },
    { id: "email", label: "Email", width: 200, minWidth: 140, value: (row) => row.email },
    { id: "phone_number", label: "Phone", width: 130, minWidth: 90, value: (row) => row.phone_number },
    { id: "phone_source", label: "Phone source", width: 120, minWidth: 80, value: (row) => row.phone_source },
    { id: "company", label: "Company", width: 180, minWidth: 120, serverSortField: "company", value: (row) => row.company_name },
    { id: "industry", label: "Industry", width: 150, minWidth: 100, value: (row) => row.industry },
    { id: "headcount", label: "Headcount", width: 110, minWidth: 80, value: (row) => row.headcount_range },
    { id: "received", label: "Lead received", width: 120, minWidth: 90, serverSortField: "created", value: (row) => shortDate(row.created_at) },
    { id: "campaign", label: "Campaign", width: 170, minWidth: 110, serverSortField: "campaign", value: (row) => row.campaignName },
    { id: "message_title", label: "Message title", width: 180, minWidth: 110, value: (row) => row.message_title },
    { id: "message_number", label: "Msg #", width: 80, minWidth: 60, align: "right", serverSortField: "step", value: (row) => row.message_number },
    {
      id: "website",
      label: "Website",
      width: 160,
      minWidth: 110,
      value: (row) => row.website,
      render: (row) => <LinkCell href={row.website} />,
    },
    { id: "qualification", label: "Qualification", width: 120, minWidth: 90, value: (row) => row.qualification },
    { id: "response_time", label: "Response time", width: 120, minWidth: 90, value: (row) => row.response_time_label },
    {
      id: "status",
      label: "Status",
      width: 150,
      minWidth: 110,
      serverSortField: "status",
      value: (row) => getStageLabel(getLeadStage(row)),
      render: (row) => <StatusBadge stageKey={getLeadStage(row)} />,
    },
    { id: "replies", label: "Replies", width: 90, minWidth: 70, align: "right", serverSortField: "replies", value: (row) => row.replyCount },
    { id: "last_reply", label: "Last reply", width: 120, minWidth: 90, serverSortField: "lastReply", value: (row) => shortDate(row.lastReplyAt) },
    { id: "reply_text", label: "Mail from lead", width: 240, minWidth: 140, value: (row) => row.reply_text },
    { id: "client_note", label: "Client note", width: 200, minWidth: 130, value: (row) => row.client_note },
  );

  if (!isClient) {
    columns.push({ id: "coldunicorn_note", label: "ColdUnicorn note", width: 200, minWidth: 130, value: (row) => row.coldunicorn_note });
  }

  columns.push({
    id: "linkedin_url",
    label: "LinkedIn",
    width: 140,
    minWidth: 100,
    value: (row) => row.linkedin_url,
    render: (row) => <LinkCell href={row.linkedin_url} label="Profile" />,
  });

  return columns;
}

// --- Custom per-client columns (Task 4F) ------------------------------------------------------

/** Read the stored value for one lead+field from a nested values map. */
export type LeadCustomValueLookup = (leadId: string, fieldId: string) => string | null;

/**
 * Build a report column for a per-client custom field. Values are edited inline (when `canEdit`)
 * and persisted via `onChange`; sorting falls back to display order (server-paginated, so no
 * client-only header sort to avoid partial-page ordering surprises).
 */
export function leadCustomFieldColumn(
  field: LeadCustomFieldRecord,
  lookup: LeadCustomValueLookup,
  canEdit: boolean,
  onChange?: (leadId: string, fieldId: string, value: string | null) => void,
): LeadReportColumn {
  const numeric = field.field_type === "number" || field.field_type === "currency";
  return {
    id: `cf:${field.id}`,
    label: field.name,
    width: field.field_type === "checkbox" ? 90 : field.field_type === "droplist" ? 130 : 140,
    minWidth: field.field_type === "checkbox" ? 60 : 80,
    align: numeric ? "right" : "left",
    value: (row) => lookup(row.id, field.id),
    render: (row) => (
      <CustomFieldCell
        field={field}
        value={lookup(row.id, field.id)}
        canEdit={canEdit}
        onChange={onChange ? (next) => onChange(row.id, field.id, next) : undefined}
      />
    ),
  };
}

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function CustomFieldCell({
  field,
  value,
  canEdit,
  onChange,
}: {
  field: LeadCustomFieldRecord;
  value: string | null;
  canEdit: boolean;
  onChange?: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const editable = canEdit && Boolean(onChange);

  if (field.field_type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === "true"}
        disabled={!editable}
        onClick={stop}
        onChange={(event) => onChange?.(event.target.checked ? "true" : "false")}
        className="h-4 w-4 accent-sky-500"
      />
    );
  }

  if (field.field_type === "droplist") {
    if (!editable) return <span className="truncate">{value || "—"}</span>;
    return (
      <select
        value={value ?? ""}
        onClick={stop}
        onChange={(event) => onChange?.(event.target.value || null)}
        className="w-full rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-xs text-white outline-none"
      >
        <option value="">—</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.field_type === "link" && !editable) {
    return <LinkCell href={value} />;
  }

  if (!editable) return <span className="truncate">{value || "—"}</span>;

  return (
    <input
      type="text"
      value={draft}
      inputMode={field.field_type === "number" || field.field_type === "currency" ? "decimal" : undefined}
      onClick={stop}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim() === "" ? null : draft;
        if (next !== (value ?? null)) onChange?.(next);
      }}
      className="w-full rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-xs text-white outline-none"
    />
  );
}
