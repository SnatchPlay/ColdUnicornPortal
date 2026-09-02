import { cn } from "./ui/utils";
import type { LeadViewMode } from "../lib/crm/lead-view-mode";

/**
 * The PDCA / CRM / Combined switch (ADR-0013). Shared by the internal Leads page and the client
 * My Pipeline page so both surfaces switch views with one control and one taxonomy; the mode type
 * and the loader that follows it live in `lib/crm/lead-view-mode.ts` + `lib/use-lead-crm.ts`.
 */
const LEAD_VIEW_MODES = [
  { key: "pdca", label: "PDCA" },
  { key: "crm", label: "CRM" },
  { key: "combined", label: "Combined" },
] as const;

/** Which of the three lead tables is on screen. Active option: `.rainbow-active` (theme.css §rainbow). */
export function LeadViewModeSwitcher({
  value,
  onChange,
}: {
  value: LeadViewMode;
  onChange: (next: LeadViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-[#0b0b0b] p-1 text-xs">
      {LEAD_VIEW_MODES.map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => onChange(mode.key)}
          aria-pressed={value === mode.key}
          className={cn(
            "rounded-lg px-3 py-1.5 transition",
            value === mode.key ? "rainbow-active" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
