import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, LoadingState, MetricCard, PageHeader, Surface } from "../components/app-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { formatDate, formatNumber } from "../lib/format";
import { useAuth } from "../providers/auth";
import { useCoreData } from "../providers/core-data";
import type { InviteRecord, InviteRole, InviteStatus } from "../types/core";

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
  const { identity } = useAuth();
  const { clients, loading, error, sendInvite, listInvites, resendInvite, revokeInvite } = useCoreData();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("client");
  const [inviteClientId, setInviteClientId] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [activeFilter, setActiveFilter] = useState<InviteFilter>("all");
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [pendingAction, setPendingAction] = useState<{ inviteId: string; action: "resend" | "revoke" } | null>(null);

  const canAccess = identity?.role === "admin" || identity?.role === "super_admin";

  useEffect(() => {
    if (inviteRole !== "client") {
      setInviteClientId("");
    }
  }, [inviteRole]);

  const refreshInvites = useCallback(async () => {
    setIsLoadingInvites(true);
    try {
      const nextInvites = await listInvites();
      setInvites(nextInvites);
    } catch {
      setInvites([]);
    } finally {
      setIsLoadingInvites(false);
    }
  }, [listInvites]);

  useEffect(() => {
    if (!canAccess) return;
    void refreshInvites();
  }, [canAccess, refreshInvites]);

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
      await sendInvite({
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
      await resendInvite(inviteId);
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
      await revokeInvite(inviteId);
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

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        subtitle="Invite-only access control with lifecycle actions for pending, accepted, and expired invitations."
      />

      {error && <Banner tone="warning">{error}</Banner>}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}

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
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Role</span>
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
                    <button
                      onClick={() => {
                        void handleResend(invite.id);
                      }}
                      disabled={!invite.canResend || isResending || isRevoking}
                      className="rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isResending ? "Resending..." : "Resend"}
                    </button>
                    <button
                      onClick={() => {
                        void handleRevoke(invite.id);
                      }}
                      disabled={!invite.canRevoke || isResending || isRevoking}
                      className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRevoking ? "Revoking..." : "Revoke"}
                    </button>
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
