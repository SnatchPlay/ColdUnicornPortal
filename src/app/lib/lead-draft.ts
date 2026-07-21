import { civilDateOf, DEFAULT_BUSINESS_DAY_CONFIG } from "./crm/business-days";
import type { ContactMethod, LeadGender, LeadQualification, LeadRecord } from "../types/core";

/**
 * Editable lead draft + diff helpers shared by the Leads page drawer and the Manager dashboard
 * lead drawer. Per ADR-0004 only operational lead state is editable; `buildLeadPatch` emits a
 * minimal patch of changed fields so optimistic updates stay small.
 */

export const EDITABLE_QUALIFICATIONS: LeadQualification[] = [
  "preMQL",
  "MQL",
  "meeting_scheduled",
  "meeting_held",
  "offer_sent",
  "won",
  "rejected",
];

export const LEAD_QUALIFICATION_UNSET = "__lead_unqualified__";
export const LEAD_GENDER_UNSET = "__lead_gender_unset__";
export const CONTACT_METHOD_UNSET = "__lead_contact_method_unset__";

export interface LeadDraft {
  qualification: LeadQualification | "";
  clientNote: string;
  coldunicornNote: string;
  meetingBooked: boolean;
  meetingHeld: boolean;
  offerSent: boolean;
  won: boolean;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyName: string;
  linkedinUrl: string;
  phoneNumber: string;
  phoneSource: string;
  gender: LeadGender | "";
  country: string;
  industry: string;
  headcountRange: string;
  website: string;
  // Lead CRM operational fields (ADR-0013, Phase 5.2). Dates are edited as YYYY-MM-DD (stored as
  // timestamptz midnight); the health engine only reads their civil date.
  contactMadeAt: string;
  contactMethod: ContactMethod | "";
  negotiationStartedAt: string;
  linkedinInvitationSentAt: string;
}

/**
 * Civil date (YYYY-MM-DD) of a stored timestamp in the CRM business timezone — NOT a raw UTC slice.
 * This matches the day the health engine reads (`civilDateOf`), so a `type="date"` input seeded/diffed
 * with it shows the same day the SLA uses and re-saving never shifts a lead's health civil date.
 */
export function datePart(value: string | null): string | null {
  if (!value) return null;
  const d = civilDateOf(value, DEFAULT_BUSINESS_DAY_CONFIG);
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function toLeadDraft(lead: LeadRecord): LeadDraft {
  return {
    qualification: lead.qualification ?? "",
    clientNote: lead.client_note ?? "",
    coldunicornNote: lead.coldunicorn_note ?? "",
    meetingBooked: lead.meeting_booked,
    meetingHeld: lead.meeting_held,
    offerSent: lead.offer_sent,
    won: lead.won,
    email: lead.email ?? "",
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    jobTitle: lead.job_title ?? "",
    companyName: lead.company_name ?? "",
    linkedinUrl: lead.linkedin_url ?? "",
    phoneNumber: lead.phone_number ?? "",
    phoneSource: lead.phone_source ?? "",
    gender: lead.gender ?? "",
    country: lead.country ?? "",
    industry: lead.industry ?? "",
    headcountRange: lead.headcount_range ?? "",
    website: lead.website ?? "",
    contactMadeAt: datePart(lead.contact_made_at) ?? "",
    contactMethod: lead.contact_method ?? "",
    negotiationStartedAt: datePart(lead.negotiation_started_at) ?? "",
    linkedinInvitationSentAt: datePart(lead.linkedin_invitation_sent_at) ?? "",
  };
}

/** Trim a form string to its stored value: empty/whitespace → null, else the trimmed text. */
export function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function buildLeadPatch(lead: LeadRecord, draft: LeadDraft): Partial<LeadRecord> {
  const patch: Partial<LeadRecord> = {};

  const nextQualification = draft.qualification || null;
  if ((lead.qualification ?? null) !== nextQualification) patch.qualification = nextQualification;
  if ((lead.client_note ?? "") !== draft.clientNote) patch.client_note = draft.clientNote;
  if ((lead.coldunicorn_note ?? "") !== draft.coldunicornNote) patch.coldunicorn_note = draft.coldunicornNote;
  if (lead.meeting_booked !== draft.meetingBooked) patch.meeting_booked = draft.meetingBooked;
  if (lead.meeting_held !== draft.meetingHeld) patch.meeting_held = draft.meetingHeld;
  if (lead.offer_sent !== draft.offerSent) patch.offer_sent = draft.offerSent;
  if (lead.won !== draft.won) patch.won = draft.won;

  const nextEmail = nullableString(draft.email);
  if ((lead.email ?? null) !== nextEmail) patch.email = nextEmail;
  const nextFirst = nullableString(draft.firstName);
  if ((lead.first_name ?? null) !== nextFirst) patch.first_name = nextFirst;
  const nextLast = nullableString(draft.lastName);
  if ((lead.last_name ?? null) !== nextLast) patch.last_name = nextLast;
  const nextJob = nullableString(draft.jobTitle);
  if ((lead.job_title ?? null) !== nextJob) patch.job_title = nextJob;
  const nextCompany = nullableString(draft.companyName);
  if ((lead.company_name ?? null) !== nextCompany) patch.company_name = nextCompany;
  const nextLinkedIn = nullableString(draft.linkedinUrl);
  if ((lead.linkedin_url ?? null) !== nextLinkedIn) patch.linkedin_url = nextLinkedIn;
  const nextPhone = nullableString(draft.phoneNumber);
  if ((lead.phone_number ?? null) !== nextPhone) patch.phone_number = nextPhone;
  const nextPhoneSource = nullableString(draft.phoneSource);
  if ((lead.phone_source ?? null) !== nextPhoneSource) patch.phone_source = nextPhoneSource;
  const nextGender = (draft.gender || null) as LeadGender | null;
  if ((lead.gender ?? null) !== nextGender) patch.gender = nextGender;
  const nextCountry = nullableString(draft.country);
  if ((lead.country ?? null) !== nextCountry) patch.country = nextCountry;
  const nextIndustry = nullableString(draft.industry);
  if ((lead.industry ?? null) !== nextIndustry) patch.industry = nextIndustry;
  const nextHeadcount = nullableString(draft.headcountRange);
  if ((lead.headcount_range ?? null) !== nextHeadcount) patch.headcount_range = nextHeadcount;
  const nextWebsite = nullableString(draft.website);
  if ((lead.website ?? null) !== nextWebsite) patch.website = nextWebsite;
  // OOO fields are gone from the draft (ADR-0015): the portal no longer writes out-of-office state
  // onto a lead — that state belongs to `ooo_followups`, and the gateway's mapLeadPatch whitelist
  // rejects these columns now.

  // CRM operational fields — dates diffed on their civil date so re-opening a lead whose stored
  // timestamp has a time component does not emit a spurious midnight-truncating patch.
  const nextContactMade = draft.contactMadeAt || null;
  if (datePart(lead.contact_made_at) !== nextContactMade) patch.contact_made_at = nextContactMade;
  const nextMethod = (draft.contactMethod || null) as ContactMethod | null;
  if ((lead.contact_method ?? null) !== nextMethod) patch.contact_method = nextMethod;
  const nextNegotiation = draft.negotiationStartedAt || null;
  if (datePart(lead.negotiation_started_at) !== nextNegotiation) patch.negotiation_started_at = nextNegotiation;
  const nextLinkedInInvite = draft.linkedinInvitationSentAt || null;
  if (datePart(lead.linkedin_invitation_sent_at) !== nextLinkedInInvite) patch.linkedin_invitation_sent_at = nextLinkedInInvite;

  return patch;
}
