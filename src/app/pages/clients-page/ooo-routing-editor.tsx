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
 * Two rules the UI has to make visible rather than hide:
 *   · `general` is an explicit fallback, never an implicit "no rule". A client with no `general`
 *     row and no specific match produces `skipped / routing_missing`, not a silent drop.
 *   · Clearing a rule DEACTIVATES it — a past follow-up must stay explainable by the configuration
 *     that produced it, so nothing is deleted.
 */
export function OooRoutingEditor({ clientId, autoOooEnabled }: { clientId: string; autoOooEnabled: boolean }) {
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
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : "Could not save OOO routing.");
      } finally {
        setBusyKey(null);
      }
    },
    [clientId, data],
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

  return (
    <div className="space-y-2 md:col-span-2">
      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">OOO routing</span>

      {!autoOooEnabled && configuredCount > 0 && (
        <Banner tone="info">
          Auto OOO is disabled, so these rules are not applied — new out-of-office replies are
          recorded as skipped. Enabling it above brings the parked follow-ups back.
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
            return (
              <label key={key} className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center">
                <div>
                  <span className="text-sm text-white">{ROUTING_LABELS[key]}</span>
                  <p className="text-xs text-neutral-500">{ROUTING_HINTS[key]}</p>
                </div>
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
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            );
          })}

          {data && !hasGeneral && (
            <p className="text-xs text-amber-300/90">
              No general fallback: contacts whose routing key has no rule will be recorded as
              “routing missing” instead of being followed up.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
