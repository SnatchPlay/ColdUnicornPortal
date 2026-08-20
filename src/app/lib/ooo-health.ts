// OOO routing health — one definition of "is this rule working", shared by the Clients grid and the
// client drawer (ADR-0015).
//
// It exists because the same question is asked at two altitudes: the grid asks it about 56 clients
// at once from a server-side aggregate, the drawer asks it about one client's three rules from the
// campaigns it already loaded. Written twice, the two drifted immediately — the grid counted
// `status = 'active'` in SQL while the drawer compared strings in TSX, and nothing tied them.
//
// The measured reason any of this exists: on 2026-08-19, 22 of the 25 active routing rules in
// production — across 12 of 16 Active clients — pointed at a campaign Bison had stopped or
// completed. A rule like that sends nothing and reads exactly like a working one.

import type { CampaignStatus } from "../types/core";

/** A campaign in one of these is sending now. */
export const OOO_LIVE_STATUSES: readonly CampaignStatus[] = ["active"];

/**
 * A campaign in one of these is a legitimate routing target: it either sends now or becomes able to
 * once a manager writes its sequence and starts it. `completed` and `stopped` are dead objects.
 *
 * This is a DIFFERENT question from "is it sending", and the difference is load-bearing:
 * `bison-workspace-setup` fills an empty rule from a routable campaign, so a freshly provisioned
 * client legitimately has three rules pointing at drafts. Calling that "broken" would make the
 * normal handover state indistinguishable from the disaster.
 */
export const OOO_ROUTABLE_STATUSES: readonly CampaignStatus[] = ["active", "launching", "draft"];

export const isOooLive = (status: CampaignStatus | undefined): boolean =>
  status !== undefined && OOO_LIVE_STATUSES.includes(status);

export const isOooRoutable = (status: CampaignStatus | undefined): boolean =>
  status !== undefined && OOO_ROUTABLE_STATUSES.includes(status);

/**
 * Why a campaign is not sending, in the operator's terms. Only the informative statuses appear:
 * `active` never reaches a caller (it is filtered first) and `launching` is self-explanatory, so a
 * caller falls back to the raw status rather than being handed an identity mapping to maintain.
 *
 * The two halves need different fixes, which is the whole point of separating them: a draft needs
 * copy written, a stopped campaign needs re-creating at the vendor and the rule re-pointing.
 */
const STATUS_NOTES: Partial<Record<CampaignStatus, string>> = {
  draft: "draft — no sequence written yet",
  // The vendor words behind these two are `paused` and `archived`, and they are not interchangeable:
  // one is undone by the daily revive job, the other cannot be undone through the API at all.
  stopped: "paused in Bison — the daily job will switch it back on",
  completed: "archived in Bison — automation cannot revive it, re-create the campaign",
};

export const oooStatusNote = (status: CampaignStatus): string => STATUS_NOTES[status] ?? status;

/** Server-side counts for one client, as `loadClientsOverview` returns them. */
export interface OooHealthCounts {
  /** Active rules — 0..3, capped by the partial unique index on (client_id, routing_key). */
  routed: number;
  /** Of those, the ones whose campaign is sending now. */
  live: number;
  /** Of those, the ones whose campaign is routable but not yet sending (draft / launching). */
  awaiting: number;
  /**
   * Whether the `general` rule is one of them. Counts alone cannot answer coverage: one live rule
   * is complete when it is `general` (`resolve_ooo_routing` falls back to it for every key that has
   * no rule of its own) and badly incomplete when it is `male` (female and general contacts park as
   * `routing_missing`). Without this, a client with a single `male` rule scored a green 1/1.
   */
  hasGeneral: boolean;
  /**
   * Of the dead rules, the ones no automation can repair: the campaign is archived at the vendor,
   * and Bison has no unarchive endpoint. The remainder are paused, and `bison-ooo-campaign-revive`
   * switches those back on the next morning without anyone being told.
   */
  unrecoverable: number;
}

/**
 * Higher = more wrong. Ordered so a descending sort surfaces the clients that need attention, which
 * is the only reason to sort this column. Six levels against a three-colour mark, deliberately —
 * `provisioningRank` records the same trade: colour answers "how bad", the rank answers "in what
 * order do I work through these", and "auto OOO is off" is a configuration rather than a fault, so
 * it must never outrank a client whose rules are actually broken.
 */
export function oooHealthRank(health: OooHealthCounts | null, autoOooEnabled: boolean): number {
  if (!autoOooEnabled) return 1;
  if (!health || health.routed === 0) return 2;
  const dead = health.routed - health.live - health.awaiting;
  // A rule the daily revive job will fix on its own is not a task for a human, so it must not
  // outrank one that is. `unrecoverable` is the archived half — the only half anybody has to act on.
  if (dead > 0 && health.unrecoverable === 0) return 3;
  if (dead === health.routed) return 5;
  if (dead > 0) return 4;
  // Nothing is dead from here down. Healthy needs coverage as well as sending: a rule set with no
  // `general` fallback silently drops every routing key it does not name.
  if (health.hasGeneral && health.live === health.routed) return 0;
  return 3;
}

/**
 * One sentence naming the state and, implicitly, whose job the fix is. Ordered by severity, and each
 * branch names a DIFFERENT remedy — that is the point of not collapsing them into "N of M broken":
 * a dead campaign is re-created at the vendor, a campaign that has not started needs its copy, and a
 * missing fallback needs a rule added here.
 */
export function oooHealthWord(health: OooHealthCounts | null, autoOooEnabled: boolean): string {
  if (!autoOooEnabled) return "Auto OOO is off — routing rules are not applied";
  if (!health || health.routed === 0) return "No OOO routing configured";
  const { routed, live, awaiting, hasGeneral } = health;
  const dead = routed - live - awaiting;
  const { unrecoverable } = health;
  // Everything dead is reported by WHOSE JOB IT IS, because the reader's next action differs: a
  // paused campaign is switched back on overnight, an archived one cannot be revived through the API
  // at all. One sentence for all of them made a client nobody needs to touch look like a client on
  // fire. The whole block is guarded on dead > 0 — `unrecoverable === dead` is trivially true at
  // zero and would otherwise swallow both the healthy and the awaiting cases.
  if (dead > 0) {
    const paused = dead - unrecoverable;
    if (unrecoverable === 0) {
      return `${paused} of ${routed} OOO campaigns are paused — the daily job switches them back on`;
    }
    if (paused === 0) {
      return `${unrecoverable} of ${routed} OOO campaigns are archived — automation cannot revive these, re-create them in Bison`;
    }
    return `${unrecoverable} of ${routed} OOO campaigns are archived and need re-creating in Bison; ${paused} are paused and will be switched back on`;
  }
  if (!hasGeneral) {
    return "No general fallback — contacts whose routing key has no rule of its own are recorded as routing missing";
  }
  // "not sending yet" rather than "still drafts": `awaiting` also covers `launching`, and telling
  // someone to start a campaign that is already starting is the wrong remedy.
  if (awaiting > 0) return `${awaiting} of ${routed} OOO campaigns are not sending yet — write each sequence in Bison and start the campaign`;
  return "Every OOO rule points at a sending campaign";
}
