import type { ReactNode } from "react";
import { AlertCircle, ArrowRight, RefreshCcw } from "lucide-react";
import { cn } from "./ui/utils";

export function PageHeader({
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
      <div className="space-y-1">
        <h1 className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-white">{title}</h1>
        <p className="mt-3 text-base text-neutral-400">{subtitle}</p>
      </div>
      {actions}
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger";
  children: ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : tone === "danger"
        ? "border-red-500/30 bg-red-500/10 text-red-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", toneClass)}>
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Surface({
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-[#242424] bg-[#050505] p-6", className)}>
      {(title || actions) && (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-xl font-semibold tracking-[-0.02em] text-white">{title}</h3>}
            {subtitle && <p className="mt-2 text-sm text-neutral-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/20 bg-emerald-500/[0.06]"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/[0.06]"
        : tone === "info"
          ? "border-blue-500/20 bg-blue-500/[0.06]"
          : "border-[#242424] bg-[#080808]";
  return (
    <div className={cn("rounded-2xl border p-5", toneClass)}>
      <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-medium">{value}</p>
      <p className="mt-2 text-sm text-neutral-400">{hint}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#242424] bg-[#080808] px-5 py-12 text-center">
      <p className="text-base text-white">{title}</p>
      <p className="mt-2 text-sm text-neutral-500">{description}</p>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl border border-[#242424] bg-[#080808] px-4 py-3 text-sm text-neutral-400">
        <RefreshCcw className="h-4 w-4 animate-spin" />
        Loading workspace data
      </div>
    </div>
  );
}

export function InlineLinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-[#242424] px-3 py-1.5 text-sm text-neutral-400 transition hover:border-[#3a3a3a] hover:text-white"
    >
      {children}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}
