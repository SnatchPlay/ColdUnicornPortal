import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, EmptyState, LoadingState, MetricCard, Surface } from "../components/app-ui";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { formatDate, formatNumber } from "../lib/format";
import { getRoleLabel, isInternalAdmin } from "../lib/selectors";
import { repository, RepositoryError } from "../data/repository";
import { useAuth } from "../providers/auth";
import { useShellData } from "../providers/shell-data";
import type { AppRole, InviteRecord, InviteRole, InviteStatus, ManagedUserRecord } from "../types/core";

const ALL_ROLES: AppRole[] = ["super_admin", "master_admin", "admin", "manager", "client"];

// Roles the current actor is allowed to assign. Only a super_admin may grant
// super_admin; this is also enforced server-side by admin_update_user_role.
function assignableRoles(actorRole: AppRole | undefined): AppRole[] {
  if (actorRole === "super_admin") return ALL_ROLES;
  return ALL_ROLES.filter((role) => role !== "super_admin");
}

type InviteFilter = "all" | InviteStatus;

type UiMessage = {
  tone: "info" | "warning" | "danger";
  text: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function statusBadgeClass(status: InviteStatus) {
  if (status === "accepted") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "expired") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-sky-500/30 bg-sky-500/10 text-sky-200";
}

function inviteDisabledReason(status: InviteStatus): string | null {
  if (status === "accepted") return "Already accepted — no action possible";
  if (status === "expired") return "Invite expired — create a new one";
  return null;
}

function formatInviteDate(value: string | null) {
  return value
    ? formatDate(value, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export function AdminUserManagementPage() {
  const { identity, actorIdentity } = useAuth();
  // clients come from the already-loaded shell data (no extra round-trip needed).
  const { clientsLite: clients } = useShellData();

  // ── Team users (2B/2C) ────────────────────────────────────────────────────
  const [users, setUsers] = useState<ManagedUserRecord[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const usersLoadIdRef = useRef(0);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("client");
  const [inviteClientId, setInviteClientId] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [activeFilter, setActiveFilter] = useState<InviteFilter>("all");
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [pendingAction, setPendingAction] = useState<{ inviteId: string; action: "resend" | "revoke" } | null>(null);

  const canAccess = identity ? isInternalAdmin(identity.role) : false;

  useEffect(() => {
    if (inviteRole !== "client") {
      setInviteClientId("");
    }
  }, [inviteRole]);

  const refreshInvites = useCallback(async () => {
    setIsLoadingInvites(true);
    try {
      const nextInvites = await repository.listInvites();
      setInvites(nextInvites);
    } catch {
      setInvites([]);
    } finally {
      setIsLoadingInvites(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void refreshInvites();
  }, [canAccess, refreshInvites]);

  const refreshUsers = useCallback(async () => {
    const id = ++usersLoadIdRef.current;
    setIsLoadingUsers(true);
    try {
      const nextUsers = await repository.listManagedUsers();
      if (id !== usersLoadIdRef.current) return; // stale — discard
      setUsers(nextUsers);
    } catch {
      if (id !== usersLoadIdRef.current) return;
      setUsers([]);
    } finally {
      if (id === usersLoadIdRef.current) setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void refreshUsers();
  }, [canAccess, refreshUsers]);

  const visibleUsers = useMemo(
    () => (showInactiveUsers ? users : users.filter((user) => user.is_active)),
    [users, showInactiveUsers],
  );
  const inactiveUserCount = useMemo(() => users.filter((user) => !user.is_active).length, [users]);

  async function runUserMutation(
    user: ManagedUserRecord,
    mutate: () => Promise<ManagedUserRecord>,
    successText: string,
    errorText: string,
  ) {
    setPendingUserId(user.id);
    setMessage(null);
    try {
      const updated = await mutate();
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setMessage({ tone: "info", text: successText });
    } catch (reason) {
      setMessage({ tone: "danger", text: reason instanceof RepositoryError ? reason.message : errorText });
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleRoleChange(user: ManagedUserRecord, nextRole: AppRole) {
    if (nextRole === user.role) return;
    await runUserMutation(
      user,
      () => repository.updateUserRole(user.id, nextRole),
      `${user.email} is now ${getRoleLabel(nextRole)}.`,
      "Could not change the user's role.",
    );
  }

  async function handleToggleActive(user: ManagedUserRecord) {
    const nextActive = !user.is_active;
    if (
      !nextActive &&
      !window.confirm(
        `Deactivate ${user.email}? They will be signed out and lose portal access until reactivated. No data is deleted.`,
      )
    ) {
      return;
    }
    await runUserMutation(
      user,
      () => repository.setUserActive(user.id, nextActive),
      nextActive ? `${user.email} reactivated.` : `${user.email} deactivated.`,
      "Could not change the user's status.",
    );
  }

  const filteredInvites = useMemo(() => {
    if (activeFilter === "all") return invites;
    return invites.filter((item) => item.status === activeFilter);
  }, [activeFilter, invites]);

  const counters = useMemo(() => {
    const pending = invites.filter((item) => item.status === "pending").length;
    const accepted = invites.filter((item) => item.status === "accepted").length;
    const expired = invites.filter((item) => item.status === "expired").length;
    return {
      pending,
      accepted,
      expired,
      total: invites.length,
    };
  }, [invites]);

  async function handleSendInvite() {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      setMessage({ tone: "warning", text: "Enter a valid email before sending an invitation." });
      return;
    }

    if (inviteRole === "client" && !inviteClientId) {
      setMessage({ tone: "warning", text: "Select a client for client-role invitations." });
      return;
    }

    setIsSendingInvite(true);
    setMessage(null);

    try {
      await repository.sendInvite({
        email: normalizedEmail,
        role: inviteRole,
        ...(inviteRole === "client" ? { clientId: inviteClientId } : {}),
      });

      setInviteEmail("");
      if (inviteRole === "client") {
        setInviteClientId("");
      }
      setMessage({ tone: "info", text: `Invitation sent to ${normalizedEmail}.` });
      await refreshInvites();
    } catch {
      setMessage({ tone: "danger", text: "Invitation request failed. Check permissions and try again." });
    } finally {
      setIsSendingInvite(false);
    }
  }

  async function handleResend(inviteId: string) {
    setPendingAction({ inviteId, action: "resend" });
    setMessage(null);
    try {
      await repository.resendInvite(inviteId);
      setMessage({ tone: "info", text: "Invitation resent successfully." });
      await refreshInvites();
    } catch {
      setMessage({ tone: "danger", text: "Could not resend invitation." });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRevoke(inviteId: string) {
    setPendingAction({ inviteId, action: "revoke" });
    setMessage(null);
    try {
      await repository.revokeInvite(inviteId);
      setMessage({ tone: "info", text: "Invitation revoked." });
      await refreshInvites();
    } catch {
      setMessage({ tone: "danger", text: "Could not revoke invitation." });
    } finally {
      setPendingAction(null);
    }
  }

  if (!canAccess) {
    return (
      <EmptyState
        title="Admin access required"
        description="This route is available to admin and super_admin roles only."
      />
    );
  }

  const canAssignSuperAdmin = actorIdentity?.role === "super_admin";
  const roleOptions = assignableRoles(actorIdentity?.role);

  return (
    <div className="space-y-6">
      {message && <Banner tone={message.tone}>{message.text}</Banner>}

      <Surface
        title="Team users"
        subtitle="All portal users. Change a role or deactivate an account — changes are enforced server-side."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactiveUsers}
              onChange={(event) => setShowInactiveUsers(event.target.checked)}
            />
            Show deactivated{inactiveUserCount > 0 ? ` (${inactiveUserCount})` : ""}
          </label>
        }
      >
        {isLoadingUsers && users.length === 0 ? (
          <LoadingState />
        ) : visibleUsers.length === 0 ? (
          <EmptyState
            title="No users to show"
            description="No portal users match the current filter."
          />
        ) : (
          <div className="space-y-2">
            {visibleUsers.map((user) => {
              const isSelf = actorIdentity?.id === user.id;
              const isProtectedSuperAdmin = user.role === "super_admin" && !canAssignSuperAdmin;
              const roleLocked = isSelf || isProtectedSuperAdmin;
              const isPending = pendingUserId === user.id;
              const fullName = `${user.first_name} ${user.last_name}`.trim();
              // Keep the user's current role selectable even if not in the assignable
              // set (so a super_admin row still displays "super admin" for an admin actor).
              const options = roleOptions.includes(user.role) ? roleOptions : [user.role, ...roleOptions];
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[1.4fr_auto_auto_auto] items-center gap-3 rounded-2xl border border-[#242424] bg-[#080808] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">
                      {fullName || user.email}
                      {isSelf && <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">you</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>

                  <Select
                    value={user.role}
                    onValueChange={(value) => void handleRoleChange(user, value as AppRole)}
                    disabled={roleLocked || isPending}
                  >
                    <SelectTrigger className="h-auto w-40 rounded-xl border-white/10 bg-black/20 px-3 py-2 text-xs text-white disabled:opacity-50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-[#242424] bg-[#050505] text-white">
                      {options.map((role) => (
                        <SelectItem key={role} value={role} className="text-white focus:bg-[#1a1a1a] focus:text-white">
                          {getRoleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <span
                    className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${
                      user.is_active
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-neutral-500/30 bg-neutral-500/10 text-neutral-300"
                    }`}
                  >
                    {user.is_active ? "active" : "deactivated"}
                  </span>

                  <button
                    type="button"
                    onClick={() => void handleToggleActive(user)}
                    disabled={isSelf || isProtectedSuperAdmin || isPending}
                    title={
                      isSelf
                        ? "You cannot deactivate your own account"
                        : isProtectedSuperAdmin
                          ? "Only a super admin can change a super admin account"
                          : undefined
                    }
                    className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      user.is_active
                        ? "border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                    }`}
                  >
                    {isPending ? "…" : user.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Surface>

      <Surface
        title="Create invitation"
        subtitle="Issue new invitations for client, manager, or admin accounts."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 md:col-span-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
            />
          </label>

          <label className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Role
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Role capabilities"
                    title="Role capabilities"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/20 text-muted-foreground transition hover:border-white/30 hover:bg-white/5 hover:text-white"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 rounded-xl border border-[#242424] bg-[#050505] p-4 text-xs text-neutral-200"
                >
                  <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Role capabilities</p>
                  <ul className="space-y-2 normal-case tracking-normal">
                    <li><span className="font-medium text-white">Client</span> — sees only their own portal: dashboard, leads, campaigns, analytics. Read-mostly with a small set of editable lead fields.</li>
                    <li><span className="font-medium text-white">CS Manager</span> — sees only clients assigned to them. Operational surface across leads, campaigns, domains, invoices for that subset.</li>
                    <li><span className="font-medium text-white">Admin</span> — sees all clients. Full operational access plus user management. Cannot configure global Clients table columns or trigger thresholds.</li>
                    <li><span className="font-medium text-white">Master admin</span> — admin plus exclusive access to Clients table customization (column overrides, custom fields) and Simple-triggers configuration. Configured manually; not invitable.</li>
                  </ul>
                </PopoverContent>
              </Popover>
            </span>
            <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as InviteRole)}>
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                <SelectItem value="client" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  client
                </SelectItem>
                <SelectItem value="manager" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  manager
                </SelectItem>
                <SelectItem value="admin" className="text-white focus:bg-[#1a1a1a] focus:text-white">
                  admin
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        {inviteRole === "client" && (
          <label className="mt-4 block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Client</span>
            <Select value={inviteClientId || undefined} onValueChange={setInviteClientId}>
              <SelectTrigger className="h-auto rounded-2xl border-white/10 bg-black/20 px-4 py-3 text-sm text-white">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent className="max-h-72 rounded-xl border-[#242424] bg-[#050505] text-white">
                {clients.map((client) => (
                  <SelectItem
                    key={client.id}
                    value={client.id}
                    className="text-white focus:bg-[#1a1a1a] focus:text-white"
                  >
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={() => {
              void handleSendInvite();
            }}
            disabled={isSendingInvite}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSendingInvite ? "Sending..." : "Send invitation"}
          </button>
        </div>
      </Surface>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total" value={formatNumber(counters.total)} hint="Tracked invites" tone="info" />
        <MetricCard label="Pending" value={formatNumber(counters.pending)} hint="Awaiting acceptance" tone="neutral" />
        <MetricCard label="Accepted" value={formatNumber(counters.accepted)} hint="Already onboarded" tone="success" />
        <MetricCard label="Expired" value={formatNumber(counters.expired)} hint="Needs resend or revoke" tone="warning" />
      </div>

      <Surface
        title="Invitation lifecycle"
        subtitle="Resend or revoke pending and expired invites. Accepted entries are read-only."
        actions={
          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "accepted", "expired"] as InviteFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.12em] transition ${
                  activeFilter === filter
                    ? "border-sky-400/40 bg-sky-500/15 text-sky-100"
                    : "border-[#242424] bg-[#080808] text-neutral-400 hover:text-white"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        }
      >
        {isLoadingInvites ? (
          <LoadingState />
        ) : filteredInvites.length === 0 ? (
          <EmptyState
            title="No invites in this status"
            description="Adjust the filter or create a new invitation to populate this view."
          />
        ) : (
          <div className="space-y-3">
            {filteredInvites.map((invite) => {
              const isResending = pendingAction?.inviteId === invite.id && pendingAction.action === "resend";
              const isRevoking = pendingAction?.inviteId === invite.id && pendingAction.action === "revoke";
              return (
                <article key={invite.id} className="rounded-2xl border border-[#242424] bg-[#080808] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{invite.email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Role: {invite.role}
                        {invite.clientName ? ` • Client: ${invite.clientName}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${statusBadgeClass(invite.status)}`}>
                      {invite.status}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                    <p>Invited: {formatInviteDate(invite.invitedAt)}</p>
                    <p>Accepted: {formatInviteDate(invite.acceptedAt)}</p>
                    <p>Expires: {formatInviteDate(invite.expiresAt)}</p>
                    <p>Invited by: {invite.invitedByName ?? invite.invitedById ?? "—"}</p>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    {(() => {
                      const reason = inviteDisabledReason(invite.status);
                      const resendButton = (
                        <button
                          onClick={() => {
                            void handleResend(invite.id);
                          }}
                          disabled={!invite.canResend || isResending || isRevoking}
                          className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isResending ? "Resending..." : "Resend"}
                        </button>
                      );
                      const revokeButton = (
                        <button
                          onClick={() => {
                            void handleRevoke(invite.id);
                          }}
                          disabled={!invite.canRevoke || isResending || isRevoking}
                          className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRevoking ? "Revoking..." : "Revoke"}
                        </button>
                      );
                      if (!reason) {
                        return (
                          <>
                            {resendButton}
                            {revokeButton}
                          </>
                        );
                      }
                      return (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="inline-flex">{resendButton}</span>
                            </TooltipTrigger>
                            <TooltipContent>{reason}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="inline-flex">{revokeButton}</span>
                            </TooltipTrigger>
                            <TooltipContent>{reason}</TooltipContent>
                          </Tooltip>
                        </>
                      );
                    })()}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Surface>
    </div>
  );
}
