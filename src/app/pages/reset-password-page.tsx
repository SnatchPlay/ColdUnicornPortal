import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, LoadingState, Surface } from "../components/app-ui";
import { useAuth } from "../providers/auth";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { loading, session, updatePassword, error } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (!password && !confirmPassword) return null;
    if (password.length < 8) return "Use at least 8 characters for the new password.";
    if (password !== confirmPassword) return "Password confirmation does not match.";
    return null;
  }, [confirmPassword, password]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setBusy(true);
    const result = await updatePassword(password);
    setMessage(result.message);
    setBusy(false);

    if (result.ok) {
      window.setTimeout(() => {
        navigate("/", { replace: true });
      }, 900);
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_rgba(15,23,42,1),_rgba(2,6,23,1))] px-4 py-8 text-foreground">
      <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center">
        <Surface
          title="Reset password"
          subtitle="Open this page from the Supabase recovery email to set a new password."
          className="w-full"
        >
          <div className="space-y-4">
            {error && <Banner tone="warning">{error}</Banner>}
            {message && <Banner tone={validationError ? "warning" : "info"}>{message}</Banner>}

            {!session ? (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>No recovery session is active on this device.</p>
                <p>Open the latest password reset email and use the recovery link again.</p>
                <Link
                  to="/login"
                  className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/30"
                >
                  Back to login
                </Link>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <label className="block space-y-2">
                  <span className="text-sm text-muted-foreground">New password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter a new password"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm text-muted-foreground">Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat the new password"
                    className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none transition focus:border-sky-400/40 focus:ring-2 focus:ring-sky-400/15"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || Boolean(validationError)}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-4 py-2.5 text-sm text-white transition hover:bg-emerald-500/30 disabled:opacity-60"
                >
                  {busy ? "Updating password..." : "Save new password"}
                </button>
              </form>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}
