import { Heart } from "lucide-react";

import { SATISFACTION_LEVELS, type SatisfactionLevel } from "../types/core";
import { cn } from "./ui/utils";

export const SATISFACTION_LABELS: Record<SatisfactionLevel, string> = {
  1: "Unhappy",
  2: "Neutral",
  3: "Happy",
};

export function satisfactionLabel(value: SatisfactionLevel | null): string {
  return value ? SATISFACTION_LABELS[value] : "Not rated";
}

interface SatisfactionHeartsProps {
  value: SatisfactionLevel | null;
  /** Omit to render a read-only rating. */
  onChange?: (next: SatisfactionLevel | null) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Manual 1–3 customer-satisfaction rating. Clicking the already-selected level clears it back to
 * "not rated", which is the only way to undo a rating — there is no separate clear control.
 */
export function SatisfactionHearts({ value, onChange, size = "md", className }: SatisfactionHeartsProps) {
  const readOnly = !onChange;
  const px = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  if (readOnly) {
    return (
      <span
        className={cn("inline-flex items-center gap-0.5", className)}
        role="img"
        aria-label={satisfactionLabel(value)}
      >
        {SATISFACTION_LEVELS.map((level) => (
          <Heart
            key={level}
            aria-hidden="true"
            className={cn(px, value && level <= value ? "fill-rose-400 text-rose-400" : "text-neutral-700")}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      role="radiogroup"
      aria-label="Customer satisfaction"
    >
      {SATISFACTION_LEVELS.map((level) => {
        const filled = value !== null && level <= value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            aria-label={SATISFACTION_LABELS[level]}
            title={`${SATISFACTION_LABELS[level]}${value === level ? " — click to clear" : ""}`}
            // Row click opens the drawer; rating from inside a cell must not also open it.
            onClick={(event) => {
              event.stopPropagation();
              onChange(value === level ? null : level);
            }}
            className={cn(
              "cursor-pointer rounded-sm p-0.5 outline-none transition-colors",
              "hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-rose-400/70",
            )}
          >
            <Heart
              aria-hidden="true"
              className={cn(px, filled ? "fill-rose-400 text-rose-400" : "text-neutral-600 hover:text-rose-300")}
            />
          </button>
        );
      })}
    </span>
  );
}
