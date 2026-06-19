import { describe, expect, it } from "vitest";
import { buildLeadPatch, toLeadDraft } from "../lead-draft";
import type { LeadRecord } from "../../types/core";

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: "lead-1",
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-06-01T10:00:00.000Z",
    client_id: "client-1",
    campaign_id: null,
    email: null,
    first_name: "Jane",
    last_name: "Doe",
    job_title: null,
    company_name: null,
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
    country: null,
    message_title: null,
    message_number: null,
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
    client_note: "old client note",
    coldunicorn_note: null,
    highlight: null,
    ...overrides,
  };
}

describe("buildLeadPatch — Batch 4 notes", () => {
  it("emits client_note and coldunicorn_note only when changed", () => {
    const lead = makeLead();
    const draft = toLeadDraft(lead);
    draft.clientNote = "new client note";
    draft.coldunicornNote = "internal note";
    const patch = buildLeadPatch(lead, draft);
    expect(patch.client_note).toBe("new client note");
    expect(patch.coldunicorn_note).toBe("internal note");
  });

  it("produces an empty patch when nothing changes", () => {
    const lead = makeLead();
    const patch = buildLeadPatch(lead, toLeadDraft(lead));
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("seeds the draft from client_note (renamed comments) and coldunicorn_note", () => {
    const lead = makeLead({ client_note: "cn", coldunicorn_note: "un" });
    const draft = toLeadDraft(lead);
    expect(draft.clientNote).toBe("cn");
    expect(draft.coldunicornNote).toBe("un");
  });
});
