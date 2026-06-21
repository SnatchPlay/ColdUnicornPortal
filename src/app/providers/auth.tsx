import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { RepositoryError, repository } from "../data/repository";
import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type { Identity } from "../types/core";

export type AuthErrorCode =
  | "runtime_config"
  | "session_invalid"
  | "profile_missing"
  | "client_mapping_missing"
  | "account_deactivated"
  | "permission"
  | "network"
  | "unknown";

interface AuthContextValue {
  loading: boolean;
  actorIdentity: Identity | null;
  identity: Identity | null;
  session: Session | null;
  error: string | null;
  errorCode: AuthErrorCode | null;
  isImpersonating: boolean;
  refreshIdentity: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  signInWithOtp: (email: string) => Promise<{ ok: boolean; message: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; message: string }>;
  updatePassword: (password: string) => Promise<{ ok: boolean; message: string }>;
  updateProfileName: (fullName: string) => Promise<{ ok: boolean; message: string }>;
  updateProfileAvatar: (avatarPath: string | null) => Promise<{ ok: boolean; message: string }>;
  impersonate: (nextIdentity: Identity) => void;
  stopImpersonation: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildBrowserRedirect(path: string) {
  const baseUrl = runtimeConfig.appBaseUrl;
  if (!baseUrl) {
    return path;
  }
  return new URL(path, `${baseUrl}/`).toString();
}

function toSafeAuthMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("denied") ||
    normalized.includes("policy")
  ) {
    return "Your account does not have permission to continue this action.";
  }
  return message;
}

async function loadIdentity(session: Session | null) {
  if (!supabase) {
    return {
      identity: null,
      error: runtimeConfig.error,
      errorCode: "runtime_config" as const,
    };
  }

  if (!session) {
    return {
      identity: null,
      error: null,
      errorCode: null,
    };
  }

  try {
    // Deactivation gate (2C): a deactivated account keeps a valid JWT but must
    // not retain portal access. private.current_app_role() already returns NULL
    // for them (stripping all role-gated RLS data); signing them out here is the
    // clean UX complement. Both calls only need the session, so run them together
    // rather than adding a sequential round-trip to startup.
    const [result, stillActive] = await Promise.all([
      repository.loadIdentity(session.user.id),
      repository.isCurrentAccountActive(),
    ]);
    if (result.identity && !stillActive) {
      return {
        identity: null,
        error: "Your account has been deactivated. Contact an administrator if you believe this is a mistake.",
        errorCode: "account_deactivated" as const,
      };
    }
    return result;
  } catch (reason) {
    if (reason instanceof RepositoryError) {
      return {
        identity: null,
        error:
          reason.kind === "permission"
            ? "Your authenticated session does not have permission to load the workspace profile."
            : "Your account profile could not be loaded right now. Please try again.",
        errorCode: reason.kind === "permission" ? "permission" : reason.kind === "network" ? "network" : "unknown",
      };
    }

    return {
      identity: null,
      error: "Your account profile could not be loaded right now. Please try again.",
      errorCode: "unknown",
    };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [actorIdentity, setActorIdentity] = useState<Identity | null>(null);
  const [impersonatedIdentity, setImpersonatedIdentity] = useState<Identity | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<AuthErrorCode | null>(null);

  const identity =
    actorIdentity?.role === "super_admin" && runtimeConfig.allowInternalImpersonation && impersonatedIdentity
      ? impersonatedIdentity
      : actorIdentity;
  const isImpersonating =
    runtimeConfig.allowInternalImpersonation && actorIdentity?.role === "super_admin" && Boolean(impersonatedIdentity);

  // De-dup guard against redundant identity resolution on full page load.
  //
  // On a cold tab with a persisted session, Supabase triggers `syncSessionState`
  // three times concurrently:
  //   1. `supabase.auth.getSession()` promise resolution
  //   2. `onAuthStateChange` "INITIAL_SESSION" event
  //   3. `onAuthStateChange` "SIGNED_IN" event (restored persisted session)
  // All three carry the same session. Without this guard each one runs its own
  // `loadIdentity` round-trip and commits a fresh `actorIdentity` reference,
  // which downstream `CoreDataProvider` reacts to with a duplicate
  // `loadSnapshot` (~12 MB × 2). The signature is `${user.id}:${access_token}`
  // for a real session, or the literal `"null"` for signed-out. Genuine
  // transitions — sign-in (new token), sign-out (`"null"`), token-refresh
  // (new access_token) — produce a different signature and are not blocked.
  //
  // The ref is claimed synchronously *before* `loadIdentity` awaits, so
  // concurrent callers short-circuit before issuing parallel network calls.
  // On soft failure (real session but `identity === null` with a non-null
  // errorCode), the signature is rolled back in `finally` so the same session
  // can be retried by a later auth event or by `refreshIdentity()`.
  const lastSyncedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    // [TEMP PERF] trace which path sets the auth identity — investigating double loadSnapshot
    const syncSessionState = async (nextSession: Session | null, origin: string) => {
      if (!active) return;

      const signature = nextSession ? `${nextSession.user.id}:${nextSession.access_token}` : "null";
      if (lastSyncedSignatureRef.current === signature) {
        // [TEMP PERF] redacted log — never print the signature itself
        console.log(
          `[TEMP PERF][auth] syncSessionState SKIP duplicate (origin=${origin}, sessionUser=${nextSession?.user?.id ?? "none"})`,
        );
        return;
      }
      // Claim BEFORE awaiting loadIdentity so concurrent callers short-circuit.
      lastSyncedSignatureRef.current = signature;

      console.log(`[TEMP PERF][auth] syncSessionState start (origin=${origin}, sessionUser=${nextSession?.user?.id ?? "none"})`);
      setSession(nextSession);

      let committedUsableIdentity = false;
      try {
        const next = await loadIdentity(nextSession);
        if (!active) return;

        console.log(`[TEMP PERF][auth] syncSessionState commit (origin=${origin}, identityId=${next.identity?.id ?? "null"})`);
        setActorIdentity(next.identity);
        setImpersonatedIdentity((current) => (next.identity?.role === "super_admin" ? current : null));
        setError(next.error);
        setErrorCode(next.errorCode);
        setLoading(false);

        // "Success" for de-dup purposes means we reached a stable end state
        // for this signature: either a real identity for a real session, or a
        // clean signed-out commit. A soft failure (real session but null
        // identity + errorCode) is NOT terminal — roll the signature back so a
        // retry can re-attempt without first having to invalidate the token.
        committedUsableIdentity = nextSession === null || next.identity !== null;
      } finally {
        if (!committedUsableIdentity && lastSyncedSignatureRef.current === signature) {
          lastSyncedSignatureRef.current = null;
        }
      }
    };

    if (!supabase) {
      setError(runtimeConfig.error);
      setErrorCode("runtime_config");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    supabase.auth.getSession().then(async ({ data, error: authError }) => {
      if (!active) return;

      if (authError) {
        setError(authError.message);
        setErrorCode("session_invalid");
        setLoading(false);
        return;
      }

      await syncSessionState(data.session, "getSession");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // [TEMP PERF] log the auth-event type so we know whether INITIAL_SESSION etc. fires
      console.log(`[TEMP PERF][auth] onAuthStateChange event=${event}`);
      window.setTimeout(() => {
        void syncSessionState(nextSession, `onAuthStateChange:${event}`);
      }, 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refreshIdentity = useCallback(async () => {
    if (!supabase) {
      setError(runtimeConfig.error ?? "Supabase is not configured.");
      setErrorCode("runtime_config");
      return;
    }

    setLoading(true);
    const { data, error: authError } = await supabase.auth.getSession();
    if (authError) {
      setError("Could not validate your current session. Please sign in again.");
      setErrorCode("session_invalid");
      setLoading(false);
      return;
    }

    setSession(data.session);
    const next = await loadIdentity(data.session);
    setActorIdentity(next.identity);
    setImpersonatedIdentity((current) => (next.identity?.role === "super_admin" ? current : null));
    setError(next.error);
    setErrorCode(next.errorCode);
    setLoading(false);
  }, []);

  const signInWithOtp = useCallback(async (email: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    if (!runtimeConfig.authAllowMagicLink) {
      return { ok: false, message: "Magic link sign-in is not enabled for this environment." };
    }
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (signInError) return { ok: false, message: toSafeAuthMessage(signInError.message) };
    return { ok: true, message: "Magic link sent. Check your inbox." };
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) return { ok: false, message: toSafeAuthMessage(signInError.message) };
    return { ok: true, message: "Signed in successfully." };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildBrowserRedirect("/reset-password"),
    });
    if (resetError) return { ok: false, message: toSafeAuthMessage(resetError.message) };
    return {
      ok: true,
      message: "Password reset email sent. Open the recovery link to set a new password.",
    };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) return { ok: false, message: toSafeAuthMessage(updateError.message) };
    return { ok: true, message: "Password updated successfully." };
  }, []);

  const updateProfileName = useCallback(
    async (fullName: string) => {
      if (!supabase) {
        return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
      }

      const trimmed = fullName.trim().replace(/\s+/g, " ");
      if (!trimmed) {
        return { ok: false, message: "Enter a valid full name before saving." };
      }

      const sessionUserId = session?.user.id;
      if (!sessionUserId) {
        return { ok: false, message: "No active authenticated session found." };
      }

      const [firstName, ...lastNameParts] = trimmed.split(" ");
      const lastName = lastNameParts.join(" ");

      try {
        await repository.updateProfileName(sessionUserId, trimmed);
      } catch (reason) {
        if (reason instanceof RepositoryError) {
          return { ok: false, message: toSafeAuthMessage(reason.message) };
        }
        const fallbackMessage = reason instanceof Error ? reason.message : "Profile update failed.";
        return { ok: false, message: toSafeAuthMessage(fallbackMessage) };
      }

      setActorIdentity((current) =>
        current ? { ...current, fullName: `${firstName} ${lastName}`.trim() || trimmed } : current,
      );
      setImpersonatedIdentity((current) =>
        current && current.id === sessionUserId
          ? { ...current, fullName: `${firstName} ${lastName}`.trim() || trimmed }
          : current,
      );
      return { ok: true, message: "Profile name updated successfully." };
    },
    [session?.user.id],
  );

  const updateProfileAvatar = useCallback(
    async (avatarPath: string | null) => {
      const sessionUserId = session?.user.id;
      if (!sessionUserId) {
        return { ok: false, message: "No active authenticated session found." };
      }

      try {
        await repository.updateProfileAvatar(sessionUserId, avatarPath);
      } catch (reason) {
        if (reason instanceof RepositoryError) {
          return { ok: false, message: toSafeAuthMessage(reason.message) };
        }
        const fallbackMessage = reason instanceof Error ? reason.message : "Avatar update failed.";
        return { ok: false, message: toSafeAuthMessage(fallbackMessage) };
      }

      setActorIdentity((current) =>
        current && current.id === sessionUserId ? { ...current, avatarPath } : current,
      );
      setImpersonatedIdentity((current) =>
        current && current.id === sessionUserId ? { ...current, avatarPath } : current,
      );
      return { ok: true, message: avatarPath ? "Photo updated." : "Photo removed." };
    },
    [session?.user.id],
  );

  const impersonate = useCallback((nextIdentity: Identity) => {
    if (!runtimeConfig.allowInternalImpersonation) return;
    setImpersonatedIdentity(nextIdentity);
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonatedIdentity(null);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setActorIdentity(null);
    setImpersonatedIdentity(null);
    setSession(null);
    setError(null);
    setErrorCode(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      actorIdentity,
      identity,
      session,
      error,
      errorCode,
      isImpersonating,
      refreshIdentity,
      signInWithPassword,
      signInWithOtp,
      requestPasswordReset,
      updatePassword,
      updateProfileName,
      updateProfileAvatar,
      impersonate,
      stopImpersonation,
      signOut,
    }),
    [
      actorIdentity,
      error,
      errorCode,
      identity,
      impersonate,
      isImpersonating,
      loading,
      refreshIdentity,
      requestPasswordReset,
      session,
      signInWithOtp,
      signInWithPassword,
      signOut,
      stopImpersonation,
      updatePassword,
      updateProfileName,
      updateProfileAvatar,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
