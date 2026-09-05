import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, EmptyState, LoadingState, MetricCard, Surface } from "../components/app-ui";
import { Camera, Info, Search } from "lucide-react";
import { EditInput, EditLabel } from "../components/lead-edit-form";
import { SearchableSelect } from "../components/searchable-select";
import { ListPagination } from "../components/list-pagination";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { UserAvatar } from "../components/ui/user-avatar";
import { removeAvatarObject, uploadUserAvatar, validateAvatarFile } from "../lib/avatar-storage";
import { formatDate, formatNumber } from "../lib/format";
import { clampPage } from "../lib/pagination";
import { getRoleLabel, isInternalAdmin, sortClientsAlpha } from "../lib/selectors";
import { repository, RepositoryError } from "../data/repository";
import { useAuth } from "../providers/auth";
import { useShellData } from "../providers/shell-data";
import type { AppRole, InviteRecord, InviteRole, InviteStatus, ManagedUserRecord } from "../types/core";

const ALL_ROLES: AppRole[] = ["super_admin", "master_admin", "admin", "manager", "client"];
const USERS_PAGE_SIZE = 15;

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

/** Case-insensitive substring match over several fields. Normalises the query itself so no
 *  caller can forget to, and an all-blank query matches everything. */
function matchesQuery(haystack: Array<string | null | undefined>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((value) => (value ?? "").toLowerCase().includes(needle));
}

/** The two name cells of a Team users row. The draft lives here, not on the page: this row is
 *  the only writer of these two columns, so there is no id-keyed map to maintain and no window
 *  in which a page-level reset can discard what is being typed while a save is in flight.
 *  Committed on Enter, or when focus leaves the pair — tabbing between the two fields is one
 *  logical edit, so it costs one RPC, not two. */
function UserNameFields({
  user,
  disabled,
  disabledTitle,
  onSave,
  onReject,
}: {
  user: ManagedUserRecord;
  disabled: boolean;
  disabledTitle?: string;
  onSave: (first: string, last: string) => void;
  onReject: (message: string) => void;
}) {
  const [draft, setDraft] = useState({ first: user.first_name, last: user.last_name });
  // The record this draft was seeded from. `draft !== seededFrom` is the only definition of
  // "the operator has unsaved edits" — focus is not, because a row can be focused with nothing
  // typed into it.
  const seededFrom = useRef({ first: user.first_name, last: user.last_name });

  // Adopt a record that changed underneath us — a reload, or `send-invite` rewriting the name of
  // an address that already had an account. Unsaved edits win over the incoming record; anything
  // else adopts, so a focused-but-untouched row can never write a stale name back on blur.
  useEffect(() => {
    const previous = seededFrom.current;
    if (previous.first === user.first_name && previous.last === user.last_name) return;
    seededFrom.current = { first: user.first_name, last: user.last_name };
    setDraft((prev) =>
      prev.first !== previous.first || prev.last !== previous.last
        ? prev
        : { first: user.first_name, last: user.last_name },
    );
  }, [user.first_name, user.last_name]);

  function commit() {
    const first = draft.first.trim();
    const last = draft.last.trim();
    if (first === user.first_name && last === user.last_name) return;
    if (!first && !last) {
      // Never leave the row showing a name the server does not have: put the record back and
      // let the page explain why.
      setDraft({ first: user.first_name, last: user.last_name });
      onReject("A user needs at least a first or a last name.");
      return;
    }
    onSave(first, last);
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-white outline-none transition placeholder:text-neutral-500 focus:border-sky-400/40 disabled:opacity-50";

  return (
    <div
      className="grid grid-cols-2 gap-2"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        commit();
      }}
    >
      {([
        { key: "first" as const, label: "First name", value: draft.first },
        { key: "last" as const, label: "Last name", value: draft.last },
      ]).map((field) => (
        <input
          key={field.key}
          aria-label={`${field.label} for ${user.email}`}
          value={field.value}
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
          onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder={field.label}
          className={inputClass}
        />
      ))}
    </div>
  );
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
  const [avatarPendingId, setAvatarPendingId] = useState<string | null>(null);
  const [avatarTargetUser, setAvatarTargetUser] = useState<ManagedUserRecord | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const usersLoadIdRef = useRef(0);
  const userMutationSeqRef = useRef<Record<string, number>>({});

  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);

  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
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
      // Keep whatever is already on screen — this also runs after a successful invite, and a
      // transient `admin_list_users` failure must not blank the whole Team users list.
      setUsers((prev) => prev);
    } finally {
      if (id === usersLoadIdRef.current) setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void refreshUsers();
  }, [canAccess, refreshUsers]);

  const visibleUsers = useMemo(() => {
    return users.filter(
      (user) =>
        (showInactiveUsers || user.is_active) &&
        matchesQuery([`${user.first_name} ${user.last_name}`, user.email, getRoleLabel(user.role)], userSearch),
    );
  }, [users, showInactiveUsers, userSearch]);
  const inactiveUserCount = useMemo(() => users.filter((user) => !user.is_active).length, [users]);

  const userTotalPages = Math.max(1, Math.ceil(visibleUsers.length / USERS_PAGE_SIZE));
  const safeUserPage = clampPage(userPage, userTotalPages);
  const pagedUsers = useMemo(
    () => visibleUsers.slice((safeUserPage - 1) * USERS_PAGE_SIZE, safeUserPage * USERS_PAGE_SIZE),
    [visibleUsers, safeUserPage],
  );

  // `clampPage` keeps the page in range; this puts the operator back at the top of a
  // freshly filtered list, which is what they expect after typing a search.
  useEffect(() => {
    setUserPage(1);
  }, [userSearch, showInactiveUsers]);

  /** Every row mutation goes through here. The per-user sequence number is the write-side twin of
   *  `usersLoadIdRef`: the name fields stay editable during a save (blocking them is what made the
   *  earlier draft handling lose keystrokes), so two saves on one row can overlap, and a slow
   *  first response must not overwrite the row — or the banner — with a name the DB no longer has. */
  async function runUserMutation(
    user: ManagedUserRecord,
    mutate: () => Promise<ManagedUserRecord>,
    successText: string,
    errorText: string,
  ) {
    const seq = (userMutationSeqRef.current[user.id] ?? 0) + 1;
    userMutationSeqRef.current[user.id] = seq;
    const isCurrent = () => userMutationSeqRef.current[user.id] === seq;

    setPendingUserId(user.id);
    setMessage(null);
    try {
      const updated = await mutate();
      if (!isCurrent()) return; // superseded — a newer write owns the row and the banner
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setMessage({ tone: "info", text: successText });
    } catch (reason) {
      if (!isCurrent()) return;
      setMessage({ tone: "danger", text: reason instanceof RepositoryError ? reason.message : errorText });
    } finally {
      // Only the newest write may clear the pending flag; an early clear would re-enable the role
      // Select while a save is still in flight.
      if (isCurrent()) setPendingUserId(null);
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

  async function handleNameSave(user: ManagedUserRecord, first: string, last: string) {
    // On failure the banner explains why and the row keeps what was typed, so a retry
    // costs no retyping.
    await runUserMutation(
      user,
      () => repository.setUserName(user.id, first, last),
      `Name updated for ${user.email}.`,
      "Could not update the user's name.",
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

  function openAvatarPicker(user: ManagedUserRecord) {
    setAvatarTargetUser(user);
    avatarInputRef.current?.click();
  }

  async function handleAvatarFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    const user = avatarTargetUser;
    setAvatarTargetUser(null);
    if (!file || !user) return;

    const validation = validateAvatarFile(file);
    if (!validation.ok) {
      setMessage({ tone: "warning", text: validation.message });
      return;
    }

    setAvatarPendingId(user.id);
    setMessage(null);
    const previousPath = user.avatar_path;
    try {
      const path = await uploadUserAvatar(user.id, file);
      let updated: ManagedUserRecord;
      try {
        updated = await repository.setUserAvatar(user.id, path);
      } catch (reason) {
        await removeAvatarObject(path); // DB write failed → don't leak the upload
        throw reason;
      }
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      void removeAvatarObject(previousPath); // best-effort cleanup of the old photo (non-blocking)
      setMessage({ tone: "info", text: `Photo updated for ${user.email}.` });
    } catch (reason) {
      setMessage({
        tone: "danger",
        text: reason instanceof RepositoryError ? reason.message : reason instanceof Error ? reason.message : "Could not update the photo.",
      });
    } finally {
      setAvatarPendingId(null);
    }
  }

  async function handleAvatarClear(user: ManagedUserRecord) {
    if (!user.avatar_path) return;
    setAvatarPendingId(user.id);
    setMessage(null);
    const previousPath = user.avatar_path;
    try {
      const updated = await repository.setUserAvatar(user.id, null);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      void removeAvatarObject(previousPath);
      setMessage({ tone: "info", text: `Photo removed for ${user.email}.` });
    } catch (reason) {
      setMessage({ tone: "danger", text: reason instanceof RepositoryError ? reason.message : "Could not remove the photo." });
    } finally {
      setAvatarPendingId(null);
    }
  }

  // A→Z; the combobox owns its own filtering.
  const sortedClients = useMemo(() => sortClientsAlpha(clients), [clients]);

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
    const firstName = inviteFirstName.trim();
    const lastName = inviteLastName.trim();
    if (!firstName || !lastName) {
      setMessage({ tone: "warning", text: "Enter both a first and a last name for the invited user." });
      return;
    }
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
      // firstName/lastName override `send-invite`'s email-prefix fallback, so the profile
      // carries the name as typed (capitalisation included).
      await repository.sendInvite({
        email: normalizedEmail,
        role: inviteRole,
        firstName,
        lastName,
        ...(inviteRole === "client" ? { clientId: inviteClientId } : {}),
      });

      setInviteFirstName("");
      setInviteLastName("");
      setInviteEmail("");
      if (inviteRole === "client") {
        setInviteClientId("");
      }
      setMessage({ tone: "info", text: `Invitation sent to ${normalizedEmail}.` });
      // `send-invite` upserts the users row too, so the invitee shows up in Team users
      // immediately. The two reads are independent — don't serialise them.
      await Promise.all([refreshInvites(), refreshUsers()]);
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
        title="Create invitation"
        subtitle="Issue new invitations for client, manager, or admin accounts."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <EditLabel>First name</EditLabel>
            <EditInput value={inviteFirstName} onChange={setInviteFirstName} placeholder="Anna" />
          </label>

          <label className="space-y-2">
            <EditLabel>Last name</EditLabel>
            <EditInput value={inviteLastName} onChange={setInviteLastName} placeholder="Derevianko" />
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="space-y-2 md:col-span-2">
            <EditLabel>Email</EditLabel>
            <EditInput type="email" value={inviteEmail} onChange={setInviteEmail} placeholder="name@company.com" />
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
          <div className="mt-4 space-y-2">
            <EditLabel>Client</EditLabel>
            <SearchableSelect
              label="Client"
              value={inviteClientId || null}
              onChange={setInviteClientId}
              options={sortedClients}
              placeholder="Select client"
              searchPlaceholder="Search clients"
              emptyText="No clients loaded yet."
            />
          </div>
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

      <Surface
        title="Team users"
        subtitle="All portal users. Fix a name, change a role or deactivate an account — changes are enforced server-side."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <input
                type="search"
                aria-label="Search team users"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search name, email, or role"
                className="w-64 max-w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-xs text-white outline-none transition placeholder:text-neutral-500 focus:border-sky-400/40"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactiveUsers}
                onChange={(event) => setShowInactiveUsers(event.target.checked)}
              />
              Show deactivated{inactiveUserCount > 0 ? ` (${inactiveUserCount})` : ""}
            </label>
          </div>
        }
      >
        {isLoadingUsers && users.length === 0 ? (
          <LoadingState />
        ) : visibleUsers.length === 0 ? (
          <EmptyState
            title="No users to show"
            description="No portal users match the current search or filter."
          />
        ) : (
          <div className="space-y-1.5">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarFileChange}
            />
            {pagedUsers.map((user) => {
              const isSelf = actorIdentity?.id === user.id;
              const isProtectedSuperAdmin = user.role === "super_admin" && !canAssignSuperAdmin;
              const roleLocked = isSelf || isProtectedSuperAdmin;
              const isPending = pendingUserId === user.id;
              // Not `getFullName` — that returns "Unnamed" for a blank name, which would flip
              // the avatar's initials away from the email letter.
              const fullName = `${user.first_name} ${user.last_name}`.trim();
              // Keep the user's current role selectable even if not in the assignable
              // set (so a super_admin row still displays "super admin" for an admin actor).
              const options = roleOptions.includes(user.role) ? roleOptions : [user.role, ...roleOptions];
              return (
                <div
                  key={user.id}
                  data-testid="user-row"
                  className="flex flex-col gap-2 rounded-xl border border-[#242424] bg-[#080808] px-3 py-2 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_auto_auto_auto] sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="relative shrink-0">
                      <UserAvatar
                        name={fullName}
                        email={user.email}
                        avatarPath={user.avatar_path}
                        className="size-8"
                      />
                      <button
                        type="button"
                        onClick={() => openAvatarPicker(user)}
                        disabled={avatarPendingId === user.id}
                        title="Upload photo"
                        aria-label={`Upload photo for ${user.email}`}
                        className="absolute -bottom-1 -right-1 rounded-full border border-[#242424] bg-[#050505] p-0.5 text-neutral-300 transition hover:text-white disabled:opacity-50"
                      >
                        <Camera className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-white">
                        {user.email}
                        {isSelf && <span className="ml-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">you</span>}
                      </p>
                      {user.avatar_path ? (
                        <button
                          type="button"
                          onClick={() => void handleAvatarClear(user)}
                          disabled={avatarPendingId === user.id}
                          className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition hover:text-white disabled:opacity-50"
                        >
                          {avatarPendingId === user.id ? "…" : "Remove photo"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <UserNameFields
                    user={user}
                    // Your own name is edited in Settings: that path also refreshes the signed-in
                    // identity, so the sidebar and header don't keep showing the old one.
                    disabled={isProtectedSuperAdmin || isSelf}
                    disabledTitle={isSelf ? "Edit your own name in Settings" : "Only a super admin can change a super admin account"}
                    onSave={(first, last) => void handleNameSave(user, first, last)}
                    onReject={(text) => setMessage({ tone: "warning", text })}
                  />

                  {/* On mobile these 3 controls sit in a flex row; on sm+ they become
                      direct grid children via sm:contents so the parent grid takes over. */}
                  <div className="flex flex-wrap items-center gap-2 sm:contents">
                    <Select
                      value={user.role}
                      onValueChange={(value) => void handleRoleChange(user, value as AppRole)}
                      disabled={roleLocked || isPending}
                    >
                      <SelectTrigger className="h-auto w-32 rounded-lg border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-white disabled:opacity-50">
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
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
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
                      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        user.is_active
                          ? "border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                      }`}
                    >
                      {isPending ? "…" : user.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">
                {formatNumber(visibleUsers.length)} user{visibleUsers.length === 1 ? "" : "s"} · page {safeUserPage} of {userTotalPages}
              </p>
              {userTotalPages > 1 ? (
                <ListPagination page={safeUserPage} totalPages={userTotalPages} onPageChange={setUserPage} />
              ) : null}
            </div>
          </div>
        )}
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
