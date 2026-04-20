import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, PageHeader, Surface } from "../components/app-ui";
import { getRoleLabel } from "../lib/selectors";
import { useAuth } from "../providers/auth";

interface SettingsMessage {
  tone: "info" | "warning" | "danger";
  text: string;
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
  const [displayName, setDisplayName] = useState(identity?.fullName ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState(identity?.email ?? "");
  const [message, setMessage] = useState<SettingsMessage | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSendingResetLink, setIsSendingResetLink] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

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

  useEffect(() => {
    setDisplayName(identity?.fullName ?? "");
    setRecoveryEmail(identity?.email ?? "");
  }, [identity?.email, identity?.fullName]);

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
    </div>
  );
}
