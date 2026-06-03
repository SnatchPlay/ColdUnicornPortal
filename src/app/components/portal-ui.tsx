import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Calendar, MessageSquare, RefreshCcw, Search, X } from "lucide-react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "./ui/utils";
import { formatDate, formatNumber } from "../lib/format";
import { PIPELINE_STAGES, type PipelineStage } from "../lib/client-view-models";
import type { LeadRecord, ReplyRecord } from "../types/core";
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
  itemStyle: { color: "#f5f5f5" },
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
        <button className="inline-flex max-w-full items-center gap-3 rounded-xl border border-[#242424] bg-[#171717] px-3 py-2.5 text-sm text-white transition hover:border-[#3a3a3a] sm:px-4">
          <Calendar className="h-4 w-4 text-neutral-300" />
          <span className="truncate">{getTimeframeLabel(timeframe)}</span>
          <span className="text-neutral-500">⌄</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(20rem,calc(100vw-1rem))] rounded-2xl border-[#242424] bg-[#080808] p-4 text-white"
      >
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
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[30px] sm:leading-none">{title}</h1>
        <p className="mt-2 text-sm text-neutral-400 sm:mt-3 sm:text-base">{subtitle}</p>
      </div>
      {actions ? <div className="w-full sm:w-auto">{actions}</div> : null}
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
    <section className={cn("rounded-2xl border border-[#242424] bg-[#050505] p-4 sm:p-6", className)}>
      {(title || subtitle || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4 sm:mb-6">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold tracking-[-0.02em] text-white sm:text-xl">{title}</h2>}
            {subtitle && <p className="mt-2 text-sm text-neutral-400">{subtitle}</p>}
          </div>
          {actions ? <div className="w-full sm:w-auto">{actions}</div> : null}
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
      <p className="mt-5 text-2xl font-medium text-current sm:text-3xl">{value}</p>
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
  return <Tooltip {...PORTAL_CHART_TOOLTIP} cursor={false} />;
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

export interface LeadDrawerData {
  name: string;
  initials: string;
  email: string;
  title: string;
  company: string;
  stage: PipelineStage;
  campaignName: string;
  step: number | null;
  replyCount: number;
  lastReplyDate: string | null;
  addedDate: string;
  lead: LeadRecord;
  replies: ReplyRecord[];
}

function formatGender(gender: string | null) {
  if (!gender) return null;
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

function formatQualification(qualification: string | null) {
  if (!qualification) return "unqualified";
  return qualification.replace(/_/g, " ");
}

function formatWebsite(value: string | null) {
  if (!value) return null;
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function ensureUrl(value: string | null) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function FieldTile({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-[#111] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">{label}</p>
      <div className={cn("mt-2 text-sm text-white break-words", mono && "font-mono text-[13px]")}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">{children}</p>
  );
}

function YesNoPill({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        value ? "yes-pill" : "bg-neutral-500/10 text-neutral-400",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", value ? "yes-pill-dot" : "bg-neutral-500")} />
      {value ? "Yes" : "No"}
    </span>
  );
}

function ReplyClassificationBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-neutral-500">unclassified</span>;
  const tone =
    value === "Interested"   ? "reply-badge-interested" :
    value === "OOO"          ? "reply-badge-ooo" :
    value === "NRR"          ? "reply-badge-nrr" :
    value === "Left_Company" ? "reply-badge-left" :
    value === "Spam_Inbound" ? "reply-badge-spam" :
                               "reply-badge-neutral";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", tone)}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function LeadDrawer({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead: LeadDrawerData | null;
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
      <aside
        ref={drawerRef}
        id="lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-drawer-title"
        className="flex h-full w-full max-w-[640px] flex-col border-l border-[#242424] bg-[#070707] text-white shadow-2xl"
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PipelineBadge stage={lead.stage} />
                <span className="rounded-full bg-[#1a1a1a] px-2.5 py-1 text-xs uppercase tracking-wide text-neutral-300">
                  {formatQualification(lead.lead.qualification)}
                </span>
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
          <LeadDetailSections lead={lead} />
          <LeadConversation lead={lead} />
          <LeadMetaSection lead={lead.lead} />
        </div>
      </aside>
    </div>
  );
}

export function LeadDetailSections({ lead }: { lead: LeadDrawerData }) {
  const record = lead.lead;
  const websiteHref = ensureUrl(record.website);
  const websiteLabel = formatWebsite(record.website);
  return (
    <>
      <section className="border-b border-[#1f1f1f] p-6">
        <SectionLabel>Contact</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTile
            label="Email"
            value={
              record.email ? (
                <a href={`mailto:${record.email}`} className="text-blue-400 hover:underline">
                  {record.email}
                </a>
              ) : (
                <span className="text-neutral-500">—</span>
              )
            }
          />
          <FieldTile
            label={`Phone${record.phone_source ? ` · ${record.phone_source}` : ""}`}
            value={
              record.phone_number ? (
                <a href={`tel:${record.phone_number}`} className="text-blue-400 hover:underline">
                  {record.phone_number}
                </a>
              ) : (
                <span className="text-neutral-500">—</span>
              )
            }
          />
          <FieldTile
            label="LinkedIn"
            value={
              record.linkedin_url ? (
                <a
                  href={record.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-blue-400 hover:underline"
                >
                  {record.linkedin_url}
                </a>
              ) : (
                <span className="text-neutral-500">—</span>
              )
            }
          />
          <FieldTile
            label="Website"
            value={
              websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-blue-400 hover:underline"
                >
                  {websiteLabel}
                </a>
              ) : (
                <span className="text-neutral-500">—</span>
              )
            }
          />
        </div>
      </section>

      <section className="border-b border-[#1f1f1f] p-6">
        <SectionLabel>Profile</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTile label="Gender" value={formatGender(record.gender) ?? <span className="text-neutral-500">—</span>} />
          <FieldTile label="Country" value={record.country ?? <span className="text-neutral-500">—</span>} />
          <FieldTile label="Industry" value={record.industry ?? <span className="text-neutral-500">—</span>} />
          <FieldTile label="Headcount" value={record.headcount_range ?? <span className="text-neutral-500">—</span>} />
        </div>
      </section>

      <section className="border-b border-[#1f1f1f] p-6">
        <SectionLabel>Outreach</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTile label="Campaign" value={lead.campaignName} />
          <FieldTile
            label="Replied at step"
            value={lead.step ? `Step ${lead.step}` : <span className="text-neutral-500">No step</span>}
          />
          <FieldTile label="Total replies" value={formatNumber(lead.replyCount)} />
          <FieldTile
            label="Last reply"
            value={
              lead.lastReplyDate
                ? formatDate(lead.lastReplyDate, { day: "numeric", month: "short", year: "2-digit" })
                : <span className="text-neutral-500">No reply</span>
            }
          />
          <FieldTile
            label="Response time"
            value={
              record.response_time_label
                ?? (record.response_time_hours != null
                  ? `${formatNumber(record.response_time_hours)} h`
                  : <span className="text-neutral-500">—</span>)
            }
          />
          <FieldTile
            label="Message title"
            value={record.message_title ?? <span className="text-neutral-500">—</span>}
          />
        </div>
      </section>

      <section className="border-b border-[#1f1f1f] p-6">
        <SectionLabel>Pipeline state</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-2xl bg-[#111] p-4">
            <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Meeting booked</span>
            <YesNoPill value={record.meeting_booked} />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-[#111] p-4">
            <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Meeting held</span>
            <YesNoPill value={record.meeting_held} />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-[#111] p-4">
            <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Offer sent</span>
            <YesNoPill value={record.offer_sent} />
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-[#111] p-4">
            <span className="text-xs uppercase tracking-[0.14em] text-neutral-500">Won</span>
            <YesNoPill value={record.won} />
          </div>
          {record.qualification === "OOO" || record.added_to_ooo_campaign ? (
            <div className="sm:col-span-2 flex items-center justify-between rounded-2xl bg-[#111] p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">OOO return date</p>
                <p className="mt-2 text-sm text-white">
                  {record.expected_return_date
                    ? formatDate(record.expected_return_date, { day: "numeric", month: "short", year: "numeric" })
                    : <span className="text-neutral-500">unknown</span>}
                </p>
              </div>
              {record.added_to_ooo_campaign && (
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs text-amber-300">
                  In OOO campaign
                </span>
              )}
            </div>
          ) : null}
        </div>
        {record.comments && (
          <div className="mt-3 rounded-2xl bg-[#111] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-neutral-500">Comments</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white">{record.comments}</p>
          </div>
        )}
      </section>
    </>
  );
}

export function LeadConversation({ lead }: { lead: LeadDrawerData }) {
  const inlineReply = lead.lead.reply_text?.trim();
  const sortedReplies = lead.replies
    .slice()
    .sort((a, b) => b.received_at.localeCompare(a.received_at));
  return (
    <section className="border-b border-[#1f1f1f] p-6">
      <SectionLabel>Conversation ({lead.replyCount})</SectionLabel>
      {sortedReplies.length === 0 && !inlineReply ? (
        <EmptyPortalState title="No conversation yet" description="Replies table is empty for this lead." />
      ) : (
        <div className="space-y-3">
          {inlineReply && (
            <div className="rounded-2xl bg-[#111] p-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-neutral-300">
                  <MessageSquare className="h-4 w-4 text-emerald-400" />
                  Inline reply
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-white">{inlineReply}</p>
            </div>
          )}
          {sortedReplies.map((reply) => (
            <div key={reply.id} className="rounded-2xl bg-[#111] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-neutral-300">
                    <MessageSquare className="h-4 w-4 text-emerald-400" />
                    {reply.sequence_step ? `Step ${reply.sequence_step}` : "Inbound"}
                  </span>
                  <ReplyClassificationBadge value={reply.classification} />
                  {reply.language_detected && (
                    <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-400">
                      {reply.language_detected}
                    </span>
                  )}
                  {reply.is_automated_reply && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">auto</span>
                  )}
                  {reply.is_forwarded && (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">fwd</span>
                  )}
                </div>
                <span className="text-neutral-400">
                  {formatDate(reply.received_at, { day: "numeric", month: "short", year: "2-digit" })}
                </span>
              </div>
              {reply.message_subject && (
                <p className="mb-2 text-sm font-medium text-white">{reply.message_subject}</p>
              )}
              {reply.from_email_address && (
                <p className="mb-2 text-xs text-neutral-500">From {reply.from_email_address}</p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-6 text-white">
                {reply.message_text ?? <span className="text-neutral-500">No text</span>}
              </p>
              {reply.short_reason && (
                <p className="mt-3 rounded-xl bg-[#0a0a0a] p-3 text-xs leading-5 text-neutral-400">
                  <span className="font-medium text-neutral-300">Why: </span>
                  {reply.short_reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function LeadMetaSection({ lead }: { lead: LeadRecord }) {
  return (
    <section className="p-6">
      <SectionLabel>Meta</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldTile
          label="Created"
          value={formatDate(lead.created_at, { day: "numeric", month: "short", year: "numeric" })}
        />
        <FieldTile
          label="Updated"
          value={formatDate(lead.updated_at, { day: "numeric", month: "short", year: "numeric" })}
        />
        <FieldTile label="Source" value={lead.source || <span className="text-neutral-500">—</span>} />
        <FieldTile
          label="External ID"
          value={lead.external_id ?? <span className="text-neutral-500">—</span>}
          mono
        />
      </div>
    </section>
  );
}
