import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Calendar, MessageSquare, RefreshCcw, Search, X } from "lucide-react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "./ui/utils";
import { formatDate, formatNumber } from "../lib/format";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import {
  TIMEFRAME_PRESETS,
  createDefaultTimeframe,
  getTimeframeLabel,
  type TimeframeValue,
} from "../lib/timeframe";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export const PORTAL_CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "#080808",
    border: "1px solid #242424",
    borderRadius: "12px",
    color: "#fff",
  },
  labelStyle: { color: "#a3a3a3" },
};

export function DateRangeButton({
  value,
  onChange,
}: {
  value?: TimeframeValue;
  onChange?: (value: TimeframeValue) => void;
}) {
  const [internalValue, setInternalValue] = useState<TimeframeValue>(() => createDefaultTimeframe());
  const [open, setOpen] = useState(false);
  const timeframe = value ?? internalValue;
  const setTimeframe = onChange ?? setInternalValue;

  const selectPreset = (preset: TimeframeValue["preset"]) => {
    setTimeframe({ ...timeframe, preset });
    if (preset !== "custom") setOpen(false);
  };

  const updateCustomDate = (key: "customStart" | "customEnd", nextValue: string) => {
    setTimeframe({
      ...timeframe,
      preset: "custom",
      [key]: nextValue || null,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-3 rounded-xl border border-[#242424] bg-[#171717] px-4 py-2.5 text-sm text-white transition hover:border-[#3a3a3a]">
          <Calendar className="h-4 w-4 text-neutral-300" />
          <span>{getTimeframeLabel(timeframe)}</span>
          <span className="text-neutral-500">⌄</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] rounded-2xl border-[#242424] bg-[#080808] p-4 text-white">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Timeframe</p>
        <div className="grid grid-cols-2 gap-2">
          {TIMEFRAME_PRESETS.map((preset) => {
            const active = timeframe.preset === preset.key;
            return (
              <button
                key={preset.key}
                onClick={() => selectPreset(preset.key)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left text-xs transition",
                  active
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-[#242424] bg-[#0f0f0f] text-neutral-300 hover:border-[#3a3a3a] hover:text-white",
                )}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            onClick={() => selectPreset("custom")}
            className={cn(
              "col-span-2 rounded-xl border px-3 py-2 text-left text-xs transition",
              timeframe.preset === "custom"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-[#242424] bg-[#0f0f0f] text-neutral-300 hover:border-[#3a3a3a] hover:text-white",
            )}
          >
            Custom Range
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-neutral-400">
            From
            <input
              type="date"
              value={timeframe.customStart ?? ""}
              onChange={(event) => updateCustomDate("customStart", event.target.value)}
              className="h-9 w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-2 text-xs text-white outline-none transition focus:border-emerald-500/40"
            />
          </label>
          <label className="space-y-1 text-xs text-neutral-400">
            To
            <input
              type="date"
              value={timeframe.customEnd ?? ""}
              onChange={(event) => updateCustomDate("customEnd", event.target.value)}
              className="h-9 w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-2 text-xs text-white outline-none transition focus:border-emerald-500/40"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PortalPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-white">{title}</h1>
        <p className="mt-3 text-base text-neutral-400">{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}

export function PortalSurface({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-[#242424] bg-[#050505] p-6", className)}>
      {(title || subtitle || actions) && (
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">{title}</h2>}
            {subtitle && <p className="mt-2 text-sm text-neutral-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  tone = "green",
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "green" | "purple" | "amber" | "blue" | "indigo";
  icon?: ReactNode;
}) {
  const toneMap = {
    green: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400",
    purple: "border-violet-500/25 bg-violet-500/[0.06] text-violet-400",
    amber: "border-amber-500/25 bg-amber-500/[0.06] text-amber-400",
    blue: "border-blue-500/20 bg-blue-500/[0.06] text-blue-400",
    indigo: "border-indigo-500/20 bg-indigo-500/[0.06] text-indigo-400",
  };
  return (
    <div className={cn("rounded-2xl border p-5", toneMap[tone])}>
      <div className="flex items-start justify-between">
        <div className="rounded-xl bg-current/10 p-2 text-current">{icon}</div>
        <span className="text-xs text-emerald-400">↑ live</span>
      </div>
      <p className="mt-5 text-3xl font-medium text-current">{value}</p>
      <p className="mt-1 text-sm text-neutral-300">{label}</p>
      <p className="mt-3 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

export function ChartPanel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <PortalSurface title={title} subtitle={subtitle} className={className}>
      <div className="h-72">{children}</div>
    </PortalSurface>
  );
}

export function ResponsiveChart({ children }: { children: ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  );
}

export function ChartTooltip() {
  return <Tooltip {...PORTAL_CHART_TOOLTIP} />;
}

export function PipelineBadge({ stage }: { stage: PipelineStage }) {
  const item = PIPELINE_STAGES.find((candidate) => candidate.key === stage);
  const label = item?.label ?? "Unqualified";
  const color = item?.color ?? "#737373";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-xl border px-3 py-1 text-sm"
      style={{
        borderColor: `${color}40`,
        backgroundColor: `${color}14`,
        color,
      }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function FilterChip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-2 text-sm transition",
        active
          ? "border-[#3a3a3a] bg-[#222] text-white"
          : "border-[#242424] bg-[#090909] text-neutral-400 hover:border-[#3a3a3a] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

export function PortalSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-[52px] w-full rounded-2xl border border-[#242424] bg-[#050505] px-12 text-base text-white outline-none transition placeholder:text-neutral-500 focus:border-[#3a3a3a]"
      />
    </div>
  );
}

export function EmptyPortalState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#242424] bg-[#080808] px-6 py-12 text-center">
      <p className="text-base text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-500">{description}</p>
    </div>
  );
}

export function PortalLoadingState({
  title = "Loading workspace data",
  description = "We are syncing your client data from Supabase.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#242424] bg-[#080808] px-6 py-10 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#2f2f2f]">
        <RefreshCcw className="h-4 w-4 animate-spin text-neutral-300" />
      </div>
      <p className="text-base text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-500">{description}</p>
    </div>
  );
}

export function PortalErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-8 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
        <AlertCircle className="h-4 w-4 text-red-300" />
      </div>
      <p className="text-base text-red-100">{title}</p>
      <p className="mt-2 text-sm text-red-100/70">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-300/30 px-4 py-2 text-sm text-red-100 transition hover:bg-red-500/10"
        >
          <RefreshCcw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}

export function LeadDrawer({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead: null | {
    name: string;
    initials: string;
    email: string;
    title: string;
    company: string;
    stage: PipelineStage;
    campaignName: string;
    step: number | null;
    replyCount: number;
    replyLabel: string;
    lastReplyDate: string | null;
    addedDate: string;
    lead: {
      linkedin_url: string | null;
      gender: string | null;
      industry: string | null;
      headcount_range: string | null;
      website: string | null;
      country: string | null;
      reply_text: string | null;
    };
    replies: Array<{
      id: string;
      message_text: string | null;
      classification: string | null;
      sequence_step: number | null;
      received_at: string;
    }>;
  };
}) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !lead) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusCloseButton = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const container = drawerRef.current;
      if (!container) return;

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !active || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusCloseButton);
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [lead, onClose, open]);

  if (!open || !lead) return null;

  const detailItems = [
    ["Campaign", lead.campaignName],
    ["Replied at Step", lead.step ? `Step ${lead.step}` : "No step"],
    ["Total Replies", formatNumber(lead.replyCount)],
    ["Gender", lead.lead.gender ?? "Unknown"],
    ["Created", formatDate(lead.addedDate, { day: "numeric", month: "short", year: "2-digit" })],
    ["Last Reply", lead.lastReplyDate ? formatDate(lead.lastReplyDate, { day: "numeric", month: "short" }) : "No reply"],
    ["Industry", lead.lead.industry ?? "Unknown"],
    ["Headcount", lead.lead.headcount_range ?? "Unknown"],
    ["Website", lead.lead.website ?? "Unknown"],
    ["Country", lead.lead.country ?? "Unknown"],
  ];
  const inlineReply = lead.lead.reply_text?.trim();

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
      <aside
        ref={drawerRef}
        id="lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-drawer-title"
        className="flex h-full w-full max-w-[620px] flex-col border-l border-[#242424] bg-[#070707] text-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#1f1f1f] p-6">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-500 text-lg font-medium">
              {lead.initials}
            </div>
            <div>
              <h2 id="lead-drawer-title" className="text-xl font-semibold">
                {lead.name}
              </h2>
              <p className="text-sm text-neutral-400">
                {lead.title} · {lead.company}
              </p>
              <div className="mt-3">
                <PipelineBadge stage={lead.stage} />
              </div>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close lead details"
            className="rounded-xl p-2 text-neutral-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-[#1f1f1f] p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Contact</p>
            <div className="space-y-3">
              <div className="rounded-2xl bg-[#111] px-4 py-4 text-base">{lead.email}</div>
              {lead.lead.linkedin_url ? (
                <a
                  href={lead.lead.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl bg-[#111] px-4 py-4 text-base text-blue-400 underline-offset-2 hover:underline"
                >
                  {lead.lead.linkedin_url}
                </a>
              ) : (
                <div className="rounded-2xl bg-[#111] px-4 py-4 text-base text-neutral-400">LinkedIn unavailable</div>
              )}
            </div>
          </section>

          <section className="border-b border-[#1f1f1f] p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Details</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {detailItems.map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-[#111] p-4">
                  <p className="text-sm text-neutral-400">{label}</p>
                  <p className="mt-2 text-sm text-white">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
              Conversation ({lead.replyCount})
            </p>
            {lead.replies.length === 0 && !inlineReply ? (
              <EmptyPortalState title="No conversation yet" description="Replies table is empty for this lead." />
            ) : (
              <div className="space-y-3">
                {inlineReply && (
                  <div className="rounded-2xl bg-[#111] p-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2 text-neutral-300">
                        <MessageSquare className="h-4 w-4 text-emerald-400" />
                        Inbound
                      </span>
                      <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400">Positive</span>
                    </div>
                    <p className="text-sm leading-6 text-white">{inlineReply}</p>
                  </div>
                )}
                {lead.replies.map((reply) => (
                  <div key={reply.id} className="rounded-2xl bg-[#111] p-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2 text-neutral-300">
                        <MessageSquare className="h-4 w-4 text-emerald-400" />
                        Step {reply.sequence_step ?? "n/a"}
                      </span>
                      <span className="text-neutral-400">{formatDate(reply.received_at, { day: "numeric", month: "short" })}</span>
                    </div>
                    <p className="text-sm leading-6 text-white">{reply.message_text ?? reply.classification ?? "No text"}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-[#1f1f1f] p-5">
          <button className="w-full rounded-2xl bg-white px-4 py-3 text-base font-medium text-black">
            Contact
          </button>
        </div>
      </aside>
    </div>
  );
}
