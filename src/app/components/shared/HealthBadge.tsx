import type { HealthStatus } from '../../data/schema';

const CFG: Record<HealthStatus, { label: string; dot: string; bg: string; text: string }> = {
  green:   { label: 'Green',   dot: 'bg-green-400',  bg: 'bg-green-500/10',   text: 'text-green-400' },
  yellow:  { label: 'Yellow',  dot: 'bg-yellow-400', bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
  red:     { label: 'Red',     dot: 'bg-red-400',    bg: 'bg-red-500/10',     text: 'text-red-400' },
  unknown: { label: 'Unknown', dot: 'bg-gray-500',   bg: 'bg-gray-500/10',    text: 'text-muted-foreground' },
};

export function HealthDot({ status }: { status: HealthStatus }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${CFG[status].dot}`} />;
}

export function HealthBadge({ status }: { status: HealthStatus }) {
  const c = CFG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs border ${c.bg} ${c.text} border-current/20`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export function HealthScore({ assessments }: { assessments: { ip_health: HealthStatus; domains_health: HealthStatus; warmup_health: HealthStatus; copy_health: HealthStatus; funnel_health: HealthStatus }[] }) {
  if (assessments.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const latest = assessments[0];
  const fields: HealthStatus[] = [latest.ip_health, latest.domains_health, latest.warmup_health, latest.copy_health, latest.funnel_health];
  const reds    = fields.filter(f => f === 'red').length;
  const yellows = fields.filter(f => f === 'yellow').length;
  if (reds >= 2) return <HealthBadge status="red" />;
  if (reds >= 1 || yellows >= 2) return <HealthBadge status="yellow" />;
  const unknowns = fields.filter(f => f === 'unknown').length;
  if (unknowns >= 3) return <HealthBadge status="unknown" />;
  return <HealthBadge status="green" />;
}

export function getOverallHealth(fields: HealthStatus[]): HealthStatus {
  const reds    = fields.filter(f => f === 'red').length;
  const yellows = fields.filter(f => f === 'yellow').length;
  const unknowns = fields.filter(f => f === 'unknown').length;
  if (reds >= 2) return 'red';
  if (reds >= 1 || yellows >= 2) return 'yellow';
  if (unknowns >= 3) return 'unknown';
  return 'green';
}
