// Dropdown-driven Conditions Engine rule builder.
//
// Replaces the free-text power-user editor in settings-page.tsx. Every input
// is a constrained picker sourced from the metric catalog; the user cannot
// type a metric / surface / column key by hand and produce a silently-broken
// rule.
//
// Rule shape on the wire stays identical (`condition_rules` row, `branches`
// jsonb). The builder is a *constrained editor* over the same JSON: it only
// produces shapes the catalog can round-trip. For shapes outside the
// guided model (deep AND/OR nesting, metric paths not in the catalog),
// super_admin gets a Raw JSON tab; other roles see the rule read-only.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, X as XIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Checkbox } from "../../components/ui/checkbox";
import { cn } from "../../components/ui/utils";
import {
  BUILTIN_METRICS,
  CONDITION_SURFACES,
  OPERATORS_BY_VALUE_TYPE,
  SIMPLE_TRIGGER_KEY_PREFIX,
  buildCustomFieldMetrics,
  findMetricByPath,
  getCompatibleRightMetrics,
  getMetricsForSurface,
  supportsMetricRight,
  type ConditionSurface,
  type MetricDescriptor,
  type MetricValueType,
} from "../../lib/conditions/metric-catalog";
import { createDefaultBranch } from "../../lib/conditions/validation";
import { sortClientsAlpha } from "../../lib/selectors";
import type {
  ClientCustomFieldRecord,
  ClientRecord,
  UserRecord,
} from "../../types/core";
import type {
  ConditionBranch,
  ConditionComparisonNode,
  ConditionNode,
  ConditionOperator,
  ConditionRule,
  ConditionSeverity,
  ConditionValueRef,
} from "../../lib/conditions/types";

// ---------- helpers --------------------------------------------------------

const SEVERITY_OPTIONS: { id: ConditionSeverity; label: string; chip: string }[] = [
  { id: "good", label: "Good", chip: "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" },
  { id: "info", label: "Info", chip: "border-sky-400/40 bg-sky-500/15 text-sky-100" },
  { id: "warning", label: "Warning", chip: "border-amber-400/40 bg-amber-500/15 text-amber-100" },
  { id: "danger", label: "Danger", chip: "border-red-400/40 bg-red-500/15 text-red-100" },
  { id: "critical_over", label: "Critical", chip: "border-red-500/60 bg-red-600/30 text-red-50" },
];

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  eq: "equals",
  neq: "does not equal",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  is_blank: "is empty",
  not_blank: "is not empty",
  starts_with: "starts with",
  not_starts_with: "does not start with",
  in: "is one of",
  not_in: "is not one of",
};

const ACTIVE_BASE_FILTER: ConditionComparisonNode = {
  left: { metric: "client.status" },
  op: "eq",
  right: { value: "Active" },
};

function isActiveBaseFilter(node: ConditionNode | null | undefined): boolean {
  if (!node) return false;
  const comp = node as ConditionComparisonNode;
  return (
    comp?.left?.metric === "client.status" &&
    comp?.op === "eq" &&
    (comp?.right as ConditionValueRef)?.value === "Active"
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function autoKeyFor(metric: MetricDescriptor): string {
  return slugify(`${metric.surface.replace(/^clients_/, "")}-${metric.label}`);
}

function parseNumericValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface FlatCondition {
  kind: "single" | "all" | "any";
  rows: ConditionComparisonNode[];
}

/** Decompose a node into a flat list. Returns null when the node is too
 *  deep / not representable in the guided builder. */
function flattenWhen(node: ConditionNode | null | undefined): FlatCondition | null {
  if (!node) return null;
  if ("left" in node && "op" in node) {
    return { kind: "single", rows: [node as ConditionComparisonNode] };
  }
  if ("all" in node) {
    const rows = (node as { all: ConditionNode[] }).all;
    if (rows.every((r) => "left" in r && "op" in r)) {
      return { kind: "all", rows: rows as ConditionComparisonNode[] };
    }
    return null;
  }
  if ("any" in node) {
    const rows = (node as { any: ConditionNode[] }).any;
    if (rows.every((r) => "left" in r && "op" in r)) {
      return { kind: "any", rows: rows as ConditionComparisonNode[] };
    }
    return null;
  }
  return null;
}

function rebuildWhen(flat: FlatCondition): ConditionNode {
  if (flat.kind === "single" || flat.rows.length === 1) {
    return flat.rows[0] ?? { left: { metric: "" }, op: "eq", right: { value: 0 } };
  }
  return flat.kind === "all" ? { all: flat.rows } : { any: flat.rows };
}

/** True iff the entire rule can be opened in the guided builder. */
export function isGuidedRepresentable(
  rule: ConditionRule | null | undefined,
  customFields: readonly ClientCustomFieldRecord[],
): boolean {
  if (!rule) return false;
  if (rule.targetEntity !== "client") return false;
  if (rule.applyTo !== "cell" && rule.applyTo !== "row" && rule.applyTo !== "badge") return false;
  if (rule.surface === "clients_dod") return false;
  if (rule.baseFilter && !isActiveBaseFilter(rule.baseFilter)) return false;
  for (const branch of rule.branches) {
    const flat = flattenWhen(branch.when);
    if (!flat) return false;
    for (const row of flat.rows) {
      const path = typeof row.left?.metric === "string" ? row.left.metric : null;
      if (!path) return false;
      if (!findMetricByPath(path, customFields)) return false;
      // If the right side references a metric, that metric must also be in
      // the catalog (otherwise the visual picker cannot show it).
      const rightMetric = typeof row.right?.metric === "string" ? row.right.metric : null;
      if (rightMetric && !findMetricByPath(rightMetric, customFields)) return false;
    }
  }
  return true;
}

// ---------- the builder ---------------------------------------------------

export interface ConditionRuleBuilderProps {
  rule: ConditionRule;
  onChange: (next: ConditionRule) => void;
  errors: string[];
  clients: ClientRecord[];
  managers: UserRecord[];
  customFields: ClientCustomFieldRecord[];
  canSeeRaw: boolean;
  isNew: boolean;
}

export function ConditionRuleBuilder({
  rule,
  onChange,
  errors,
  clients,
  managers,
  customFields,
  canSeeRaw,
  isNew,
}: ConditionRuleBuilderProps) {
  const representable = useMemo(
    () => isGuidedRepresentable(rule, customFields),
    [rule, customFields],
  );

  const forceRaw = !representable;
  const initialMode: "visual" | "raw" = forceRaw ? "raw" : "visual";
  const [mode, setMode] = useState<"visual" | "raw">(initialMode);

  // If the rule swaps (selectedRuleId change) and stops being representable,
  // snap back to raw.
  useEffect(() => {
    if (forceRaw && mode !== "raw") setMode("raw");
  }, [forceRaw, mode]);

  return (
    <div className="space-y-4">
      {canSeeRaw ? (
        <Tabs value={mode} onValueChange={(v) => setMode(v as "visual" | "raw")}>
          <TabsList>
            <TabsTrigger value="visual" disabled={forceRaw}>
              Visual builder
            </TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="visual" className="mt-4">
            {forceRaw ? (
              <LegacyBanner />
            ) : (
              <GuidedBuilder
                rule={rule}
                onChange={onChange}
                errors={errors}
                clients={clients}
                managers={managers}
                customFields={customFields}
                isNew={isNew}
                canEditKey={true}
              />
            )}
          </TabsContent>
          <TabsContent value="raw" className="mt-4">
            <RawJsonEditor rule={rule} errors={errors} onChange={onChange} />
          </TabsContent>
        </Tabs>
      ) : forceRaw ? (
        <ReadOnlyRule rule={rule} />
      ) : (
        <GuidedBuilder
          rule={rule}
          onChange={onChange}
          errors={errors}
          clients={clients}
          managers={managers}
          customFields={customFields}
          isNew={isNew}
          canEditKey={false}
        />
      )}
    </div>
  );
}

// ---------- guided builder ------------------------------------------------

interface GuidedBuilderProps extends ConditionRuleBuilderProps {
  canEditKey: boolean;
}

function fieldError(errors: string[], prefix: string): string | undefined {
  return errors.find((e) => e.startsWith(prefix));
}

function GuidedBuilder({
  rule,
  onChange,
  errors,
  clients,
  managers,
  customFields,
  isNew,
  canEditKey,
}: GuidedBuilderProps) {
  const catalogForSurface = useMemo(
    () => getMetricsForSurface(rule.surface as ConditionSurface, customFields),
    [rule.surface, customFields],
  );
  const sortedClients = useMemo(() => sortClientsAlpha(clients), [clients]);
  const sortedManagers = useMemo(
    () =>
      managers
        .slice()
        .sort((l, r) =>
          `${l.first_name} ${l.last_name}`.localeCompare(`${r.first_name} ${r.last_name}`),
        ),
    [managers],
  );

  const primaryMetric = useMemo(
    () => findMetricByPath(rule.metricKey ?? "", customFields) ??
      findMetricByPath(`custom.${rule.columnKey?.replace(/^cf:/, "")}`, customFields) ??
      catalogForSurface[0] ??
      BUILTIN_METRICS[0],
    [rule.metricKey, rule.columnKey, customFields, catalogForSurface],
  );

  const onlyActive = isActiveBaseFilter(rule.baseFilter);
  const scopeKind: "global" | "client" | "manager" =
    rule.scopeType === "client" ? "client" : rule.scopeType === "manager" ? "manager" : "global";

  function patch(next: Partial<ConditionRule>) {
    onChange({ ...rule, ...next });
  }

  function selectMetric(metric: MetricDescriptor) {
    patch({
      surface: metric.surface,
      metricKey: metric.path,
      columnKey: metric.columnKey,
      applyTo: "cell",
      targetEntity: "client",
      // re-seed branches so the operator/value matches the new metric type
      branches: rule.branches.map((b) => seedBranchForMetric(b, metric)),
      // auto-fill name + key for brand-new rules
      ...(isNew && (!rule.name?.trim() || rule.name === "New rule")
        ? { name: metric.label }
        : {}),
      ...(isNew && (!rule.key?.trim() || rule.key === "rule.new")
        ? { key: autoKeyFor(metric) }
        : {}),
    });
  }

  // Build the grouped metric options once
  const metricOptions = useMemo(() => {
    const all = [...BUILTIN_METRICS, ...buildCustomFieldMetrics(customFields)];
    const bySurface = new Map<ConditionSurface, MetricDescriptor[]>();
    for (const m of all) {
      const list = bySurface.get(m.surface) ?? [];
      list.push(m);
      bySurface.set(m.surface, list);
    }
    return CONDITION_SURFACES.filter((s) => s.id !== "clients_dod" && bySurface.has(s.id)).map(
      (s) => ({ surface: s, metrics: bySurface.get(s.id) ?? [] }),
    );
  }, [customFields]);

  return (
    <div className="space-y-5">
      {/* --- Section 1: What to watch ----------------------------------- */}
      <section className="space-y-2 rounded-2xl border border-border bg-black/10 p-4">
        <header className="text-sm font-medium text-white">What to watch</header>
        <p className="text-xs text-muted-foreground">
          Pick a column or metric. This sets the section, the metric, and the cell to colour.
        </p>
        <Select
          value={primaryMetric.path}
          onValueChange={(v) => {
            const next = findMetricByPath(v, customFields);
            if (next) selectMetric(next);
          }}
        >
          <SelectTrigger className="mt-1 h-auto w-full rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
            <SelectValue placeholder="Choose a metric" />
          </SelectTrigger>
          <SelectContent className="max-h-96 rounded-xl border-[#242424] bg-[#050505] text-white">
            {metricOptions.map(({ surface, metrics }) => (
              <SelectGroup key={surface.id}>
                <SelectLabel className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {surface.label}
                </SelectLabel>
                {metrics.map((m) => (
                  <SelectItem
                    key={`${m.surface}:${m.path}`}
                    value={m.path}
                    className="text-white focus:bg-[#1a1a1a] focus:text-white"
                  >
                    {m.label}
                    {m.group === "Custom columns" ? (
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        custom
                      </span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Section: {CONDITION_SURFACES.find((s) => s.id === primaryMetric.surface)?.label}
          {primaryMetric.columnKey ? ` · Colours column "${primaryMetric.label}"` : " · No cell-level colouring"}
        </p>
      </section>

      {/* --- Section 2: Scope ------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
        <header className="text-sm font-medium text-white">Scope</header>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Apply to</span>
            <Select
              value={scopeKind}
              onValueChange={(v) =>
                patch({
                  scopeType: v as ConditionRule["scopeType"],
                  clientId: v === "client" ? rule.clientId ?? null : null,
                  managerId: v === "manager" ? rule.managerId ?? null : null,
                })
              }
            >
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value="global">All clients</SelectItem>
                <SelectItem value="client">One specific client</SelectItem>
                <SelectItem value="manager">One specific manager</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {scopeKind === "client" ? (
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</span>
              <Select
                value={rule.clientId ?? ""}
                onValueChange={(v) => patch({ clientId: v || null })}
              >
                <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  {sortedClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
          {scopeKind === "manager" ? (
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Manager</span>
              <Select
                value={rule.managerId ?? ""}
                onValueChange={(v) => patch({ managerId: v || null })}
              >
                <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                  <SelectValue placeholder="Select manager" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                  {sortedManagers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {`${u.first_name} ${u.last_name}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-200">
          <Checkbox
            checked={onlyActive}
            onCheckedChange={(checked) =>
              patch({ baseFilter: checked ? ACTIVE_BASE_FILTER : null })
            }
          />
          <span>Only apply to active clients (skip Inactive, On hold, Offboarding…)</span>
        </label>
      </section>

      {/* --- Section 3: Severity bands ---------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
        <header className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Severity bands</span>
          <button
            type="button"
            onClick={() =>
              patch({ branches: [...rule.branches, seedBranchForMetric(createDefaultBranch(), primaryMetric)] })
            }
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-[0.12em] text-sky-100 transition hover:bg-sky-500/20"
          >
            + Add band
          </button>
        </header>
        <p className="text-[10px] text-muted-foreground">
          Bands are checked top-to-bottom. First match wins. Drag with ↑/↓ to reorder.
        </p>
        <div className="space-y-3">
          {rule.branches.map((branch, index) => (
            <BandEditor
              key={index}
              metric={primaryMetric}
              customFields={customFields}
              branch={branch}
              index={index}
              total={rule.branches.length}
              errors={errors}
              onChange={(next) =>
                patch({
                  branches: rule.branches.map((b, i) => (i === index ? next : b)),
                })
              }
              onRemove={() =>
                patch({ branches: rule.branches.filter((_, i) => i !== index) })
              }
              onMove={(delta) => {
                const target = index + delta;
                if (target < 0 || target >= rule.branches.length) return;
                const next = rule.branches.slice();
                const [moved] = next.splice(index, 1);
                next.splice(target, 0, moved);
                patch({ branches: next });
              }}
            />
          ))}
        </div>
      </section>

      {/* --- Section 4: Meta -------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
        <header className="text-sm font-medium text-white">Rule details</header>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rule name</span>
            <input
              type="text"
              value={rule.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={cn(
                "w-full rounded-2xl border bg-black/20 px-4 py-3 text-sm outline-none",
                fieldError(errors, "name") ? "border-red-400/60" : "border-white/10",
              )}
            />
            {fieldError(errors, "name") ? (
              <span className="text-[10px] text-red-300">Required.</span>
            ) : null}
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Rule key {canEditKey ? "" : "(auto-generated)"}
            </span>
            <input
              type="text"
              value={rule.key}
              onChange={(e) => patch({ key: e.target.value })}
              disabled={!canEditKey}
              className={cn(
                "w-full rounded-2xl border bg-black/20 px-4 py-3 text-sm outline-none disabled:opacity-60",
                fieldError(errors, "key") ? "border-red-400/60" : "border-white/10",
              )}
            />
            {rule.key.startsWith(SIMPLE_TRIGGER_KEY_PREFIX) ? (
              <span className="text-[10px] text-amber-300">
                Keys starting with "{SIMPLE_TRIGGER_KEY_PREFIX}" are managed by Simple triggers — change before saving.
              </span>
            ) : null}
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-200">
          <Checkbox
            checked={rule.enabled}
            onCheckedChange={(checked) => patch({ enabled: Boolean(checked) })}
          />
          <span>Rule is enabled</span>
        </label>
      </section>
    </div>
  );
}

// ---------- band editor ---------------------------------------------------

function seedBranchForMetric(branch: ConditionBranch, metric: MetricDescriptor): ConditionBranch {
  const flat = flattenWhen(branch.when) ?? { kind: "single", rows: [] };
  // If the existing rows use a different metric path, re-seed all rows.
  const allMatch = flat.rows.every((r) => r.left?.metric === metric.path);
  if (allMatch && flat.rows.length > 0) return branch;
  const seeded: ConditionComparisonNode = {
    left: { metric: metric.path },
    op: metric.operators[0] ?? "eq",
    right: defaultRightForType(metric),
  };
  return { ...branch, when: rebuildWhen({ kind: "single", rows: [seeded] }) };
}

function defaultRightForType(metric: MetricDescriptor): ConditionValueRef | undefined {
  if (metric.valueType === "boolean") return { value: "true" };
  if (metric.valueType === "enum") return { value: metric.enumOptions?.[0] ?? "" };
  if (metric.valueType === "text") return { value: "" };
  return { value: 0 };
}

interface BandEditorProps {
  metric: MetricDescriptor;
  branch: ConditionBranch;
  index: number;
  total: number;
  errors: string[];
  customFields: ClientCustomFieldRecord[];
  onChange: (next: ConditionBranch) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}

function BandEditor({ metric, branch, index, total, errors, customFields, onChange, onRemove, onMove }: BandEditorProps) {
  const flat = useMemo(
    () => flattenWhen(branch.when) ?? { kind: "single" as const, rows: [] },
    [branch.when],
  );

  function patchBranch(next: Partial<ConditionBranch>) {
    onChange({ ...branch, ...next });
  }

  function patchFlat(nextFlat: FlatCondition) {
    onChange({ ...branch, when: rebuildWhen(nextFlat) });
  }

  function patchRow(rowIdx: number, next: ConditionComparisonNode) {
    const rows = flat.rows.slice();
    rows[rowIdx] = next;
    patchFlat({ ...flat, rows });
  }

  function addRow() {
    const seeded: ConditionComparisonNode = {
      left: { metric: metric.path },
      op: metric.operators[0] ?? "eq",
      right: defaultRightForType(metric),
    };
    const nextRows = [...flat.rows, seeded];
    patchFlat({ kind: flat.kind === "single" ? "all" : flat.kind, rows: nextRows });
  }

  function removeRow(rowIdx: number) {
    const rows = flat.rows.filter((_, i) => i !== rowIdx);
    if (rows.length <= 1) {
      patchFlat({ kind: "single", rows: rows.length ? rows : flat.rows.slice(0, 1) });
    } else {
      patchFlat({ ...flat, rows });
    }
  }

  const severityMeta = SEVERITY_OPTIONS.find((s) => s.id === branch.severity) ?? SEVERITY_OPTIONS[2];
  const labelErr = fieldError(errors, `branches[${index}].label`);
  const messageErr = fieldError(errors, `branches[${index}].message`);
  const whenErr = fieldError(errors, `branches[${index}].when`);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            #{index + 1} {index === 0 ? "(checked first)" : ""}
          </span>
          <div className="flex gap-1">
            {SEVERITY_OPTIONS.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => patchBranch({ severity: s.id })}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] transition",
                  branch.severity === s.id ? s.chip : "border-white/10 bg-transparent text-muted-foreground hover:text-white",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move band ${index + 1} up`}
            title="Move up"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/30 text-muted-foreground transition hover:border-white/30 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-black/30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move band ${index + 1} down`}
            title="Move down"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/30 text-muted-foreground transition hover:border-white/30 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-black/30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total <= 1}
            className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-red-100 disabled:opacity-30"
          >
            Remove
          </button>
        </div>
      </div>

      {flat.rows.length > 1 ? (
        <ToggleGroup
          type="single"
          value={flat.kind}
          onValueChange={(v) => {
            if (v === "all" || v === "any") patchFlat({ ...flat, kind: v });
          }}
          className="inline-flex rounded-xl border border-white/10 p-0.5"
        >
          <ToggleGroupItem value="all" className="px-2 py-1 text-[10px] uppercase tracking-[0.12em]">
            ALL of (AND)
          </ToggleGroupItem>
          <ToggleGroupItem value="any" className="px-2 py-1 text-[10px] uppercase tracking-[0.12em]">
            ANY of (OR)
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}

      <div className="space-y-2">
        {flat.rows.map((row, rowIdx) => (
          <ConditionRow
            key={rowIdx}
            metric={metric}
            customFields={customFields}
            row={row}
            onChange={(next) => patchRow(rowIdx, next)}
            onRemove={flat.rows.length > 1 ? () => removeRow(rowIdx) : undefined}
          />
        ))}
        <button
          type="button"
          onClick={addRow}
          className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-white"
        >
          + Add condition
        </button>
      </div>
      {whenErr ? <span className="text-[10px] text-red-300">{whenErr}</span> : null}

      <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Short label</span>
          <input
            type="text"
            value={branch.label}
            onChange={(e) => patchBranch({ label: e.target.value })}
            className={cn(
              "w-full rounded-xl border bg-black/20 px-3 py-2 text-xs outline-none",
              labelErr ? "border-red-400/60" : "border-white/10",
            )}
            placeholder={`${severityMeta.label} reason`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Tooltip message</span>
          <input
            type="text"
            value={branch.message}
            onChange={(e) => patchBranch({ message: e.target.value })}
            className={cn(
              "w-full rounded-xl border bg-black/20 px-3 py-2 text-xs outline-none",
              messageErr ? "border-red-400/60" : "border-white/10",
            )}
            placeholder="Shown on hover in the cell"
          />
        </label>
      </div>
    </div>
  );
}

// ---------- single condition row ------------------------------------------

interface ConditionRowProps {
  metric: MetricDescriptor;
  customFields: ClientCustomFieldRecord[];
  row: ConditionComparisonNode;
  onChange: (next: ConditionComparisonNode) => void;
  onRemove?: () => void;
}

function ConditionRow({ metric, customFields, row, onChange, onRemove }: ConditionRowProps) {
  const op = row.op;
  const requiresRight = op !== "is_blank" && op !== "not_blank";
  const rightIsMetric = typeof row.right?.metric === "string";
  const metricModeAllowed = supportsMetricRight(metric, op);

  function patchOp(nextOp: ConditionOperator) {
    let nextRight: ConditionValueRef | undefined = row.right;
    const stillSupportsMetric = supportsMetricRight(metric, nextOp);

    if (nextOp === "is_blank" || nextOp === "not_blank") {
      nextRight = undefined;
    } else if (nextOp === "between") {
      // between doesn't combine with metric-on-right — fall back to a numeric pair
      nextRight = { value: [parseNumericValue(row.right?.value) ?? 0, 0] };
    } else if (nextOp === "in" || nextOp === "not_in") {
      nextRight = { value: Array.isArray(row.right?.value) ? row.right!.value : [] };
    } else if (rightIsMetric && !stillSupportsMetric) {
      nextRight = defaultRightForType(metric);
    } else if (!row.right) {
      nextRight = defaultRightForType(metric);
    } else if (Array.isArray(row.right.value) && metric.valueType !== "enum") {
      nextRight = defaultRightForType(metric);
    }
    onChange({ ...row, op: nextOp, right: nextRight });
  }

  function setCompareMode(mode: "value" | "metric") {
    if (mode === "metric") {
      // pick the first compatible metric as a sensible default
      const candidates = getCompatibleRightMetrics(metric, customFields);
      const first = candidates[0];
      onChange({
        ...row,
        right: first
          ? { metric: first.path }
          : defaultRightForType(metric),
      });
    } else {
      onChange({ ...row, right: defaultRightForType(metric) });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">When</span>
      <Select value={op} onValueChange={(v) => patchOp(v as ConditionOperator)}>
        <SelectTrigger className="h-auto rounded-xl border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
          {metric.operators.map((o) => (
            <SelectItem key={o} value={o}>{OPERATOR_LABEL[o]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {requiresRight && metricModeAllowed ? (
        <Select
          value={rightIsMetric ? "metric" : "value"}
          onValueChange={(v) => setCompareMode(v as "value" | "metric")}
        >
          <SelectTrigger className="h-auto rounded-xl border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
            <SelectItem value="value">a fixed value</SelectItem>
            <SelectItem value="metric">another metric</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {requiresRight ? (
        <div className="min-w-[12rem] flex-1">
          <RightValueInput
            metric={metric}
            customFields={customFields}
            op={op}
            value={row.right}
            onChange={(v) => onChange({ ...row, right: v })}
          />
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">(no value needed)</span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this condition"
          title="Remove condition"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-black/30 text-muted-foreground transition hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-200"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ---------- right-side value input ----------------------------------------

interface RightValueInputProps {
  metric: MetricDescriptor;
  customFields: ClientCustomFieldRecord[];
  op: ConditionOperator;
  value: ConditionValueRef | undefined;
  onChange: (next: ConditionValueRef) => void;
}

function RightValueInput({ metric, customFields, op, value, onChange }: RightValueInputProps) {
  const raw = value?.value;
  const rightMetricPath = typeof value?.metric === "string" ? value.metric : null;

  // Metric-on-right mode: render compatible-metric picker + optional multiplier
  if (rightMetricPath !== null) {
    const compatible = getCompatibleRightMetrics(metric, customFields);
    const currentMultiplier = typeof value?.multiplier === "number" ? value.multiplier : null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={rightMetricPath}
          onValueChange={(v) =>
            onChange({
              ...value,
              metric: v,
              value: undefined,
            } as ConditionValueRef)
          }
        >
          <SelectTrigger className="h-auto min-w-[12rem] rounded-xl border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white">
            <SelectValue placeholder="pick metric" />
          </SelectTrigger>
          <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
            {compatible.map((m) => (
              <SelectItem key={m.path} value={m.path}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">×</span>
        <input
          type="number"
          step="0.01"
          value={currentMultiplier ?? ""}
          placeholder="1"
          onChange={(e) => {
            const next = e.target.value === "" ? null : Number(e.target.value);
            const ref: ConditionValueRef = {
              metric: rightMetricPath,
              ...(next === null || !Number.isFinite(next) ? {} : { multiplier: next }),
            };
            onChange(ref);
          }}
          className="w-20 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs outline-none"
        />
        <span className="text-[10px] text-muted-foreground">(blank = 1× ; 0.8 = 80% of)</span>
      </div>
    );
  }

  // Between (numeric) — two inputs
  if (op === "between") {
    const arr = Array.isArray(raw) ? raw : [0, 0];
    const [a, b] = arr;
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={typeof a === "number" ? a : ""}
          onChange={(e) =>
            onChange({ value: [Number(e.target.value), typeof b === "number" ? b : 0] })
          }
          className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs outline-none"
        />
        <span className="text-xs text-muted-foreground">and</span>
        <input
          type="number"
          value={typeof b === "number" ? b : ""}
          onChange={(e) =>
            onChange({ value: [typeof a === "number" ? a : 0, Number(e.target.value)] })
          }
          className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs outline-none"
        />
      </div>
    );
  }

  // Enum (in / not_in) — multi-select via checkboxes
  if ((op === "in" || op === "not_in") && metric.valueType === "enum") {
    const selected = new Set(Array.isArray(raw) ? raw.map(String) : []);
    return (
      <div className="flex flex-wrap gap-1">
        {(metric.enumOptions ?? []).map((opt) => {
          const isOn = selected.has(opt);
          return (
            <button
              type="button"
              key={opt}
              onClick={() => {
                const next = new Set(selected);
                if (isOn) next.delete(opt);
                else next.add(opt);
                onChange({ value: Array.from(next) });
              }}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
                isOn ? "border-sky-400/40 bg-sky-500/15 text-sky-100" : "border-white/10 text-muted-foreground hover:text-white",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  // Boolean — yes/no
  if (metric.valueType === "boolean") {
    const isTrue = String(raw) === "true";
    return (
      <ToggleGroup
        type="single"
        value={isTrue ? "true" : "false"}
        onValueChange={(v) => onChange({ value: v === "true" ? "true" : "false" })}
        className="inline-flex rounded-xl border border-white/10 p-0.5"
      >
        <ToggleGroupItem value="true" className="px-2 py-1 text-[10px] uppercase">Yes / checked</ToggleGroupItem>
        <ToggleGroupItem value="false" className="px-2 py-1 text-[10px] uppercase">No / unchecked</ToggleGroupItem>
      </ToggleGroup>
    );
  }

  // Enum (eq / neq) — single Select
  if (metric.valueType === "enum") {
    return (
      <Select value={String(raw ?? "")} onValueChange={(v) => onChange({ value: v })}>
        <SelectTrigger className="h-auto rounded-xl border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white">
          <SelectValue placeholder="pick option" />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
          {(metric.enumOptions ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Text — text input
  if (metric.valueType === "text") {
    return (
      <input
        type="text"
        value={typeof raw === "string" ? raw : ""}
        onChange={(e) => onChange({ value: e.target.value })}
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs outline-none"
        placeholder="text to compare"
      />
    );
  }

  // Numeric / percent fallback
  const numericValue = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={Number.isFinite(numericValue) ? numericValue : ""}
        onChange={(e) => onChange({ value: Number(e.target.value) })}
        className="w-32 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs outline-none"
      />
      {metric.valueType === "percent" ? (
        <span className="text-[10px] text-muted-foreground">(0.05 = 5%)</span>
      ) : null}
    </div>
  );
}

// ---------- raw JSON editor (super_admin) ---------------------------------

interface RawJsonEditorProps {
  rule: ConditionRule;
  errors: string[];
  onChange: (next: ConditionRule) => void;
}

function RawJsonEditor({ rule, errors, onChange }: RawJsonEditorProps) {
  const [text, setText] = useState(() => JSON.stringify(rule, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  // Resync when an outer prop change replaces the rule (e.g. new selection).
  // Intentionally keyed on `rule.id` only — we do NOT want every keystroke
  // in the visual builder to wipe the local textarea draft.
  useEffect(() => {
    setText(JSON.stringify(rule, null, 2));
    setParseError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.id]);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        Edit the raw JSON of this rule. Validation runs on blur. Changes are committed when JSON parses cleanly.
      </p>
      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object") {
              onChange(parsed as ConditionRule);
              setParseError(null);
            }
          } catch (err) {
            setParseError(err instanceof Error ? err.message : String(err));
          }
        }}
        className="h-[28rem] w-full rounded-2xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-neutral-200 outline-none"
      />
      {parseError ? (
        <p className="text-[11px] text-red-300">JSON error: {parseError}</p>
      ) : null}
      {errors.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-amber-300">
          {errors.slice(0, 10).map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------- legacy banner + read-only --------------------------------------

function LegacyBanner() {
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      This rule uses an advanced structure (deep AND/OR, unknown metric, or a non-cell apply target).
      Editing is available in <span className="font-medium">Raw JSON</span> mode.
    </div>
  );
}

function ReadOnlyRule({ rule }: { rule: ConditionRule }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        This rule uses an advanced structure that the visual builder cannot represent. Ask engineering to
        edit it in raw mode.
      </div>
      <pre className="max-h-96 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] text-neutral-300">
        {JSON.stringify(rule, null, 2)}
      </pre>
    </div>
  );
}
