/**
 * LightweightSheet — a plain fixed-position sheet with no Radix Dialog underneath.
 *
 * Compared with the Radix-backed `ui/sheet.tsx`:
 *   • No portal (renders in-tree).
 *   • No focus trap.
 *   • No aria-hidden / inert tree walk over the rest of the DOM.
 *   • No scroll-lock side effect.
 *   • Renders null when closed (no hidden DOM node).
 *
 * Accessibility provided manually:
 *   • role="dialog" aria-modal="true" on the root node.
 *   • aria-labelledby wired to the rendered title via useId.
 *   • aria-describedby wired to the rendered description via useId.
 *   • Escape key closes when open.
 *   • Backdrop click closes.
 *   • Close button with aria-label="Close".
 *
 * Animation: tw-animate-css `animate-in slide-in-from-{side} duration-200` on the panel.
 * No exit animation — the panel unmounts immediately on close (renders null).
 * The 200 ms entry matches the existing Radix Sheet open duration.
 */

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";

export interface LightweightSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /**
   * Panel edge. Defaults to "right".
   *   "right"  — slides in from the right edge; full height, max-w-sm default.
   *   "left"   — slides in from the left edge;  full height, max-w-sm default, border-r.
   *   "bottom" — slides in from the bottom edge; full width, auto height.
   */
  side?: "right" | "left" | "bottom";
  /**
   * Override the generated aria-labelledby id. Useful when the caller renders
   * its own heading inside `children` and wants to reference it directly.
   */
  labelledBy?: string;
  /**
   * Override the generated aria-describedby id. Same use case as labelledBy.
   */
  describedBy?: string;
  /** Extra classes applied to the panel container. */
  className?: string;
}

export function LightweightSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "right",
  labelledBy,
  describedBy,
  className,
}: LightweightSheetProps) {
  const autoTitleId = useId();
  const autoDescId = useId();
  // Only attach aria-labelledby / aria-describedby when the content exists so
  // assistive technology doesn't reference missing elements.
  const titleId = labelledBy ?? (title != null ? autoTitleId : undefined);
  const descId = describedBy ?? (description != null ? autoDescId : undefined);

  // Escape key: match Radix Sheet behavior.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      {/* Backdrop */}
      <div
        className="animate-in fade-in-0 absolute inset-0 bg-black/50 duration-200"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "animate-in absolute z-10 flex flex-col shadow-lg duration-200",
          side === "right"  && "slide-in-from-right  inset-y-0 right-0 h-full w-3/4 sm:max-w-sm",
          side === "left"   && "slide-in-from-left   inset-y-0 left-0  h-full w-3/4 sm:max-w-sm",
          side === "bottom" && "slide-in-from-bottom inset-x-0 bottom-0 h-auto",
          className,
        )}
      >
        {/* Close button — top-right corner, matching Radix Sheet placement. */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 z-10 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>

        {/* Header: rendered only when title or description are provided. */}
        {(title != null || description != null) && (
          <div className="flex flex-col gap-1.5 p-6 pb-2">
            {title != null && (
              <p id={titleId} className="font-semibold">
                {title}
              </p>
            )}
            {description != null && (
              <p id={descId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
