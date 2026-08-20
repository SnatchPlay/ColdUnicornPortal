import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Banner, InlineLinkButton } from "../../components/app-ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { repository } from "../../data/repository";
import { ROUTING_KEYS, type RoutingKey } from "../../types/core";
import { isOooLive, isOooRoutable, oooStatusNote } from "../../lib/ooo-health";
import type { ClientOooRoutingPagePayload } from "../../types/view-contracts";

// Radix <Select> forbids an empty-string item value, and "no rule" has to be selectable.
const NO_ROUTE = "__no_route__";

const ROUTING_LABELS: Record<RoutingKey, string> = {
  male: "Male",
  female: "Female",
  general: "General (fallback)",
};

const ROUTING_HINTS: Record<RoutingKey, string> = {
  male: "Contacts whose routing key is male.",
  female: "Contacts whose routing key is female.",
  general: "Used when no rule matches the contact's routing key.",
};

/**
 * Per-client OOO routing rules (spec §11, BL-2 — closed by ADR-0015).
 *
 * Writes to `client_ooo_routing`, a different table from the client row, so this section saves on
 * its own instead of joining the drawer's `draft`/`isDraftDirty` cycle — mixing a second table into
 * that patch would mean one Save button with two failure modes.
 *
 * Three rules the UI has to make visible rather than hide:
 *   · `general` is an explicit fallback, never an implicit "no rule". A client with no `general`
 *     row and no specific match produces `skipped / routing_missing`, not a silent drop.
 *   · Clearing a rule DEACTIVATES it — a past follow-up must stay explainable by the configuration
 *     that produced it, so nothing is deleted.
 *   · A rule is only as good as the campaign it points at. A rule aimed at a campaign that is not
 *     `active` sends nothing and reads identically to a working one: on 2026-08-19, 22 of the 25
 *     active rules in production were in that state, across 12 of 16 Active clients, and the
 *     condition was visible nowhere. Provisioning fills an EMPTY slot and never re-points a full
 *     one, so repairing it is a human decision, made here.
 */
export function OooRoutingEditor({
  clientId,
  autoOooEnabled,
  onRoutingChanged,
}: {
  clientId: string;
  autoOooEnabled: boolean;
  /**
   * Called after a rule is saved or cleared. The grid's OOO column is served by a separate aggregate
   * inside `loadClientsOverview`, so without this the operator fixes a rule here, closes the drawer,
   * and the column still shows the counts from before the fix until a full page reload.
   */
  onRoutingChanged: () => void;
}) {
  const [data, setData] = useState<ClientOooRoutingPagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<RoutingKey | null>(null);
  const loadIdRef = useRef(0);

  const load = useCallback(async (id: string) => {
    const loadId = ++loadIdRef.current;
    try {
      const result = await repository.loadClientOooRouting(id);
      if (loadId !== loadIdRef.current) return; // stale — the drawer switched clients
      setData(result);
      setError(null);
    } catch (reason) {
      if (loadId !== loadIdRef.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load OOO routing.");
    }
  }, []);

  useEffect(() => { void load(clientId); }, [clientId, load]);

  const apply = useCallback(
    async (key: RoutingKey, campaignId: string | null) => {
      setBusyKey(key);
      try {
        const existing = data?.routes.find((r) => r.routing_key === key && r.is_active);
        const result = campaignId
          ? await repository.upsertClientOooRouting(clientId, key, campaignId)
          : existing
            ? await repository.deactivateClientOooRouting(existing.id)
            : null;
        if (!result) return;
        setData(result);
        setError(null);
        // Surfacing the recovery count matters: the operator's mental model is "I fixed the
        // config", and this is the only signal telling them whether that unblocked anything.
        if (result.recoveredFollowups) {
          toast.success(
            `Routing saved — ${result.recoveredFollowups} follow-up${result.recoveredFollowups === 1 ? "" : "s"} returned to pending.`,
          );
        } else {
          toast.success(campaignId ? "Routing saved." : "Routing rule deactivated.");
        }
        onRoutingChanged();
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : "Could not save OOO routing.");
      } finally {
        setBusyKey(null);
      }
    },
    [clientId, data, onRoutingChanged],
  );

  // A failed load must be recoverable in place: `load` only re-runs when `clientId` changes, so
  // without a retry a single network blip would leave the section dead until the operator switched
  // to another client and back.
  if (error) {
    return (
      <div className="space-y-2 md:col-span-2">
        <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">OOO routing</span>
        <Banner tone="warning">{error}</Banner>
        <InlineLinkButton onClick={() => void load(clientId)}>Retry</InlineLinkButton>
      </div>
    );
  }

  const campaigns = data?.campaigns ?? [];
  const activeRoutes = data?.routes.filter((r) => r.is_active) ?? [];
  const hasGeneral = activeRoutes.some((r) => r.routing_key === "general");
  const configuredCount = activeRoutes.length;

  // Derived here rather than served pre-computed — the drawer already holds every campaign — but
  // through the SAME predicates the grid's aggregate uses (lib/ooo-health.ts), so the two surfaces
  // cannot disagree about what "working" means for one client.
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const notLive = activeRoutes.filter((r) => !isOooLive(campaignById.get(r.campaign_id)?.status));
  // Drafts are the expected state right after provisioning and need copy written, not a campaign
  // re-created at the vendor. Lumping them in with stopped campaigns made a successful onboarding
  // read as a disaster, in the same red.
  //
  // `isOooRoutable` and not an explicit stopped/completed test, because the third case is the one
  // that bites: a rule whose campaign is NOT IN THIS LIST at all — archived, so the payload excludes
  // it. An undefined status is not routable, so such a rule counts as dead here, matching what the
  // grid's aggregate scores it. Testing for stopped/completed instead let it fall through to
  // "still a draft" and offered the write-the-copy remedy for a campaign that no longer exists.
  const deadRoutes = notLive.filter((r) => !isOooRoutable(campaignById.get(r.campaign_id)?.status));
  const allDead = deadRoutes.length > 0 && deadRoutes.length === configuredCount;

  return (
    <div className="space-y-2 md:col-span-2">
      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">OOO routing</span>

      {!autoOooEnabled && configuredCount > 0 && (
        <Banner tone="info">
          Auto OOO is disabled, so these rules are not applied — new out-of-office replies are
          recorded as skipped. Enabling it above brings the parked follow-ups back.
        </Banner>
      )}

      {/* A rule pointing at a campaign that will not send is the failure this section exists to
          surface. Each banner carries the count and the fix only — every affected rule names its own
          status under its dropdown, and enumerating them here as well printed the same sentence four
          times for a client whose whole triple had stopped.
          Two banners rather than one, because the two states need different people: a draft needs
          its copy written, a stopped campaign needs re-creating at the vendor. */}
      {deadRoutes.length > 0 && (
        <Banner tone={autoOooEnabled && allDead ? "danger" : "warning"}>
          {allDead
            ? "None of this client's OOO rules can send. "
            : `${deadRoutes.length} of ${configuredCount} OOO rules point at a campaign that is not sending. `}
          {/* The remedy differs per rule and each row says which — a paused campaign is switched back
              on by the daily job, an archived one cannot be revived through the API at all. */}
          Each rule below says why. Where it says archived, re-create the campaign in Bison and
          re-point the rule here — provisioning fills an empty rule but never re-points one you set.
        </Banner>
      )}

      {/* `warning`, not `info`: Banner paints `info` emerald, which would give this state the
          success colour while the grid's OOO column paints the same state amber. Nothing is sending
          yet — that is not success, it is an unfinished handover. */}
      {notLive.length > deadRoutes.length && (
        <Banner tone="warning">
          {notLive.length - deadRoutes.length} of {configuredCount} OOO campaigns are not sending yet.
          Provisioning creates the container, never the copy — write each sequence in Bison and start
          the campaign. A draft with no sequence sends nothing.
        </Banner>
      )}

      {data && campaigns.length === 0 ? (
        <Banner tone="warning">
          This client has no follow-up campaigns yet. Create a campaign of type{" "}
          <code className="rounded bg-black/40 px-1">ooo_followup</code> before configuring routing.
        </Banner>
      ) : (
        <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
          {ROUTING_KEYS.map((key) => {
            const active = activeRoutes.find((r) => r.routing_key === key);
            const selected = active ? campaignById.get(active.campaign_id) : undefined;
            return (
              <label key={key} className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-start">
                <div className="sm:pt-2">
                  <span className="text-sm text-white">{ROUTING_LABELS[key]}</span>
                  <p className="text-xs text-neutral-500">{ROUTING_HINTS[key]}</p>
                </div>
                <div className="space-y-1">
                  <Select
                    value={active?.campaign_id ?? NO_ROUTE}
                    disabled={!data || busyKey !== null}
                    onValueChange={(value) => void apply(key, value === NO_ROUTE ? null : value)}
                  >
                    <SelectTrigger className="w-full rounded-xl border-white/10 bg-black/20 px-3 py-2 text-sm">
                      <SelectValue placeholder="No rule" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 rounded-xl border-[#242424] bg-[#050505] text-white">
                      <SelectItem value={NO_ROUTE} className="text-neutral-400 focus:bg-[#1a1a1a]">
                        No rule
                      </SelectItem>
                      {campaigns.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id} className="text-white focus:bg-[#1a1a1a]">
                          {/* The status rides in the option label because every OOO campaign in a
                              workspace carries the same three names — picking between a live one and
                              a completed one is impossible from the name. */}
                          {campaign.name}
                          {!isOooLive(campaign.status) && (
                            <span className="text-amber-300/90"> · {oooStatusNote(campaign.status)}</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* "Not sending: <note>" rather than "This campaign is <note>" — the notes read as
                      phrases ("draft — no sequence written yet"), and the copular form produced
                      "This campaign is draft — …" plus a second dash in the same sentence. */}
                  {active && !selected && (
                    <p className="text-xs text-amber-300/90">
                      This rule points at a campaign that is no longer available — archived, or gone
                      from Bison. Pick another, or clear the rule.
                    </p>
                  )}
                  {selected && !isOooLive(selected.status) && (
                    <p className="text-xs text-amber-300/90">
                      Not sending: {oooStatusNote(selected.status)}. Contacts routed here wait.
                    </p>
                  )}
                </div>
              </label>
            );
          })}

          {data && !hasGeneral && (
            <p className="text-xs text-amber-300/90">
              No general fallback: contacts whose routing key has no rule will be recorded as
              “routing missing” instead of being followed up.
            </p>
          )}

          {/* Campaign statuses come from bison-campaign-sync, which only walks clients whose status
              is Active. Saying so is the whole mitigation — a client still onboarding shows the
              status its campaigns had when someone last looked, and that must not read as live. */}
          {data && (
            <p className="text-xs text-neutral-500">
              Campaign statuses are synced hourly for Active clients only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
