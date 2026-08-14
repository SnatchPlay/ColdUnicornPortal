import { useState } from "react";
import { toast } from "sonner";
import { repository } from "../data/repository";
import type { ArchivableEntity } from "../data/orm-gateway-contract";

/**
 * The portal's delete controls. Deleting a client, campaign, lead, domain, invoice or mailbox is an
 * archive (soft delete), never a `DELETE` — the ingestion FKs block the hard form and re-ingestion
 * would undo it (migration `20260813_entity_archival`).
 *
 * One component for all six surfaces so the confirmation wording, the toast and the error handling
 * cannot drift apart. Confirmation is `window.confirm`, matching the three delete flows that already
 * exist (settings custom columns, blacklist, sequencer connections) — there is no dialog primitive in
 * this codebase and this change is not the place to introduce one.
 */

const ENTITY_LABELS: Record<ArchivableEntity, string> = {
  client: "client",
  campaign: "campaign",
  lead: "lead",
  domain: "domain",
  invoice: "invoice",
  emailAccount: "mailbox",
};

/** What archiving actually costs the reader, per entity — said plainly in the confirm dialog. */
const ENTITY_CONSEQUENCE: Record<ArchivableEntity, string> = {
  client: "It disappears from the clients list, every picker and every dashboard metric. Its campaigns, leads and daily stats are kept and are NOT archived with it.",
  campaign: "It disappears from the campaigns list and its sends stop feeding the charts. The daily stats rows are kept. If any OOO routing rule points at it, that rule is deactivated — returning contacts for that key will have nowhere to go until you re-point it.",
  lead: "It disappears from the leads list, the CRM view, the stage counts and the pipeline metrics. Its meetings, offers, tasks and replies are kept.",
  domain: "It disappears from the domains list. The Winnr sync keeps refreshing it in the background.",
  invoice: "It disappears from the invoices list.",
  emailAccount: "It disappears from the mailboxes list. The Winnr sync keeps refreshing it in the background.",
};

export interface ArchiveButtonProps {
  entity: ArchivableEntity;
  id: string;
  /** Shown in the confirmation prompt so the operator can see what they are about to remove. */
  name: string;
  /** Current tombstone; non-null renders the Restore variant. */
  archivedAt: string | null | undefined;
  /** Called after a successful archive/restore — reload the page data here. */
  onDone: () => void;
  disabled?: boolean;
  /** `icon` for a table row, `pill` (default) for a drawer action row. */
  variant?: "pill" | "icon";
}

export function ArchiveButton({ entity, id, name, archivedAt, onDone, disabled, variant = "pill" }: ArchiveButtonProps) {
  const [busy, setBusy] = useState(false);
  const isArchived = Boolean(archivedAt);
  const label = ENTITY_LABELS[entity];

  async function run() {
    if (!isArchived) {
      const confirmed = window.confirm(
        `Archive the ${label} "${name}"?\n\n${ENTITY_CONSEQUENCE[entity]}\n\n` +
          `Nothing is deleted — turn on "Show archived" to find it again and restore it.`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const result = await repository.setEntityArchived(entity, id, !isArchived);
      if (result.deactivatedOooRoutes > 0) {
        // Never a bare success toast here: archiving an OOO follow-up campaign silently took its
        // routing rules down, and returning contacts now resolve to `routing_missing` until the
        // operator points the key at a live campaign (ADR-0015).
        toast.warning(
          `Archived campaign "${name}" — ${result.deactivatedOooRoutes} OOO routing ` +
            `rule${result.deactivatedOooRoutes === 1 ? "" : "s"} deactivated. Returning contacts for ` +
            `${result.deactivatedOooRoutes === 1 ? "that key" : "those keys"} have nowhere to go ` +
            `until you point them at another campaign.`,
        );
      } else {
        toast.success(isArchived ? `Restored ${label} "${name}".` : `Archived ${label} "${name}".`);
      }
      onDone();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : `Could not archive the ${label}.`);
    } finally {
      setBusy(false);
    }
  }

  const text = busy ? (isArchived ? "Restoring…" : "Archiving…") : isArchived ? "Restore" : "Archive";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => { void run(); }}
        disabled={disabled || busy}
        title={isArchived ? `Restore this ${label}` : `Archive this ${label}`}
        className={`rounded-lg border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isArchived
            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
            : "border-rose-400/30 bg-rose-500/5 text-rose-200 hover:bg-rose-500/15"
        }`}
      >
        {text}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { void run(); }}
      disabled={disabled || busy}
      className={`rounded-full border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isArchived
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
          : "border-rose-400/30 bg-rose-500/5 text-rose-200 hover:bg-rose-500/15"
      }`}
    >
      {text}
    </button>
  );
}

/** Filter pill that brings archived rows back into a list so they can be restored. */
export function ShowArchivedToggle({ value, onChange, disabled }: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-pressed={value}
      className={`rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
        value
          ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
          : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
      }`}
    >
      {value ? "Showing archived" : "Show archived"}
    </button>
  );
}

/** Inline marker for an archived row, so a list showing both states stays readable. */
export function ArchivedBadge({ archivedAt }: { archivedAt?: string | null }) {
  if (!archivedAt) return null;
  return (
    <span className="ml-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-100">
      Archived
    </span>
  );
}
