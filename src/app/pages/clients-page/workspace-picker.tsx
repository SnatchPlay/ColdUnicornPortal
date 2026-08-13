import { useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { repository } from "../../data/repository";
import { cn } from "../../components/ui/utils";

export type SequencerKey = "emailbison" | "aimfox";

export interface WorkspaceChoice {
  workspace_id: string;
  name: string | null;
}

export const SEQUENCER_TITLES: Record<SequencerKey, string> = {
  emailbison: "EmailBison",
  aimfox: "Aimfox",
};

// Radix rejects "" as a Select value, so the "no workspace" option needs a sentinel — the same
// shape the manager select already uses for Unassigned.
const NO_WORKSPACE = "__none__";

/**
 * Pick a client's workspace out of the vendor's own list.
 *
 * The list loads when the select is first opened, not with the form: it is a live vendor round trip
 * per sequencer, and most sessions need neither. Only workspaces no other client has claimed come
 * back — filtered server-side, in the same node that answers `needs_selection`, and backed by
 * `client_sequencers_workspace_uk` so the database refuses a second claim regardless.
 *
 * One per vendor, not several: `UNIQUE (client_id, sequencer_id)` allows exactly one connector row,
 * so a multi-select would offer a choice that cannot be saved.
 *
 * Typing an id was the alternative and it is the worse one. Provisioning resolves by an exact name
 * match, which held for 4 of 9 clients when measured, so a hand-typed id is both the common path and
 * the one nobody can verify at the keyboard. It stays available in the drawer — a workspace the
 * listing cannot return (already claimed, or created after the list loaded) has to be reachable
 * somehow — but it is the second option there, not the only one.
 *
 * Two callers: the New client sheet, before any client row exists (`clientId: null` listing mode),
 * and the client drawer's Credentials & IDs card for a client that has no workspace yet.
 */
export function WorkspacePicker({
  sequencerKey,
  chosen,
  onChoose,
  label,
  triggerClassName,
  emptyHint,
}: {
  sequencerKey: SequencerKey;
  chosen: WorkspaceChoice | null;
  onChoose: (choice: WorkspaceChoice | null) => void;
  /** Own label, or `null` when the caller already names the field. */
  label?: React.ReactNode | null;
  triggerClassName?: string;
  /** Shown when the vendor returns no unclaimed workspace. */
  emptyHint?: string;
}) {
  const [options, setOptions] = useState<WorkspaceChoice[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Once per mount. Re-fetching on every open would spend a vendor round trip to redraw a list the
  // operator is looking at, and a workspace claimed elsewhere mid-session still cannot be saved.
  const loadOnce = async () => {
    if (options !== null || loading) return;
    setLoading(true);
    try {
      const result = await repository.requestWorkspaceSetup({
        clientId: null,
        sequencerKey,
        dryRun: true,
      });
      setOptions(result.candidates ?? []);
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : `Could not list ${SEQUENCER_TITLES[sequencerKey]} workspaces.`,
      );
    } finally {
      setLoading(false);
    }
  };

  const heading =
    label === null ? null : (
      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {label ?? `${SEQUENCER_TITLES[sequencerKey]} workspace`}
      </span>
    );

  return (
    <label className="block space-y-2">
      {heading}
      <Select
        value={chosen?.workspace_id ?? NO_WORKSPACE}
        onOpenChange={(open) => {
          if (open) void loadOnce();
        }}
        onValueChange={(value) =>
          onChoose(
            value === NO_WORKSPACE
              ? null
              : (options?.find((o) => o.workspace_id === value) ?? { workspace_id: value, name: null }),
          )
        }
      >
        <SelectTrigger
          className={cn(
            "h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white",
            triggerClassName,
          )}
        >
          {/* The placeholder is what a value carries when the list has not loaded — or cannot carry
              it at all. The drawer opens on a client whose workspace is already claimed, and a
              claimed workspace is exactly what the listing filters out, so without this the trigger
              would read empty over a stored id. */}
          <SelectValue placeholder={chosen ? (chosen.name ?? chosen.workspace_id) : undefined} />
        </SelectTrigger>
        <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
          <SelectItem value={NO_WORKSPACE} className="text-white focus:bg-[#1a1a1a] focus:text-white">
            Not connected
          </SelectItem>
          {loading ? <div className="px-2 py-1.5 text-xs text-white/40">Loading…</div> : null}
          {options?.map((option) => (
            <SelectItem
              key={option.workspace_id}
              value={option.workspace_id}
              className="text-white focus:bg-[#1a1a1a] focus:text-white"
            >
              {option.name ?? option.workspace_id}
            </SelectItem>
          ))}
          {options?.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-white/40">
              {emptyHint ?? "Every workspace at this vendor already belongs to a client."}
            </div>
          ) : null}
        </SelectContent>
      </Select>
    </label>
  );
}
