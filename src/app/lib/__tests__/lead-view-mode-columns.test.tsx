import { describe, expect, it } from "vitest";
import { buildLeadColumnsForViewMode } from "../lead-crm-columns";
import { buildLeadReportColumns } from "../lead-report-columns";
import { isCrmViewMode } from "../crm/lead-view-mode";

/**
 * The mode→columns rule shared by the internal Leads page and the client My Pipeline page
 * (ADR-0013). Nothing in this repo type-checks, so these assertions are the contract.
 */
const reportColumns = buildLeadReportColumns({ role: "admin", showClient: false });
const clientReportColumns = buildLeadReportColumns({ role: "client", showClient: false });
const ids = (cols: ReturnType<typeof buildLeadColumnsForViewMode>) => cols.map((c) => c.id);

describe("isCrmViewMode", () => {
  it("treats CRM and Combined as the same read-model, PDCA as the other one", () => {
    expect(isCrmViewMode("pdca")).toBe(false);
    expect(isCrmViewMode("crm")).toBe(true);
    expect(isCrmViewMode("combined")).toBe(true);
  });
});

describe("buildLeadColumnsForViewMode", () => {
  it("builds nothing in PDCA mode — that mode renders LeadReportTable", () => {
    expect(buildLeadColumnsForViewMode({ viewMode: "pdca", reportColumns, role: "admin", showClient: false })).toEqual([]);
  });

  it("CRM mode is the banded CRM set, with no PDCA columns mixed in", () => {
    const cols = ids(buildLeadColumnsForViewMode({ viewMode: "crm", reportColumns, role: "admin", showClient: false }));
    expect(cols).toContain("contact_made");
    expect(cols.some((id) => id.startsWith("pdca:"))).toBe(false);
  });

  it("Combined unions the PDCA columns as the Lead band and keeps ONE status column", () => {
    const cols = ids(buildLeadColumnsForViewMode({ viewMode: "combined", reportColumns, role: "admin", showClient: false }));
    // PDCA columns lead, carried as the Lead band…
    expect(cols).toContain("pdca:lead"); // the report table's Full name column
    // …minus their status: the CRM (resolveCrmStatus) one is the single source of the taxonomy.
    expect(cols).not.toContain("pdca:status");
    expect(cols.filter((id) => id === "status" || id === "pdca:status")).toEqual(["status"]);
    // …and the CRM lead-band duplicates (company/email/phone) are dropped, their stages kept.
    expect(cols).not.toContain("company");
    expect(cols).toContain("contact_made");
    expect(new Set(cols).size).toBe(cols.length);
  });

  it("honours includeProcessIssues only in CRM mode", () => {
    const crm = ids(buildLeadColumnsForViewMode({ viewMode: "crm", reportColumns, role: "admin", showClient: false, includeProcessIssues: true }));
    const combined = ids(buildLeadColumnsForViewMode({ viewMode: "combined", reportColumns, role: "admin", showClient: false, includeProcessIssues: true }));
    expect(crm).toContain("process_issues");
    expect(combined).not.toContain("process_issues");
  });

  it("drops internal-only columns for the client role in both CRM modes", () => {
    for (const viewMode of ["crm", "combined"] as const) {
      const cols = ids(buildLeadColumnsForViewMode({
        viewMode, reportColumns: clientReportColumns, role: "client", showClient: false, includeProcessIssues: true,
      }));
      for (const internal of ["intro_script", "intro_transcript", "intro_score", "summary_conversion", "process_issues"]) {
        expect(cols).not.toContain(internal);
      }
      expect(cols).not.toContain("pdca:coldunicorn_note");
    }
  });
});
