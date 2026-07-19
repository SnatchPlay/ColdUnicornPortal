import { describe, expect, it } from "vitest";
import { buildExportMatrix } from "../lead-report-export";
import { buildLeadReportColumns } from "../lead-report-columns";
import { leadCustomFieldColumn } from "../lead-report-columns";
import type { LeadsListRow } from "../../types/view-contracts";
import type { LeadCustomFieldRecord } from "../../types/core";

function makeRow(overrides: Partial<LeadsListRow> = {}): LeadsListRow {
  return {
    id: "lead-1",
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-06-01T10:00:00.000Z",
    client_id: "client-1",
    campaign_id: "camp-1",
    email: "jane@acme.test",
    first_name: "Jane",
    last_name: "Doe",
    job_title: "CTO",
    company_name: "Acme",
    linkedin_url: null,
    gender: null,
    qualification: "MQL",
    expected_return_date: null,
    external_id: null,
    phone_number: null,
    phone_source: null,
    industry: null,
    headcount_range: null,
    website: null,
    country: "PL",
    message_title: null,
    message_number: 2,
    response_time_hours: null,
    response_time_label: null,
    meeting_booked: false,
    meeting_held: false,
    offer_sent: false,
    won: false,
    added_to_ooo_campaign: false,
    external_blacklist_id: null,
    external_domain_blacklist_id: null,
    source: "test",
    reply_text: null,
    client_note: "looks promising",
    coldunicorn_note: "internal-only",
    highlight: "green",
    sequencer_id: "00000000-0000-4000-a000-000000000002",
    linkedin_invitation_sent_at: null,
    contact_made_at: null,
    contact_method: null,
    negotiation_started_at: null,
    conclusion: null,
    concluded_at: null,
    final_outcome: null,
    clientName: "Acme",
    campaignName: "Campaign Alpha",
    replyCount: 0,
    lastReplyAt: null,
    ...overrides,
  };
}

describe("buildExportMatrix", () => {
  it("emits a header row plus a trailing Highlight column", () => {
    const columns = buildLeadReportColumns({ role: "admin", showClient: false });
    const matrix = buildExportMatrix(columns, [makeRow()], new Map());
    expect(matrix[0][matrix[0].length - 1]).toBe("Highlight");
    expect(matrix[1][matrix[1].length - 1]).toBe("green");
  });

  it("omits the ColdUnicorn note column for the client role", () => {
    const clientColumns = buildLeadReportColumns({ role: "client", showClient: false });
    const matrix = buildExportMatrix(clientColumns, [makeRow()], new Map());
    expect(matrix[0]).not.toContain("ColdUnicorn note");
    // Client-facing note is still present.
    expect(matrix[0]).toContain("Client note");
  });

  it("includes the ColdUnicorn note column for internal roles", () => {
    const adminColumns = buildLeadReportColumns({ role: "admin", showClient: false });
    const matrix = buildExportMatrix(adminColumns, [makeRow()], new Map());
    expect(matrix[0]).toContain("ColdUnicorn note");
    const idx = matrix[0].indexOf("ColdUnicorn note");
    expect(matrix[1][idx]).toBe("internal-only");
  });

  it("sources custom column values from the export value map, not the row", () => {
    const field: LeadCustomFieldRecord = {
      id: "field-9",
      client_id: "client-1",
      name: "Region",
      field_type: "text",
      options: null,
      position: 0,
      editable_by: ["admin", "master_admin"],
      created_by: null,
      created_at: "2026-06-01T00:00:00.000Z",
    };
    const custom = leadCustomFieldColumn(field, () => null, false);
    const values = new Map<string, string | null>([["lead-1:field-9", "EMEA"]]);
    const matrix = buildExportMatrix([custom], [makeRow()], values);
    expect(matrix[0]).toEqual(["Region", "Highlight"]);
    expect(matrix[1]).toEqual(["EMEA", "green"]);
  });
});
