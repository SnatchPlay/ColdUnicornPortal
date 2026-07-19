/**
 * Deterministic per-cell health evaluator for the Lead CRM view (Cold CRM / PDCA spec, Appendices
 * C, D, E). Pure, dependency-free, and imported by BOTH the browser and the Deno `orm-gateway` (same
 * contract as `business-days.ts`) so backend and frontend can never disagree on a red/orange cell.
 *
 * Model (spec §6, Appendix D.1):
 *   not_applicable  prerequisite not active for this lead   (suppresses downstream cascades)
 *   pending         prerequisite active, deadline not passed
 *   green           completed / healthy
 *   yellow          first warning threshold
 *   orange          stronger warning (only where the client defines it)
 *   red             overdue / failed
 *   neutral         presence-only field, value simply absent (no SLA)
 *
 * Colours are DERIVED at read time from an explicit `asOf` — never stored, never from the browser
 * clock (spec §6.1). Prerequisite suppression gives "one root failure counts once" for free: a
 * downstream cell whose prerequisite is unmet resolves to `not_applicable` and is excluded from
 * `process_issues_count` (spec Appendix D.4/D.6).
 *
 * OPEN thresholds (spec Appendix C/F) are encoded with the spec's RECOMMENDED normalized values and
 * marked `RECOMMENDED` inline. Where the client gave no rule at all, the column is left neutral.
 */

import {
  addBusinessDays,
  addCalendarWeeks,
  addHours,
  businessDaysBetweenCivil,
  businessDeadline,
  calendarDaysBetween,
  civilDateOf,
  contactDayZero,
  endOfDayIso,
  isPastDeadline,
  type BusinessDayConfig,
} from "./business-days";

export type HealthState =
  | "neutral"
  | "not_applicable"
  | "pending"
  | "green"
  | "yellow"
  | "orange"
  | "red";

export interface CellHealth {
  state: HealthState;
  /** Deterministic, human-readable explanation for the tooltip and QA (spec Appendix E.2). */
  reason: string;
  /** Nullable calculated deadline (ISO). Present for `pending` and overdue states. */
  deadlineAt: string | null;
}

export interface HealthContext {
  /** Authoritative "now" (server clock). Passed in for determinism (spec §6.1, Appendix E.4). */
  asOf: string;
  businessDays: BusinessDayConfig;
}

/** CRM status taxonomy (spec §2; enum `lead_crm_status`). Terminal: `lost`, `lost_premql`. */
export type LeadCrmStatus = "preMQL" | "MQL" | "SQL" | "won" | "lost" | "lost_premql";

export interface CrmMeetingFacts {
  status?: string | null; // planned | scheduled | held | cancelled | no_show
  scheduled_at?: string | null;
  held_at?: string | null;
  call_script?: string | null;
  transcription_url?: string | null;
  pre_meeting_insights?: string | null;
  process_score?: number | null;
  conversion_insights?: string | null;
}

export interface CrmOfferFacts {
  status?: string | null;
  contracted_send_date?: string | null;
}

export interface CrmValueDeliveryFacts {
  planned_date?: string | null;
  value_items?: string[] | null;
  sent_at?: string | null;
}

/**
 * Minimal structural type the evaluator reads. Both the full server projection (`LeadCrmRow`) and
 * hand-built test fixtures satisfy it — the evaluator never needs the whole record (mirrors the
 * `LeadStageFields` pattern in `selectors.ts`).
 */
export interface LeadCrmFacts {
  status?: string | null; // LeadCrmStatus
  company_name?: string | null;
  industry?: string | null;
  headcount_range?: string | null;
  job_title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  linkedin_invitation_sent_at?: string | null;
  linkedin_integration_connected?: boolean | null;
  message_number?: number | null;
  /** camelCase to match LeadCrmRow (inherited from LeadsListRow) so a row satisfies the facts directly. */
  replyCount?: number | null;
  created_at?: string | null; // lead received date
  contact_made_at?: string | null;
  contact_method?: string | null; // phone | email
  negotiation_started_at?: string | null;
  conclusion?: string | null;
  concluded_at?: string | null;
  final_outcome?: "won" | "lost" | "lost_premql" | null;
  client_note?: string | null;
  coldunicorn_note?: string | null;
  intro_meeting?: CrmMeetingFacts | null;
  summary_meeting?: CrmMeetingFacts | null;
  current_offer?: CrmOfferFacts | null;
  next_task_due_at?: string | null;
  open_tasks_count?: number | null;
  value_delivery_1?: CrmValueDeliveryFacts | null;
  value_delivery_2?: CrmValueDeliveryFacts | null;
}

// --- primitives ------------------------------------------------------------------------------

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const na = (reason = "Prerequisite not met"): CellHealth => ({ state: "not_applicable", reason, deadlineAt: null });
const neutral = (reason = ""): CellHealth => ({ state: "neutral", reason, deadlineAt: null });
const green = (reason: string): CellHealth => ({ state: "green", reason, deadlineAt: null });
const pending = (reason: string, deadlineAt: string | null): CellHealth => ({ state: "pending", reason, deadlineAt });
const overdue = (state: HealthState, reason: string, deadlineAt: string | null): CellHealth => ({ state, reason, deadlineAt });

function presence(value: unknown, label: string): CellHealth {
  return isPresent(value) ? green(`${label} set`) : neutral(`${label} not set`);
}

// --- status helpers --------------------------------------------------------------------------

const STATUS_RANK: Record<string, number> = { preMQL: 0, MQL: 1, SQL: 2, won: 3 };

function isLost(status?: string | null): boolean {
  return status === "lost" || status === "lost_premql";
}
/** Any terminal outcome (won/lost/lost_premql) — all of them stop forward-step SLA nagging: a closed
 *  deal or a lost lead should not show overdue value-delivery / negotiation cells (spec Appendix D.4
 *  names LOST; the split status model treats every `final_outcome` uniformly as terminal). */
function isTerminal(status?: string | null): boolean {
  return isLost(status) || status === "won";
}
function atLeastMql(status?: string | null): boolean {
  return !isLost(status) && (STATUS_RANK[status ?? ""] ?? -1) >= STATUS_RANK.MQL;
}
function atLeastSql(status?: string | null): boolean {
  return !isLost(status) && (STATUS_RANK[status ?? ""] ?? -1) >= STATUS_RANK.SQL;
}

// --- meeting helpers -------------------------------------------------------------------------

function meetingScheduledOrHeld(m?: CrmMeetingFacts | null): boolean {
  // "Active" is keyed on STATUS only — the single source of truth shared with the boolean-recompute
  // trigger (`status in ('scheduled','held')`, ADR-0013 §5). Keying on a bare scheduled_at/held_at
  // timestamp too would let a still-'planned' meeting read as active in the CRM colours while the KPI
  // boolean stayed false. cancelled/no_show fall through to false naturally.
  return m?.status === "scheduled" || m?.status === "held";
}
function meetingAnchor(m?: CrmMeetingFacts | null): string | null {
  return m?.held_at ?? m?.scheduled_at ?? null;
}

// --- generic timed SLA (1wd/2wd, 2h, calendar-week thresholds) -------------------------------

interface Threshold {
  workingDays?: number;
  hours?: number;
  weeks?: number;
  state: HealthState;
}

function thresholdIso(anchorIso: string, t: Threshold, cfg: BusinessDayConfig): string {
  if (t.hours != null) return addHours(anchorIso, t.hours);
  if (t.weeks != null) return addCalendarWeeks(anchorIso, t.weeks);
  return businessDeadline(anchorIso, t.workingDays ?? 0, cfg);
}

/**
 * Standard SLA cell: `not_applicable` when the prerequisite is unmet, `green` when the value is
 * present, otherwise the worst passed threshold (or `pending` before the first). Terminal-lost
 * suppresses future warnings (spec Appendix D.4).
 */
function timedSla(params: {
  prereqMet: boolean;
  present: boolean;
  presentReason: string;
  missingLabel: string;
  anchorIso: string | null;
  thresholds: Threshold[];
  terminal: boolean;
  ctx: HealthContext;
}): CellHealth {
  if (!params.prereqMet) return na();
  if (params.present) return green(params.presentReason);
  if (params.terminal) return na("Lead is terminal — future SLA suppressed");
  if (!isPresent(params.anchorIso)) return pending(`${params.missingLabel} — awaiting anchor date`, null);

  const evaluated = params.thresholds
    .map((t) => ({ state: t.state, at: thresholdIso(params.anchorIso as string, t, params.ctx.businessDays) }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let result = pending(`${params.missingLabel} — deadline not reached`, evaluated[0]?.at ?? null);
  for (const e of evaluated) {
    if (isPastDeadline(e.at, params.ctx.asOf)) {
      result = overdue(e.state, `${params.missingLabel} — overdue`, e.at);
    }
  }
  return result;
}

// --- column evaluators (spreadsheet letters, spec Appendix A) --------------------------------

function contactMade(facts: LeadCrmFacts, ctx: HealthContext): CellHealth {
  const cfg = ctx.businessDays;
  const received = facts.created_at;
  if (!isPresent(received)) return neutral("No received date");
  const hasPhone = isPresent(facts.phone_number);
  const day0 = contactDayZero(received as string, cfg);

  if (!isPresent(facts.contact_made_at)) {
    if (isTerminal(facts.status)) return na("Lead is lost — future SLA suppressed");
    const redAt = endOfDayIso(addBusinessDays(day0, 1, cfg), cfg);
    if (isPastDeadline(redAt, ctx.asOf)) return overdue("red", "Contact not made within 1 working day", redAt);
    const day0End = endOfDayIso(day0, cfg);
    // Past day 0 with no contact: green is no longer reachable, so surface the day+1 warning window
    // (spec §5.2 matrix treats "one working day later" as a warning) rather than staying pending.
    if (isPastDeadline(day0End, ctx.asOf)) return overdue("yellow", "Contact not made on day 0", redAt);
    return pending("Awaiting first contact", day0End);
  }

  const method = facts.contact_method === "phone" ? "phone" : "email";
  const offset = businessDaysBetweenCivil(day0, civilDateOf(facts.contact_made_at as string, cfg), cfg);

  let state: HealthState;
  if (hasPhone) {
    if (offset <= 0) state = method === "phone" ? "green" : "yellow";
    else if (offset === 1) state = method === "phone" ? "yellow" : "orange";
    else state = "red";
  } else {
    if (offset <= 0) state = "green";
    else if (offset === 1) state = "yellow";
    else state = "red";
  }
  const timing = offset <= 0 ? "on day 0" : offset === 1 ? "1 working day later" : `${offset} working days later`;
  return { state, reason: `Contacted by ${method} ${timing}${hasPhone ? "" : " (no phone on file)"}`, deadlineAt: null };
}

/** Q "Days to contact" shares P's state exactly but explains itself as a working-day count. */
function daysToContact(facts: LeadCrmFacts, ctx: HealthContext): CellHealth {
  const base = contactMade(facts, ctx);
  if (!isPresent(facts.created_at) || !isPresent(facts.contact_made_at)) return base;
  const day0 = contactDayZero(facts.created_at as string, ctx.businessDays);
  const days = businessDaysBetweenCivil(day0, civilDateOf(facts.contact_made_at as string, ctx.businessDays), ctx.businessDays);
  return { ...base, reason: `${Math.max(0, days)} working day(s) to contact` };
}

function introProcessScore(facts: LeadCrmFacts, ctx: HealthContext): CellHealth {
  const intro = facts.intro_meeting;
  const score = intro?.process_score;
  // A populated score is a fact — grade it regardless of whether the meeting row's status/timestamps
  // were advanced to scheduled/held yet.
  if (score != null) {
    // RECOMMENDED boundaries (spec §5.2 U / Appendix C.2 leave exact 30/50/70 OPEN).
    if (score >= 70) return green(`Process score ${score}`);
    if (score >= 50) return overdue("yellow", `Process score ${score}`, null);
    if (score >= 30) return overdue("orange", `Process score ${score}`, null);
    return overdue("red", `Process score ${score}`, null);
  }
  if (!meetingScheduledOrHeld(intro)) return na();
  if (isTerminal(facts.status)) return na("Lead is lost — future SLA suppressed");
  const anchor = meetingAnchor(intro);
  if (!anchor) return pending("Score pending — awaiting meeting date", null);
  const deadline = businessDeadline(anchor, 1, ctx.businessDays);
  return isPastDeadline(deadline, ctx.asOf)
    ? overdue("red", "Process score missing 1 day after meeting", deadline)
    : pending("Score pending", deadline);
}

function daysInNegotiation(facts: LeadCrmFacts, ctx: HealthContext): CellHealth {
  if (!isPresent(facts.negotiation_started_at)) return na("Negotiation not started");
  if (isTerminal(facts.status)) return na("Lead is lost — negotiation age suppressed"); // spec Appendix D.4
  const end = isPresent(facts.concluded_at) ? (facts.concluded_at as string) : ctx.asOf;
  const days = calendarDaysBetween(facts.negotiation_started_at as string, end, ctx.businessDays);
  // RECOMMENDED boundaries 0-30/31-60/61-90/91+ (spec Appendix C.5 leaves exact 30/60/90 OPEN).
  let state: HealthState;
  if (days <= 30) state = "green";
  else if (days <= 60) state = "yellow";
  else if (days <= 90) state = "orange";
  else state = "red";
  return { state, reason: `${days} day(s) in negotiation`, deadlineAt: null };
}

type ColumnEvaluator = (facts: LeadCrmFacts, ctx: HealthContext) => CellHealth;

const COLUMN_EVALUATORS: Record<string, ColumnEvaluator> = {
  // --- Lead stage (presence → green/neutral) ---
  A: (f) => presence(f.company_name, "Company"),
  B: (f) => presence(f.industry, "Industry"),
  C: (f) => presence(f.headcount_range, "Headcount"),
  D: (f) => presence(f.job_title, "Job title"),
  E: (f) => presence(`${f.first_name ?? ""}${f.last_name ?? ""}`.trim(), "Name"),
  F: (f) => presence(f.phone_number, "Phone"),
  G: (f) => presence(f.email, "Email"),
  I: (f) => {
    if (isPresent(f.linkedin_invitation_sent_at)) return green("Invitation sent");
    if (f.linkedin_integration_connected) return overdue("yellow", "Integration connected, invitation not sent", null);
    return na("LinkedIn automation not connected"); // avoid falsely-yellow disconnected customers (spec Appendix F, col I)
  },
  K: (f) => ((f.replyCount ?? 0) > 0 ? green("Message history exists") : neutral("No message history")),
  L: (f) => presence(f.message_number, "Message number"),

  // --- Qualification stage ---
  N: (f) => presence(f.created_at, "Lead received date"),
  O: (f) => (isPresent(f.intro_meeting?.call_script) ? green("Intro script set") : overdue("yellow", "Intro call script missing", null)),
  P: contactMade,
  Q: daysToContact, // Days to contact shares P's state but explains itself as a day count (spec §5.2 Q)
  R: (f, ctx) =>
    timedSla({
      prereqMet: atLeastMql(f.status),
      present: meetingScheduledOrHeld(f.intro_meeting),
      presentReason: "Intro meeting set",
      missingLabel: "Intro meeting not set",
      anchorIso: f.created_at ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }], // client gives yellow only, no red (spec C.2 R)
      terminal: isTerminal(f.status),
      ctx,
    }),
  S: (f) => {
    if (!(atLeastMql(f.status) && meetingScheduledOrHeld(f.intro_meeting))) return na();
    return isPresent(f.intro_meeting?.pre_meeting_insights)
      ? green("Pre-meeting insights set")
      : overdue("yellow", "Meeting set, insights missing", null);
  },
  T: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.intro_meeting),
      present: isPresent(f.intro_meeting?.transcription_url),
      presentReason: "Transcription link set",
      missingLabel: "Intro transcription missing",
      anchorIso: meetingAnchor(f.intro_meeting),
      thresholds: [{ hours: 2, state: "red" }],
      terminal: false, // transcript is about a held meeting, not a future step
      ctx,
    }),
  U: introProcessScore,
  V: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.intro_meeting),
      present: isPresent(f.intro_meeting?.conversion_insights),
      presentReason: "Conversion insights set",
      missingLabel: "Intro conversion insights missing",
      anchorIso: meetingAnchor(f.intro_meeting),
      thresholds: [{ workingDays: 1, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),

  // --- Offering stage ---
  W: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.intro_meeting),
      present: isPresent(f.current_offer?.contracted_send_date),
      presentReason: "Contracted offer date set",
      missingLabel: "Contracted offer date missing",
      anchorIso: meetingAnchor(f.intro_meeting),
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  X: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.intro_meeting),
      present: isPresent(f.next_task_due_at),
      presentReason: "Contracted next-step date set",
      missingLabel: "Contracted next-step date missing",
      anchorIso: meetingAnchor(f.intro_meeting),
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  Y: (f, ctx) =>
    timedSla({
      prereqMet: isPresent(f.next_task_due_at),
      present: (f.open_tasks_count ?? 0) > 0,
      presentReason: "Open task exists",
      missingLabel: "Next-step task missing",
      anchorIso: f.next_task_due_at ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  Z: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.summary_meeting),
      present: isPresent(f.summary_meeting?.transcription_url),
      presentReason: "Summary transcription set",
      missingLabel: "Summary transcription missing",
      anchorIso: meetingAnchor(f.summary_meeting),
      thresholds: [{ hours: 2, state: "red" }],
      terminal: false,
      ctx,
    }),
  AA: (f, ctx) =>
    timedSla({
      prereqMet: meetingScheduledOrHeld(f.summary_meeting),
      present: isPresent(f.summary_meeting?.conversion_insights),
      presentReason: "Summary insights set",
      missingLabel: "Summary conversion insights missing",
      anchorIso: meetingAnchor(f.summary_meeting),
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),

  // --- Expert brand building stage ---
  AB: (f, ctx) =>
    timedSla({
      prereqMet: atLeastSql(f.status) && isPresent(f.next_task_due_at),
      present: isPresent(f.value_delivery_1?.planned_date),
      presentReason: "First value date set",
      missingLabel: "First value date missing",
      anchorIso: f.next_task_due_at ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  AC: (f) => {
    if (!isPresent(f.value_delivery_1?.planned_date)) return na();
    return isPresent(f.value_delivery_1?.value_items)
      ? green("First values list set")
      : overdue("yellow", "First value date set, list empty", null);
  },
  AD: (f, ctx) =>
    timedSla({
      prereqMet: isPresent(f.value_delivery_1?.planned_date),
      present: isPresent(f.value_delivery_1?.sent_at),
      presentReason: "First value sent",
      missingLabel: "First value not sent",
      anchorIso: f.value_delivery_1?.planned_date ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  AE: (f, ctx) =>
    timedSla({
      prereqMet: atLeastSql(f.status) && isPresent(f.value_delivery_1?.planned_date),
      present: isPresent(f.value_delivery_2?.planned_date),
      presentReason: "Second value date set",
      missingLabel: "Second value date missing",
      anchorIso: f.value_delivery_1?.planned_date ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  AF: (f) => {
    if (!isPresent(f.value_delivery_2?.planned_date)) return na();
    return isPresent(f.value_delivery_2?.value_items)
      ? green("Second values list set")
      : overdue("yellow", "Second value date set, list empty", null);
  },
  AG: (f, ctx) =>
    timedSla({
      prereqMet: isPresent(f.value_delivery_2?.planned_date),
      present: isPresent(f.value_delivery_2?.sent_at),
      presentReason: "Second value sent",
      missingLabel: "Second value not sent",
      anchorIso: f.value_delivery_2?.planned_date ?? null,
      thresholds: [{ workingDays: 1, state: "yellow" }, { workingDays: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),

  // --- Finalization stage ---
  AH: (f, ctx) =>
    timedSla({
      prereqMet: isPresent(f.value_delivery_2?.sent_at) || isPresent(f.value_delivery_2?.planned_date),
      present: isPresent(f.negotiation_started_at),
      presentReason: "Negotiation started",
      missingLabel: "Negotiation not started",
      anchorIso: f.value_delivery_2?.sent_at ?? f.value_delivery_2?.planned_date ?? null,
      thresholds: [{ weeks: 1, state: "yellow" }, { weeks: 2, state: "red" }],
      terminal: isTerminal(f.status),
      ctx,
    }),
  AI: daysInNegotiation,
  AJ: (f) => presence(isPresent(f.client_note) ? f.client_note : f.coldunicorn_note, "Notes"),

  // --- Conclusions stage ---
  // Keyed on the terminal outcome (the real "concluded" signal), not concluded_at alone: the CHECK
  // only enforces final_outcome ⇒ concluded_at, so concluded_at can be set without an outcome.
  AN: (f) => (isPresent(f.final_outcome) ? green("Concluded") : neutral("Not concluded")),
};

/** All column ids the evaluator produces a health state for (excludes derived `AO`). */
export const CRM_HEALTH_COLUMN_IDS = Object.keys(COLUMN_EVALUATORS);

/** States that count toward the AO process-issue tally. Yellow is excluded (spec Appendix D.6 OPEN). */
const ISSUE_STATES: ReadonlySet<HealthState> = new Set<HealthState>(["orange", "red"]);

/**
 * Canonical set of steps counted by AO (spec Appendix D.6 leaves this list OPEN — this is the current
 * RECOMMENDED set). It contains each DISTINCT missing/overdue SLA step and deliberately EXCLUDES:
 *   - `Q` — it is the same underlying step as `P` (contact); counting both would double a single
 *     root failure, violating "one root failure counts once";
 *   - `U` (process score) and `AI` (days in negotiation) — quality/duration bands, not overdue steps;
 *   - presence-only columns and yellow-only columns (`R`, `S`, `O`, `AC`, `AF`, `AN`) which never
 *     reach an ISSUE_STATE anyway.
 */
const AO_COUNTED_COLUMN_IDS: ReadonlySet<string> = new Set<string>([
  "P", "T", "V", "W", "X", "Y", "Z", "AA", "AB", "AD", "AE", "AG", "AH",
]);

/** Evaluate one column's health. Unknown/neutral columns (H, J, M, campaign cols) return neutral. */
export function evaluateCellHealth(colId: string, facts: LeadCrmFacts, ctx: HealthContext): CellHealth {
  const evaluator = COLUMN_EVALUATORS[colId];
  return evaluator ? evaluator(facts, ctx) : neutral();
}

/**
 * AO — count of active steps in an overdue state, restricted to the canonical counted set so a single
 * root failure counts once and quality bands don't inflate the tally (spec Appendix D.6). Prerequisite
 * suppression already turns downstream cells into `not_applicable`, keeping cascades out of the count.
 */
export function processIssuesCount(health: Record<string, CellHealth>): number {
  let count = 0;
  for (const [colId, cell] of Object.entries(health)) {
    if (AO_COUNTED_COLUMN_IDS.has(colId) && ISSUE_STATES.has(cell.state)) count += 1;
  }
  return count;
}

/** Map the AO count to its own cell health (spec §6.3: 0→green, 1→yellow, 2-3→orange, 4+→red). */
export function processIssuesHealth(count: number): CellHealth {
  const state: HealthState = count === 0 ? "green" : count === 1 ? "yellow" : count <= 3 ? "orange" : "red";
  return { state, reason: `${count} process issue(s)`, deadlineAt: null };
}

/** Evaluate every CRM column for one lead, including the derived AO cell. */
export function evaluateLeadHealth(facts: LeadCrmFacts, ctx: HealthContext): Record<string, CellHealth> {
  const health: Record<string, CellHealth> = {};
  for (const colId of CRM_HEALTH_COLUMN_IDS) {
    health[colId] = evaluateCellHealth(colId, facts, ctx);
  }
  health.AO = processIssuesHealth(processIssuesCount(health));
  return health;
}
