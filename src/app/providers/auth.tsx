import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
    return await repository.loadIdentity(session.user.id);
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

  useEffect(() => {
    let active = true;

    const syncSessionState = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);

      const next = await loadIdentity(nextSession);
      if (!active) return;

      setActorIdentity(next.identity);
      setImpersonatedIdentity((current) => (next.identity?.role === "super_admin" ? current : null));
      setError(next.error);
      setErrorCode(next.errorCode);
      setLoading(false);
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

      await syncSessionState(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        void syncSessionState(nextSession);
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
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
