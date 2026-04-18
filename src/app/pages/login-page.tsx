import { type FormEvent, useState } from "react";
import { ArrowRight, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Navigate } from "react-router-dom";
import { Banner, LoadingState } from "../components/app-ui";
import { runtimeConfig } from "../lib/env";
import { useAuth } from "../providers/auth";

type AuthMode = "signin" | "reset" | "magic";

type FormMessage = {
  tone: "info" | "warning" | "danger";
  text: string;
};

const modeCopy: Record<
  AuthMode,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    cta: string;
    busy: string;
    icon: typeof LockKeyhole;
  }
> = {
  signin: {
    eyebrow: "Secure access",
    title: "Sign in to your account",
    subtitle: "Use your company email and password to continue.",
    cta: "Sign in",
    busy: "Signing in...",
    icon: LockKeyhole,
  },
  reset: {
    eyebrow: "Password recovery",
    title: "Reset your password",
    subtitle: "We will send a recovery link to your email address.",
    cta: "Send reset link",
    busy: "Sending reset link...",
    icon: KeyRound,
  },
  magic: {
    eyebrow: "Passwordless access",
    title: "Send a magic link",
    subtitle: "Use a one-time sign-in link sent to your email.",
    cta: "Send magic link",
    busy: "Sending magic link...",
    icon: Mail,
  },
};

function AuthInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder: string;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-2xl border border-[#242424] bg-[#050505] px-4 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-emerald-500/60 focus:ring-4 focus:ring-emerald-500/10"
      />
    </label>
  );
}

function SwitchButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
    >
      {children}
    </button>
  );
}

function submitTone(ok: boolean): FormMessage["tone"] {
  return ok ? "info" : "danger";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getRecoveryHint(mode: AuthMode, text?: string) {
  const normalized = text?.toLowerCase() ?? "";
  if (normalized.includes("invalid email or password")) {
    return "Check your credentials or use password reset to regain access.";
  }
  if (mode === "reset") {
    return "Use the latest recovery email. Older links may expire after issuing a newer one.";
  }
  if (mode === "magic") {
    return "Magic links are single-use and can expire quickly. Request a fresh one if needed.";
  }
  return null;
}

function validateAuthForm({
  mode,
  email,
  password,
}: {
  mode: AuthMode;
  email: string;
  password: string;
}) {
  if (!email) return "Email is required.";
  if (!isValidEmail(email)) return "Enter a valid email address.";

  if (mode === "signin" && !password) {
    return "Password is required.";
  }

  return null;
}

export function LoginPage() {
  const {
    signInWithOtp,
    signInWithPassword,
    requestPasswordReset,
    identity,
    session,
    loading,
    error,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lastSuccessMode, setLastSuccessMode] = useState<AuthMode | null>(null);

  const activeCopy = modeCopy[mode];
  const ActiveIcon = activeCopy.icon;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white">
        <LoadingState />
      </div>
    );
  }

  if (session || identity) return <Navigate to="/" replace />;

  function switchMode(nextMode: AuthMode) {
    if (nextMode === "magic" && !runtimeConfig.authAllowMagicLink) {
      setMessage({
        tone: "warning",
        text: "Magic link sign-in is not enabled for this environment.",
      });
      return;
    }
    setMode(nextMode);
    setMessage(null);
    setPassword("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();
    const validationError = validateAuthForm({
      mode,
      email: trimmedEmail,
      password,
    });

    if (validationError) {
      setMessage({ tone: "warning", text: validationError });
      return;
    }

    setBusy(true);

    const result =
      mode === "signin"
        ? await signInWithPassword(trimmedEmail, password)
        : mode === "reset"
          ? await requestPasswordReset(trimmedEmail)
          : await signInWithOtp(trimmedEmail);

    setMessage({ tone: submitTone(result.ok), text: result.message });
    setLastSuccessMode(result.ok ? mode : null);
    setBusy(false);
  }

  const recoveryHint = getRecoveryHint(mode, message?.text ?? error ?? undefined);

  return (
    <main className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(34,197,94,0.14),transparent_34%),radial-gradient(circle_at_84%_20%,rgba(59,130,246,0.12),transparent_30%),linear-gradient(180deg,#07110b_0%,#050505_48%,#020202_100%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-5 py-6 lg:px-8">
        <section className="mx-auto w-full max-w-xl">
          <div className="rounded-[2rem] border border-[#242424] bg-[#080808]/95 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.5)] backdrop-blur md:p-7">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              ColdUnicorn Secure Access
            </div>

            <div className="mt-7 flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                <ActiveIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                  {activeCopy.eyebrow}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{activeCopy.title}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-400">{activeCopy.subtitle}</p>
              </div>
            </div>

            <p className="mt-5 text-sm text-neutral-500">
              Access is available only for authorized users.
            </p>
            {runtimeConfig.authInviteOnly && (
              <p className="mt-2 text-sm text-neutral-500">
                New access is invitation-only. Contact an administrator or your account manager to be invited.
              </p>
            )}

            <div className="mt-6 space-y-3">
              {error && <Banner tone="warning">{error}</Banner>}
              {message && <Banner tone={message.tone}>{message.text}</Banner>}
              {recoveryHint && <p className="text-sm text-neutral-400">{recoveryHint}</p>}
              {lastSuccessMode === "reset" && mode === "reset" && (
                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="text-sm font-medium text-emerald-300 transition hover:text-emerald-200"
                >
                  Back to sign in
                </button>
              )}
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <AuthInput
                label="Work email"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
              />

              {mode === "signin" && (
                <AuthInput
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              )}

              <button
                type="submit"
                disabled={busy}
                className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? activeCopy.busy : activeCopy.cta}
                {!busy && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
              </button>
            </form>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#1f1f1f] pt-5">
              {mode !== "signin" ? (
                <p className="text-sm text-neutral-500">
                  Already have access?{" "}
                  <SwitchButton onClick={() => switchMode("signin")}>Sign in</SwitchButton>
                </p>
              ) : (
                <p className="text-sm text-neutral-500">Access is provisioned by your account administrator.</p>
              )}

              <div className="flex gap-4">
                {mode !== "reset" && (
                  <SwitchButton onClick={() => switchMode("reset")}>Forgot password</SwitchButton>
                )}
                {runtimeConfig.authAllowMagicLink && mode !== "magic" && (
                  <SwitchButton onClick={() => switchMode("magic")}>Magic link</SwitchButton>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
