import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { useDevRenderCount, useWhyDidYouRender } from "../../lib/react-profiler-dev";
import type { SelectionStore } from "./selection-store";
import type { OooRoutingHealthRow } from "../../types/view-contracts";
import { oooHealthRank, oooHealthWord } from "../../lib/ooo-health";
// Reused rather than formatDate: the stamp has to carry HOW OLD, not just a date. A six-week-old
// status looks identical to a four-minute-old one otherwise — the argument describeChecked was
// written for, and the same one this column has to make.
import { describeChecked } from "./sequencer-connections";
import type { ClientSequencerCreds } from "./client-drawer";
import type { ClientSequencerRecord } from "../../types/core";
import { SatisfactionHearts } from "../../components/satisfaction-hearts";
import { ArchivedBadge } from "../../components/archive-controls";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../components/ui/utils";
import type {
  ClientMetricsOverview,
  ClientMetricsPack,
  DodRow,
  MetricsChannelView,
  MomRow,
  ThreeDodRow,
  WowRow,
} from "../../lib/client-metrics";
import type { evaluateClientConditions } from "../../lib/conditions/client-condition-results";
import { dodCellKey, momCellKey, threeDodCellKey, wowCellKey } from "../../lib/conditions/client-condition-results";
import type { DodCellKind } from "../../lib/conditions/client-condition-results";
import { getCellCondition } from "../../lib/conditions/evaluator";
import type { ConditionEvaluationResult, ConditionSeverity } from "../../lib/conditions/types";
import { formatNumber } from "../../lib/format";
import { getCustomFieldSortValue } from "../../lib/custom-field-sort";
import { useResizableColumns } from "../../lib/use-resizable-columns";
import { CLIENT_STATUSES } from "../../types/core";
import type {
  ClientCustomFieldRecord,
  ClientRecord,
  ClientStatus,
  ColumnOverrideRecord,
  SatisfactionLevel,
} from "../../types/core";

export type SortDirection = "asc" | "desc";

/**
 * Channel view switch for the clients tab: show both channels, or narrow to one.
 *
 * In a single-channel view the neutral metric bands (Schedule, Daily sent, 3-DoD, WoW, MoM) keep
 * their columns and positions and render that channel's numbers — the page projects the metrics
 * pack through `projectMetricsToChannel` before building rows. So a combined ("Total") number is
 * only ever on screen in `both`, and the EmailBison and Aimfox views are structurally identical.
 */
export type ChannelView = MetricsChannelView;
export const CHANNEL_VIEWS: ChannelView[] = ["both", "email", "aimfox"];

export interface ClientMegaRow {
  client: ClientRecord;
  managerName: string;
  metrics: ClientMetricsPack;
  conditionPack: ReturnType<typeof evaluateClientConditions> | null;
  /** Connector rows for this client — carries setup_state for the provisioning column. */
  sequencerCreds: ClientSequencerCreds;
  /** Derived OOO routing health (ADR-0015). Null when the client has no active routing rule. */
  oooHealth: OooRoutingHealthRow | null;
}

export interface MegaSortState {
  key: string;
  direction: SortDirection;
}

type Align = "left" | "center" | "right";
type Group =
  | "cs"
  | "basic"
  | "dodSched"
  | "dodSent"
  | "dodSchedAf"
  | "dodSentAf"
  | "aimfoxCap"
  | "td3"
  | "wow"
  | "mom"
  | "custom";

interface MegaColumn {
  id: string;
  group: Group;
  sub: string;
  label: string;
  width: number;
  minWidth: number;
  align: Align;
  sticky?: boolean;
  /**
   * The column's data is native to one channel and has NO counterpart in the other — the Bison
   * reply/bounce/OOO rates, the Aimfox acceptance rate and capacity. Hidden in the other channel's
   * view. undefined = neutral: the column renders whatever the projected pack holds.
   */
  channel?: "email" | "aimfox";
  /**
   * A side-by-side comparison column: the "· EB" / "· AF" splits and the "(Aimfox)" mirror bands.
   * In a single-channel view the neutral band already carries that channel's numbers, so these are
   * duplicates — visible only when channelView === "both".
   */
  splitOnly?: true;
  /**
   * `projectMetricsToChannel` rewrites this cell's value outside the Both view — "always" for the
   * lead counts (both channels have their own), "aimfoxOnly" for the daily_stats bands, which are
   * already EmailBison and are only swapped in the Aimfox view. Declared here rather than
   * re-derived from metric keys so that splitting one more metric cannot leave a cell tinted
   * against a number no rule was evaluated on. See `retargetProjectedConditionKeys`.
   */
  projected?: "always" | "aimfoxOnly";
  /** Render the cell content (without condition wrapper). */
  render: (row: ClientMegaRow) => ReactNode;
  /** Sort comparator key — string or number. */
  sortValue?: (row: ClientMegaRow) => string | number | null;
  /** When true, renders the 1-based row index instead of col.render(). */
  ordinal?: boolean;
  /** Optional explicit condition column key (matches `column_key` on condition rules). */
  conditionKey?: string;
  /** Condition cell key for DoD per-bucket lookup (overrides conditionKey). */
  dodBucket?: string;
  dodKind?: DodCellKind;
  /** Condition cell key for WoW per-bucket lookup (overrides conditionKey). */
  wowBucket?: string;
  wowMetricKey?: string;
  /** Condition cell key for 3-DoD per-bucket lookup (overrides conditionKey). */
  td3Bucket?: string;
  td3MetricKey?: string;
  /** Condition cell key for MoM per-bucket lookup (overrides conditionKey). */
  momBucket?: string;
  momMetricKey?: string;
  defaultDirection?: SortDirection;
}

// ── Provisioning marks (ADR-0018 §6; written by the setup workflows, read here) ─────────────────

/** No row at all is a state, not an absence — it is the Audytel case and it ranks worst. */
function provisioningState(row: ClientSequencerRecord | null): string {
  if (!row) return "no_connector";
  const state = (row.setup_state as { state?: string } | null)?.state;
  return state ?? "never";
}

const PROVISIONING_WORDS: Record<string, string> = {
  configured: "configured",
  partial: "partly configured",
  missing: "not wired",
  needs_selection: "workspace not chosen",
  client_not_found: "no connector enabled",
  no_connector: "no connector",
  never: "never checked",
};

function provisioningWord(row: ClientSequencerRecord | null): string {
  return PROVISIONING_WORDS[provisioningState(row)] ?? provisioningState(row);
}

/**
 * Higher = more wrong. Summed across both sequencers so one sort surfaces the worst clients.
 *
 * Deliberately 4-level while the mark is 2-colour (see ProvisioningMark): an absent connector is not
 * evidence of a fault and must not outrank a run that actually found something wrong, and that
 * distinction is the only reason to sort this column.
 */
function provisioningRank(row: ClientSequencerRecord | null): number {
  switch (provisioningState(row)) {
    case "configured":
      return 0;
    case "never":
    case "no_connector":
      return 1;
    case "partial":
    case "needs_selection":
      return 2;
    default:
      return 3;
  }
}

// Indexed by oooHealthRank. Ranks 1 (auto OOO off) and 2 (never configured) are muted rather than
// red for the reason the Workspaces column records: a deliberate configuration is not a fault, and a
// column that is mostly red stops being read.
const OOO_RANK_TONES = [
  "border-emerald-400/40 bg-emerald-500/15 text-emerald-100", // 0 · covered, and every rule sending
  "border-white/15 bg-white/5 text-white/40",                 // 1 · auto OOO off
  "border-white/15 bg-white/5 text-white/40",                 // 2 · no rules at all
  "border-amber-400/40 bg-amber-500/15 text-amber-100",       // 3 · setup unfinished: no general fallback, or not sending yet
  "border-amber-400/40 bg-amber-500/15 text-amber-100",       // 4 · some rules dead
  "border-rose-400/40 bg-rose-500/15 text-rose-100",          // 5 · nothing can send
];

function ProvisioningMark({ letter, row }: { letter: string; row: ClientSequencerRecord | null }) {
  // Two states by request: green = wired and working, muted = anything else. Note this drops the
  // amber ("partly configured", "workspace not chosen") and red ("not wired") tones a setup run
  // reports, so a broken workspace now looks the same as a channel the client never bought — the
  // trade the column was asked for, since it is read as a 56-row sweep of "is this channel live?".
  // The tooltip still names the exact state and provisioningRank still sorts on all four.
  const isConfigured = provisioningState(row) === "configured";
  return (
    <span
      className={cn(
        // min-w rather than w: the LinkedIn mark carries two characters (Li / Lf) once the service
        // level is known, and a fixed 1rem box clips them.
        "inline-flex h-4 min-w-4 items-center justify-center rounded border px-[2px] text-[9px] font-bold",
        isConfigured
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
          : "border-white/15 bg-white/5 text-white/40",
      )}
    >
      {letter}
    </span>
  );
}

/**
 * The LinkedIn service level, as one letter. Derived from whether any ACTIVE Aimfox campaign
 * carries message templates (`campaigns.message_steps`) — the vendor's `outreach_type` reads
 * 'connect' on every campaign in every workspace and separates nothing.
 */
function linkedinLetter(mode: ClientMetricsOverview["aimfoxCampaignMode"]): string {
  if (mode === "invites") return "Li";
  if (mode === "full") return "Lf";
  return "L";
}

function campaignModeWord(mode: ClientMetricsOverview["aimfoxCampaignMode"]): string {
  if (mode === "invites") return "Li — invitations only";
  if (mode === "full") return "Lf — full campaign (messages)";
  return "No active LinkedIn campaign measured";
}

const DOD_SCHED_BUCKETS = ["+2", "+1", "0"] as const;
const DOD_SENT_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const TD3_TOTAL_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const TD3_SQL_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const WOW_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;
const MOM_BUCKETS = ["0", "-1", "-2", "-3", "-4"] as const;

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return formatNumber(value);
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function calcMinSent(prospectsSignedRaw: number | null | undefined): number | null {
  if (prospectsSignedRaw == null) return null;
  return Math.ceil((prospectsSignedRaw * 3) / 20);
}

function bucketMap<T extends { bucket: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(r.bucket, r);
  return m;
}

function dodLookup(row: ClientMegaRow, bucket: string): DodRow | undefined {
  return bucketMap(row.metrics.dodRows).get(bucket);
}
function td3Lookup(row: ClientMegaRow, bucket: string): ThreeDodRow | undefined {
  return bucketMap(row.metrics.threeDodRows).get(bucket);
}
function wowLookup(row: ClientMegaRow, bucket: string): WowRow | undefined {
  return bucketMap(row.metrics.wowRows).get(bucket);
}
function momLookup(row: ClientMegaRow, bucket: string): MomRow | undefined {
  return bucketMap(row.metrics.momRows).get(bucket);
}

function buildColumns(): MegaColumn[] {
  const out: MegaColumn[] = [];

  // --- Ordinal # -----------------------------------------------------------
  out.push({
    id: "ordinal",
    group: "cs",
    sub: "Customer Success",
    label: "#",
    width: 30,
    minWidth: 26,
    align: "center",
    ordinal: true,
    render: () => "",
  });

  // --- Sticky (Customer Success) -----------------------------------------
  out.push({
    id: "name",
    group: "cs",
    sub: "Customer Success",
    label: "Client",
    width: 160,
    minWidth: 120,
    align: "left",
    sticky: true,
    defaultDirection: "asc",
    render: nameCellRender(),
    sortValue: (row) => row.client.name.toLowerCase(),
  });

  out.push({
    id: "manager",
    group: "cs",
    sub: "Customer Success",
    label: "Manager",
    width: 100,
    minWidth: 80,
    align: "left",
    sticky: false,
    defaultDirection: "asc",
    render: (row) => <span className="truncate text-xs text-muted-foreground">{row.managerName}</span>,
    sortValue: (row) => row.managerName.toLowerCase(),
  });

  // --- Basic --------------------------------------------------------------
  out.push({
    id: "status",
    group: "basic",
    sub: "Basic",
    label: "Status",
    width: 64,
    minWidth: 52,
    align: "center",
    defaultDirection: "asc",
    render: (row) => {
      const s = row.client.status ?? "—";
      return (
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusBadgeClass(s))}>
          {s}
        </span>
      );
    },
    sortValue: (row) => row.client.status ?? "",
  });
  out.push({
    id: "provisioning",
    group: "basic",
    sub: "Basic",
    // NOT "Setup": clients carry a user-defined custom field of that name, and two identically
    // labelled columns in one grid is a defect regardless of which one is ours.
    label: "Workspaces",
    width: 82,
    minWidth: 64,
    align: "center",
    defaultDirection: "asc",
    // Two letters, E(mail) then L(inkedIn) — the channels as the team names them, not the vendors.
    // The point of this column is the sweep: 56 clients at a glance is what would have surfaced
    // Audytel (no connector), Fortum and GIC (missing label) months before somebody went looking by
    // hand. The drawer carries the detail.
    //
    // The LinkedIn letter carries the service level as well as the connection: `Li` = invitations
    // only, `Lf` = a full campaign with a message sequence, plain `L` = we do not know yet (no
    // active campaign, or none measured). Colour still answers "is the connector wired", so the two
    // facts stay separable — a client can be green `L` (wired, nothing running).
    render: (row) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex gap-1">
            <ProvisioningMark letter="E" row={row.sequencerCreds.emailbison} />
            <ProvisioningMark
              letter={linkedinLetter(row.metrics.overview.aimfoxCampaignMode)}
              row={row.sequencerCreds.aimfox}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="text-xs">
            Email: {provisioningWord(row.sequencerCreds.emailbison)}
            <br />
            LinkedIn: {provisioningWord(row.sequencerCreds.aimfox)}
            <br />
            {campaignModeWord(row.metrics.overview.aimfoxCampaignMode)}
          </span>
        </TooltipContent>
      </Tooltip>
    ),
    // Sorts worst-first so a descending click surfaces the clients that need attention, which is
    // the only reason to sort this column at all.
    sortValue: (row) =>
      provisioningRank(row.sequencerCreds.emailbison) + provisioningRank(row.sequencerCreds.aimfox),
  });
  out.push({
    id: "ooo_routing",
    group: "basic",
    sub: "Basic",
    label: "OOO",
    width: 52,
    minWidth: 40,
    align: "center",
    defaultDirection: "asc",
    // The agency asked for two sweeps, and neither is served by opening 56 drawers: "are the three
    // OOO campaigns switched on before the first regular campaign runs?" and "which clients' OOO
    // campaigns stopped working this month?". Both are `live/routed` read down a column.
    //
    // Colour is three-way rather than the two ProvisioningMark settled on, because the middle state
    // here is the common one and is genuinely different: 2/3 means two of the client's out-of-office
    // categories still get followed up. Amber says "partly broken", not "unknown".
    render: (row) => {
      const health = row.oooHealth;
      const autoOoo = Boolean(row.client.auto_ooo_enabled);
      const rank = oooHealthRank(health, autoOoo);
      // Tone comes off the same rank the sort uses, so "how bad is this" has one definition rather
      // than a ternary chain that can disagree with the ordering. Three colours against six ranks is
      // deliberate — colour answers how bad, the tooltip answers what to do about it.
      const mark = (
        <span
          className={cn(
            "inline-flex h-4 min-w-8 items-center justify-center rounded border px-[3px] text-[9px] font-bold tabular-nums",
            OOO_RANK_TONES[rank],
          )}
        >
          {health ? `${health.live}/${health.routed}` : "—"}
        </span>
      );
      // A client with no rules has nothing a tooltip can add, and this table renders ~50 rows where
      // the ui <Tooltip> self-wraps a provider (see lead-crm-table.tsx) — skipping the empty case
      // drops two thirds of them.
      if (!health) return mark;
      return (
        <Tooltip>
          <TooltipTrigger asChild>{mark}</TooltipTrigger>
          <TooltipContent>
            <span className="text-xs">
              {oooHealthWord(health, autoOoo)}
              <br />
              {/* Only Active clients are synced hourly, so the stamp is not decoration: a client
                  still onboarding shows the statuses of whenever anyone last looked. */}
              Campaign statuses as of {describeChecked(health.campaigns_seen_at)?.text ?? "never"}
            </span>
          </TooltipContent>
        </Tooltip>
      );
    },
    sortValue: (row) => oooHealthRank(row.oooHealth, Boolean(row.client.auto_ooo_enabled)),
  });
  out.push({
    id: "inboxes",
    group: "basic",
    sub: "Basic",
    label: "Inboxes",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "inboxes",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.inboxes_count),
    sortValue: (row) => row.client.inboxes_count ?? null,
  });
  out.push({
    id: "prospects_signed",
    group: "basic",
    sub: "Basic",
    label: "Signed",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "prospects_signed",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.prospects_signed),
    sortValue: (row) => row.client.prospects_signed ?? null,
  });
  out.push({
    id: "prospects_added",
    group: "basic",
    sub: "Basic",
    label: "Added",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "prospects_added",
    defaultDirection: "desc",
    render: (row) => formatNum(row.metrics.overview.latestProspectsCount || row.client.prospects_added),
    sortValue: (row) => row.metrics.overview.latestProspectsCount || (row.client.prospects_added ?? null),
  });
  out.push({
    id: "min_sent",
    group: "basic",
    sub: "Basic",
    label: "Min sent",
    width: 48,
    minWidth: 38,
    align: "center",
    conditionKey: "min_sent",
    defaultDirection: "desc",
    render: (row) => formatNum(calcMinSent(row.client.prospects_signed)),
    sortValue: (row) => calcMinSent(row.client.prospects_signed),
  });
  out.push({
    id: "min_mailboxes",
    group: "basic",
    sub: "Basic",
    label: "Min MBX",
    width: 56,
    minWidth: 44,
    align: "center",
    defaultDirection: "desc",
    render: (row) => {
      const ms = calcMinSent(row.client.prospects_signed);
      return formatNum(ms === null ? null : Math.ceil(ms / 10));
    },
    sortValue: (row) => {
      const ms = calcMinSent(row.client.prospects_signed);
      return ms === null ? null : Math.ceil(ms / 10);
    },
  });
  out.push({
    id: "kpi_leads",
    group: "basic",
    sub: "Basic",
    label: "KPI L",
    width: 40,
    minWidth: 34,
    align: "center",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.kpi_leads),
    sortValue: (row) => row.client.kpi_leads ?? null,
  });
  out.push({
    id: "kpi_meetings",
    group: "basic",
    sub: "Basic",
    label: "KPI M",
    width: 40,
    minWidth: 34,
    align: "center",
    defaultDirection: "desc",
    render: (row) => formatNum(row.client.kpi_meetings),
    sortValue: (row) => row.client.kpi_meetings ?? null,
  });
  out.push({
    id: "notes",
    group: "basic",
    sub: "Basic",
    label: "Notes",
    width: 160,
    minWidth: 80,
    align: "left",
    defaultDirection: "asc",
    render: (row) => {
      const text = row.client.notes;
      if (!text) return <span className="text-neutral-600">—</span>;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-xs text-neutral-300 cursor-default">{text}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">{text}</TooltipContent>
        </Tooltip>
      );
    },
    sortValue: (row) => row.client.notes ?? "",
  });

  // --- DoD Schedule -------------------------------------------------------
  for (const b of DOD_SCHED_BUCKETS) {
    out.push({
      id: `dod-sched-${b}`,
      group: "dodSched",
      sub: "Schedule",
      projected: "aimfoxOnly",
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "schedule",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.schedule ?? null),
      sortValue: (row) => dodLookup(row, b)?.schedule ?? null,
    });
  }

  // --- DoD Schedule (Aimfox) ---------------------------------------------
  // LinkedIn invite schedule mirror of the Bison band, for side-by-side reading in the Both view.
  // Coloured by the `clients_dod_aimfox_schedule` rule, which gates itself on the client actually
  // having a LinkedIn connector — without that gate the summary's `toInt` would turn every
  // Aimfox-less client's missing schedule into a red 0. Missing Aimfox data → "—".
  for (const b of DOD_SCHED_BUCKETS) {
    out.push({
      id: `dod-sched-af-${b}`,
      group: "dodSchedAf",
      sub: "Schedule (Aimfox)",
      splitOnly: true,
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "aimfox_schedule",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.aimfoxSchedule ?? null),
      sortValue: (row) => dodLookup(row, b)?.aimfoxSchedule ?? null,
    });
  }

  // --- DoD Daily sent -----------------------------------------------------
  for (const b of DOD_SENT_BUCKETS) {
    out.push({
      id: `dod-sent-${b}`,
      group: "dodSent",
      sub: "Daily sent",
      projected: "aimfoxOnly",
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "sent",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.sent ?? null),
      sortValue: (row) => dodLookup(row, b)?.sent ?? null,
    });
  }

  // --- DoD Daily sent (Aimfox) -------------------------------------------
  // Coloured by `clients_dod_aimfox_sent` — same LinkedIn-connector gate as the schedule band.
  for (const b of DOD_SENT_BUCKETS) {
    out.push({
      id: `dod-sent-af-${b}`,
      group: "dodSentAf",
      sub: "Daily sent (Aimfox)",
      splitOnly: true,
      label: b,
      width: 38,
      minWidth: 32,
      align: "center",
      dodBucket: b,
      dodKind: "aimfox_sent",
      defaultDirection: "desc",
      render: (row) => formatNum(dodLookup(row, b)?.aimfoxSent ?? null),
      sortValue: (row) => dodLookup(row, b)?.aimfoxSent ?? null,
    });
  }

  // --- Aimfox capacity (sheet columns R / S) -----------------------------
  // Remaining database size and the weekly connect-cap snapshot ("~195 per account"), latest day,
  // summed across the client's LinkedIn profiles. null (unmeasured / no Aimfox) renders as "—".
  out.push({
    id: "af-remaining-db",
    group: "aimfoxCap",
    sub: "Aimfox capacity",
    channel: "aimfox",
    label: "Rem DB",
    width: 56,
    minWidth: 44,
    align: "center",
    defaultDirection: "desc",
    conditionKey: "aimfox_remaining_db",
    render: (row) => formatNum(row.metrics.overview.aimfoxActiveRemainingDb ?? null),
    sortValue: (row) => row.metrics.overview.aimfoxActiveRemainingDb ?? null,
  });
  out.push({
    // Replaced "Inv left" (invite_limit_remaining), which was the same number as the Schedule
    // (Aimfox) "0" cell — both are written from one variable in the ingestion workflow, so the
    // column carried no information the grid did not already show one band to the left.
    //
    // Acceptance across the client's ACTIVE campaigns, cumulative: Σ accepted / Σ sent from
    // `campaigns`. NOT the daily `invites_accepted` counter, which measures a day's events through
    // an interactions endpoint whose leading bucket is a known artefact and reads an order of
    // magnitude low (ColdUnicorn PL: 4 stored against 333 real).
    id: "af-accept-rate",
    group: "aimfoxCap",
    sub: "Aimfox capacity",
    channel: "aimfox",
    label: "Accept",
    // 60, not the 52 the old "Inv left" used: the header is uppercase with 0.12em tracking, and at
    // 52 the only word naming this metric renders as "ACC…".
    width: 60,
    minWidth: 44,
    align: "center",
    defaultDirection: "desc",
    conditionKey: "aimfox_accept_rate",
    render: (row) => formatRate(row.metrics.overview.aimfoxAcceptRate ?? null),
    sortValue: (row) => row.metrics.overview.aimfoxAcceptRate ?? null,
  });

  // --- 3-DoD (per channel: Total / EmailBison / Aimfox) -------------------
  // Each metric splits into three sub-bands. The Total band keeps its original column id and
  // condition keys (so persisted widths / master-admin overrides / condition rules stay bound) and
  // renders the projected channel outside the Both view; the EB and AF bands are Both-only,
  // display-only comparison columns with no condition tint.
  const td3Bands: Array<{
    metric: string;
    metricLabel: string;
    conditionKey: string;
    channels: Array<{ key: string; label: string; pick: (r: ThreeDodRow) => number | null | undefined }>;
  }> = [
    {
      metric: "total",
      metricLabel: "TOTAL",
      conditionKey: "three_dod_total",
      channels: [
        { key: "total", label: "leads", pick: (r) => r.totalLeads },
        { key: "eb", label: "EB", pick: (r) => r.totalLeadsEb },
        { key: "af", label: "AF", pick: (r) => r.totalLeadsAf },
      ],
    },
    {
      metric: "sql",
      metricLabel: "SQL",
      conditionKey: "three_dod_sql",
      channels: [
        { key: "total", label: "leads", pick: (r) => r.sqlLeads },
        { key: "eb", label: "EB", pick: (r) => r.sqlLeadsEb },
        { key: "af", label: "AF", pick: (r) => r.sqlLeadsAf },
      ],
    },
  ];
  for (const band of td3Bands) {
    for (const ch of band.channels) {
      const isTotal = ch.key === "total";
      const sub = isTotal ? `3-DoD ${band.metricLabel} leads` : `3-DoD ${band.metricLabel} · ${ch.label}`;
      for (const b of TD3_TOTAL_BUCKETS) {
        out.push({
          id: isTotal ? `td3-${band.metric}-${b}` : `td3-${band.metric}-${ch.key}-${b}`,
          group: "td3",
          sub,
          ...(isTotal ? { projected: "always" as const } : { splitOnly: true as const }),
          label: b,
          width: 32,
          minWidth: 28,
          align: "center",
          ...(isTotal ? { td3Bucket: b, td3MetricKey: band.conditionKey } : {}),
          defaultDirection: "desc",
          render: (row) => formatNum(ch.pick(td3Lookup(row, b) as ThreeDodRow) ?? null),
          sortValue: (row) => ch.pick(td3Lookup(row, b) as ThreeDodRow) ?? null,
        });
      }
    }
  }

  // --- WoW (lead counts per channel, rates, plus Aimfox acceptance) ------
  // Total & SQL keep their original id + condition key and render the projected channel outside the
  // Both view; the "· EB" / "· AF" columns are Both-only comparisons. The email reply rates and the
  // Aimfox acceptance rate are channel-native — neither channel has the other's, so each is tagged
  // and simply disappears in the other view. "Accept" is accepted/sent, "—" when unmeasured.
  const wowMetrics: Array<{
    key: string;
    label: string;
    conditionKey?: string;
    channel?: "email" | "aimfox";
    splitOnly?: true;
    projected?: "always";
    format: "rate" | "num";
    pick: (row: WowRow) => number | null | undefined;
  }> = [
    { key: "total",    label: "Total",      conditionKey: "wow_total_leads", projected: "always", format: "num",  pick: (r) => r.totalLeads },
    { key: "total-eb", label: "Total · EB", splitOnly: true, format: "num",  pick: (r) => r.totalLeadsEb },
    { key: "total-af", label: "Total · AF", splitOnly: true, format: "num",  pick: (r) => r.totalLeadsAf },
    { key: "sql",      label: "SQL",        conditionKey: "wow_sql",         projected: "always", format: "num",  pick: (r) => r.sqlLeads },
    { key: "sql-eb",   label: "SQL · EB",   splitOnly: true, format: "num",  pick: (r) => r.sqlLeadsEb },
    { key: "sql-af",   label: "SQL · AF",   splitOnly: true, format: "num",  pick: (r) => r.sqlLeadsAf },
    { key: "resp",     label: "Resp",       conditionKey: "wow_total_response_rate", channel: "email",  format: "rate", pick: (r) => r.responseRate },
    { key: "human",    label: "Human",      conditionKey: "wow_human_response_rate", channel: "email",  format: "rate", pick: (r) => r.humanRate },
    { key: "bnc",      label: "Bnc",        conditionKey: "wow_bounce_rate",         channel: "email",  format: "rate", pick: (r) => r.bounceRate },
    { key: "ooo",      label: "OOO",        conditionKey: "wow_ooo_rate",            channel: "email",  format: "rate", pick: (r) => r.oooRate },
    // No "Accept" band here any more. It divided two per-day counters from sequencer_daily_stats,
    // and the numerator (invites_accepted) is measured wrongly at source — the rate is now a single
    // cumulative column in the Aimfox capacity band, computed from campaigns.
  ];

  for (const m of wowMetrics) {
    for (const b of WOW_BUCKETS) {
      out.push({
        id: `wow-${m.key}-${b}`,
        group: "wow",
        sub: `WoW ${m.label}`,
        channel: m.channel,
        splitOnly: m.splitOnly,
        projected: m.projected,
        label: b,
        width: m.format === "rate" ? 40 : 32,
        minWidth: 28,
        align: "center",
        ...(m.conditionKey ? { wowBucket: b, wowMetricKey: m.conditionKey } : {}),
        defaultDirection: "desc",
        render: (row) => {
          const v = m.pick(wowLookup(row, b) as WowRow);
          return m.format === "rate" ? formatRate(v ?? null) : formatNum(v ?? null);
        },
        sortValue: (row) => m.pick(wowLookup(row, b) as WowRow) ?? null,
      });
    }
  }

  // --- MoM ----------------------------------------------------------------
  // Every MoM metric is split server-side, so all four bands render the projected channel outside
  // the Both view. Side-by-side "· EB" / "· AF" comparison columns exist for Total and SQL, the two
  // the team reads that way; Mtg / Won get the projection but no extra Both columns (the grid is
  // already ~130 wide — add them the day someone asks). Existing ids + condition keys preserved.
  const momMetrics: Array<{
    key: string;
    label: string;
    conditionKey?: string;
    splitOnly?: true;
    projected?: "always";
    pick: (row: MomRow) => number | null | undefined;
  }> = [
    { key: "total",    label: "Total",      conditionKey: "mom_total_leads", projected: "always", pick: (r) => r.totalLeads },
    { key: "total-eb", label: "Total · EB", splitOnly: true, pick: (r) => r.totalLeadsEb },
    { key: "total-af", label: "Total · AF", splitOnly: true, pick: (r) => r.totalLeadsAf },
    { key: "sql",      label: "SQL",        conditionKey: "mom_sql",         projected: "always", pick: (r) => r.sqlLeads },
    { key: "sql-eb",   label: "SQL · EB",   splitOnly: true, pick: (r) => r.sqlLeadsEb },
    { key: "sql-af",   label: "SQL · AF",   splitOnly: true, pick: (r) => r.sqlLeadsAf },
    { key: "mtg",      label: "Mtg",        conditionKey: "mom_meetings",    projected: "always", pick: (r) => r.meetings },
    { key: "won",      label: "Won",        conditionKey: "mom_won",         projected: "always", pick: (r) => r.won },
  ];
  for (const m of momMetrics) {
    for (const b of MOM_BUCKETS) {
      out.push({
        id: `mom-${m.key}-${b}`,
        group: "mom",
        sub: `MoM ${m.label}`,
        splitOnly: m.splitOnly,
        projected: m.projected,
        label: b,
        width: 32,
        minWidth: 28,
        align: "center",
        ...(m.conditionKey ? { momBucket: b, momMetricKey: m.conditionKey } : {}),
        defaultDirection: "desc",
        render: (row) => formatNum(m.pick(momLookup(row, b) as MomRow) ?? null),
        sortValue: (row) => m.pick(momLookup(row, b) as MomRow) ?? null,
      });
    }
  }

  return out;
}

export const MEGA_COLUMNS = buildColumns();
export const MEGA_COLUMN_COUNT = MEGA_COLUMNS.length;
/** Distinct built-in section (sub-band) names, in display order. Used by the
 * master-admin customization panel to offer per-section name overrides. */
export const MEGA_SECTIONS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const col of MEGA_COLUMNS) {
    if (!seen.has(col.sub)) {
      seen.add(col.sub);
      out.push(col.sub);
    }
  }
  return out;
})();

/**
 * Does a built-in column survive this channel view? Used by the page to drop a sort that is bound
 * to a column the switch hides — `compareMega` finds no match for it and silently sorts by nothing.
 * Unknown ids (custom fields, `cf:<uuid>`) are never channel-tagged, so they always survive.
 */
export function isColumnInChannelView(columnId: string, channelView: ChannelView): boolean {
  if (channelView === "both") return true;
  const col = MEGA_COLUMNS.find((c) => c.id === columnId);
  return col ? columnInChannelView(col, channelView) : true;
}

/** Section (sub) → group lookup. Each built-in section maps to exactly one
 * group; the synthetic "Custom" section maps to the custom group. Used when a
 * column is reassigned to another section so its group band stays consistent. */
const SECTION_TO_GROUP = new Map<string, Group>(MEGA_COLUMNS.map((c) => [c.sub, c.group]));
SECTION_TO_GROUP.set("Custom", "custom");

/** Re-home a column into another section when a `colsection:<id>` override is
 * set. Keeps `group` in sync so the thick group separators match the new band. */
function applySectionAssignment(col: MegaColumn, overrideMap: Map<string, ColumnOverrideRecord>): MegaColumn {
  const assigned = overrideMap.get(`colsection:${col.id}`)?.label_override;
  if (!assigned || assigned === col.sub) return col;
  return { ...col, sub: assigned, group: SECTION_TO_GROUP.get(assigned) ?? col.group };
}
const STICKY_INDICES = MEGA_COLUMNS.map((c, i) => (c.sticky ? i : -1)).filter((i) => i >= 0);

function computeStickyOffsets(widths: number[]): Map<number, number> {
  const m = new Map<number, number>();
  let cum = 0;
  for (const i of STICKY_INDICES) {
    m.set(i, cum);
    cum += widths[i] ?? 0;
  }
  return m;
}

/** Bands that are just record-keeping — everything else states which channel it is showing. */
const CHANNEL_AGNOSTIC_GROUPS = new Set<Group>(["cs", "basic", "custom"]);
const CHANNEL_SUFFIX: Record<Exclude<ChannelView, "both">, string> = { email: " · EB", aimfox: " · AF" };
/**
 * A trailing channel qualifier a master admin typed into a section name ("Schedule (email)",
 * "Linkedin capacity"). In a single-channel view the band is projected, so a stored "(email)" over
 * Aimfox numbers is not just redundant — it is wrong. Drop it and let the suffix say the channel.
 */
const STORED_CHANNEL_QUALIFIER = /\s*\((?:e-?mail(?:bison)?|bison|linked-?in|aimfox)\)\s*$/i;

/** Does this column survive the channel switch? The single definition of the rule. */
function columnInChannelView(col: MegaColumn, channelView: ChannelView): boolean {
  if (channelView === "both") return true;
  if (col.splitOnly) return false;
  return !col.channel || col.channel === channelView;
}

/**
 * Does the projection rewrite this cell's value in this view?
 * `projected` is declared on the column itself, so a newly split metric cannot be forgotten here.
 */
function isProjectedCell(col: MegaColumn, channelView: ChannelView): boolean {
  if (channelView === "both") return false;
  return col.projected === "always" || (col.projected === "aimfoxOnly" && channelView === "aimfox");
}

/** The Aimfox twin of an email DoD band, for the LinkedIn view's projected cells. */
const AIMFOX_DOD_KIND: Partial<Record<DodCellKind, DodCellKind>> = {
  schedule: "aimfox_schedule",
  sent: "aimfox_sent",
};

/**
 * Point a projected cell's condition binding at the rules that judge the number it now shows.
 *
 * The 3-DoD / WoW / MoM bands need nothing here: `clients-page.tsx` evaluates those three bands on
 * the projected rows (`withChannelLeadBands`), so `td3:{bucket}:{metric}` and friends already hold
 * the selected channel's verdict. The bucket bindings therefore survive the channel switch — until
 * 2026-08-21 they were stripped instead, which is why the 3-DoD columns lost every colour outside
 * the Both view.
 *
 * The DoD band is the one that must be re-pointed: the LinkedIn view swaps in Aimfox schedule/sent,
 * and those have rules of their own on their own surfaces (`clients_dod_aimfox_*`) rather than the
 * `min_sent` contract the Bison band is judged by. Re-pointing makes the LinkedIn view colour the
 * same cells the Both view's "(Aimfox)" mirror does.
 *
 * The plain `conditionKey` path (Basic columns, custom fields) is untouched — those values never move.
 */
function retargetProjectedConditionKeys(col: MegaColumn, channelView: ChannelView): MegaColumn {
  if (!isProjectedCell(col, channelView)) return col;
  const aimfoxKind = col.dodKind ? AIMFOX_DOD_KIND[col.dodKind] : undefined;
  if (aimfoxKind && channelView === "aimfox") return { ...col, dodKind: aimfoxKind };
  return col;
}

function cellCondition(row: ClientMegaRow, col: MegaColumn): ConditionEvaluationResult | undefined {
  if (!row.conditionPack) return undefined;
  if (col.dodBucket && col.dodKind) {
    const key = dodCellKey(col.dodBucket, col.dodKind);
    return getCellCondition(row.conditionPack.dodCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.td3Bucket && col.td3MetricKey) {
    const key = threeDodCellKey(col.td3Bucket, col.td3MetricKey);
    return getCellCondition(row.conditionPack.threeDodCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.wowBucket && col.wowMetricKey) {
    const key = wowCellKey(col.wowBucket, col.wowMetricKey);
    return getCellCondition(row.conditionPack.wowCellResults[key] ?? [], key) ?? undefined;
  }
  if (col.momBucket && col.momMetricKey) {
    const key = momCellKey(col.momBucket, col.momMetricKey);
    return getCellCondition(row.conditionPack.momCellResults[key] ?? [], key) ?? undefined;
  }
  if (!col.conditionKey) return undefined;
  return (
    getCellCondition(row.conditionPack.allResults, col.conditionKey) ??
    getCellCondition(row.conditionPack.overviewResults, col.conditionKey)
  );
}

function severityLabel(severity: ConditionSeverity): string {
  if (severity === "critical_over") return "Critical";
  if (severity === "danger") return "Danger";
  if (severity === "warning") return "Warning";
  if (severity === "info") return "Info";
  return "Good";
}

function conditionCellWrapperClass(severity: ConditionSeverity): string {
  if (severity === "critical_over") return "cond-cell cond-cell-critical";
  if (severity === "danger") return "cond-cell cond-cell-danger";
  if (severity === "warning") return "cond-cell cond-cell-warning";
  if (severity === "good") return "cond-cell cond-cell-good";
  return "rounded";
}

function renderCellWithCondition(
  content: ReactNode,
  condition: ConditionEvaluationResult | undefined,
  isCellSelected: boolean,
): ReactNode {
  if (!condition) return <span className="text-white">{content}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* ring-inset on the inner div because .cond-cell fills 100%+margin,
            completely covering any ring placed on the outer cell div */}
        <div className={cn(
          conditionCellWrapperClass(condition.severity),
          isCellSelected && "ring-2 ring-inset ring-sky-400/90",
        )}>{content}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 bg-[#111] text-xs text-white" sideOffset={8}>
        <p>
          <span className="text-neutral-400">Rule:</span> {condition.ruleName}
        </p>
        <p>
          <span className="text-neutral-400">Value:</span> {String(condition.value ?? "-")}
        </p>
        {condition.threshold !== undefined && (
          <p>
            <span className="text-neutral-400">Threshold:</span> {String(condition.threshold)}
          </p>
        )}
        <p>
          <span className="text-neutral-400">Message:</span> {condition.message}
        </p>
        <p>
          <span className="text-neutral-400">{severityLabel(condition.severity)}</span>
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export interface ClientsMegaTableProps {
  rows: ClientMegaRow[];
  sort: MegaSortState;
  onSortChange: (next: MegaSortState) => void;
  onRowClick: (clientId: string) => void;
  onHighlight: (clientId: string, colId: string) => void;
  selectionStore: SelectionStore;
  /** Parent ref that receives the ordered visible column id array after each render. */
  colsRef?: MutableRefObject<string[]>;
  storageKey?: string;
  /**
   * Column widths from the caller's per-user preferences (`user_table_preferences`). When
   * supplied, the table renders these instead of its own localStorage copy and reports a
   * resize back through `onWidthsChange` — see `useTablePreferences`.
   */
  savedWidths?: Record<string, number> | null;
  onWidthsChange?: (widthsById: Record<string, number>) => void;
  /** Master-admin label/visibility overrides keyed by column id. */
  columnOverrides?: ColumnOverrideRecord[];
  /** Master-admin custom columns (text / checkbox / droplist). */
  customFields?: ClientCustomFieldRecord[];
  /** Map<clientId, Map<fieldId, value>>. */
  customFieldValuesByClient?: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
  /** Returns true when the current user may edit the given field's values. */
  canEditCustomField?: (fieldId: string) => boolean;
  /** Called when a custom-field cell value changes. */
  onCustomFieldValueChange?: (clientId: string, fieldId: string, value: string | null) => void;
  /** Called when the inline Notes cell is edited (blur-to-save). Read-only when omitted. */
  onNotesChange?: (clientId: string, value: string | null) => void;
  /** True when the Status cell may be edited inline. Falls back to a read-only badge otherwise. */
  canEditStatus?: boolean;
  /** Called when the inline Status cell is changed. */
  onStatusChange?: (clientId: string, status: ClientStatus) => void;
  /** Called when the satisfaction hearts in the Client cell are clicked. Read-only when omitted. */
  onSatisfactionChange?: (clientId: string, next: SatisfactionLevel | null) => void;
  /**
   * Channel view switch. "both" (default) shows every column; "email"/"aimfox" hide the columns
   * tagged for the other channel. Identity and blended-Total columns (channel undefined) always show.
   */
  channelView?: ChannelView;
}

function parseSafeHref(raw: string | null | undefined): string | null {
  const href = raw?.trim();
  if (!href) return null;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function LinkCell({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave?: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const safe = parseSafeHref(value);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(value ?? "");
    setOpen(true);
  }

  function handleSave() {
    const next = draft.trim() || null;
    if (next !== (value ?? null)) onSave?.(next);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <span className="group/link inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {safe ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center text-sky-400 hover:text-sky-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs break-all text-xs">
            {value}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-neutral-600">—</span>
      )}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={handleOpen}
              className="inline-flex items-center text-neutral-500 hover:text-neutral-300 transition-colors"
              tabIndex={-1}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-80 p-3">
            <p className="mb-2 text-xs font-medium text-neutral-300">Edit link</p>
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://…"
              className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-sky-500/50"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="rounded bg-sky-600/20 px-3 py-1 text-xs text-sky-300 hover:bg-sky-600/30"
              >
                Save
              </button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

// Client cell: name over the manual satisfaction rating + lifecycle status. The hearts are the
// Customer Success signal here — the condition engine still tints the metric cells to the right,
// but it no longer summarises the row. Editable only when a change handler is supplied.
function nameCellRender(onSatisfactionChange?: (clientId: string, next: SatisfactionLevel | null) => void) {
  return (row: ClientMegaRow) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="flex min-w-0 items-center text-sm text-foreground">
        <span className="truncate">{row.client.name}</span>
        {/* Only reachable with "Show archived" on — without the marker an archived row is
            indistinguishable from a live one (migration 20260813). */}
        <ArchivedBadge archivedAt={row.client.archived_at} />
      </span>
      <div className="flex items-center gap-1.5 min-w-0">
        <SatisfactionHearts
          size="sm"
          value={row.client.satisfaction}
          onChange={onSatisfactionChange ? (next) => onSatisfactionChange(row.client.id, next) : undefined}
        />
        <span className="truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
          {row.client.status}
        </span>
      </div>
    </div>
  );
}

// Shared by the read-only badge, the inline editable Status cell, and the page's status filter
// chips so all three stay in sync. Unknown values get a neutral fallback rather than no class.
export function statusBadgeClass(s: string): string {
  return s === "Onboarding"   ? "status-badge-onboarding" :
         s === "Active"       ? "status-badge-active" :
         s === "On hold"      ? "status-badge-onhold" :
         s === "Offboarding"  ? "status-badge-offboard" :
         s === "Inactive"     ? "status-badge-inactive" :
         s === "Subscription" ? "status-badge-subscription" :
         "border-border bg-white/5 text-white";
}

// Inline Status editor: a native <select> wearing the same badge colours as the read-only cell.
// Mirrors the droplist custom-field cell (stopPropagation so picking a value doesn't open the row).
function statusCellRender(onChange: (clientId: string, status: ClientStatus) => void) {
  return (row: ClientMegaRow) => {
    const s = row.client.status;
    return (
      <select
        value={s ?? ""}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = event.target.value as ClientStatus;
          if (next && next !== s) onChange(row.client.id, next);
        }}
        className={cn(
          "w-full cursor-pointer rounded border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide outline-none",
          statusBadgeClass(s ?? "—"),
        )}
      >
        {CLIENT_STATUSES.map((opt) => (
          <option key={opt} value={opt} className="bg-[#0d0d0d] text-neutral-200">
            {opt}
          </option>
        ))}
      </select>
    );
  };
}

function notesCellRender(onChange: (clientId: string, value: string | null) => void) {
  return (row: ClientMegaRow) => {
    const text = row.client.notes;
    return (
      <input
        type="text"
        defaultValue={text ?? ""}
        title={text ?? undefined}
        onClick={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next === (text ?? "")) return;
          onChange(row.client.id, next || null);
        }}
        className="w-full bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
        placeholder="—"
      />
    );
  };
}

function customFieldColumn(
  field: ClientCustomFieldRecord,
  valuesByClient: ReadonlyMap<string, ReadonlyMap<string, string | null>>,
  canEdit: boolean,
  onChange?: (clientId: string, fieldId: string, value: string | null) => void,
): MegaColumn {
  const lookup = (row: ClientMegaRow): string | null =>
    valuesByClient.get(row.client.id)?.get(field.id) ?? null;
  const isNumeric = field.field_type === "number" || field.field_type === "currency";
  return {
    id: `cf:${field.id}`,
    group: "custom",
    sub: "Custom",
    label: field.name,
    width: field.field_type === "checkbox" ? 90 : field.field_type === "droplist" ? 120 : 140,
    minWidth: field.field_type === "checkbox" ? 50 : 60,
    align: isNumeric ? "right" : "left",
    // Lets condition rules with `column_key: "cf:<id>"` and surface
    // `clients_overview` colour this cell via cellCondition().
    conditionKey: `cf:${field.id}`,
    render: (row) => {
      const value = lookup(row);
      if (field.field_type === "checkbox") {
        const checked = value === "true";
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={!canEdit}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              onChange?.(row.client.id, field.id, event.target.checked ? "true" : "false");
            }}
            className="h-3.5 w-3.5 cursor-pointer accent-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
        );
      }
      if (field.field_type === "droplist") {
        const options = field.options ?? [];
        if (!canEdit) {
          return <span className="truncate text-xs text-current">{value ?? "—"}</span>;
        }
        return (
          // text-current, not a fixed neutral: a <select> does not inherit the colour of
          // its container, so on a coloured condition cell (.cond-cell-good is black-on-
          // bright-green in the contrast palette) a hard-coded light grey is unreadable.
          <select
            value={value ?? ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onChange?.(row.client.id, field.id, event.target.value || null)}
            className="w-full bg-transparent text-xs text-current outline-none"
          >
            {/* The options render in the native popup, not on the coloured cell, so they
                need their own dark-panel colours — inheriting text-current would paint
                them black on the dark popup. */}
            <option value="" className="bg-[#0d0d0d] text-neutral-200">—</option>
            {options.map((opt) => (
              <option key={opt} value={opt} className="bg-[#0d0d0d] text-neutral-200">{opt}</option>
            ))}
          </select>
        );
      }
      if (field.field_type === "link") {
        return (
          <LinkCell
            value={value}
            canEdit={canEdit}
            onSave={(next) => onChange?.(row.client.id, field.id, next)}
          />
        );
      }
      if (!canEdit) {
        return (
          <span className={cn("truncate text-xs text-current", isNumeric && "block text-right")}>
            {value ?? "—"}
          </span>
        );
      }
      return (
        <input
          type="text"
          inputMode={isNumeric ? "decimal" : undefined}
          defaultValue={value ?? ""}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            const next = event.target.value;
            if (next === (value ?? "")) return;
            onChange?.(row.client.id, field.id, next || null);
          }}
          className={cn(
            "w-full bg-transparent text-xs text-current outline-none placeholder:text-neutral-500",
            isNumeric && "text-right",
          )}
          placeholder={field.field_type === "currency" ? "e.g. 8000 zł" : "—"}
        />
      );
    },
    sortValue: (row) => getCustomFieldSortValue(field, lookup(row)),
  };
}

interface MegaRowProps {
  row: ClientMegaRow;
  rIdx: number;
  cols: MegaColumn[];
  widths: number[];
  stickyOffsets: Map<number, number>;
  colBorderClasses: string[];
  onRowClick: (clientId: string) => void;
  onHighlight: (clientId: string, colId: string) => void;
  selectionStore: SelectionStore;
}

const MegaRow = memo(function MegaRow({
  row,
  rIdx,
  cols,
  widths,
  stickyOffsets,
  colBorderClasses,
  onRowClick,
  onHighlight,
  selectionStore,
}: MegaRowProps) {
  const isSelected = useSyncExternalStore(
    selectionStore.subscribe,
    () => selectionStore.get().clientId === row.client.id,
    () => false,
  );
  // Returns colId only for the selected row; null for all others → snapshot is
  // primitive-stable so non-selected rows never re-render on column changes.
  const selectedColId = useSyncExternalStore(
    selectionStore.subscribe,
    () => (selectionStore.get().clientId === row.client.id ? selectionStore.get().colId : null),
    () => null,
  );
  const rowTint = rIdx % 2 ? "bg-black/20" : "bg-transparent";

  return (
    <div
      aria-label={`Row for ${row.client.name}`}
      className={cn(
        "flex h-10 w-full",
        rowTint,
        isSelected ? "outline outline-1 outline-sky-400/60" : "hover:bg-white/5",
      )}
    >
      {cols.map((col, i) => {
        const w = widths[i] ?? col.width;
        const style: CSSProperties = { width: w, minWidth: w };
        if (col.sticky) {
          style.position = "sticky";
          style.left = stickyOffsets.get(i) ?? 0;
          style.zIndex = 5;
          style.background = isSelected
            ? rIdx % 2 ? "#0d1518" : "#0a1216"
            : rIdx % 2
            ? "#0a0a0a"
            : "#070707";
        }

        const condition = cellCondition(row, col);
        const content = col.ordinal ? String(rIdx + 1) : col.render(row);
        const opensDrawer = col.id === "name";
        const isCellSelected = selectedColId !== null && col.id === selectedColId;

        return (
          <div
            key={col.id}
            style={style}
            role={opensDrawer ? "button" : undefined}
            aria-label={opensDrawer ? `Open details for ${row.client.name}` : undefined}
            onClick={() => opensDrawer ? onRowClick(row.client.id) : onHighlight(row.client.id, col.id)}
            className={cn(
              "flex cursor-pointer items-center px-1.5 text-xs",
              colBorderClasses[i],
              col.align === "left"
                ? "justify-start"
                : col.align === "right"
                ? "justify-end"
                : "justify-center",
              col.sticky ? "shadow-[inset_-2px_0_0_rgba(255,255,255,0.07)]" : "",
              isCellSelected ? "bg-sky-500/15 ring-2 ring-inset ring-sky-400/90" : "",
            )}
          >
            {col.sticky || col.ordinal ? content : renderCellWithCondition(content, condition, isCellSelected)}
          </div>
        );
      })}
    </div>
  );
});

function ClientsMegaTableImpl(props: ClientsMegaTableProps) {
  const {
    rows,
    sort,
    onSortChange,
    onRowClick,
    onHighlight,
    selectionStore,
    storageKey = "table:clients:mega-columns",
    savedWidths,
    onWidthsChange,
    columnOverrides,
    customFields,
    customFieldValuesByClient,
    canEditCustomField,
    onCustomFieldValueChange,
    onNotesChange,
    canEditStatus,
    onStatusChange,
    onSatisfactionChange,
    colsRef,
    channelView = "both",
  } = props;
  useWhyDidYouRender("ClientsMegaTable", props as Record<string, unknown>);
  useDevRenderCount("ClientsMegaTable", () => `rows=${rows.length}`);
  const cols = useMemo(() => {
    const overrideMap = new Map<string, ColumnOverrideRecord>();
    for (const override of columnOverrides ?? []) overrideMap.set(override.column_key, override);

    const emptyValues = new Map<string, ReadonlyMap<string, string | null>>();
    const valueMap = customFieldValuesByClient ?? emptyValues;

    // Built-in entries: apply label override + section reassignment + hidden filter.
    const builtInEntries = MEGA_COLUMNS.flatMap((col, defaultIdx) => {
      const override = overrideMap.get(col.id);
      if (override?.hidden) return [];
      // Channel view switch. Outside "both": the "· EB" / "· AF" splits and the "(Aimfox)" mirrors
      // are duplicates of the neutral band (which now carries this channel's numbers), and a
      // channel-native column has no meaning in the other channel's view. Everything else —
      // identity, Basic, custom fields and the projected metric bands — always stays.
      if (!columnInChannelView(col, channelView)) return [];
      const withNotes = col.id === "notes" && onNotesChange ? { ...col, render: notesCellRender(onNotesChange) } : col;
      const withHearts =
        withNotes.id === "name" && onSatisfactionChange
          ? { ...withNotes, render: nameCellRender(onSatisfactionChange) }
          : withNotes;
      const editable =
        withHearts.id === "status" && canEditStatus && onStatusChange
          ? { ...withHearts, render: statusCellRender(onStatusChange) }
          : withHearts;
      const labelled = override?.label_override ? { ...editable, label: override.label_override } : editable;
      const retargeted = retargetProjectedConditionKeys(labelled, channelView);
      const homed = applySectionAssignment(retargeted, overrideMap);
      return [{ col: homed as MegaColumn, position: override?.position ?? null, naturalOrder: defaultIdx }];
    });

    // Custom field entries: position from column_overrides (key "cf:{id}") when set,
    // otherwise fall after all built-ins using field.position as tie-breaker.
    const sortedCustom = (customFields ?? []).slice().sort((l, r) => l.position - r.position);
    const customEntries = sortedCustom.map((field, i) => {
      const cfOverride = overrideMap.get(`cf:${field.id}`);
      const col = customFieldColumn(field, valueMap, Boolean(canEditCustomField?.(field.id)), onCustomFieldValueChange);
      return {
        col: applySectionAssignment(col, overrideMap),
        position: cfOverride?.position ?? null,
        naturalOrder: MEGA_COLUMNS.length + i,
      };
    });

    // Ordering. Explicit column_overrides positions still drive the layout, but a column WITHOUT an
    // explicit position must NOT sink to the end of the table — otherwise every column added after
    // the saved layout (the Aimfox / per-channel columns, a fresh custom field) piles up at the far
    // right. Instead each such column inherits the position of its nearest natural-order predecessor
    // that DOES have one, so it slots right after the sibling it was declared beside in MEGA_COLUMNS:
    // Aimfox Schedule after Bison Schedule, a "· EB"/"· AF" split after its blended Total, etc. This
    // also makes the channel switch place the Aimfox band exactly where the (now-hidden) Bison band
    // sat. Ties break by natural order. Sentinel -1 sorts leading position-less columns to the front.
    const naturalEntries = [...builtInEntries, ...customEntries].sort((a, b) => a.naturalOrder - b.naturalOrder);
    let lastExplicit = -1;
    const withEffPos = naturalEntries.map((e) => {
      if (e.position !== null) lastExplicit = e.position;
      return { ...e, effPos: e.position !== null ? e.position : lastExplicit };
    });
    const ordered = withEffPos
      .sort((a, b) => a.effPos - b.effPos || a.naturalOrder - b.naturalOrder)
      .map((e) => e.col);

    // Apply section (sub-band) name overrides. Stored under the synthetic key
    // `section:<original sub>`; every column sharing that sub maps to the same
    // new name, so the band stays contiguous in the boundary/segment logic.
    // Then, outside the Both view, say which channel the band is showing — the neutral names
    // ("MoM Total", "Daily sent") would otherwise read as "everything" while holding one channel.
    return ordered.map((col) => {
      const sectionLabel = overrideMap.get(`section:${col.sub}`)?.label_override;
      const named = sectionLabel ?? col.sub;
      const sub =
        channelView !== "both" && !CHANNEL_AGNOSTIC_GROUPS.has(col.group)
          ? `${named.replace(STORED_CHANNEL_QUALIFIER, "")}${CHANNEL_SUFFIX[channelView]}`
          : named;
      return sub === col.sub ? col : { ...col, sub };
    });
  }, [columnOverrides, customFields, customFieldValuesByClient, canEditCustomField, onCustomFieldValueChange, onNotesChange, canEditStatus, onStatusChange, onSatisfactionChange, channelView]);

  const defaultWidths = useMemo(() => cols.map((c) => c.width), [cols]);
  const minWidths = useMemo(() => cols.map((c) => c.minWidth), [cols]);

  // Recompute sticky indices based on the derived `cols` (hidden columns may
  // have removed some entries between MEGA_COLUMNS and `cols`).
  const stickyIndicesDerived = useMemo(
    () => cols.map((c, i) => (c.sticky ? i : -1)).filter((i) => i >= 0),
    [cols],
  );

  // Widths persist per column id, not per position: this table's column set is dynamic
  // (custom fields, hidden columns, master-admin reordering), and a positional array
  // would hand a saved width to whichever column happens to sit at that index.
  const columnIds = useMemo(() => cols.map((c) => c.id), [cols]);

  const resizable = useResizableColumns({
    storageKey,
    defaultWidths,
    minWidths,
    columnIds,
    savedWidths,
    onWidthsCommit: onWidthsChange,
  });

  const widths = useMemo(() => {
    // useResizableColumns returns a template string; parse it back to numbers.
    return resizable.template
      .split(" ")
      .map((seg) => Number.parseInt(seg.replace("px", ""), 10) || 0);
  }, [resizable.template]);

  const stickyOffsets = useMemo(() => {
    const m = new Map<number, number>();
    let cum = 0;
    for (const i of stickyIndicesDerived) {
      m.set(i, cum);
      cum += widths[i] ?? 0;
    }
    return m;
  }, [stickyIndicesDerived, widths]);
  const totalWidth = useMemo(() => widths.reduce((a, b) => a + b, 0), [widths]);

  // Indices of the last column within each group band — gets a thick separator border.
  const groupBoundarySet = useMemo(() => {
    const s = new Set<number>();
    cols.forEach((col, i) => {
      if (i === cols.length - 1 || cols[i + 1].group !== col.group) s.add(i);
    });
    return s;
  }, [cols]);

  // Indices of the last column within each sub-band — gets a medium separator border.
  const subBoundarySet = useMemo(() => {
    const s = new Set<number>();
    cols.forEach((col, i) => {
      if (i === cols.length - 1 || cols[i + 1].sub !== col.sub) s.add(i);
    });
    return s;
  }, [cols]);

  const subSegments = useMemo(() => {
    const segs: Array<{ sub: string; group: Group; from: number; lastIdx: number; width: number }> = [];
    let cur: { sub: string; group: Group; from: number; lastIdx: number; width: number } | null = null;
    cols.forEach((col, idx) => {
      const w = widths[idx] ?? col.width;
      if (!cur || cur.sub !== col.sub) {
        if (cur) segs.push(cur);
        cur = { sub: col.sub, group: col.group, from: idx, lastIdx: idx, width: w };
      } else {
        cur.width += w;
        cur.lastIdx = idx;
      }
    });
    if (cur) segs.push(cur);
    return segs;
  }, [cols, widths]);

  function colBorderClass(i: number) {
    if (groupBoundarySet.has(i)) return "border-r-2 border-r-white/70";
    if (subBoundarySet.has(i)) return "border-r-2 border-r-white/35";
    return "border-r border-white/10";
  }

  // Precompute per-column border class once so MegaRow gets a referentially
  // stable string[] prop and its memo bails out across renders.
  const colBorderClasses = useMemo(
    () => cols.map((_, i) => colBorderClass(i)),
    // colBorderClass depends on the boundary sets, which depend on cols.
    // cols is module-level; boundary sets are useMemo'd with [cols] deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cols, groupBoundarySet, subBoundarySet],
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Keep the parent's colsRef up-to-date so the keyboard handler knows visible col order.
  useEffect(() => {
    if (colsRef) colsRef.current = cols.map((c) => c.id);
  }, [cols, colsRef]);

  // Scroll the table horizontally so the keyboard-selected cell stays visible.
  useEffect(() => {
    const unsubscribe = selectionStore.subscribe(() => {
      const state = selectionStore.get();
      if (!state.colId || !scrollContainerRef.current) return;
      const colIdx = cols.findIndex((c) => c.id === state.colId);
      if (colIdx === -1) return;
      let left = 0;
      for (let i = 0; i < colIdx; i++) left += widths[i] ?? 0;
      const w = widths[colIdx] ?? 0;
      const container = scrollContainerRef.current;
      const scrollLeft = container.scrollLeft;
      const visible = container.clientWidth;
      if (left < scrollLeft) {
        container.scrollLeft = left;
      } else if (left + w > scrollLeft + visible) {
        container.scrollLeft = left + w - visible;
      }
    });
    return unsubscribe;
  }, [selectionStore, cols, widths]);

  function toggleSort(col: MegaColumn) {
    if (sort.key === col.id) {
      onSortChange({ key: col.id, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key: col.id, direction: col.defaultDirection ?? "desc" });
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/20">
      <div ref={scrollContainerRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 20rem)" }}>
        <div style={{ width: totalWidth, minWidth: totalWidth }}>
          {/* Sticky header — three rows stay pinned on vertical scroll */}
          <div className="sticky top-0 z-20 bg-[#080808]">
          {/* Sub bands */}
          <div className="flex h-8 border-b border-white/15 bg-black/30 text-[10px] font-bold tracking-[0.14em] text-foreground">
            {subSegments.map((seg, i) => (
              <div
                key={`s-${seg.from}-${i}`}
                style={{ width: seg.width, minWidth: seg.width }}
                className={cn(
                  "flex items-center justify-center px-2",
                  groupBoundarySet.has(seg.lastIdx) ? "border-r-2 border-r-white/70" : "border-r-2 border-r-white/35",
                )}
              >
                {seg.sub}
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div className="flex h-8 border-b border-white/20 bg-[#080808]">
            {cols.map((col, i) => {
              const isActive = sort.key === col.id;
              const w = widths[i] ?? col.width;
              const isLast = i === cols.length - 1;
              const style: CSSProperties = { width: w, minWidth: w };
              if (col.sticky) {
                style.position = "sticky";
                style.left = stickyOffsets.get(i) ?? 0;
                style.zIndex = 6;
              }
              return (
                <div
                  key={col.id}
                  style={style}
                  className={cn(
                    "group relative flex items-end px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    colBorderClass(i),
                    isActive ? "bg-[#161616] text-foreground" : "bg-[#080808] text-muted-foreground",
                    col.align === "left"
                      ? "justify-start"
                      : col.align === "right"
                      ? "justify-end"
                      : "justify-center",
                    col.sticky ? "shadow-[inset_-2px_0_0_rgba(255,255,255,0.10)]" : "",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        // A <button> does not inherit the header's font, so the size,
                        // weight and uppercase have to be restated here — otherwise the
                        // label falls back to the UA default (16px, mixed case) and the
                        // column-header row reads larger than the sub-band row above it.
                        className="truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-foreground"
                        aria-label={`Sort by ${col.sub} ${col.label}`.trim()}
                      >
                        {col.label}
                        {isActive ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-[#111] text-xs text-white" sideOffset={6}>
                      {col.sub ? <span className="text-neutral-400">{col.sub} · </span> : null}
                      {col.label}
                    </TooltipContent>
                  </Tooltip>
                  {/* z-10 ensures this handle wins pointer events over the adjacent
                      column header div, which would otherwise paint on top of the
                      -4px overflow zone. Last column gets a left-anchored handle
                      so it is always resizable. */}
                  <div
                    onMouseDown={resizable.getResizeMouseDown(i)}
                    className={cn(
                      "absolute top-0 h-full w-2 cursor-col-resize bg-transparent transition hover:bg-white/15 z-10",
                      isLast ? "-left-1" : "-right-1",
                    )}
                  />
                </div>
              );
            })}
          </div>
          </div>{/* /sticky header */}

          {/* Rows */}
          <div className="divide-y divide-white/10">
            {rows.map((row, rIdx) => (
              <MegaRow
                key={row.client.id}
                row={row}
                rIdx={rIdx}
                cols={cols}
                widths={widths}
                stickyOffsets={stickyOffsets}
                colBorderClasses={colBorderClasses}
                onRowClick={onRowClick}
                onHighlight={onHighlight}
                selectionStore={selectionStore}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export const ClientsMegaTable = memo(ClientsMegaTableImpl);
