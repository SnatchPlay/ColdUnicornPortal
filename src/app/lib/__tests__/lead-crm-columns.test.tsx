import { describe, expect, it } from "vitest";
import { buildLeadCrmColumns, CRM_STAGES } from "../lead-crm-columns";
import type { LeadCrmRow } from "../../types/view-contracts";

function row(over: Partial<LeadCrmRow> = {}): LeadCrmRow {
  return {
    id: "l1", first_name: "Jane", last_name: "Doe", company_name: "Acme",
    qualification: "MQL", meeting_booked: false, meeting_held: false, offer_sent: false, won: false,
    final_outcome: null, created_at: "2026-06-01T10:00:00Z", clientName: "Acme", replyCount: 0,
    open_tasks: [], open_tasks_count: 0, intro_meeting: null, summary_meeting: null, current_offer: null,
    next_task_due_at: null, value_delivery_1: null, value_delivery_2: null,
    linkedin_integration_connected: false,
    ...over,
  } as LeadCrmRow;
}

const byId = (cols: ReturnType<typeof buildLeadCrmColumns>) => new Set(cols.map((c) => c.id));

describe("buildLeadCrmColumns", () => {
  it("covers every stage band", () => {
    const cols = buildLeadCrmColumns({ role: "admin", showClient: false });
    const stages = new Set(cols.map((c) => c.stage));
    for (const s of CRM_STAGES) expect(stages.has(s.key)).toBe(true);
  });

  it("hides internal-only columns from the client role", () => {
    const admin = byId(buildLeadCrmColumns({ role: "admin", showClient: false }));
    const client = byId(buildLeadCrmColumns({ role: "client", showClient: false }));
    for (const internal of ["intro_script", "intro_transcript", "intro_score", "summary_transcript", "summary_conversion"]) {
      expect(admin.has(internal)).toBe(true);
      expect(client.has(internal)).toBe(false);
    }
  });

  it("shows the Client column only when showClient", () => {
    expect(byId(buildLeadCrmColumns({ role: "admin", showClient: true })).has("client")).toBe(true);
    expect(byId(buildLeadCrmColumns({ role: "admin", showClient: false })).has("client")).toBe(false);
  });

  const cols = buildLeadCrmColumns({ role: "admin", showClient: false });
  const col = (id: string) => cols.find((c) => c.id === id)!;

  it("Status resolves via resolveCrmStatus (final_outcome wins, else derived stage)", () => {
    expect(col("status").value(row({ meeting_booked: true }))).toBe("SQL");
    expect(col("status").value(row({ final_outcome: "won", concluded_at: "x" }))).toBe("Won");
  });

  it("Contact made shows date + method", () => {
    expect(col("contact_made").value(row({ contact_made_at: "2026-07-13T10:00:00Z", contact_method: "phone" }))).toMatch(/phone/);
  });

  it("value1_items joins the array", () => {
    expect(col("value1_items").value(row({ value_delivery_1: { planned_date: "2026-07-14", value_items: ["a", "b"], sent_at: null } }))).toBe("a, b");
  });

  it("Next steps (col Y) renders the open task titles, not a count", () => {
    const tasks = [
      { id: "t1", title: "Prepare proposal", due_at: null, status: "planned" as const, position: 0 },
      { id: "t2", title: "Schedule follow-up", due_at: null, status: "planned" as const, position: 1 },
    ];
    expect(col("next_steps").value(row({ open_tasks: tasks, open_tasks_count: 2 }))).toBe("Prepare proposal, Schedule follow-up");
    expect(col("next_steps").value(row({ open_tasks: [], open_tasks_count: 0 }))).toBeNull();
  });

  it("Msg history (col K) surfaces the reply count", () => {
    expect(col("msg_history").value(row({ replyCount: 4 }))).toBe(4);
    expect(col("msg_history").value(row({ replyCount: 0 }))).toBeNull();
  });

  it("Days to contact (col Q) is a WORKING-day count (matches the health reason basis, not calendar)", () => {
    expect(col("days_to_contact").healthId).toBe("days_to_contact");
    // Fri → Mon: 3 calendar days but 1 working day (Sat/Sun skipped). The value must be the working-day
    // count so it agrees with the Contact-made health tooltip, which uses the same basis.
    expect(col("days_to_contact").value(row({ created_at: "2026-06-05T10:00:00Z", contact_made_at: "2026-06-08T10:00:00Z" }))).toBe(1);
    expect(col("days_to_contact").value(row({ contact_made_at: null }))).toBeNull();
  });

  it("stamps rendered columns with their canonical registry metadata (spec item 8)", () => {
    expect(col("company").meta?.implementationStatus).toBe("existing");
    expect(col("company").registryId).toBe("company");
    expect(col("company").meta?.spreadsheetColumn).toBe("A"); // letter kept as traceability metadata
    expect(col("msg_history").meta?.implementationStatus).toBe("partial");
    expect(col("offer_date").meta?.source).toBe("offer");
  });

  it("AO is non-authoritative while the feature flag is off (no health colour)", () => {
    const cols = buildLeadCrmColumns({ role: "admin", showClient: false, includeProcessIssues: true });
    const ao = cols.find((c) => c.id === "process_issues")!;
    // Flag OFF (default): the column exists for registry completeness but carries no health colour.
    expect(ao.registryId).toBe("process_issues");
    expect(ao.healthId).toBeUndefined();
  });

  it("maps SLA columns to their spreadsheet health letters", () => {
    expect(col("company").healthId).toBe("company");
    expect(col("contact_made").healthId).toBe("contact_made");
    expect(col("negotiation_days").healthId).toBe("negotiation_days");
    expect(col("conclusion").healthId).toBe("conclusion");
    // Non-SLA columns carry no health letter.
    expect(col("status").healthId).toBeUndefined();
  });

  it("appends the AO process-issues column only for internal + includeProcessIssues", () => {
    expect(byId(buildLeadCrmColumns({ role: "admin", showClient: false })).has("process_issues")).toBe(false);
    expect(byId(buildLeadCrmColumns({ role: "admin", showClient: false, includeProcessIssues: true })).has("process_issues")).toBe(true);
    // Client role never gets the rollup — its projection nulls the internal SLA fields AO would tally.
    expect(byId(buildLeadCrmColumns({ role: "client", showClient: false, includeProcessIssues: true })).has("process_issues")).toBe(false);
  });
});
