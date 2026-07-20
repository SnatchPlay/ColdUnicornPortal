/**
 * Canonical Cold CRM / PDCA column registry — the single source of truth for the full column set
 * (ADR-0013, spec §5 + §9). It is DECLARATIVE metadata only: it does not render.
 *
 * Keyed by a STABLE SEMANTIC id (`LeadCrmColumnId`), NOT by the spreadsheet letter. Spreadsheet letters
 * (A..AS) are UNSTABLE — inserting a column between P and Q shifts every later letter even though the
 * fields' meaning is unchanged — so they are metadata (`spreadsheetColumn`) for traceability only:
 * reconciling with the source document, the A:AS dump, documentation, and client feedback ("bug in
 * column Y"). They never key the registry, drive business logic, or appear in a render-path lookup.
 *
 * Why the registry exists (spec item 8): before it, each column's identity was smeared across the
 * gateway projection, `if (!isClient)` branches, the table renderer, mode composition, and the health
 * evaluator. This re-centralises, for EVERY column (including PDCA-only, OPEN, and DEFERRED ones that
 * never render as a CRM cell): mode visibility, stage band, source entity, implementation status,
 * editability, role visibility, and health attachment.
 *
 * `buildLeadCrmColumns` renders the SUBSET that is a live CRM cell; each rendered column carries a typed
 * `registryId` and `withMeta` stamps `LEAD_CRM_REGISTRY[registryId]` — a statically-checked lookup, so a
 * typo is a compile error, not a runtime miss. Coverage of all 45 columns is asserted by the tests.
 */

export type LeadCrmMode = "pdca" | "crm" | "combined";

export type LeadCrmRegistryStage =
  | "global"
  | "lead"
  | "qualification"
  | "offering"
  | "expert_brand"
  | "finalization"
  | "campaign"
  | "conclusions"
  | "support";

export type LeadCrmSource =
  | "lead"
  | "meeting"
  | "offer"
  | "task"
  | "value_delivery"
  | "campaign"
  | "replies"
  | "derived"
  | "support";

export type LeadCrmImplStatus =
  | "existing"
  | "new_field"
  | "new_entity"
  | "joined"
  | "derived"
  | "partial"
  | "open"
  | "deferred";

export type LeadCrmEditable =
  | "read_only"
  | "drawer"
  | "structured_action"
  | "automation_with_correction"
  | "atomic_action"
  | "deferred";

/** `true`/`false` where product has decided; `"open"` where the spec explicitly leaves it undecided. */
export type RoleVisibilityFlag = boolean | "open";

export interface LeadCrmRoleVisibility {
  client: RoleVisibilityFlag;
  manager: RoleVisibilityFlag;
  admin: RoleVisibilityFlag;
  internal: RoleVisibilityFlag;
}

/**
 * The STABLE semantic identifier for a CRM column — the canonical registry key. Unlike a spreadsheet
 * letter it survives a column being inserted, moved, or re-lettered in the source document. It also
 * keys the health evaluator, so a rendered column, its registry entry, and its health cell all agree.
 */
export type LeadCrmColumnId =
  | "company"
  | "industry"
  | "headcount"
  | "job_title"
  | "full_name"
  | "phone"
  | "email"
  | "linkedin_url"
  | "linkedin_invitation"
  | "domain"
  | "msg_history"
  | "msg_number"
  | "status"
  | "lead_received"
  | "intro_script"
  | "contact_made"
  | "days_to_contact"
  | "meeting_set"
  | "intro_insights"
  | "intro_transcript"
  | "intro_score"
  | "intro_conversion"
  | "offer_date"
  | "next_step_date"
  | "next_steps"
  | "summary_transcript"
  | "summary_conversion"
  | "value1_date"
  | "value1_items"
  | "value1_sent"
  | "value2_date"
  | "value2_items"
  | "value2_sent"
  | "negotiation"
  | "negotiation_days"
  | "notes"
  | "message_title"
  | "campaign_name"
  | "campaign_id"
  | "conclusion"
  | "process_issues"
  | "crm_ai_support"
  | "workshops_videos"
  | "pdca_ai_support"
  | "performance_insights";

export interface LeadCrmRegistryEntry {
  /** Spreadsheet column letter (A..AS) — TRACEABILITY metadata only, never a lookup key. */
  spreadsheetColumn: string;
  label: string;
  stage: LeadCrmRegistryStage;
  modes: LeadCrmMode[];
  source: LeadCrmSource;
  implementationStatus: LeadCrmImplStatus;
  editable: LeadCrmEditable;
  /** Health evaluator id (=== the column's own semantic id) when the column carries a health cell. */
  healthId?: LeadCrmColumnId;
  visibility: LeadCrmRoleVisibility;
  /** OPEN/DEFERRED/PARTIAL rationale, kept verbatim so the registry documents its own gaps. */
  note?: string;
}

// Common visibility presets.
const ALL: LeadCrmRoleVisibility = { client: true, manager: true, admin: true, internal: true };
const INTERNAL_ONLY: LeadCrmRoleVisibility = { client: false, manager: true, admin: true, internal: true };
// Spec §8 VISIBILITY_OPEN: currently hidden from the client, but the client-facing decision is NOT
// signed off — encoded as `open` so the registry flags it rather than asserting a final answer.
const CLIENT_OPEN: LeadCrmRoleVisibility = { client: "open", manager: true, admin: true, internal: true };

const both: LeadCrmMode[] = ["pdca", "crm", "combined"];
const pdca: LeadCrmMode[] = ["pdca", "combined"];
const crm: LeadCrmMode[] = ["crm", "combined"];

/**
 * The full registry, keyed by stable semantic id and declared with `satisfies
 * Record<LeadCrmColumnId, …>` so omitting or duplicating any column is a compile error. Written in
 * spreadsheet order (A:AS) so `Object.values` yields the document order for the dump. OPEN/DEFERRED
 * entries are present but carry no live cell.
 */
export const LEAD_CRM_REGISTRY = {
  // --- Global lead context ---
  company: { spreadsheetColumn: "A", label: "Company", stage: "global", modes: both, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "company", visibility: ALL },
  industry: { spreadsheetColumn: "B", label: "Industry", stage: "global", modes: pdca, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "industry", visibility: ALL },
  // --- Lead stage ---
  headcount: { spreadsheetColumn: "C", label: "Headcount", stage: "lead", modes: pdca, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "headcount", visibility: ALL },
  job_title: { spreadsheetColumn: "D", label: "Job title", stage: "lead", modes: pdca, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "job_title", visibility: ALL },
  full_name: { spreadsheetColumn: "E", label: "Name & surname", stage: "lead", modes: both, source: "lead", implementationStatus: "derived", editable: "drawer", healthId: "full_name", visibility: ALL, note: "Derived from first_name + last_name; edit the parts, not the join." },
  phone: { spreadsheetColumn: "F", label: "Phone", stage: "lead", modes: both, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "phone", visibility: ALL },
  email: { spreadsheetColumn: "G", label: "Email", stage: "lead", modes: both, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "email", visibility: ALL },
  linkedin_url: { spreadsheetColumn: "H", label: "LinkedIn URL", stage: "lead", modes: pdca, source: "lead", implementationStatus: "existing", editable: "drawer", visibility: ALL, note: "No client health rule — neutral." },
  linkedin_invitation: { spreadsheetColumn: "I", label: "LinkedIn invite", stage: "lead", modes: crm, source: "lead", implementationStatus: "new_field", editable: "automation_with_correction", healthId: "linkedin_invitation", visibility: ALL, note: "Yellow only when the LinkedIn (Aimfox) integration is connected; na when disconnected." },
  domain: { spreadsheetColumn: "J", label: "Domain", stage: "lead", modes: pdca, source: "derived", implementationStatus: "open", editable: "read_only", visibility: ALL, note: "OPEN: website domain vs email domain unconfirmed — neutral until product sign-off." },
  msg_history: { spreadsheetColumn: "K", label: "Msg history", stage: "lead", modes: both, source: "replies", implementationStatus: "partial", editable: "read_only", healthId: "msg_history", visibility: ALL, note: "PARTIAL: reply count is reliable; full outbound/inbound thread is OPEN." },
  msg_number: { spreadsheetColumn: "L", label: "Msg number", stage: "lead", modes: pdca, source: "lead", implementationStatus: "existing", editable: "read_only", healthId: "msg_number", visibility: ALL },
  status: { spreadsheetColumn: "M", label: "Status", stage: "lead", modes: both, source: "derived", implementationStatus: "derived", editable: "atomic_action", visibility: ALL, note: "Split model: derived crm_stage + stored final_outcome; colour map OPEN (no health)." },
  // --- Qualification stage ---
  lead_received: { spreadsheetColumn: "N", label: "Lead received", stage: "qualification", modes: both, source: "lead", implementationStatus: "existing", editable: "read_only", healthId: "lead_received", visibility: ALL, note: "leads.created_at is canonical; no separate received_at." },
  intro_script: { spreadsheetColumn: "O", label: "Intro script", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "intro_script", visibility: CLIENT_OPEN },
  contact_made: { spreadsheetColumn: "P", label: "Contact made", stage: "qualification", modes: crm, source: "lead", implementationStatus: "new_field", editable: "automation_with_correction", healthId: "contact_made", visibility: ALL, note: "contact_method phone|email; exact day unit OPEN." },
  days_to_contact: { spreadsheetColumn: "Q", label: "Days to contact", stage: "qualification", modes: crm, source: "derived", implementationStatus: "derived", editable: "read_only", healthId: "days_to_contact", visibility: ALL, note: "Working days created_at → contact_made_at; shares contact_made's colour, shown as a count." },
  meeting_set: { spreadsheetColumn: "R", label: "Meeting set", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "structured_action", healthId: "meeting_set", visibility: ALL },
  intro_insights: { spreadsheetColumn: "S", label: "Meeting insights", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "intro_insights", visibility: CLIENT_OPEN },
  intro_transcript: { spreadsheetColumn: "T", label: "Transcript", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "intro_transcript", visibility: CLIENT_OPEN },
  intro_score: { spreadsheetColumn: "U", label: "Process score", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "intro_score", visibility: CLIENT_OPEN, note: "Score bands 30/50/70 RECOMMENDED, exact boundaries OPEN." },
  intro_conversion: { spreadsheetColumn: "V", label: "Conversion insights", stage: "qualification", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "intro_conversion", visibility: CLIENT_OPEN },
  // --- Offering stage ---
  offer_date: { spreadsheetColumn: "W", label: "Offer date", stage: "offering", modes: crm, source: "offer", implementationStatus: "new_entity", editable: "structured_action", healthId: "offer_date", visibility: ALL, note: "A contracted offer date drives the derived SQL stage; day unit OPEN." },
  next_step_date: { spreadsheetColumn: "X", label: "Next-step date", stage: "offering", modes: crm, source: "task", implementationStatus: "new_entity", editable: "structured_action", healthId: "next_step_date", visibility: ALL },
  next_steps: { spreadsheetColumn: "Y", label: "Next steps", stage: "offering", modes: crm, source: "task", implementationStatus: "new_entity", editable: "structured_action", healthId: "next_steps", visibility: ALL, note: "Shows open task titles (list); count is a helper, not the content." },
  summary_transcript: { spreadsheetColumn: "Z", label: "Summary transcript", stage: "offering", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "summary_transcript", visibility: CLIENT_OPEN },
  summary_conversion: { spreadsheetColumn: "AA", label: "Summary insights", stage: "offering", modes: crm, source: "meeting", implementationStatus: "new_entity", editable: "automation_with_correction", healthId: "summary_conversion", visibility: CLIENT_OPEN },
  // --- Expert brand building stage ---
  value1_date: { spreadsheetColumn: "AB", label: "1st value date", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "new_entity", editable: "structured_action", healthId: "value1_date", visibility: ALL },
  value1_items: { spreadsheetColumn: "AC", label: "1st values", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "new_entity", editable: "structured_action", healthId: "value1_items", visibility: ALL },
  value1_sent: { spreadsheetColumn: "AD", label: "1st sent", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "derived", editable: "structured_action", healthId: "value1_sent", visibility: ALL },
  value2_date: { spreadsheetColumn: "AE", label: "2nd value date", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "new_entity", editable: "structured_action", healthId: "value2_date", visibility: ALL },
  value2_items: { spreadsheetColumn: "AF", label: "2nd values", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "new_entity", editable: "structured_action", healthId: "value2_items", visibility: ALL },
  value2_sent: { spreadsheetColumn: "AG", label: "2nd sent", stage: "expert_brand", modes: crm, source: "value_delivery", implementationStatus: "derived", editable: "structured_action", healthId: "value2_sent", visibility: ALL },
  // --- Finalization stage ---
  negotiation: { spreadsheetColumn: "AH", label: "Negotiation start", stage: "finalization", modes: crm, source: "lead", implementationStatus: "new_field", editable: "automation_with_correction", healthId: "negotiation", visibility: ALL },
  negotiation_days: { spreadsheetColumn: "AI", label: "Days in negotiation", stage: "finalization", modes: crm, source: "derived", implementationStatus: "derived", editable: "read_only", healthId: "negotiation_days", visibility: ALL, note: "Calendar-day band 30/60/90 RECOMMENDED; counting stops at concluded_at." },
  notes: { spreadsheetColumn: "AJ", label: "Notes", stage: "finalization", modes: crm, source: "lead", implementationStatus: "existing", editable: "drawer", healthId: "notes", visibility: ALL, note: "client_note is client-facing; coldunicorn_note is internal — shown as separate channels, not merged." },
  // --- Campaign context ---
  message_title: { spreadsheetColumn: "AK", label: "Message title", stage: "campaign", modes: pdca, source: "lead", implementationStatus: "existing", editable: "read_only", visibility: ALL },
  campaign_name: { spreadsheetColumn: "AL", label: "Campaign name", stage: "campaign", modes: pdca, source: "campaign", implementationStatus: "joined", editable: "read_only", visibility: ALL },
  campaign_id: { spreadsheetColumn: "AM", label: "Campaign ID", stage: "campaign", modes: pdca, source: "campaign", implementationStatus: "joined", editable: "read_only", visibility: ALL, note: "Display external_id; UUID stays internal." },
  // --- Conclusions stage ---
  conclusion: { spreadsheetColumn: "AN", label: "Conclusion", stage: "conclusions", modes: crm, source: "lead", implementationStatus: "new_field", editable: "atomic_action", healthId: "conclusion", visibility: CLIENT_OPEN, note: "final_outcome + non-empty conclusion + concluded_at written atomically (concludeLead)." },
  process_issues: { spreadsheetColumn: "AO", label: "Process issues", stage: "conclusions", modes: crm, source: "derived", implementationStatus: "open", editable: "read_only", healthId: "process_issues", visibility: INTERNAL_ONLY, note: "OPEN: counted-step list unconfirmed — feature-flagged OFF, non-authoritative until sign-off." },
  crm_ai_support: { spreadsheetColumn: "AP", label: "CRM AI support", stage: "conclusions", modes: ["crm"], source: "support", implementationStatus: "deferred", editable: "deferred", visibility: INTERNAL_ONLY, note: "DEFERRED: not a per-lead column; no persistence object in MVP." },
  // --- Support outputs ---
  workshops_videos: { spreadsheetColumn: "AQ", label: "Workshops videos", stage: "support", modes: both, source: "support", implementationStatus: "open", editable: "deferred", visibility: ALL, note: "OPEN: onboarding/help content, not per-lead operational data." },
  pdca_ai_support: { spreadsheetColumn: "AR", label: "PDCA AI support", stage: "support", modes: ["pdca"], source: "support", implementationStatus: "deferred", editable: "deferred", visibility: ALL, note: "DEFERRED." },
  performance_insights: { spreadsheetColumn: "AS", label: "Performance insights", stage: "support", modes: ["crm", "combined"], source: "support", implementationStatus: "deferred", editable: "deferred", visibility: { client: false, manager: false, admin: false, internal: true }, note: "DEFERRED; Cold Unicorn internal only." },
} satisfies Record<LeadCrmColumnId, LeadCrmRegistryEntry>;

/** The registry as an ordered list (spreadsheet order) — for the A:AS dump and traceability tests. */
export const LEAD_CRM_REGISTRY_LIST: LeadCrmRegistryEntry[] = Object.values(LEAD_CRM_REGISTRY);
