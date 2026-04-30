import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Banner, EmptyState, PageHeader, Surface } from "../components/app-ui";
import { Badge } from "../components/ui/badge";
import { cn } from "../components/ui/utils";
import {
  createDefaultBranch,
  createDefaultComparisonNode,
  validateConditionRule,
} from "../lib/conditions/validation";
import {
  fromConditionRule,
  toConditionRule,
} from "../lib/conditions/mapper";
import type {
  ConditionApplyTo,
  ConditionBranch,
  ConditionNode,
  ConditionOperator,
  ConditionRule,
  ConditionScopeType,
  ConditionSeverity,
  ConditionTargetEntity,
  ConditionTransform,
  ConditionValueRef,
} from "../lib/conditions/types";
import { getRoleLabel } from "../lib/selectors";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";

interface SettingsMessage {
  tone: "info" | "warning" | "danger";
  text: string;
}

interface NodeEditorProps {
  node: ConditionNode;
  onChange: (next: ConditionNode) => void;
  onRemove?: () => void;
  depth?: number;
}

const OPERATOR_OPTIONS: ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_blank",
  "not_blank",
  "starts_with",
  "not_starts_with",
  "in",
  "not_in",
];

const SEVERITY_OPTIONS: ConditionSeverity[] = ["good", "info", "warning", "danger", "critical_over"];
const APPLY_TO_OPTIONS: ConditionApplyTo[] = ["cell", "row", "badge", "section"];
const TARGET_OPTIONS: ConditionTargetEntity[] = ["client", "campaign", "lead"];
const SCOPE_OPTIONS: ConditionScopeType[] = ["global", "manager", "client"];
const TRANSFORM_OPTIONS: ConditionTransform[] = ["lower", "upper", "trim", "abs", "round"];
const UNARY_OPERATORS: ConditionOperator[] = ["is_blank", "not_blank"];

function emptyRule(createdBy: string | null): ConditionRule {
  const now = new Date().toISOString();
  return {
    id: "draft",
    key: "",
    name: "",
    description: null,
    targetEntity: "client",
    surface: "clients_overview",
    metricKey: "",
    sourceSheet: "CS PDCA",
    sourceRange: null,
    scopeType: "global",
    clientId: null,
    managerId: null,
    applyTo: "cell",
    columnKey: null,
    branches: [createDefaultBranch()],
    baseFilter: null,
    priority: 100,
    enabled: true,
    notes: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ruleSeveritySummary(rule: ConditionRule) {
  return Array.from(new Set(rule.branches.map((branch) => branch.severity))).join(", ");
}

function toCreateRulePayload(rule: ConditionRule) {
  const record = fromConditionRule(rule);
  return {
    key: record.key,
    name: record.name,
    description: record.description,
    target_entity: record.target_entity,
    surface: record.surface,
    metric_key: record.metric_key,
    source_sheet: record.source_sheet,
    source_range: record.source_range,
    scope_type: record.scope_type,
    client_id: record.client_id,
    manager_id: record.manager_id,
    apply_to: record.apply_to,
    column_key: record.column_key,
    branches: record.branches,
    base_filter: record.base_filter,
    priority: record.priority,
    enabled: record.enabled,
    notes: record.notes,
    created_by: record.created_by,
  };
}

function toUpdateRulePatch(rule: ConditionRule) {
  const record = fromConditionRule(rule);
  return {
    key: record.key,
    name: record.name,
    description: record.description,
    target_entity: record.target_entity,
    surface: record.surface,
    metric_key: record.metric_key,
    source_sheet: record.source_sheet,
    source_range: record.source_range,
    scope_type: record.scope_type,
    client_id: record.client_id,
    manager_id: record.manager_id,
    apply_to: record.apply_to,
    column_key: record.column_key,
    branches: record.branches,
    base_filter: record.base_filter,
    priority: record.priority,
    enabled: record.enabled,
    notes: record.notes,
  };
}

function ValueRefEditor({
  label,
  valueRef,
  onChange,
  allowValue = true,
}: {
  label: string;
  valueRef: ConditionValueRef;
  onChange: (next: ConditionValueRef) => void;
  allowValue?: boolean;
}) {
  const mode = valueRef.metric ? "metric" : "value";
  const setMode = (nextMode: "metric" | "value") => {
    if (nextMode === "metric") {
      onChange({ metric: valueRef.metric ?? "", multiplier: valueRef.multiplier, transform: valueRef.transform });
      return;
    }
    onChange({ value: valueRef.value ?? "", multiplier: valueRef.multiplier, transform: valueRef.transform });
  };

  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      {allowValue && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("metric")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              mode === "metric" ? "border-sky-300/40 bg-sky-500/15 text-sky-100" : "border-border text-muted-foreground",
            )}
          >
            Metric
          </button>
          <button
            type="button"
            onClick={() => setMode("value")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              mode === "value" ? "border-sky-300/40 bg-sky-500/15 text-sky-100" : "border-border text-muted-foreground",
            )}
          >
            Value
          </button>
        </div>
      )}
      {mode === "metric" ? (
        <input
          value={valueRef.metric ?? ""}
          onChange={(event) => onChange({ ...valueRef, metric: event.target.value })}
          placeholder="metric.path"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        />
      ) : (
        <input
          value={typeof valueRef.value === "string" || typeof valueRef.value === "number" ? String(valueRef.value) : ""}
          onChange={(event) => onChange({ ...valueRef, value: event.target.value })}
          placeholder="static value"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        />
      )}
      <div className="grid gap-2 md:grid-cols-2">
        <input
          value={valueRef.multiplier ?? ""}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ ...valueRef, multiplier: Number.isFinite(parsed) ? parsed : undefined });
          }}
          placeholder="multiplier (optional)"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        />
        <select
          value={valueRef.transform ?? ""}
          onChange={(event) =>
            onChange({
              ...valueRef,
              transform: event.target.value ? (event.target.value as ConditionTransform) : undefined,
            })
          }
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        >
          <option value="">no transform</option>
          {TRANSFORM_OPTIONS.map((transform) => (
            <option key={transform} value={transform}>
              {transform}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ConditionNodeEditor({ node, onChange, onRemove, depth = 0 }: NodeEditorProps) {
  const nodeType: "comparison" | "all" | "any" = "all" in node ? "all" : "any" in node ? "any" : "comparison";
  const isComparison = nodeType === "comparison";
  const comparison = isComparison ? node : null;

  return (
    <div className={cn("space-y-3 rounded-xl border border-white/10 p-3", depth > 0 ? "bg-black/20" : "bg-black/10")}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={nodeType}
          onChange={(event) => {
            const next = event.target.value as "comparison" | "all" | "any";
            if (next === "comparison") {
              onChange(createDefaultComparisonNode());
              return;
            }
            onChange(next === "all" ? { all: [createDefaultComparisonNode()] } : { any: [createDefaultComparisonNode()] });
          }}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-muted-foreground outline-none"
        >
          <option value="comparison">comparison</option>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-100"
          >
            Remove
          </button>
        )}
      </div>

      {isComparison && comparison ? (
        <div className="space-y-3">
          <ValueRefEditor
            label="Left operand"
            valueRef={comparison.left}
            onChange={(left) => onChange({ ...comparison, left })}
          />
          <select
            value={comparison.op}
            onChange={(event) => {
              const op = event.target.value as ConditionOperator;
              const next = { ...comparison, op };
              if (UNARY_OPERATORS.includes(op)) {
                delete next.right;
              } else if (!next.right) {
                next.right = { value: "" };
              }
              onChange(next);
            }}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
          >
            {OPERATOR_OPTIONS.map((operator) => (
              <option key={operator} value={operator}>
                {operator}
              </option>
            ))}
          </select>
          {!UNARY_OPERATORS.includes(comparison.op) && (
            <ValueRefEditor
              label="Right operand"
              valueRef={comparison.right ?? { value: "" }}
              onChange={(right) => onChange({ ...comparison, right })}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {("all" in node ? node.all : node.any).map((child, index) => (
            <ConditionNodeEditor
              key={index}
              node={child}
              depth={depth + 1}
              onChange={(nextChild) => {
                if ("all" in node) {
                  const nextChildren = node.all.slice();
                  nextChildren[index] = nextChild;
                  onChange({ all: nextChildren });
                } else {
                  const nextChildren = node.any.slice();
                  nextChildren[index] = nextChild;
                  onChange({ any: nextChildren });
                }
              }}
              onRemove={() => {
                if ("all" in node) {
                  const nextChildren = node.all.filter((_, currentIndex) => currentIndex !== index);
                  onChange({ all: nextChildren.length > 0 ? nextChildren : [createDefaultComparisonNode()] });
                } else {
                  const nextChildren = node.any.filter((_, currentIndex) => currentIndex !== index);
                  onChange({ any: nextChildren.length > 0 ? nextChildren : [createDefaultComparisonNode()] });
                }
              }}
            />
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if ("all" in node) {
                  onChange({ all: node.all.concat(createDefaultComparisonNode()) });
                } else {
                  onChange({ any: node.any.concat(createDefaultComparisonNode()) });
                }
              }}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-muted-foreground"
            >
              Add comparison
            </button>
            <button
              type="button"
              onClick={() => {
                const groupNode: ConditionNode = { all: [createDefaultComparisonNode()] };
                if ("all" in node) {
                  onChange({ all: node.all.concat(groupNode) });
                } else {
                  onChange({ any: node.any.concat(groupNode) });
                }
              }}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-muted-foreground"
            >
              Add group
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchEditor({
  branch,
  onChange,
  onRemove,
}: {
  branch: ConditionBranch;
  onChange: (next: ConditionBranch) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={branch.severity}
          onChange={(event) => onChange({ ...branch, severity: event.target.value as ConditionSeverity })}
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
        >
          {SEVERITY_OPTIONS.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-100">
          Remove branch
        </button>
      </div>

      <input
        value={branch.label}
        onChange={(event) => onChange({ ...branch, label: event.target.value })}
        placeholder="Branch label"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
      />

      <textarea
        value={branch.message}
        onChange={(event) => onChange({ ...branch, message: event.target.value })}
        rows={2}
        placeholder="Branch message"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
      />

      <ConditionNodeEditor node={branch.when} onChange={(when) => onChange({ ...branch, when })} />
    </div>
  );
}

export function SettingsPage() {
  const {
    actorIdentity,
    identity,
    session,
    error,
    isImpersonating,
    updateProfileName,
    updatePassword,
    requestPasswordReset,
    signOut,
  } = useAuth();
  const {
    conditionRules,
    createConditionRule,
    updateConditionRule,
    deleteConditionRule,
  } = useCoreData();
  const [displayName, setDisplayName] = useState(identity?.fullName ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState(identity?.email ?? "");
  const [message, setMessage] = useState<SettingsMessage | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSendingResetLink, setIsSendingResetLink] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleSurfaceFilter, setRuleSurfaceFilter] = useState("all");
  const [ruleEnabledFilter, setRuleEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [selectedRuleId, setSelectedRuleId] = useState<string | "new" | null>(null);
  const [ruleEditor, setRuleEditor] = useState<ConditionRule | null>(null);
  const [ruleErrors, setRuleErrors] = useState<string[]>([]);
  const [ruleMessage, setRuleMessage] = useState<SettingsMessage | null>(null);
  const [isSavingRule, setIsSavingRule] = useState(false);

  const normalizedName = useMemo(() => displayName.trim().replace(/\s+/g, " "), [displayName]);
  const isNameDirty = useMemo(() => normalizedName !== identity?.fullName.trim(), [identity?.fullName, normalizedName]);
  const nameValidationError = useMemo(() => {
    if (!normalizedName) return "Name cannot be empty.";
    if (normalizedName.length < 2) return "Name is too short.";
    return null;
  }, [normalizedName]);

  const validationError = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (password.length < 8) return "Use at least 8 characters for the new password.";
    if (password !== confirmPassword) return "Password confirmation does not match.";
    return null;
  }, [confirmPassword, password]);

  const canManageConditionRules = identity?.role === "admin" || identity?.role === "super_admin";
  const normalizedRules = useMemo(() => conditionRules.map(toConditionRule), [conditionRules]);
  const availableSurfaces = useMemo(
    () => Array.from(new Set(normalizedRules.map((rule) => rule.surface))).sort(),
    [normalizedRules],
  );
  const filteredRules = useMemo(() => {
    const search = ruleSearch.trim().toLowerCase();
    return normalizedRules.filter((rule) => {
      if (ruleSurfaceFilter !== "all" && rule.surface !== ruleSurfaceFilter) return false;
      if (ruleEnabledFilter === "enabled" && !rule.enabled) return false;
      if (ruleEnabledFilter === "disabled" && rule.enabled) return false;
      if (!search) return true;
      return (
        rule.key.toLowerCase().includes(search) ||
        rule.name.toLowerCase().includes(search) ||
        rule.metricKey.toLowerCase().includes(search)
      );
    });
  }, [normalizedRules, ruleEnabledFilter, ruleSearch, ruleSurfaceFilter]);

  useEffect(() => {
    setDisplayName(identity?.fullName ?? "");
    setRecoveryEmail(identity?.email ?? "");
  }, [identity?.email, identity?.fullName]);

  useEffect(() => {
    if (!canManageConditionRules) {
      setSelectedRuleId(null);
      setRuleEditor(null);
      setRuleErrors([]);
      return;
    }
    if (selectedRuleId === "new") {
      setRuleEditor(emptyRule(identity?.id ?? null));
      return;
    }
    if (!selectedRuleId) {
      setRuleEditor(null);
      return;
    }
    const selected = normalizedRules.find((rule) => rule.id === selectedRuleId) ?? null;
    setRuleEditor(selected ? deepClone(selected) : null);
  }, [canManageConditionRules, identity?.id, normalizedRules, selectedRuleId]);

  useEffect(() => {
    if (!ruleEditor) {
      setRuleErrors([]);
      return;
    }
    setRuleErrors(validateConditionRule(ruleEditor));
  }, [ruleEditor]);

  if (!identity) {
    return (
      <EmptyState
        title="No identity loaded"
        description="Sign in with a Supabase-linked user to open the settings workspace."
      />
    );
  }

  const showIdentityCard = identity.role !== "client";
  const showResetLinkControl = identity.role !== "client";

  async function handleUpdatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationError) {
      setMessage({ tone: "warning", text: validationError });
      return;
    }

    setIsSavingPassword(true);
    const result = await updatePassword(password);
    setMessage({ tone: result.ok ? "info" : "danger", text: result.message });
    setIsSavingPassword(false);

    if (result.ok) {
      setPassword("");
      setConfirmPassword("");
    }
  }

  async function handleUpdateProfileName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nameValidationError) {
      setMessage({ tone: "warning", text: nameValidationError });
      return;
    }
    if (!isNameDirty) {
      setMessage({ tone: "info", text: "Profile name is already up to date." });
      return;
    }

    setIsSavingProfile(true);
    const result = await updateProfileName(normalizedName);
    setMessage({ tone: result.ok ? "info" : "danger", text: result.message });
    setIsSavingProfile(false);
  }

  async function handleSendResetLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = recoveryEmail.trim();
    if (!email) {
      setMessage({ tone: "warning", text: "Enter an account email before sending a reset link." });
      return;
    }

    setIsSendingResetLink(true);
    const result = await requestPasswordReset(email);
    setMessage({ tone: result.ok ? "info" : "danger", text: result.message });
    setIsSendingResetLink(false);
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    setIsSigningOut(false);
  }

  async function handleQuickToggle(rule: ConditionRule) {
    await updateConditionRule(rule.id, { enabled: !rule.enabled });
  }

  async function handleQuickPriority(rule: ConditionRule, nextPriority: number) {
    if (!Number.isFinite(nextPriority)) return;
    await updateConditionRule(rule.id, { priority: nextPriority });
  }

  async function handleSaveRule() {
    if (!ruleEditor) return;
    const errors = validateConditionRule(ruleEditor);
    setRuleErrors(errors);
    if (errors.length > 0) {
      setRuleMessage({ tone: "warning", text: "Resolve validation errors before saving." });
      return;
    }

    setIsSavingRule(true);
    setRuleMessage(null);
    try {
      if (selectedRuleId === "new") {
        await createConditionRule(toCreateRulePayload(ruleEditor));
        setRuleMessage({ tone: "info", text: "Condition rule created." });
      } else {
        await updateConditionRule(ruleEditor.id, toUpdateRulePatch(ruleEditor));
        setRuleMessage({ tone: "info", text: "Condition rule updated." });
      }
    } catch {
      setRuleMessage({ tone: "danger", text: "Could not save rule. Check permissions and validation." });
    } finally {
      setIsSavingRule(false);
    }
  }

  async function handleDeleteRule() {
    if (!ruleEditor || selectedRuleId === "new") return;
    setIsSavingRule(true);
    try {
      await deleteConditionRule(ruleEditor.id);
      setRuleMessage({ tone: "info", text: "Condition rule deleted." });
      setSelectedRuleId(null);
      setRuleEditor(null);
    } catch {
      setRuleMessage({ tone: "danger", text: "Could not delete rule." });
    } finally {
      setIsSavingRule(false);
    }
  }

  function renderRuleEditor() {
    if (!ruleEditor) {
      return (
        <EmptyState
          title="No rule selected"
          description="Select an existing rule or create a new one."
        />
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rule key</span>
            <input
              value={ruleEditor.key}
              onChange={(event) => setRuleEditor({ ...ruleEditor, key: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rule name</span>
            <input
              value={ruleEditor.name}
              onChange={(event) => setRuleEditor({ ...ruleEditor, name: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Surface</span>
            <input
              value={ruleEditor.surface}
              onChange={(event) => setRuleEditor({ ...ruleEditor, surface: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Metric key</span>
            <input
              value={ruleEditor.metricKey}
              onChange={(event) => setRuleEditor({ ...ruleEditor, metricKey: event.target.value })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Target entity</span>
            <select
              value={ruleEditor.targetEntity}
              onChange={(event) => setRuleEditor({ ...ruleEditor, targetEntity: event.target.value as ConditionTargetEntity })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            >
              {TARGET_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Apply to</span>
            <select
              value={ruleEditor.applyTo}
              onChange={(event) => setRuleEditor({ ...ruleEditor, applyTo: event.target.value as ConditionApplyTo })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            >
              {APPLY_TO_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Scope type</span>
            <select
              value={ruleEditor.scopeType}
              onChange={(event) => setRuleEditor({ ...ruleEditor, scopeType: event.target.value as ConditionScopeType })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Priority</span>
            <input
              type="number"
              value={ruleEditor.priority}
              onChange={(event) =>
                setRuleEditor({
                  ...ruleEditor,
                  priority: Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : 100,
                })
              }
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Column key</span>
            <input
              value={ruleEditor.columnKey ?? ""}
              onChange={(event) => setRuleEditor({ ...ruleEditor, columnKey: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Source sheet</span>
            <input
              value={ruleEditor.sourceSheet ?? ""}
              onChange={(event) => setRuleEditor({ ...ruleEditor, sourceSheet: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Source range</span>
            <input
              value={ruleEditor.sourceRange ?? ""}
              onChange={(event) => setRuleEditor({ ...ruleEditor, sourceRange: event.target.value || null })}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
            />
          </label>
        </div>

        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Description</span>
          <textarea
            rows={2}
            value={ruleEditor.description ?? ""}
            onChange={(event) => setRuleEditor({ ...ruleEditor, description: event.target.value || null })}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Notes</span>
          <textarea
            rows={2}
            value={ruleEditor.notes ?? ""}
            onChange={(event) => setRuleEditor({ ...ruleEditor, notes: event.target.value || null })}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ruleEditor.enabled}
            onChange={(event) => setRuleEditor({ ...ruleEditor, enabled: event.target.checked })}
          />
          Rule enabled
        </label>

        <div className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm">Branches</p>
            <button
              type="button"
              onClick={() => setRuleEditor({ ...ruleEditor, branches: ruleEditor.branches.concat(createDefaultBranch()) })}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-muted-foreground"
            >
              Add branch
            </button>
          </div>
          {ruleEditor.branches.map((branch, index) => (
            <BranchEditor
              key={index}
              branch={branch}
              onChange={(next) => {
                const branches = ruleEditor.branches.slice();
                branches[index] = next;
                setRuleEditor({ ...ruleEditor, branches });
              }}
              onRemove={() => {
                const branches = ruleEditor.branches.filter((_, currentIndex) => currentIndex !== index);
                setRuleEditor({ ...ruleEditor, branches: branches.length > 0 ? branches : [createDefaultBranch()] });
              }}
            />
          ))}
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm">Base filter</p>
            <button
              type="button"
              onClick={() => setRuleEditor({ ...ruleEditor, baseFilter: ruleEditor.baseFilter ? null : createDefaultComparisonNode() })}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-muted-foreground"
            >
              {ruleEditor.baseFilter ? "Remove base filter" : "Add base filter"}
            </button>
          </div>
          {ruleEditor.baseFilter && (
            <ConditionNodeEditor
              node={ruleEditor.baseFilter}
              onChange={(baseFilter) => setRuleEditor({ ...ruleEditor, baseFilter })}
            />
          )}
        </div>

        <div className="space-y-2 rounded-2xl border border-border bg-black/10 p-4">
          <p className="text-sm">JSON preview</p>
          <pre className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-neutral-300">
            {JSON.stringify(
              {
                key: ruleEditor.key,
                name: ruleEditor.name,
                surface: ruleEditor.surface,
                metricKey: ruleEditor.metricKey,
                branches: ruleEditor.branches,
                baseFilter: ruleEditor.baseFilter,
              },
              null,
              2,
            )}
          </pre>
        </div>

        {ruleErrors.length > 0 && (
          <Banner tone="warning">
            <div className="space-y-1 text-xs">
              {ruleErrors.slice(0, 10).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </Banner>
        )}

        {ruleMessage && <Banner tone={ruleMessage.tone}>{ruleMessage.text}</Banner>}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSaveRule()}
            disabled={isSavingRule}
            className="rounded-full border border-sky-300/40 bg-sky-500/15 px-4 py-2 text-sm text-sky-100 disabled:opacity-60"
          >
            {isSavingRule ? "Saving..." : selectedRuleId === "new" ? "Create rule" : "Save rule"}
          </button>
          {selectedRuleId !== "new" && (
            <button
              type="button"
              onClick={() => void handleDeleteRule()}
              disabled={isSavingRule}
              className="rounded-full border border-red-300/40 bg-red-500/15 px-4 py-2 text-sm text-red-100 disabled:opacity-60"
            >
              Delete rule
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderQuickRuleRow(rule: ConditionRule) {
    return (
      <div key={rule.id} className="rounded-2xl border border-border bg-black/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedRuleId(rule.id)}
            className="text-left"
          >
            <p className="text-sm">{rule.name}</p>
            <p className="text-xs text-muted-foreground">{rule.key}</p>
          </button>
          <Badge className="text-[10px]">{rule.surface}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>metric: {rule.metricKey}</span>
          <span>severity: {ruleSeveritySummary(rule) || "-"}</span>
          <span>range: {rule.sourceRange ?? "-"}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleQuickToggle(rule)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              rule.enabled ? "border-emerald-300/40 text-emerald-100" : "border-border text-muted-foreground",
            )}
          >
            {rule.enabled ? "Enabled" : "Disabled"}
          </button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Priority
            <input
              type="number"
              defaultValue={rule.priority}
              onBlur={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) return;
                void handleQuickPriority(rule, parsed);
              }}
              className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs outline-none"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle={
          identity.role === "client"
            ? "Manage your profile name and account security."
            : "Security and session controls for your current workspace identity."
        }
      />

      {error && <Banner tone="warning">{error}</Banner>}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}

      <div className={`grid gap-5 ${showIdentityCard ? "xl:grid-cols-[0.95fr_1.05fr]" : "grid-cols-1"}`}>
        {showIdentityCard ? (
          <Surface title="Current identity" subtitle="Resolved by auth/bootstrap layer.">
            <div className="space-y-3 text-sm">
              {actorIdentity && (
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Actor</p>
                  <p className="mt-1">
                    {actorIdentity.fullName} - {actorIdentity.email}
                  </p>
                  <p className="text-xs text-muted-foreground">{getRoleLabel(actorIdentity.role)}</p>
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective name</p>
                <p className="mt-1">{identity.fullName}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective email</p>
                <p className="mt-1">{identity.email}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Effective role</p>
                <p className="mt-1">{getRoleLabel(identity.role)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Impersonation</p>
                <p className="mt-1">{isImpersonating ? "Active" : "Off"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session email</p>
                <p className="mt-1">{session?.user.email ?? "No active session email"}</p>
              </div>
            </div>
          </Surface>
        ) : null}

        <Surface title="Security controls" subtitle="Update password, issue reset links, and manage active session.">
          <div className="space-y-6">
            <form className="space-y-4 rounded-2xl border border-border bg-black/10 p-4" onSubmit={handleUpdateProfileName}>
              <div className="space-y-1">
                <p className="text-sm">Profile name</p>
                <p className="text-xs text-muted-foreground">Set the display name shown across your workspace.</p>
              </div>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Full name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Enter full name"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                />
              </label>
              <button
                type="submit"
                disabled={isSavingProfile || !isNameDirty || Boolean(nameValidationError)}
                className="rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingProfile ? "Saving..." : "Update name"}
              </button>
            </form>

            <form className="space-y-4 rounded-2xl border border-border bg-black/10 p-4" onSubmit={handleUpdatePassword}>
              <div className="space-y-1">
                <p className="text-sm">Change password</p>
                <p className="text-xs text-muted-foreground">Use at least 8 characters for account security.</p>
              </div>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter new password"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Repeat new password"
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                />
              </label>
              <button
                type="submit"
                disabled={isSavingPassword || Boolean(validationError)}
                className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingPassword ? "Updating..." : "Update password"}
              </button>
            </form>

            {showResetLinkControl ? (
              <form className="space-y-4 rounded-2xl border border-border bg-black/10 p-4" onSubmit={handleSendResetLink}>
                <div className="space-y-1">
                  <p className="text-sm">Request password reset link</p>
                  <p className="text-xs text-muted-foreground">Sends a new recovery link to the selected account email.</p>
                </div>
                <label className="block space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Account email</span>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(event) => setRecoveryEmail(event.target.value)}
                    placeholder="name@company.com"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSendingResetLink}
                  className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSendingResetLink ? "Sending..." : "Send reset link"}
                </button>
              </form>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-black/10 p-4">
              <div>
                <p className="text-sm">Session control</p>
                <p className="text-xs text-muted-foreground">Sign out from the current authenticated session.</p>
              </div>
              <button
                onClick={() => {
                  void handleSignOut();
                }}
                disabled={isSigningOut}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        </Surface>
      </div>

      {canManageConditionRules && (
        <Surface title="Condition rules" subtitle="Admin-only operational health rules builder for clients surfaces.">
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={ruleSearch}
                  onChange={(event) => setRuleSearch(event.target.value)}
                  placeholder="Search by key/name/metric"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => setSelectedRuleId("new")}
                  className="rounded-full border border-sky-300/40 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-100"
                >
                  New rule
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={ruleSurfaceFilter}
                  onChange={(event) => setRuleSurfaceFilter(event.target.value)}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs outline-none"
                >
                  <option value="all">all surfaces</option>
                  {availableSurfaces.map((surface) => (
                    <option key={surface} value={surface}>
                      {surface}
                    </option>
                  ))}
                </select>
                <select
                  value={ruleEnabledFilter}
                  onChange={(event) => setRuleEnabledFilter(event.target.value as "all" | "enabled" | "disabled")}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs outline-none"
                >
                  <option value="all">all states</option>
                  <option value="enabled">enabled only</option>
                  <option value="disabled">disabled only</option>
                </select>
              </div>
              <div className="max-h-[58rem] space-y-2 overflow-auto pr-1">
                {filteredRules.length === 0 ? (
                  <EmptyState title="No rules matched" description="Try changing filters or search terms." />
                ) : (
                  filteredRules.map(renderQuickRuleRow)
                )}
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-border bg-black/10 p-4">
              {renderRuleEditor()}
            </div>
          </div>
        </Surface>
      )}
    </div>
  );
}
