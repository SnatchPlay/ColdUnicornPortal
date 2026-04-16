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
import { runtimeConfig } from "../lib/env";
import { supabase } from "../lib/supabase";
import type { Identity, UserRecord } from "../types/core";

interface AuthContextValue {
  loading: boolean;
  actorIdentity: Identity | null;
  identity: Identity | null;
  session: Session | null;
  error: string | null;
  isImpersonating: boolean;
  signUpWithPassword: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ) => Promise<{ ok: boolean; message: string }>;
  signInWithPassword: (email: string, password: string) => Promise<{ ok: boolean; message: string }>;
  signInWithOtp: (email: string) => Promise<{ ok: boolean; message: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; message: string }>;
  updatePassword: (password: string) => Promise<{ ok: boolean; message: string }>;
  impersonate: (nextIdentity: Identity) => void;
  stopImpersonation: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildBrowserRedirect(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

function mapUserToIdentity(user: UserRecord, clientId?: string): Identity {
  return {
    id: user.id,
    fullName: `${user.first_name} ${user.last_name}`.trim(),
    email: user.email,
    role: user.role,
    ...(clientId ? { clientId } : {}),
  };
}

async function loadIdentity(session: Session | null) {
  if (!supabase) {
    return {
      identity: null,
      error: runtimeConfig.error,
    };
  }

  if (!session) {
    return {
      identity: null,
      error: null,
    };
  }

  const { data: publicUser, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    return {
      identity: null,
      error: `Signed-in session could not read public.users: ${error.message}`,
    };
  }

  if (!publicUser) {
    return {
      identity: null,
      error: "Supabase session exists, but public.users is not linked to auth.users yet.",
    };
  }

  let clientId: string | undefined;
  if (publicUser.role === "client") {
    const { data: clientMapping } = await supabase
      .from("client_users")
      .select("client_id")
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle();

    if (clientMapping?.client_id) {
      clientId = clientMapping.client_id;
    }
  }

  return {
    identity: mapUserToIdentity(publicUser as UserRecord, clientId),
    error: null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [actorIdentity, setActorIdentity] = useState<Identity | null>(null);
  const [impersonatedIdentity, setImpersonatedIdentity] = useState<Identity | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const identity =
    actorIdentity?.role === "super_admin" && impersonatedIdentity ? impersonatedIdentity : actorIdentity;
  const isImpersonating = actorIdentity?.role === "super_admin" && Boolean(impersonatedIdentity);

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
      setLoading(false);
    };

    if (!supabase) {
      setError(runtimeConfig.error);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    supabase.auth.getSession().then(async ({ data, error: authError }) => {
      if (!active) return;

      if (authError) {
        setError(authError.message);
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

  const signInWithOtp = useCallback(async (email: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (signInError) return { ok: false, message: signInError.message };
    return { ok: true, message: "Magic link sent. Check your inbox." };
  }, []);

  const signUpWithPassword = useCallback(
    async (email: string, password: string, firstName: string, lastName: string) => {
      if (!supabase) {
        return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
      }

      const normalizedFirstName = firstName.trim();
      const normalizedLastName = lastName.trim();
      const fullName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ").trim();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            full_name: fullName,
          },
        },
      });

      if (signUpError) return { ok: false, message: signUpError.message };

      if (data.session) {
        return { ok: true, message: "Account created and signed in successfully." };
      }

      return {
        ok: true,
        message: "Account created. Check your email to confirm registration before signing in.",
      };
    },
    [],
  );

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) return { ok: false, message: signInError.message };
    return { ok: true, message: "Signed in successfully." };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) {
      return { ok: false, message: runtimeConfig.error ?? "Supabase is not configured." };
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: buildBrowserRedirect("/reset-password"),
    });
    if (resetError) return { ok: false, message: resetError.message };
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
    if (updateError) return { ok: false, message: updateError.message };
    return { ok: true, message: "Password updated successfully." };
  }, []);

  const impersonate = useCallback((nextIdentity: Identity) => {
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
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      actorIdentity,
      identity,
      session,
      error,
      isImpersonating,
      signUpWithPassword,
      signInWithPassword,
      signInWithOtp,
      requestPasswordReset,
      updatePassword,
      impersonate,
      stopImpersonation,
      signOut,
    }),
    [
      actorIdentity,
      error,
      identity,
      impersonate,
      isImpersonating,
      loading,
      requestPasswordReset,
      session,
      signInWithOtp,
      signInWithPassword,
      signOut,
      signUpWithPassword,
      stopImpersonation,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
