import { describe, expect, it } from "vitest";
import { buildLeadCrmColumns, CRM_STAGES } from "../lead-crm-columns";
import type { LeadCrmRow } from "../../types/view-contracts";

function row(over: Partial<LeadCrmRow> = {}): LeadCrmRow {
  return {
    id: "l1", first_name: "Jane", last_name: "Doe", company_name: "Acme",
    qualification: "MQL", meeting_booked: false, meeting_held: false, offer_sent: false, won: false,
    final_outcome: null, created_at: "2026-06-01T10:00:00Z", clientName: "Acme", replyCount: 0,
    open_tasks_count: 0, intro_meeting: null, summary_meeting: null, current_offer: null,
    next_task_due_at: null, value_delivery_1: null, value_delivery_2: null,
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

  it("Disposition derives OOO/NRR from qualification", () => {
    expect(col("disposition").value(row({ qualification: "OOO" }))).toBe("OOO");
    expect(col("disposition").value(row({ qualification: "MQL" }))).toBe("");
  });

  it("Contact made shows date + method", () => {
    expect(col("contact_made").value(row({ contact_made_at: "2026-07-13T10:00:00Z", contact_method: "phone" }))).toMatch(/phone/);
  });

  it("value1_items joins the array", () => {
    expect(col("value1_items").value(row({ value_delivery_1: { planned_date: "2026-07-14", value_items: ["a", "b"], sent_at: null } }))).toBe("a, b");
  });

  it("Open tasks reads the count", () => {
    expect(col("next_steps").value(row({ open_tasks_count: 3 }))).toBe(3);
  });
});
