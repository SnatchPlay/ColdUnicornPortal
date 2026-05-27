import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { Banner, EmptyState, PageHeader, Surface } from "../components/app-ui";
import { CrmIntegrationCard } from "../components/crm-integration-card";
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
import { MEGA_COLUMNS } from "./clients-page/mega-table";
import { ConditionRuleBuilder } from "./settings/condition-rule-builder";
import { BUILTIN_METRICS } from "../lib/conditions/metric-catalog";
import type {
  ClientCustomFieldRecord,
  ClientCustomFieldType,
  ClientRecord,
  ColumnOverrideRecord,
  ConditionRuleRecord,
} from "../types/core";

interface SettingsMessage {
  tone: "info" | "warning" | "danger";
  text: string;
}

function emptyRule(createdBy: string | null): ConditionRule {
  const now = new Date().toISOString();
  // Seed with the first built-in metric so a fresh rule is already valid
  // (metric_key + surface + column_key all populated). The user can change
  // the metric via the dropdown but never needs to "fix" an empty draft.
  const seed = BUILTIN_METRICS[0];
  const branch = createDefaultBranch();
  branch.when = {
    left: { metric: seed.path },
    op: seed.operators[0] ?? "eq",
    right: { value: 0 },
  };
  return {
    id: "draft",
    key: `new-rule-${crypto.randomUUID().slice(0, 8)}`,
    name: "New rule",
    description: null,
    targetEntity: "client",
    surface: seed.surface,
    metricKey: seed.path,
    sourceSheet: "CS PDCA",
    sourceRange: null,
    scopeType: "global",
    clientId: null,
    managerId: null,
    applyTo: "cell",
    columnKey: seed.columnKey,
    branches: [branch],
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
    clients,
    users = [],
    conditionRules,
    createConditionRule,
    updateConditionRule,
    deleteConditionRule,
    columnOverrides = [],
    clientCustomFields = [],
    upsertColumnOverride,
    setColumnOrder,
    createClientCustomField,
    updateClientCustomField,
    deleteClientCustomField,
  } = useCoreData();

  const conditionManagers = useMemo(
    () => users.filter((u) => u.role === "manager"),
    [users],
  );
  const activeClient = useMemo(
    () => clients.find((client) => client.id === identity?.clientId) ?? null,
    [clients, identity?.clientId],
  );
  const showCrmIntegration = identity?.role === "client";
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

  const canManageConditionRules = identity?.role === "super_admin" || identity?.role === "master_admin";
  const isMasterAdmin = identity?.role === "master_admin";
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
        <ConditionRuleBuilder
          rule={ruleEditor}
          onChange={(next) => setRuleEditor(next)}
          errors={ruleErrors}
          clients={clients}
          managers={conditionManagers}
          customFields={clientCustomFields}
          canSeeRaw={identity?.role === "super_admin"}
          isNew={selectedRuleId === "new"}
        />

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

      {showCrmIntegration && <CrmIntegrationCard client={activeClient} />}

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

      {isMasterAdmin && (
        <ClientsTableCustomization
          columnOverrides={columnOverrides}
          customFields={clientCustomFields}
          onUpsertOverride={upsertColumnOverride}
          onSetColumnOrder={setColumnOrder}
          onCreateField={createClientCustomField}
          onUpdateField={updateClientCustomField}
          onDeleteField={deleteClientCustomField}
        />
      )}

    </div>
  );
}

// ---------- Master_admin: Clients table customization ----------

interface ClientsTableCustomizationProps {
  columnOverrides: ColumnOverrideRecord[];
  customFields: ClientCustomFieldRecord[];
  onUpsertOverride: (
    columnKey: string,
    patch: { label_override?: string | null; hidden?: boolean; position?: number | null },
  ) => Promise<void>;
  onSetColumnOrder: (orderedKeys: string[]) => Promise<void>;
  onCreateField: (input: {
    name: string;
    field_type: ClientCustomFieldType;
    options?: string[] | null;
    position?: number;
    editable_by?: string[];
  }) => Promise<void>;
  onUpdateField: (
    fieldId: string,
    patch: {
      name?: string;
      field_type?: ClientCustomFieldType;
      options?: string[] | null;
      position?: number;
      editable_by?: string[];
    },
  ) => Promise<void>;
  onDeleteField: (fieldId: string) => Promise<void>;
}

function ClientsTableCustomization({
  columnOverrides,
  customFields,
  onUpsertOverride,
  onSetColumnOrder,
  onCreateField,
  onUpdateField,
  onDeleteField,
}: ClientsTableCustomizationProps) {
  const overrideMap = useMemo(() => {
    const m = new Map<string, ColumnOverrideRecord>();
    for (const o of columnOverrides) m.set(o.column_key, o);
    return m;
  }, [columnOverrides]);

  // Unified ordered list: built-in columns + custom fields sorted together.
  // Mirrors mega-table logic: explicit override.position first, then natural order
  // (built-ins keep MEGA_COLUMNS default index; custom fields come after all built-ins
  // until the user drags them into a specific position).
  // Hidden built-in columns are NOT filtered out so the user can unhide them.
  type UnifiedEntry =
    | { kind: "builtin"; id: string; group: string; sub: string; label: string; override: ColumnOverrideRecord | null; defaultIdx: number }
    | { kind: "custom"; id: string; name: string; fieldType: ClientCustomFieldType; override: ColumnOverrideRecord | null; naturalOrder: number };

  const allOrderedEntries = useMemo((): UnifiedEntry[] => {
    const builtIn: UnifiedEntry[] = MEGA_COLUMNS.map((col, defaultIdx) => ({
      kind: "builtin",
      id: col.id,
      group: col.group,
      sub: col.sub,
      label: col.label,
      override: overrideMap.get(col.id) ?? null,
      defaultIdx,
    }));
    const custom: UnifiedEntry[] = customFields
      .slice()
      .sort((l, r) => l.position - r.position)
      .map((field, i) => ({
        kind: "custom",
        id: `cf:${field.id}`,
        name: field.name,
        fieldType: field.field_type,
        override: overrideMap.get(`cf:${field.id}`) ?? null,
        naturalOrder: MEGA_COLUMNS.length + i,
      }));
    return [...builtIn, ...custom].sort((a, b) => {
      const ap = a.override?.position ?? null;
      const bp = b.override?.position ?? null;
      if (ap !== null && bp !== null) return ap - bp;
      if (ap !== null) return -1;
      if (bp !== null) return 1;
      const an = a.kind === "builtin" ? a.defaultIdx : a.naturalOrder;
      const bn = b.kind === "builtin" ? b.defaultIdx : b.naturalOrder;
      return an - bn;
    });
  }, [overrideMap, customFields]);

  // Drag-and-drop state — unified column list
  const draggedIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragStart(idx: number, event: React.DragEvent) {
    draggedIdxRef.current = idx;
    setIsDragging(true);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: React.DragEvent, idx: number) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }

  function handleDrop(event: React.DragEvent, targetIdx: number) {
    event.preventDefault();
    const fromIdx = draggedIdxRef.current;
    if (fromIdx === null || fromIdx === targetIdx) {
      draggedIdxRef.current = null;
      setDragOverIdx(null);
      setIsDragging(false);
      return;
    }
    const next = allOrderedEntries.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(targetIdx, 0, moved);
    void onSetColumnOrder(next.map((e) => e.id));
    draggedIdxRef.current = null;
    setDragOverIdx(null);
    setIsDragging(false);
  }

  function handleDragEnd() {
    draggedIdxRef.current = null;
    setDragOverIdx(null);
    setIsDragging(false);
  }

  // Translate bucket-named columns (whose label is a relative-day token like
  // "−1") to something a human can read at a glance: "Daily sent · −1 (yesterday)".
  const describeBuiltInColumn = (col: { id: string; group: string; sub: string; label: string }) => {
    const bucketLabels: Record<string, Record<string, string>> = {
      dodSched: { "+2": "day after tomorrow", "+1": "tomorrow", "0": "today" },
      dodSent: { "0": "today", "-1": "yesterday", "-2": "2 days ago", "-3": "3 days ago", "-4": "4 days ago" },
      td3: { "0": "today", "-1": "1 day ago", "-2": "2 days ago", "-3": "3 days ago", "-4": "4 days ago" },
      wow: { "0": "this week", "-1": "last week", "-2": "2 weeks ago", "-3": "3 weeks ago", "-4": "4 weeks ago" },
      mom: { "0": "this month", "-1": "last month", "-2": "2 months ago", "-3": "3 months ago", "-4": "4 months ago" },
    };
    const friendly = bucketLabels[col.group]?.[col.label];
    if (friendly) return `${col.sub} · ${col.label} (${friendly})`;
    return col.sub && col.sub !== col.label ? `${col.sub} · ${col.label}` : col.label;
  };

  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<ClientCustomFieldType>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [newFieldEditableBy, setNewFieldEditableBy] = useState<string[]>(["master_admin"]);

  function toggleNewFieldRole(role: string) {
    setNewFieldEditableBy((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleCreateField() {
    const name = newFieldName.trim();
    if (!name) return;
    let options: string[] | null = null;
    if (newFieldType === "droplist") {
      options = newFieldOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (options.length === 0) return;
    }
    const editable_by = newFieldEditableBy.length > 0 ? newFieldEditableBy : ["master_admin"];
    const position = customFields.length;
    await onCreateField({ name, field_type: newFieldType, options, position, editable_by });
    setNewFieldName("");
    setNewFieldOptions("");
    setNewFieldEditableBy(["master_admin"]);
  }

  return (
    <Surface
      title="Clients table customization"
      subtitle="Master-admin only: rename or hide built-in columns; add text/checkbox/droplist columns."
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-black/10 p-4">
          <p className="mb-1 text-sm">Column order</p>
          <p className="mb-3 text-[10px] text-muted-foreground">
            Drag rows to reorder all columns — built-in and custom together. For built-in columns you can also override the display label or hide the column entirely. Bucket-named columns (e.g. <code className="text-neutral-300">−1</code>) include a human translation like <code className="text-neutral-300">yesterday</code>.
          </p>
          {/* Table header */}
          <div className="grid grid-cols-[24px_1.4fr_2fr_auto] items-center gap-3 border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span />
            <span>Column</span>
            <span>Display label (override)</span>
            <span>Visibility</span>
          </div>
          <div
            className="max-h-96 divide-y divide-white/5 overflow-auto pr-1"
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOverIdx(null);
              }
            }}
          >
            {allOrderedEntries.map((entry, idx) => {
              const isBeingDragged = isDragging && draggedIdxRef.current === idx;
              const isDropTarget = dragOverIdx === idx && draggedIdxRef.current !== idx;
              return (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={(e) => handleDragStart(idx, e)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "grid grid-cols-[24px_1.4fr_2fr_auto] items-center gap-3 px-3 py-2 transition-colors",
                    isBeingDragged ? "opacity-40" : "",
                    isDropTarget ? "border-t-2 border-t-sky-400" : "",
                  )}
                >
                  <div
                    className="flex cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>
                  {entry.kind === "builtin" ? (
                    <>
                      <span className="truncate text-xs text-neutral-300">{describeBuiltInColumn(entry)}</span>
                      <input
                        type="text"
                        defaultValue={entry.override?.label_override ?? ""}
                        placeholder={entry.label}
                        onBlur={(event) => {
                          const next = event.target.value.trim() || null;
                          if (next === (entry.override?.label_override ?? null)) return;
                          void onUpsertOverride(entry.id, { label_override: next });
                        }}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(entry.override?.hidden)}
                          onChange={(event) => {
                            void onUpsertOverride(entry.id, { hidden: event.target.checked });
                          }}
                        />
                        Hidden
                      </label>
                    </>
                  ) : (
                    <>
                      <span className="truncate text-xs text-neutral-300">{entry.name}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground w-fit">
                        {entry.fieldType}
                      </span>
                      <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-sky-400/70">
                        custom
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-black/10 p-4">
          <p className="mb-3 text-sm">Custom columns</p>
          <div className="space-y-2">
            {customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">No custom columns yet.</p>
            ) : (
              customFields
                .slice()
                .sort((l, r) => l.position - r.position)
                .map((field) => (
                  <div
                    key={field.id}
                    className="space-y-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2"
                  >
                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
                      <input
                        type="text"
                        defaultValue={field.name}
                        onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (!next || next === field.name) return;
                          void onUpdateField(field.id, { name: next });
                        }}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
                      />
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {field.field_type}
                      </span>
                      {field.field_type === "droplist" ? (
                        <input
                          type="text"
                          defaultValue={(field.options ?? []).join(", ")}
                          placeholder="comma-separated options"
                          onBlur={(event) => {
                            const next = event.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean);
                            if (next.length === 0) return;
                            if (JSON.stringify(next) === JSON.stringify(field.options ?? [])) return;
                            void onUpdateField(field.id, { options: next });
                          }}
                          className="w-48 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
                        />
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete column "${field.name}"? Values will be lost.`)) {
                            void onDeleteField(field.id);
                          }
                        }}
                        className="rounded-full border border-red-400/30 bg-red-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-red-100"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex items-center gap-3 pl-1">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Editable by</span>
                      {(["master_admin", "admin", "manager"] as const).map((role) => {
                        const checked = (field.editable_by ?? ["master_admin"]).includes(role);
                        const isLocked = role === "master_admin";
                        return (
                          <label key={role} className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isLocked}
                              onChange={() => {
                                if (isLocked) return;
                                const current = field.editable_by ?? ["master_admin"];
                                const next = checked
                                  ? current.filter((r) => r !== role)
                                  : [...current, role];
                                const safe = next.includes("master_admin") ? next : ["master_admin", ...next];
                                void onUpdateField(field.id, { editable_by: safe });
                              }}
                            />
                            {role}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))
            )}
          </div>
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <input
                type="text"
                value={newFieldName}
                onChange={(event) => setNewFieldName(event.target.value)}
                placeholder="New column name"
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
              />
              <select
                value={newFieldType}
                onChange={(event) => setNewFieldType(event.target.value as ClientCustomFieldType)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
              >
                <option value="text">text</option>
                <option value="checkbox">checkbox</option>
                <option value="droplist">droplist</option>
              </select>
              {newFieldType === "droplist" ? (
                <input
                  type="text"
                  value={newFieldOptions}
                  onChange={(event) => setNewFieldOptions(event.target.value)}
                  placeholder="comma-separated options"
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none"
                />
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => {
                  void handleCreateField();
                }}
                className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-[0.12em] text-sky-100"
              >
                Add column
              </button>
            </div>
            <div className="flex items-center gap-3 pl-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Editable by</span>
              {(["master_admin", "admin", "manager"] as const).map((role) => {
                const isLocked = role === "master_admin";
                const checked = newFieldEditableBy.includes(role);
                return (
                  <label key={role} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isLocked}
                      onChange={() => toggleNewFieldRole(role)}
                    />
                    {role}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}
